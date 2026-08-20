from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .canonical import sha256_file, sha256_text, write_private_json
from .input_data import export_records_digest_v2
from .preprocess import normalize_text
from .schema import BenchmarkRecordV2


def generate_fixture(output_dir: Path, count: int) -> dict[str, object]:
    if count < 200:
        raise ValueError("benchmark_fixture_too_small")
    output_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(output_dir, 0o700)
    topics = [
        (
            "audio",
            "La fidelidad del audio resalta graves y claridad musical",
            "Audio fidelity improves bass and musical clarity",
        ),
        (
            "precio",
            "El precio y las promociones afectan la decisión de compra",
            "Price and promotions influence the purchase decision",
        ),
        (
            "privacidad",
            "La privacidad y el uso de datos generan dudas",
            "Privacy and data collection create concerns",
        ),
        (
            "integración",
            "La integración con el hogar inteligente conecta dispositivos",
            "Smart home integration connects household devices",
        ),
        (
            "soporte",
            "El soporte y la configuración inicial necesitan mejoras",
            "Support and initial setup need improvements",
        ),
        (
            "competencia",
            "La comparación con alternativas cambia la preferencia",
            "Comparing alternatives changes product preference",
        ),
        (
            "voz",
            "El reconocimiento de voz entiende acentos y órdenes",
            "Voice recognition understands accents and commands",
        ),
        (
            "música",
            "El catálogo musical y las playlists facilitan descubrir canciones",
            "Music catalogs and playlists help discover songs",
        ),
        (
            "podcasts",
            "Los podcasts y audiolibros necesitan controles de reproducción",
            "Podcasts and audiobooks need playback controls",
        ),
        (
            "rutinas",
            "Las rutinas automatizan luces alarmas y escenas domésticas",
            "Routines automate lights alarms and home scenes",
        ),
        (
            "conectividad",
            "La conexión wifi pierde estabilidad en habitaciones lejanas",
            "Wifi connectivity loses stability in distant rooms",
        ),
        (
            "diseño",
            "El diseño compacto combina materiales colores y acabados",
            "Compact design combines materials colors and finishes",
        ),
        (
            "energía",
            "El consumo de energía y el modo reposo importan",
            "Energy consumption and standby mode matter",
        ),
        (
            "accesibilidad",
            "La accesibilidad mejora con avisos auditivos y controles simples",
            "Accessibility improves with audio cues and simple controls",
        ),
        (
            "familia",
            "Los perfiles familiares separan preferencias y calendarios",
            "Family profiles separate preferences and calendars",
        ),
        (
            "niñez",
            "Los controles parentales protegen contenido y compras infantiles",
            "Parental controls protect children content and purchases",
        ),
        (
            "actualizaciones",
            "Las actualizaciones de software corrigen errores y funciones",
            "Software updates fix bugs and features",
        ),
        (
            "latencia",
            "La respuesta lenta retrasa comandos y conversaciones",
            "Slow latency delays commands and conversations",
        ),
        (
            "llamadas",
            "Las llamadas y mensajes requieren audio estable",
            "Calls and messages require stable audio",
        ),
        (
            "seguridad",
            "Las alertas de seguridad detectan humo puertas y movimiento",
            "Security alerts detect smoke doors and movement",
        ),
        (
            "clima",
            "El clima y los pronósticos ayudan a planear actividades",
            "Weather forecasts help plan activities",
        ),
        (
            "recetas",
            "Las recetas guiadas usan temporizadores y listas de ingredientes",
            "Guided recipes use timers and ingredient lists",
        ),
        (
            "disponibilidad",
            "El inventario y la entrega varían entre regiones",
            "Inventory and delivery vary between regions",
        ),
        (
            "sostenibilidad",
            "El empaque reciclable reduce residuos y materiales",
            "Recyclable packaging reduces waste and materials",
        ),
    ]
    platforms = ["x", "youtube", "news", "forum"]
    languages = ["es", "es", "es", "en"]
    base = datetime(2026, 1, 1, tzinfo=UTC)
    rows: list[dict[str, object]] = []
    for index in range(count):
        _topic, spanish_sentence, english_sentence = topics[index % len(topics)]
        language = languages[index % len(languages)]
        text = normalize_text(spanish_sentence if language == "es" else english_sentence)
        text = f"{text} caso {index}"
        published = base + timedelta(hours=index * 3)
        row = {
            "contract_version": "signal-semantic-benchmark-record-v1",
            "record_key": sha256_text(f"record:{index}"),
            "canonical_family_key": sha256_text(f"family:{index}"),
            "content_hash": sha256_text(text),
            "text": text,
            "published_at": published.isoformat(),
            "month": published.strftime("%Y-%m"),
            "language": language,
            "country": "mx" if language == "es" else "us",
            "platform": platforms[index % len(platforms)],
            "provenance_intents": [
                {
                    "scope": ["primary_brand", "competitor", "category"][index % 3],
                    "entity_ref": sha256_text(f"entity:{index % 3}"),
                }
            ],
            "queue_state": ["unresolved", "candidate_pending", "current_approved"][index % 3],
            "context_hash": sha256_text(f"context:{index}"),
            "authority_digest": sha256_text(f"authority:{index % 3}"),
            "authority_valid_until": None,
        }
        rows.append(row)
    source = output_dir / "source-export.private.jsonl"
    source.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n")
    os.chmod(source, 0o600)
    content_digest = sha256_text(
        "\n".join(
            "|".join(
                [
                    str(row["record_key"]),
                    str(row["content_hash"]),
                    str(row["context_hash"]),
                    str(row["authority_digest"]),
                ]
            )
            for row in sorted(rows, key=lambda value: str(value["record_key"]))
        )
    )
    scopes = {
        scope: sum(
            1
            for row in rows
            if row["provenance_intents"][0]["scope"] == scope  # type: ignore[index]
        )
        for scope in ("primary_brand", "competitor", "category")
    }
    manifest = {
        "contract_version": "signal-semantic-benchmark-export-v1",
        "target": "local-fixture",
        "read_only": True,
        "writes_performed": False,
        "provider_calls": 0,
        "jobs_enqueued": 0,
        "workspace_ref": sha256_text("local-fixture-workspace"),
        "export_timestamp": datetime.now(UTC).isoformat(),
        "period_start": rows[0]["published_at"][:10],  # type: ignore[index]
        "period_end": rows[-1]["published_at"][:10],  # type: ignore[index]
        "timezone": "America/Mexico_City",
        "population_digest": sha256_text("local-population"),
        "watermark_digest": sha256_text("local-watermark"),
        "governance_digest": sha256_text("local-governance"),
        "content_digest": content_digest,
        "schema_version": "signal-semantic-benchmark-record-v1",
        "denominator": count,
        "exported": count,
        "excluded_by_reason": {},
        "scope_counts": scopes,
        "entity_counts": {
            sha256_text(f"entity:{index}"): sum(
                1
                for row in rows
                if row["provenance_intents"][0]["entity_ref"] == sha256_text(f"entity:{index}")  # type: ignore[index]
            )
            for index in range(3)
        },
        "language_counts": {
            language: sum(1 for row in rows if row["language"] == language)
            for language in sorted(set(languages))
        },
        "platform_counts": {
            platform: sum(1 for row in rows if row["platform"] == platform)
            for platform in platforms
        },
        "projection_snapshot_digest": sha256_text("local-snapshot"),
        "projection_generation": 1,
        "projection_reconciled_at": datetime.now(UTC).isoformat(),
        "exclusion_contract": "exclusive-precedence-v1",
        "protected_state_digest_before": sha256_text("local-protected"),
        "protected_state_digest_after": sha256_text("local-protected"),
        "transaction_read_only": True,
        "transaction_id_assigned": False,
        "export_file_sha256": sha256_file(source),
    }
    manifest_path = output_dir / "source-export.manifest.private.json"
    write_private_json(manifest_path, manifest)
    return {
        "records": count,
        "source": str(source),
        "manifest": str(manifest_path),
        "content_digest": content_digest,
    }


