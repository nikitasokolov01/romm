import re
from typing import Annotated

from decorators.auth import protected_route
from endpoints.responses.romio import (
    RomioAcquisitionInput,
    RomioCatalogSchema,
    RomioConnectionInput,
    RomioConnectionSchema,
    RomioGameSchema,
    RomioHomeSchema,
    RomioId,
    RomioJobSchema,
    RomioLinkSchema,
    RomioManifestSchema,
    RomioMetadataStatusSchema,
    RomioMetadataSyncInput,
    RomioMetadataSyncSchema,
    RomioSourcesInput,
    RomioSourcesSchema,
)
from fastapi import Path, Query, Request, Response
from fastapi.responses import RedirectResponse
from handler.auth.constants import Scope
from handler.auth.dependencies import assert_admin, assert_can, get_permissions
from handler.romio_handler import RomioError, romio_handler, validate_download_url
from handler.romio_metadata_handler import metadata_status, sync_metadata
from models.permission import PermAction, PermEntity
from utils.router import APIRouter

router = APIRouter(prefix="/romio", tags=["romio"])


def require_catalog_access(request: Request, response: Response) -> None:
    if not request.user.is_authenticated:
        raise RomioError("ROMIO_AUTHENTICATION_REQUIRED", 401)
    assert_can(get_permissions(request), PermEntity.ROMS, PermAction.READ)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"


@protected_route(router.get, "/connection", [Scope.ROMS_READ])
async def get_connection(request: Request, response: Response) -> RomioConnectionSchema:
    require_catalog_access(request, response)
    return romio_handler.public_connection()


@protected_route(router.get, "/metadata", [Scope.ROMS_READ])
async def get_metadata_status(
    request: Request, response: Response
) -> RomioMetadataStatusSchema:
    require_catalog_access(request, response)
    return metadata_status()


@protected_route(router.post, "/metadata/sync", [Scope.USERS_WRITE])
async def sync_game_metadata(
    request: Request, response: Response, payload: RomioMetadataSyncInput
) -> RomioMetadataSyncSchema:
    assert_admin(request)
    require_catalog_access(request, response)
    return await sync_metadata(romio_handler, payload.game_ids)


@protected_route(router.post, "/connection", [Scope.USERS_WRITE])
async def connect(
    request: Request, response: Response, payload: RomioConnectionInput
) -> RomioConnectionSchema:
    assert_admin(request)
    response.headers["Cache-Control"] = "no-store"
    return await romio_handler.connect(payload.link.get_secret_value())


@protected_route(router.delete, "/connection", [Scope.USERS_WRITE], status_code=204)
async def disconnect(request: Request) -> Response:
    assert_admin(request)
    romio_handler.disconnect()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@protected_route(router.get, "/manifest", [Scope.ROMS_READ])
async def get_manifest(request: Request, response: Response) -> RomioManifestSchema:
    require_catalog_access(request, response)
    return await romio_handler.request("GET", "manifest", RomioManifestSchema)


@protected_route(router.get, "/catalog", [Scope.ROMS_READ])
async def get_catalog(
    request: Request,
    response: Response,
    system: Annotated[str, Query(pattern=r"^[a-z0-9-]{1,40}$")] = "all",
    category: Annotated[str, Query(pattern=r"^[a-z0-9-]{1,40}$")] = "all",
    q: Annotated[str, Query(max_length=160)] = "",
    offset: Annotated[int, Query(ge=0, le=1000000, multiple_of=48)] = 0,
) -> RomioCatalogSchema:
    require_catalog_access(request, response)
    return await romio_handler.request(
        "GET",
        "catalog",
        RomioCatalogSchema,
        params={"system": system, "category": category, "q": q, "offset": offset},
    )


