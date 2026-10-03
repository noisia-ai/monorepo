from __future__ import annotations

import hashlib
from collections.abc import Iterable

from gensim.corpora import Dictionary
from gensim.models import CoherenceModel

from .preprocess import LocalePreprocessPolicy, locale_tokens


def c_npmi(
    texts: Iterable[str],
    terms: dict[int, list[str]],
    *,
    max_records: int,
    record_keys: Iterable[str] | None = None,
    language_families: list[str] | tuple[str, ...] = ("es", "en"),
) -> tuple[float | None, int]:
    values = list(texts)
    keys = (
        list(record_keys)
        if record_keys is not None
        else [str(index) for index in range(len(values))]
    )
    if len(values) != len(keys):
        raise ValueError("benchmark_coherence_record_key_shape_mismatch")
    selected = [
        text
        for _key, text in sorted(
            zip(keys, values, strict=True),
            key=lambda row: hashlib.sha256(f"{row[0]}:{row[1]}".encode()).hexdigest(),
        )[:max_records]
    ]
    policy = LocalePreprocessPolicy(
        language_families=tuple(language_families), ngram_min=1, ngram_max=3
    )
    tokens = [locale_tokens(text, policy) for text in selected]
    topics = [values for _topic, values in sorted(terms.items()) if values]
    if not tokens or not topics:
        return None, len(selected)
    dictionary = Dictionary(tokens)
    filtered = [[term for term in topic if term in dictionary.token2id] for topic in topics]
    filtered = [topic for topic in filtered if len(topic) >= 2]
    if not filtered:
        return None, len(selected)
    model = CoherenceModel(
        topics=filtered,
        texts=tokens,
        dictionary=dictionary,
        coherence="c_npmi",
        processes=1,
    )
    return float(model.get_coherence()), len(selected)
