from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from signal_semantic_lab.artifacts import runtime_seconds_total
from signal_semantic_lab.canonical import sha256_file, sha256_text
from signal_semantic_lab.discovery import run_lexical_nmf
from signal_semantic_lab.embeddings import _embedding_batch_indexes
from signal_semantic_lab.input_data import load_export
from signal_semantic_lab.metrics import (
    assignment_metrics,
    merge_split_burden,
    topic_diversity,
    topic_redundancy,
)
from signal_semantic_lab.plan import load_plan
from signal_semantic_lab.preprocess import normalize_text
from signal_semantic_lab.runner import (
    assert_preregistered_corpus,
    compute_harness_source_digest,
    load_resource_rejections,
    passes_full_candidate_gates,
    passes_full_stability_gates,
    passes_hard_gates,
    select_finalists,
    stage_indexes,
)
from signal_semantic_lab.schema import BenchmarkRecord, ExportManifest
from signal_semantic_lab.splits import assert_no_leakage, deterministic_splits
from signal_semantic_lab.stability import (
    match_clusters,
    paired_bootstrap_stability,
    stability_metrics,
)


def record(index: int, *, text: str | None = None, family: str | None = None) -> BenchmarkRecord:
    value = normalize_text(text or f"Texto sintético {index}")
    return BenchmarkRecord.model_validate(
        {
            "contract_version": "signal-semantic-benchmark-record-v1",
            "record_key": sha256_text(f"record-{index}"),
            "canonical_family_key": sha256_text(family or f"family-{index}"),
            "content_hash": sha256_text(value),
            "text": value,
            "published_at": datetime(2026, 1 + index % 2, 1, tzinfo=UTC),
            "month": f"2026-{1 + index % 2:02d}",
            "language": "es",
            "country": "MX",
            "platform": "x",
            "provenance_intents": [{"scope": "primary_brand", "entity_ref": "sha256:" + "7" * 64}],
            "queue_state": "unresolved",
            "context_hash": sha256_text(f"context-{index}"),
            "authority_digest": sha256_text(f"authority-{index}"),
            "authority_valid_until": None,
        }
    )


def test_deterministic_split_and_no_leakage() -> None:
    records = [record(index) for index in range(100)]
    first = deterministic_splits(records, seed=7, train=0.6, calibration=0.2)
    second = deterministic_splits(list(reversed(records)), seed=7, train=0.6, calibration=0.2)
    assert first == second
    assert_no_leakage(records, first)


def test_content_duplicate_is_kept_in_one_split() -> None:
    records = [record(index) for index in range(20)]
    duplicate_text = "Mismo contenido"
    records[0] = record(0, text=duplicate_text)
    records[19] = record(19, text=duplicate_text)
    assignments = deterministic_splits(records, seed=11, train=0.6, calibration=0.2)
    assert_no_leakage(records, assignments)


def test_stages_do_not_touch_holdout_before_full() -> None:
    records = [record(index) for index in range(100)]
    plan = {
        "splits": {"seed": 7, "train_fraction": 0.6, "calibration_fraction": 0.2},
        "stages": {"smoke_max_records": 10, "calibration_max_records": 10},
    }
    assignments = deterministic_splits(records, seed=7, train=0.6, calibration=0.2)
    split_by_key = {assignment.record_key: assignment.split for assignment in assignments}
    smoke = stage_indexes(records, "smoke", plan)
    calibration = stage_indexes(records, "calibration", plan)
    assert len(smoke) == 10
    assert len(calibration) == 10
    assert {split_by_key[records[index].record_key] for index in smoke} == {"train"}
    assert {split_by_key[records[index].record_key] for index in calibration} == {"calibration"}
    assert stage_indexes(records, "full", plan) == list(range(100))


def test_cluster_matching_is_label_invariant() -> None:
    left = np.array([0, 0, 1, 1, -1])
    right = np.array([7, 7, 4, 4, -1])
    assert match_clusters(left, right) == {7: 0, 4: 1}
    metrics = stability_metrics(left, right)
    assert metrics["adjusted_rand"] == 1.0
    assert metrics["matched_assignment_consistency"] == 1.0


