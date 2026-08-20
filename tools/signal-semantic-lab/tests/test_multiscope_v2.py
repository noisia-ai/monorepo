from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from signal_semantic_lab.canonical import sha256_file
from signal_semantic_lab.fixture import generate_multiscope_fixture
from signal_semantic_lab.input_data import load_export
from signal_semantic_lab.multiscope import (
    dry_run_multiscope_contract,
    multiscope_metrics,
    stratified_multiscope_indexes,
)
from signal_semantic_lab.plan import load_plan, plan_digest
from signal_semantic_lab.runner import (
    load_completed_result,
    passes_hard_gates,
    prepare_run,
    run_stage,
)
from signal_semantic_lab.schema import BenchmarkRecordV2, ExportManifestV2
from signal_semantic_lab.splits import assert_no_leakage, deterministic_splits

LAB_ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_PLAN = LAB_ROOT / "config" / "benchmark-plan-10c2.json"
V3_PLAN = LAB_ROOT / "config" / "benchmark-plan-10c2-v3.json"


def _fixture(tmp_path: Path) -> tuple[list[BenchmarkRecordV2], ExportManifestV2]:
    payload = generate_multiscope_fixture(tmp_path / "fixture")
    records, manifest = load_export(Path(payload["source"]), Path(payload["manifest"]))
    assert isinstance(manifest, ExportManifestV2)
    assert all(isinstance(record, BenchmarkRecordV2) for record in records)
    return [record for record in records if isinstance(record, BenchmarkRecordV2)], manifest


def _fixture_plan(tmp_path: Path, manifest: ExportManifestV2) -> Path:
    plan = deepcopy(load_plan(V3_PLAN))
    corpus = plan["corpus"]
    corpus.update(
        {
            "identity": manifest.corpus_identity,
            "acquisition_denominator": manifest.acquisition_denominator,
            "included_modeling_population": manifest.modeling_population,
            "quality_excluded_roots": manifest.quality_excluded_roots,
            "population_digest": manifest.population_digest,
            "content_digest": manifest.content_digest,
            "provenance_digest": manifest.provenance_digest,
            "watermark_digest": manifest.watermark_digest,
            "timezone": manifest.timezone,
            "observed_period_local": {
                "from": manifest.period_start,
                "to": manifest.period_end,
            },
            "partitions": [
                {"key": key, **value.model_dump()} for key, value in manifest.partitions.items()
            ],
        }
    )
    plan["sampling"]["partition_weights"] = {
        key: 1 / len(manifest.partitions) for key in manifest.partitions
    }
    path = tmp_path / "fixture-plan-v3.json"
    path.write_text(json.dumps(plan))
    os.chmod(path, 0o600)
    return path


def test_original_10c2_plan_is_preserved_and_rejected_by_legacy_loader_contract() -> None:
    assert (
        sha256_file(ORIGINAL_PLAN)
        == "sha256:8f557769af29f87e89996fd6bc8db3e4fd20e73b96ed21464517eb73244bd736"
    )
    with pytest.raises(ValueError, match="benchmark_plan_contract_invalid"):
        load_plan(ORIGINAL_PLAN)


def test_original_10c2_shape_is_not_the_executable_10c1_runner_shape() -> None:
    original = json.loads(ORIGINAL_PLAN.read_text())
    assert original["contract_version"] == "signal-local-modeling-benchmark-plan-10c2-v1"
    assert isinstance(original["candidates"], dict)
    assert "stages" not in original
    assert "maximum_download_bytes" in original["hardware_budget"]
    assert "max_download_bytes" not in original["hardware_budget"]


def test_v3_plan_normalizes_10c2_without_authorizing_execution() -> None:
    plan = load_plan(V3_PLAN)
    assert plan["contract_version"] == "signal-local-modeling-benchmark-plan-v3"
    assert plan["execution_authorized"] is False
    assert plan["ten_d_authorized"] is False
    assert plan["corpus"]["required_usage"] == "strategic-analysis"
    assert plan["sampling"]["partition_weights"] == {
        "primary_brand": 0.25,
        "category": 0.25,
        "competitor_google_nest": 0.25,
        "competitor_apple_homepod": 0.25,
    }


