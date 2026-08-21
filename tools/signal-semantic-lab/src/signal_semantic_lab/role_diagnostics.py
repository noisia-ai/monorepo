from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from .canonical import canonical_json, require_private, sha256_file, sha256_text, write_private_json
from .input_data import load_export
from .review_packet import build_blinded_packet
from .schema import BenchmarkRecordV2, DiscoveryProposalV1, ExportManifestV2
from .stability import match_clusters
from .telemetry import measure_resources

DIAGNOSTIC_CONTRACT = "signal-topic-role-separation-diagnostic-v1"
BATCH_SIZE = 1_024


def diagnose_role_separation(
    evidence_dir: Path,
    output_dir: Path,
    *,
    expected_evidence_manifest_sha256: str | None = None,
) -> dict[str, Any]:
    """Diagnose an already-completed discovery run without opening benchmark splits."""

    evidence_dir = evidence_dir.resolve()
    output_dir = output_dir.resolve()
    _reject_holdout_paths(evidence_dir, output_dir)
    if expected_evidence_manifest_sha256 is None:
        raise ValueError("benchmark_diagnostic_expected_manifest_digest_required")
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_dir.chmod(0o700)
    replay_manifest = output_dir / "manifest.sanitized.json"
    if replay_manifest.exists():
        return _validate_replay(output_dir)

    manifest_path = evidence_dir / "manifest.sanitized.json"
    require_private(manifest_path)
    if sha256_file(manifest_path) != expected_evidence_manifest_sha256:
        raise ValueError("benchmark_diagnostic_evidence_manifest_drift")
    run_dir = _resolve_model_run(evidence_dir)
    lineage = _load_and_validate_lineage(evidence_dir, run_dir, manifest_path)

    source_path = run_dir / "source-export.private.jsonl"
    source_manifest_path = run_dir / "source-export.manifest.private.json"
    records, export_manifest = load_export(source_path, source_manifest_path)
    if not isinstance(export_manifest, ExportManifestV2) or not all(
        isinstance(record, BenchmarkRecordV2) for record in records
    ):
        raise ValueError("benchmark_diagnostic_export_v2_required")
    typed_records = [record for record in records if isinstance(record, BenchmarkRecordV2)]
    _validate_rights(typed_records, export_manifest)

    results = [_load_full_result(run_dir, seed) for seed in lineage["final_seeds"]]
    reference_result = next(
        (result for result in results if result["seed"] == lineage["reference_seed"]), None
    )
    if reference_result is None:
        raise ValueError("benchmark_diagnostic_reference_seed_missing")
    embedding_path = Path(
        reference_result["artifact_manifest"]["embedding_manifest"]["output_path"]
    )
    vectors = _load_embedding(
        embedding_path,
        reference_result["artifact_manifest"]["embedding_manifest"]["output_sha256"],
        len(typed_records),
    )

    with measure_resources() as telemetry:
        labels_by_seed = {
            int(result["seed"]): _load_assignments(result, len(typed_records))[0]
            for result in results
        }
        diagnostics = []
        reference_labels = labels_by_seed[lineage["reference_seed"]]
        for result in results:
            labels, strengths, strength_availability = _load_assignments(
                result, len(typed_records)
            )
            diagnostics.append(
                _diagnose_seed(
                    typed_records,
                    vectors,
                    labels,
                    strengths,
                    strength_availability,
                    result,
                    reference_labels,
                    lineage["reference_seed"],
                )
            )

        packet_dir = output_dir / "operator-review"
        packet_candidate = {
            **reference_result,
            "stability_summary": _packet_stability_summary(lineage["stability"]),
        }
        packet_result = build_blinded_packet(
            typed_records,
            [packet_candidate],
            packet_dir,
            seed=lineage["reference_seed"],
            review_status="operator_diagnostic_review_required",
            sample_scope="full_population",
            population_denominator=export_manifest.acquisition_denominator,
            modeling_decision_allowed=False,
            diagnostic_role_separation=True,
            rights_evaluated_at=export_manifest.export_timestamp,
            technical_limitations=[
                "10C.2C rejected this candidate for full-population assignment.",
                "Human review is required to determine discovery-proposal utility.",
                "Holdout remains sealed and no adoption decision is allowed.",
            ],
        )
        _augment_diagnostic_packet(packet_dir, diagnostics, lineage)

    telemetry_payload = {
        "wall_seconds": telemetry.duration_seconds,
        "cpu_seconds": telemetry.cpu_seconds,
        "peak_rss_bytes": telemetry.peak_rss_bytes,
        "target_wall_seconds": 1_200,
        "target_peak_rss_bytes": 4_294_967_296,
        "target_met": telemetry.duration_seconds <= 1_200
        and telemetry.peak_rss_bytes <= 4_294_967_296,
    }
    analytic = {
        "contract_version": DIAGNOSTIC_CONTRACT,
        "diagnostic_harness_source_digest": _diagnostic_harness_source_digest(),
        "source_lineage": lineage,
        "corpus": {
            "acquisition_denominator": export_manifest.acquisition_denominator,
            "modeling_roots": export_manifest.modeling_population,
            "quality_excluded": export_manifest.quality_excluded_roots,
            "memberships": sum(
                len(record.partition_memberships) for record in typed_records
            ),
            "partitions": len(export_manifest.partitions),
            "shared_roots": export_manifest.shared_root_count,
            "unexplained_roots": 0,
        },
        "authority_boundaries": _authority_boundaries(lineage, export_manifest.export_timestamp),
        "candidate_verdict": {
            "candidate_key": lineage["candidate_key"],
            "full_population_assignment": "not_suitable_for_full_population_assignment",
            "discovery_proposal_generation": "unknown_for_discovery_proposal_generation",
            "operator_diagnostic_review_required": True,
            "operator_review_complete": False,
        },
        "seed_diagnostics": diagnostics,
        "complexity": _complexity_projection(
            len(typed_records), vectors.shape[1], diagnostics
        ),
        "packet": {
            "reference_seed": lineage["reference_seed"],
            "reference_seed_selection_basis": "first_preregistered_final_seed",
            "modeling_decision_allowed": False,
            "adoption_allowed": False,
            "holdout_opened": False,
            "count_scope": "full_population_diagnostic",
            "private_packet_sha256": sha256_file(Path(packet_result["packet"])),
            "private_score_sheet_sha256": sha256_file(
                packet_dir / "blind-review-score-sheet.private.csv"
            ),
        },
        "safety": {
            "holdout_state": "sealed",
            "holdout_opened": False,
            "provider_calls": 0,
            "remote_reads": 0,
            "remote_writes": 0,
            "serving_writes": 0,
            "new_embeddings": 0,
            "new_candidates_executed": 0,
            "dense_n_by_n_matrix_created": False,
        },
    }
    analytic_digest = sha256_text(canonical_json(analytic))
    private_payload = {
        **analytic,
        "analytic_digest": analytic_digest,
        "telemetry": telemetry_payload,
        "performance_projection": _performance_projection(
            analytic["complexity"], telemetry_payload
        ),
        "recorded_at": datetime.now(UTC).isoformat(),
    }
    private_path = output_dir / "diagnostic.private.json"
    write_private_json(private_path, private_payload)
    sanitized_path = output_dir / "diagnostic.sanitized.json"
    write_private_json(
        sanitized_path,
        {
            "contract_version": DIAGNOSTIC_CONTRACT,
            "analytic_digest": analytic_digest,
            "diagnostic_harness_source_digest": analytic[
                "diagnostic_harness_source_digest"
            ],
            "corpus": analytic["corpus"],
            "candidate_verdict": analytic["candidate_verdict"],
            "per_seed_summary": [
                {
                    "seed": row["seed"],
                    "cluster_count": row["cluster_count"],
                    "assigned_count": row["assigned_count"],
                    "outlier_count": row["outliers"]["count"],
                    "outlier_rate": row["outliers"]["rate"],
                    "membership_strength_availability": row[
                        "membership_strength_availability"
                    ],
                }
                for row in diagnostics
            ],
            "complexity": analytic["complexity"],
            "telemetry": telemetry_payload,
            "performance_projection": private_payload["performance_projection"],
            "safety": analytic["safety"],
            "advisor_reviewed": False,
            "advisor_cost_usd": 0,
        },
    )
    manifest = _write_evidence_manifest(output_dir, lineage, analytic_digest)
    return {
        "contract_version": DIAGNOSTIC_CONTRACT,
        "candidate_key": lineage["candidate_key"],
        "technical_result": "no_adoption",
        "discovery_proposal_verdict": "unknown_for_discovery_proposal_generation",
        "operator_review_complete": False,
        "holdout_opened": False,
        "diagnostic": str(private_path),
        "diagnostic_sha256": sha256_file(private_path),
        "manifest": str(output_dir / "manifest.sanitized.json"),
        "manifest_sha256": manifest,
        "wall_seconds": telemetry.duration_seconds,
        "peak_rss_bytes": telemetry.peak_rss_bytes,
        "provider_calls": 0,
        "remote_writes": 0,
        "serving_writes": 0,
    }


