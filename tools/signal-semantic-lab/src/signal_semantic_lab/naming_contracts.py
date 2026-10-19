from __future__ import annotations

from datetime import datetime
from math import ceil
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .canonical import canonical_json, sha256_text
from .context import GovernedAnalysisContextSnapshotV1
from .schema import require_digest


class RepresentativeEvidenceV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_ref: str
    role: Literal["medoid", "diversity", "boundary", "counterexample"]
    selection_reason: str
    excerpt: str = Field(min_length=1, max_length=800)
    language: str
    scope: str
    source_slice: str
    time_slice: str
    rights_digest: str

    @field_validator("evidence_ref", "rights_digest")
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

class SealedRepresentativePacketV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-sealed-representative-packet-v1"]
    run_key: str
    cluster_key: str
    cluster_content_digest: str
    packet_policy_version: str
    packet_policy_digest: str
    cluster_member_count: int = Field(ge=1)
    count_scope: Literal["full_population", "calibration_subset"]
    population_denominator: int = Field(ge=1)
    stability: dict[str, float | int | str | None] | None
    outlier_information: dict[str, int | float | str | None]
    local_terms: list[str]
    local_phrases: list[str]
    distributions: dict[str, dict[str, int]]
    distribution_contracts: dict[str, str]
    neighboring_clusters: list[dict[str, str | float]]
    representatives: list[RepresentativeEvidenceV1] = Field(min_length=1, max_length=8)
    excerpt_character_count: int = Field(ge=1)
    estimated_tokens: int = Field(ge=1)
    coverage: dict[str, int | float | str | None]
    limitations: list[str]
    packet_digest: str

    @field_validator(
        "run_key", "cluster_key", "cluster_content_digest", "packet_policy_digest", "packet_digest"
    )
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @model_validator(mode="after")
    def distribution_grains(self) -> SealedRepresentativePacketV1:
        expected = {
            "language": "exclusive_root_count",
            "scope": "nonexclusive_provenance_membership_count",
            "source": "exclusive_root_count",
            "subregion": "exclusive_root_count",
            "time": "exclusive_root_count",
        }
        if self.distribution_contracts != expected:
            raise ValueError("benchmark_packet_distribution_contract_invalid")
        body = self.model_dump(mode="json", exclude={"packet_digest"})
        if self.packet_digest != sha256_text(canonical_json(body)):
            raise ValueError("benchmark_packet_digest_mismatch")
        return self


class GovernedContextSourceV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal[
        "brand_os",
        "study_os",
        "acquisition_plan",
        "knowledge_base",
        "methodology",
        "cluster_packet",
        "taxonomy_contract",
    ]
    source_version: str = Field(min_length=1)
    reference_digest: str
    content_digest: str
    relevance_reason: str
    rights_usage: Literal["llm-processing", "internal-context"]
    provider_transmission_authorized: bool
    rights_evaluation_digest: str
    privacy_evaluation_digest: str
    pii_redaction_state: Literal["passed", "not_available"]
    rights_evaluated_at: datetime
    rights_valid_until: datetime | None
    token_count: int = Field(ge=0)

    @field_validator(
        "reference_digest",
        "content_digest",
        "rights_evaluation_digest",
        "privacy_evaluation_digest",
    )
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @model_validator(mode="after")
    def temporal_rights(self) -> GovernedContextSourceV1:
        if self.rights_evaluated_at.tzinfo is None or (
            self.rights_valid_until is not None and self.rights_valid_until.tzinfo is None
        ):
            raise ValueError("benchmark_context_source_rights_timezone_missing")
        if (
            self.rights_valid_until is not None
            and self.rights_valid_until <= self.rights_evaluated_at
        ):
            raise ValueError("benchmark_context_source_rights_expired_at_evaluation")
        return self


