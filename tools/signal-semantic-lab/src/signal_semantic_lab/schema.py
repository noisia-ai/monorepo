from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
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


class PartitionMembershipV2(BaseModel):
    """One governed Acquisition slot membership for a physical canonical root."""

    model_config = ConfigDict(extra="forbid")

    partition_key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,119}$")
    scope: Literal["primary_brand", "competitor", "category", "reference"]
    entity_ref: Digest
    declared_market: str = Field(pattern=r"^[A-Z]{2}$")
    plan_version: int = Field(ge=1)
    plan_digest: Digest
    slot_key: str = Field(min_length=1, max_length=160)
    slot_digest: Digest
    provenance_digest: Digest
    authority_digest: Digest
    authority_valid_until: datetime | None = None

    @field_validator(
        "entity_ref",
        "plan_digest",
        "slot_digest",
        "provenance_digest",
        "authority_digest",
    )
    @classmethod
    def membership_digests(cls, value: str) -> str:
        return require_digest(value)

    @field_validator("authority_valid_until")
    @classmethod
    def membership_expiry_is_aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("benchmark_partition_authority_timezone_missing")
        return value


class BenchmarkRecordV2(BaseModel):
    """Multi-scope benchmark grain: one row per physical canonical root."""

    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-semantic-benchmark-record-v2"]
    record_key: Digest
    canonical_family_key: Digest
    canonical_alias_count: int = Field(ge=0)
    content_hash: Digest
    text: str = Field(min_length=1)
    published_at: datetime
    month: str
    language: str
    country: str
    platform: str
    partition_memberships: list[PartitionMembershipV2] = Field(min_length=1)
    quality_disposition: Literal["included"]
    authority_usage: Literal["strategic-analysis"]
    authority_digest: Digest

    @field_validator(
        "record_key",
        "canonical_family_key",
        "content_hash",
        "authority_digest",
    )
    @classmethod
    def record_v2_digests(cls, value: str) -> str:
        return require_digest(value)

    @field_validator("published_at")
    @classmethod
    def record_v2_timestamp_is_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("benchmark_record_timezone_missing")
        return value

    @model_validator(mode="after")
    def record_v2_shape(self) -> BenchmarkRecordV2:
        if self.month != self.published_at.strftime("%Y-%m"):
            raise ValueError("benchmark_record_month_mismatch")
        if not self.language.strip() or not self.country.strip() or not self.platform.strip():
            raise ValueError("benchmark_record_slice_empty")
        partition_keys = [membership.partition_key for membership in self.partition_memberships]
        if len(partition_keys) != len(set(partition_keys)):
            raise ValueError("benchmark_record_partition_duplicate")
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


class PartitionManifestV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Literal["primary_brand", "competitor", "category", "reference"]
    entity_ref: Digest
    declared_market: str = Field(pattern=r"^[A-Z]{2}$")
    total: int = Field(ge=0)
    included: int = Field(ge=0)
    excluded: int = Field(ge=0)
    population_digest: Digest
    modeling_digest: Digest
    plan_version: int = Field(ge=1)
    plan_digest: Digest
    slot_digest: Digest

    @field_validator(
        "entity_ref",
        "population_digest",
        "modeling_digest",
        "plan_digest",
        "slot_digest",
    )
    @classmethod
    def partition_manifest_digests(cls, value: str) -> str:
        return require_digest(value)

    @model_validator(mode="after")
    def partition_reconciles(self) -> PartitionManifestV2:
        if self.total != self.included + self.excluded:
            raise ValueError("benchmark_partition_denominator_does_not_reconcile")
        return self


class ExportManifestV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-semantic-benchmark-export-v2"]
    target: Literal["noisia-staging", "local-fixture"]
    read_only: Literal[True]
    writes_performed: Literal[False]
    provider_calls: Literal[0]
    jobs_enqueued: Literal[0]
    serving_writes: Literal[0]
    workspace_ref: Digest
    corpus_identity: str = Field(min_length=1, max_length=200)
    export_timestamp: datetime
    period_start: str
    period_end: str
    timezone: str
    population_digest: Digest
    content_digest: Digest
    provenance_digest: Digest
    watermark_digest: Digest
    authority_digest: Digest
    exporter_source_digest: Digest
    export_records_digest: Digest
    schema_version: Literal["signal-semantic-benchmark-record-v2"]
    acquisition_denominator: int = Field(ge=0)
    modeling_population: int = Field(ge=0)
    quality_excluded_roots: int = Field(ge=0)
    exported: int = Field(ge=0)
    excluded_by_reason: dict[str, int]
    partitions: dict[str, PartitionManifestV2] = Field(min_length=1)
    language_counts: dict[str, int]
    country_counts: dict[str, int]
    platform_counts: dict[str, int]
    declared_market_membership_counts: dict[str, int]
    shared_root_count: int = Field(ge=0)
    required_usage: Literal["strategic-analysis"]
    licensing_evaluation: Literal["allowed"]
    retention_evaluation: Literal["current"]
    quality_evaluation: Literal["current"]
    exclusion_contract: Literal["acquisition-quality-exclusive-v2"]
    protected_state_digest_before: Digest
    protected_state_digest_after: Digest
    transaction_read_only: Literal[True]
    transaction_id_assigned: Literal[False]
    export_file_sha256: Digest

    @field_validator(
        "workspace_ref",
        "population_digest",
        "content_digest",
        "provenance_digest",
        "watermark_digest",
        "authority_digest",
        "exporter_source_digest",
        "export_records_digest",
        "protected_state_digest_before",
        "protected_state_digest_after",
        "export_file_sha256",
    )
    @classmethod
    def export_v2_digests(cls, value: str) -> str:
        return require_digest(value)

    @field_validator(
        "excluded_by_reason",
        "language_counts",
        "country_counts",
        "platform_counts",
        "declared_market_membership_counts",
    )
    @classmethod
    def export_v2_nonnegative_counts(cls, values: dict[str, int]) -> dict[str, int]:
        if any(not key or value < 0 for key, value in values.items()):
            raise ValueError("benchmark_manifest_slice_count_invalid")
        return values

    @model_validator(mode="after")
    def export_v2_reconciles(self) -> ExportManifestV2:
        if self.export_timestamp.tzinfo is None:
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
        if self.acquisition_denominator != self.modeling_population + self.quality_excluded_roots:
            raise ValueError("benchmark_denominator_does_not_reconcile")
        if self.exported != self.modeling_population:
            raise ValueError("benchmark_export_modeling_population_mismatch")
        if self.excluded_by_reason != {"quality_excluded": self.quality_excluded_roots}:
            raise ValueError("benchmark_export_exclusion_contract_mismatch")
        if self.protected_state_digest_before != self.protected_state_digest_after:
            raise ValueError("benchmark_protected_state_changed")
        if any(
            partition.included <= 0 or partition.total <= 0
            for partition in self.partitions.values()
        ):
            raise ValueError("benchmark_required_partition_empty")
        return self


AnyBenchmarkRecord = Annotated[
    BenchmarkRecord | BenchmarkRecordV2,
    Field(discriminator="contract_version"),
]
AnyExportManifest = Annotated[
    ExportManifest | ExportManifestV2,
    Field(discriminator="contract_version"),
]


def require_digest(value: str) -> str:
    if (
        len(value) != 71
        or not value.startswith("sha256:")
        or any(character not in "0123456789abcdef" for character in value[7:])
    ):
        raise ValueError("benchmark_digest_invalid")
    return value
