import json
from collections.abc import AsyncIterator
from pathlib import Path

import handler.auth  # noqa: F401
import handler.database  # noqa: F401
import httpx
import pytest
from endpoints import romio
from fastapi import FastAPI
from handler.auth.constants import FULL_SCOPES, Scope
from handler.auth.middleware.csrf_middleware import CSRFMiddleware
from handler.auth.permissions import ResolvedGrant, ResolvedPermissions
from handler.romio_handler import (
    MAX_RESPONSE_BYTES,
    RomioHandler,
    parse_connection_link,
)
import handler.romio_handler as romio_handler_module
import handler.romio_metadata_handler as metadata_module
from models.permission import PermAction, PermEntity
from models.user import Role
from starlette.authentication import (
    AuthCredentials,
    AuthenticationBackend,
    SimpleUser,
    UnauthenticatedUser,
)
from starlette.middleware.authentication import AuthenticationMiddleware
from starlette.requests import HTTPConnection
from utils.context import create_romio_httpx_client, ctx_romio_httpx_client
import utils.context as context_module

TOKEN = "mock-addon-token-" + "a" * 40
LINK = "https://romio.example/romio/addon#" + TOKEN
GAME_ID = "a" * 64
CANDIDATE_ID = "b" * 64
MANIFEST = {
    "id": "org.romio.games",
    "version": "1.0.0",
    "name": "Romio",
    "systems": [
        {
            "id": "gba",
            "name": "Game Boy Advance",
            "rommSlug": "gba",
            "browserCore": "mgba",
            "retro": False,
        }
    ],
    "categories": [{"id": "all", "name": "All games"}],
    "capabilities": {"browser": True, "native": True, "metadataWrite": True},
    "catalogReady": True,
}
GAME = {
    "id": GAME_ID,
    "title": "Mock Adventure",
    "system": "gba",
    "systemName": "Game Boy Advance",
    "rommSlug": "gba",
    "browserCore": "mgba",
    "sourceCount": 1,
    "coverUrl": None,
    "rating": None,
    "ratingSource": None,
    "awards": [],
    "metadataSource": None,
}
CANDIDATE = {
    "id": CANDIDATE_ID,
    "title": "Mock Adventure.zip",
    "system": "gba",
    "region": "USA",
    "revision": "Unknown",
    "source": {
        "infoHash": "c" * 40,
        "filePath": "Mock/Adventure.zip",
        "size": 128,
        "sha256": "",
    },
    "origin": "Minerva",
    "provenance": "https://r-roms.github.io/",
    "totalSize": 128,
    "score": 100,
    "reasons": [],
    "cached": True,
    "packaging": "zip",
    "contentsVerified": False,
}
JOB = {
    "id": CANDIDATE_ID,
    "state": "ready",
    "progress": 1,
    "error": None,
    "updatedAt": 1000,
    "candidate": CANDIDATE,
}


class MockUser(SimpleUser):
    def __init__(self, role: str):
        super().__init__(role)
        self.id = 1
        self.role = Role.ADMIN if role == "admin" else Role.USER


class MockAuthentication(AuthenticationBackend):
    async def authenticate(self, conn: HTTPConnection):
        role = conn.headers.get("x-test-role")
        if role is None:
            return None
        if role == "kiosk":
            return AuthCredentials([Scope.ROMS_READ]), UnauthenticatedUser()
        scopes = (
            FULL_SCOPES if role == "admin" else [Scope.ROMS_READ, Scope.ROMS_USER_WRITE]
        )
        if role == "readonly-token":
            scopes = [Scope.ROMS_READ]
        conn.scope.setdefault("state", {})["permissions"] = ResolvedPermissions(
            is_admin=role == "admin",
            user_id=1,
            grants=frozenset()
            if role == "denied"
            else frozenset({ResolvedGrant(PermEntity.ROMS, PermAction.READ, False)}),
            hidden_platform_ids=frozenset(),
            hidden_rom_ids=frozenset(),
        )
        return AuthCredentials(scopes), MockUser(role)


