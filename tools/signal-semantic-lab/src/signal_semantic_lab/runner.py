from __future__ import annotations

import json
import os
import platform
import shutil
import sys
from datetime import datetime
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np
import pandas as pd

from .artifacts import save_discovery_result
from .canonical import canonical_json, sha256_file, sha256_text, write_private_json
from .coherence import c_npmi
from .discovery import CandidateTechnicalRejection, run_bertopic, run_fastopic, run_lexical_nmf
from .embeddings import encode_records, load_embeddings
from .input_data import load_export, observed_counts
from .metrics import (
    assignment_metrics,
    cluster_geometry_metrics,
    cluster_size_distribution,
    merge_split_burden,
    representation_metrics,
    slice_coverage,
    topic_diversity,
    topic_redundancy,
)
from .multiscope import (
    multiscope_metrics,
    passes_multiscope_hard_gates,
    smoke_partition_limit,
    stratified_multiscope_indexes,
)
from .plan import (
    discovery_config,
    embedding_config,
    load_plan,
    load_run_plan,
    plan_digest,
    require_digest_value,
)
from .review_packet import build_blinded_packet
from .schema import BenchmarkRecord, BenchmarkRecordV2, ExportManifest, ExportManifestV2
from .splits import assert_no_leakage, deterministic_splits, stable_value
from .stability import (
    match_clusters,
    paired_bootstrap_stability,
    stability_metrics,
    topic_term_jaccard,
)
from .telemetry import measure_resources


def prepare_run(
    input_path: Path,
    manifest_path: Path,
    output_dir: Path,
    *,
    plan_path: Path | None = None,
    embedding_cache_dir: Path | None = None,
) -> dict[str, Any]:
    records, export_manifest = load_export(input_path, manifest_path)
    plan = load_plan(plan_path)
    assert_preregistered_corpus(plan, export_manifest, len(records))
    assignments = deterministic_splits(
        records,
        seed=int(plan["splits"]["seed"]),
        train=float(plan["splits"]["train_fraction"]),
        calibration=float(plan["splits"]["calibration_fraction"]),
    )
    assert_no_leakage(records, assignments)
    split_by_record = {item.record_key: item.split for item in assignments}
    output_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(output_dir, 0o700)
    sealed_plan = output_dir / "benchmark-plan.sealed.json"
    sealed_plan.write_text(canonical_json(plan) + "\n")
    os.chmod(sealed_plan, 0o600)
    cache_dir = (embedding_cache_dir or output_dir / "embedding-cache.private").resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(cache_dir, 0o700)
    frame = pd.DataFrame(
        [
            {
                "record_key": record.record_key,
                "canonical_family_key": record.canonical_family_key,
                "content_hash": record.content_hash,
                "published_at": record.published_at,
                "month": record.month,
                "language": record.language,
                "platform": record.platform,
                "scopes": _record_scopes(record),
                "partitions": _record_partitions(record),
                "declared_markets": _record_markets(record),
                "country": record.country,
                "text": record.text,
                "split": split_by_record[record.record_key],
            }
            for record in records
        ]
    )
    parquet_path = output_dir / "benchmark.private.parquet"
    frame.to_parquet(parquet_path, index=False)
    os.chmod(parquet_path, 0o600)
    copied_input = output_dir / "source-export.private.jsonl"
    copied_manifest = output_dir / "source-export.manifest.private.json"
    copied_input.write_bytes(input_path.read_bytes())
    copied_manifest.write_bytes(manifest_path.read_bytes())
    os.chmod(copied_input, 0o600)
    os.chmod(copied_manifest, 0o600)
    harness_source_digest = compute_harness_source_digest()
    lock_path = Path(__file__).resolve().parents[2] / "uv.lock"
    hardware = {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "python": sys.version.split()[0],
    }
    run = {
        "contract_version": (
            "signal-local-modeling-run-v2" if _is_v3(plan) else "signal-local-modeling-run-v1"
        ),
        "plan_digest": plan_digest(plan),
        "plan_file_sha256": sha256_file(sealed_plan),
        "harness_source_digest": harness_source_digest,
        "exporter_source_digest": export_manifest.exporter_source_digest
        if isinstance(export_manifest, ExportManifestV2)
        else export_manifest.projection_snapshot_digest,
        "dependency_lock_digest": sha256_file(lock_path),
        "embedding_cache_contract": "signal-content-addressed-embedding-cache-v1",
        "embedding_cache_dir": str(cache_dir),
        "export_manifest_digest": sha256_file(manifest_path),
        "export_file_digest": sha256_file(input_path),
        "record_count": len(records),
        "observed_counts": observed_counts(records),
        "split_counts": dict(sorted(frame["split"].value_counts().to_dict().items())),
        "split_digest": sha256_text(
            canonical_json(
                [
                    {"record_key": item.record_key, "split": item.split, "stratum": item.stratum}
                    for item in assignments
                ]
            )
        ),
        "parquet_sha256": sha256_file(parquet_path),
        "hardware": hardware,
        "hardware_fingerprint": sha256_text(canonical_json(hardware)),
        "stage_state": {
            "prepared": "completed",
            "smoke": "not_started",
            "calibration": "not_started",
            "full": "not_started",
            "multi_seed_complete": "not_started",
            "holdout_open_once": "not_started",
            "operator_review": "not_started",
        },
        "holdout_state": "sealed",
        "execution_authorized": bool(plan.get("execution_authorized", True)),
        "execution_authorization_digest": None,
        "holdout_authorization_digest": None,
        "full_finalists_digest": None,
        "provider_calls": 0,
        "remote_writes": 0,
        "serving_writes": 0,
        "status": "prepared",
    }
    write_private_json(output_dir / "run-state.private.json", run)
    return run


def run_stage(run_dir: Path, stage: str) -> dict[str, Any]:
    plan = load_run_plan(run_dir)
    run_state = json.loads((run_dir / "run-state.private.json").read_text())
    if run_state.get("plan_digest") != plan_digest(plan):
        raise ValueError("benchmark_run_plan_digest_mismatch")
    if run_state.get("harness_source_digest") != compute_harness_source_digest():
        raise ValueError("benchmark_run_harness_source_digest_mismatch")
    if _is_v3(plan):
        _assert_execution_authorized(run_dir, plan, run_state)
        _assert_stage_transition(run_state, stage)
        if run_state.get("holdout_state") != "sealed":
            raise ValueError("benchmark_holdout_opened_before_authorized_gate")
    records, export_manifest = load_export(
        run_dir / "source-export.private.jsonl", run_dir / "source-export.manifest.private.json"
    )
    assert_preregistered_corpus(plan, export_manifest, len(records))
    indexes = stage_indexes(records, stage, plan)
    selected = [records[index] for index in indexes]
    texts = [record.text for record in selected]
    stage_dir = run_dir / stage
    stage_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(stage_dir, 0o700)
    candidates = candidate_matrix(plan)
    if stage == "full":
        candidates = load_finalists(run_dir, plan)
    resource_rejections = load_resource_rejections(stage_dir, plan)
    candidates = [
        candidate
        for candidate in candidates
        if candidate_key_for(candidate) not in resource_rejections
    ]
    required_embedding_keys = {
        candidate["embedding"] for candidate in candidates if candidate.get("embedding") is not None
    }
    embedding_manifests: dict[str, Any] = {}
    for config in plan["embeddings"]:
        if config["key"] not in required_embedding_keys:
            continue
        embedding_identity = sha256_text(
            canonical_json(
                {
                    "config": config,
                    "records": [
                        {"record_key": record.record_key, "content_hash": record.content_hash}
                        for record in selected
                    ],
                }
            )
        )
        cache_key = embedding_identity.removeprefix("sha256:")[:16]
        embedding_manifest_path = stage_dir / f"{config['key']}.{cache_key}.embedding.json"
        embedding_manifest = _load_or_encode_embedding(
            texts=texts,
            config=config,
            benchmark_identity=embedding_identity,
            cache_dir=Path(run_state["embedding_cache_dir"]),
        )
        write_private_json(embedding_manifest_path, embedding_manifest)
        embedding_manifests[config["key"]] = embedding_manifest
    seeds = plan["stages"]["final_seeds"] if stage == "full" else [plan["stages"]["final_seeds"][0]]
    results: list[dict[str, Any]] = []
    candidate_rejections: list[dict[str, Any]] = []
    for candidate in candidates:
        for seed in seeds:
            candidate_key = candidate_key_for(candidate)
            rejected = load_candidate_rejection(stage_dir, candidate_key, int(seed), plan)
            if rejected is not None:
                candidate_rejections.append(rejected)
                continue
            result = load_completed_result(stage_dir, candidate_key, int(seed), plan)
            if result is None:
                try:
                    result = execute_candidate(
                        selected,
                        texts,
                        stage_dir,
                        candidate,
                        int(seed),
                        plan,
                        embedding_manifests,
                    )
                except CandidateTechnicalRejection as rejection:
                    rejected = seal_candidate_rejection(
                        stage_dir,
                        candidate_key,
                        int(seed),
                        rejection.reason,
                        plan,
                        str(run_state["harness_source_digest"]),
                    )
                    candidate_rejections.append(rejected)
                    continue
            results.append(result)
    if stage == "calibration":
        finalists = select_finalists(results, plan)
        write_private_json(run_dir / "finalists.private.json", finalists)
    summary = {
        "contract_version": (
            "signal-local-modeling-stage-v2" if _is_v3(plan) else "signal-local-modeling-stage-v1"
        ),
        "stage": stage,
        "record_count": len(selected),
        "population_denominator": _manifest_denominator(export_manifest),
        "population_exported": export_manifest.exported,
        "resource_rejections": list(resource_rejections.values()),
        "candidate_rejections": candidate_rejections,
        "results": [sanitize_result(item) for item in results],
    }
    write_private_json(stage_dir / "summary.private.json", summary)
    if _is_v3(plan):
        run_state["stage_state"][stage] = "completed"
        if stage == "full":
            run_state["stage_state"]["multi_seed_complete"] = "completed"
        run_state["status"] = f"{stage}_completed"
        write_private_json(run_dir / "run-state.private.json", run_state)
    return summary


