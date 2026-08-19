from __future__ import annotations

from collections import Counter, defaultdict
from math import exp, log

import numpy as np
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import normalize

from .preprocess import representation_stopword_fraction
from .schema import BenchmarkRecord


def topic_diversity(terms: dict[int, list[str]], top_n: int = 10) -> float | None:
    selected = [term for topic in terms.values() for term in topic[:top_n]]
    return len(set(selected)) / len(selected) if selected else None


def topic_redundancy(terms: dict[int, list[str]], top_n: int = 10) -> float | None:
    topics = [set(values[:top_n]) for values in terms.values() if values]
    if len(topics) < 2:
        return None
    scores = [
        len(left & right) / len(left | right)
        for index, left in enumerate(topics)
        for right in topics[index + 1 :]
        if left or right
    ]
    return float(np.mean(scores)) if scores else None


def merge_split_burden(
    terms: dict[int, list[str]], labels: np.ndarray, top_n: int = 10
) -> dict[str, float | int | str]:
    topic_sets = {topic: set(values[:top_n]) for topic, values in terms.items() if values}
    merge_pairs = sum(
        1
        for index, left in enumerate(sorted(topic_sets))
        for right in sorted(topic_sets)[index + 1 :]
        if topic_sets[left] or topic_sets[right]
        if (
            len(topic_sets[left] & topic_sets[right]) / len(topic_sets[left] | topic_sets[right])
            >= 0.5
        )
    )
    counts = Counter(int(value) for value in labels if value >= 0)
    assigned = sum(counts.values())
    split_candidates = sum(1 for count in counts.values() if assigned and count / assigned >= 0.15)
    return {
        "merge_pair_count": merge_pairs,
        "split_candidate_count": split_candidates,
        "contract": "term-jaccard-ge-0.5-and-topic-share-ge-0.15-v1",
    }


def assignment_metrics(labels: np.ndarray) -> dict[str, float | int | None]:
    denominator = len(labels)
    assigned = labels[labels >= 0]
    counts = Counter(int(label) for label in assigned)
    coverage = len(assigned) / denominator if denominator else None
    shares = [count / len(assigned) for count in counts.values()] if len(assigned) else []
    entropy = -sum(value * log(value) for value in shares) if shares else 0.0
    outliers = denominator - len(assigned)
    return {
        "denominator": denominator,
        "assigned": len(assigned),
        "multi_assigned": 0,
        "outliers": outliers,
        "pending": 0,
        "abstained": 0,
        "technical_error": 0,
        "accounted_for": len(assigned) + outliers,
        "accounting_reconciles": denominator == len(assigned) + outliers,
        "coverage": coverage,
        "outlier_rate": None if coverage is None else 1 - coverage,
        "effective_topics": exp(entropy) if shares else 0.0,
        "topic_count": len(counts),
        "concentration_hhi": sum(value * value for value in shares) if shares else None,
    }


def representation_metrics(
    terms: dict[int, list[str]], *, top_n: int, language_families: list[str]
) -> dict[str, float | int | None]:
    topic_fractions = [
        representation_stopword_fraction(values[:top_n], language_families)
        for values in terms.values()
        if values
    ]
    observed = [value for value in topic_fractions if value is not None]
    selected = [value for values in terms.values() for value in values[:top_n]]
    return {
        "topic_count_measured": len(observed),
        "stopword_term_rate": (
            sum(float(value) for value in observed) / len(observed) if observed else None
        ),
        "majority_stopword_topic_count": sum(value >= 0.5 for value in observed),
        "majority_stopword_topic_rate": (
            sum(value >= 0.5 for value in observed) / len(observed) if observed else None
        ),
        "phrase_term_rate": (
            sum("_" in value for value in selected) / len(selected) if selected else None
        ),
    }