class GovernedContextEnvelopeV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-governed-context-envelope-v1"]
    task: Literal["topic-contract-proposal"]
    study_context_state: Literal["included", "not_applicable"]
    created_at: datetime
    workspace_ref: str
    analysis_context_digest: str
    cluster_packet_digest: str
    retrieval_policy_version: str
    retrieval_policy_digest: str
    locale_context_digest: str
    analysis_source_digests: dict[str, str]
    sources: list[GovernedContextSourceV1] = Field(min_length=4)
    total_tokens: int = Field(ge=0)
    maximum_tokens: int = Field(ge=1)
    provider_excerpt_authorized: bool
    limitations: list[str]
    envelope_digest: str

    @field_validator(
        "workspace_ref",
        "analysis_context_digest",
        "cluster_packet_digest",
        "retrieval_policy_digest",
        "locale_context_digest",
        "envelope_digest",
    )
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @model_validator(mode="after")
    def rights_and_budget(self) -> GovernedContextEnvelopeV1:
        if self.created_at.tzinfo is None:
            raise ValueError("benchmark_context_envelope_timezone_missing")
        if any(
            source.rights_evaluated_at > self.created_at
            or (
                source.rights_valid_until is not None
                and source.rights_valid_until <= self.created_at
            )
            for source in self.sources
        ):
            raise ValueError("benchmark_context_envelope_rights_not_current")
        if self.total_tokens != sum(source.token_count for source in self.sources):
            raise ValueError("benchmark_context_envelope_token_reconciliation_failed")
        if self.total_tokens > self.maximum_tokens:
            raise ValueError("benchmark_context_envelope_token_budget_exceeded")
        if not all(source.provider_transmission_authorized for source in self.sources):
            raise ValueError("benchmark_context_envelope_source_transmission_unauthorized")
        if not all(source.pii_redaction_state == "passed" for source in self.sources):
            raise ValueError("benchmark_context_envelope_privacy_evaluation_unavailable")
        cluster_sources = [source for source in self.sources if source.kind == "cluster_packet"]
        if len(cluster_sources) != 1:
            raise ValueError("benchmark_context_envelope_cluster_packet_invalid")
        required = {
            "brand_os",
            "acquisition_plan",
            "knowledge_base",
            "methodology",
            "cluster_packet",
        }
        observed = {source.kind for source in self.sources}
        if not required <= observed:
            raise ValueError("benchmark_context_envelope_required_source_missing")
        singleton_kinds = required | {"study_os"}
        if any(
            sum(source.kind == kind for source in self.sources) > 1
            for kind in singleton_kinds
        ):
            raise ValueError("benchmark_context_envelope_source_duplicate")
        study_count = sum(source.kind == "study_os" for source in self.sources)
        if (self.study_context_state == "included" and study_count != 1) or (
            self.study_context_state == "not_applicable" and study_count != 0
        ):
            raise ValueError("benchmark_context_envelope_study_source_mismatch")
        if cluster_sources[0].content_digest != self.cluster_packet_digest:
            raise ValueError("benchmark_context_envelope_cluster_digest_mismatch")
        expected_keys = {
            "brand_os",
            "study_os",
            "acquisition_plan",
            "knowledge_base",
            "methodology",
        }
        if set(self.analysis_source_digests) != expected_keys:
            raise ValueError("benchmark_context_envelope_source_digest_map_invalid")
        for kind, digest in self.analysis_source_digests.items():
            if kind == "study_os" and digest == "not_applicable":
                continue
            require_digest(digest)
            matches = [source for source in self.sources if source.kind == kind]
            if len(matches) != 1 or matches[0].content_digest != digest:
                raise ValueError("benchmark_context_envelope_source_digest_mismatch")
        if (
            self.study_context_state == "not_applicable"
            and self.analysis_source_digests["study_os"] != "not_applicable"
        ) or (
            self.study_context_state == "included"
            and self.analysis_source_digests["study_os"] == "not_applicable"
        ):
            raise ValueError("benchmark_context_envelope_study_digest_state_mismatch")
        if (
            not self.provider_excerpt_authorized
            or cluster_sources[0].rights_usage != "llm-processing"
        ):
            raise ValueError("benchmark_context_envelope_llm_rights_unavailable")
        body = self.model_dump(mode="json", exclude={"envelope_digest"})
        if self.envelope_digest != sha256_text(canonical_json(body)):
            raise ValueError("benchmark_context_envelope_digest_mismatch")
        return self