def assert_preregistered_corpus(
    plan: dict[str, Any],
    export_manifest: ExportManifest | ExportManifestV2,
    record_count: int,
) -> None:
    if _is_v3(plan):
        if not isinstance(export_manifest, ExportManifestV2):
            raise ValueError("benchmark_preregistered_export_contract_mismatch")
        corpus = plan["corpus"]
        expected = {
            "population_digest": corpus["population_digest"],
            "content_digest": corpus["content_digest"],
            "provenance_digest": corpus["provenance_digest"],
            "watermark_digest": corpus["watermark_digest"],
            "acquisition_denominator": int(corpus["acquisition_denominator"]),
            "modeling_population": int(corpus["included_modeling_population"]),
            "quality_excluded_roots": int(corpus["quality_excluded_roots"]),
        }
        observed = {
            "population_digest": export_manifest.population_digest,
            "content_digest": export_manifest.content_digest,
            "provenance_digest": export_manifest.provenance_digest,
            "watermark_digest": export_manifest.watermark_digest,
            "acquisition_denominator": export_manifest.acquisition_denominator,
            "modeling_population": export_manifest.modeling_population,
            "quality_excluded_roots": export_manifest.quality_excluded_roots,
        }
        if observed != expected or record_count != expected["modeling_population"]:
            raise ValueError("benchmark_preregistered_corpus_digest_mismatch")
        expected_partitions = {item["key"]: item for item in corpus["partitions"]}
        if set(export_manifest.partitions) != set(expected_partitions):
            raise ValueError("benchmark_required_partition_missing")
        for key, partition in export_manifest.partitions.items():
            frozen = expected_partitions[key]
            compared = {
                "scope": partition.scope,
                "entity_ref": partition.entity_ref,
                "declared_market": partition.declared_market,
                "total": partition.total,
                "included": partition.included,
                "excluded": partition.excluded,
                "population_digest": partition.population_digest,
                "modeling_digest": partition.modeling_digest,
                "plan_version": partition.plan_version,
                "plan_digest": partition.plan_digest,
                "slot_digest": partition.slot_digest,
            }
            expected_partition = {name: frozen[name] for name in compared}
            if compared != expected_partition:
                raise ValueError(f"benchmark_partition_drift:{key}")
        return
    sealed_content_digest = plan["corpus"].get("sealed_content_digest")
    if sealed_content_digest and export_manifest.content_digest != sealed_content_digest:
        raise ValueError("benchmark_preregistered_corpus_digest_mismatch")
    if record_count < int(plan["corpus"]["minimum_full_population"]):
        raise ValueError("benchmark_preregistered_population_too_small")


def execute_candidate(
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    texts: list[str],
    stage_dir: Path,
    candidate: dict[str, Any],
    seed: int,
    plan: dict[str, Any],
    embedding_manifests: dict[str, Any],
) -> dict[str, Any]:
    discovery = discovery_config(plan, candidate["discovery"])
    embedding_key = candidate.get("embedding")
    embeddings = None
    if embedding_key:
        embeddings = load_embeddings(Path(embedding_manifests[embedding_key]["output_path"]))
    with measure_resources() as telemetry:
        framework = str(discovery["framework"]).casefold()
        if framework == "scikit-learn":
            output = run_lexical_nmf(texts, discovery, seed)
        elif framework == "bertopic":
            output = run_bertopic(texts, embeddings, discovery, seed)
        elif framework == "fastopic":
            output = run_fastopic(texts, embeddings, discovery, seed)
        else:  # pragma: no cover - plan validation prevents this
            raise ValueError("benchmark_discovery_unknown")
    coherence_started = perf_counter()
    coherence, coherence_count = c_npmi(
        texts,
        output.terms,
        max_records=int(plan["metrics"]["coherence_max_records"]),
        record_keys=[record.record_key for record in records],
    )
    coherence_seconds = perf_counter() - coherence_started
    run_state = json.loads((stage_dir.parent / "run-state.private.json").read_text())
    embedding_duration = float(
        embedding_manifests.get(embedding_key, {}).get("telemetry", {}).get("duration_seconds", 0)
    )
    embedding_peak_rss = int(
        embedding_manifests.get(embedding_key, {}).get("telemetry", {}).get("peak_rss_bytes", 0)
    )
    metrics_started = perf_counter()
    metrics = {
        **assignment_metrics(output.labels),
        "membership_strength_availability": output.strength_availability,
        "topic_diversity": topic_diversity(output.terms, int(plan["metrics"]["top_terms"])),
        "topic_redundancy": topic_redundancy(output.terms, int(plan["metrics"]["top_terms"])),
        "c_npmi": coherence,
        "coherence_sample_size": coherence_count,
        "slice_coverage": slice_coverage(records, output.labels),
        "duration_seconds": telemetry.duration_seconds,
        "cpu_seconds": telemetry.cpu_seconds,
        "peak_rss_bytes": max(telemetry.peak_rss_bytes, embedding_peak_rss),
        "discovery_peak_rss_bytes": telemetry.peak_rss_bytes,
        "embedding_peak_rss_bytes": embedding_peak_rss if embedding_key else None,
        "throughput_records_per_second": (
            len(records) / telemetry.duration_seconds if telemetry.duration_seconds else None
        ),
        "in_memory_assignment_bytes": int(output.labels.nbytes + output.strengths.nbytes),
        "merge_split_burden": merge_split_burden(
            output.terms, output.labels, int(plan["metrics"]["top_terms"])
        ),
        "representation": representation_metrics(
            output.terms,
            top_n=int(plan["metrics"]["top_terms"]),
            language_families=list(discovery["language_families"]),
        ),
        "cluster_geometry": cluster_geometry_metrics(embeddings, output.labels, seed=seed),
        "cluster_size_distribution": cluster_size_distribution(output.labels),
        "embedding_telemetry": embedding_manifests.get(embedding_key, {}).get("telemetry"),
        "incremental_embedding_estimate": _incremental_embedding_estimate(
            embedding_manifests.get(embedding_key), len(records)
        ),
        "incremental_feasibility": {
            "embedding": _incremental_embedding_estimate(
                embedding_manifests.get(embedding_key), len(records)
            ),
            "cluster_assignment": {
                "availability": "not_available",
                "reason": "No adopted incremental assignment runtime exists in Gate 10C.1.",
            },
            "cluster_retraining": {
                "availability": "not_available",
                "reason": "A benchmark run cannot establish a production retraining contract.",
            },
        },
        "gold_metrics": {
            "availability": "not_available",
            "precision": None,
            "recall": None,
            "f1": None,
            "pr_auc": None,
            "ece": None,
            "brier": None,
            "reliability_curve": None,
            "risk_coverage": None,
            "confusion_matrix": None,
            "reason": "No human gold set comparable to unsupervised topic discovery exists.",
        },
        "representative_document_quality": {
            "availability": "operator_review_required",
            "source": "blinded-review-packet",
        },
        "diagnostics": output.diagnostics,
    }
    if records and isinstance(records[0], BenchmarkRecordV2):
        typed_records = [record for record in records if isinstance(record, BenchmarkRecordV2)]
        metrics["multiscope"] = multiscope_metrics(
            typed_records,
            output.labels,
            [partition["key"] for partition in plan["corpus"]["partitions"]],
        )
    evaluation_seconds = perf_counter() - metrics_started
    runtime_components = {
        "embedding_seconds": embedding_duration,
        "discovery_seconds": telemetry.duration_seconds,
        "coherence_seconds": coherence_seconds,
        "evaluation_seconds": evaluation_seconds,
    }
    pre_serialization_seconds = sum(runtime_components.values())
    metrics["runtime_components_seconds"] = runtime_components
    metrics["runtime_projection_population"] = int(run_state["record_count"])
    metrics["observed_candidate_pipeline_before_serialization_seconds"] = pre_serialization_seconds
    metrics["estimated_full_runtime_seconds"] = (
        pre_serialization_seconds / max(1, len(records)) * int(run_state["record_count"])
    )
    candidate_key = candidate_key_for(candidate)
    lock_path = Path(__file__).resolve().parents[2] / "uv.lock"
    if not lock_path.is_file():
        raise ValueError("benchmark_uv_lock_missing")
    artifact_state = "operator_review_required" if stage_dir.name == "full" else "benchmark_only"
    artifact_manifest = {
        "artifact_key": candidate_key,
        "artifact_version": "benchmark-10c1-v1",
        "artifact_type": "topic-discovery-benchmark",
        "embedding": embedding_config(plan, embedding_key) if embedding_key else None,
        "discovery": discovery,
        "runtime_device": embedding_manifests.get(embedding_key, {}).get(
            "execution_provider", "cpu"
        ),
        "dataset_export_digest": json.loads(
            (stage_dir.parent / "source-export.manifest.private.json").read_text()
        )["content_digest"],
        "seed": seed,
        "plan_digest": plan_digest(plan),
        "parameters_digest": sha256_text(
            canonical_json(
                {
                    "candidate": candidate,
                    "discovery": discovery,
                    "embedding": embedding_config(plan, embedding_key) if embedding_key else None,
                    "seed": seed,
                }
            )
        ),
        "package_lock_digest": sha256_file(lock_path),
        "harness_source_digest": run_state["harness_source_digest"],
        "split_digest": run_state["split_digest"],
        "gold_digest": None,
        "hardware": run_state["hardware"],
        "state": artifact_state,
        "provider_calls": 0,
        "serving_writes": 0,
        "embedding_manifest": embedding_manifests.get(embedding_key),
    }
    return save_discovery_result(
        stage_dir,
        candidate_key,
        seed,
        output.labels,
        output.strengths,
        output.terms,
        metrics,
        artifact_manifest,
        artifact_state,
    )