def cluster_geometry_metrics(
    embeddings: np.ndarray | None, labels: np.ndarray, *, seed: int
) -> dict[str, float | int | None | str]:
    assigned_indexes = np.flatnonzero(labels >= 0)
    topics = sorted(set(int(value) for value in labels if value >= 0))
    if embeddings is None or len(topics) < 2 or len(assigned_indexes) < 3:
        return {
            "availability": "not_available",
            "nearest_cluster_separation_mean": None,
            "nearest_cluster_separation_p10": None,
            "nearest_centroid_similarity_max": None,
            "silhouette_cosine": None,
            "silhouette_sample_size": 0,
        }
    vectors = np.asarray(normalize(np.asarray(embeddings)), dtype=np.float32)
    centroids = []
    for topic in topics:
        centroid = np.asarray(vectors[labels == topic].mean(axis=0), dtype=np.float32)
        centroids.append(centroid / max(float(np.linalg.norm(centroid)), np.finfo(np.float32).eps))
    centroid_matrix = np.stack(centroids)
    topic_position = {topic: index for index, topic in enumerate(topics)}
    rng = np.random.default_rng(seed)
    margin_indexes = assigned_indexes
    if len(margin_indexes) > 20_000:
        margin_indexes = np.sort(rng.choice(margin_indexes, size=20_000, replace=False))
    similarities = vectors[margin_indexes] @ centroid_matrix.T
    own = np.asarray(
        [
            similarities[row, topic_position[int(labels[index])]]
            for row, index in enumerate(margin_indexes)
        ]
    )
    masked = similarities.copy()
    for row, index in enumerate(margin_indexes):
        masked[row, topic_position[int(labels[index])]] = -np.inf
    margins = own - masked.max(axis=1)
    centroid_similarity = centroid_matrix @ centroid_matrix.T
    np.fill_diagonal(centroid_similarity, -np.inf)
    silhouette_indexes = assigned_indexes
    if len(silhouette_indexes) > 2_000:
        silhouette_indexes = np.sort(rng.choice(silhouette_indexes, size=2_000, replace=False))
    silhouette = (
        float(
            silhouette_score(
                vectors[silhouette_indexes], labels[silhouette_indexes], metric="cosine"
            )
        )
        if len(set(int(value) for value in labels[silhouette_indexes])) > 1
        else None
    )
    return {
        "availability": "available",
        "nearest_cluster_separation_mean": float(np.mean(margins)),
        "nearest_cluster_separation_p10": float(np.quantile(margins, 0.10)),
        "nearest_centroid_similarity_max": float(np.max(centroid_similarity)),
        "silhouette_cosine": silhouette,
        "silhouette_sample_size": len(silhouette_indexes),
    }


def cluster_size_distribution(labels: np.ndarray) -> dict[str, float | int | None]:
    counts = np.asarray(list(Counter(int(value) for value in labels if value >= 0).values()))
    assigned = int(counts.sum()) if len(counts) else 0
    if not len(counts) or not assigned:
        return {
            "minimum": None,
            "median": None,
            "p90": None,
            "maximum": None,
            "largest_cluster_share": None,
        }
    return {
        "minimum": int(counts.min()),
        "median": float(np.median(counts)),
        "p90": float(np.quantile(counts, 0.90)),
        "maximum": int(counts.max()),
        "largest_cluster_share": float(counts.max() / assigned),
    }


def slice_coverage(
    records: list[BenchmarkRecord], labels: np.ndarray
) -> dict[str, dict[str, dict[str, int | float]]]:
    if len(records) != len(labels):
        raise ValueError("benchmark_slice_assignment_shape_mismatch")
    slices: dict[str, dict[str, list[bool]]] = defaultdict(lambda: defaultdict(list))
    for record, label in zip(records, labels, strict=True):
        values = {
            "language": [record.language],
            "platform": [record.platform],
            "month": [record.month],
            "scope": sorted({intent.scope for intent in record.provenance_intents}) or ["unknown"],
            "entity": sorted(
                {
                    intent.entity_ref
                    for intent in record.provenance_intents
                    if intent.entity_ref is not None
                }
            )
            or ["unknown"],
        }
        for dimension, members in values.items():
            for member in members:
                slices[dimension][member].append(bool(label >= 0))
    return {
        dimension: {
            member: {
                "denominator": len(assignments),
                "assigned": sum(assignments),
                "coverage": sum(assignments) / len(assignments),
            }
            for member, assignments in sorted(members.items())
        }
        for dimension, members in sorted(slices.items())
    }