def _resolve_model_run(evidence_dir: Path) -> Path:
    if (evidence_dir / "run-state.private.json").exists():
        return evidence_dir
    candidates = []
    for path in evidence_dir.iterdir():
        if not path.is_dir() or not (path / "run-state.private.json").exists():
            continue
        state = _read_json(path / "run-state.private.json")
        freeze = path / "full-finalists.sealed.private.json"
        if state.get("status") == "full_finalists_frozen" and freeze.exists():
            candidates.append(path)
    if not candidates:
        raise ValueError("benchmark_diagnostic_completed_run_missing")
    return sorted(candidates, key=lambda path: path.name)[-1]


def _load_and_validate_lineage(
    evidence_dir: Path, run_dir: Path, evidence_manifest_path: Path
) -> dict[str, Any]:
    _verify_manifest_entry(evidence_dir, evidence_manifest_path, run_dir / "run-state.private.json")
    state = _read_json(run_dir / "run-state.private.json")
    if state.get("status") != "full_finalists_frozen":
        raise ValueError("benchmark_diagnostic_run_not_frozen")
    if state.get("holdout_state") != "sealed" or state.get("holdout_authorization_digest"):
        raise ValueError("benchmark_diagnostic_holdout_not_sealed")
    if any(state.get(key) != 0 for key in ("provider_calls", "remote_writes", "serving_writes")):
        raise ValueError("benchmark_diagnostic_source_safety_violation")
    required_stages = {"smoke", "calibration", "full", "multi_seed_complete"}
    if any(state["stage_state"].get(stage) != "completed" for stage in required_stages):
        raise ValueError("benchmark_diagnostic_source_stage_incomplete")
    if state["stage_state"].get("holdout_open_once") != "not_started":
        raise ValueError("benchmark_diagnostic_holdout_already_opened")

    plan_path = run_dir / "benchmark-plan.sealed.json"
    freeze_path = run_dir / "full-finalists.sealed.private.json"
    stability_path = run_dir / "full" / "stability.private.json"
    for path in (plan_path, freeze_path, stability_path):
        _verify_manifest_entry(evidence_dir, evidence_manifest_path, path)
    plan = _read_json(plan_path)
    freeze = _read_json(freeze_path)
    stability = _read_json(stability_path)
    if freeze.get("technical_result") != "no_adoption" or freeze.get("candidate_keys"):
        raise ValueError("benchmark_diagnostic_source_result_changed")
    candidates = freeze.get("calibration_candidate_keys") or []
    if len(candidates) != 1:
        raise ValueError("benchmark_diagnostic_candidate_ambiguous")
    final_seeds = _preregistered_seeds(plan)
    if not final_seeds:
        raise ValueError("benchmark_diagnostic_seed_contract_missing")
    candidate_key = candidates[0]
    if candidate_key not in freeze.get("stability_candidate_keys", []):
        raise ValueError("benchmark_diagnostic_stability_missing")
    immutable_inputs = [
        run_dir / "full" / "summary.private.json",
        run_dir / "source-export.private.jsonl",
        run_dir / "source-export.manifest.private.json",
    ]
    for seed in final_seeds:
        immutable_inputs.extend(
            [
                run_dir / "full" / f"{candidate_key}.seed-{seed}.result.json",
                run_dir / "full" / f"{candidate_key}.seed-{seed}.assignments.npz",
            ]
        )
    for path in immutable_inputs:
        _verify_manifest_entry(evidence_dir, evidence_manifest_path, path)
    return {
        "evidence_manifest_sha256": sha256_file(evidence_manifest_path),
        "run_state_sha256": sha256_file(run_dir / "run-state.private.json"),
        "plan_file_sha256": sha256_file(plan_path),
        "plan_digest": state["plan_digest"],
        "freeze_sha256": sha256_file(freeze_path),
        "full_finalists_digest": state["full_finalists_digest"],
        "export_file_digest": state["export_file_digest"],
        "export_manifest_digest": state["export_manifest_digest"],
        "harness_source_digest": state["harness_source_digest"],
        "candidate_key": candidate_key,
        "final_seeds": final_seeds,
        "reference_seed": final_seeds[0],
        "stability": stability[candidate_key],
        "holdout_state": "sealed",
    }