def test_assignment_consistency_penalizes_assigned_outlier_transitions() -> None:
    left = np.array([0, 0, 1, 1, -1])
    right = np.array([7, -1, 4, 4, 7])
    metrics = stability_metrics(left, right)
    assert metrics["matched_assignment_consistency"] == pytest.approx(3 / 5)


def test_assignment_metrics_preserve_denominator_and_abstention() -> None:
    metrics = assignment_metrics(np.array([0, 0, 1, -1, -1]))
    assert metrics["denominator"] == 5
    assert metrics["assigned"] == 3
    assert metrics["outliers"] == 2
    assert metrics["coverage"] == 0.6


def test_topic_metrics() -> None:
    terms = {0: ["uno", "dos", "tres"], 1: ["tres", "cuatro", "cinco"]}
    assert topic_diversity(terms, 3) == pytest.approx(5 / 6)
    assert topic_redundancy(terms, 3) == pytest.approx(1 / 5)
    burden = merge_split_burden(terms, np.array([0, 0, 1, 1]), 3)
    assert burden["merge_pair_count"] == 0


def test_runtime_projection_never_treats_artifact_bytes_as_seconds() -> None:
    components = {
        "embedding_seconds": 2.5,
        "discovery_seconds": 3.25,
        "assignment_serialization_seconds": 0.25,
        "assignment_artifact_bytes": 98_000_000,
        "embedding_artifact_bytes": 49_000_000,
        "referenced_binary_artifact_bytes": 147_000_000,
    }
    assert runtime_seconds_total(components) == pytest.approx(6.0)
    with pytest.raises(ValueError, match="benchmark_runtime_seconds_invalid"):
        runtime_seconds_total({"discovery_seconds": -1})


def test_paired_bootstrap_is_reproducible() -> None:
    left = np.array([0, 0, 1, 1, -1] * 20)
    right = np.array([7, 7, 4, 4, -1] * 20)
    first = paired_bootstrap_stability(left, right, seed=13, replicates=20)
    second = paired_bootstrap_stability(left, right, seed=13, replicates=20)
    assert first == second
    assert first["consistency_mean"] == pytest.approx(1.0)


def test_lexical_baseline_is_reproducible_with_same_seed() -> None:
    topics = ["entrega", "precio", "promoción", "servicio"]
    texts = [f"{topics[index % 4]} señal sintética variante texto" for index in range(80)]
    config = {
        "max_features": 1_000,
        "min_df": 1,
        "max_df": 1.0,
        "n_topics": 4,
        "max_iter": 200,
        "top_n_words": 10,
        "language_families": ["es", "en"],
        "ngram_min": 1,
        "ngram_max": 3,
    }
    first = run_lexical_nmf(texts, config, seed=17)
    second = run_lexical_nmf(texts, config, seed=17)
    assert np.array_equal(first.labels, second.labels)
    assert np.array_equal(first.strengths, second.strengths)
    assert first.terms == second.terms
    assert {key: value for key, value in first.diagnostics.items() if key != "phase_timings"} == {
        key: value for key, value in second.diagnostics.items() if key != "phase_timings"
    }
    assert first.diagnostics["phase_timings"].keys() == second.diagnostics["phase_timings"].keys()
    timings = first.diagnostics["phase_timings"]
    assert timings["lexical_vectorization_excluding_preprocessing_seconds"] >= 0
    assert timings["lexical_vectorization_total_seconds"] >= timings[
        "preprocessing_locale_seconds"
    ]


def test_embedding_length_buckets_are_stable_and_restoreable() -> None:
    texts = ["xxxx", "a", "ccc", "bb", "ddd"]
    batches = _embedding_batch_indexes(
        texts,
        2,
        "normalized-character-length-ascending-stable-v1",
    )
    assert batches == [[1, 3], [2, 4], [0]]
    assert sorted(index for batch in batches for index in batch) == list(range(len(texts)))
    assert _embedding_batch_indexes(texts, 3, "input-order-v1") == [[0, 1, 2], [3, 4]]


