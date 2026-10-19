from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .canonical import canonical_json, sha256_text
from .preprocess import PREPROCESSING_CONTRACT_VERSION, STOPWORD_POLICY_VERSION


def default_plan_path() -> Path:
    return Path(__file__).resolve().parents[2] / "config" / "benchmark-plan.json"


def load_plan(path: Path | None = None) -> dict[str, Any]:
    target = path or default_plan_path()
    plan = json.loads(target.read_text())
    if plan.get("contract_version") not in {
        "signal-local-modeling-benchmark-plan-v1",
        "signal-local-modeling-benchmark-plan-v2",
        "signal-local-modeling-benchmark-plan-v3",
    }:
        raise ValueError("benchmark_plan_contract_invalid")
    _validate_plan(plan)
    return plan


def plan_digest(plan: dict[str, Any]) -> str:
    return sha256_text(canonical_json(plan))


def embedding_config(plan: dict[str, Any], key: str) -> dict[str, Any]:
    try:
        return next(item for item in plan["embeddings"] if item["key"] == key)
    except StopIteration as error:
        raise ValueError(f"benchmark_embedding_unknown:{key}") from error


def discovery_config(plan: dict[str, Any], key: str) -> dict[str, Any]:
    try:
        return next(item for item in plan["discovery"] if item["key"] == key)
    except StopIteration as error:
        raise ValueError(f"benchmark_discovery_unknown:{key}") from error


def load_run_plan(run_dir: Path) -> dict[str, Any]:
    path = run_dir / "benchmark-plan.sealed.json"
    return load_plan(path) if path.is_file() else load_plan()


def _validate_plan(plan: dict[str, Any]) -> None:
    if plan["contract_version"] == "signal-local-modeling-benchmark-plan-v3":
        _validate_plan_v3(plan)
        return
    embeddings = plan.get("embeddings", [])
    keys = [item.get("key") for item in embeddings]
    if len(keys) < 2 or len(keys) != len(set(keys)):
        raise ValueError("benchmark_embedding_matrix_invalid")
    download_bytes = 0
    for item in embeddings:
        revision = item.get("revision", "")
        if len(revision) != 40 or any(
            character not in "0123456789abcdef" for character in revision
        ):
            raise ValueError("benchmark_embedding_revision_not_immutable")
        if item.get("license") not in {"MIT", "Apache-2.0", "BSD-3-Clause"}:
            raise ValueError("benchmark_embedding_license_not_allowed")
        artifacts = item.get("artifact_files", [])
        if not artifacts:
            raise ValueError("benchmark_embedding_artifacts_missing")
        if sum(int(artifact["bytes"]) for artifact in artifacts) != int(item["artifact_bytes"]):
            raise ValueError("benchmark_embedding_artifact_bytes_mismatch")
        download_bytes += int(item["artifact_bytes"])
    if download_bytes > int(plan["hardware_budget"]["max_download_bytes"]):
        raise ValueError("benchmark_download_budget_exceeded")
    seeds = plan.get("stages", {}).get("final_seeds", [])
    if len(seeds) < 3 or len(seeds) != len(set(seeds)):
        raise ValueError("benchmark_final_seeds_invalid")
    if plan["contract_version"] == "signal-local-modeling-benchmark-plan-v2":
        for dependency in plan.get("material_dependencies", []):
            version = str(dependency.get("version", ""))
            evidence_url = str(dependency.get("url", ""))
            if (
                not version
                or not evidence_url.startswith("https://")
                or version not in evidence_url
                or any(marker in evidence_url for marker in ("/master/", "/main/", "/latest/"))
            ):
                raise ValueError("benchmark_dependency_evidence_not_immutable")
        if plan.get("corpus", {}).get("text_normalization") != PREPROCESSING_CONTRACT_VERSION:
            raise ValueError("benchmark_preprocessing_contract_drift")
        if plan.get("locale_policy", {}).get("stopword_policy") != STOPWORD_POLICY_VERSION:
            raise ValueError("benchmark_stopword_policy_contract_drift")
        candidates = plan.get("candidates", [])
        candidate_keys = [item.get("key") for item in candidates]
        if not 3 <= len(candidates) <= 6 or len(candidate_keys) != len(set(candidate_keys)):
            raise ValueError("benchmark_candidate_grid_invalid")
        embedding_keys = set(keys)
        discovery_keys = {item.get("key") for item in plan.get("discovery", [])}
        for candidate in candidates:
            if candidate.get("discovery") not in discovery_keys:
                raise ValueError("benchmark_candidate_discovery_invalid")
            embedding = candidate.get("embedding")
            if embedding is not None and embedding not in embedding_keys:
                raise ValueError("benchmark_candidate_embedding_invalid")
        pairs = [(item.get("discovery"), item.get("embedding")) for item in candidates]
        if len(pairs) != len(set(pairs)):
            raise ValueError("benchmark_candidate_pair_duplicate")
        if plan.get("parameter_policy") != "declared-equals-effective-or-fail-v1":
            raise ValueError("benchmark_parameter_policy_invalid")
        if plan.get("missing_probability_policy") != "not_available-never-one-v1":
            raise ValueError("benchmark_probability_policy_invalid")
        bge = next((item for item in embeddings if item.get("key") == "bge-m3"), None)
        if (
            bge is None
            or bge.get("runtime_batch_size") != 32
            or bge.get("runtime_batch_order") != "normalized-character-length-ascending-stable-v1"
        ):
            raise ValueError("benchmark_bge_runtime_batch_contract_invalid")
        gates = plan.get("hard_gates", {})
        if gates.get("maximum_majority_stopword_topic_rate") != 0:
            raise ValueError("benchmark_stopword_gate_invalid")


