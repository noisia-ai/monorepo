# 05 — Pipeline propio y contrato de output

## Principio

Signal Pulse tiene pipeline propio. No transforma T&B, no depende de outputs estratégicos y no muestra metodología al usuario final.

Reutiliza infraestructura común: conectores, corpus, evidence store, canonical signals, observations, embeddings, SQL aggregates, quality gates, composer y publicación.

## Pipeline conceptual

```text
Source Wizard
  ↓
Source normalization
  ↓
Evidence store + provenance
  ↓
Period aggregation
  ↓
Signal detection / canonicalization
  ↓
Signal metrics by period
  ↓
Chart data refs
  ↓
Evidence retrieval
  ↓
Claude tactical interpretation
  ↓
Marketing moves generation
  ↓
Quality gates
  ↓
Live Composer
  ↓
Published Signal Pulse
```

## Responsabilidades

| Capa | Responsabilidad |
|---|---|
| Source Wizard | Recibir, clasificar, mapear y validar fuentes |
| Normalization | Convertir registros a tipos comunes |
| SQL/Aggregates | Calcular números, deltas, rankings, coverage y chart data |
| Embeddings/Retrieval | Recuperar evidencia relevante |
| Signal engine | Agrupar observaciones en señales canónicas |
| Claude | Interpretar, redactar y proponer marketing moves |
| Quality gates | Bloquear overclaiming, falta de evidencia, números inventados |
| Composer | Curar, fusionar, promover, ocultar, publicar |
| Renderer | Mostrar charts y pantallas conectadas a data_refs |

## Qué recibe Claude

Claude debe recibir un paquete controlado:

- periodo activo;
- ventana comparable;
- aggregated metrics;
- deltas calculados;
- signal lifecycle;
- source coverage;
- evidence pack;
- performance overlay cuando exista;
- competitive/category summary cuando exista;
- business/marketing context;
- restricciones de copy;
- output schema esperado.

Claude no recibe raw corpus completo ni debe contar manualmente.

## Qué devuelve Claude

Debe devolver estructura táctica:

- executive read;
- signal interpretation;
- marketing implication;
- recommended moves;
- content/creative opportunities;
- risk/no-go notes;
- limitations;
- confidence rationale;
- evidence refs usadas;
- copy corto para cards.

## Contrato conceptual de output

```json
{
  "schema_version": "signal_pulse_v1",
  "report_meta": {
    "brand_id": "uuid",
    "period_start": "YYYY-MM-DD",
    "period_end": "YYYY-MM-DD",
    "window_months": 12,
    "mode": "live|published|compare",
    "source_mix_ref": "data_ref",
    "confidence": "media_alta"
  },
  "executive_read": {
    "headline": "...",
    "what_changed": [],
    "marketing_implication": "...",
    "recommended_focus": "..."
  },
  "signals": [
    {
      "signal_id": "uuid",
      "canonical_signal_ref": "uuid",
      "title": "...",
      "status": "emerging|mature|peaking|decaying|reactivated",
      "priority": "high|medium|low",
      "marketing_relevance": "high|medium|low",
      "interpretation": "...",
      "metrics_ref": "data_ref",
      "charts": ["chart_ref"],
      "evidence_refs": ["evidence_ref"],
      "recommended_moves": ["move_ref"],
      "limitations": []
    }
  ],
  "marketing_moves": [],
  "chart_specs": [],
  "evidence_refs": [],
  "quality": {
    "status": "pass|warning|blocked",
    "gates": []
  }
}
```

## Chart specs

Cada chart debe guardar definición, no datos duplicados:

```json
{
  "chart_id": "impact_polarity_overview",
  "chart_type": "scatter",
  "title": "Impact × Polarity",
  "data_ref": "signal_pulse.period.2026-05.impact_polarity",
  "filters": ["period", "source_type", "emotion", "confidence"],
  "last_calculated_at": "timestamp",
  "source_coverage_ref": "data_ref"
}
```

## Reglas duras

1. Claude nunca inventa cifras.
2. No hay marketing move sin evidence refs.
3. No hay delta sin periodos comparables.
4. No hay chart crítico sin `data_ref`.
5. No hay señal publicada sin confidence.
6. No hay performance claim sin performance evidence.
7. No hay claim de categoría sin competitive/category data suficiente.
8. No hay copy largo en cards.
9. No hay publicación sin Composer review.
10. No hay adaptación de T&B como fuente primaria.

## Quality gates mínimos

- traceability complete;
- no invented numbers;
- evidence minimum;
- comparable periods;
- source coverage;
- actionability;
- role visibility;
- humanized copy;
- no methodology leakage;
- live/published integrity.
