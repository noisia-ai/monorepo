from __future__ import annotations

from collections import Counter
from pathlib import Path

from .canonical import require_private, sha256_file, sha256_text
from .schema import BenchmarkRecord, ExportManifest


def load_export(
    input_path: Path, manifest_path: Path
) -> tuple[list[BenchmarkRecord], ExportManifest]:
    require_private(input_path)
    require_private(manifest_path)
    manifest = ExportManifest.model_validate_json(manifest_path.read_text())
    if sha256_file(input_path) != manifest.export_file_sha256:
        raise ValueError("benchmark_export_file_digest_mismatch")
    records: list[BenchmarkRecord] = []
    with input_path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                records.append(BenchmarkRecord.model_validate_json(line))
            except Exception as error:  # pragma: no cover - pydantic supplies details
                raise ValueError(f"benchmark_record_invalid:{line_number}") from error
    validate_records(records, manifest)
    return records, manifest


def validate_records(records: list[BenchmarkRecord], manifest: ExportManifest) -> None:
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
    digest = sha256_text(
        "\n".join(
            f"{record.record_key}|{record.content_hash}|{record.context_hash}|{record.authority_digest}"
            for record in sorted(records, key=lambda item: item.record_key)
        )
    )
    if digest != manifest.content_digest:
        raise ValueError("benchmark_content_digest_mismatch")
    counts = observed_counts(records)
    expected_counts = {
        "scope": manifest.scope_counts,
        "entity": manifest.entity_counts,
        "language": manifest.language_counts,
        "platform": manifest.platform_counts,
    }
    if counts != expected_counts:
        raise ValueError("benchmark_slice_counts_mismatch")
    if records:
        dates = sorted(record.published_at.date().isoformat() for record in records)
        if dates[0] != manifest.period_start or dates[-1] != manifest.period_end:
            raise ValueError("benchmark_period_mismatch")
    if any(
        record.authority_valid_until is not None
        and record.authority_valid_until <= manifest.export_timestamp
        for record in records
    ):
        raise ValueError("benchmark_authority_expired_at_export")


def observed_counts(records: list[BenchmarkRecord]) -> dict[str, dict[str, int]]:
    return {
        "scope": dict(
            sorted(
                Counter(
                    intent.scope for record in records for intent in record.provenance_intents
                ).items()
            )
        ),
        "entity": dict(
            sorted(
                Counter(
                    intent.entity_ref
                    for record in records
                    for intent in record.provenance_intents
                    if intent.entity_ref is not None
                ).items()
            )
        ),
        "language": dict(sorted(Counter(record.language for record in records).items())),
        "platform": dict(sorted(Counter(record.platform for record in records).items())),
    }
