import asyncio
import math
import re
import unicodedata
from typing import TYPE_CHECKING

from unidecode import unidecode

from adapters.services.igdb_types import Game
from endpoints.responses.romio import (
    RomioGameSchema,
    RomioManifestSchema,
    RomioMetadataStatusSchema,
    RomioMetadataSyncItemSchema,
    RomioMetadataSyncSchema,
)
from handler.romio_handler import RomioError, RomioHandler

if TYPE_CHECKING:
    from handler.metadata.igdb_handler import IGDBHandler

IGDB_FIELDS = (
    "id",
    "name",
    "slug",
    "platforms",
    "alternative_names.name",
    "game_localizations.name",
    "cover.image_id",
    "total_rating",
    "total_rating_count",
)
_sync_lock = asyncio.Lock()


def get_igdb_provider() -> "IGDBHandler":
    from handler.metadata import meta_igdb_handler

    return meta_igdb_handler


def metadata_status() -> RomioMetadataStatusSchema:
    return RomioMetadataStatusSchema(configured=get_igdb_provider().is_enabled())


def normalized_title(value: str) -> str:
    value = re.sub(r"^(.+),\s*(the|an|a)$", r"\2 \1", value, flags=re.IGNORECASE)
    value = unicodedata.normalize("NFKD", value).casefold()
    return "".join(character for character in value if character.isalnum())


def exact_matches(title: str, platform_ids: set[int], games: list[Game]) -> list[Game]:
    key = normalized_title(title)
    matches: dict[int, Game] = {}
    for game in games:
        game_id = game.get("id")
        if type(game_id) is not int or game_id <= 0:
            continue
        platforms = game.get("platforms", [])
        if not any(
            (value.get("id") if isinstance(value, dict) else value) in platform_ids
            for value in platforms
        ):
            continue
        names = [game.get("name", "")]
        for field in ("alternative_names", "game_localizations"):
            names.extend(
                value.get("name", "")
                for value in game.get(field, [])
                if isinstance(value, dict)
            )
        if key and any(
            isinstance(name, str) and normalized_title(name) == key for name in names
        ):
            matches[game_id] = game
    return list(matches.values())


def metadata_payload(game: Game, existing: RomioGameSchema) -> dict[str, object]:
    score = game.get("total_rating")
    count = game.get("total_rating_count")
    rating = (
        round(score, 2)
        if type(score) in {int, float}
        and math.isfinite(score)
        and 0 <= score <= 100
        and type(count) is int
        and count > 0
        else None
    )
    cover = game.get("cover")
    image_id = cover.get("image_id") if isinstance(cover, dict) else None
    cover_url = (
        f"https://images.igdb.com/igdb/image/upload/t_cover_big/{image_id}.jpg"
        if isinstance(image_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", image_id)
        else existing.cover_url
    )
    slug = game.get("slug")
    if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9-]{1,400}", slug):
        raise RomioError("ROMIO_METADATA_INVALID_RESULT")
    return {
        "coverUrl": cover_url,
        "rating": rating,
        "ratingSource": "IGDB combined rating" if rating is not None else None,
        "awards": existing.awards,
        "metadataSource": "https://www.igdb.com/games/" + slug,
    }


async def sync_metadata(
    catalog: RomioHandler, game_ids: list[str]
) -> RomioMetadataSyncSchema:
    provider = get_igdb_provider()
    if not provider.is_enabled():
        raise RomioError("ROMIO_METADATA_NOT_CONFIGURED", 409)
    if _sync_lock.locked():
        raise RomioError("ROMIO_METADATA_SYNC_RUNNING", 409)
    async with _sync_lock:
        try:
            async with asyncio.timeout(15):
                manifest = await catalog.request("GET", "manifest", RomioManifestSchema)
        except TimeoutError:
            raise RomioError("ROMIO_METADATA_SYNC_FAILED") from None
        if not manifest.capabilities.metadata_write:
            raise RomioError("ROMIO_METADATA_WRITE_UNAVAILABLE", 409)
        slots = asyncio.Semaphore(3)

        async def match_one(game_id: str) -> RomioMetadataSyncItemSchema:
            async with slots:
                try:
                    async with asyncio.timeout(20):
                        return await _sync_game(catalog, provider, game_id)
                except Exception:
                    return RomioMetadataSyncItemSchema(
                        game_id=game_id,
                        status="failed",
                        error="ROMIO_METADATA_SYNC_FAILED",
                    )

        items = await asyncio.gather(
            *(match_one(game_id) for game_id in dict.fromkeys(game_ids))
        )
        return RomioMetadataSyncSchema(items=items)


async def _sync_game(
    catalog: RomioHandler, provider: "IGDBHandler", game_id: str
) -> RomioMetadataSyncItemSchema:
    game = await catalog.request("GET", "games/" + game_id, RomioGameSchema)
    platform_id = provider.get_platform(game.romm_slug).get("igdb_id")
    search_term = re.sub(r"[^A-Za-z0-9 ]", " ", unidecode(game.title))[:160].strip()
    if not platform_id or not search_term:
        return RomioMetadataSyncItemSchema(game_id=game_id, status="unsupported")
    platform_ids = {platform_id}
    twin_slug = {
        "nes": "famicom",
        "famicom": "nes",
        "snes": "sfam",
        "sfam": "snes",
    }.get(game.romm_slug)
    if twin_slug:
        twin_id = provider.get_platform(twin_slug).get("igdb_id")
        if twin_id:
            platform_ids.add(twin_id)
    games = await provider.igdb_service.list_games(
        search_term=search_term,
        fields=IGDB_FIELDS,
        where="platforms = ("
        + ",".join(str(value) for value in sorted(platform_ids))
        + ")",
        limit=50,
    )
    matches = exact_matches(game.title, platform_ids, games)
    if len(matches) != 1:
        return RomioMetadataSyncItemSchema(
            game_id=game_id, status="ambiguous" if matches else "unmatched"
        )
    updated = await catalog.request(
        "POST",
        "games/" + game_id + "/metadata",
        RomioGameSchema,
        payload=metadata_payload(matches[0], game),
    )
    return RomioMetadataSyncItemSchema(game_id=game_id, status="matched", game=updated)
