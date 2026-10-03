from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass

from .schema import BenchmarkRecord, BenchmarkRecordV2


@dataclass(frozen=True)
class SplitAssignment:
    record_key: str
    split: str
    stratum: str


def deterministic_splits(
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    *,
    seed: int,
    train: float,
    calibration: float,
) -> list[SplitAssignment]:
    if not (0 < train < 1 and 0 < calibration < 1 and train + calibration < 1):
        raise ValueError("benchmark_split_fraction_invalid")
    parents = list(range(len(records)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[max(left_root, right_root)] = min(left_root, right_root)

    family_owner: dict[str, int] = {}
    content_owner: dict[str, int] = {}
    strata: list[str] = []
    for index, record in enumerate(records):
        previous_family = family_owner.setdefault(record.canonical_family_key, index)
        previous_content = content_owner.setdefault(record.content_hash, index)
        union(index, previous_family)
        union(index, previous_content)
        if isinstance(record, BenchmarkRecordV2):
            partitions = ",".join(
                sorted(membership.partition_key for membership in record.partition_memberships)
            )
            markets = ",".join(
                sorted({membership.declared_market for membership in record.partition_memberships})
            )
            stratum = "|".join(
                [record.month, partitions, record.language, markets, record.platform]
            )
        else:
            scopes = (
                ",".join(sorted({intent.scope for intent in record.provenance_intents}))
                or "unknown"
            )
            stratum = "|".join([record.month, scopes, record.language, record.platform])
        strata.append(stratum)

    components: dict[int, list[int]] = defaultdict(list)
    for index in range(len(records)):
        components[find(index)].append(index)
    by_stratum: dict[str, list[list[int]]] = defaultdict(list)
    for members in components.values():
        component_stratum = "||".join(sorted({strata[index] for index in members}))
        by_stratum[component_stratum].append(members)

    assignments: list[SplitAssignment] = []
    for _stratum, component_rows in sorted(by_stratum.items()):
        ordered = sorted(
            component_rows,
            key=lambda members: stable_value(
                seed,
                ",".join(sorted(records[index].record_key for index in members)),
            ),
        )
        for position_index, members in enumerate(ordered):
            position = (position_index + 0.5) / len(ordered)
            split = (
                "train"
                if position <= train
                else ("calibration" if position <= train + calibration else "holdout")
            )
            assignments.extend(
                SplitAssignment(records[index].record_key, split, strata[index])
                for index in members
            )
    return sorted(assignments, key=lambda item: item.record_key)


def assert_no_leakage(
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    assignments: list[SplitAssignment],
) -> None:
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
