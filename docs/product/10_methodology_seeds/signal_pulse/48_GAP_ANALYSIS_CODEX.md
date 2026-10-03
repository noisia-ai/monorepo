# 48 - Gap analysis Codex contra rama real

> Fecha: 2026-06-12. Rama base verificada: `codex/live-intelligence-store`; rama de trabajo: `codex/signal-pulse`.
> Alcance: no implementa Signal Pulse. Solo confirma el contrato de `44_DATA_CONTRACT_AND_SCHEMA_MAPPING.md` contra el codigo real y baja PR-1 a tareas ejecutables.

## 1. Verificacion del mapa de reutilizacion de doc 44 section 1

| Concepto doc 44 | Estado contra codigo real | Confirmacion / correccion |
|---|---|---|
| Canonical signals | Confirmado. `infrastructure/db/migrations/0026_live_intelligence_store.sql` y `infrastructure/db/schema/index.ts` tienen `canonical_signals` con org/brand/theme/corpus, `methodology_slug`, `signal_type`, `canonical_title`, `semantic_key`, `dimensions`, status y first/last seen. | Reusar. SP debe escribir solo con `methodology_slug='signal-pulse'`; el unique index ya incluye slug, asi que dedup no cruza lentes si las queries filtran el slug. |
| Signal observations | Confirmado con matiz. Existe `signal_observations` con `engine_analysis_id`, `published_output_id`, `window_start/end`, frequency/share/intensity/sentiment/composite/confidence/delta/metrics. | Reusar, pero PR-1 debe cuidar el unique existente `uq_signal_observation_signal_engine_analysis`: no permite multiples observations para la misma senal dentro del mismo run. Para "una observation por senal x periodo", SP necesitara usar `signal_period_metrics` como source-of-truth periodico y escribir observations solo si el periodo queda codificado via `metrics.period_id` o ajustar la constraint en 0034. |
| Evidence pack | Confirmado. `signal_observation_evidence` existe con `signal_observation_id`, `mention_id`, `source_id`, quote, `evidence_role`, protagonist, position y metadata. | Reusar. No requiere schema para agregar `counter`; basta tratar `evidence_role='counter'` como valor soportado en workers/APIs/tests. |
| Provenance | Confirmado. `query_packs`, `mention_query_sources`, `import_batches` existen y el ingest CSV liga menciones a packs via `attachMentionQueryProvenance`. | Reusar. Para SP hay que crear template `signal-pulse` y asegurar que fan-out por scope no contamine slugs pausados. |
| Mention/run map | Confirmado. `engine_run_mention_map` existe en 0033 y `engine-step-retrieve.ts` lo materializa. | Reusar si SP corre como `engine_analyses`; `sp_cluster` debe leer de run map o de la misma scope set materializada. |
| Run pipeline + estado + steps | Confirmado. `engine_analyses`, `engine_pipeline_steps`, BullMQ y locks existen. | Reusar la cola, pero el orquestador actual esta hardcodeado a `preflight -> retrieve -> code -> score -> synthesize -> quality_gates`. PR-1 debe extender dispatch/step ordering para SP sin activar coding por mencion. |
| Cost ledger | Confirmado. `engine_cost_events` existe y `engine-shared`/`engine-step-code.ts` registran provider/model/tokens/costo. | Reusar. Falta estimacion visible pre-run y budget cap especifico de SP antes de encolar; no existe aun como contrato API. |
| Reporte publicable + visibilidad | Confirmado parcial. `published_outputs` existe con status, manifest, payload, archived_at y `engine_analysis_id`. | Reusar agregando en 0034 `kind` y `visibility_config`. Tambien revisar APIs que hoy identifican Signal por ruta `/signal` y no por `kind`. |
| Composer editorial | Confirmado. `signal_composer_edits` existe keyed por `output_id`, con selection/draft/notes/status. | Reusar. El shape actual esta orientado a modules/lenses/oportunidades/riesgos; SP debe extenderlo con `promoted_signals`, `approved_moves`, `period_id` y no depender de labels de T&B. |
| Corpus explorer / facets | Confirmado. Existe `/api/signal/[outputId]/corpus` + `SignalCorpusExplorer`. | Reusar con una ruta wrapper o fork `/api/pulse/[outputId]/corpus`; hoy los facets mezclan `tb_findings` y `canonical_signals`, y los labels dicen finding/lens. Para SP debe filtrar `cs.methodology_slug='signal-pulse'` por defecto. |
| Ingest CSV conversacional | Confirmado. `/api/corpora/[id]/mentions/csv-upload` + `mentions-csv-ingest.ts` soportan CSV grande streaming, import batches, query packs y provenance. | Reusar como base de Source Wizard Cut 1 para conversation. Performance CSV no debe entrar por este camino: requiere `performance_records` y mapping propio. |

