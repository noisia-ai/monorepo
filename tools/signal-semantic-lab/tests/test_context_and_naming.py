from __future__ import annotations

import json
import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from signal_semantic_lab.canonical import sha256_file, sha256_text
from signal_semantic_lab.context import (
    AcquisitionContextV1,
    AcquisitionSlotContextV1,
    BrandOsContextV1,
    StudyOsContextV1,
    WorkspaceLocaleFallbackV1,
    resolve_governed_analysis_context_v1,
)
from signal_semantic_lab.contract_fixtures import build_offline_contract_fixtures
from signal_semantic_lab.discovery import _membership_strengths
from signal_semantic_lab.naming_contracts import (
    ClosedClaudeTopicProposalV1,
    GovernedContextSourceV1,
    SealedRepresentativePacketV1,
    build_governed_context_envelope_v1,
    proposal_cache_key_v1,
    simulate_contextual_naming_cost_v1,
)
from signal_semantic_lab.preprocess import LocalePreprocessPolicy, locale_tokens
from signal_semantic_lab.review_packet import PACKET_POLICY, build_blinded_packet
from signal_semantic_lab.schema import BenchmarkRecord


def digest(character: str) -> str:
    return "sha256:" + character * 64


def acquisition() -> AcquisitionContextV1:
    return AcquisitionContextV1.model_validate(
        {
            "contract_version": "signal-acquisition-analysis-context-v1",
            "plan_version": 3,
            "plan_digest": digest("1"),
            "identity_catalog_digest": digest("2"),
            "period_start": date(2026, 1, 1),
            "period_end": date(2026, 8, 1),
            "timezone": "America/Mexico_City",
            "slots": [
                AcquisitionSlotContextV1(
                    slot_key="primary",
                    scope="primary_brand",
                    entity_ref=digest("3"),
                    slot_digest=digest("4"),
                    query_digest=digest("5"),
                    import_provenance_digest=digest("6"),
                )
            ],
        }
    )


def brand(*, locales: list[str], markets: list[str]) -> BrandOsContextV1:
    return BrandOsContextV1(
        contract_version="signal-brand-os-analysis-context-v1",
        profile_version=7,
        profile_digest=digest("7"),
        identity_catalog_digest=digest("2"),
        primary_identity="Synthetic brand",
        aliases=["Synthetic"],
        category="Retail",
        products=["Product"],
        competitors=["Competitor"],
        markets=markets,
        locale_tags=locales,
        positioning=None,
        approved_attribute_refs=[],
    )


def fallback(*, locale: str | None = None, market: str | None = None) -> WorkspaceLocaleFallbackV1:
    return WorkspaceLocaleFallbackV1(
        contract_version="signal-workspace-locale-fallback-v1",
        digest=digest("8"),
        explicit_locale=locale,
        explicit_market=market,
        timezone="America/Mexico_City",
    )


def test_signal_locale_uses_brand_os_and_study_is_not_applicable() -> None:
    first = resolve_governed_analysis_context_v1(
        run_scope="signal_always_on",
        brand_os=brand(locales=["es-MX", "en-US"], markets=["MX"]),
        study_context=None,
        acquisition=acquisition(),
        workspace_fallback=fallback(),
        knowledge_context_digest=digest("9"),
        methodology_context_digest=digest("a"),
    )
    second = resolve_governed_analysis_context_v1(
        run_scope="signal_always_on",
        brand_os=brand(locales=["es-MX", "en-US"], markets=["MX"]),
        study_context=None,
        acquisition=acquisition(),
        workspace_fallback=fallback(),
        knowledge_context_digest=digest("9"),
        methodology_context_digest=digest("a"),
    )
    assert first.study_context == "not_applicable"
    assert first.locale_context.language_variant == "es-MX"
    assert first.locale_context.primary_language == "es"
    assert first.locale_context.source_authority["language_variant"] == "brand_os"
    assert first.snapshot_digest == second.snapshot_digest


