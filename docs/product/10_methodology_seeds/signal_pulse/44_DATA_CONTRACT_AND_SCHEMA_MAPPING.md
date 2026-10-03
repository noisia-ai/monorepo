# 44 — Data contract y mapeo al schema real

> Escrito contra el schema real de la rama `codex/live-intelligence-store` (migraciones 0025-0033 verificadas). Este doc convierte los conceptos del paquete en tablas, columnas y endpoints concretos. Si un nombre de aquí contradice al paquete, gana este doc.

## 1. Mapa de reutilización (verificado contra el repo)

| Concepto del paquete | Ya existe | Acción |
|---|---|---|
| Canonical signals | `canonical_signals` (0026): org/brand/theme/corpus refs, methodology_slug, signal_type, canonical_title, semantic_key, dimensions, status, first/last_seen | **Reusar.** SP escribe con `methodology_slug='signal-pulse'`. Dedup SIEMPRE filtrado por ese slug |
| Signal observations | `signal_observations` (0026): canonical_signal_id, study_corpus_id, snapshot_id, engine_analysis_id, window_start/end, frequency, share, intensity, sentiment, composite, confidence, delta, metrics jsonb | **Reusar.** Una observation por señal×periodo. `window_start/end` = bordes del period bucket |
| Evidence pack | `signal_observation_evidence` (0026): observation_id, mention_id, source_id, quote, evidence_role, is_protagonist, position | **Reusar.** Agregar valor `counter` a `evidence_role` para counter evidence |
| Provenance | `mention_query_sources`, `import_batches`, `query_packs` (0026/0027/0032) | **Reusar tal cual** |
| Mention↔run map (drill-down corpus) | `engine_run_mention_map` (0033) | **Reusar** — gratis si el run SP es un `engine_analyses` |
| Run del pipeline + estado + steps | `engine_analyses` + pipeline steps + cola BullMQ + locks | **Reusar** con `methodology_slug='signal-pulse'` (seed nuevo, status beta) y steps propios |
| Cost ledger | `engine_cost_events` (0029) | **Reusar tal cual** (provider/model/tokens/estimated_cost_usd) |
| Reporte publicable + visibilidad | `published_outputs` (status, archived_at, manifest) | **Reusar** + columna nueva `kind` ('signal' default, 'signal_pulse') |
| Composer editorial | `signal_composer_edits` (0030, keyed por output_id, selection+draft jsonb) | **Reusar tal cual** — ya soporta selección/orden/copy/visibilidad |
| Corpus explorer / facets | `/api/signal/[outputId]/corpus` + SignalCorpusExplorer | **Reusar** para Corpus View |
| Ingest CSV conversacional | mentions-csv-ingest + provenance + fan-out | **Reusar** como primer "connector" del Source Wizard |

## 2. Tablas NUEVAS (migración 0034+)

### 2.1 `report_periods` — los buckets mensuales (NO existen hoy; verificado)
```sql
CREATE TABLE report_periods (
  id uuid PK DEFAULT gen_random_uuid(),
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id),
  granularity text NOT NULL DEFAULT 'month',      -- 'month' | 'week' (crisis mode, fase 2)
  period_start date NOT NULL,
  period_end date NOT NULL,
  label text NOT NULL,                            -- '2026-05', 'Mayo 2026'
  coverage jsonb NOT NULL DEFAULT '{}',           -- {conversation: n, performance: n, entities: n, by_source: {...}}
  comparable boolean NOT NULL DEFAULT true,
  comparability_reasons jsonb DEFAULT '[]',       -- ['nueva fuente TikTok desde día 12', ...]
  confidence text,                                -- alta|media|baja
  known_gaps jsonb DEFAULT '[]',
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_corpus_id, granularity, period_start)
);
```