## 2. APIs y componentes existentes a adaptar para `/pulse/[outputId]`

- Shell: `apps/studio/src/components/signal/SignalReportShell.tsx` ya soporta grupos de navegacion, filtro global de fechas e idioma. Adaptacion: grupos nuevos del doc 03, labels SP y ruta `/pulse/[outputId]`.
- Pagina base: `apps/studio/src/app/signal/[outputId]/page.tsx` sirve como referencia visual, pero no debe convertirse en adapter T&B. Crear pagina `/pulse/[outputId]/page.tsx` que reutilice shell, auth, topbar, guards y patrones de secciones; evitar `adaptTbSignalPayload`.
- Overview: `/api/signal/[outputId]/overview` confirma patron auth/no-store y agregados SQL, pero es T&B/finding-first. Crear `/api/pulse/[outputId]/overview` leyendo `report_periods`, `signal_period_metrics`, `marketing_moves` y `chart_aggregates`.
- History/monthly: `/api/signal/[outputId]/history` y `/api/signal/[outputId]/monthly-analysis` prueban monthly/live patterns. SP debe reemplazar monthly backfill ad hoc por `sp_periods` + `signal_period_metrics`.
- Composer: `/api/signal/[outputId]/composer` y `SignalLiveComposer` aportan storage y UX editorial. Adaptacion: helper compartido para edits; nuevo payload SP con moves aprobados, periodo activo, senales promovidas y gates SP. No arrastrar `selected_lenses` como unidad principal.
- Corpus: `SignalCorpusExplorer` y `/api/signal/[outputId]/corpus` se reutilizan con copy/facets SP. Debe filtrar por senal SP y soportar evidence roles `protagonist/support/counter`.
- Source Wizard/corpus engine: `NewStudyForm`, `EngineWizard`, `query-packs/materialize`, CSV upload y `LENS_QUERY_PACK_TEMPLATES` son la base para brief SP + query pack `signal-pulse`. La parte de performance requiere una ruta/worker nuevo, no `mentions-csv-ingest`.
- Workers/runtime: `engine-orchestrator.ts`, `engine-shared`, `engine-step-retrieve.ts`, `engine-step-code.ts` y `semantic-embeddings.ts` son reutilizables. PR-1 debe agregar steps SP en la misma cola con dispatch propio y sin pasar por `engine_step_code`.
- Publish guards: `validateEnginePublishReadiness` es referencia para patron, pero SP necesita gates propios (`cost_within_budget`, `no_invented_numbers`, `chart_data_available`, `period_coverage`) antes de publicar `/pulse`.

## 3. Plan detallado PR-1 - Data foundation

1. Migracion `0034_signal_pulse_foundation.sql`
   - Crear `report_periods`, `signal_period_metrics`, `marketing_moves`, `chart_aggregates`, `performance_records`, `data_sources`, `source_sync_runs`.
   - Agregar `published_outputs.kind text NOT NULL DEFAULT 'signal'` y `visibility_config jsonb DEFAULT '{}'`.
   - Indices: periodo por corpus/granularity/start; metrics por signal/period; performance por corpus/date y corpus/entity/channel; chart aggregate unique por corpus/chart/period/filter.
   - Resolver explicitamente la tension de `signal_observations` con signal x periodo x run: o ajustar unique parcial para incluir `window_start/window_end`, o documentar que PR-1 solo escribe `signal_period_metrics` y deja observations para PR-2/PR-3.
   - Actualizar `infrastructure/db/schema/index.ts` y tests de migraciones/journal.

2. Seed `signal-pulse`
   - Agregar manifest YAML en `docs/product/10_methodology_seeds/` o seed equivalente consumido por `infrastructure/db/seeds/methodologies.ts`.
   - Status inicial `beta`; no sumar los 16 lentes pausados a UI nueva.
   - Tests de seed: el slug existe, es beta y no se vuelve runnable como lente multimethod por accidente.