def test_study_locale_overrides_brand_default_and_unknown_fails_closed() -> None:
    study = StudyOsContextV1(
        contract_version="signal-study-os-analysis-context-v1",
        reference_hash=digest("b"),
        digest=digest("c"),
        objective="Understand adoption",
        research_questions=["Why now?"],
        methodology="Social listening",
        audience="Operators",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 8, 1),
        scopes=["primary_brand"],
        output_locale="en-GB",
        market="GB",
    )
    resolved = resolve_governed_analysis_context_v1(
        run_scope="study",
        brand_os=brand(locales=["es-MX"], markets=["MX"]),
        study_context=study,
        acquisition=acquisition(),
        workspace_fallback=fallback(),
        knowledge_context_digest=digest("d"),
        methodology_context_digest=digest("e"),
    )
    assert resolved.locale_context.language_variant == "en-GB"
    assert resolved.locale_context.country_market == "GB"
    assert resolved.locale_context.source_authority["language_variant"] == "study_os"

    unknown = resolve_governed_analysis_context_v1(
        run_scope="signal_always_on",
        brand_os=brand(locales=[], markets=[]),
        study_context=None,
        acquisition=acquisition(),
        workspace_fallback=fallback(),
        knowledge_context_digest=digest("d"),
        methodology_context_digest=digest("e"),
    )
    assert unknown.locale_context.readiness == "requires_operator_decision"
    assert unknown.locale_context.language_variant is None
    assert set(unknown.locale_context.blockers) == {
        "locale_variant_requires_operator_decision",
        "market_requires_operator_decision",
    }


def test_signal_locale_contradiction_requires_operator_decision() -> None:
    context = resolve_governed_analysis_context_v1(
        run_scope="signal_always_on",
        brand_os=brand(locales=["es-MX"], markets=["GB"]),
        study_context=None,
        acquisition=acquisition(),
        workspace_fallback=fallback(),
        knowledge_context_digest=digest("d"),
        methodology_context_digest=digest("e"),
    )
    assert context.locale_context.readiness == "requires_operator_decision"
    assert "locale_market_contradiction_requires_operator_decision" in (
        context.locale_context.blockers
    )


def test_analysis_context_fails_closed_on_catalog_scope_or_period_drift() -> None:
    drifted_brand = brand(locales=["es-MX"], markets=["MX"]).model_copy(
        update={"identity_catalog_digest": digest("f")}
    )
    with pytest.raises(ValueError, match="identity_catalog_drift"):
        resolve_governed_analysis_context_v1(
            run_scope="signal_always_on",
            brand_os=drifted_brand,
            study_context=None,
            acquisition=acquisition(),
            workspace_fallback=fallback(),
            knowledge_context_digest=digest("d"),
            methodology_context_digest=digest("e"),
        )

    base_study = StudyOsContextV1(
        contract_version="signal-study-os-analysis-context-v1",
        reference_hash=digest("b"),
        digest=digest("c"),
        objective="Understand adoption",
        research_questions=["Why now?"],
        methodology="Social listening",
        audience="Operators",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 8, 1),
        scopes=["primary_brand"],
        output_locale="es-MX",
        market="MX",
    )
    for changed, message in [
        ({"scopes": ["competitor"]}, "scope_outside"),
        ({"period_end": date(2026, 8, 2)}, "period_outside"),
    ]:
        with pytest.raises(ValueError, match=message):
            resolve_governed_analysis_context_v1(
                run_scope="study",
                brand_os=brand(locales=["es-MX"], markets=["MX"]),
                study_context=base_study.model_copy(update=changed),
                acquisition=acquisition(),
                workspace_fallback=fallback(),
                knowledge_context_digest=digest("d"),
                methodology_context_digest=digest("e"),
            )


def test_locale_preprocessing_preserves_negation_code_switching_and_symbols() -> None:
    tokens = locale_tokens(
        "No está cool 😡, jamás compro aquí; precio súper caro https://example.test",
        LocalePreprocessPolicy(language_families=("es", "en"), ngram_min=1, ngram_max=3),
    )
    assert "no" in tokens
    assert "jamás" in tokens
    assert "cool" in tokens
    assert "😡" in tokens
    assert "precio_súper" in tokens
    assert "https" not in tokens
    assert "," not in tokens
    assert "está" not in tokens
    assert "aquí" not in tokens


def test_locale_stopwords_are_accent_aware_without_erasing_negation_or_slang() -> None:
    tokens = locale_tokens(
        "También él está aquí, pero no jamás sin chido güey 😡",
        LocalePreprocessPolicy(language_families=("es",), ngram_min=1, ngram_max=1),
    )
    assert not {"también", "él", "está", "aquí"} & set(tokens)
    assert {"no", "jamás", "sin", "chido", "güey", "😡"} <= set(tokens)


def test_missing_bertopic_probability_is_not_fabricated() -> None:
    class Hdbscan:
        probabilities_ = None

    class Model:
        hdbscan_model = Hdbscan()

    values, availability = _membership_strengths(None, Model(), 4)
    assert availability == "not_available"
    assert np.all(np.isnan(values))