def test_full_stability_gate_requires_every_seed_comparison() -> None:
    gates = {
        "minimum_full_adjusted_rand": 0.25,
        "minimum_full_matched_assignment_consistency": 0.5,
    }
    assert passes_full_stability_gates(
        {
            "43": {"adjusted_rand": 0.7, "matched_assignment_consistency": 0.8},
            "71": {"adjusted_rand": 0.3, "matched_assignment_consistency": 0.6},
        },
        gates,
    )
    assert not passes_full_stability_gates(
        {
            "43": {"adjusted_rand": 0.7, "matched_assignment_consistency": 0.8},
            "71": {"adjusted_rand": 0.2, "matched_assignment_consistency": 0.6},
        },
        gates,
    )


def test_resource_rejection_is_closed_and_excludes_candidate(tmp_path: Path) -> None:
    payload = {
        "contract_version": "signal-local-modeling-resource-rejections-v1",
        "rejections": [
            {
                "candidate_key": "fastopic--multilingual-e5-small",
                "state": "rejected",
                "reason": "full_population_runtime_lower_bound_exceeded",
            }
        ],
    }
    path = tmp_path / "resource-rejections.private.json"
    path.write_text(json.dumps(payload))
    assert set(load_resource_rejections(tmp_path)) == {"fastopic--multilingual-e5-small"}
    payload["rejections"][0]["candidate_key"] = "invented"
    path.write_text(json.dumps(payload))
    with pytest.raises(ValueError, match="benchmark_resource_rejection_invalid"):
        load_resource_rejections(tmp_path)


def test_no_operable_finalist_pair_is_explicit_no_adoption() -> None:
    plan = {
        "hard_gates": {
            "minimum_coverage": 0.5,
            "minimum_topic_diversity": 0.5,
            "minimum_effective_topics": 10,
            "maximum_effective_topics": 200,
            "max_peak_ram_bytes": 1_000,
            "maximum_estimated_full_runtime_seconds": 1_000,
            "finalist_selection": "test-selection-v1",
        },
        "stages": {"finalist_count": 2},
    }
    metrics = {
        "coverage": 1.0,
        "topic_diversity": 1.0,
        "topic_redundancy": 0.0,
        "effective_topics": 2.0,
        "peak_rss_bytes": 10,
        "estimated_full_runtime_seconds": 10,
        "duration_seconds": 1,
    }
    result = select_finalists(
        [{"candidate_key": "bertopic--multilingual-e5-small", "metrics": metrics}],
        plan,
    )
    assert result["state"] == "no_adoption"
    assert result["candidate_keys"] == []


def test_corrective_plan_allows_one_or_more_technical_finalists() -> None:
    plan = {
        "contract_version": "signal-local-modeling-benchmark-plan-v2",
        "hard_gates": {
            "minimum_coverage": 0.55,
            "minimum_topic_diversity": 0.55,
            "minimum_effective_topics": 8,
            "maximum_effective_topics": 120,
            "max_peak_ram_bytes": 1_000,
            "maximum_estimated_full_runtime_seconds": 1_000,
            "maximum_majority_stopword_topic_rate": 0,
            "maximum_largest_cluster_share": 0.4,
            "minimum_nearest_cluster_separation_mean": 0.005,
            "finalist_selection": "test-v2",
        },
        "stages": {"finalist_count": 2},
    }
    metrics = {
        "coverage": 0.7,
        "topic_diversity": 0.8,
        "topic_redundancy": 0.1,
        "effective_topics": 20.0,
        "peak_rss_bytes": 10,
        "estimated_full_runtime_seconds": 10,
        "duration_seconds": 1,
        "accounting_reconciles": True,
        "representation": {"majority_stopword_topic_rate": 0.0},
        "cluster_size_distribution": {"largest_cluster_share": 0.2},
        "cluster_geometry": {"nearest_cluster_separation_mean": 0.02},
        "diagnostics": {
            "declared_parameters": {"clusters": 20},
            "effective_parameters": {"clusters": 20},
            "parameters_changed": False,
        },
    }
    result = select_finalists([{"candidate_key": "bertopic-bge-detail", "metrics": metrics}], plan)
    assert result["state"] == "finalist_available"
    assert result["candidate_keys"] == ["bertopic-bge-detail"]


