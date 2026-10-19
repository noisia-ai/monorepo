from __future__ import annotations

from datetime import date
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .canonical import canonical_json, sha256_text
from .schema import require_digest

LocaleReadiness = Literal["ready", "requires_operator_decision"]


class BrandOsContextV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-brand-os-analysis-context-v1"]
    profile_version: int = Field(ge=1)
    profile_digest: str
    identity_catalog_digest: str
    primary_identity: str
    aliases: list[str]
    category: str | None
    products: list[str]
    competitors: list[str]
    markets: list[str]
    locale_tags: list[str]
    positioning: str | None
    approved_attribute_refs: list[str]

    @field_validator("profile_digest", "identity_catalog_digest")
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @field_validator("locale_tags")
    @classmethod
    def locales(cls, values: list[str]) -> list[str]:
        if any(not _is_bcp47_locale(value) for value in values):
            raise ValueError("benchmark_brand_locale_invalid")
        return values


class StudyOsContextV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-study-os-analysis-context-v1"]
    reference_hash: str
    digest: str
    objective: str
    research_questions: list[str]
    methodology: str
    audience: str | None
    period_start: date
    period_end: date
    scopes: list[str]
    output_locale: str | None
    market: str | None

    @field_validator("reference_hash", "digest")
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @model_validator(mode="after")
    def period(self) -> StudyOsContextV1:
        if self.period_start > self.period_end:
            raise ValueError("benchmark_study_period_invalid")
        return self


class AcquisitionSlotContextV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slot_key: str
    scope: Literal["primary_brand", "category", "competitor", "reference"]
    entity_ref: str
    slot_digest: str
    query_digest: str
    import_provenance_digest: str

    @field_validator("entity_ref", "slot_digest", "query_digest", "import_provenance_digest")
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)


class AcquisitionContextV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-acquisition-analysis-context-v1"]
    plan_version: int = Field(ge=1)
    plan_digest: str
    identity_catalog_digest: str
    period_start: date
    period_end: date
    timezone: str
    slots: list[AcquisitionSlotContextV1] = Field(min_length=1)

    @field_validator("plan_digest", "identity_catalog_digest")
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @model_validator(mode="after")
    def envelope(self) -> AcquisitionContextV1:
        if self.period_start > self.period_end:
            raise ValueError("benchmark_acquisition_period_invalid")
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as error:
            raise ValueError("benchmark_acquisition_timezone_invalid") from error
        if len({slot.slot_key for slot in self.slots}) != len(self.slots):
            raise ValueError("benchmark_acquisition_slot_key_duplicate")
        return self


class WorkspaceLocaleFallbackV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-workspace-locale-fallback-v1"]
    digest: str
    explicit_locale: str | None
    explicit_market: str | None
    timezone: str

    @field_validator("digest")
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)


class LocaleContextV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-locale-context-v1"]
    readiness: LocaleReadiness
    primary_language: str | None
    country_market: str | None
    language_variant: str | None
    secondary_languages: list[str]
    code_switching_expected: bool | None
    timezone: str
    source_authority: dict[str, str]
    blockers: list[str]
    digest: str

    @field_validator("digest")
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @model_validator(mode="after")
    def sealed_digest(self) -> LocaleContextV1:
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as error:
            raise ValueError("benchmark_locale_context_timezone_invalid") from error
        if (self.readiness == "ready") != (not self.blockers):
            raise ValueError("benchmark_locale_context_readiness_mismatch")
        if self.readiness == "ready" and (
            self.primary_language is None
            or self.country_market is None
            or self.language_variant is None
        ):
            raise ValueError("benchmark_locale_context_ready_fields_missing")
        if self.language_variant is not None and (
            not _is_bcp47_locale(self.language_variant)
            or self.primary_language != _language_family(self.language_variant)
        ):
            raise ValueError("benchmark_locale_context_language_mismatch")
        body = self.model_dump(mode="json", exclude={"digest"})
        if self.digest != sha256_text(canonical_json(body)):
            raise ValueError("benchmark_locale_context_digest_mismatch")
        return self


class GovernedAnalysisContextSnapshotV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-governed-analysis-context-snapshot-v1"]
    run_scope: Literal["signal_always_on", "study"]
    brand_os: BrandOsContextV1
    study_context: StudyOsContextV1 | Literal["not_applicable"]
    acquisition_plan: AcquisitionContextV1
    locale_context: LocaleContextV1
    knowledge_context_digest: str
    methodology_context_digest: str
    source_digests: dict[str, str]
    snapshot_digest: str

    @field_validator("knowledge_context_digest", "methodology_context_digest", "snapshot_digest")
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @model_validator(mode="after")
    def sealed_digest(self) -> GovernedAnalysisContextSnapshotV1:
        if self.brand_os.identity_catalog_digest != self.acquisition_plan.identity_catalog_digest:
            raise ValueError("benchmark_analysis_context_identity_catalog_drift")
        if (self.run_scope == "study") != (self.study_context != "not_applicable"):
            raise ValueError("benchmark_analysis_context_study_state_mismatch")
        if self.study_context != "not_applicable":
            acquisition_scopes = {slot.scope for slot in self.acquisition_plan.slots}
            if not set(self.study_context.scopes) <= acquisition_scopes:
                raise ValueError("benchmark_study_scope_outside_acquisition_plan")
            if (
                self.study_context.period_start < self.acquisition_plan.period_start
                or self.study_context.period_end > self.acquisition_plan.period_end
            ):
                raise ValueError("benchmark_study_period_outside_acquisition_plan")
        body = self.model_dump(mode="json", exclude={"snapshot_digest"})
        if self.snapshot_digest != sha256_text(canonical_json(body)):
            raise ValueError("benchmark_analysis_context_snapshot_digest_mismatch")
        return self