def stage_indexes(
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    stage: str,
    plan: dict[str, Any],
) -> list[int]:
    if stage == "full":
        return list(range(len(records)))
    split_name = "train" if stage == "smoke" else "calibration"
    assignments = deterministic_splits(
        records,
        seed=int(plan["splits"]["seed"]),
        train=float(plan["splits"]["train_fraction"]),
        calibration=float(plan["splits"]["calibration_fraction"]),
    )
    if _is_v3(plan):
        typed_records = [record for record in records if isinstance(record, BenchmarkRecordV2)]
        if len(typed_records) != len(records):
            raise ValueError("benchmark_record_contract_mismatch")
        partition_keys = [partition["key"] for partition in plan["corpus"]["partitions"]]
        if stage == "smoke":
            limit = smoke_partition_limit(
                int(plan["stages"]["smoke_max_records"]), len(partition_keys)
            )
        else:
            limit = int(plan["stages"]["maximum_calibration_roots_per_partition"])
        return stratified_multiscope_indexes(
            typed_records,
            assignments,
            split=split_name,
            required_partitions=partition_keys,
            maximum_per_partition=limit,
            seed=int(plan["splits"]["seed"]),
            stage=stage,
        )
    stratum_by_key = {
        assignment.record_key: assignment.stratum
        for assignment in assignments
        if assignment.split == split_name
    }
    limit = int(plan["stages"][f"{stage}_max_records"])
    by_stratum: dict[str, list[int]] = {}
    for index, record in enumerate(records):
        stratum = stratum_by_key.get(record.record_key)
        if stratum is not None:
            by_stratum.setdefault(stratum, []).append(index)
    eligible_count = sum(len(indexes) for indexes in by_stratum.values())
    target = min(limit, eligible_count)
    if target == eligible_count:
        return sorted(index for indexes in by_stratum.values() for index in indexes)
    ideals = {
        stratum: target * len(indexes) / eligible_count for stratum, indexes in by_stratum.items()
    }
    quotas = {stratum: int(ideal) for stratum, ideal in ideals.items()}
    remaining = target - sum(quotas.values())
    for stratum in sorted(
        by_stratum,
        key=lambda value: (-(ideals[value] - quotas[value]), value),
    )[:remaining]:
        quotas[stratum] += 1
    selected: list[int] = []
    for stratum, indexes in sorted(by_stratum.items()):
        ranked = sorted(
            indexes,
            key=lambda index: stable_value(
                int(plan["splits"]["seed"]), f"{stage}:{records[index].record_key}"
            ),
        )
        selected.extend(ranked[: quotas[stratum]])
    if len(selected) != target:
        raise ValueError("benchmark_stratified_stage_count_mismatch")
    return sorted(selected)


def candidate_matrix(plan: dict[str, Any]) -> list[dict[str, Any]]:
    if plan.get("contract_version") in {
        "signal-local-modeling-benchmark-plan-v2",
        "signal-local-modeling-benchmark-plan-v3",
    }:
        return [dict(candidate) for candidate in plan["candidates"]]
    matrix = [{"discovery": "lexical-nmf", "embedding": None}]
    for discovery in ("bertopic", "fastopic"):
        for embedding in plan["embeddings"]:
            matrix.append({"discovery": discovery, "embedding": embedding["key"]})
    return matrix


def select_finalists(results: list[dict[str, Any]], plan: dict[str, Any]) -> dict[str, Any]:
    gates = plan["hard_gates"]
    passing = [item for item in results if passes_hard_gates(item["metrics"], gates)]
    if plan.get("contract_version") in {
        "signal-local-modeling-benchmark-plan-v2",
        "signal-local-modeling-benchmark-plan-v3",
    }:
        limit = int(plan["stages"]["finalist_count"])
        selected = sorted(
            [row for row in passing if not row["candidate_key"].startswith("lexical")],
            key=technical_sort_key,
        )[:limit]
        return {
            "contract_version": "signal-local-modeling-finalists-v2",
            "selection_rule": gates["finalist_selection"],
            "candidate_keys": [item["candidate_key"] for item in selected],
            "state": "finalist_available" if selected else "no_adoption",
            "reason": None if selected else "no_candidate_passed_preregistered_calibration_gates",
            "passing_candidate_keys": [item["candidate_key"] for item in passing],
        }
    selected: list[dict[str, Any]] = []
    for framework in ("bertopic", "fastopic"):
        framework_rows = [row for row in passing if row["candidate_key"].startswith(framework)]
        if framework_rows:
            selected.append(sorted(framework_rows, key=technical_sort_key)[0])
    if len(selected) < int(plan["stages"]["finalist_count"]):
        remaining = [
            row
            for row in passing
            if row not in selected and not row["candidate_key"].startswith("lexical")
        ]
        needed = int(plan["stages"]["finalist_count"]) - len(selected)
        selected.extend(sorted(remaining, key=technical_sort_key)[:needed])
    if len(selected) != int(plan["stages"]["finalist_count"]):
        return {
            "contract_version": "signal-local-modeling-finalists-v1",
            "selection_rule": gates["finalist_selection"],
            "candidate_keys": [],
            "state": "no_adoption",
            "reason": "no_operable_finalist_pair_after_preregistered_hard_gates",
            "passing_candidate_keys": [item["candidate_key"] for item in passing],
        }
    return {
        "contract_version": "signal-local-modeling-finalists-v1",
        "selection_rule": gates["finalist_selection"],
        "candidate_keys": [item["candidate_key"] for item in selected],
        "state": "operator_review_required",
    }