class Harness:
    def __init__(self, path: Path):
        self.handler = RomioHandler(path)
        self.requests: list[httpx.Request] = []
        self.failure: httpx.Response | None = None
        self.links = 0
        self.url_override: str | None = None

    def upstream(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.url.host == "romio.example", (
            "No ROM/CDN request may reach the backend transport"
        )
        assert request.headers["authorization"] == "Bearer " + TOKEN
        assert TOKEN not in str(request.url)
        assert request.url.path.startswith("/romio/addon/v1/")
        if self.failure is not None:
            return self.failure
        route = request.url.path.removeprefix("/romio/addon/v1/")
        if route == "manifest":
            return httpx.Response(200, json=MANIFEST)
        if route == "catalog":
            return httpx.Response(
                200, json={"items": [GAME], "offset": 0, "hasMore": False, "total": 1}
            )
        if route == "games/" + GAME_ID:
            return httpx.Response(200, json=GAME)
        if route == "games/" + GAME_ID + "/metadata":
            return httpx.Response(200, json={**GAME, **json.loads(request.content)})
        if route.endswith("/sources"):
            return httpx.Response(
                200,
                json={
                    "items": [CANDIDATE],
                    "warnings": [],
                    "offset": 0,
                    "hasMore": False,
                },
            )
        if route.endswith("/link"):
            self.links += 1
            return httpx.Response(
                200,
                json={
                    "url": self.url_override
                    or f"https://cdn.torbox.app/mock.zip?fresh={self.links}"
                },
            )
        return httpx.Response(202 if request.method == "POST" else 200, json=JOB)


@pytest.fixture
async def harness(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[tuple[Harness, httpx.AsyncClient]]:
    state = Harness(tmp_path / "private-config" / "connection.json")
    monkeypatch.setattr(romio, "romio_handler", state.handler)
    app = FastAPI()
    app.include_router(romio.router, prefix="/api")
    app.add_middleware(CSRFMiddleware, secret="mock-csrf-test-only")
    app.add_middleware(AuthenticationMiddleware, backend=MockAuthentication())
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(state.upstream)
    ) as upstream:

        @app.middleware("http")
        async def context(request, call_next):
            token = ctx_romio_httpx_client.set(upstream)
            try:
                return await call_next(request)
            finally:
                ctx_romio_httpx_client.reset(token)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://romm.example"
        ) as client:
            yield state, client


def headers(role: str = "admin") -> dict[str, str]:
    return {"x-test-role": role, "Authorization": "Bearer mock-identity"}


async def connect(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/romio/connection", headers=headers(), json={"link": LINK}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "connected": True,
        "baseUrl": "https://romio.example/romio",
        "name": "Romio",
    }
    assert TOKEN not in response.text


async def test_connection_is_admin_only_private_and_validated_before_replacement(
    harness,
):
    state, client = harness
    for role, status in [(None, 401), ("viewer", 403), ("denied", 403)]:
        response = await client.post(
            "/api/romio/connection",
            headers=headers(role)
            if role
            else {"Authorization": "Bearer mock-identity"},
            json={"link": LINK},
        )
        assert response.status_code == status
    assert not state.handler.path.exists()
    await connect(client)
    saved = state.handler.path.read_text()
    assert TOKEN in saved
    assert (
        state.handler.public_connection().model_dump(by_alias=True)["baseUrl"]
        == "https://romio.example/romio"
    )
    state.failure = httpx.Response(
        302, headers={"Location": "https://private.invalid/?token=" + TOKEN}
    )
    rejected = await client.post(
        "/api/romio/connection", headers=headers(), json={"link": LINK}
    )
    assert rejected.status_code == 502
    assert TOKEN not in rejected.text
    assert state.handler.path.read_text() == saved
    state.failure = None
    assert (
        await client.delete("/api/romio/connection", headers=headers())
    ).status_code == 204
    assert not state.handler.path.exists()


