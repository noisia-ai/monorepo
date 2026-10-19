from __future__ import annotations

import os
from pathlib import Path
from time import perf_counter
from typing import Any

import numpy as np

from .canonical import sha256_file, write_private_json


def runtime_seconds_total(components: dict[str, Any]) -> float:
    """Sum elapsed-time components without mixing in byte-count telemetry."""

    elapsed = 0.0
    for key, value in components.items():
        if not key.endswith("_seconds"):
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise ValueError(f"benchmark_runtime_seconds_invalid:{key}")
        elapsed += float(value)
    return elapsed


def save_discovery_result(
    output_dir: Path,
    candidate_key: str,
    seed: int,
    labels: np.ndarray,
    strengths: np.ndarray,
    terms: dict[int, list[str]],
    metrics: dict[str, Any],
    manifest: dict[str, Any],
    state: str,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    assignments = output_dir / f"{candidate_key}.seed-{seed}.assignments.npz"
    serialization_started = perf_counter()
    np.savez_compressed(
        assignments, labels=labels.astype(np.int32), strengths=strengths.astype(np.float32)
    )
    serialization_seconds = perf_counter() - serialization_started
    os.chmod(assignments, 0o600)
    assignments_digest = sha256_file(assignments)
    embedding_value = (manifest.get("embedding_manifest") or {}).get("output_path")
    embedding_path = Path(embedding_value) if embedding_value else None
    embedding_bytes = embedding_path.stat().st_size if embedding_path is not None else 0
    runtime_components = {
        **metrics.get("runtime_components_seconds", {}),
        "assignment_serialization_seconds": serialization_seconds,
        "assignment_artifact_bytes": assignments.stat().st_size,
        "embedding_artifact_bytes": embedding_bytes,
        "referenced_binary_artifact_bytes": assignments.stat().st_size + embedding_bytes,
    }
    observed_pipeline_seconds = runtime_seconds_total(runtime_components)
    denominator = int(metrics.get("denominator") or 0)
    projection_population = int(metrics.get("runtime_projection_population") or denominator)
    final_metrics = {
        **metrics,
        "runtime_components_seconds": runtime_components,
        "observed_candidate_pipeline_seconds": observed_pipeline_seconds,
        "estimated_full_runtime_seconds": (
            observed_pipeline_seconds / denominator * projection_population
            if denominator
            else None
        ),
        "assignment_serialization_seconds": serialization_seconds,
    }
    payload = {
        "candidate_key": candidate_key,
        "seed": seed,
        "assignments_path": str(assignments),
        "assignments_sha256": assignments_digest,
        "terms": {str(key): values for key, values in sorted(terms.items())},
        "metrics": final_metrics,
        "artifact_manifest": {**manifest, "output_digest": assignments_digest},
        "state": state,
    }
    result_path = output_dir / f"{candidate_key}.seed-{seed}.result.json"
    write_private_json(result_path, payload)
    return {**payload, "result_path": str(result_path), "result_sha256": sha256_file(result_path)}
