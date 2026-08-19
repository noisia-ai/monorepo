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
                or any(
                    marker in evidence_url for marker in ("/master/", "/main/", "/latest/")
                )
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
        if bge is None or bge.get("runtime_batch_size") != 32 or bge.get(
            "runtime_batch_order"
        ) != "normalized-character-length-ascending-stable-v1":
            raise ValueError("benchmark_bge_runtime_batch_contract_invalid")
        gates = plan.get("hard_gates", {})
        if gates.get("maximum_majority_stopword_topic_rate") != 0:
            raise ValueError("benchmark_stopword_gate_invalid")