def _load_full_result(run_dir: Path, seed: int) -> dict[str, Any]:
    summary = _read_json(run_dir / "full" / "summary.private.json")
    candidate_keys = {row["candidate_key"] for row in summary["results"]}
    if len(candidate_keys) != 1:
        raise ValueError("benchmark_diagnostic_full_candidate_ambiguous")
    candidate = next(iter(candidate_keys))
    path = run_dir / "full" / f"{candidate}.seed-{seed}.result.json"
    require_private(path)
    result = _read_json(path)
    expected = next(
        row["result_sha256"]
        for row in summary["results"]
        if row["candidate_key"] == candidate and int(row["seed"]) == seed
    )
    if sha256_file(path) != expected:
        raise ValueError("benchmark_diagnostic_result_drift")
    assignments = Path(result["assignments_path"])
    require_private(assignments)
    if sha256_file(assignments) != result["assignments_sha256"]:
        raise ValueError("benchmark_diagnostic_assignment_drift")
    return result


def _load_assignments(
    result: dict[str, Any], expected_count: int
) -> tuple[np.ndarray, np.ndarray, str]:
    artifact = np.load(result["assignments_path"], allow_pickle=False)
    labels = np.asarray(artifact["labels"], dtype=np.int32)
    if labels.shape != (expected_count,):
        raise ValueError("benchmark_diagnostic_assignment_shape_mismatch")
    if "strengths" in artifact.files:
        strengths = np.asarray(artifact["strengths"], dtype=np.float32)
        if strengths.shape != labels.shape:
            raise ValueError("benchmark_diagnostic_strength_shape_mismatch")
        availability = "available" if np.any(np.isfinite(strengths)) else "not_available"
    else:
        strengths = np.full(expected_count, np.nan, dtype=np.float32)
        availability = "not_available"
    return labels, strengths, availability


