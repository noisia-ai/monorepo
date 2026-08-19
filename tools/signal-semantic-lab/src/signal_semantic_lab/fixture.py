from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .canonical import sha256_file, sha256_text, write_private_json
from .preprocess import normalize_text


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