async def test_catalog_requires_real_auth_and_grants_and_serializes_contract(harness):
    state, client = harness
    await connect(client)
    for role, status in [(None, 401), ("kiosk", 401), ("denied", 403)]:
        response = await client.get(
            "/api/romio/catalog", headers=headers(role) if role else {}
        )
        assert response.status_code == status
    before = len(state.requests)
    response = await client.get(
        "/api/romio/catalog?system=gba&q=Mock&offset=0", headers=headers("viewer")
    )
    assert response.status_code == 200
    assert response.json()["items"][0] == GAME
    assert response.headers["cache-control"] == "no-store"
    assert len(state.requests) == before + 1
    assert state.requests[-1].url.params["system"] == "gba"
    assert (
        await client.get("/api/romio/catalog?offset=1", headers=headers())
    ).status_code == 422
    assert len(state.requests) == before + 1


async def test_cookie_mutations_keep_romm_csrf_protection(harness):
    state, client = harness
    await connect(client)
    client.cookies.clear()
    rejected = await client.post(
        "/api/romio/acquisitions",
        headers={"x-test-role": "viewer"},
        json={"candidateId": CANDIDATE_ID},
    )
    assert rejected.status_code == 403
    response = await client.get(
        "/api/romio/connection", headers={"x-test-role": "viewer"}
    )
    csrf = response.cookies["csrftoken"]
    accepted = await client.post(
        "/api/romio/acquisitions",
        headers={"x-test-role": "viewer", "x-csrftoken": csrf},
        json={"candidateId": CANDIDATE_ID},
    )
    assert accepted.status_code == 202


async def test_source_selection_acquisition_and_fresh_redirect_never_proxy_file_bytes(
    harness,
):
    state, client = harness
    await connect(client)
    sources = await client.post(
        f"/api/romio/games/{GAME_ID}/sources",
        headers=headers("viewer"),
        json={"region": "USA"},
    )
    assert sources.status_code == 200
    assert sources.json()["items"][0]["source"]["filePath"] == "Mock/Adventure.zip"
    assert json.loads(state.requests[-1].content) == {
        "region": "USA",
        "revision": "",
        "offset": 0,
    }
    denied = await client.post(
        "/api/romio/acquisitions",
        headers=headers("readonly-token"),
        json={"candidateId": CANDIDATE_ID},
    )
    assert denied.status_code == 403
    acquired = await client.post(
        "/api/romio/acquisitions",
        headers=headers("viewer"),
        json={"candidateId": CANDIDATE_ID},
    )
    assert acquired.status_code == 202
    assert acquired.json()["candidate"]["id"] == CANDIDATE_ID
    for method in ["GET", "HEAD"]:
        response = await client.request(
            method,
            f"/api/romio/acquisitions/{CANDIDATE_ID}/content",
            headers={**headers("viewer"), "Range": "bytes=0-7"},
            follow_redirects=False,
        )
        assert response.status_code == 307
        assert response.content == b""
        assert (
            response.headers["location"]
            == f"https://cdn.torbox.app/mock.zip?fresh={state.links}"
        )
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["referrer-policy"] == "no-referrer"
    link = await client.post(
        f"/api/romio/acquisitions/{CANDIDATE_ID}/link",
        headers=headers("viewer"),
        json={},
    )
    assert link.json() == {"url": "https://cdn.torbox.app/mock.zip?fresh=3"}
    assert state.links == 3
    assert (
        len(
            [
                request
                for request in state.requests
                if request.url.path.endswith("/acquisitions")
            ]
        )
        == 1
    )


@pytest.mark.parametrize(
    "failure",
    [
        httpx.Response(
            200, content=b"x", headers={"content-length": str(MAX_RESPONSE_BYTES + 1)}
        ),
        httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)),
        httpx.Response(200, json={"secret": TOKEN}),
        httpx.Response(302, headers={"Location": "https://cdn.torbox.app/rom.zip"}),
        httpx.Response(500, json={"error": "https://upstream.invalid/?token=" + TOKEN}),
    ],
)
async def test_untrusted_upstream_responses_are_bounded_and_sanitized(harness, failure):
    state, client = harness
    await connect(client)
    state.failure = failure
    response = await client.get("/api/romio/manifest", headers=headers())
    assert response.status_code == 502
    assert TOKEN not in response.text