def _validate_plan_v3(plan: dict[str, Any]) -> None:
    required_top_level = {
        "contract_version",
        "status",
        "preregistered_at",
        "supersedes",
        "schema_operability",
        "question",
        "decision_outcomes",
        "execution_authorized",
        "ten_d_authorized",
        "corpus",
        "sampling",
        "splits",
        "gold",
        "hardware_budget",
        "material_dependencies",
        "embeddings",
        "discovery",
        "candidates",
        "excluded_candidates",
        "stages",
        "metrics",
        "hard_gates",
        "parameter_policy",
        "missing_probability_policy",
        "future_contextual_naming",
        "safety",
        "stop_conditions",
    }
    _require_exact_keys(plan, required_top_level, "benchmark_plan_v3_top_level")
    supersedes = plan["supersedes"]
    _require_exact_keys(
        supersedes,
        {"contract_version", "path", "sha256"},
        "benchmark_plan_v3_supersedes",
    )
    require_digest_value(supersedes["sha256"], "benchmark_plan_v3_supersedes_digest")
    if supersedes["contract_version"] != "signal-local-modeling-benchmark-plan-10c2-v1":
        raise ValueError("benchmark_plan_v3_supersedes_contract_invalid")
    operability = plan["schema_operability"]
    _require_exact_keys(
        operability,
        {"changes_limited_to_schema_operability", "substantive_decisions_changed"},
        "benchmark_plan_v3_operability",
    )
    if operability != {
        "changes_limited_to_schema_operability": True,
        "substantive_decisions_changed": False,
    }:
        raise ValueError("benchmark_plan_v3_substantive_change_requires_operator")
    if plan["execution_authorized"] is not False or plan["ten_d_authorized"] is not False:
        raise ValueError("benchmark_plan_v3_execution_must_remain_unauthorized")
    if plan["decision_outcomes"] != ["adopt", "no_adoption", "rerun"]:
        raise ValueError("benchmark_plan_v3_decision_outcomes_invalid")

    corpus = plan["corpus"]
    required_corpus = {
        "identity",
        "export_contract",
        "record_contract",
        "authority",
        "required_usage",
        "acquisition_denominator",
        "included_modeling_population",
        "quality_excluded_roots",
        "population_digest",
        "content_digest",
        "provenance_digest",
        "watermark_digest",
        "timezone",
        "observed_period_local",
        "partitions",
        "scopes_overlap",
        "scope_totals_are_not_additive",
        "canonical_root_deduplication",
    }
    _require_exact_keys(corpus, required_corpus, "benchmark_plan_v3_corpus")
    if (
        corpus["export_contract"] != "signal-semantic-benchmark-export-v2"
        or corpus["record_contract"] != "signal-semantic-benchmark-record-v2"
        or corpus["authority"] != "completed-acquisition-import-seals-v1"
        or corpus["required_usage"] != "strategic-analysis"
    ):
        raise ValueError("benchmark_plan_v3_acquisition_authority_invalid")
    if int(corpus["acquisition_denominator"]) != (
        int(corpus["included_modeling_population"]) + int(corpus["quality_excluded_roots"])
    ):
        raise ValueError("benchmark_plan_v3_denominator_invalid")
    for key in (
        "population_digest",
        "content_digest",
        "provenance_digest",
        "watermark_digest",
    ):
        require_digest_value(corpus[key], f"benchmark_plan_v3_{key}")
    partitions = corpus["partitions"]
    if not isinstance(partitions, list) or len(partitions) < 4:
        raise ValueError("benchmark_plan_v3_partition_matrix_invalid")
    partition_keys = [partition.get("key") for partition in partitions]
    if len(partition_keys) != len(set(partition_keys)):
        raise ValueError("benchmark_plan_v3_partition_duplicate")
    for partition in partitions:
        _require_exact_keys(
            partition,
            {
                "key",
                "scope",
                "entity_ref",
                "declared_market",
                "total",
                "included",
                "excluded",
                "population_digest",
                "modeling_digest",
                "plan_version",
                "plan_digest",
                "slot_digest",
            },
            "benchmark_plan_v3_partition",
        )
        if int(partition["total"]) != int(partition["included"]) + int(partition["excluded"]):
            raise ValueError("benchmark_plan_v3_partition_denominator_invalid")
        for key in (
            "entity_ref",
            "population_digest",
            "modeling_digest",
            "plan_digest",
            "slot_digest",
        ):
            require_digest_value(partition[key], f"benchmark_plan_v3_partition_{key}")
        if partition["scope"] not in {
            "primary_brand",
            "category",
            "competitor",
            "reference",
        } or not _is_country_code(partition["declared_market"]):
            raise ValueError("benchmark_plan_v3_partition_shape_invalid")

    sampling = plan["sampling"]
    expected_strata = [
        "partition",
        "entity",
        "language",
        "declared_market",
        "month",
        "platform",
    ]
    if (
        sampling.get("stratify_by") != expected_strata
        or sampling.get("primary_decision_aggregation") != "macro_equal_partition_weight"
        or sampling.get("micro_metrics_are_supplementary") is not True
    ):
        raise ValueError("benchmark_plan_v3_sampling_invalid")
    weights = sampling.get("partition_weights", {})
    total_weight = sum(float(value) for value in weights.values())
    if set(weights) != set(partition_keys) or abs(total_weight - 1) > 1e-12:
        raise ValueError("benchmark_plan_v3_partition_weights_invalid")
    expected_weight = 1 / len(partition_keys)
    if any(abs(float(value) - expected_weight) > 1e-12 for value in weights.values()):
        raise ValueError("benchmark_plan_v3_partition_weights_not_equal")

    splits = plan["splits"]
    if splits.get("group_by") != ["canonical_family_key", "content_hash"]:
        raise ValueError("benchmark_plan_v3_split_groups_invalid")
    if splits.get("shared_root_uses_same_split_across_scopes") is not True:
        raise ValueError("benchmark_plan_v3_shared_root_split_invalid")
    fractions = sum(
        float(splits[key])
        for key in ("train_fraction", "calibration_fraction", "blind_holdout_fraction")
    )
    if abs(fractions - 1) > 1e-12:
        raise ValueError("benchmark_plan_v3_split_fraction_invalid")
    if splits.get("holdout_open_policy") != "open-once-after-full-finalists-are-frozen":
        raise ValueError("benchmark_plan_v3_holdout_policy_invalid")

    embeddings = plan["embeddings"]
    embedding_keys = [item.get("key") for item in embeddings]
    if len(embedding_keys) < 2 or len(embedding_keys) != len(set(embedding_keys)):
        raise ValueError("benchmark_embedding_matrix_invalid")
    download_bytes = 0
    for item in embeddings:
        _validate_pinned_artifact(item, "embedding")
        artifacts = item.get("artifact_files", [])
        if not artifacts or sum(int(row["bytes"]) for row in artifacts) != int(
            item["artifact_bytes"]
        ):
            raise ValueError("benchmark_embedding_artifact_bytes_mismatch")
        for artifact in artifacts:
            require_plain_sha256(artifact.get("sha256"), "benchmark_embedding_artifact_hash")
        download_bytes += int(item["artifact_bytes"])
    hardware = plan["hardware_budget"]
    if download_bytes > int(hardware["max_download_bytes"]):
        raise ValueError("benchmark_download_budget_exceeded")

    for dependency in plan["material_dependencies"]:
        version = str(dependency.get("version", ""))
        evidence_url = str(dependency.get("url", ""))
        if (
            not version
            or not evidence_url.startswith("https://")
            or version not in evidence_url
            or any(marker in evidence_url for marker in ("/master/", "/main/", "/latest/"))
        ):
            raise ValueError("benchmark_dependency_evidence_not_immutable")

    discovery = plan["discovery"]
    discovery_keys = [item.get("key") for item in discovery]
    if len(discovery_keys) != len(set(discovery_keys)):
        raise ValueError("benchmark_discovery_duplicate")
    for item in discovery:
        if not item.get("version") or item.get("license") not in {
            "MIT",
            "Apache-2.0",
            "BSD-3-Clause",
        }:
            raise ValueError("benchmark_discovery_artifact_invalid")
        revision = item.get("revision")
        if revision is not None:
            require_revision(revision, "benchmark_discovery_revision_not_immutable")

    candidates = plan["candidates"]
    candidate_keys = [item.get("key") for item in candidates]
    if not 3 <= len(candidates) <= 6 or len(candidate_keys) != len(set(candidate_keys)):
        raise ValueError("benchmark_candidate_grid_invalid")
    pairs = []
    for candidate in candidates:
        if candidate.get("discovery") not in set(discovery_keys):
            raise ValueError("benchmark_candidate_discovery_invalid")
        if candidate.get("embedding") is not None and candidate.get("embedding") not in set(
            embedding_keys
        ):
            raise ValueError("benchmark_candidate_embedding_invalid")
        pairs.append((candidate.get("discovery"), candidate.get("embedding")))
    if len(pairs) != len(set(pairs)):
        raise ValueError("benchmark_candidate_pair_duplicate")

    stages = plan["stages"]
    if stages.get("sequence") != [
        "prepared",
        "smoke",
        "calibration",
        "full",
        "multi_seed_complete",
        "holdout_open_once",
        "operator_review",
    ]:
        raise ValueError("benchmark_plan_v3_stage_sequence_invalid")
    seeds = stages.get("final_seeds", [])
    if len(seeds) < 3 or len(seeds) != len(set(seeds)):
        raise ValueError("benchmark_final_seeds_invalid")
    gates = plan["hard_gates"]
    required_gates = {
        "denominator_reconciles",
        "unexplained_roots",
        "leakage",
        "maximum_full_runtime_seconds",
        "maximum_peak_ram_bytes",
        "minimum_global_coverage",
        "minimum_each_partition_coverage",
        "maximum_partition_coverage_gap",
        "minimum_topic_diversity",
        "minimum_full_adjusted_rand",
        "minimum_matched_assignment_consistency",
        "minimum_effective_topics",
        "maximum_effective_topics",
        "maximum_majority_stopword_topic_rate",
        "maximum_largest_cluster_share",
        "minimum_nearest_cluster_separation_mean",
        "immutable_revisions_and_licenses_required",
        "blind_operator_review_required_for_adoption",
        "finalist_selection",
    }
    _require_exact_keys(gates, required_gates, "benchmark_plan_v3_hard_gates")
    if (
        float(gates["minimum_global_coverage"]) != 0.55
        or float(gates["minimum_each_partition_coverage"]) != 0.55
        or float(gates["maximum_partition_coverage_gap"]) != 0.2
        or float(gates["minimum_topic_diversity"]) != 0.55
        or int(gates["minimum_effective_topics"]) != 8
        or int(gates["maximum_effective_topics"]) != 120
        or float(gates["maximum_majority_stopword_topic_rate"]) != 0
        or float(gates["maximum_largest_cluster_share"]) != 0.4
        or float(gates["minimum_nearest_cluster_separation_mean"]) != 0.005
        or float(gates["minimum_full_adjusted_rand"]) != 0.25
        or float(gates["minimum_matched_assignment_consistency"]) != 0.5
    ):
        raise ValueError("benchmark_plan_v3_frozen_threshold_drift")
    if plan["parameter_policy"] != "declared-equals-effective-or-fail-v1":
        raise ValueError("benchmark_parameter_policy_invalid")
    if plan["missing_probability_policy"] != "not_available-never-one-v1":
        raise ValueError("benchmark_probability_policy_invalid")
    safety = plan["safety"]
    if safety != {
        "provider_calls_allowed": False,
        "remote_writes_allowed": False,
        "serving_writes_allowed": False,
        "holdout_open_allowed": False,
        "ten_d_allowed": False,
    }:
        raise ValueError("benchmark_plan_v3_safety_invalid")
    required_stops = {
        "digest_or_denominator_mismatch",
        "declared_effective_parameter_drift",
        "fabricated_probability_or_confidence",
        "unexplained_root",
        "split_leakage",
        "required_partition_omitted",
        "provider_call",
        "remote_write",
        "serving_write",
        "holdout_opened_without_gate",
        "attempt_to_open_10d",
    }
    if not required_stops <= set(plan["stop_conditions"]):
        raise ValueError("benchmark_plan_v3_stop_conditions_incomplete")


def _require_exact_keys(value: Any, expected: set[str], error: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        missing = sorted(expected - set(value or {}))
        extra = sorted(set(value or {}) - expected)
        raise ValueError(f"{error}:missing={missing}:extra={extra}")


def require_digest_value(value: Any, error: str) -> str:
    if not isinstance(value, str) or len(value) != 71 or not value.startswith("sha256:"):
        raise ValueError(error)
    require_plain_sha256(value[7:], error)
    return value


def require_plain_sha256(value: Any, error: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(error)
    return value


def require_revision(value: Any, error: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 40
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(error)
    return value


def _validate_pinned_artifact(item: dict[str, Any], kind: str) -> None:
    require_revision(item.get("revision"), f"benchmark_{kind}_revision_not_immutable")
    if item.get("license") not in {"MIT", "Apache-2.0", "BSD-3-Clause"}:
        raise ValueError(f"benchmark_{kind}_license_not_allowed")
    evidence_url = item.get("license_url")
    if not isinstance(evidence_url, str) or not evidence_url.startswith("https://"):
        raise ValueError(f"benchmark_{kind}_license_evidence_invalid")


def _is_country_code(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 2 and value.isupper() and value.isalpha()
