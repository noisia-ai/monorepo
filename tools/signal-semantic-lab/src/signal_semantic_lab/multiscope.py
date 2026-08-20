from __future__ import annotations

from collections import defaultdict
from math import ceil
from typing import Any

import numpy as np

from .metrics import assignment_metrics
from .schema import BenchmarkRecordV2
from .splits import SplitAssignment, stable_value
from .stability import stability_metrics


def stratified_multiscope_indexes(
    records: list[BenchmarkRecordV2],
    assignments: list[SplitAssignment],
    *,
    split: str,
    required_partitions: list[str],
    maximum_per_partition: int,
    seed: int,
    stage: str,
) -> list[int]:
    """Select a non-duplicated physical sample while balancing every partition.

    A shared canonical root can satisfy more than one partition quota, but its row is
    emitted once. Selection is stratified inside each partition by the frozen fields.
    """

    if maximum_per_partition < 1:
        raise ValueError("benchmark_partition_sample_limit_invalid")
    split_by_key = {assignment.record_key: assignment.split for assignment in assignments}
    selected: set[int] = set()
    observed_partitions = {
        membership.partition_key
        for record in records
        for membership in record.partition_memberships
    }
    missing = sorted(set(required_partitions) - observed_partitions)
    if missing:
        raise ValueError(f"benchmark_required_partition_missing:{','.join(missing)}")
    for partition in required_partitions:
        strata: dict[str, list[int]] = defaultdict(list)
        for index, record in enumerate(records):
            if split_by_key.get(record.record_key) != split:
                continue
            membership = next(
                (
                    value
                    for value in record.partition_memberships
                    if value.partition_key == partition
                ),
                None,
            )
            if membership is None:
                continue
            stratum = "|".join(
                [
                    membership.partition_key,
                    membership.entity_ref,
                    record.language,
                    membership.declared_market,
                    record.month,
                    record.platform,
                ]
            )
            strata[stratum].append(index)
        eligible = sum(len(values) for values in strata.values())
        if eligible == 0:
            raise ValueError(f"benchmark_required_partition_split_empty:{partition}:{split}")
        target = min(maximum_per_partition, eligible)
        selected.update(
            _proportional_stratified_sample(
                records,
                strata,
                target=target,
                seed=seed,
                namespace=f"{stage}:{partition}",
            )
        )
    return sorted(selected)


def multiscope_metrics(
    records: list[BenchmarkRecordV2],
    labels: np.ndarray,
    required_partitions: list[str],
) -> dict[str, Any]:
    if len(records) != len(labels):
        raise ValueError("benchmark_multiscope_assignment_shape_mismatch")
    observed = {
        membership.partition_key
        for record in records
        for membership in record.partition_memberships
    }
    missing = sorted(set(required_partitions) - observed)
    if missing:
        raise ValueError(f"benchmark_required_partition_missing:{','.join(missing)}")
    partitions: dict[str, Any] = {}
    coverages: list[float] = []
    for partition_key in required_partitions:
        indexes = np.asarray(
            [
                index
                for index, record in enumerate(records)
                if any(
                    membership.partition_key == partition_key
                    for membership in record.partition_memberships
                )
            ],
            dtype=np.int64,
        )
        metrics = assignment_metrics(labels[indexes])
        coverage = metrics["coverage"]
        if coverage is None:
            raise ValueError(f"benchmark_partition_coverage_not_available:{partition_key}")
        partitions[partition_key] = {
            **metrics,
            "slices": partition_slice_metrics(
                [records[int(index)] for index in indexes],
                labels[indexes],
                partition_key=partition_key,
            ),
        }
        coverages.append(float(coverage))
    global_metrics = assignment_metrics(labels)
    return {
        "global": global_metrics,
        "partitions": partitions,
        "macro_equal_partition_coverage": float(np.mean(coverages)),
        "micro_global_coverage": global_metrics["coverage"],
        "partition_coverage_gap": max(coverages) - min(coverages),
        "partition_weights": {key: 1 / len(required_partitions) for key in required_partitions},
        "physical_record_count": len(records),
        "partition_membership_count": sum(len(record.partition_memberships) for record in records),
        "shared_root_count": sum(len(record.partition_memberships) > 1 for record in records),
        "physical_rows_are_unique": len({record.record_key for record in records}) == len(records),
    }


def partition_slice_metrics(
    records: list[BenchmarkRecordV2],
    labels: np.ndarray,
    *,
    partition_key: str,
) -> dict[str, dict[str, dict[str, int | float]]]:
    if len(records) != len(labels):
        raise ValueError("benchmark_partition_slice_shape_mismatch")
    slices: dict[str, dict[str, list[bool]]] = defaultdict(lambda: defaultdict(list))
    for record, label in zip(records, labels, strict=True):
        markets = {
            membership.declared_market
            for membership in record.partition_memberships
            if membership.partition_key == partition_key
        }
        dimensions = {
            "language": {record.language},
            "declared_market": markets,
            "platform": {record.platform},
            "month": {record.month},
        }
        for dimension, values in dimensions.items():
            for value in values:
                slices[dimension][value].append(bool(label >= 0))
    return {
        dimension: {
            value: {
                "denominator": len(assignments),
                "assigned": sum(assignments),
                "coverage": sum(assignments) / len(assignments),
            }
            for value, assignments in sorted(values.items())
        }
        for dimension, values in sorted(slices.items())
    }


