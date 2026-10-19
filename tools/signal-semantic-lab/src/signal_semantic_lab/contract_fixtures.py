from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any

from .canonical import canonical_json, sha256_text, write_private_json
from .context import (
    AcquisitionContextV1,
    AcquisitionSlotContextV1,
    BrandOsContextV1,
    StudyOsContextV1,
    WorkspaceLocaleFallbackV1,
    resolve_governed_analysis_context_v1,
)
from .naming_contracts import (
    ClosedClaudeTopicProposalV1,
    GovernedContextSourceV1,
    RepresentativeEvidenceV1,
    SealedRepresentativePacketV1,
    build_contextual_naming_proposal_record_v1,
    build_governed_context_envelope_v1,
    proposal_cache_key_v1,
    simulate_contextual_naming_cost_v1,
    validate_closed_proposal_v1,
)
from .review_packet import PACKET_POLICY, PACKET_POLICY_VERSION


def build_offline_contract_fixtures(output: Path) -> dict[str, Any]:
    """Write synthetic, provider-free fixtures for the future 10E contracts."""
    acquisition = _acquisition()
    always_on = resolve_governed_analysis_context_v1(
        run_scope="signal_always_on",
        brand_os=_brand(["es-MX", "en-US"], ["MX"]),
        study_context=None,
        acquisition=acquisition,
        workspace_fallback=_fallback(),
        knowledge_context_digest=_digest("knowledge"),
        methodology_context_digest=_digest("methodology"),
    )
    study = resolve_governed_analysis_context_v1(
        run_scope="study",
        brand_os=_brand(["es-MX"], ["MX"]),
        study_context=StudyOsContextV1(
            contract_version="signal-study-os-analysis-context-v1",
            reference_hash=_digest("study-ref"),
            digest=_digest("study"),
            objective="Understand a synthetic market",
            research_questions=["Which patterns are actionable?"],
            methodology="Social listening",
            audience="Operator",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 8, 1),
            scopes=["primary_brand"],
            output_locale="en-GB",
            market="GB",
        ),
        acquisition=acquisition,
        workspace_fallback=_fallback(),
        knowledge_context_digest=_digest("knowledge"),
        methodology_context_digest=_digest("methodology"),
    )
    unresolved = resolve_governed_analysis_context_v1(
        run_scope="signal_always_on",
        brand_os=_brand([], []),
        study_context=None,
        acquisition=acquisition,
        workspace_fallback=_fallback(),
        knowledge_context_digest=_digest("knowledge"),
        methodology_context_digest=_digest("methodology"),
    )
    packet = _packet()
    context_created_at = datetime.fromisoformat("2026-08-16T19:03:59-06:00")
    sources = [
        GovernedContextSourceV1(
            kind=kind,
            source_version=f"{kind}-fixture-v1",
            reference_digest=_digest(f"{kind}-reference"),
            content_digest={
                "brand_os": always_on.brand_os.profile_digest,
                "acquisition_plan": always_on.acquisition_plan.plan_digest,
                "knowledge_base": always_on.knowledge_context_digest,
                "methodology": always_on.methodology_context_digest,
                "cluster_packet": packet.packet_digest,
            }[kind],
            relevance_reason=reason,
            rights_usage="llm-processing" if kind == "cluster_packet" else "internal-context",
            provider_transmission_authorized=True,
            rights_evaluation_digest=_digest(f"{kind}-rights-evaluation"),
            privacy_evaluation_digest=_digest(f"{kind}-privacy-evaluation"),
            pii_redaction_state="passed",
            rights_evaluated_at=context_created_at,
            rights_valid_until=None,
            token_count=tokens,
        )
        for kind, reason, tokens in [
            ("brand_os", "Brand identity and locale are required for naming.", 180),
            ("acquisition_plan", "Scope and period delimit the cluster evidence.", 140),
            ("knowledge_base", "Approved terminology supports operator-safe definitions.", 120),
            ("methodology", "The naming task follows the governed topic methodology.", 100),
            ("cluster_packet", "The sealed packet is the only mention evidence.", 900),
        ]
    ]
    envelope = build_governed_context_envelope_v1(
        workspace_ref=_digest("workspace"),
        study_context_state="not_applicable",
        created_at=context_created_at,
        analysis_context=always_on,
        cluster_packet_digest=packet.packet_digest,
        retrieval_policy_version="signal-topic-naming-retrieval-v1",
        retrieval_policy_digest=_digest("retrieval"),
        sources=sources,
        maximum_tokens=2_000,
        provider_excerpt_authorized=True,
        limitations=["Synthetic fixture only; no provider call is authorized."],
    )
    study_envelope = build_governed_context_envelope_v1(
        workspace_ref=_digest("workspace"),
        study_context_state="included",
        created_at=context_created_at,
        analysis_context=study,
        cluster_packet_digest=packet.packet_digest,
        retrieval_policy_version="signal-topic-naming-retrieval-v1",
        retrieval_policy_digest=_digest("retrieval"),
        sources=[
            *sources,
            GovernedContextSourceV1(
                kind="study_os",
                source_version="study_os-fixture-v1",
                reference_digest=study.study_context.reference_hash,
                content_digest=study.study_context.digest,
                relevance_reason="The explicit study objective governs study-scoped naming.",
                rights_usage="internal-context",
                provider_transmission_authorized=True,
                rights_evaluation_digest=_digest("study_os-rights-evaluation"),
                privacy_evaluation_digest=_digest("study_os-privacy-evaluation"),
                pii_redaction_state="passed",
                rights_evaluated_at=context_created_at,
                rights_valid_until=None,
                token_count=160,
            ),
        ],
        maximum_tokens=2_000,
        provider_excerpt_authorized=True,
        limitations=["Synthetic study fixture only; no provider call is authorized."],
    )
    evidence_refs = [item.evidence_ref for item in packet.representatives]
    proposal = validate_closed_proposal_v1(
        ClosedClaudeTopicProposalV1(
            contract_version="signal-closed-claude-topic-proposal-v1",
            proposed_display_name="Experiencia de entrega",
            definition="Conversaciones sintéticas sobre la experiencia de entrega.",
            inclusion_summary="Incluye tiempos y cumplimiento de entrega.",
            exclusion_summary="Excluye precio cuando no se relaciona con entrega.",
            evidence_refs=evidence_refs,
            merge_candidate=False,
            split_candidate=False,
            too_broad=False,
            too_thin=False,
            positive_example_refs=evidence_refs[:1],
            negative_example_refs=evidence_refs[1:],
            insufficient_evidence=False,
            narrative_hypothesis=None,
            narrative_hypothesis_state="not_proposed",
        ),
        packet,
    )
    cache_key = proposal_cache_key_v1(
        cluster_content_digest=packet.cluster_content_digest,
        packet_digest=packet.packet_digest,
        context_envelope_digest=envelope.envelope_digest,
        retrieval_policy_version=envelope.retrieval_policy_version,
        model_version="future-pinned-model-placeholder-v1",
        prompt_digest=_digest("prompt"),
    )
    proposal_record = build_contextual_naming_proposal_record_v1(
        proposal_version=1,
        generation_mode="offline_contract_fixture",
        workspace_ref=envelope.workspace_ref,
        cluster_content_digest=packet.cluster_content_digest,
        packet_digest=packet.packet_digest,
        context_envelope_digest=envelope.envelope_digest,
        brand_os_digest=always_on.brand_os.profile_digest,
        study_os_digest="not_applicable",
        acquisition_plan_digest=always_on.acquisition_plan.plan_digest,
        knowledge_context_digest=always_on.knowledge_context_digest,
        methodology_context_digest=always_on.methodology_context_digest,
        locale_context_digest=always_on.locale_context.digest,
        retrieval_policy_version=envelope.retrieval_policy_version,
        model_version="future-pinned-model-placeholder-v1",
        prompt_digest=_digest("prompt"),
        pricing_version="future-pinned-pricing-placeholder-v1",
        cache_key=cache_key,
        proposal=proposal,
        generated_at=context_created_at,
    )
    cost = simulate_contextual_naming_cost_v1(
        model_version="future-pinned-model-placeholder-v1",
        pricing_version="future-pinned-pricing-placeholder-v1",
        cluster_count=57,
        pass_one_batch_size=10,
        pass_one_input_tokens_per_cluster=1_000,
        pass_one_output_tokens_per_cluster=100,
        pass_two_input_tokens_per_cluster=1_000,
        pass_two_output_tokens_per_cluster=300,
        input_micro_usd_per_token=3,
        output_micro_usd_per_token=15,
        hard_cap_micro_usd=1_000_000,
    )
    body = {
        "contract_version": "signal-10c1-offline-contract-fixtures-v1",
        "analysis_contexts": {
            "signal_es_mx": always_on.model_dump(mode="json"),
            "study_en_gb": study.model_dump(mode="json"),
            "unresolved_locale": unresolved.model_dump(mode="json"),
        },
        "representative_packet": packet.model_dump(mode="json"),
        "context_envelope": envelope.model_dump(mode="json"),
        "context_envelopes": {
            "signal_always_on": envelope.model_dump(mode="json"),
            "study": study_envelope.model_dump(mode="json"),
        },
        "closed_proposal": proposal.model_dump(mode="json"),
        "proposal_record": proposal_record.model_dump(mode="json"),
        "proposal_cache_key": cache_key,
        "cost_simulation": cost.model_dump(mode="json"),
        "provider_calls": 0,
        "remote_writes": 0,
    }
    payload = {**body, "fixture_digest": sha256_text(canonical_json(body))}
    write_private_json(output, payload)
    return payload


