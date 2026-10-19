from __future__ import annotations

from collections import defaultdict

import numpy as np
from scipy.optimize import linear_sum_assignment
from sklearn.metrics import adjusted_rand_score


def match_clusters(reference: np.ndarray, candidate: np.ndarray) -> dict[int, int]:
    reference_labels = sorted(set(int(value) for value in reference if value >= 0))
    candidate_labels = sorted(set(int(value) for value in candidate if value >= 0))
    if not reference_labels or not candidate_labels:
        return {}
    overlap = np.zeros((len(reference_labels), len(candidate_labels)), dtype=np.int64)
    ref_index = {label: index for index, label in enumerate(reference_labels)}
    candidate_index = {label: index for index, label in enumerate(candidate_labels)}
    for left, right in zip(reference, candidate, strict=True):
        if left >= 0 and right >= 0:
            overlap[ref_index[int(left)], candidate_index[int(right)]] += 1
    rows, columns = linear_sum_assignment(-overlap)
    return {
        candidate_labels[column]: reference_labels[row]
        for row, column in zip(rows, columns, strict=True)
    }


def stability_metrics(reference: np.ndarray, candidate: np.ndarray) -> dict[str, float]:
    if reference.shape != candidate.shape:
        raise ValueError("benchmark_assignment_shape_mismatch")
    mapping = match_clusters(reference, candidate)
    comparable = np.array(
        [left >= 0 or right >= 0 for left, right in zip(reference, candidate, strict=True)]
    )
    matched = np.array([mapping.get(int(value), -1) for value in candidate])
    consistency = (
        float(np.mean(reference[comparable] == matched[comparable])) if comparable.any() else 0.0
    )
    return {
        "adjusted_rand": float(adjusted_rand_score(reference, candidate)),
        "matched_assignment_consistency": consistency,
    }


def paired_bootstrap_stability(
    reference: np.ndarray,
    candidate: np.ndarray,
    *,
    seed: int,
    replicates: int = 100,
) -> dict[str, float | int]:
    if reference.shape != candidate.shape or len(reference) == 0:
        raise ValueError("benchmark_bootstrap_assignment_shape_invalid")
    generator = np.random.default_rng(seed)
    values = []
    for _ in range(replicates):
        indexes = generator.integers(0, len(reference), size=len(reference))
        values.append(stability_metrics(reference[indexes], candidate[indexes]))
    consistency = np.asarray([value["matched_assignment_consistency"] for value in values])
    adjusted_rand = np.asarray([value["adjusted_rand"] for value in values])
    return {
        "replicates": replicates,
        "consistency_mean": float(consistency.mean()),
        "consistency_p05": float(np.quantile(consistency, 0.05)),
        "consistency_p95": float(np.quantile(consistency, 0.95)),
        "adjusted_rand_mean": float(adjusted_rand.mean()),
        "adjusted_rand_p05": float(np.quantile(adjusted_rand, 0.05)),
        "adjusted_rand_p95": float(np.quantile(adjusted_rand, 0.95)),
    }


def topic_term_jaccard(
    reference_terms: dict[int, list[str]],
    candidate_terms: dict[int, list[str]],
    mapping: dict[int, int],
) -> float:
    scores: list[float] = []
    by_reference: dict[int, list[int]] = defaultdict(list)
    for candidate, reference in mapping.items():
        by_reference[reference].append(candidate)
    for reference, candidates in by_reference.items():
        left = set(reference_terms.get(reference, []))
        right = set(candidate_terms.get(candidates[0], []))
        if left or right:
            scores.append(len(left & right) / len(left | right))
    denominator = max(len(reference_terms), len(candidate_terms))
    return sum(scores) / denominator if denominator else 0.0