class ClosedClaudeTopicProposalV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-closed-claude-topic-proposal-v1"]
    proposed_display_name: str = Field(min_length=1, max_length=120)
    definition: str = Field(min_length=1, max_length=1_000)
    inclusion_summary: str = Field(min_length=1, max_length=1_000)
    exclusion_summary: str = Field(min_length=1, max_length=1_000)
    evidence_refs: list[str] = Field(min_length=1, max_length=16)
    merge_candidate: bool
    split_candidate: bool
    too_broad: bool
    too_thin: bool
    positive_example_refs: list[str] = Field(max_length=8)
    negative_example_refs: list[str] = Field(max_length=8)
    insufficient_evidence: bool
    narrative_hypothesis: str | None = Field(default=None, max_length=1_000)
    narrative_hypothesis_state: Literal["not_proposed", "unapproved_hypothesis"]

    @field_validator("evidence_refs", "positive_example_refs", "negative_example_refs")
    @classmethod
    def references(cls, values: list[str]) -> list[str]:
        return [require_digest(value) for value in values]

    @model_validator(mode="after")
    def narrative_is_never_approved(self) -> ClosedClaudeTopicProposalV1:
        if (self.narrative_hypothesis is None) != (
            self.narrative_hypothesis_state == "not_proposed"
        ):
            raise ValueError("benchmark_topic_proposal_narrative_state_invalid")
        return self


class ContextualNamingProposalRecordV1(BaseModel):
    """Future append-only proposal envelope; this benchmark never persists or approves it."""

    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-contextual-naming-proposal-record-v1"]
    proposal_key: str
    proposal_version: int = Field(ge=1)
    state: Literal["draft"]
    generation_mode: Literal["offline_contract_fixture", "provider"]
    workspace_ref: str
    cluster_content_digest: str
    packet_digest: str
    context_envelope_digest: str
    brand_os_digest: str
    study_os_digest: str | Literal["not_applicable"]
    acquisition_plan_digest: str
    knowledge_context_digest: str
    methodology_context_digest: str
    locale_context_digest: str
    retrieval_policy_version: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    prompt_digest: str
    pricing_version: str = Field(min_length=1)
    cache_key: str
    proposal: ClosedClaudeTopicProposalV1
    generated_at: datetime
    supersedes_proposal_key: str | None = None
    record_digest: str

    @field_validator(
        "proposal_key",
        "workspace_ref",
        "cluster_content_digest",
        "packet_digest",
        "context_envelope_digest",
        "brand_os_digest",
        "acquisition_plan_digest",
        "knowledge_context_digest",
        "methodology_context_digest",
        "locale_context_digest",
        "prompt_digest",
        "cache_key",
        "record_digest",
    )
    @classmethod
    def digests(cls, value: str) -> str:
        return require_digest(value)

    @field_validator("study_os_digest")
    @classmethod
    def study_digest(cls, value: str) -> str:
        return value if value == "not_applicable" else require_digest(value)

    @field_validator("supersedes_proposal_key")
    @classmethod
    def supersedes_digest(cls, value: str | None) -> str | None:
        return require_digest(value) if value is not None else None

    @model_validator(mode="after")
    def sealed_digest(self) -> ContextualNamingProposalRecordV1:
        body = self.model_dump(mode="json", exclude={"record_digest"})
        if self.record_digest != sha256_text(canonical_json(body)):
            raise ValueError("benchmark_topic_proposal_record_digest_mismatch")
        return self


class NamingCostSimulationV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["signal-contextual-naming-cost-simulation-v1"]
    model_version: str = Field(min_length=1)
    pricing_version: str = Field(min_length=1)
    cluster_count: int = Field(ge=0)
    pass_one_batches: int = Field(ge=0)
    pass_two_cluster_calls: int = Field(ge=0)
    maximum_calls: int = Field(ge=0)
    input_token_upper_bound: int = Field(ge=0)
    output_token_upper_bound: int = Field(ge=0)
    input_micro_usd_per_token: int = Field(ge=0)
    output_micro_usd_per_token: int = Field(ge=0)
    estimated_max_micro_usd: int = Field(ge=0)
    hard_cap_micro_usd: int = Field(ge=0)
    within_hard_cap: bool
    provider_calls: Literal[0]
    writes_performed: Literal[False]