def passes_multiscope_hard_gates(metrics: dict[str, Any], gates: dict[str, Any]) -> bool:
    multi = metrics.get("multiscope", {})
    global_metrics = multi.get("global", {})
    partition_metrics = multi.get("partitions", {})
    coverages = [value.get("coverage") for value in partition_metrics.values()]
    return bool(
        global_metrics.get("coverage") is not None
        and float(global_metrics["coverage"]) >= float(gates["minimum_global_coverage"])
        and coverages
        and all(
            value is not None and float(value) >= float(gates["minimum_each_partition_coverage"])
            for value in coverages
        )
        and float(multi.get("partition_coverage_gap", 1.0))
        <= float(gates["maximum_partition_coverage_gap"])
        and multi.get("physical_rows_are_unique") is True
    )


def _proportional_stratified_sample(
    records: list[BenchmarkRecordV2],
    strata: dict[str, list[int]],
    *,
    target: int,
    seed: int,
    namespace: str,
) -> list[int]:
    eligible = sum(len(values) for values in strata.values())
    if target >= eligible:
        return sorted(index for values in strata.values() for index in values)
    ideals = {key: target * len(values) / eligible for key, values in strata.items()}
    quotas = {key: int(value) for key, value in ideals.items()}
    remaining = target - sum(quotas.values())
    for key in sorted(strata, key=lambda value: (-(ideals[value] - quotas[value]), value))[
        :remaining
    ]:
        quotas[key] += 1
    selected: list[int] = []
    for key, indexes in sorted(strata.items()):
        ranked = sorted(
            indexes,
            key=lambda index: stable_value(seed, f"{namespace}:{key}:{records[index].record_key}"),
        )
        selected.extend(ranked[: quotas[key]])
    if len(selected) != target:
        raise ValueError("benchmark_partition_stratified_count_mismatch")
    return selected


def smoke_partition_limit(total_limit: int, partition_count: int) -> int:
    if total_limit < 1 or partition_count < 1:
        raise ValueError("benchmark_smoke_partition_limit_invalid")
    return ceil(total_limit / partition_count)


def dry_run_multiscope_contract(
    records: list[BenchmarkRecordV2],
    required_partitions: list[str],
    gates: dict[str, Any],
) -> dict[str, Any]:
    """Exercise accounting/gates with deterministic labels and no modeling runtime."""

    valid_labels = np.asarray([index % 12 for index in range(len(records))], dtype=np.int64)
    low_coverage = np.asarray(
        [index % 12 if index % 3 == 0 else -1 for index in range(len(records))],
        dtype=np.int64,
    )
    gap_labels = valid_labels.copy()
    target = required_partitions[-1]
    target_indexes = [
        index
        for index, record in enumerate(records)
        if any(item.partition_key == target for item in record.partition_memberships)
    ]
    for index in target_indexes[: int(len(target_indexes) * 0.7)]:
        gap_labels[index] = -1
    unstable_labels = np.asarray(
        [(index * 7 + 3) % 13 for index in range(len(records))], dtype=np.int64
    )
    valid = multiscope_metrics(records, valid_labels, required_partitions)
    low = multiscope_metrics(records, low_coverage, required_partitions)
    gap = multiscope_metrics(records, gap_labels, required_partitions)
    unstable = stability_metrics(valid_labels, unstable_labels)
    minimum_ari = float(gates["minimum_full_adjusted_rand"])
    minimum_consistency = float(gates["minimum_matched_assignment_consistency"])
    return {
        "contract_version": "signal-multiscope-harness-dry-run-v1",
        "record_count": len(records),
        "partition_membership_count": valid["partition_membership_count"],
        "shared_root_count": valid["shared_root_count"],
        "physical_rows_are_unique": valid["physical_rows_are_unique"],
        "equal_partition_weights": valid["partition_weights"],
        "valid_case": {
            "multiscope": valid,
            "passes_coverage_gates": passes_multiscope_hard_gates({"multiscope": valid}, gates),
        },
        "low_coverage_case": {
            "multiscope": low,
            "passes_coverage_gates": passes_multiscope_hard_gates({"multiscope": low}, gates),
        },
        "partition_gap_case": {
            "multiscope": gap,
            "passes_coverage_gates": passes_multiscope_hard_gates({"multiscope": gap}, gates),
        },
        "unstable_case": {
            **unstable,
            "passes_stability_gates": bool(
                unstable["adjusted_rand"] >= minimum_ari
                and unstable["matched_assignment_consistency"] >= minimum_consistency
            ),
        },
        "majority_stopword_case": {
            "majority_stopword_topic_rate": 0.25,
            "passes_representation_gate": False,
        },
        "provider_calls": 0,
        "remote_writes": 0,
        "serving_writes": 0,
        "holdout_state": "sealed",
    }
