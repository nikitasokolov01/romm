from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr
from pydantic.alias_generators import to_camel

RomioId = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
RomioLanguage = Literal["en", "es", "fr", "ru", "zh", "ja"]


class RomioSchema(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class RomioConnectionInput(BaseModel):
    link: SecretStr


class RomioConnectionSchema(RomioSchema):
    connected: bool
    base_url: str | None = None
    name: str | None = None


class RomioSystemSchema(RomioSchema):
    id: str = Field(max_length=40)
    name: str = Field(max_length=200)
    romm_slug: str = Field(max_length=100)
    browser_core: str | None = Field(default=None, max_length=100)
    retro: bool


class RomioCategorySchema(RomioSchema):
    id: str = Field(max_length=40)
    name: str = Field(max_length=100)


class RomioCapabilitiesSchema(RomioSchema):
    browser: bool
    native: bool
    metadata_write: bool = False


class RomioManifestSchema(RomioSchema):
    id: Literal["org.romio.games"]
    version: Literal["1.0.0"]
    name: str = Field(max_length=100)
    systems: list[RomioSystemSchema] = Field(max_length=100)
    categories: list[RomioCategorySchema] = Field(max_length=20)
    capabilities: RomioCapabilitiesSchema
    catalog_ready: bool
    language: RomioLanguage = "en"


class RomioGameSchema(RomioSchema):
    id: RomioId
    title: str = Field(max_length=2048)
    system: str = Field(max_length=40)
    system_name: str = Field(max_length=200)
    romm_slug: str = Field(max_length=100)
    browser_core: str | None = Field(default=None, max_length=100)
    source_count: int = Field(ge=0)
    cover_url: str | None = Field(default=None, max_length=4096)
    rating: float | None = None
    rating_source: str | None = Field(default=None, max_length=200)
    awards: list[str] = Field(max_length=100)
    metadata_source: str | None = Field(default=None, max_length=500)


class RomioCatalogSchema(RomioSchema):
    items: list[RomioGameSchema] = Field(max_length=48)
    offset: int = Field(ge=0)
    has_more: bool
    total: int = Field(ge=0)
    language: RomioLanguage = "en"


class RomioHomeSectionSchema(RomioSchema):
    id: str = Field(max_length=40)
    title: str = Field(max_length=100)
    items: list[RomioGameSchema] = Field(max_length=18)


class RomioHomeSchema(RomioSchema):
    sections: list[RomioHomeSectionSchema] = Field(max_length=12)
    language: RomioLanguage


class RomioSourceSchema(RomioSchema):
    info_hash: str = Field(pattern=r"^[a-f0-9]{40}$")
    file_path: str = Field(max_length=2048)
    size: int = Field(gt=0, le=2**53 - 1)
    sha256: str = Field(pattern=r"^([a-f0-9]{64})?$")


class RomioCandidateSchema(RomioSchema):
    id: RomioId
    title: str = Field(max_length=2048)
    system: str = Field(max_length=40)
    region: str = Field(max_length=200)
    revision: str = Field(max_length=200)
    source: RomioSourceSchema
    origin: str = Field(max_length=200)
    provenance: str = Field(max_length=4096)
    total_size: int = Field(gt=0, le=2**53 - 1)
    score: float
    reasons: list[str] = Field(max_length=40)
    cached: bool | None
    packaging: Literal["zip", "7z", "rar"] | None = None
    requires_extraction: bool | None = None
    cache_only: bool | None = None
    contents_verified: Literal[False] | None = None
    collection_label: str | None = Field(default=None, max_length=2048)


class RomioSourcesInput(RomioSchema):
    region: str = Field(default="", max_length=40)
    revision: str = Field(default="", max_length=40)
    offset: int = Field(default=0, ge=0, le=9900, multiple_of=100)


class RomioSourcesSchema(RomioSchema):
    items: list[RomioCandidateSchema] = Field(max_length=100)
    warnings: list[str] = Field(max_length=100)
    offset: int = Field(ge=0)
    has_more: bool


class RomioAcquisitionInput(RomioSchema):
    candidate_id: RomioId


class RomioJobSchema(RomioSchema):
    id: RomioId
    state: Literal["submitting", "reconciling", "downloading", "ready", "failed"]
    progress: float = Field(ge=0, le=1)
    error: str | None = Field(default=None, max_length=200)
    updated_at: int = Field(ge=0)
    candidate: RomioCandidateSchema
    stage: (
        Literal[
            "account_lookup",
            "source_metadata",
            "provider_submit",
            "inspect",
            "verify_file",
            "submitting",
            "reconciling",
            "downloading",
            "ready",
            "failed",
        ]
        | None
    ) = None
    checked_at: int | None = Field(default=None, ge=0)


class RomioLinkSchema(RomioSchema):
    url: str = Field(max_length=16384)


ROMIO_METADATA_BATCH_SIZE = 12


class RomioMetadataStatusSchema(RomioSchema):
    provider: Literal["igdb"] = "igdb"
    configured: bool
    max_batch_size: int = ROMIO_METADATA_BATCH_SIZE


class RomioMetadataSyncInput(RomioSchema):
    game_ids: list[RomioId] = Field(min_length=1, max_length=ROMIO_METADATA_BATCH_SIZE)


class RomioMetadataSyncItemSchema(RomioSchema):
    game_id: RomioId
    status: Literal["matched", "unmatched", "ambiguous", "unsupported", "failed"]
    game: RomioGameSchema | None = None
    error: str | None = None


class RomioMetadataSyncSchema(RomioSchema):
    items: list[RomioMetadataSyncItemSchema] = Field(
        max_length=ROMIO_METADATA_BATCH_SIZE
    )