def build_governed_context_envelope_v1(
    *,
    workspace_ref: str,
    study_context_state: Literal["included", "not_applicable"],
    created_at: datetime,
    analysis_context: GovernedAnalysisContextSnapshotV1,
    cluster_packet_digest: str,
    retrieval_policy_version: str,
    retrieval_policy_digest: str,
    sources: list[GovernedContextSourceV1],
    maximum_tokens: int,
    provider_excerpt_authorized: bool,
    limitations: list[str],
) -> GovernedContextEnvelopeV1:
    study_digest = (
        analysis_context.study_context.digest
        if analysis_context.study_context != "not_applicable"
        else "not_applicable"
    )
    analysis_source_digests = {
        "brand_os": analysis_context.brand_os.profile_digest,
        "study_os": study_digest,
        "acquisition_plan": analysis_context.acquisition_plan.plan_digest,
        "knowledge_base": analysis_context.knowledge_context_digest,
        "methodology": analysis_context.methodology_context_digest,
    }
    body = {
        "contract_version": "signal-governed-context-envelope-v1",
        "task": "topic-contract-proposal",
        "study_context_state": study_context_state,
        "created_at": created_at.isoformat(),
        "workspace_ref": require_digest(workspace_ref),
        "analysis_context_digest": analysis_context.snapshot_digest,
        "cluster_packet_digest": require_digest(cluster_packet_digest),
        "retrieval_policy_version": retrieval_policy_version,
        "retrieval_policy_digest": require_digest(retrieval_policy_digest),
        "locale_context_digest": analysis_context.locale_context.digest,
        "analysis_source_digests": analysis_source_digests,
        "sources": [source.model_dump(mode="json") for source in sources],
        "total_tokens": sum(source.token_count for source in sources),
        "maximum_tokens": maximum_tokens,
        "provider_excerpt_authorized": provider_excerpt_authorized,
        "limitations": limitations,
    }
    return GovernedContextEnvelopeV1.model_validate(
        {
            **body,
            "envelope_digest": sha256_text(canonical_json(body)),
        }
    )


def validate_closed_proposal_v1(
    proposal: ClosedClaudeTopicProposalV1,
    packet: SealedRepresentativePacketV1,
) -> ClosedClaudeTopicProposalV1:
    allowed = {item.evidence_ref for item in packet.representatives}
    referenced = set(
        proposal.evidence_refs + proposal.positive_example_refs + proposal.negative_example_refs
    )
    if not referenced <= allowed:
        raise ValueError("benchmark_topic_proposal_evidence_outside_packet")
    if proposal.insufficient_evidence and not (proposal.too_broad or proposal.too_thin):
        raise ValueError("benchmark_topic_proposal_insufficient_evidence_unexplained")
    return proposal


def proposal_cache_key_v1(
    *,
    cluster_content_digest: str,
    packet_digest: str,
    context_envelope_digest: str,
    retrieval_policy_version: str,
    model_version: str,
    prompt_digest: str,
) -> str:
    return sha256_text(
        canonical_json(
            {
                "cluster_content_digest": require_digest(cluster_content_digest),
                "packet_digest": require_digest(packet_digest),
                "context_envelope_digest": require_digest(context_envelope_digest),
                "retrieval_policy_version": retrieval_policy_version,
                "model_version": model_version,
                "prompt_digest": require_digest(prompt_digest),
            }
        )
    )


