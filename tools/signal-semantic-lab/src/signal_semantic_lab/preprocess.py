from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

_WHITESPACE = re.compile(r"\s+", flags=re.UNICODE)
_URL = re.compile(r"(?:https?://|www\.)\S+", flags=re.IGNORECASE)
_TOKEN = re.compile(
    r"[@#]?[\wÀ-ÖØ-öø-ÿ]+(?:['\u2019][\wÀ-ÖØ-öø-ÿ]+)?|[^\w\s]",
    flags=re.UNICODE,
)

# These lists are a versioned representation policy, not a language detector. Negation
# terms are deliberately removed below because they materially change meaning.
_SPANISH_STOPWORDS = {
    "a",
    "al",
    "algo",
    "algunas",
    "algunos",
    "ahi",
    "alla",
    "alli",
    "ante",
    "antes",
    "aqui",
    "asi",
    "como",
    "con",
    "contra",
    "cual",
    "cuando",
    "de",
    "del",
    "despues",
    "desde",
    "donde",
    "durante",
    "e",
    "el",
    "ella",
    "ellas",
    "ellos",
    "en",
    "entre",
    "era",
    "erais",
    "eran",
    "eras",
    "eres",
    "es",
    "esa",
    "esas",
    "ese",
    "eso",
    "esos",
    "esta",
    "estaba",
    "estaban",
    "estado",
    "estamos",
    "estan",
    "estar",
    "estas",
    "este",
    "esto",
    "estos",
    "fue",
    "fueron",
    "ha",
    "hace",
    "hacia",
    "han",
    "hasta",
    "hay",
    "la",
    "las",
    "le",
    "les",
    "lo",
    "los",
    "mas",
    "me",
    "mi",
    "mis",
    "muy",
    "o",
    "os",
    "otra",
    "otras",
    "otro",
    "otros",
    "para",
    "pero",
    "por",
    "porque",
    "que",
    "quien",
    "se",
    "sea",
    "ser",
    "si",
    "sobre",
    "son",
    "su",
    "sus",
    "tambien",
    "te",
    "tiene",
    "tienen",
    "todo",
    "todos",
    "tu",
    "tus",
    "un",
    "una",
    "unas",
    "uno",
    "unos",
    "y",
    "ya",
    "yo",
}
_NEGATIONS = {
    "no",
    "nunca",
    "jamás",
    "jamas",
    "ni",
    "sin",
    "tampoco",
    "not",
    "never",
    "neither",
    "nor",
    "without",
    "hardly",
}
_TECHNICAL_BOILERPLATE = {
    "amp",
    "http",
    "https",
    "www",
    "com",
    "rt",
    "via",
    "nbsp",
    "utm",
    "href",
}
_ENGLISH_STOPWORDS = set(ENGLISH_STOP_WORDS)

STOPWORD_POLICY_VERSION = "signal-locale-stopwords-es-en-v3"
PREPROCESSING_CONTRACT_VERSION = "signal-locale-aware-preprocessing-v3"


@dataclass(frozen=True)
class LocalePreprocessPolicy:
    language_families: tuple[str, ...]
    ngram_min: int = 1
    ngram_max: int = 3
    preserve_negation: bool = True
    preserve_symbols: bool = True
    url_policy: str = "remove"
    contract_version: str = PREPROCESSING_CONTRACT_VERSION
    stopword_policy_version: str = STOPWORD_POLICY_VERSION

    def __post_init__(self) -> None:
        allowed = {"es", "en"}
        if not self.language_families or not set(self.language_families) <= allowed:
            raise ValueError("benchmark_locale_language_family_unsupported")
        if self.ngram_min < 1 or self.ngram_max < self.ngram_min or self.ngram_max > 3:
            raise ValueError("benchmark_locale_ngram_range_invalid")
        if self.url_policy != "remove":
            raise ValueError("benchmark_locale_url_policy_unsupported")


def normalize_text(value: str) -> str:
    return _WHITESPACE.sub(" ", unicodedata.normalize("NFKC", value)).strip()


def locale_stopwords(language_families: Iterable[str]) -> frozenset[str]:
    families = set(language_families)
    unknown = families - {"es", "en"}
    if unknown:
        raise ValueError("benchmark_locale_language_family_unsupported")
    words: set[str] = set(_TECHNICAL_BOILERPLATE)
    if "es" in families:
        words.update(_SPANISH_STOPWORDS)
    if "en" in families:
        words.update(_ENGLISH_STOPWORDS)
    words.difference_update(_NEGATIONS)
    return frozenset(words)


def locale_tokens(value: str, policy: LocalePreprocessPolicy) -> list[str]:
    normalized = normalize_text(_URL.sub(" ", value)).casefold()
    stopwords = locale_stopwords(policy.language_families)
    unigrams: list[str] = []
    for raw in _TOKEN.findall(normalized):
        token = raw.strip("_")
        if not token:
            continue
        if _is_symbol(token):
            if policy.preserve_symbols:
                unigrams.append(token)
            continue
        if token.isnumeric() or len(token) < 2 or _stopword_key(token) in stopwords:
            continue
        unigrams.append(token)
    output = list(unigrams) if policy.ngram_min == 1 else []
    lexical = [token for token in unigrams if not _is_symbol(token)]
    for size in range(max(2, policy.ngram_min), policy.ngram_max + 1):
        output.extend(
            "_".join(lexical[index : index + size]) for index in range(len(lexical) - size + 1)
        )
    return output


def lexical_tokens(value: str) -> list[str]:
    """Compatibility tokenizer using the benchmark's bilingual unigram policy."""
    return locale_tokens(
        value,
        LocalePreprocessPolicy(language_families=("es", "en"), ngram_max=1),
    )


def representation_stopword_fraction(
    terms: Iterable[str], language_families: Iterable[str]
) -> float | None:
    values = [value.casefold().replace("_", " ").split()[0] for value in terms if value]
    if not values:
        return None
    stopwords = locale_stopwords(language_families)
    return sum(_stopword_key(value) in stopwords for value in values) / len(values)


def _stopword_key(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", value.casefold())
        if not unicodedata.combining(character)
    )


def _is_symbol(value: str) -> bool:
    return len(value) <= 8 and all(
        unicodedata.category(character).startswith(("S", "M")) for character in value
    )