def _validate_vectors(vectors: np.ndarray, expected_count: int) -> None:
    if vectors.ndim != 2 or vectors.shape[0] != expected_count or vectors.shape[1] <= 0:
        raise ValueError("benchmark_diagnostic_embedding_shape_mismatch")
    for start in range(0, len(vectors), BATCH_SIZE):
        if not np.isfinite(np.asarray(vectors[start : start + BATCH_SIZE])).all():
            raise ValueError("benchmark_diagnostic_embedding_non_finite")


def _load_embedding(path: Path, expected_digest: str, expected_count: int) -> np.ndarray:
    require_private(path)
    if sha256_file(path) != expected_digest:
        raise ValueError("benchmark_diagnostic_embedding_drift")
    vectors = np.load(path, mmap_mode="r", allow_pickle=False)
    _validate_vectors(vectors, expected_count)
    return vectors


def _preregistered_seeds(plan: dict[str, Any]) -> list[int]:
    seeds = [int(seed) for seed in plan["stages"]["final_seeds"]]
    if not seeds or len(seeds) != len(set(seeds)):
        raise ValueError("benchmark_diagnostic_seed_contract_missing")
    return seeds


def _diagnose_seed(
    records: list[BenchmarkRecordV2],
    vectors: np.ndarray,
    labels: np.ndarray,
    strengths: np.ndarray,
    strength_availability: str,
    result: dict[str, Any],
    reference_labels: np.ndarray,
    reference_seed: int,
) -> dict[str, Any]:
    topic_ids = sorted(int(value) for value in set(labels.tolist()) if value >= 0)
    if labels.size and not topic_ids and not np.all(labels < 0):
        raise ValueError("benchmark_diagnostic_cluster_state_invalid")
    centroids = _centroids_batched(vectors, labels, topic_ids)
    centroid_matrix = (
        np.stack([centroids[topic] for topic in topic_ids])
        if topic_ids
        else np.empty((0, vectors.shape[1]), dtype=np.float32)
    )
    nearest = _nearest_centroid_scores(
        vectors, centroid_matrix, labels=labels, topic_ids=topic_ids
    )
    terms = {int(key): values for key, values in result.get("terms", {}).items()}
    mapping = match_clusters(reference_labels, labels)
    cluster_rows = []
    for topic in topic_ids:
        indexes = np.flatnonzero(labels == topic)
        own_position = topic_ids.index(topic)
        own_scores = nearest["assigned"][indexes]
        neighbor_similarity, neighbor_id = _nearest_cluster(
            centroid_matrix, own_position, topic_ids
        )
        term_redundancy = _term_redundancy(topic, terms)
        cluster_rows.append(
            {
                "cluster_id": topic,
                "cluster_key": sha256_text(
                    f"{result['assignments_sha256']}:{topic}"
                ),
                "size": len(indexes),
                "effective_share": float(len(indexes) / len(records)),
                "distributions": _slice_distributions(records, indexes),
                "centroid_similarity": _quantiles(own_scores),
                "nearest_cluster": {
                    "cluster_id": neighbor_id,
                    "centroid_similarity": neighbor_similarity,
                    "separation": (
                        None if neighbor_similarity is None else 1.0 - neighbor_similarity
                    ),
                },
                "term_redundancy": term_redundancy,
                "merge_pair_indicator": (
                    "observed_term_jaccard_ge_0_5"
                    if term_redundancy["maximum_jaccard"] >= 0.5
                    else "not_observed"
                ),
                "stability_lineage": {
                    "reference_seed": reference_seed,
                    "matched_reference_cluster": mapping.get(topic),
                    "availability": (
                        "reference"
                        if result["seed"] == reference_seed
                        else "available"
                    ),
                },
                "representative_coverage": "operator_packet_bounded_for_reference_seed"
                if result["seed"] == reference_seed
                else "not_operator_reviewed",
            }
        )
    outlier_indexes = np.flatnonzero(labels < 0)
    outlier_nearest = nearest["first"][outlier_indexes]
    outlier_margin = nearest["margin"][outlier_indexes]
    return {
        "seed": int(result["seed"]),
        "assignment_digest": result["assignments_sha256"],
        "cluster_count": len(topic_ids),
        "assigned_count": int(np.sum(labels >= 0)),
        "membership_strength_availability": strength_availability,
        "membership_strength_summary": (
            _quantiles(strengths[np.isfinite(strengths)])
            if strength_availability == "available"
            else {"availability": "not_available", "reason": "artifact_has_no_probabilities"}
        ),
        "clusters": cluster_rows,
        "outliers": {
            "count": len(outlier_indexes),
            "rate": float(len(outlier_indexes) / len(records)),
            "distributions": _slice_distributions(records, outlier_indexes),
            "slice_impact": _outlier_slice_impact(records, labels),
            "nearest_centroid_similarity": _quantiles(outlier_nearest),
            "first_second_centroid_margin": _quantiles(outlier_margin),
            "near_far_classification": "not_available_threshold_not_preregistered",
            "interpretation": "operator_decision_required",
        },
    }