@pytest.mark.parametrize(
    "url",
    [
        "http://cdn.torbox.app/game.zip",
        "https://127.0.0.1/private",
        "https://user:password@example.com/file",
        "https://example.com/file#secret",
        "https://example.com/file\r\nX-Injected: yes",
    ],
)
async def test_unsafe_download_links_fail_without_redirect(harness, url: str):
    state, client = harness
    await connect(client)
    state.url_override = url
    response = await client.get(
        f"/api/romio/acquisitions/{CANDIDATE_ID}/content",
        headers=headers(),
        follow_redirects=False,
    )
    assert response.status_code == 502
    assert "location" not in response.headers


@pytest.mark.parametrize(
    "link",
    [
        "http://romio.example/romio/addon#" + TOKEN,
        "https://127.0.0.1/addon#" + TOKEN,
        "https://localhost/addon#" + TOKEN,
        "https://user:password@romio.example/addon#" + TOKEN,
        "https://romio.example/addon?token=" + TOKEN,
        "https://romio.example/%2e%2e/addon#" + TOKEN,
        "http://romio:3000/addon#" + TOKEN,
    ],
)
def test_connection_rejects_private_urls_credentials_and_query_tokens(link: str):
    with pytest.raises(romio.RomioError) as caught:
        parse_connection_link(link)
    assert caught.value.detail == "ROMIO_INVALID_CONNECTION_LINK"


async def test_romio_http_client_has_independent_ssrf_policy():
    async with create_romio_httpx_client() as client:
        assert client._transport._pool._network_backend._allowlist == frozenset()
        assert not client._trust_env


async def test_revoked_addon_token_does_not_invalidate_romm_session(harness):
    state, client = harness
    await connect(client)
    state.failure = httpx.Response(401, json={"error": "UNAUTHORIZED"})
    response = await client.get("/api/romio/manifest", headers=headers("viewer"))
    assert response.status_code == 409
    assert response.json() == {"detail": "ROMIO_CONNECTION_REJECTED"}


async def test_explicit_internal_origin_is_narrowly_scoped(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        romio_handler_module, "ROMIO_TRUSTED_INTERNAL_ORIGIN", "http://romio:3000"
    )
    monkeypatch.setattr(
        context_module, "ROMIO_TRUSTED_INTERNAL_ORIGIN", "http://romio:3000"
    )
    connection = parse_connection_link("http://romio:3000/addon#" + TOKEN)
    assert connection.base_url == "http://romio:3000"
    async with create_romio_httpx_client() as client:
        assert client._transport._pool._network_backend._allowlist == frozenset(
            {("romio", 3000)}
        )
    for url in [
        "http://romio:3001/addon#",
        "http://127.0.0.1:3000/addon#",
        "http://romio.evil.example:3000/addon#",
    ]:
        with pytest.raises(romio.RomioError):
            parse_connection_link(url + TOKEN)


class MockIGDB:
    def __init__(self):
        self.enabled = True
        self.igdb_service = self
        self.calls: list[dict[str, object]] = []
        self.games = [
            {
                "id": 42,
                "name": "Mock Adventure",
                "slug": "mock-adventure",
                "platforms": [24],
                "cover": {"image_id": "mock_cover"},
                "total_rating": 82.34,
                "total_rating_count": 20,
            }
        ]
        self.error: Exception | None = None

    def is_enabled(self) -> bool:
        return self.enabled

    def get_platform(self, slug: str):
        return {"igdb_id": {"gba": 24, "nes": 18, "famicom": 99}.get(slug)}

    async def list_games(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.games


@pytest.fixture
def igdb(monkeypatch: pytest.MonkeyPatch):
    provider = MockIGDB()
    monkeypatch.setattr(metadata_module, "get_igdb_provider", lambda: provider)
    return provider


async def test_metadata_status_and_missing_credentials_do_not_request_upstream(
    harness, igdb
):
    state, client = harness
    igdb.enabled = False
    response = await client.get("/api/romio/metadata", headers=headers("viewer"))
    assert response.status_code == 200
    assert response.json() == {
        "provider": "igdb",
        "configured": False,
        "maxBatchSize": 12,
    }
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "ROMIO_METADATA_NOT_CONFIGURED"}
    assert not state.requests and not igdb.calls


