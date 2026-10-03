from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from .canonical import require_private, sha256_file, sha256_text
from .schema import BenchmarkRecord, BenchmarkRecordV2, ExportManifest, ExportManifestV2


def load_export(
    input_path: Path, manifest_path: Path
) -> tuple[list[BenchmarkRecord] | list[BenchmarkRecordV2], ExportManifest | ExportManifestV2]:
    require_private(input_path)
    require_private(manifest_path)
    raw_manifest = manifest_path.read_text()
    contract_version = json.loads(raw_manifest).get("contract_version")
    if contract_version == "signal-semantic-benchmark-export-v1":
        manifest: ExportManifest | ExportManifestV2 = ExportManifest.model_validate_json(
            raw_manifest
        )
        record_model = BenchmarkRecord
    elif contract_version == "signal-semantic-benchmark-export-v2":
        manifest = ExportManifestV2.model_validate_json(raw_manifest)
        record_model = BenchmarkRecordV2
    else:
        raise ValueError("benchmark_export_contract_invalid")
    if sha256_file(input_path) != manifest.export_file_sha256:
        raise ValueError("benchmark_export_file_digest_mismatch")
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2] = []
    with input_path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                records.append(record_model.model_validate_json(line))
            except Exception as error:  # pragma: no cover - pydantic supplies details
                raise ValueError(f"benchmark_record_invalid:{line_number}") from error
    validate_records(records, manifest)
    return records, manifest


def validate_records(
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
    manifest: ExportManifest | ExportManifestV2,
) -> None:
    if len(records) != manifest.exported:
        raise ValueError("benchmark_export_count_mismatch")
    record_keys = [record.record_key for record in records]
    if len(record_keys) != len(set(record_keys)):
        raise ValueError("benchmark_record_key_duplicate")
    family_keys = [record.canonical_family_key for record in records]
    if len(family_keys) != len(set(family_keys)):
        raise ValueError("benchmark_canonical_family_duplicate")
    for record in records:
        # The exporter owns the normalized record contract. Hash the exact UTF-8 payload
        # here: Node and Python can ship different Unicode NFKC tables, so normalizing a
        # second time would redefine artifact identity across runtimes. Model-specific
        # preprocessing remains separately versioned and may normalize again.
        if not record.text or sha256_text(record.text) != record.content_hash:
            raise ValueError("benchmark_content_hash_mismatch")
    if isinstance(manifest, ExportManifest):
        digest = sha256_text(
            "\n".join(
                f"{record.record_key}|{record.content_hash}|{record.context_hash}|{record.authority_digest}"
                for record in sorted(records, key=lambda item: item.record_key)
                if isinstance(record, BenchmarkRecord)
            )
        )
        if digest != manifest.content_digest:
            raise ValueError("benchmark_content_digest_mismatch")
    else:
        if not all(isinstance(record, BenchmarkRecordV2) for record in records):
            raise ValueError("benchmark_record_contract_mismatch")
        digest = export_records_digest_v2(
            [record for record in records if isinstance(record, BenchmarkRecordV2)]
        )
        if digest != manifest.export_records_digest:
            raise ValueError("benchmark_export_records_digest_mismatch")
    counts = observed_counts(records)
    if isinstance(manifest, ExportManifest):
        expected_counts = {
            "scope": manifest.scope_counts,
            "entity": manifest.entity_counts,
            "language": manifest.language_counts,
            "platform": manifest.platform_counts,
        }
        if counts != expected_counts:
            raise ValueError("benchmark_slice_counts_mismatch")
    else:
        expected_counts_v2 = {
            "partition": {
                key: partition.included for key, partition in manifest.partitions.items()
            },
            "language": manifest.language_counts,
            "country": manifest.country_counts,
            "platform": manifest.platform_counts,
            "declared_market": manifest.declared_market_membership_counts,
        }
        if counts != expected_counts_v2:
            raise ValueError("benchmark_slice_counts_mismatch")
        observed_shared = sum(
            len(record.partition_memberships) > 1
            for record in records
            if isinstance(record, BenchmarkRecordV2)
        )
        if observed_shared != manifest.shared_root_count:
            raise ValueError("benchmark_shared_root_count_mismatch")
    if records:
        dates = sorted(record.published_at.date().isoformat() for record in records)
        if dates[0] != manifest.period_start or dates[-1] != manifest.period_end:
            raise ValueError("benchmark_period_mismatch")
    for record in records:
        expiries = (
            [record.authority_valid_until]
            if isinstance(record, BenchmarkRecord)
            else [membership.authority_valid_until for membership in record.partition_memberships]
        )
        if any(expiry is not None and expiry <= manifest.export_timestamp for expiry in expiries):
            raise ValueError("benchmark_authority_expired_at_export")


def observed_counts(
    records: list[BenchmarkRecord] | list[BenchmarkRecordV2],
) -> dict[str, dict[str, int]]:
    if records and isinstance(records[0], BenchmarkRecordV2):
        typed = [record for record in records if isinstance(record, BenchmarkRecordV2)]
        return {
            "partition": dict(
                sorted(
                    Counter(
                        membership.partition_key
                        for record in typed
                        for membership in record.partition_memberships
                    ).items()
                )
            ),
            "language": dict(sorted(Counter(record.language for record in typed).items())),
            "country": dict(sorted(Counter(record.country for record in typed).items())),
            "platform": dict(sorted(Counter(record.platform for record in typed).items())),
            "declared_market": dict(
                sorted(
                    Counter(
                        membership.declared_market
                        for record in typed
                        for membership in record.partition_memberships
                    ).items()
                )
            ),
        }
    legacy = [record for record in records if isinstance(record, BenchmarkRecord)]
    return {
        "scope": dict(
            sorted(
                Counter(
                    intent.scope for record in legacy for intent in record.provenance_intents
                ).items()
            )
        ),
        "entity": dict(
            sorted(
                Counter(
                    intent.entity_ref
                    for record in legacy
                    for intent in record.provenance_intents
                    if intent.entity_ref is not None
                ).items()
            )
        ),
        "language": dict(sorted(Counter(record.language for record in legacy).items())),
        "platform": dict(sorted(Counter(record.platform for record in legacy).items())),
    }


def export_records_digest_v2(records: list[BenchmarkRecordV2]) -> str:
    return sha256_text(
        "\n".join(
            "|".join(
                [
                    record.record_key,
                    record.content_hash,
                    record.authority_digest,
                    ",".join(
                        f"{membership.partition_key}:{membership.provenance_digest}:"
                        f"{membership.authority_digest}"
                        for membership in sorted(
                            record.partition_memberships,
                            key=lambda value: value.partition_key,
                        )
                    ),
                ]
            )
            for record in sorted(records, key=lambda item: item.record_key)
        )
    )