def build_contextual_naming_proposal_record_v1(
    *,
    proposal_version: int,
    generation_mode: Literal["offline_contract_fixture", "provider"],
    workspace_ref: str,
    cluster_content_digest: str,
    packet_digest: str,
    context_envelope_digest: str,
    brand_os_digest: str,
    study_os_digest: str | Literal["not_applicable"],
    acquisition_plan_digest: str,
    knowledge_context_digest: str,
    methodology_context_digest: str,
    locale_context_digest: str,
    retrieval_policy_version: str,
    model_version: str,
    prompt_digest: str,
    pricing_version: str,
    cache_key: str,
    proposal: ClosedClaudeTopicProposalV1,
    generated_at: datetime,
    supersedes_proposal_key: str | None = None,
) -> ContextualNamingProposalRecordV1:
    proposal_key = sha256_text(
        canonical_json(
            {
                "cluster_content_digest": require_digest(cluster_content_digest),
                "proposal_version": proposal_version,
                "cache_key": require_digest(cache_key),
            }
        )
    )
    body = {
        "contract_version": "signal-contextual-naming-proposal-record-v1",
        "proposal_key": proposal_key,
        "proposal_version": proposal_version,
        "state": "draft",
        "generation_mode": generation_mode,
        "workspace_ref": require_digest(workspace_ref),
        "cluster_content_digest": require_digest(cluster_content_digest),
        "packet_digest": require_digest(packet_digest),
        "context_envelope_digest": require_digest(context_envelope_digest),
        "brand_os_digest": require_digest(brand_os_digest),
        "study_os_digest": (
            study_os_digest
            if study_os_digest == "not_applicable"
            else require_digest(study_os_digest)
        ),
        "acquisition_plan_digest": require_digest(acquisition_plan_digest),
        "knowledge_context_digest": require_digest(knowledge_context_digest),
        "methodology_context_digest": require_digest(methodology_context_digest),
        "locale_context_digest": require_digest(locale_context_digest),
        "retrieval_policy_version": retrieval_policy_version,
        "model_version": model_version,
        "prompt_digest": require_digest(prompt_digest),
        "pricing_version": pricing_version,
        "cache_key": require_digest(cache_key),
        "proposal": proposal.model_dump(mode="json"),
        "generated_at": generated_at.isoformat(),
        "supersedes_proposal_key": (
            require_digest(supersedes_proposal_key)
            if supersedes_proposal_key is not None
            else None
        ),
    }
    return ContextualNamingProposalRecordV1.model_validate(
        {**body, "record_digest": sha256_text(canonical_json(body))}
    )


def simulate_contextual_naming_cost_v1(
    *,
    model_version: str,
    pricing_version: str,
    cluster_count: int,
    pass_one_batch_size: int,
    pass_one_input_tokens_per_cluster: int,
    pass_one_output_tokens_per_cluster: int,
    pass_two_input_tokens_per_cluster: int,
    pass_two_output_tokens_per_cluster: int,
    input_micro_usd_per_token: int,
    output_micro_usd_per_token: int,
    hard_cap_micro_usd: int,
) -> NamingCostSimulationV1:
    if cluster_count < 0 or pass_one_batch_size < 1:
        raise ValueError("benchmark_naming_cost_input_invalid")
    values = [
        pass_one_input_tokens_per_cluster,
        pass_one_output_tokens_per_cluster,
        pass_two_input_tokens_per_cluster,
        pass_two_output_tokens_per_cluster,
        input_micro_usd_per_token,
        output_micro_usd_per_token,
        hard_cap_micro_usd,
    ]
    if any(value < 0 for value in values):
        raise ValueError("benchmark_naming_cost_input_invalid")
    pass_one_batches = ceil(cluster_count / pass_one_batch_size) if cluster_count else 0
    maximum_calls = pass_one_batches + cluster_count
    input_tokens = cluster_count * (
        pass_one_input_tokens_per_cluster + pass_two_input_tokens_per_cluster
    )
    output_tokens = cluster_count * (
        pass_one_output_tokens_per_cluster + pass_two_output_tokens_per_cluster
    )
    maximum_micro_usd = (
        input_tokens * input_micro_usd_per_token + output_tokens * output_micro_usd_per_token
    )
    return NamingCostSimulationV1(
        contract_version="signal-contextual-naming-cost-simulation-v1",
        model_version=model_version,
        pricing_version=pricing_version,
        cluster_count=cluster_count,
        pass_one_batches=pass_one_batches,
        pass_two_cluster_calls=cluster_count,
        maximum_calls=maximum_calls,
        input_token_upper_bound=input_tokens,
        output_token_upper_bound=output_tokens,
        input_micro_usd_per_token=input_micro_usd_per_token,
        output_micro_usd_per_token=output_micro_usd_per_token,
        estimated_max_micro_usd=maximum_micro_usd,
        hard_cap_micro_usd=hard_cap_micro_usd,
        within_hard_cap=maximum_micro_usd <= hard_cap_micro_usd,
        provider_calls=0,
        writes_performed=False,
    )