def load_finalists(run_dir: Path, plan: dict[str, Any]) -> list[dict[str, Any]]:
    finalist_path = run_dir / "finalists.private.json"
    if not finalist_path.exists():
        raise ValueError("benchmark_calibration_required_before_full")
    keys = json.loads(finalist_path.read_text())["candidate_keys"]
    by_key = {candidate_key_for(candidate): candidate for candidate in candidate_matrix(plan)}
    return [by_key[key] for key in keys]


def passes_hard_gates(metrics: dict[str, Any], gates: dict[str, Any]) -> bool:
    if "minimum_global_coverage" in gates:
        base = _passes_v3_candidate_gates(metrics, gates)
        return base and passes_multiscope_hard_gates(metrics, gates)
    coverage = metrics.get("coverage")
    diversity = metrics.get("topic_diversity")
    effective = metrics.get("effective_topics")
    base = bool(
        coverage is not None
        and coverage >= gates["minimum_coverage"]
        and diversity is not None
        and diversity >= gates["minimum_topic_diversity"]
        and gates["minimum_effective_topics"] <= effective <= gates["maximum_effective_topics"]
        and metrics["peak_rss_bytes"] <= gates["max_peak_ram_bytes"]
        and metrics["estimated_full_runtime_seconds"]
        <= gates["maximum_estimated_full_runtime_seconds"]
    )
    if "maximum_majority_stopword_topic_rate" not in gates:
        return base
    diagnostics = metrics.get("diagnostics", {})
    if not (
        diagnostics.get("parameters_changed") is False
        and diagnostics.get("declared_parameters") is not None
        and diagnostics.get("declared_parameters") == diagnostics.get("effective_parameters")
    ):
        return False
    representation = metrics.get("representation", {})
    geometry = metrics.get("cluster_geometry", {})
    sizes = metrics.get("cluster_size_distribution", {})
    stopword_rate = representation.get("majority_stopword_topic_rate")
    largest_share = sizes.get("largest_cluster_share")
    separation = geometry.get("nearest_cluster_separation_mean")
    return bool(
        base
        and stopword_rate is not None
        and stopword_rate <= gates["maximum_majority_stopword_topic_rate"]
        and largest_share is not None
        and largest_share <= gates["maximum_largest_cluster_share"]
        and separation is not None
        and separation >= gates["minimum_nearest_cluster_separation_mean"]
        and metrics.get("accounting_reconciles") is True
    )


def _passes_v3_candidate_gates(metrics: dict[str, Any], gates: dict[str, Any]) -> bool:
    diversity = metrics.get("topic_diversity")
    effective = metrics.get("effective_topics")
    representation = metrics.get("representation", {})
    geometry = metrics.get("cluster_geometry", {})
    sizes = metrics.get("cluster_size_distribution", {})
    diagnostics = metrics.get("diagnostics", {})
    return bool(
        diversity is not None
        and float(diversity) >= float(gates["minimum_topic_diversity"])
        and effective is not None
        and int(gates["minimum_effective_topics"])
        <= int(effective)
        <= int(gates["maximum_effective_topics"])
        and int(metrics.get("peak_rss_bytes", gates["maximum_peak_ram_bytes"] + 1))
        <= int(gates["maximum_peak_ram_bytes"])
        and float(
            metrics.get(
                "estimated_full_runtime_seconds",
                float(gates["maximum_full_runtime_seconds"]) + 1,
            )
        )
        <= float(gates["maximum_full_runtime_seconds"])
        and representation.get("majority_stopword_topic_rate") is not None
        and float(representation["majority_stopword_topic_rate"])
        <= float(gates["maximum_majority_stopword_topic_rate"])
        and sizes.get("largest_cluster_share") is not None
        and float(sizes["largest_cluster_share"]) <= float(gates["maximum_largest_cluster_share"])
        and geometry.get("nearest_cluster_separation_mean") is not None
        and float(geometry["nearest_cluster_separation_mean"])
        >= float(gates["minimum_nearest_cluster_separation_mean"])
        and diagnostics.get("parameters_changed") is False
        and diagnostics.get("declared_parameters") == diagnostics.get("effective_parameters")
        and metrics.get("accounting_reconciles") is True
    )


def technical_sort_key(result: dict[str, Any]) -> tuple[float, float, float, float]:
    metrics = result["metrics"]
    multiscope = metrics.get("multiscope", {})
    primary_coverage = multiscope.get("macro_equal_partition", {}).get(
        "coverage", metrics["coverage"]
    )
    return (
        -float(primary_coverage),
        -float(metrics["topic_diversity"]),
        float(metrics["topic_redundancy"] if metrics["topic_redundancy"] is not None else 1),
        float(metrics["duration_seconds"]),
    )


def candidate_key_for(candidate: dict[str, Any]) -> str:
    if candidate.get("key"):
        return str(candidate["key"])
    if not candidate.get("embedding"):
        return candidate["discovery"]
    return f"{candidate['discovery']}--{candidate['embedding']}"


def _is_v3(plan: dict[str, Any]) -> bool:
    return plan.get("contract_version") == "signal-local-modeling-benchmark-plan-v3"


def _manifest_denominator(manifest: ExportManifest | ExportManifestV2) -> int:
    if isinstance(manifest, ExportManifestV2):
        return manifest.acquisition_denominator
    return manifest.denominator


def _record_scopes(record: BenchmarkRecord | BenchmarkRecordV2) -> list[str]:
    if isinstance(record, BenchmarkRecordV2):
        return sorted({item.scope for item in record.partition_memberships})
    return sorted({item.scope for item in record.provenance_intents})


def _record_partitions(record: BenchmarkRecord | BenchmarkRecordV2) -> list[str]:
    if isinstance(record, BenchmarkRecordV2):
        return sorted({item.partition_key for item in record.partition_memberships})
    return []


def _record_markets(record: BenchmarkRecord | BenchmarkRecordV2) -> list[str]:
    if isinstance(record, BenchmarkRecordV2):
        return sorted({item.declared_market for item in record.partition_memberships})
    return []


def _assert_stage_transition(run_state: dict[str, Any], stage: str) -> None:
    if stage not in {"smoke", "calibration", "full"}:
        raise ValueError("benchmark_stage_invalid")
    required = {
        "smoke": "prepared",
        "calibration": "smoke",
        "full": "calibration",
    }[stage]
    stage_state = run_state.get("stage_state", {})
    if stage_state.get(stage) == "completed":
        return
    if stage_state.get(required) != "completed":
        raise ValueError(f"benchmark_stage_prerequisite_missing:{required}")


