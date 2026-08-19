from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Digest = str


class ProvenanceIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Literal["primary_brand", "competitor", "category", "reference", "unattributed"]
    entity_ref: str | None = None

    @field_validator("entity_ref")
    @classmethod
    def entity_digest_shape(cls, value: str | None) -> str | None:
        if value is not None:
            require_digest(value)
        return value

    @model_validator(mode="after")
    def scope_entity_shape(self) -> ProvenanceIntent:
        if (self.scope == "unattributed") != (self.entity_ref is None):
            raise ValueError("benchmark_provenance_scope_entity_mismatch")
        return self


class BenchmarkRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-semantic-benchmark-record-v1"]
    record_key: str
    canonical_family_key: str
    content_hash: Digest
    text: str = Field(min_length=1)
    published_at: datetime
    month: str
    language: str
    country: str
    platform: str
    provenance_intents: list[ProvenanceIntent] = Field(min_length=1)
    queue_state: str
    context_hash: Digest
    authority_digest: Digest
    authority_valid_until: datetime | None = None

    @field_validator(
        "record_key",
        "canonical_family_key",
        "content_hash",
        "context_hash",
        "authority_digest",
    )
    @classmethod
    def digest_shape(cls, value: str) -> str:
        return require_digest(value)

    @field_validator("published_at", "authority_valid_until")
    @classmethod
    def aware_datetimes(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("benchmark_record_timezone_missing")
        return value

    @model_validator(mode="after")
    def temporal_shape(self) -> BenchmarkRecord:
        if self.month != self.published_at.strftime("%Y-%m"):
            raise ValueError("benchmark_record_month_mismatch")
        if not self.language.strip() or not self.country.strip() or not self.platform.strip():
            raise ValueError("benchmark_record_slice_empty")
        return self


class ExportManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-semantic-benchmark-export-v1"]
    target: Literal["noisia-staging", "local-fixture"]
    read_only: Literal[True]
    writes_performed: Literal[False]
    provider_calls: Literal[0]
    jobs_enqueued: Literal[0]
    workspace_ref: str
    export_timestamp: datetime
    period_start: str
    period_end: str
    timezone: str
    population_digest: Digest
    watermark_digest: Digest
    governance_digest: Digest
    content_digest: Digest
    schema_version: Literal["signal-semantic-benchmark-record-v1"]
    denominator: int = Field(ge=0)
    exported: int = Field(ge=0)
    excluded_by_reason: dict[str, int]
    scope_counts: dict[str, int]
    entity_counts: dict[str, int]
    language_counts: dict[str, int]
    platform_counts: dict[str, int]
    projection_snapshot_digest: Digest
    projection_generation: int = Field(ge=1)
    projection_reconciled_at: datetime
    exclusion_contract: Literal["exclusive-precedence-v1"]
    protected_state_digest_before: Digest
    protected_state_digest_after: Digest
    transaction_read_only: Literal[True]
    transaction_id_assigned: Literal[False]
    export_file_sha256: Digest

    @field_validator(
        "workspace_ref",
        "population_digest",
        "watermark_digest",
        "governance_digest",
        "content_digest",
        "projection_snapshot_digest",
        "protected_state_digest_before",
        "protected_state_digest_after",
        "export_file_sha256",
    )
    @classmethod
    def manifest_digest_shape(cls, value: str) -> str:
        return require_digest(value)

    @field_validator(
        "excluded_by_reason",
        "scope_counts",
        "entity_counts",
        "language_counts",
        "platform_counts",
    )
    @classmethod
    def nonnegative_counts(cls, values: dict[str, int]) -> dict[str, int]:
        if any(not key or value < 0 for key, value in values.items()):
            raise ValueError("benchmark_manifest_slice_count_invalid")
        return values

    @model_validator(mode="after")
    def reconcile(self) -> ExportManifest:
        if self.export_timestamp.tzinfo is None or self.projection_reconciled_at.tzinfo is None:
            raise ValueError("benchmark_manifest_timezone_missing")
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as error:
            raise ValueError("benchmark_manifest_timezone_invalid") from error
        try:
            period_start = date.fromisoformat(self.period_start)
            period_end = date.fromisoformat(self.period_end)
        except ValueError as error:
            raise ValueError("benchmark_manifest_period_invalid") from error
        if period_start > period_end:
            raise ValueError("benchmark_manifest_period_invalid")
        excluded = sum(self.excluded_by_reason.values())
        if self.denominator != self.exported + excluded:
            raise ValueError("benchmark_denominator_does_not_reconcile")
        if self.protected_state_digest_before != self.protected_state_digest_after:
            raise ValueError("benchmark_protected_state_changed")
        return self


def require_digest(value: str) -> str:
    if (
        len(value) != 71
        or not value.startswith("sha256:")
        or any(character not in "0123456789abcdef" for character in value[7:])
    ):
        raise ValueError("benchmark_digest_invalid")
    return value