@pytest.mark.parametrize(
    ("mutate", "error"),
    [
        (
            lambda plan: plan["corpus"]["partitions"].pop(),
            "benchmark_plan_v3_partition_matrix_invalid",
        ),
        (
            lambda plan: plan["sampling"]["partition_weights"].update({"primary_brand": 0.5}),
            "benchmark_plan_v3_partition_weights_invalid",
        ),
        (
            lambda plan: plan["embeddings"][0].update({"revision": "main"}),
            "benchmark_embedding_revision_not_immutable",
        ),
        (
            lambda plan: plan["embeddings"][0]["artifact_files"][0].update({"sha256": "unknown"}),
            "benchmark_embedding_artifact_hash",
        ),
        (
            lambda plan: plan.update({"workspace_id": "browser-controlled"}),
            "benchmark_plan_v3_top_level",
        ),
    ],
)
def test_v3_plan_fails_closed(tmp_path: Path, mutate: object, error: str) -> None:
    plan = json.loads(V3_PLAN.read_text())
    mutate(plan)  # type: ignore[operator]
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match=error):
        load_plan(path)


def test_multiscope_fixture_reconciles_non_additive_memberships(tmp_path: Path) -> None:
    records, manifest = _fixture(tmp_path)
    assert manifest.acquisition_denominator == 440
    assert manifest.modeling_population == 400
    assert manifest.quality_excluded_roots == 40
    assert manifest.shared_root_count == 100
    assert sum(item.included for item in manifest.partitions.values()) == 510
    assert len(records) == len({record.record_key for record in records}) == 400


def test_shared_roots_never_cross_splits_and_sampling_is_deterministic(
    tmp_path: Path,
) -> None:
    records, manifest = _fixture(tmp_path)
    assignments = deterministic_splits(records, seed=104729, train=0.6, calibration=0.2)
    assert_no_leakage(records, assignments)
    partitions = list(manifest.partitions)
    first = stratified_multiscope_indexes(
        records,
        assignments,
        split="calibration",
        required_partitions=partitions,
        maximum_per_partition=20,
        seed=104729,
        stage="calibration",
    )
    second = stratified_multiscope_indexes(
        records,
        assignments,
        split="calibration",
        required_partitions=partitions,
        maximum_per_partition=20,
        seed=104729,
        stage="calibration",
    )
    assert first == second
    assert len(first) == len(set(first))


def test_canonical_family_and_content_components_receive_one_split(tmp_path: Path) -> None:
    records, _manifest = _fixture(tmp_path)
    first = records[0]
    same_family = first.model_copy(
        update={"record_key": "sha256:" + "a" * 64, "content_hash": "sha256:" + "b" * 64}
    )
    same_content = first.model_copy(
        update={
            "record_key": "sha256:" + "c" * 64,
            "canonical_family_key": "sha256:" + "d" * 64,
        }
    )
    expanded = [*records, same_family, same_content]
    assignments = deterministic_splits(expanded, seed=104729, train=0.6, calibration=0.2)
    assert_no_leakage(expanded, assignments)
    split_by_key = {item.record_key: item.split for item in assignments}
    assert len({split_by_key[first.record_key], split_by_key[same_family.record_key]}) == 1
    assert len({split_by_key[first.record_key], split_by_key[same_content.record_key]}) == 1


def test_macro_micro_and_partition_gates(tmp_path: Path) -> None:
    records, manifest = _fixture(tmp_path)
    plan = load_plan(V3_PLAN)
    dry_run = dry_run_multiscope_contract(records, list(manifest.partitions), plan["hard_gates"])
    assert dry_run["valid_case"]["passes_coverage_gates"] is True
    assert dry_run["low_coverage_case"]["passes_coverage_gates"] is False
    assert dry_run["partition_gap_case"]["passes_coverage_gates"] is False
    assert dry_run["unstable_case"]["passes_stability_gates"] is False
    assert dry_run["majority_stopword_case"]["passes_representation_gate"] is False
    assert dry_run["valid_case"]["multiscope"]["macro_equal_partition_coverage"] == 1
    assert dry_run["equal_partition_weights"] == {key: 0.25 for key in manifest.partitions}


def test_partition_language_market_platform_and_month_slices(tmp_path: Path) -> None:
    records, manifest = _fixture(tmp_path)
    metrics = multiscope_metrics(
        records,
        np.asarray([index % 12 for index in range(len(records))]),
        list(manifest.partitions),
    )
    primary = metrics["partitions"]["primary"]
    assert set(primary["slices"]) == {
        "declared_market",
        "language",
        "month",
        "platform",
    }
    assert set(primary["slices"]["declared_market"]) == {"MX"}


def test_missing_required_partition_fails_before_metrics(tmp_path: Path) -> None:
    records, manifest = _fixture(tmp_path)
    labels = np.asarray([index % 12 for index in range(len(records))])
    with pytest.raises(ValueError, match="benchmark_required_partition_missing:missing"):
        multiscope_metrics(records, labels, [*manifest.partitions, "missing"])


