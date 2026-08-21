from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any, Literal

import numpy as np
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer

from .preprocess import LocalePreprocessPolicy, locale_tokens, normalize_text


class CandidateTechnicalRejection(RuntimeError):
    """A reproducible candidate/configuration failure that must not abort the stage."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class DiscoveryResult:
    labels: np.ndarray
    strengths: np.ndarray
    strength_availability: Literal["available", "not_available"]
    terms: dict[int, list[str]]
    diagnostics: dict[str, Any]


@dataclass
class TimedLocaleAnalyzer:
    policy: LocalePreprocessPolicy
    duration_seconds: float = 0.0
    call_count: int = 0

    def __call__(self, value: str) -> list[str]:
        started = perf_counter()
        try:
            return locale_tokens(value, self.policy)
        finally:
            self.duration_seconds += perf_counter() - started
            self.call_count += 1


def run_lexical_nmf(texts: list[str], config: dict[str, Any], seed: int) -> DiscoveryResult:
    policy = _preprocess_policy(config)
    analyzer = TimedLocaleAnalyzer(policy)
    vectorizer = TfidfVectorizer(
        analyzer=analyzer,
        lowercase=False,
        max_features=int(config["max_features"]),
        min_df=int(config["min_df"]),
        max_df=float(config["max_df"]),
        sublinear_tf=True,
    )
    vectorization_started = perf_counter()
    matrix = vectorizer.fit_transform(texts)
    vectorization_seconds = perf_counter() - vectorization_started
    n_topics = int(config["n_topics"])
    if n_topics < 2 or n_topics >= min(matrix.shape):
        raise ValueError("benchmark_nmf_declared_topic_count_incompatible")
    model = NMF(
        n_components=n_topics,
        init="nndsvda",
        random_state=seed,
        max_iter=int(config["max_iter"]),
    )
    factorization_started = perf_counter()
    weights = model.fit_transform(matrix)
    factorization_seconds = perf_counter() - factorization_started
    labels = np.asarray(weights.argmax(axis=1), dtype=np.int32)
    totals = weights.sum(axis=1)
    strengths = np.divide(
        weights.max(axis=1), totals, out=np.zeros_like(totals, dtype=np.float64), where=totals > 0
    ).astype(np.float32)
    vocabulary = np.asarray(vectorizer.get_feature_names_out())
    top_n = int(config["top_n_words"])
    terms = {
        topic: vocabulary[np.argsort(model.components_[topic])[-top_n:][::-1]].tolist()
        for topic in range(n_topics)
    }
    declared = _declared_parameters(config)
    return DiscoveryResult(
        labels,
        strengths,
        "available",
        terms,
        {
            "vectorizer_features": int(matrix.shape[1]),
            "reconstruction_error": float(model.reconstruction_err_),
            "iterations": int(model.n_iter_),
            "declared_parameters": declared,
            "effective_parameters": declared,
            "parameters_changed": False,
            "phase_timings": {
                "preprocessing_locale_seconds": analyzer.duration_seconds,
                "lexical_vectorization_excluding_preprocessing_seconds": max(
                    0.0, vectorization_seconds - analyzer.duration_seconds
                ),
                "lexical_vectorization_total_seconds": vectorization_seconds,
                "topic_factorization_seconds": factorization_seconds,
                "representation_seconds": 0.0,
            },
        },
    )


def run_bertopic(
    texts: list[str], embeddings: np.ndarray, config: dict[str, Any], seed: int
) -> DiscoveryResult:
    from bertopic import BERTopic
    from hdbscan import HDBSCAN
    from umap import UMAP

    class TimedUmap(UMAP):
        duration_seconds = 0.0

        def fit(self, *args: Any, **kwargs: Any) -> Any:
            started = perf_counter()
            try:
                return super().fit(*args, **kwargs)
            finally:
                self.duration_seconds += perf_counter() - started

        def transform(self, *args: Any, **kwargs: Any) -> Any:
            started = perf_counter()
            try:
                return super().transform(*args, **kwargs)
            finally:
                self.duration_seconds += perf_counter() - started

    class TimedHdbscan(HDBSCAN):
        duration_seconds = 0.0

        def fit(self, *args: Any, **kwargs: Any) -> Any:
            started = perf_counter()
            try:
                return super().fit(*args, **kwargs)
            finally:
                self.duration_seconds += perf_counter() - started

    min_cluster_size = int(config["hdbscan_min_cluster_size"])
    min_samples = int(config["hdbscan_min_samples"])
    n_neighbors = int(config["umap_n_neighbors"])
    if min_cluster_size >= len(texts) or min_samples >= len(texts) or n_neighbors >= len(texts):
        raise ValueError("benchmark_bertopic_declared_parameters_incompatible")
    policy = _preprocess_policy(config)
    analyzer = TimedLocaleAnalyzer(policy)
    vectorizer = CountVectorizer(
        analyzer=analyzer,
        lowercase=False,
        min_df=int(config["vectorizer_min_df"]),
        max_df=float(config["vectorizer_max_df"]),
        max_features=int(config["vectorizer_max_features"]),
    )
    umap = TimedUmap(
        n_neighbors=n_neighbors,
        n_components=int(config["umap_n_components"]),
        min_dist=float(config["umap_min_dist"]),
        metric="cosine",
        random_state=seed,
        low_memory=True,
    )
    hdbscan = TimedHdbscan(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method=str(config["cluster_selection_method"]),
        prediction_data=True,
    )
    model = BERTopic(
        embedding_model=None,
        umap_model=umap,
        hdbscan_model=hdbscan,
        vectorizer_model=vectorizer,
        top_n_words=int(config["top_n_words"]),
        calculate_probabilities=False,
        verbose=False,
    )
    model_started = perf_counter()
    try:
        topics, probabilities = model.fit_transform(texts, np.asarray(embeddings))
    except ValueError as error:
        if str(error) == "max_df corresponds to < documents than min_df":
            raise CandidateTechnicalRejection(
                "bertopic_representation_document_frequency_incompatible"
            ) from error
        raise
    model_seconds = perf_counter() - model_started
    labels = np.asarray(topics, dtype=np.int32)
    strengths, availability = _membership_strengths(probabilities, model, len(texts))
    terms = {
        int(topic): [word for word, _score in model.get_topic(topic)]
        for topic in sorted(set(topics))
        if topic >= 0 and model.get_topic(topic)
    }
    declared = _declared_parameters(config)
    representation_and_orchestration_seconds = max(
        0.0,
        model_seconds
        - umap.duration_seconds
        - hdbscan.duration_seconds
        - analyzer.duration_seconds,
    )
    return DiscoveryResult(
        labels,
        strengths,
        availability,
        terms,
        {
            "framework_topic_count": len(terms),
            "reduced_embedding_dimension": int(config["umap_n_components"]),
            "vectorizer_features": len(model.vectorizer_model.get_feature_names_out()),
            "membership_strength_availability": availability,
            "declared_parameters": declared,
            "effective_parameters": declared,
            "parameters_changed": False,
            "phase_timings": {
                "preprocessing_locale_seconds": analyzer.duration_seconds,
                "dimensionality_reduction_seconds": umap.duration_seconds,
                "clustering_seconds": hdbscan.duration_seconds,
                "representation_and_model_orchestration_excluding_preprocessing_seconds": (
                    representation_and_orchestration_seconds
                ),
                "model_total_seconds": model_seconds,
                "representation_vectorizer_feature_count": len(
                    model.vectorizer_model.get_feature_names_out()
                ),
            },
        },
    )


def run_fastopic(
    texts: list[str], embeddings: np.ndarray, config: dict[str, Any], seed: int
) -> DiscoveryResult:
    import torch
    from fastopic import FASTopic

    n_topics = int(config["n_topics"])
    batch_size = int(config["low_memory_batch_size"])
    if n_topics >= len(texts) or batch_size > len(texts):
        raise ValueError("benchmark_fastopic_declared_parameters_incompatible")
    np.random.seed(seed)
    torch.manual_seed(seed)
    model = FASTopic(
        num_topics=n_topics,
        num_top_words=int(config["top_n_words"]),
        device="cpu",
        normalize_embeddings=False,
        low_memory=bool(config["low_memory"]),
        low_memory_batch_size=batch_size,
        verbose=False,
    )
    top_words, theta = model.fit_transform(
        [normalize_text(text) for text in texts],
        epochs=int(config["epochs"]),
        learning_rate=float(config["learning_rate"]),
        preset_doc_embeddings=np.asarray(embeddings, dtype=np.float32),
    )
    theta = np.asarray(theta, dtype=np.float32)
    labels = np.asarray(theta.argmax(axis=1), dtype=np.int32)
    strengths = np.asarray(theta.max(axis=1), dtype=np.float32)
    assignment_threshold = float(config["assignment_threshold"])
    labels[strengths < assignment_threshold] = -1
    terms = {
        index: value.split() if isinstance(value, str) else list(value)
        for index, value in enumerate(top_words)
    }
    declared = _declared_parameters(config)
    return DiscoveryResult(
        labels,
        strengths,
        "available",
        terms,
        {
            "framework_topic_count": len(terms),
            "epochs": int(config["epochs"]),
            "assignment_threshold": assignment_threshold,
            "comparison_limitation": (
                "FASTopic requires a fixed topic count; BERTopic discovers density clusters."
            ),
            "declared_parameters": declared,
            "effective_parameters": declared,
            "parameters_changed": False,
        },
    )


def _preprocess_policy(config: dict[str, Any]) -> LocalePreprocessPolicy:
    return LocalePreprocessPolicy(
        language_families=tuple(config["language_families"]),
        ngram_min=int(config["ngram_min"]),
        ngram_max=int(config["ngram_max"]),
        preserve_negation=True,
        preserve_symbols=True,
    )


def _membership_strengths(
    probabilities: Any, model: Any, size: int
) -> tuple[np.ndarray, Literal["available", "not_available"]]:
    candidate = probabilities
    if candidate is None:
        candidate = getattr(model.hdbscan_model, "probabilities_", None)
    if candidate is None:
        return np.full(size, np.nan, dtype=np.float32), "not_available"
    values = np.asarray(candidate, dtype=np.float32)
    if values.ndim == 2:
        values = values.max(axis=1)
    if values.shape != (size,) or not np.all(np.isfinite(values)):
        return np.full(size, np.nan, dtype=np.float32), "not_available"
    return values, "available"


def _declared_parameters(config: dict[str, Any]) -> dict[str, Any]:
    excluded = {
        "key",
        "framework",
        "version",
        "revision",
        "license",
        "license_url",
        "role",
    }
    return {key: value for key, value in sorted(config.items()) if key not in excluded}