### 2.2 `signal_period_metrics` — métricas por señal×periodo (corazón de Momentum/lifecycle)
```sql
CREATE TABLE signal_period_metrics (
  id uuid PK,
  canonical_signal_id uuid NOT NULL REFERENCES canonical_signals(id),
  period_id uuid NOT NULL REFERENCES report_periods(id),
  study_corpus_id uuid NOT NULL,
  volume int NOT NULL DEFAULT 0,
  engagement numeric,
  impact_v1 numeric,                              -- fórmula doc 43 G4, versionada en el nombre
  sentiment_score numeric,                        -- -1..1 normalizado
  polarity_bucket text,                           -- positiva|negativa|ambivalente|neutral
  dominant_emotion text,
  emotion_distribution jsonb DEFAULT '{}',
  source_mix jsonb DEFAULT '{}',                  -- {tiktok: 0.62, reviews: 0.2, ...}
  evidence_count int DEFAULT 0,
  confidence text,
  delta_prev numeric,                             -- NULL si periodo previo no comparable (gate)
  delta_window_avg numeric,
  rank int,
  lifecycle_state text,                           -- new|emerging|accelerating|mature|saturated|peaking|declining|dormant|reactivated|volatile
  computed_at timestamptz DEFAULT now(),
  UNIQUE (canonical_signal_id, period_id)
);
```

### 2.3 `marketing_moves`
```sql
CREATE TABLE marketing_moves (
  id uuid PK,
  study_corpus_id uuid NOT NULL,
  engine_analysis_id uuid REFERENCES engine_analyses(id),   -- el run SP que lo generó
  period_id uuid REFERENCES report_periods(id),
  move_type text NOT NULL,        -- amplify|test_claim|create_content|adjust_paid|brief_creators|avoid_territory|defend_budget|activate_trend|reframe_audience|contain_risk|monitor (taxonomía doc 02)
  action_text text NOT NULL,      -- 1 acción + 1 razón (humanizer)
  signal_refs uuid[] NOT NULL,    -- canonical_signals
  evidence_refs jsonb DEFAULT '[]',
  owner_suggestion text,
  timing text,                    -- this_week|this_month|next_cycle
  measurement_suggestion text,
  no_go_notes text,
  confidence text,
  status text NOT NULL DEFAULT 'candidate',  -- candidate|approved|hidden|published
  position int,
  created_at/updated_at timestamptz
);
```

### 2.4 `chart_aggregates` — el `data_ref` del paquete, materializado
```sql
CREATE TABLE chart_aggregates (
  id uuid PK,
  study_corpus_id uuid NOT NULL,
  chart_key text NOT NULL,            -- 'impact_polarity', 'momentum_stream', 'galaxy_layout', 'coverage_strip', ...
  period_id uuid REFERENCES report_periods(id),   -- NULL = toda la ventana
  filters_hash text NOT NULL DEFAULT 'default',
  payload jsonb NOT NULL,             -- agregado PEQUEÑO listo para render (no raw data)
  algo_version text,                  -- 'galaxy_v1', 'impact_v1'
  computed_at timestamptz,
  stale_after timestamptz,
  UNIQUE (study_corpus_id, chart_key, period_id, filters_hash)
);
```
`data_ref` = `chart_aggregates.id`. El layout de la galaxia (posiciones 2D precomputadas, top 80-120 nodos, ancladas entre periodos) vive aquí con `chart_key='galaxy_layout'`.

### 2.5 Columnas nuevas en tablas existentes
```sql
ALTER TABLE published_outputs ADD COLUMN kind text NOT NULL DEFAULT 'signal';      -- 'signal_pulse'
ALTER TABLE published_outputs ADD COLUMN visibility_config jsonb DEFAULT '{}';     -- {paid_data: false, competitive: true, corpus_view: 'limited'} (M1 doc 43)
```

### 2.6 `performance_records` — performance como ciudadano de primera clase (REQUISITO DURO, Cut 1)

> Directiva del negocio: un archivo de performance de 12 meses de Social Media (Meta/TikTok export) debe integrarse **estructurado y coherente** al corpus. PROHIBIDO convertirlo en "texto de contexto" para Claude. Nunca entra a `mentions`.

