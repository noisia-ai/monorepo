from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass

from .schema import BenchmarkRecord


@dataclass(frozen=True)
class SplitAssignment:
    record_key: str
    split: str
    stratum: str


def deterministic_splits(
    records: list[BenchmarkRecord], *, seed: int, train: float, calibration: float
) -> list[SplitAssignment]:
    if not (0 < train < 1 and 0 < calibration < 1 and train + calibration < 1):
        raise ValueError("benchmark_split_fraction_invalid")
    by_stratum: dict[str, list[BenchmarkRecord]] = defaultdict(list)
    for record in records:
        scopes = (
            ",".join(sorted({intent.scope for intent in record.provenance_intents})) or "unknown"
        )
        stratum = "|".join([record.month, scopes, record.language, record.platform])
        by_stratum[stratum].append(record)
    assignments: list[SplitAssignment] = []
    content_split: dict[str, str] = {}
    for stratum, members in sorted(by_stratum.items()):
        ordered = sorted(members, key=lambda item: stable_value(seed, item.canonical_family_key))
        for index, record in enumerate(ordered):
            position = (index + 0.5) / len(ordered)
            split = (
                "train"
                if position <= train
                else ("calibration" if position <= train + calibration else "holdout")
            )
            previous = content_split.setdefault(record.content_hash, split)
            if previous != split:
                split = previous
            assignments.append(SplitAssignment(record.record_key, split, stratum))
    return sorted(assignments, key=lambda item: item.record_key)


def assert_no_leakage(records: list[BenchmarkRecord], assignments: list[SplitAssignment]) -> None:
    split_by_key = {assignment.record_key: assignment.split for assignment in assignments}
    families: dict[str, set[str]] = defaultdict(set)
    contents: dict[str, set[str]] = defaultdict(set)
    for record in records:
        split = split_by_key[record.record_key]
        families[record.canonical_family_key].add(split)
        contents[record.content_hash].add(split)
    if any(len(values) != 1 for values in families.values()):
        raise ValueError("benchmark_canonical_family_leakage")
    if any(len(values) != 1 for values in contents.values()):
        raise ValueError("benchmark_content_hash_leakage")


def stable_value(seed: int, value: str) -> str:
    return hashlib.sha256(f"{seed}:{value}".encode()).hexdigest()