def _centroids_batched(
    vectors: np.ndarray, labels: np.ndarray, topic_ids: list[int]
) -> dict[int, np.ndarray]:
    if not topic_ids:
        return {}
    position = {topic: index for index, topic in enumerate(topic_ids)}
    sums = np.zeros((len(topic_ids), vectors.shape[1]), dtype=np.float64)
    counts = np.zeros(len(topic_ids), dtype=np.int64)
    for start in range(0, len(vectors), BATCH_SIZE):
        batch = np.asarray(vectors[start : start + BATCH_SIZE], dtype=np.float32)
        batch_labels = labels[start : start + BATCH_SIZE]
        for topic in np.unique(batch_labels[batch_labels >= 0]):
            slot = position[int(topic)]
            mask = batch_labels == topic
            sums[slot] += batch[mask].sum(axis=0, dtype=np.float64)
            counts[slot] += int(mask.sum())
    if np.any(counts == 0):
        raise ValueError("benchmark_diagnostic_empty_cluster")
    output = {}
    for topic, slot in position.items():
        centroid = np.asarray(sums[slot] / counts[slot], dtype=np.float32)
        norm = float(np.linalg.norm(centroid))
        if not np.isfinite(norm) or norm <= 0:
            raise ValueError("benchmark_diagnostic_centroid_invalid")
        output[topic] = centroid / norm
    return output


def _nearest_centroid_scores(
    vectors: np.ndarray,
    centroids: np.ndarray,
    *,
    labels: np.ndarray | None = None,
    topic_ids: list[int] | None = None,
) -> dict[str, np.ndarray]:
    count = len(vectors)
    if (labels is None) != (topic_ids is None):
        raise ValueError("benchmark_diagnostic_assigned_score_contract_invalid")
    if labels is not None and labels.shape != (count,):
        raise ValueError("benchmark_diagnostic_assignment_shape_mismatch")
    assigned = np.full(count, np.nan, dtype=np.float32)
    if len(centroids) == 0:
        return {
            "first": np.full(count, np.nan, dtype=np.float32),
            "second": np.full(count, np.nan, dtype=np.float32),
            "margin": np.full(count, np.nan, dtype=np.float32),
            "assigned": assigned,
        }
    first = np.empty(count, dtype=np.float32)
    second = np.full(count, np.nan, dtype=np.float32)
    topic_positions = {topic: position for position, topic in enumerate(topic_ids or [])}
    for start in range(0, count, BATCH_SIZE):
        batch = np.asarray(vectors[start : start + BATCH_SIZE], dtype=np.float32)
        norms = np.linalg.norm(batch, axis=1, keepdims=True)
        normalized = batch / np.maximum(norms, np.finfo(np.float32).eps)
        scores = normalized @ centroids.T
        ordered = np.sort(scores, axis=1)
        first[start : start + len(batch)] = ordered[:, -1]
        if len(centroids) > 1:
            second[start : start + len(batch)] = ordered[:, -2]
        if labels is not None:
            batch_labels = labels[start : start + len(batch)]
            for row, label in enumerate(batch_labels):
                position = topic_positions.get(int(label))
                if position is not None:
                    assigned[start + row] = scores[row, position]
    return {
        "first": first,
        "second": second,
        "margin": first - second,
        "assigned": assigned,
    }