async def test_metadata_sync_requires_admin_and_a_bounded_selection(harness, igdb):
    state, client = harness
    for role in (None, "kiosk", "viewer", "readonly-token"):
        response = await client.post(
            "/api/romio/metadata/sync",
            headers=headers(role) if role else {},
            json={"gameIds": [GAME_ID]},
        )
        assert response.status_code in {401, 403}
    for ids in ([], [GAME_ID] * 13, ["invalid"]):
        response = await client.post(
            "/api/romio/metadata/sync", headers=headers(), json={"gameIds": ids}
        )
        assert response.status_code == 422
    assert not state.requests and not igdb.calls


async def test_metadata_sync_writes_only_exact_canonical_provider_match(harness, igdb):
    state, client = harness
    await connect(client)
    response = await client.post(
        "/api/romio/metadata/sync",
        headers=headers(),
        json={"gameIds": [GAME_ID, GAME_ID], "rating": 100},
    )
    assert response.status_code == 200
    (item,) = response.json()["items"]
    assert item["status"] == "matched"
    assert item["game"]["rating"] == 82.34
    assert item["game"]["ratingSource"] == "IGDB combined rating"
    assert item["game"]["metadataSource"] == "https://www.igdb.com/games/mock-adventure"
    assert (
        item["game"]["coverUrl"]
        == "https://images.igdb.com/igdb/image/upload/t_cover_big/mock_cover.jpg"
    )
    assert item["game"]["awards"] == []
    assert igdb.calls == [
        {
            "search_term": "Mock Adventure",
            "fields": metadata_module.IGDB_FIELDS,
            "where": "platforms = (24)",
            "limit": 50,
        }
    ]
    assert (
        len(
            [
                request
                for request in state.requests
                if request.url.path.endswith("/metadata")
            ]
        )
        == 1
    )


@pytest.mark.parametrize(
    "changes, expected",
    [
        ({"platforms": [19]}, "unmatched"),
        ({"platforms": []}, "unmatched"),
        ({"name": "Mock Adventure 2"}, "unmatched"),
        ({"name": "Super Mock Adventure"}, "unmatched"),
    ],
)
async def test_metadata_sync_rejects_platform_and_title_near_matches(
    harness, igdb, changes, expected
):
    state, client = harness
    await connect(client)
    igdb.games[0].update(changes)
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    assert response.json()["items"][0]["status"] == expected
    assert not any(request.url.path.endswith("/metadata") for request in state.requests)


async def test_metadata_sync_does_not_choose_an_ambiguous_exact_match(harness, igdb):
    state, client = harness
    await connect(client)
    igdb.games.append({**igdb.games[0], "id": 43})
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    assert response.json()["items"][0]["status"] == "ambiguous"
    assert not any(request.url.path.endswith("/metadata") for request in state.requests)


@pytest.mark.parametrize(
    "score, count", [(None, 20), (82, 0), (82, None), (True, 20), (float("nan"), 20)]
)
async def test_metadata_sync_keeps_missing_or_invalid_ratings_null(
    harness, igdb, score, count
):
    state, client = harness
    await connect(client)
    igdb.games[0].update({"total_rating": score, "total_rating_count": count})
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    item = response.json()["items"][0]
    assert item["status"] == "matched"
    assert item["game"]["rating"] is None
    assert item["game"]["ratingSource"] is None


