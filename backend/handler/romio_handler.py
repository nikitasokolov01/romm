import asyncio
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, SecretStr, ValidationError

from config import ROMIO_TRUSTED_INTERNAL_ORIGIN
from config.config_manager import ROMM_USER_CONFIG_PATH
from endpoints.responses.romio import RomioConnectionSchema, RomioManifestSchema
from utils.context import ctx_romio_httpx_client
from utils.ssrf import validate_url_for_http_request

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_CONNECTION_BYTES = 8192
_Model = TypeVar("_Model", bound=BaseModel)


class RomioError(HTTPException):
    def __init__(self, code: str, status_code: int = 502):
        super().__init__(status_code=status_code, detail=code)


@dataclass(frozen=True)
class RomioConnection:
    base_url: str
    token: SecretStr
    name: str = "Romio"


def parse_connection_link(link: str) -> RomioConnection:
    if len(link) > MAX_CONNECTION_BYTES or re.search(r"[\s\x00-\x1f\x7f]", link):
        raise RomioError("ROMIO_INVALID_CONNECTION_LINK", 400)
    try:
        parsed = urlsplit(link)
        origin = urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
        trusted_internal = (
            ROMIO_TRUSTED_INTERNAL_ORIGIN == "http://romio:3000"
            and origin == ROMIO_TRUSTED_INTERNAL_ORIGIN
        )
        if (
            not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or (parsed.scheme != "https" and not trusted_internal)
            or not re.fullmatch(r"(?:/[A-Za-z0-9_-]+)*/addon", parsed.path)
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,512}", parsed.fragment)
        ):
            raise ValueError
        _ = parsed.port
        base_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path[:-6], "", ""))
        validate_url_for_http_request(
            base_url + "/addon/v1/manifest",
            allowlist=frozenset({("romio", 3000)}) if trusted_internal else frozenset(),
        )
    except Exception:
        raise RomioError("ROMIO_INVALID_CONNECTION_LINK", 400) from None
    return RomioConnection(base_url=base_url, token=SecretStr(parsed.fragment))


def validate_download_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        if (
            len(value) > 16384
            or re.search(r"[\s\x00-\x1f\x7f]", value)
            or parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise ValueError
        _ = parsed.port
        validate_url_for_http_request(
            urlunsplit((parsed.scheme, parsed.netloc, "", "", "")),
            allowlist=frozenset(),
        )
    except Exception:
        raise RomioError("ROMIO_UNSAFE_DOWNLOAD_URL") from None
    return value


class RomioHandler:
    def __init__(self, path: Path | None = None):
        self.path = path or Path(ROMM_USER_CONFIG_PATH) / "romio" / "connection.json"

    def connection(self) -> RomioConnection | None:
        try:
            if self.path.stat().st_size > MAX_CONNECTION_BYTES:
                raise ValueError
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            link = raw["base_url"] + "/addon#" + raw["token"]
            connection = parse_connection_link(link)
            return RomioConnection(connection.base_url, connection.token, raw["name"])
        except FileNotFoundError:
            return None
        except Exception:
            raise RomioError("ROMIO_CONNECTION_UNAVAILABLE", 503) from None

    def public_connection(self) -> RomioConnectionSchema:
        connection = self.connection()
        return RomioConnectionSchema(
            connected=connection is not None,
            base_url=connection.base_url if connection else None,
            name=connection.name if connection else None,
        )

    async def connect(self, link: str) -> RomioConnectionSchema:
        connection = parse_connection_link(link)
        manifest = await self.request(
            "GET", "manifest", RomioManifestSchema, connection=connection
        )
        await asyncio.to_thread(
            self._save_connection,
            RomioConnection(connection.base_url, connection.token, manifest.name),
        )
        return self.public_connection()

    def _save_connection(self, connection: RomioConnection) -> None:
        temporary: str | None = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(self.path.parent, 0o700)
            fd, temporary = tempfile.mkstemp(
                dir=self.path.parent, prefix=".connection-"
            )
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                os.chmod(temporary, 0o600)
                json.dump(
                    {
                        "base_url": connection.base_url,
                        "token": connection.token.get_secret_value(),
                        "name": connection.name,
                    },
                    handle,
                )
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            temporary = None
        except OSError:
            raise RomioError("ROMIO_CONNECTION_SAVE_FAILED", 500) from None
        finally:
            if temporary is not None:
                Path(temporary).unlink(missing_ok=True)

    def disconnect(self) -> None:
        try:
            self.path.unlink(missing_ok=True)
        except OSError:
            raise RomioError("ROMIO_CONNECTION_SAVE_FAILED", 500) from None

    async def request(
        self,
        method: str,
        route: str,
        schema: type[_Model],
        *,
        payload: dict[str, object] | None = None,
        params: dict[str, str | int] | None = None,
        connection: RomioConnection | None = None,
    ) -> _Model:
        connection = connection or self.connection()
        if connection is None:
            raise RomioError("ROMIO_NOT_CONNECTED", 409)
        client = ctx_romio_httpx_client.get()
        try:
            async with (
                asyncio.timeout(135),
                client.stream(
                    method,
                    connection.base_url + "/addon/v1/" + route,
                    headers={
                        "Authorization": "Bearer "
                        + connection.token.get_secret_value(),
                        "Accept": "application/json",
                    },
                    params=params,
                    json=payload,
                    follow_redirects=False,
                    timeout=httpx.Timeout(130, connect=10),
                ) as response,
            ):
                if 300 <= response.status_code < 400:
                    raise RomioError("ROMIO_UPSTREAM_REDIRECT")
                length = response.headers.get("content-length")
                if length and (
                    not length.isdecimal() or int(length) > MAX_RESPONSE_BYTES
                ):
                    raise RomioError("ROMIO_RESPONSE_TOO_LARGE")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise RomioError("ROMIO_RESPONSE_TOO_LARGE")
                if response.status_code >= 400:
                    if response.status_code in {401, 403}:
                        raise RomioError("ROMIO_CONNECTION_REJECTED", 409)
                    code = "ROMIO_REQUEST_FAILED"
                    try:
                        upstream = json.loads(body)
                        proposed = upstream.get("error")
                        if isinstance(proposed, str) and re.fullmatch(
                            r"[A-Z][A-Z0-9_]{1,99}", proposed
                        ):
                            code = proposed
                    except ValueError, AttributeError:
                        pass
                    status = (
                        response.status_code
                        if response.status_code in {400, 401, 403, 404, 409, 429, 503}
                        else 502
                    )
                    raise RomioError(code, status)
                return schema.model_validate_json(body)
        except RomioError:
            raise
        except httpx.HTTPError, ValidationError, ValueError, TimeoutError:
            raise RomioError("ROMIO_UNAVAILABLE") from None


romio_handler = RomioHandler()