@protected_route(router.get, "/home", [Scope.ROMS_READ])
async def get_home(
    request: Request,
    response: Response,
    system: Annotated[str, Query(pattern=r"^[a-z0-9-]{1,40}$")] = "all",
) -> RomioHomeSchema:
    require_catalog_access(request, response)
    return await romio_handler.request(
        "GET", "home", RomioHomeSchema, params={"system": system}
    )


@protected_route(router.get, "/games/{game_id}", [Scope.ROMS_READ])
async def get_game(
    request: Request, response: Response, game_id: RomioId
) -> RomioGameSchema:
    require_catalog_access(request, response)
    return await romio_handler.request("GET", "games/" + game_id, RomioGameSchema)


@protected_route(router.post, "/games/{game_id}/sources", [Scope.ROMS_READ])
async def get_sources(
    request: Request, response: Response, game_id: RomioId, payload: RomioSourcesInput
) -> RomioSourcesSchema:
    require_catalog_access(request, response)
    return await romio_handler.request(
        "POST",
        "games/" + game_id + "/sources",
        RomioSourcesSchema,
        payload=payload.model_dump(by_alias=True),
    )


@protected_route(
    router.post,
    "/acquisitions",
    [Scope.ROMS_READ, Scope.ROMS_USER_WRITE],
    status_code=202,
)
async def acquire(
    request: Request, response: Response, payload: RomioAcquisitionInput
) -> RomioJobSchema:
    require_catalog_access(request, response)
    return await romio_handler.request(
        "POST",
        "acquisitions",
        RomioJobSchema,
        payload=payload.model_dump(by_alias=True),
    )


@protected_route(router.get, "/acquisitions/{acquisition_id}", [Scope.ROMS_READ])
async def get_acquisition(
    request: Request, response: Response, acquisition_id: RomioId
) -> RomioJobSchema:
    require_catalog_access(request, response)
    return await romio_handler.request(
        "GET", "acquisitions/" + acquisition_id, RomioJobSchema
    )


@protected_route(router.post, "/acquisitions/{acquisition_id}/link", [Scope.ROMS_READ])
async def get_link(
    request: Request, response: Response, acquisition_id: RomioId
) -> RomioLinkSchema:
    require_catalog_access(request, response)
    result = await romio_handler.request(
        "POST", "acquisitions/" + acquisition_id + "/link", RomioLinkSchema, payload={}
    )
    validate_download_url(result.url)
    return result


@protected_route(
    router.head, "/acquisitions/{acquisition_id}/content", [Scope.ROMS_READ]
)
@protected_route(
    router.get, "/acquisitions/{acquisition_id}/content", [Scope.ROMS_READ]
)
async def get_content(
    request: Request, response: Response, acquisition_id: RomioId
) -> Response:
    result = await get_link(request, response, acquisition_id)
    return RedirectResponse(
        validate_download_url(result.url),
        status_code=307,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@protected_route(
    router.head, "/acquisitions/{acquisition_id}/content/{filename}", [Scope.ROMS_READ]
)
@protected_route(
    router.get, "/acquisitions/{acquisition_id}/content/{filename}", [Scope.ROMS_READ]
)
async def get_named_content(
    request: Request,
    response: Response,
    acquisition_id: RomioId,
    filename: Annotated[
        str, Path(pattern=r"^Romio-[0-9]+-[a-f0-9]{64}\.[a-z0-9]{1,12}$")
    ],
) -> Response:
    require_catalog_access(request, response)
    job = await romio_handler.request(
        "GET", "acquisitions/" + acquisition_id, RomioJobSchema
    )
    extension = re.search(r"\.([A-Za-z0-9]{1,12})$", job.candidate.source.file_path)
    suffix = extension.group(1).lower() if extension else "rom"
    expected = f"Romio-{request.user.id}-{job.candidate.id}.{suffix}"
    if job.id != acquisition_id or filename != expected:
        raise RomioError("ROMIO_SOURCE_IDENTITY_MISMATCH", 409)
    return await get_content(request, response, acquisition_id)