async def test_metadata_sync_uses_named_aliases_and_sanitizes_provider_query(
    harness, igdb, monkeypatch
):
    _, client = harness
    await connect(client)
    monkeypatch.setitem(GAME, "title", 'Möck - Fire Red "Version";')
    igdb.games[0].update(
        {
            "name": "Different localized name",
            "alternative_names": [{"name": "Mock FireRed Version"}],
        }
    )
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    assert response.json()["items"][0]["status"] == "matched"
    search = igdb.calls[0]["search_term"]
    assert '"' not in search and ";" not in search


async def test_metadata_sync_reports_unsupported_platform_without_igdb(
    harness, igdb, monkeypatch
):
    state, client = harness
    await connect(client)
    monkeypatch.setitem(GAME, "rommSlug", "unknown-console")
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    assert response.json()["items"][0]["status"] == "unsupported"
    assert not igdb.calls
    assert not any(request.url.path.endswith("/metadata") for request in state.requests)


async def test_metadata_provider_failure_exposes_only_a_fixed_code(harness, igdb):
    _, client = harness
    await connect(client)
    igdb.error = RuntimeError("mock-secret-must-not-leak")
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    assert response.json()["items"] == [
        {
            "gameId": GAME_ID,
            "status": "failed",
            "game": None,
            "error": "ROMIO_METADATA_SYNC_FAILED",
        }
    ]
    assert "mock-secret" not in response.text


async def test_metadata_sync_requires_upstream_metadata_write(
    harness, igdb, monkeypatch
):
    state, client = harness
    await connect(client)
    monkeypatch.setitem(MANIFEST["capabilities"], "metadataWrite", False)
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "ROMIO_METADATA_WRITE_UNAVAILABLE"}
    assert not igdb.calls
    assert not any(request.url.path.endswith("/metadata") for request in state.requests)


async def test_metadata_sync_rejects_overlapping_batches(harness, igdb):
    state, client = harness
    async with metadata_module._sync_lock:
        response = await client.post(
            "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
        )
    assert response.status_code == 409
    assert response.json() == {"detail": "ROMIO_METADATA_SYNC_RUNNING"}
    assert not state.requests and not igdb.calls


async def test_metadata_sync_includes_verified_regional_twin(
    harness, igdb, monkeypatch
):
    _, client = harness
    await connect(client)
    monkeypatch.setitem(GAME, "rommSlug", "nes")
    igdb.games[0]["platforms"] = [99]
    response = await client.post(
        "/api/romio/metadata/sync", headers=headers(), json={"gameIds": [GAME_ID]}
    )
    assert response.json()["items"][0]["status"] == "matched"
    assert igdb.calls[0]["where"] == "platforms = (18,99)"


async def test_named_player_content_binds_owner_source_and_extension(harness):
    state, client = harness
    await connect(client)
    route = f"/api/romio/acquisitions/{CANDIDATE_ID}/content/Romio-1-{CANDIDATE_ID}.zip"
    locations = []
    for method in ("GET", "HEAD"):
        response = await client.request(
            method, route, headers=headers(), follow_redirects=False
        )
        assert response.status_code == 307
        assert response.content == b""
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["referrer-policy"] == "no-referrer"
        locations.append(response.headers["location"])
    assert len(set(locations)) == 2
    assert state.links == 2


@pytest.mark.parametrize(
    "filename",
    [
        "Romio-2-" + CANDIDATE_ID + ".zip",
        "Romio-1-" + GAME_ID + ".zip",
        "Romio-1-" + CANDIDATE_ID + ".nes",
    ],
)
async def test_named_player_content_rejects_mismatched_identity_without_link(
    harness, filename
):
    state, client = harness
    await connect(client)
    response = await client.get(
        f"/api/romio/acquisitions/{CANDIDATE_ID}/content/{filename}",
        headers=headers(),
        follow_redirects=False,
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "ROMIO_SOURCE_IDENTITY_MISMATCH"}
    assert "location" not in response.headers
    assert state.links == 0