def generate_multiscope_fixture(output_dir: Path, count: int = 400) -> dict[str, object]:
    """Build a generic, deliberately unbalanced multi-scope Acquisition export."""

    if count != 400:
        raise ValueError("benchmark_multiscope_fixture_count_fixed")
    output_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(output_dir, 0o700)
    partitions = {
        "primary": {
            "scope": "primary_brand",
            "entity_ref": sha256_text("fixture-primary"),
            "market": "MX",
            "range": range(0, 100),
            "excluded": 10,
        },
        "category": {
            "scope": "category",
            "entity_ref": sha256_text("fixture-category"),
            "market": "MX",
            "range": range(70, 150),
            "excluded": 8,
        },
        "competitor_a": {
            "scope": "competitor",
            "entity_ref": sha256_text("fixture-competitor-a"),
            "market": "US",
            "range": range(130, 200),
            "excluded": 7,
        },
        "competitor_b": {
            "scope": "competitor",
            "entity_ref": sha256_text("fixture-competitor-b"),
            "market": "US",
            "range": range(140, 400),
            "excluded": 25,
        },
    }
    base = datetime(2026, 1, 1, tzinfo=UTC)
    rows: list[dict[str, object]] = []
    for index in range(count):
        language = "es" if index % 3 else "en"
        country = "MX" if language == "es" else "US"
        body = (
            "no funciona bien pero conserva la negación y el contexto"
            if language == "es"
            else "does not work well but preserves negation and context"
        )
        if index % 19 == 0:
            body = "the and of to la el de que"  # representation hard-gate fixture
        text = normalize_text(f"{body} caso sintético {index}")
        published = base + timedelta(hours=index * 18)
        memberships: list[dict[str, object]] = []
        for key, partition in partitions.items():
            if index not in partition["range"]:  # type: ignore[operator]
                continue
            memberships.append(
                {
                    "partition_key": key,
                    "scope": partition["scope"],
                    "entity_ref": partition["entity_ref"],
                    "declared_market": partition["market"],
                    "plan_version": 1,
                    "plan_digest": sha256_text("fixture-plan"),
                    "slot_key": f"slot-{key}",
                    "slot_digest": sha256_text(f"fixture-slot:{key}"),
                    "provenance_digest": sha256_text(f"fixture-provenance:{key}:{index}"),
                    "authority_digest": sha256_text(f"fixture-authority:{key}"),
                    "authority_valid_until": None,
                }
            )
        if not memberships:
            raise ValueError("benchmark_multiscope_fixture_root_unassigned")
        rows.append(
            {
                "contract_version": "signal-semantic-benchmark-record-v2",
                "record_key": sha256_text(f"fixture-record:{index}"),
                "canonical_family_key": sha256_text(f"fixture-family:{index}"),
                "canonical_alias_count": 1 if index % 23 == 0 else 0,
                "content_hash": sha256_text(text),
                "text": text,
                "published_at": published.isoformat(),
                "month": published.strftime("%Y-%m"),
                "language": language,
                "country": country,
                "platform": ["x", "forum", "news", "youtube"][index % 4],
                "partition_memberships": memberships,
                "quality_disposition": "included",
                "authority_usage": "strategic-analysis",
                "authority_digest": sha256_text(f"fixture-root-authority:{index}"),
            }
        )
    source = output_dir / "source-export-v2.private.jsonl"
    source.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n")
    os.chmod(source, 0o600)
    typed = [BenchmarkRecordV2.model_validate(row) for row in rows]
    partition_manifest = {}
    for key, partition in partitions.items():
        included = len(partition["range"])  # type: ignore[arg-type]
        excluded = int(partition["excluded"])
        partition_manifest[key] = {
            "scope": partition["scope"],
            "entity_ref": partition["entity_ref"],
            "declared_market": partition["market"],
            "total": included + excluded,
            "included": included,
            "excluded": excluded,
            "population_digest": sha256_text(f"fixture-population:{key}"),
            "modeling_digest": sha256_text(f"fixture-modeling:{key}"),
            "plan_version": 1,
            "plan_digest": sha256_text("fixture-plan"),
            "slot_digest": sha256_text(f"fixture-slot:{key}"),
        }
    languages = {key: sum(row["language"] == key for row in rows) for key in ("en", "es")}
    countries = {key: sum(row["country"] == key for row in rows) for key in ("MX", "US")}
    platforms = {
        key: sum(row["platform"] == key for row in rows)
        for key in ("forum", "news", "x", "youtube")
    }
    manifest = {
        "contract_version": "signal-semantic-benchmark-export-v2",
        "target": "local-fixture",
        "read_only": True,
        "writes_performed": False,
        "provider_calls": 0,
        "jobs_enqueued": 0,
        "serving_writes": 0,
        "workspace_ref": sha256_text("fixture-workspace"),
        "corpus_identity": "generic-multiscope-fixture-v1",
        "export_timestamp": datetime(2026, 8, 20, tzinfo=UTC).isoformat(),
        "period_start": rows[0]["published_at"][:10],
        "period_end": rows[-1]["published_at"][:10],
        "timezone": "UTC",
        "population_digest": sha256_text("fixture-population"),
        "content_digest": sha256_text("fixture-content-authority"),
        "provenance_digest": sha256_text("fixture-provenance-authority"),
        "watermark_digest": sha256_text("fixture-watermark"),
        "authority_digest": sha256_text("fixture-authority"),
        "exporter_source_digest": sha256_text("fixture-exporter-source"),
        "export_records_digest": export_records_digest_v2(typed),
        "schema_version": "signal-semantic-benchmark-record-v2",
        "acquisition_denominator": count + 40,
        "modeling_population": count,
        "quality_excluded_roots": 40,
        "exported": count,
        "excluded_by_reason": {"quality_excluded": 40},
        "partitions": partition_manifest,
        "language_counts": languages,
        "country_counts": countries,
        "platform_counts": platforms,
        "declared_market_membership_counts": {
            "MX": len(partitions["primary"]["range"]) + len(partitions["category"]["range"]),
            "US": len(partitions["competitor_a"]["range"])
            + len(partitions["competitor_b"]["range"]),
        },
        "shared_root_count": sum(len(row["partition_memberships"]) > 1 for row in rows),
        "required_usage": "strategic-analysis",
        "licensing_evaluation": "allowed",
        "retention_evaluation": "current",
        "quality_evaluation": "current",
        "exclusion_contract": "acquisition-quality-exclusive-v2",
        "protected_state_digest_before": sha256_text("fixture-protected"),
        "protected_state_digest_after": sha256_text("fixture-protected"),
        "transaction_read_only": True,
        "transaction_id_assigned": False,
        "export_file_sha256": sha256_file(source),
    }
    manifest_path = output_dir / "source-export-v2.manifest.private.json"
    write_private_json(manifest_path, manifest)
    return {
        "records": count,
        "denominator": count + 40,
        "partition_memberships": sum(len(row["partition_memberships"]) for row in rows),
        "shared_roots": manifest["shared_root_count"],
        "source": str(source),
        "manifest": str(manifest_path),
        "export_records_digest": manifest["export_records_digest"],
    }