def test_candidate_gates_reject_parameter_drift_and_fabricated_coverage(
    tmp_path: Path,
) -> None:
    records, manifest = _fixture(tmp_path)
    plan = load_plan(V3_PLAN)
    labels = np.asarray([index % 12 for index in range(len(records))])
    multiscope = multiscope_metrics(records, labels, list(manifest.partitions))
    metrics = {
        "effective_topics": 12,
        "topic_diversity": 0.8,
        "peak_rss_bytes": 1,
        "estimated_full_runtime_seconds": 1,
        "representation": {"majority_stopword_topic_rate": 0},
        "cluster_geometry": {"nearest_cluster_separation_mean": 0.1},
        "cluster_size_distribution": {"largest_cluster_share": 0.1},
        "diagnostics": {
            "parameters_changed": False,
            "declared_parameters": {"x": 1},
            "effective_parameters": {"x": 1},
        },
        "accounting_reconciles": True,
        "multiscope": multiscope,
    }
    assert passes_hard_gates(metrics, plan["hard_gates"]) is True
    metrics["diagnostics"]["effective_parameters"] = {"x": 2}
    assert passes_hard_gates(metrics, plan["hard_gates"]) is False


def test_provider_remote_and_serving_writes_are_rejected_by_manifest(tmp_path: Path) -> None:
    _records, manifest = _fixture(tmp_path)
    payload = manifest.model_dump(mode="json")
    for field in ("provider_calls", "writes_performed", "serving_writes"):
        changed = dict(payload)
        changed[field] = 1
        with pytest.raises(ValidationError):
            ExportManifestV2.model_validate(changed)


def test_prepare_seals_lineage_but_execution_and_holdout_remain_closed(
    tmp_path: Path,
) -> None:
    _records, manifest = _fixture(tmp_path)
    plan_path = _fixture_plan(tmp_path, manifest)
    load_plan(plan_path)
    source = tmp_path / "fixture" / "source-export-v2.private.jsonl"
    manifest_path = tmp_path / "fixture" / "source-export-v2.manifest.private.json"
    run_dir = tmp_path / "run"
    state = prepare_run(source, manifest_path, run_dir, plan_path=plan_path)
    assert state["holdout_state"] == "sealed"
    assert state["execution_authorized"] is False
    assert state["provider_calls"] == state["remote_writes"] == 0
    with pytest.raises(ValueError, match="benchmark_execution_not_authorized"):
        run_stage(run_dir, "smoke")


def test_wrong_corpus_digest_is_rejected_before_any_stage(tmp_path: Path) -> None:
    _records, manifest = _fixture(tmp_path)
    plan_path = _fixture_plan(tmp_path, manifest)
    plan = json.loads(plan_path.read_text())
    plan["corpus"]["content_digest"] = "sha256:" + "0" * 64
    plan_path.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match="benchmark_preregistered_corpus_digest_mismatch"):
        prepare_run(
            tmp_path / "fixture" / "source-export-v2.private.jsonl",
            tmp_path / "fixture" / "source-export-v2.manifest.private.json",
            tmp_path / "bad-run",
            plan_path=plan_path,
        )


def test_partial_candidate_artifact_is_rejected_instead_of_resumed(tmp_path: Path) -> None:
    plan = load_plan(V3_PLAN)
    stage_dir = tmp_path / "smoke"
    stage_dir.mkdir()
    partial = stage_dir / "candidate.seed-104729.result.json"
    partial.write_text("{}")
    with pytest.raises(ValueError, match="benchmark_partial_candidate_artifact"):
        load_completed_result(stage_dir, "candidate", 104729, plan)


def test_completed_candidate_artifact_is_reused_only_with_exact_lineage(tmp_path: Path) -> None:
    plan = load_plan(V3_PLAN)
    stage_dir = tmp_path / "smoke"
    stage_dir.mkdir()
    assignments = stage_dir / "candidate.seed-104729.assignments.npz"
    np.savez_compressed(assignments, labels=np.asarray([0, 1], dtype=np.int32))
    result_path = stage_dir / "candidate.seed-104729.result.json"
    result_path.write_text(
        json.dumps(
            {
                "candidate_key": "candidate",
                "seed": 104729,
                "state": "benchmark_only",
                "assignments_sha256": sha256_file(assignments),
                "artifact_manifest": {"plan_digest": plan_digest(plan)},
            }
        )
    )
    resumed = load_completed_result(stage_dir, "candidate", 104729, plan)
    assert resumed is not None
    assert resumed["result_sha256"] == sha256_file(result_path)

    changed = json.loads(result_path.read_text())
    changed["artifact_manifest"]["plan_digest"] = "sha256:" + "0" * 64
    result_path.write_text(json.dumps(changed))
    with pytest.raises(ValueError, match="benchmark_completed_candidate_identity_mismatch"):
        load_completed_result(stage_dir, "candidate", 104729, plan)