```sql
CREATE TABLE performance_records (
  id uuid PK DEFAULT gen_random_uuid(),
  study_corpus_id uuid NOT NULL REFERENCES study_corpora(id),
  data_source_id uuid REFERENCES data_sources(id),     -- provenance (§2.7)
  import_batch_id uuid,                                -- provenance de upload
  external_id text NOT NULL,                           -- id de campaña/ad/post
  entity_kind text NOT NULL,                           -- campaign|adset|ad|post|creative|account
  entity_name text,
  parent_external_id text,                             -- ad→adset→campaign
  platform text NOT NULL,                              -- meta|tiktok|youtube|ga4|metricool
  channel text NOT NULL DEFAULT 'paid',                -- paid|organic|earned
  objective text,
  record_date date NOT NULL,
  granularity text NOT NULL DEFAULT 'day',             -- day|week|month (según el export)
  spend numeric, impressions bigint, reach bigint, clicks bigint,
  video_views bigint, engagement bigint, conversions numeric,
  ctr numeric, cpm numeric, cpc numeric,
  creative_text text,                                  -- copy/caption → embeddings → link semántico a señales
  creative_asset_ref text,
  metrics jsonb NOT NULL DEFAULT '{}',                 -- columnas no mapeadas, sin pérdida
  raw_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_corpus_id, platform, external_id, record_date, granularity)
);
CREATE INDEX ON performance_records (study_corpus_id, record_date);
CREATE INDEX ON performance_records (study_corpus_id, entity_kind, channel);
```

**Flujo de ingest de un export de 12 meses (50k-200k filas):** Source Wizard clasifica `performance` → mapping de columnas (doc 05 §Performance mapping) → validación (fecha + campaña/asset + ≥1 métrica, no todo ceros) → bulk insert con dedupe por la unique key → provenance vía `data_sources`/import batch → los 12 meses se periodizan SOLOS porque cada fila trae `record_date` → `report_periods.coverage.performance` se llena en `sp_periods`.

**Cómo se cruza con conversación (3 niveles, en orden de certeza):**
1. **Por periodo (Cut 1, garantizado):** alineación temporal pura — "Conversation vs Spend" dual-axis, coverage strip, deltas mensuales. Cero mapping necesario.
2. **Por entidad (Cut 1 si el corpus tiene campaign refs):** join contra `corpus_entities`/campaign names.
3. **Semántico campaña↔señal (Cut 1 best-effort + confirmación humana):** embeddings de `creative_text` vs señales → sugerencias con score → el Composer confirma/rechaza. Auto-mapping sin humano = Cut 2.

**Regla Claude:** `sp_interpret` recibe SOLO agregados SQL de performance (spend/engagement por periodo/territorio, con refs). Claude lee números calculados y los interpreta; jamás procesa el archivo.

### 2.7 `data_sources` + `source_sync_runs` — registro de fuentes (alineado con Issue #1)
```sql
CREATE TABLE data_sources (
  id uuid PK,
  study_corpus_id uuid REFERENCES study_corpora(id),   -- NULL = nivel marca/org
  organization_id uuid, brand_id uuid,
  source_type text NOT NULL,        -- conversation|performance|entity|knowledge
  provider text NOT NULL,           -- sentione|apify|meta|tiktok|manual_csv|...
  connection_method text NOT NULL,  -- file_upload|api_key|oauth|scheduled|manual
  name text NOT NULL,
  mapping jsonb DEFAULT '{}',       -- column mapping versionado
  mapping_version int DEFAULT 1,
  role jsonb DEFAULT '{}',          -- {feeds_signals, feeds_charts, feeds_filters, internal_only}
  status text NOT NULL DEFAULT 'draft',  -- draft|validating|active|stale|broken|paused|internal_only|archived
  visibility text DEFAULT 'internal',
  created/updated timestamptz
);
CREATE TABLE source_sync_runs (
  id uuid PK, data_source_id uuid NOT NULL REFERENCES data_sources(id),
  started/finished timestamptz, status text,
  records_total int, records_valid int, records_duplicate int, records_failed int,
  coverage_start date, coverage_end date, error_summary jsonb, created_at timestamptz
);
```
Esto materializa el "source health" del doc 05 y la arquitectura del Issue #1 (connectors → sync runs → normalización). El ingest CSV existente se registra retroactivamente como `data_source` provider='sentione', method='file_upload'.

## 3. Pipeline SP — steps concretos (misma cola/orquestador que el engine)

Run = `engine_analyses` con `methodology_slug='signal-pulse'`. Steps (job names nuevos en la cola existente):