def test_harness_source_and_parameter_contracts_are_fail_closed() -> None:
    digest = compute_harness_source_digest()
    assert digest.startswith("sha256:")
    assert digest == compute_harness_source_digest()

    gates = {
        "minimum_coverage": 0.5,
        "minimum_topic_diversity": 0.5,
        "minimum_effective_topics": 2,
        "maximum_effective_topics": 20,
        "max_peak_ram_bytes": 10_000,
        "maximum_estimated_full_runtime_seconds": 100,
        "maximum_majority_stopword_topic_rate": 0,
        "maximum_largest_cluster_share": 0.4,
        "minimum_nearest_cluster_separation_mean": 0.005,
    }
    metrics = {
        "coverage": 1.0,
        "topic_diversity": 1.0,
        "effective_topics": 3.0,
        "peak_rss_bytes": 1,
        "estimated_full_runtime_seconds": 1.0,
        "accounting_reconciles": True,
        "representation": {"majority_stopword_topic_rate": 0.0},
        "cluster_size_distribution": {"largest_cluster_share": 0.2},
        "cluster_geometry": {"nearest_cluster_separation_mean": 0.02},
        "diagnostics": {
            "declared_parameters": {"clusters": 3},
            "effective_parameters": {"clusters": 3},
            "parameters_changed": False,
        },
    }
    assert passes_hard_gates(metrics, gates)
    metrics["diagnostics"]["effective_parameters"] = {"clusters": 2}
    assert not passes_hard_gates(metrics, gates)


def test_material_dependency_evidence_rejects_floating_urls(tmp_path: Path) -> None:
    source = Path(__file__).resolve().parents[1] / "config" / "benchmark-plan-10c1.json"
    plan = json.loads(source.read_text())
    plan["material_dependencies"][1]["url"] = (
        "https://github.com/lmcinnes/umap/blob/master/LICENSE.txt"
    )
    target = tmp_path / "plan.json"
    target.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match="dependency_evidence_not_immutable"):
        load_plan(target)


def test_full_candidate_must_pass_every_seed_gate(tmp_path: Path) -> None:
    gates = {
        "minimum_coverage": 0.55,
        "minimum_topic_diversity": 0.55,
        "minimum_effective_topics": 8,
        "maximum_effective_topics": 120,
        "max_peak_ram_bytes": 1_000,
        "maximum_estimated_full_runtime_seconds": 1_000,
        "maximum_majority_stopword_topic_rate": 0,
        "maximum_largest_cluster_share": 0.4,
        "minimum_nearest_cluster_separation_mean": 0.005,
    }
    metrics = {
        "coverage": 0.7,
        "topic_diversity": 0.8,
        "effective_topics": 20,
        "peak_rss_bytes": 10,
        "estimated_full_runtime_seconds": 10,
        "accounting_reconciles": True,
        "representation": {"majority_stopword_topic_rate": 0.0},
        "cluster_size_distribution": {"largest_cluster_share": 0.2},
        "cluster_geometry": {"nearest_cluster_separation_mean": 0.02},
        "diagnostics": {
            "declared_parameters": {"clusters": 20},
            "effective_parameters": {"clusters": 20},
            "parameters_changed": False,
        },
    }
    full = tmp_path / "full"
    full.mkdir()
    plan = {"stages": {"final_seeds": [17, 43, 71]}, "hard_gates": gates}
    for seed in plan["stages"]["final_seeds"]:
        (full / f"candidate.seed-{seed}.result.json").write_text(json.dumps({"metrics": metrics}))
    assert passes_full_candidate_gates(tmp_path, "candidate", plan)
    metrics["coverage"] = 0.1
    (full / "candidate.seed-71.result.json").write_text(json.dumps({"metrics": metrics}))
    assert not passes_full_candidate_gates(tmp_path, "candidate", plan)