def _digest(value: str) -> str:
    return sha256_text(value)


def _brand(locales: list[str], markets: list[str]) -> BrandOsContextV1:
    return BrandOsContextV1(
        contract_version="signal-brand-os-analysis-context-v1",
        profile_version=1,
        profile_digest=_digest("brand-profile"),
        identity_catalog_digest=_digest("identity-catalog"),
        primary_identity="Synthetic brand",
        aliases=["Synthetic"],
        category="Synthetic category",
        products=["Synthetic product"],
        competitors=["Synthetic competitor"],
        markets=markets,
        locale_tags=locales,
        positioning=None,
        approved_attribute_refs=[],
    )


def _fallback() -> WorkspaceLocaleFallbackV1:
    return WorkspaceLocaleFallbackV1(
        contract_version="signal-workspace-locale-fallback-v1",
        digest=_digest("workspace-locale"),
        explicit_locale=None,
        explicit_market=None,
        timezone="America/Mexico_City",
    )


def _acquisition() -> AcquisitionContextV1:
    return AcquisitionContextV1(
        contract_version="signal-acquisition-analysis-context-v1",
        plan_version=1,
        plan_digest=_digest("acquisition-plan"),
        identity_catalog_digest=_digest("identity-catalog"),
        period_start=date(2026, 1, 1),
        period_end=date(2026, 8, 1),
        timezone="America/Mexico_City",
        slots=[
            AcquisitionSlotContextV1(
                slot_key="primary",
                scope="primary_brand",
                entity_ref=_digest("primary-entity"),
                slot_digest=_digest("primary-slot"),
                query_digest=_digest("primary-query"),
                import_provenance_digest=_digest("primary-import"),
            )
        ],
    )