def authorize_run(run_dir: Path, authorization_path: Path) -> dict[str, Any]:
    """Apply an explicit external execution authorization without mutating the plan.

    The preregistration remains sealed with ``execution_authorized=false``. This
    transition records a separate operator-owned authorization whose digest is bound to
    the exact plan and export manifest. The harness never creates this authorization.
    """

    plan = load_run_plan(run_dir)
    if not _is_v3(plan):
        raise ValueError("benchmark_execution_authorization_requires_v3")
    run_state = _load_run_state(run_dir, plan)
    payload = _load_authorization(
        authorization_path,
        expected_contract="signal-local-modeling-execution-authorization-v1",
        expected_action="authorize_execution",
        expected_plan_digest=plan_digest(plan),
    )
    if payload["export_manifest_digest"] != run_state["export_manifest_digest"]:
        raise ValueError("benchmark_execution_authorization_export_mismatch")
    if payload["authorized_stages"] != ["smoke", "calibration", "full"]:
        raise ValueError("benchmark_execution_authorization_stages_invalid")
    existing = run_state.get("execution_authorization_digest")
    sealed_path = run_dir / "execution-authorization.sealed.private.json"
    if run_state.get("execution_authorized") is True:
        if (
            existing != payload["authorization_digest"]
            or not sealed_path.is_file()
            or json.loads(sealed_path.read_text()) != payload
        ):
            raise ValueError("benchmark_execution_authorization_incompatible_replay")
        return {
            "contract_version": payload["contract_version"],
            "authorization_digest": existing,
            "execution_authorized": True,
            "replayed": True,
        }
    if sealed_path.exists():
        if json.loads(sealed_path.read_text()) != payload:
            raise ValueError("benchmark_execution_authorization_partial_state")
    else:
        write_private_json(sealed_path, payload)
    run_state["execution_authorized"] = True
    run_state["execution_authorization_digest"] = payload["authorization_digest"]
    run_state["status"] = "execution_authorized"
    write_private_json(run_dir / "run-state.private.json", run_state)
    return {
        "contract_version": payload["contract_version"],
        "authorization_digest": payload["authorization_digest"],
        "execution_authorized": True,
        "replayed": False,
    }


def freeze_full_finalists(run_dir: Path) -> dict[str, Any]:
    """Seal the exact full results before any holdout transition."""

    plan = load_run_plan(run_dir)
    run_state = _load_run_state(run_dir, plan)
    if not _is_v3(plan):
        raise ValueError("benchmark_execution_authorization_required_before_finalist_freeze")
    _assert_execution_authorized(run_dir, plan, run_state)
    stage_state = run_state.get("stage_state", {})
    if (
        stage_state.get("full") != "completed"
        or stage_state.get("multi_seed_complete") != "completed"
    ):
        raise ValueError("benchmark_full_multiseed_required_before_finalist_freeze")
    finalists_path = run_dir / "finalists.private.json"
    summary_path = run_dir / "full" / "summary.private.json"
    if not finalists_path.is_file() or not summary_path.is_file():
        raise ValueError("benchmark_full_finalist_artifact_missing")
    stability = build_stability(run_dir)
    stability_path = run_dir / "full" / "stability.private.json"
    calibration_candidate_keys = json.loads(finalists_path.read_text())["candidate_keys"]
    technical_candidate_keys = [
        key
        for key in calibration_candidate_keys
        if passes_full_candidate_gates(run_dir, key, plan)
        and passes_full_stability_gates(stability.get(key, {}), plan["hard_gates"])
    ]
    payload = {
        "contract_version": "signal-local-modeling-full-finalists-freeze-v2",
        "plan_digest": plan_digest(plan),
        "export_manifest_digest": run_state["export_manifest_digest"],
        "finalists_sha256": sha256_file(finalists_path),
        "full_summary_sha256": sha256_file(summary_path),
        "stability_sha256": sha256_file(stability_path),
        "calibration_candidate_keys": calibration_candidate_keys,
        "candidate_keys": technical_candidate_keys,
        "stability_candidate_keys": sorted(stability),
        "technical_result": ("finalists_frozen" if technical_candidate_keys else "no_adoption"),
        "holdout_authorization_required": bool(technical_candidate_keys),
        "holdout_opened": False,
    }
    payload["full_finalists_digest"] = sha256_text(canonical_json(payload))
    path = run_dir / "full-finalists.sealed.private.json"
    if path.is_file():
        existing = json.loads(path.read_text())
        if existing != payload:
            raise ValueError("benchmark_full_finalists_freeze_incompatible_replay")
    else:
        write_private_json(path, payload)
    run_state["full_finalists_digest"] = payload["full_finalists_digest"]
    run_state["status"] = "full_finalists_frozen"
    write_private_json(run_dir / "run-state.private.json", run_state)
    return payload


def open_holdout_once(run_dir: Path, authorization_path: Path) -> dict[str, Any]:
    """Record the one-way holdout opening after full finalists are frozen."""

    plan = load_run_plan(run_dir)
    run_state = _load_run_state(run_dir, plan)
    if not _is_v3(plan):
        raise ValueError("benchmark_execution_authorization_required_before_holdout")
    _assert_execution_authorized(run_dir, plan, run_state)
    payload = _load_authorization(
        authorization_path,
        expected_contract="signal-local-modeling-holdout-authorization-v1",
        expected_action="open_holdout_once",
        expected_plan_digest=plan_digest(plan),
    )
    frozen_digest = run_state.get("full_finalists_digest")
    require_digest_value(frozen_digest, "benchmark_full_finalists_not_frozen")
    if payload["full_finalists_digest"] != frozen_digest:
        raise ValueError("benchmark_holdout_authorization_finalists_mismatch")
    if run_state.get("holdout_state") == "opened_once":
        sealed_path = run_dir / "holdout-authorization.sealed.private.json"
        if (
            run_state.get("holdout_authorization_digest") != payload["authorization_digest"]
            or not sealed_path.is_file()
            or json.loads(sealed_path.read_text()) != payload
        ):
            raise ValueError("benchmark_holdout_authorization_incompatible_replay")
        return {
            "contract_version": payload["contract_version"],
            "holdout_state": "opened_once",
            "authorization_digest": payload["authorization_digest"],
            "replayed": True,
        }
    if run_state.get("holdout_state") != "sealed":
        raise ValueError("benchmark_holdout_state_invalid")
    sealed_path = run_dir / "holdout-authorization.sealed.private.json"
    if sealed_path.exists():
        if json.loads(sealed_path.read_text()) != payload:
            raise ValueError("benchmark_holdout_authorization_partial_state")
    else:
        write_private_json(sealed_path, payload)
    run_state["holdout_state"] = "opened_once"
    run_state["holdout_authorization_digest"] = payload["authorization_digest"]
    run_state["stage_state"]["holdout_open_once"] = "completed"
    run_state["status"] = "holdout_opened_once"
    write_private_json(run_dir / "run-state.private.json", run_state)
    return {
        "contract_version": payload["contract_version"],
        "holdout_state": "opened_once",
        "authorization_digest": payload["authorization_digest"],
        "full_finalists_digest": frozen_digest,
        "replayed": False,
    }


def _load_run_state(run_dir: Path, plan: dict[str, Any]) -> dict[str, Any]:
    path = run_dir / "run-state.private.json"
    if not path.is_file():
        raise ValueError("benchmark_run_state_missing")
    state = json.loads(path.read_text())
    if state.get("plan_digest") != plan_digest(plan):
        raise ValueError("benchmark_run_plan_digest_mismatch")
    if state.get("harness_source_digest") != compute_harness_source_digest():
        raise ValueError("benchmark_run_harness_source_digest_mismatch")
    safety_counters = ("provider_calls", "remote_writes", "serving_writes")
    if any(int(state.get(field, -1)) != 0 for field in safety_counters):
        raise ValueError("benchmark_run_safety_counter_nonzero")
    return state


def _load_authorization(
    path: Path,
    *,
    expected_contract: str,
    expected_action: str,
    expected_plan_digest: str,
) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    common = {
        "contract_version",
        "action",
        "plan_digest",
        "actor_ref",
        "authorized_at",
        "provider_calls_allowed",
        "remote_writes_allowed",
        "serving_writes_allowed",
        "ten_d_authorized",
        "authorization_digest",
    }
    extra = (
        {"export_manifest_digest", "authorized_stages"}
        if expected_action == "authorize_execution"
        else {"full_finalists_digest"}
    )
    if set(payload) != common | extra:
        raise ValueError("benchmark_authorization_shape_invalid")
    if (
        payload["contract_version"] != expected_contract
        or payload["action"] != expected_action
        or payload["plan_digest"] != expected_plan_digest
        or payload["provider_calls_allowed"] is not False
        or payload["remote_writes_allowed"] is not False
        or payload["serving_writes_allowed"] is not False
        or payload["ten_d_authorized"] is not False
    ):
        raise ValueError("benchmark_authorization_boundary_invalid")
    require_digest_value(payload["plan_digest"], "benchmark_authorization_plan_digest_invalid")
    require_digest_value(payload["actor_ref"], "benchmark_authorization_actor_ref_invalid")
    timestamp = datetime.fromisoformat(str(payload["authorized_at"]))
    if timestamp.utcoffset() is None:
        raise ValueError("benchmark_authorization_timestamp_timezone_required")
    supplied = require_digest_value(
        payload["authorization_digest"], "benchmark_authorization_digest_invalid"
    )
    unsigned = {key: value for key, value in payload.items() if key != "authorization_digest"}
    if supplied != sha256_text(canonical_json(unsigned)):
        raise ValueError("benchmark_authorization_digest_mismatch")
    return payload