def resolve_governed_analysis_context_v1(
    *,
    run_scope: Literal["signal_always_on", "study"],
    brand_os: BrandOsContextV1,
    study_context: StudyOsContextV1 | None,
    acquisition: AcquisitionContextV1,
    workspace_fallback: WorkspaceLocaleFallbackV1,
    knowledge_context_digest: str,
    methodology_context_digest: str,
) -> GovernedAnalysisContextSnapshotV1:
    require_digest(knowledge_context_digest)
    require_digest(methodology_context_digest)
    if run_scope == "study" and study_context is None:
        raise ValueError("benchmark_study_context_required")
    if run_scope == "signal_always_on" and study_context is not None:
        raise ValueError("benchmark_study_context_must_be_not_applicable")
    if brand_os.identity_catalog_digest != acquisition.identity_catalog_digest:
        raise ValueError("benchmark_analysis_context_identity_catalog_drift")
    if study_context is not None:
        acquisition_scopes = {slot.scope for slot in acquisition.slots}
        if not set(study_context.scopes) <= acquisition_scopes:
            raise ValueError("benchmark_study_scope_outside_acquisition_plan")
        if (
            study_context.period_start < acquisition.period_start
            or study_context.period_end > acquisition.period_end
        ):
            raise ValueError("benchmark_study_period_outside_acquisition_plan")

    locale = _resolve_locale(
        run_scope=run_scope,
        brand_os=brand_os,
        study_context=study_context,
        acquisition=acquisition,
        workspace_fallback=workspace_fallback,
    )
    source_digests = {
        "acquisition_plan": acquisition.plan_digest,
        "brand_os": brand_os.profile_digest,
        "identity_catalog": brand_os.identity_catalog_digest,
        "knowledge": knowledge_context_digest,
        "methodology": methodology_context_digest,
        "study_os": study_context.digest if study_context else "not_applicable",
        "workspace_fallback": workspace_fallback.digest,
    }
    payload = {
        "contract_version": "signal-governed-analysis-context-snapshot-v1",
        "run_scope": run_scope,
        "brand_os": brand_os.model_dump(mode="json"),
        "study_context": study_context.model_dump(mode="json")
        if study_context
        else "not_applicable",
        "acquisition_plan": acquisition.model_dump(mode="json"),
        "locale_context": locale.model_dump(mode="json"),
        "knowledge_context_digest": knowledge_context_digest,
        "methodology_context_digest": methodology_context_digest,
        "source_digests": source_digests,
    }
    return GovernedAnalysisContextSnapshotV1.model_validate(
        {
            **payload,
            "snapshot_digest": sha256_text(canonical_json(payload)),
        }
    )


def _resolve_locale(
    *,
    run_scope: Literal["signal_always_on", "study"],
    brand_os: BrandOsContextV1,
    study_context: StudyOsContextV1 | None,
    acquisition: AcquisitionContextV1,
    workspace_fallback: WorkspaceLocaleFallbackV1,
) -> LocaleContextV1:
    blockers: list[str] = []
    source: dict[str, str] = {"timezone": "acquisition_plan"}
    locale_tag: str | None = None
    market: str | None = None
    secondary: list[str] = []

    if run_scope == "study" and study_context:
        locale_tag = study_context.output_locale
        market = study_context.market
        if locale_tag:
            source["language_variant"] = "study_os"
        if market:
            source["country_market"] = "study_os"

    if locale_tag is None and brand_os.locale_tags:
        locale_tag = brand_os.locale_tags[0]
        secondary = brand_os.locale_tags[1:]
        source["language_variant"] = "brand_os"
        source["secondary_languages"] = "brand_os"
    if market is None and brand_os.markets:
        market = brand_os.markets[0]
        source["country_market"] = "brand_os"

    if locale_tag is None and workspace_fallback.explicit_locale:
        locale_tag = workspace_fallback.explicit_locale
        source["language_variant"] = "workspace_explicit_fallback"
    if market is None and workspace_fallback.explicit_market:
        market = workspace_fallback.explicit_market
        source["country_market"] = "workspace_explicit_fallback"

    language = _language_family(locale_tag) if locale_tag else None
    if locale_tag is None:
        blockers.append("locale_variant_requires_operator_decision")
    if market is None:
        blockers.append("market_requires_operator_decision")
    if locale_tag and not _is_bcp47_locale(locale_tag):
        blockers.append("locale_variant_requires_operator_decision")
        locale_tag = None
        language = None
    if locale_tag and market and len(market) == 2:
        locale_region = locale_tag.split("-", 1)[1].upper()
        if locale_region != market.upper():
            blockers.append("locale_market_contradiction_requires_operator_decision")
    secondary = sorted({value for value in secondary if value != locale_tag})
    body = {
        "contract_version": "signal-locale-context-v1",
        "readiness": "ready" if not blockers else "requires_operator_decision",
        "primary_language": language,
        "country_market": market,
        "language_variant": locale_tag,
        "secondary_languages": secondary,
        "code_switching_expected": bool(secondary) if locale_tag else None,
        "timezone": acquisition.timezone,
        "source_authority": dict(sorted(source.items())),
        "blockers": sorted(set(blockers)),
    }
    return LocaleContextV1.model_validate(
        {
            **body,
            "digest": sha256_text(canonical_json(body)),
        }
    )


def _language_family(locale_tag: str) -> str:
    return locale_tag.split("-", 1)[0].lower()


def _is_bcp47_locale(value: str) -> bool:
    parts = value.split("-")
    return (
        len(parts) == 2
        and len(parts[0]) in {2, 3}
        and parts[0].isalpha()
        and len(parts[1]) == 2
        and parts[1].isalpha()
    )