def test_context_envelope_fails_closed_without_excerpt_rights() -> None:
    context_created_at = datetime(2026, 8, 16, 19, 3, 59, tzinfo=UTC)
    context = resolve_governed_analysis_context_v1(
        run_scope="signal_always_on",
        brand_os=brand(locales=["es-MX"], markets=["MX"]),
        study_context=None,
        acquisition=acquisition(),
        workspace_fallback=fallback(),
        knowledge_context_digest=digest("3"),
        methodology_context_digest=digest("4"),
    )
    source_digests = {
        "brand_os": context.brand_os.profile_digest,
        "acquisition_plan": context.acquisition_plan.plan_digest,
        "knowledge_base": context.knowledge_context_digest,
        "methodology": context.methodology_context_digest,
        "cluster_packet": digest("7"),
    }
    sources = [
        GovernedContextSourceV1(
            kind=kind,
            source_version=f"{kind}-fixture-v1",
            reference_digest=digest(character),
            content_digest=source_digests[kind],
            relevance_reason="Required governed context",
            rights_usage=rights,
            provider_transmission_authorized=True,
            rights_evaluation_digest=digest("e"),
            privacy_evaluation_digest=digest("f"),
            pii_redaction_state="passed",
            rights_evaluated_at=context_created_at,
            rights_valid_until=None,
            token_count=100,
        )
        for kind, character, rights in [
            ("brand_os", "1", "internal-context"),
            ("acquisition_plan", "2", "internal-context"),
            ("knowledge_base", "3", "internal-context"),
            ("methodology", "4", "internal-context"),
            ("cluster_packet", "7", "llm-processing"),
        ]
    ]
    with pytest.raises(ValidationError, match="benchmark_context_envelope_llm_rights_unavailable"):
        build_governed_context_envelope_v1(
            workspace_ref=digest("5"),
            study_context_state="not_applicable",
            created_at=context_created_at,
            analysis_context=context,
            cluster_packet_digest=digest("7"),
            retrieval_policy_version="v1",
            retrieval_policy_digest=digest("9"),
            sources=sources,
            maximum_tokens=1_000,
            provider_excerpt_authorized=False,
            limitations=[],
        )

    drifted_sources = [
        source.model_copy(
            update={
                "content_digest": digest("f"),
                "provider_transmission_authorized": True,
            }
        )
        if source.kind == "brand_os"
        else source
        for source in sources
    ]
    with pytest.raises(ValidationError, match="source_digest_mismatch"):
        build_governed_context_envelope_v1(
            workspace_ref=digest("5"),
            study_context_state="not_applicable",
            created_at=context_created_at,
            analysis_context=context,
            cluster_packet_digest=digest("7"),
            retrieval_policy_version="v1",
            retrieval_policy_digest=digest("9"),
            sources=drifted_sources,
            maximum_tokens=1_000,
            provider_excerpt_authorized=True,
            limitations=[],
        )

    expired_sources = [
        source.model_copy(
            update={
                "rights_evaluated_at": context_created_at - timedelta(days=1),
                "rights_valid_until": context_created_at,
            }
        )
        for source in sources
    ]
    with pytest.raises(ValidationError, match="rights_not_current"):
        build_governed_context_envelope_v1(
            workspace_ref=digest("5"),
            study_context_state="not_applicable",
            created_at=context_created_at,
            analysis_context=context,
            cluster_packet_digest=digest("7"),
            retrieval_policy_version="v1",
            retrieval_policy_digest=digest("9"),
            sources=expired_sources,
            maximum_tokens=1_000,
            provider_excerpt_authorized=True,
            limitations=[],
        )

    privacy_unknown_sources = [
        source.model_copy(update={"pii_redaction_state": "not_available"})
        if source.kind == "cluster_packet"
        else source
        for source in sources
    ]
    with pytest.raises(ValidationError, match="privacy_evaluation_unavailable"):
        build_governed_context_envelope_v1(
            workspace_ref=digest("5"),
            study_context_state="not_applicable",
            created_at=context_created_at,
            analysis_context=context,
            cluster_packet_digest=digest("7"),
            retrieval_policy_version="v1",
            retrieval_policy_digest=digest("9"),
            sources=privacy_unknown_sources,
            maximum_tokens=1_000,
            provider_excerpt_authorized=True,
            limitations=[],
        )