def _assert_execution_authorized(
    run_dir: Path, plan: dict[str, Any], run_state: dict[str, Any]
) -> None:
    if run_state.get("execution_authorized") is not True:
        raise ValueError("benchmark_execution_not_authorized")
    path = run_dir / "execution-authorization.sealed.private.json"
    if not path.is_file():
        raise ValueError("benchmark_execution_authorization_missing")
    payload = _load_authorization(
        path,
        expected_contract="signal-local-modeling-execution-authorization-v1",
        expected_action="authorize_execution",
        expected_plan_digest=plan_digest(plan),
    )
    if (
        payload["authorization_digest"] != run_state.get("execution_authorization_digest")
        or payload["export_manifest_digest"] != run_state.get("export_manifest_digest")
        or payload["authorized_stages"] != ["smoke", "calibration", "full"]
    ):
        raise ValueError("benchmark_execution_authorization_state_mismatch")


def _assert_holdout_authorized(
    run_dir: Path, plan: dict[str, Any], run_state: dict[str, Any]
) -> None:
    path = run_dir / "holdout-authorization.sealed.private.json"
    if not path.is_file():
        raise ValueError("benchmark_holdout_authorization_missing")
    payload = _load_authorization(
        path,
        expected_contract="signal-local-modeling-holdout-authorization-v1",
        expected_action="open_holdout_once",
        expected_plan_digest=plan_digest(plan),
    )
    if payload["authorization_digest"] != run_state.get("holdout_authorization_digest") or payload[
        "full_finalists_digest"
    ] != run_state.get("full_finalists_digest"):
        raise ValueError("benchmark_holdout_authorization_state_mismatch")


def compute_harness_source_digest() -> str:
    root = Path(__file__).resolve().parents[2]
    paths = [
        root / ".python-version",
        root / "pyproject.toml",
        root / "uv.lock",
        *sorted((root / "src").rglob("*.py")),
    ]
    if any(not path.is_file() for path in paths):
        raise ValueError("benchmark_harness_source_incomplete")
    return sha256_text(
        canonical_json(
            [{"path": str(path.relative_to(root)), "sha256": sha256_file(path)} for path in paths]
        )
    )


def load_resource_rejections(
    stage_dir: Path, plan: dict[str, Any] | None = None
) -> dict[str, dict[str, Any]]:
    path = stage_dir / "resource-rejections.private.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text())
    if payload.get("contract_version") != "signal-local-modeling-resource-rejections-v1":
        raise ValueError("benchmark_resource_rejection_contract_invalid")
    rows = payload.get("rejections")
    if not isinstance(rows, list):
        raise ValueError("benchmark_resource_rejections_invalid")
    output: dict[str, dict[str, Any]] = {}
    valid_candidates = {
        candidate_key_for(candidate) for candidate in candidate_matrix(plan or load_plan())
    }
    for row in rows:
        candidate_key = row.get("candidate_key")
        if candidate_key not in valid_candidates or row.get("state") != "rejected":
            raise ValueError("benchmark_resource_rejection_invalid")
        if candidate_key in output:
            raise ValueError("benchmark_resource_rejection_duplicate")
        output[candidate_key] = row
    return output


def load_completed_result(
    stage_dir: Path, candidate_key: str, seed: int, plan: dict[str, Any]
) -> dict[str, Any] | None:
    result_path = stage_dir / f"{candidate_key}.seed-{seed}.result.json"
    assignments_path = stage_dir / f"{candidate_key}.seed-{seed}.assignments.npz"
    if not result_path.exists() and not assignments_path.exists():
        return None
    if not result_path.exists() or not assignments_path.exists():
        raise ValueError("benchmark_partial_candidate_artifact")
    payload = json.loads(result_path.read_text())
    expected_state = "operator_review_required" if stage_dir.name == "full" else "benchmark_only"
    if (
        payload.get("candidate_key") != candidate_key
        or payload.get("seed") != seed
        or payload.get("state") != expected_state
        or payload.get("assignments_sha256") != sha256_file(assignments_path)
        or payload.get("artifact_manifest", {}).get("plan_digest") != plan_digest(plan)
    ):
        raise ValueError("benchmark_completed_candidate_identity_mismatch")
    return {
        **payload,
        "result_path": str(result_path),
        "result_sha256": sha256_file(result_path),
    }


def load_candidate_rejection(
    stage_dir: Path, candidate_key: str, seed: int, plan: dict[str, Any]
) -> dict[str, Any] | None:
    path = stage_dir / f"{candidate_key}.seed-{seed}.rejection.json"
    if not path.exists():
        return None
    payload = json.loads(path.read_text())
    if (
        payload.get("contract_version") != "signal-local-modeling-candidate-technical-rejection-v1"
        or payload.get("candidate_key") != candidate_key
        or payload.get("seed") != seed
        or payload.get("state") != "rejected"
        or payload.get("plan_digest") != plan_digest(plan)
        or not isinstance(payload.get("reason"), str)
        or not payload["reason"]
    ):
        raise ValueError("benchmark_candidate_rejection_identity_mismatch")
    return {**payload, "rejection_sha256": sha256_file(path)}


def seal_candidate_rejection(
    stage_dir: Path,
    candidate_key: str,
    seed: int,
    reason: str,
    plan: dict[str, Any],
    harness_source_digest: str,
) -> dict[str, Any]:
    payload = {
        "contract_version": "signal-local-modeling-candidate-technical-rejection-v1",
        "candidate_key": candidate_key,
        "seed": seed,
        "state": "rejected",
        "reason": reason,
        "plan_digest": plan_digest(plan),
        "harness_source_digest": harness_source_digest,
        "provider_calls": 0,
        "remote_writes": 0,
        "serving_writes": 0,
    }
    path = stage_dir / f"{candidate_key}.seed-{seed}.rejection.json"
    if path.is_file():
        existing = json.loads(path.read_text())
        if existing != payload:
            raise ValueError("benchmark_candidate_rejection_incompatible_replay")
    else:
        write_private_json(path, payload)
    return {**payload, "rejection_sha256": sha256_file(path)}


def sanitize_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidate_key": result["candidate_key"],
        "seed": result["seed"],
        "metrics": result["metrics"],
        "state": result["state"],
        "result_sha256": result["result_sha256"],
    }