def test_manifest_requires_private_files_and_exact_reconciliation(tmp_path: Path) -> None:
    rows = [record(1), record(2)]
    source = tmp_path / "source.jsonl"
    source.write_text("\n".join(item.model_dump_json() for item in rows) + "\n")
    os.chmod(source, 0o600)
    content_digest = sha256_text(
        "\n".join(
            f"{item.record_key}|{item.content_hash}|{item.context_hash}|{item.authority_digest}"
            for item in sorted(rows, key=lambda value: value.record_key)
        )
    )
    manifest = {
        "contract_version": "signal-semantic-benchmark-export-v1",
        "target": "local-fixture",
        "read_only": True,
        "writes_performed": False,
        "provider_calls": 0,
        "jobs_enqueued": 0,
        "workspace_ref": "sha256:" + "1" * 64,
        "export_timestamp": datetime.now(UTC).isoformat(),
        "period_start": "2026-01-01",
        "period_end": "2026-02-01",
        "timezone": "America/Mexico_City",
        "population_digest": "sha256:" + "2" * 64,
        "watermark_digest": "sha256:" + "3" * 64,
        "governance_digest": "sha256:" + "4" * 64,
        "content_digest": content_digest,
        "schema_version": "signal-semantic-benchmark-record-v1",
        "denominator": 3,
        "exported": 2,
        "excluded_by_reason": {"quality_excluded": 1},
        "scope_counts": {"primary_brand": 2},
        "entity_counts": {"sha256:" + "7" * 64: 2},
        "language_counts": {"es": 2},
        "platform_counts": {"x": 2},
        "projection_snapshot_digest": "sha256:" + "6" * 64,
        "projection_generation": 1,
        "projection_reconciled_at": datetime.now(UTC).isoformat(),
        "exclusion_contract": "exclusive-precedence-v1",
        "protected_state_digest_before": "sha256:" + "5" * 64,
        "protected_state_digest_after": "sha256:" + "5" * 64,
        "transaction_read_only": True,
        "transaction_id_assigned": False,
        "export_file_sha256": sha256_file(source),
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    os.chmod(manifest_path, 0o600)
    loaded, validated = load_export(source, manifest_path)
    assert len(loaded) == 2
    assert validated.denominator == 3
    with pytest.raises(ValidationError, match="manifest_slice_count_invalid"):
        ExportManifest.model_validate(
            {
                **validated.model_dump(mode="json"),
                "denominator": 1,
                "excluded_by_reason": {"quality_excluded": -1},
            }
        )
    plan = {"corpus": {"sealed_content_digest": content_digest, "minimum_full_population": 2}}
    assert_preregistered_corpus(plan, validated, len(loaded))
    plan["corpus"]["sealed_content_digest"] = sha256_text("wrong")
    with pytest.raises(ValueError, match="preregistered_corpus_digest_mismatch"):
        assert_preregistered_corpus(plan, validated, len(loaded))


def test_input_schema_rejects_month_and_scope_drift() -> None:
    with pytest.raises(ValidationError, match="record_month_mismatch"):
        BenchmarkRecord.model_validate(
            {**record(1).model_dump(mode="json"), "month": "2026-12"}
        )

    base = record(1)
    with pytest.raises(ValidationError, match="provenance_scope_entity_mismatch"):
        BenchmarkRecord.model_validate(
            {
                **base.model_dump(mode="json"),
                "provenance_intents": [
                    {"scope": "unattributed", "entity_ref": "sha256:" + "7" * 64}
                ],
            }
        )