def test_closed_proposal_rejects_counts_sql_and_cache_is_reproducible() -> None:
    with pytest.raises(ValidationError):
        ClosedClaudeTopicProposalV1.model_validate(
            {
                "contract_version": "signal-closed-claude-topic-proposal-v1",
                "proposed_display_name": "Entrega",
                "definition": "Experiencias de entrega.",
                "inclusion_summary": "Incluye logística.",
                "exclusion_summary": "Excluye precio.",
                "evidence_refs": [digest("1")],
                "merge_candidate": False,
                "split_candidate": False,
                "too_broad": False,
                "too_thin": False,
                "positive_example_refs": [],
                "negative_example_refs": [],
                "insufficient_evidence": False,
                "narrative_hypothesis": None,
                "narrative_hypothesis_state": "not_proposed",
                "population_count": 10,
                "sql": "select 1",
            }
        )
    arguments = {
        "cluster_content_digest": digest("1"),
        "packet_digest": digest("2"),
        "context_envelope_digest": digest("3"),
        "retrieval_policy_version": "v1",
        "model_version": "pinned-model-v1",
        "prompt_digest": digest("4"),
    }
    assert proposal_cache_key_v1(**arguments) == proposal_cache_key_v1(**arguments)


def test_cost_simulation_is_cluster_bounded_and_has_no_provider_call() -> None:
    cost = simulate_contextual_naming_cost_v1(
        model_version="pinned-model-v1",
        pricing_version="pinned-pricing-v1",
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
    assert cost.pass_one_batches == 6
    assert cost.maximum_calls == 63
    assert cost.provider_calls == 0
    assert cost.writes_performed is False
    assert cost.input_token_upper_bound == 114_000
    assert cost.output_token_upper_bound == 22_800


def test_offline_contract_fixtures_are_reproducible_and_provider_free(tmp_path) -> None:
    first = build_offline_contract_fixtures(tmp_path / "first.json")
    second = build_offline_contract_fixtures(tmp_path / "second.json")
    assert first == second
    assert first["analysis_contexts"]["signal_es_mx"]["study_context"] == "not_applicable"
    assert (
        first["analysis_contexts"]["study_en_gb"]["locale_context"]["language_variant"] == "en-GB"
    )
    assert (
        first["analysis_contexts"]["unresolved_locale"]["locale_context"]["readiness"]
        == "requires_operator_decision"
    )
    assert first["provider_calls"] == 0
    assert first["remote_writes"] == 0
    tampered_packet = dict(first["representative_packet"])
    tampered_packet["packet_digest"] = digest("f")
    with pytest.raises(ValidationError, match="packet_digest_mismatch"):
        SealedRepresentativePacketV1.model_validate(tampered_packet)
    record = first["proposal_record"]
    assert record["state"] == "draft"
    assert record["generation_mode"] == "offline_contract_fixture"
    assert record["study_os_digest"] == "not_applicable"
    assert record["cache_key"] == first["proposal_cache_key"]
    assert first["context_envelopes"]["signal_always_on"]["study_context_state"] == (
        "not_applicable"
    )
    study_envelope = first["context_envelopes"]["study"]
    assert study_envelope["study_context_state"] == "included"
    assert [source["kind"] for source in study_envelope["sources"]].count("study_os") == 1


def test_adaptive_packet_is_deterministic_diverse_redacted_and_bounded(
    tmp_path: Path,
) -> None:
    records = [_packet_record(index) for index in range(24)]
    labels = np.asarray([0] * 12 + [1] * 12, dtype=np.int32)
    strengths = np.linspace(0.1, 0.9, len(records), dtype=np.float32)
    assignments = tmp_path / "assignments.npz"
    np.savez_compressed(assignments, labels=labels, strengths=strengths)
    os.chmod(assignments, 0o600)
    candidate = {
        "candidate_key": "synthetic-candidate",
        "assignments_path": str(assignments),
        "assignments_sha256": sha256_file(assignments),
        "terms": {
            "0": ["entrega", "entrega_rápida"],
            "1": ["precio", "precio_alto"],
        },
        "artifact_manifest": {},
    }
    first = build_blinded_packet(
        records,
        [candidate],
        tmp_path / "first",
        seed=19,
        population_denominator=24,
    )
    second = build_blinded_packet(
        records,
        [candidate],
        tmp_path / "second",
        seed=19,
        population_denominator=24,
    )
    first_packet = json.loads(Path(first["packet"]).read_text())
    second_packet = json.loads(Path(second["packet"]).read_text())
    assert first_packet == second_packet
    assert first_packet["contract_version"] == "signal-topic-discovery-blind-review-v3"
    assert first_packet["modeling_scope"] == "full_population"
    assert first_packet["modeling_record_count"] == 24
    assert first_packet["population_denominator"] == 24
    assert first_packet["review_scope"] == "complete_cluster_census"
    assert "reviewed_record_count" not in first_packet
    assert sha256_file(Path(first["packet"])) == sha256_file(Path(second["packet"]))
    assert sha256_file(Path(first["key"])) == sha256_file(Path(second["key"]))
    assert sha256_file(tmp_path / "first" / "blind-review-score-sheet.private.csv") == (
        sha256_file(tmp_path / "second" / "blind-review-score-sheet.private.csv")
    )
    decision_sheet = tmp_path / "first" / "blind-review-decision-sheet.private.csv"
    assert sha256_file(decision_sheet) == sha256_file(
        tmp_path / "second" / "blind-review-decision-sheet.private.csv"
    )
    assert "candidate_preferred|none_acceptable" in decision_sheet.read_text()
    assert "review_outcome" in decision_sheet.read_text()
    assert first_packet["decision_sheet_contract"] == (
        "signal-topic-discovery-blind-decision-sheet-v1"
    )
    assert first_packet["candidates"][0]["packet_token_count"] <= first_packet[
        "candidates"
    ][0]["packet_token_limit"]
    for topic in first_packet["candidates"][0]["topics"]:
        sealed = topic["sealed_packet"]
        assert len(sealed["representatives"]) <= 8
        assert {item["role"] for item in sealed["representatives"]} >= {
            "medoid",
            "diversity",
            "boundary",
            "counterexample",
        }
        assert sealed["count_scope"] == "full_population"
        assert sealed["distribution_contracts"]["scope"] == (
            "nonexclusive_provenance_membership_count"
        )
        assert sealed["coverage"]["breadth_state"] == "bounded"
        assert all("example.test" not in item["excerpt"] for item in sealed["representatives"])


def test_operator_packet_selects_deterministic_cluster_subset_within_run_cap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    records = [_packet_record(index) for index in range(80)]
    labels = np.asarray([index // 2 for index in range(80)], dtype=np.int32)
    strengths = np.linspace(0.1, 0.9, len(records), dtype=np.float32)
    assignments = tmp_path / "assignments.npz"
    np.savez_compressed(assignments, labels=labels, strengths=strengths)
    os.chmod(assignments, 0o600)
    candidate = {
        "candidate_key": "many-cluster-candidate",
        "assignments_path": str(assignments),
        "assignments_sha256": sha256_file(assignments),
        "terms": {str(index): [f"term-{index}"] for index in range(40)},
        "artifact_manifest": {},
    }
    monkeypatch.setitem(PACKET_POLICY, "maximum_run_tokens", 500)
    first = build_blinded_packet(records, [candidate], tmp_path / "first", seed=23)
    second = build_blinded_packet(records, [candidate], tmp_path / "second", seed=23)
    first_packet = json.loads(Path(first["packet"]).read_text())
    second_packet = json.loads(Path(second["packet"]).read_text())
    assert first_packet == second_packet
    assert first_packet["modeling_scope"] == "full_population"
    assert first_packet["modeling_record_count"] == len(records)
    assert first_packet["population_denominator"] == len(records)
    assert first_packet["review_scope"] == "bounded_cluster_subset"
    assert "reviewed_record_count" not in first_packet
    assert first_packet["packet_token_count"] <= first_packet["packet_token_limit"]
    row = first_packet["candidates"][0]
    assert row["cluster_selection_state"] == "bounded_subset"
    assert 0 < row["reviewed_topic_count"] < row["topic_count"]
    assert row["unreviewed_topic_count"] == row["topic_count"] - row["reviewed_topic_count"]


def _packet_record(index: int) -> BenchmarkRecord:
    language = "es" if index % 2 == 0 else "en"
    scope = "primary_brand" if index % 3 else "competitor"
    text = (
        f"Entrega sintética {index} contacto person{index}@example.test https://example.test/path"
        if index < 12
        else f"Synthetic price experience {index} @privatehandle"
    )
    return BenchmarkRecord.model_validate(
        {
            "contract_version": "signal-semantic-benchmark-record-v1",
            "record_key": sha256_text(f"packet-record-{index}"),
            "canonical_family_key": sha256_text(f"packet-family-{index}"),
            "content_hash": sha256_text(text),
            "text": text,
            "published_at": datetime(2026, 1 + index % 3, 1, tzinfo=UTC),
            "month": f"2026-{1 + index % 3:02d}",
            "language": language,
            "country": "MX" if language == "es" else "GB",
            "platform": "social" if index % 2 else "news",
            "provenance_intents": [{"scope": scope, "entity_ref": sha256_text(f"entity-{scope}")}],
            "queue_state": "unresolved",
            "context_hash": sha256_text(f"context-{index}"),
            "authority_digest": sha256_text(f"rights-{index}"),
            "authority_valid_until": None,
        }
    )