def _slice_distributions(
    records: list[BenchmarkRecordV2], indexes: np.ndarray
) -> dict[str, dict[str, int]]:
    selected = [records[int(index)] for index in indexes]
    return {
        "partition": dict(
            sorted(
                Counter(
                    membership.partition_key
                    for record in selected
                    for membership in record.partition_memberships
                ).items()
            )
        ),
        "scope": dict(
            sorted(
                Counter(
                    membership.scope
                    for record in selected
                    for membership in record.partition_memberships
                ).items()
            )
        ),
        "entity": dict(
            sorted(
                Counter(
                    membership.entity_ref
                    for record in selected
                    for membership in record.partition_memberships
                ).items()
            )
        ),
        "language": dict(sorted(Counter(record.language for record in selected).items())),
        "declared_market": dict(
            sorted(
                Counter(
                    membership.declared_market
                    for record in selected
                    for membership in record.partition_memberships
                ).items()
            )
        ),
        "platform": dict(sorted(Counter(record.platform for record in selected).items())),
        "month": dict(sorted(Counter(record.month for record in selected).items())),
    }


def _outlier_slice_impact(
    records: list[BenchmarkRecordV2], labels: np.ndarray
) -> dict[str, dict[str, dict[str, float | int]]]:
    values: dict[str, dict[str, list[bool]]] = defaultdict(lambda: defaultdict(list))
    for record, label in zip(records, labels, strict=True):
        is_outlier = bool(label < 0)
        for membership in record.partition_memberships:
            values["partition"][membership.partition_key].append(is_outlier)
            values["scope"][membership.scope].append(is_outlier)
            values["entity"][membership.entity_ref].append(is_outlier)
            values["declared_market"][membership.declared_market].append(is_outlier)
        values["language"][record.language].append(is_outlier)
        values["platform"][record.platform].append(is_outlier)
        values["month"][record.month].append(is_outlier)
    global_rate = float(np.mean(labels < 0))
    return {
        dimension: {
            key: {
                "denominator": len(flags),
                "outliers": sum(flags),
                "outlier_rate": sum(flags) / len(flags),
                "rate_delta_from_global": sum(flags) / len(flags) - global_rate,
            }
            for key, flags in sorted(slices.items())
        }
        for dimension, slices in sorted(values.items())
    }


def _nearest_cluster(
    centroids: np.ndarray, position: int, topic_ids: list[int]
) -> tuple[float | None, int | None]:
    if len(centroids) < 2:
        return None, None
    scores = centroids @ centroids[position]
    scores[position] = -np.inf
    neighbor = int(np.argmax(scores))
    return float(scores[neighbor]), topic_ids[neighbor]


def _term_redundancy(topic: int, terms: dict[int, list[str]]) -> dict[str, Any]:
    left = set(terms.get(topic, []))
    best = 0.0
    neighbor = None
    for other, values in terms.items():
        if other == topic:
            continue
        right = set(values)
        score = len(left & right) / len(left | right) if left or right else 0.0
        if score > best:
            best = score
            neighbor = other
    return {"maximum_jaccard": best, "neighbor_cluster_id": neighbor}


def _quantiles(values: np.ndarray) -> dict[str, Any]:
    finite = np.asarray(values)[np.isfinite(values)]
    if len(finite) == 0:
        return {"availability": "not_available", "count": 0}
    return {
        "availability": "available",
        "count": len(finite),
        "minimum": float(np.min(finite)),
        "p10": float(np.quantile(finite, 0.1)),
        "median": float(np.median(finite)),
        "p90": float(np.quantile(finite, 0.9)),
        "maximum": float(np.max(finite)),
        "mean": float(np.mean(finite)),
    }