def _packet() -> SealedRepresentativePacketV1:
    evidence = [
        RepresentativeEvidenceV1(
            evidence_ref=_digest("positive-evidence"),
            role="medoid",
            selection_reason="closest_to_cluster_centroid",
            excerpt="La entrega sintética llegó a tiempo.",
            language="es",
            scope="primary_brand",
            source_slice="social",
            time_slice="2026-07",
            rights_digest=_digest("positive-rights"),
        ),
        RepresentativeEvidenceV1(
            evidence_ref=_digest("negative-evidence"),
            role="counterexample",
            selection_reason="nearest_member_from_neighbor_cluster",
            excerpt="El precio sintético no describe una entrega.",
            language="es",
            scope="primary_brand",
            source_slice="social",
            time_slice="2026-07",
            rights_digest=_digest("negative-rights"),
        ),
    ]
    body = {
        "contract_version": "signal-sealed-representative-packet-v1",
        "run_key": _digest("run"),
        "cluster_key": _digest("cluster"),
        "cluster_content_digest": _digest("cluster-content"),
        "packet_policy_version": PACKET_POLICY_VERSION,
        "packet_policy_digest": sha256_text(canonical_json(PACKET_POLICY)),
        "cluster_member_count": 250,
        "count_scope": "calibration_subset",
        "population_denominator": 12_000,
        "stability": None,
        "outlier_information": {"membership_strength_availability": "not_available"},
        "local_terms": ["entrega", "tiempo"],
        "local_phrases": ["entrega a tiempo"],
        "distributions": {
            "language": {"es": 250},
            "scope": {"primary_brand": 250},
            "source": {"social": 250},
            "subregion": {"MX": 250},
            "time": {"2026-07": 250},
        },
        "distribution_contracts": {
            "language": "exclusive_root_count",
            "scope": "nonexclusive_provenance_membership_count",
            "source": "exclusive_root_count",
            "subregion": "exclusive_root_count",
            "time": "exclusive_root_count",
        },
        "neighboring_clusters": [{"cluster_ref": _digest("neighbor"), "similarity": 0.4}],
        "representatives": [item.model_dump(mode="json") for item in evidence],
        "excerpt_character_count": sum(len(item.excerpt) for item in evidence),
        "estimated_tokens": 25,
        "coverage": {"representative_count": 2},
        "limitations": ["Fixture counts are not population counts."],
    }
    return SealedRepresentativePacketV1.model_validate(
        {**body, "packet_digest": sha256_text(canonical_json(body))}
    )