| # | Step | Hace | Quién |
|---|---|---|---|
| 1 | `sp_readiness` | valida fuentes, ventana, cobertura por mes; escribe readiness report en meta_json | SQL |
| 2 | `sp_periods` | upsert `report_periods` para la ventana; calcula coverage y comparabilidad; **ANALYZE post-materialización** | SQL |
| 3 | `sp_cluster` | embeddings de menciones de la ventana (reusar `lib/rag/semantic`) → clustering por similitud en worker → candidatos (término/frase ancla, miembros, métricas crudas). Stopwords es-MX. **Sin Claude** | Worker |
| 4 | `sp_name_signals` | Claude nombra clusters, asigna emoción/polaridad/relevancia marketing/tipo por cluster desde muestra de evidencia (batches resilientes, cost ledger, budget cap). Upsert `canonical_signals` (slug 'signal-pulse') + dedup semántico | Claude |
| 5 | `sp_metrics` | `signal_period_metrics` por señal×periodo + lifecycle states + observations + evidence sampling (protagonist/support/counter) | SQL |
| 6 | `sp_interpret` | Claude: executive read, lectura por señal, marketing moves (taxonomía cerrada), limitations. Input = SOLO métricas calculadas. Output estructurado, números solo por ref (M5) | Claude |
| 7 | `sp_charts` | materializa `chart_aggregates`: impact_polarity, momentum_stream, coverage_strip, galaxy_layout | Worker |
| 8 | `sp_gates` | gates del doc 31 + `cost_within_budget` + no_invented_numbers linter → `needs_review` | SQL |

Presupuesto objetivo por corrida (12 meses, corpus ~13k): **< $5** (cluster-first; ver doc 43 G2). El cap se pasa como param del run y se muestra ANTES de correr (lección Issue #2).

## 4. APIs (contratos mínimos para las 3 pantallas críticas)

Patrón: `/api/pulse/[outputId]/...`, mismas convenciones de auth/no-store que `/api/signal/[outputId]/*`.

### `GET /api/pulse/[outputId]/overview?period=&compare=`
```jsonc
{
  "periods": [{ "id", "label", "comparable", "coverage", "confidence" }],
  "active_period": "...",
  "executive_read": { "headline", "reading", "limitations": [] },   // del corte si published, live si draft
  "kpis": { "signals_active": n, "new_this_period": n, "risks": n, "confidence": "media" },
  "charts": { "galaxy": "data_ref", "impact_polarity": "data_ref", "momentum": "data_ref", "coverage": "data_ref" },
  "top_signals": [ /* SignalCard compactas: title, lifecycle, impact, delta, emotion, confidence, evidence_count */ ],
  "top_moves": [ /* move cards aprobadas/candidatas según modo */ ],
  "mode": "live|published|compare", "warnings": []
}
```

### `GET /api/pulse/[outputId]/signals?lifecycle=&period=&...`
Lista de señales con `signal_period_metrics` embebidos por periodo (sparkline), lifecycle, evidence pack ref. Drawer: `GET /api/pulse/[outputId]/signals/[signalId]` → métricas por periodo + evidencia (protagonist/support/counter) + moves relacionados + provenance.

### `GET/POST /api/pulse/[outputId]/moves`
GET: board por move_type/status. POST (interno): aprobar/ocultar/editar — escribe en `marketing_moves.status` + `signal_composer_edits`.

### Charts
`GET /api/pulse/[outputId]/chart/[dataRef]` → payload del aggregate + computed_at + stale. El front nunca calcula agregados.

### Composer/publish
Reusar `POST /api/signal/[outputId]/composer` (ya soporta selection/draft) extendiendo el draft shape con `promoted_signals`, `approved_moves`, `period_id`. Publish pasa por `validateEnginePublishReadiness` + gates SP.

## 5. Decisiones cerradas que Codex NO debe reabrir

1. Señales SP viven en `canonical_signals` con `methodology_slug='signal-pulse'`; dedup nunca cruza slugs.
2. Run SP = `engine_analyses` (cola, ledger, locks, run_mention_map heredados).
3. Detección = cluster-first (G2). Per-mention coding prohibido como default.
4. Emoción v1 = nivel señal (G3).
5. `impact_v1` con la fórmula del doc 43 G4, versionada.
6. Galaxy layout precomputado en worker, persistido en `chart_aggregates`, posiciones ancladas entre periodos.
7. SP es `published_outputs.kind='signal_pulse'`, ruta `/pulse/[outputId]`, shell y auth del Signal actual.
8. Todo número visible viene de `signal_period_metrics` o `chart_aggregates`. Claude jamás emite cifras nuevas (linter M5 como test).