def _authority_boundaries(
    lineage: dict[str, Any], source_timestamp: datetime
) -> dict[str, Any]:
    proposal_body = {
        "candidate": lineage["candidate_key"],
        "assignments": lineage["full_finalists_digest"],
        "role": "discovery_proposal",
    }
    proposal = DiscoveryProposalV1(
        contract_version="signal-topic-discovery-proposal-v1",
        role="discovery_proposal",
        proposal_key=sha256_text(canonical_json(proposal_body)),
        discovery_run_digest=lineage["full_finalists_digest"],
        cluster_key=sha256_text(f"{lineage['candidate_key']}:diagnostic-cluster-placeholder"),
        evidence_digest=sha256_text(canonical_json(lineage)),
        disposition="pending",
        authority_state="proposal_only",
        operator_review_complete=False,
        generated_at=source_timestamp,
    )
    return {
        "roles": [
            "discovery_proposal",
            "topic_contract_candidate",
            "approved_topic_contract",
            "propagation_assignment",
        ],
        "discovery_proposal_fixture": proposal.model_dump(mode="json"),
        "real_topic_contracts_created": 0,
        "real_propagation_assignments_created": 0,
        "scores_grant_approval": False,
    }


def _complexity_projection(
    observed_roots: int,
    embedding_dimension: int,
    diagnostics: list[dict[str, Any]],
) -> dict[str, Any]:
    observed_clusters = max(row["cluster_count"] for row in diagnostics)
    scenarios = {}
    for roots in (100_000, 500_000, 2_000_000):
        linear_scale = roots / observed_roots
        sqrt_cluster_scale = max(1.0, (roots / observed_roots) ** 0.5)
        scenarios[str(roots)] = {
            "fixed_cluster_work_multiplier_from_observed": linear_scale,
            "sqrt_topic_growth_work_multiplier_from_observed": linear_scale
            * sqrt_cluster_scale,
            "embedding_mmap_bytes": roots * embedding_dimension * 4,
            "fixed_cluster_score_batch_bytes": BATCH_SIZE * observed_clusters * 4,
            "assumptions": [
                "existing float32 embeddings are memory-mapped",
                "batch size remains fixed",
                "no model inference, export, or packet review time is included",
                "sqrt-topic-growth is a sensitivity bound, not an observed scaling law",
            ],
            "is_slo": False,
        }
    return {
        "time": "O(N*K*D + K^2*D)",
        "space": "O(batch*(D+K) + K*D + N)",
        "dense_n_by_n_matrix": "prohibited",
        "observed_roots": observed_roots,
        "observed_cluster_upper_bound": observed_clusters,
        "embedding_dimension": embedding_dimension,
        "batch_size": BATCH_SIZE,
        "projections": scenarios,
    }


def _performance_projection(
    complexity: dict[str, Any], telemetry: dict[str, Any]
) -> dict[str, Any]:
    return {
        roots: {
            "fixed_cluster_scan_wall_seconds": telemetry["wall_seconds"]
            * scenario["fixed_cluster_work_multiplier_from_observed"],
            "sqrt_topic_growth_wall_seconds": telemetry["wall_seconds"]
            * scenario["sqrt_topic_growth_work_multiplier_from_observed"],
            "is_slo": False,
        }
        for roots, scenario in complexity["projections"].items()
    }


def _packet_stability_summary(stability: dict[str, Any]) -> dict[str, float | int | str]:
    rows = list(stability.values())
    if not rows:
        return {"availability": "not_available"}
    return {
        "availability": "available",
        "comparison_seed_count": len(rows),
        "adjusted_rand_min": min(float(row["adjusted_rand"]) for row in rows),
        "adjusted_rand_max": max(float(row["adjusted_rand"]) for row in rows),
        "matched_assignment_consistency_min": min(
            float(row["matched_assignment_consistency"]) for row in rows
        ),
        "matched_assignment_consistency_max": max(
            float(row["matched_assignment_consistency"]) for row in rows
        ),
    }


def _augment_diagnostic_packet(
    packet_dir: Path, diagnostics: list[dict[str, Any]], lineage: dict[str, Any]
) -> None:
    packet_path = packet_dir / "blind-review-packet.private.json"
    packet = _read_json(packet_path)
    packet["contract_version"] = "signal-topic-discovery-diagnostic-review-v1"
    packet["count_scope"] = "full_population_diagnostic"
    packet["modeling_decision_allowed"] = False
    packet["adoption_allowed"] = False
    packet["holdout_opened"] = False
    packet["candidate_role"] = "discovery_proposal_only"
    packet["reference_seed"] = lineage["reference_seed"]
    packet["reference_seed_selection_basis"] = "first_preregistered_final_seed"
    packet["stability_context"] = {
        str(row["seed"]): {
            "cluster_count": row["cluster_count"],
            "outlier_count": row["outliers"]["count"],
            "outlier_rate": row["outliers"]["rate"],
        }
        for row in diagnostics
    }
    packet["operator_decision_fields"] = {
        "internal_coherence": None,
        "neighbor_distinction": None,
        "human_nameability": None,
        "strategic_utility": None,
        "merge_needed": None,
        "split_needed": None,
        "convert_to_topic_contract_candidate": None,
        "none_acceptable": None,
    }
    packet["packet_digest"] = sha256_text(canonical_json(packet))
    write_private_json(packet_path, packet)