def build_packet(run_dir: Path) -> dict[str, Any]:
    plan = load_run_plan(run_dir)
    run_state = (
        _load_run_state(run_dir, plan)
        if _is_v3(plan)
        else json.loads((run_dir / "run-state.private.json").read_text())
    )
    modeling_harness_source_digest = str(run_state["harness_source_digest"])
    packet_harness_source_digest = compute_harness_source_digest()
    records, export_manifest = load_export(
        run_dir / "source-export.private.jsonl", run_dir / "source-export.manifest.private.json"
    )
    finalist_payload = json.loads((run_dir / "finalists.private.json").read_text())
    finalists = finalist_payload["candidate_keys"]
    if _is_v3(plan):
        stage_state = run_state.get("stage_state", {})
        _assert_full_finalists_frozen(run_dir, run_state, plan)
        frozen = json.loads((run_dir / "full-finalists.sealed.private.json").read_text())
        finalists = frozen["candidate_keys"]
        if finalists and (
            stage_state.get("multi_seed_complete") != "completed"
            or stage_state.get("holdout_open_once") != "completed"
            or run_state.get("holdout_state") != "opened_once"
        ):
            raise ValueError("benchmark_holdout_gate_required_before_packet")
        if finalists:
            _assert_execution_authorized(run_dir, plan, run_state)
            _assert_holdout_authorized(run_dir, plan, run_state)
            _assert_full_finalists_frozen(run_dir, run_state, plan)
        if not finalists and stage_state.get("full") != "completed":
            raise ValueError("benchmark_full_required_before_no_adoption_packet")
    if not finalists:
        result = build_no_adoption_packet(
            run_dir, records, _manifest_denominator(export_manifest), plan
        )
        sealed = seal_packet_source_lineage(
            result, modeling_harness_source_digest, packet_harness_source_digest
        )
        _mark_packet_ready(run_dir, run_state)
        return sealed
    stability = build_stability(run_dir)
    stable_finalists = [
        key
        for key in finalists
        if passes_full_stability_gates(stability[key], plan["hard_gates"])
        and passes_full_candidate_gates(run_dir, key, plan)
    ]
    if not stable_finalists:
        result = build_unstable_full_packet(
            run_dir,
            records,
            _manifest_denominator(export_manifest),
            plan,
            finalists,
            stability,
        )
        sealed = seal_packet_source_lineage(
            result, modeling_harness_source_digest, packet_harness_source_digest
        )
        _mark_packet_ready(run_dir, run_state)
        return sealed
    seed = int(plan["stages"]["final_seeds"][0])
    candidate_results = [
        {
            **json.loads((run_dir / "full" / f"{key}.seed-{seed}.result.json").read_text()),
            "assignments_path": str(run_dir / "full" / f"{key}.seed-{seed}.assignments.npz"),
            "stability_summary": summarize_stability(stability[key]),
        }
        for key in stable_finalists
    ]
    result = build_blinded_packet(
        records,
        candidate_results,
        run_dir / "operator-review",
        seed=271828,
        population_denominator=_manifest_denominator(export_manifest),
    )
    sealed = seal_packet_source_lineage(
        result, modeling_harness_source_digest, packet_harness_source_digest
    )
    _mark_packet_ready(run_dir, run_state)
    return sealed


def _mark_packet_ready(run_dir: Path, run_state: dict[str, Any]) -> None:
    if "stage_state" not in run_state:
        return
    run_state["stage_state"]["operator_review"] = "packet_ready"
    run_state["status"] = "operator_review_packet_ready"
    write_private_json(run_dir / "run-state.private.json", run_state)


def _assert_full_finalists_frozen(
    run_dir: Path, run_state: dict[str, Any], plan: dict[str, Any]
) -> None:
    path = run_dir / "full-finalists.sealed.private.json"
    if not path.is_file():
        raise ValueError("benchmark_full_finalists_not_frozen")
    payload = json.loads(path.read_text())
    supplied = payload.get("full_finalists_digest")
    unsigned = {key: value for key, value in payload.items() if key != "full_finalists_digest"}
    if (
        supplied != run_state.get("full_finalists_digest")
        or supplied != sha256_text(canonical_json(unsigned))
        or payload.get("plan_digest") != plan_digest(plan)
        or payload.get("finalists_sha256") != sha256_file(run_dir / "finalists.private.json")
        or payload.get("full_summary_sha256")
        != sha256_file(run_dir / "full" / "summary.private.json")
        or payload.get("stability_sha256")
        != sha256_file(run_dir / "full" / "stability.private.json")
    ):
        raise ValueError("benchmark_full_finalists_freeze_drift")


def seal_packet_source_lineage(
    result: dict[str, Any],
    modeling_harness_source_digest: str,
    packet_harness_source_digest: str,
) -> dict[str, Any]:
    packet_path = Path(result["packet"])
    packet = json.loads(packet_path.read_text())
    packet["modeling_harness_source_digest"] = modeling_harness_source_digest
    packet["packet_harness_source_digest"] = packet_harness_source_digest
    packet["packet_built_after_modeling_harness_change"] = (
        modeling_harness_source_digest != packet_harness_source_digest
    )
    write_private_json(packet_path, packet)
    return {
        **result,
        "modeling_harness_source_digest": modeling_harness_source_digest,
        "packet_harness_source_digest": packet_harness_source_digest,
        "packet_built_after_modeling_harness_change": (
            modeling_harness_source_digest != packet_harness_source_digest
        ),
        "packet_sha256": sha256_file(packet_path),
    }


def build_unstable_full_packet(
    run_dir: Path,
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    population_denominator: int,
    plan: dict[str, Any],
    finalist_keys: list[str],
    stability: dict[str, Any],
) -> dict[str, Any]:
    seed = int(plan["stages"]["final_seeds"][0])
    candidate_results = [
        {
            **json.loads((run_dir / "full" / f"{key}.seed-{seed}.result.json").read_text()),
            "assignments_path": str(run_dir / "full" / f"{key}.seed-{seed}.assignments.npz"),
            "stability_summary": summarize_stability(stability[key]),
        }
        for key in finalist_keys
    ]
    return build_blinded_packet(
        records,
        candidate_results,
        run_dir / "operator-review",
        seed=271828,
        review_status="technical_no_adoption_review",
        sample_scope="full_population",
        population_denominator=population_denominator,
        modeling_decision_allowed=False,
        technical_limitations=[
            (
                "Calibration finalists did not pass every preregistered full-population "
                "quality/resource/stability gate."
            ),
            "The packet supports diagnosis only and cannot select a production winner.",
        ],
    )


def summarize_stability(comparisons: dict[str, dict[str, Any]]) -> dict[str, float | int | str]:
    if not comparisons:
        return {"availability": "not_available", "comparison_count": 0}
    return {
        "availability": "available",
        "comparison_count": len(comparisons),
        "minimum_adjusted_rand": min(
            float(metrics["adjusted_rand"]) for metrics in comparisons.values()
        ),
        "minimum_matched_assignment_consistency": min(
            float(metrics["matched_assignment_consistency"]) for metrics in comparisons.values()
        ),
    }


def build_no_adoption_packet(
    run_dir: Path,
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    population_denominator: int,
    plan: dict[str, Any],
) -> dict[str, Any]:
    calibration_records = [records[index] for index in stage_indexes(records, "calibration", plan)]
    summary = json.loads((run_dir / "calibration" / "summary.private.json").read_text())
    candidate_results = [
        {
            **json.loads(
                (
                    run_dir
                    / "calibration"
                    / f"{row['candidate_key']}.seed-{row['seed']}.result.json"
                ).read_text()
            ),
            "assignments_path": str(
                run_dir
                / "calibration"
                / f"{row['candidate_key']}.seed-{row['seed']}.assignments.npz"
            ),
        }
        for row in summary["results"]
    ]
    output_dir = run_dir / "operator-review"
    result = build_blinded_packet(
        calibration_records,
        candidate_results,
        output_dir,
        seed=271828,
        review_status="technical_no_adoption_review",
        sample_scope="calibration_subset",
        population_denominator=population_denominator,
        modeling_decision_allowed=False,
        technical_limitations=[
            "No operable finalist pair passed the preregistered calibration gates.",
            "Calibration topics are qualitative diagnostics only and are not population counts.",
            (
                "A human review may accept the no-adoption outcome or request a new "
                "preregistered benchmark; it cannot select a production winner from "
                "this packet."
            ),
        ],
    )
    packet_path = Path(result["packet"])
    key_path = Path(result["key"])
    packet = json.loads(packet_path.read_text())
    key = json.loads(key_path.read_text())
    resource_rows = list(summary.get("resource_rejections", []))
    resource_rows.sort(key=lambda row: sha256_text(f"271828:{row['candidate_key']}"))
    packet["resource_rejections"] = []
    for index, row in enumerate(resource_rows, start=1):
        label = f"Resource Candidate {index}"
        key[label] = row["candidate_key"]
        packet["resource_rejections"].append(
            {
                "candidate_label": label,
                "state": "rejected",
                "reason": row["reason"],
                "completed_epochs": row["completed_epochs"],
                "configured_epochs": row["configured_epochs"],
                "projected_full_runtime_lower_bound_seconds": row[
                    "projected_full_runtime_lower_bound_seconds"
                ],
                "quality_metrics_available": False,
            }
        )
    write_private_json(packet_path, packet)
    write_private_json(key_path, key)
    return {
        **result,
        "review_status": packet["review_status"],
        "modeling_decision_allowed": False,
    }