3. Brief SP en wizard
   - Extender `analysis_plan` para `{ report_kind: 'signal_pulse', marketing_brief: {...}, budget_cap_usd }`.
   - Campos Cut 1: marca/competidores, ventana 3/6/12, objetivos marketing, campanas/territorios activos, claims permitidos/prohibidos/legal, audiencias prioritarias, budget cap.
   - Ajustar `NewStudyForm` sin romper el flujo T&B existente; SP debe poder crear corpus con primary methodology `signal-pulse`.

4. Query pack template `signal-pulse`
   - Agregar entrada en `packages/query-engine/src/lens-query-packs.ts` con scopes `brand`, `competitors`, `category` y phrase hints de marketing/tendencias/creators/comparaciones culturales.
   - Mantener scopes dentro del vocabulario fan-out (`brand|competitors|category`) para pasar el test existente.
   - Tests: cobertura del template, materializacion por los 3 scopes y no regression de T&B/lentes pausados.

5. Runtime steps SP
   - Agregar step names/types: `sp_readiness`, `sp_periods`, `sp_cluster`, `sp_name_signals`, `sp_metrics`.
   - Extender cola BullMQ con job names SP y orquestacion condicional cuando `engine_analyses.methodology_slug='signal-pulse'`.
   - `sp_readiness`: validar fuentes, ventana, cobertura y presupuesto; guardar meta en `engine_analyses.meta_json`.
   - `sp_periods`: upsert de `report_periods`, coverage y comparabilidad; usar `SET LOCAL statement_timeout` en queries pesadas y `ANALYZE` tras materializar.
   - `sp_cluster`: cluster-first usando embeddings existentes (`semantic_embeddings`/`semantic-embeddings.ts` + helpers de `@noisia/query-engine`); sin Claude.
   - `sp_name_signals`: Claude solo nombra/interpreta clusters; batch retry/skip y `engine_cost_events`.
   - `sp_metrics`: calcular `signal_period_metrics`, `impact_v1`, lifecycle y evidence counts desde SQL.
   - Tests unitarios para periodizacion mensual, formula `impact_v1`, lifecycle basico, batch resilience metadata y que SP no invoque coding por mencion.

6. Validacion PR-1
   - `pnpm --filter @noisia/db test`
   - `pnpm --filter @noisia/query-engine test`
   - `pnpm --filter @noisia/workers test`
   - `pnpm --filter @noisia/studio test`
   - Typechecks de query-engine, workers y studio.

## 4. Riesgos adicionales no cubiertos por docs 43-46

- `signal_observations` tiene unique por `(canonical_signal_id, engine_analysis_id)`. Si SP quiere observations por periodo en el mismo run, la migracion debe resolverlo antes de escribir datos reales.
- El orquestador actual asume una sola secuencia engine. Agregar SP en la misma cola sin separar step order puede reactivar `engine_step_code` accidentalmente y romper la regla de costo.
- `ENGINE_METHODOLOGY_SLUGS` es union cerrada en TypeScript y no incluye `signal-pulse`. Hay que decidir si SP entra en un tipo paralelo o se amplia sin mostrarlo como lente pausado.
- El composer route actual tiene supuestos de "provider=anthropic" y "fixture=false" para considerar signals activas. SP necesita readiness propio porque `sp_cluster` es deterministico y `sp_name_signals` no codifica menciones.
- `SignalCorpusExplorer` muestra `finding`, `lens` y `intent`; para SP esto puede confundir usuarios de Marketing si se reutiliza sin copy/facets nuevos.
- Source Wizard de performance puede parecer parte de PR-1 por schema, pero ingestion/mapping operativo esta marcado como PR-1.5 en doc 45. PR-1 debe dejar tablas y contratos listos sin simular ingestion a `mentions`.
- `data_sources` duplica parcialmente `import_batches` y `brand_knowledge_sources`; se necesita una regla de backfill/idempotencia para fuentes conversacionales antiguas antes de mostrar Sources.
- Los tests pedidos por AGENTS incluyen typechecks, pero hoy no hay un comando raiz documentado para "typechecks de los tres paquetes"; PR-1 debe confirmar scripts reales antes de usarlo como gate.