def _validate_rights(records: list[BenchmarkRecordV2], manifest: ExportManifestV2) -> None:
    if (
        manifest.required_usage != "strategic-analysis"
        or manifest.licensing_evaluation != "allowed"
    ):
        raise ValueError("benchmark_diagnostic_rights_not_allowed")
    if any(record.authority_usage != "strategic-analysis" for record in records):
        raise ValueError("benchmark_diagnostic_record_rights_invalid")
    if any(
        membership.authority_valid_until is not None
        and membership.authority_valid_until <= manifest.export_timestamp
        for record in records
        for membership in record.partition_memberships
    ):
        raise ValueError("benchmark_diagnostic_rights_expired")


def _verify_manifest_entry(root: Path, manifest_path: Path, target: Path) -> None:
    manifest = _read_json(manifest_path)
    relative = str(target.resolve().relative_to(root.resolve()))
    entry = next((row for row in manifest["files"] if row["path"] == relative), None)
    if entry is None:
        raise ValueError(f"benchmark_diagnostic_lineage_unmanifested:{relative}")
    require_private(target)
    if target.stat().st_size != entry["bytes"] or sha256_file(target) != entry["sha256"]:
        raise ValueError(f"benchmark_diagnostic_lineage_drift:{relative}")


def _write_evidence_manifest(output_dir: Path, lineage: dict[str, Any], digest: str) -> str:
    files = []
    for path in sorted(output_dir.rglob("*")):
        if not path.is_file() or path.name == "manifest.sanitized.json":
            continue
        os.chmod(path, 0o600)
        files.append(
            {
                "path": str(path.relative_to(output_dir)),
                "bytes": path.stat().st_size,
                "mode": oct(path.stat().st_mode & 0o777),
                "sha256": sha256_file(path),
            }
        )
    payload = {
        "contract_version": "signal-topic-role-separation-evidence-manifest-v1",
        "analytic_digest": digest,
        "diagnostic_harness_source_digest": _diagnostic_harness_source_digest(),
        "source_evidence_manifest_sha256": lineage["evidence_manifest_sha256"],
        "source_holdout_state": "sealed",
        "all_files_private": True,
        "files": files,
        "safety": {
            "provider_calls": 0,
            "remote_writes": 0,
            "serving_writes": 0,
            "holdout_opened": False,
        },
    }
    path = output_dir / "manifest.sanitized.json"
    write_private_json(path, payload)
    return sha256_file(path)


def _diagnostic_harness_source_digest() -> str:
    source_dir = Path(__file__).parent
    files = [
        "cli.py",
        "review_packet.py",
        "role_diagnostics.py",
        "schema.py",
    ]
    return sha256_text(
        canonical_json(
            [
                {"path": name, "sha256": sha256_file(source_dir / name)}
                for name in files
            ]
        )
    )


def _validate_replay(output_dir: Path) -> dict[str, Any]:
    manifest_path = output_dir / "manifest.sanitized.json"
    require_private(manifest_path)
    manifest = _read_json(manifest_path)
    for entry in manifest["files"]:
        path = output_dir / entry["path"]
        require_private(path)
        if path.stat().st_size != entry["bytes"] or sha256_file(path) != entry["sha256"]:
            raise ValueError("benchmark_diagnostic_replay_artifact_drift")
    diagnostic = _read_json(output_dir / "diagnostic.private.json")
    if diagnostic["analytic_digest"] != manifest["analytic_digest"]:
        raise ValueError("benchmark_diagnostic_replay_digest_mismatch")
    return {
        "contract_version": DIAGNOSTIC_CONTRACT,
        "technical_result": "no_adoption",
        "discovery_proposal_verdict": "unknown_for_discovery_proposal_generation",
        "operator_review_complete": False,
        "holdout_opened": False,
        "manifest": str(manifest_path),
        "manifest_sha256": sha256_file(manifest_path),
        "replayed": True,
        "provider_calls": 0,
        "remote_writes": 0,
        "serving_writes": 0,
    }


def _reject_holdout_paths(*paths: Path) -> None:
    for path in paths:
        if "holdout" in path.name.casefold() or path.suffix == ".parquet":
            raise ValueError("benchmark_diagnostic_holdout_access_prohibited")


def _read_json(path: Path) -> dict[str, Any]:
    require_private(path)
    return json.loads(path.read_text(encoding="utf-8"))