def passes_full_stability_gates(
    comparisons: dict[str, dict[str, Any]], gates: dict[str, Any]
) -> bool:
    consistency_gate = gates.get(
        "minimum_full_matched_assignment_consistency",
        gates.get("minimum_matched_assignment_consistency"),
    )
    return (
        bool(comparisons)
        and consistency_gate is not None
        and all(
            float(metrics["adjusted_rand"]) >= float(gates["minimum_full_adjusted_rand"])
            and float(metrics["matched_assignment_consistency"]) >= float(consistency_gate)
            for metrics in comparisons.values()
        )
    )


def passes_full_candidate_gates(run_dir: Path, candidate_key: str, plan: dict[str, Any]) -> bool:
    for seed in plan["stages"]["final_seeds"]:
        result_path = run_dir / "full" / f"{candidate_key}.seed-{int(seed)}.result.json"
        if not result_path.is_file():
            return False
        metrics = json.loads(result_path.read_text()).get("metrics", {})
        if not passes_hard_gates(metrics, plan["hard_gates"]):
            return False
    return True


def build_stability(run_dir: Path) -> dict[str, Any]:
    plan = load_run_plan(run_dir)
    records, _manifest = load_export(
        run_dir / "source-export.private.jsonl", run_dir / "source-export.manifest.private.json"
    )
    finalists = json.loads((run_dir / "finalists.private.json").read_text())["candidate_keys"]
    seeds = [int(value) for value in plan["stages"]["final_seeds"]]
    report: dict[str, Any] = {}
    for key in finalists:
        reference = np.load(run_dir / "full" / f"{key}.seed-{seeds[0]}.assignments.npz")["labels"]
        reference_result = json.loads(
            (run_dir / "full" / f"{key}.seed-{seeds[0]}.result.json").read_text()
        )
        reference_terms = {
            int(topic): values for topic, values in reference_result["terms"].items()
        }
        comparisons: dict[str, Any] = {}
        for seed in seeds[1:]:
            candidate = np.load(run_dir / "full" / f"{key}.seed-{seed}.assignments.npz")["labels"]
            candidate_result = json.loads(
                (run_dir / "full" / f"{key}.seed-{seed}.result.json").read_text()
            )
            candidate_terms = {
                int(topic): values for topic, values in candidate_result["terms"].items()
            }
            mapping = match_clusters(reference, candidate)
            comparisons[str(seed)] = {
                **stability_metrics(reference, candidate),
                "topic_term_jaccard": topic_term_jaccard(reference_terms, candidate_terms, mapping),
                "paired_bootstrap": paired_bootstrap_stability(
                    reference, candidate, seed=seeds[0] ^ seed
                ),
                "temporal": _temporal_stability(records, reference, candidate),
            }
        report[key] = comparisons
    write_private_json(run_dir / "full" / "stability.private.json", report)
    return report


def _incremental_embedding_estimate(
    embedding_manifest: dict[str, Any] | None, record_count: int
) -> dict[str, float | int | str] | None:
    if not embedding_manifest or record_count <= 0:
        return None
    telemetry = embedding_manifest.get("telemetry", {})
    duration = float(telemetry.get("duration_seconds") or 0)
    dimension = int(embedding_manifest["dimension"])
    return {
        "seconds_per_1000_records": duration / record_count * 1000,
        "float32_bytes_per_1000_records": dimension * 4 * 1000,
        "contract": "observed-embedding-only-linear-estimate-v1",
    }


def _temporal_stability(
    records: list[BenchmarkRecord], reference: np.ndarray, candidate: np.ndarray
) -> dict[str, Any]:
    months = sorted({record.month for record in records})
    output: dict[str, Any] = {}
    for month in months:
        indexes = np.asarray(
            [index for index, record in enumerate(records) if record.month == month],
            dtype=np.int64,
        )
        if len(indexes) < 20:
            output[month] = {"availability": "not_available", "denominator": len(indexes)}
        else:
            output[month] = {
                "availability": "available",
                "denominator": len(indexes),
                **stability_metrics(reference[indexes], candidate[indexes]),
            }
    return output


def _load_or_encode_embedding(
    *,
    texts: list[str],
    config: dict[str, Any],
    benchmark_identity: str,
    cache_dir: Path,
) -> dict[str, Any]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(cache_dir, 0o700)
    identity = benchmark_identity.removeprefix("sha256:")
    embedding_path = cache_dir / f"{config['key']}.{identity}.npy"
    manifest_path = cache_dir / f"{config['key']}.{identity}.json"
    if embedding_path.is_file() and manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        expected_backend = "onnx" if config["key"] == "bge-m3" else "torch"
        expected_execution_provider = (
            str(config["onnx_execution_provider"]) if expected_backend == "onnx" else "PyTorchCPU"
        )
        if (
            manifest.get("benchmark_identity") != benchmark_identity
            or manifest.get("output_sha256") != sha256_file(embedding_path)
            or manifest.get("record_count") != len(texts)
            or manifest.get("dimension") != int(config["dimension"])
            or manifest.get("embedding_key") != config["key"]
            or manifest.get("repository") != config["repository"]
            or manifest.get("revision") != config["revision"]
            or manifest.get("backend") != expected_backend
            or manifest.get("execution_provider") != expected_execution_provider
            or manifest.get("verified_artifacts") != config["artifact_files"]
        ):
            raise ValueError("benchmark_embedding_cache_identity_mismatch")
        return {
            **manifest,
            "output_path": str(embedding_path.resolve()),
            "cache_hit": True,
        }
    if embedding_path.exists() or manifest_path.exists():
        raise ValueError("benchmark_embedding_cache_partial")
    with measure_resources() as telemetry:
        manifest = encode_records(
            texts,
            config,
            embedding_path,
            benchmark_identity=benchmark_identity,
        )
    payload = {
        **manifest,
        "cache_contract": "signal-content-addressed-embedding-cache-v1",
        "cache_hit": False,
        "telemetry": {
            "duration_seconds": telemetry.duration_seconds,
            "cpu_seconds": telemetry.cpu_seconds,
            "peak_rss_bytes": telemetry.peak_rss_bytes,
        },
    }
    write_private_json(manifest_path, payload)
    return payload


def import_embedding_cache(source_manifest_path: Path, cache_dir: Path) -> dict[str, Any]:
    """Import a previously sealed embedding artifact into the content-addressed cache."""
    source_manifest = json.loads(source_manifest_path.read_text())
    required = {
        "embedding_key",
        "benchmark_identity",
        "record_count",
        "dimension",
        "output_path",
        "output_sha256",
    }
    if not required <= source_manifest.keys():
        raise ValueError("benchmark_embedding_import_manifest_incomplete")
    source_path = Path(source_manifest["output_path"])
    if not source_path.is_file() or sha256_file(source_path) != source_manifest["output_sha256"]:
        raise ValueError("benchmark_embedding_import_digest_mismatch")
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(cache_dir, 0o700)
    identity = str(source_manifest["benchmark_identity"]).removeprefix("sha256:")
    prefix = f"{source_manifest['embedding_key']}.{identity}"
    target_path = cache_dir / f"{prefix}.npy"
    target_manifest_path = cache_dir / f"{prefix}.json"
    if target_path.is_file() or target_manifest_path.is_file():
        if not target_path.is_file() or not target_manifest_path.is_file():
            raise ValueError("benchmark_embedding_import_partial_target")
        existing = json.loads(target_manifest_path.read_text())
        if (
            existing.get("output_sha256") != source_manifest["output_sha256"]
            or sha256_file(target_path) != source_manifest["output_sha256"]
        ):
            raise ValueError("benchmark_embedding_import_incompatible_replay")
        return {**existing, "replayed": True}
    shutil.copyfile(source_path, target_path)
    os.chmod(target_path, 0o600)
    payload = {
        **source_manifest,
        "output_path": str(target_path.resolve()),
        "cache_contract": "signal-content-addressed-embedding-cache-v1",
        "imported_from_sealed_manifest_sha256": sha256_file(source_manifest_path),
    }
    write_private_json(target_manifest_path, payload)
    return {**payload, "replayed": False}
