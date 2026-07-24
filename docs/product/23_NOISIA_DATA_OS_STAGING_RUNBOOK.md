# 23 · Noisia Data OS Staging Runbook

Runbook operativo para arrancar el primer corte productivo de Data OS en una DB
staging/throwaway antes de abrir o mergear PR a produccion.

Este documento no reemplaza la especificacion completa en
`22_NOISIA_DATA_OS_CUT_1.md`; es la checklist corta para ejecutar el shadow run sin
depender del contexto de chat.

## 1. Precondiciones

- Rama base: `codex/noisia-data-os-cut-1-wip`, derivada de `codex/signal-pulse`.
- No correr directo contra produccion sin PR, review y ventana de cambio.
- Usar `scripts/data-os-staging-flight-card.example.sh` como flight card segura:
  copiar sus exports a una terminal local segura, reemplazar placeholders ahi y no
  editar el archivo versionado con valores reales.
- Confirmar visualmente que `DATABASE_URL` apunta a staging o una DB throwaway.
- Exportar `NOISIA_REMOTE_DATABASE_TARGET=staging` o `throwaway`; producción no es
  un valor aceptado por los scripts remotos.
- Exportar `NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true` sólo después de confirmar
  visualmente que `DATABASE_URL` no apunta a producción.
- Tener un corpus Signal Pulse real con output publicado/draft/ready.
- No habilitar live API a clientes antes de `data-os:shadow-run` verde.
- Mantener `published_outputs.payload` como fallback durante todo el rollout.

## 2. Verificacion Local Antes De Staging

```bash
corepack pnpm --filter @noisia/db typecheck
corepack pnpm --filter @noisia/db test
corepack pnpm --filter @noisia/studio typecheck
corepack pnpm --filter @noisia/studio test
corepack pnpm --filter @noisia/studio build
corepack pnpm data-os:verify
```

Smoke local completo:

```bash
corepack pnpm data-os:local-smoke
corepack pnpm data-os:validate-local-smoke
```

Resultado esperado:

- `data-os:verify` reporta `ok: true`.
- `@noisia/studio build` compila `/pulse/[outputId]` y `/api/data-os/*` sin errores
  de Webpack como `node:crypto`.
- `data-os:local-smoke` termina con `Data OS local smoke completed.`
- `data-os:local-smoke` escribe evidencia sintetica en
  `.data/data-os-local-smoke/<timestamp>`: `migrations.log`, `smoke.log`,
  `shadow-run.log`, `analyze.json`, `review-queue.json`, `review-sample.json`,
  `evidence.json`, `serving-smoke.json`, `local-smoke-validation.json` y
  `README.md`.
- En local disposable, `review-queue.json` prueba que hay tags/assertions con
  evidencia listos para revision humana, y que la salida default redacta IDs y
  contexto privado.
- En local disposable, `review-sample.json` prueba que la CLI escribe eventos
  auditables de tag/assertion usando `NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL`.
  Ese auto-select está bloqueado para DBs remotas; staging/preview sigue requiriendo
  selección humana de IDs.
- Ese paquete local sirve para revision tecnica, pero no reemplaza el evidence pack
  de staging/preview requerido por `data-os:release-gate`.
- `data-os:validate-local-smoke` termina con `ready_for_staging_preflight: true`
  y `ready_for_release_gate: false`, dejando explicito que el siguiente gate real es
  staging/preview.
- `data-os:shadow-run` termina con `ready_for_live_api_shadow: true`.
- `data-os:analyze` termina con `ready_for_serving_reads: true` y
  `tables_analyzed >= 30`.
- `data-os:serving-smoke` termina con `ready_for_serving_shadow: true`.
- `data-os:serving-smoke` reporta `brand_os_profiles >= 1`,
  `brand_os_briefs >= 1`, `brand_os_seed_terms >= 1`,
  `brand_os_links >= 3`, `knowledge_sources >= 1`, `knowledge_chunks >= 1`,
  `knowledge_assertions >= 1`,
  `knowledge_assertion_links >= 3` y `knowledge_usage_events >= 3`.
- `data-os:serving-smoke` reporta `catalog_assets >= 10`,
  `catalog_fields >= 50`, `catalog_contracts >= 10`,
  `catalog_quality_results >= 10`, `catalog_assets_without_fields = 0`,
  `catalog_failed_quality = 0` y `lineage_edges >= 9`.
- `data-os:serving-smoke` reporta `fallback_checks.*_disabled_ready = true`, probando
  que los flags apagados responden 503 con fallback a `published_outputs.payload`.
- `data-os:serving-smoke` reporta `live_payload_parity.live_behind_payload = false`,
  probando que las tablas live no están debajo del snapshot publicado en periodos,
  señales ni refs de dashboard.
- `data-os:serving-smoke` reporta `visibility_checks.* = true`, probando que cliente
  default no ve `source_health` ni `dashboard_data_refs` internas, mientras usuario
  interno conserva ambos.
- `data-os:smoke` reporta `data_assets >= 10`, `data_contracts >= 10` y
  `data_quality_results >= 10`.
- `data-os:smoke` reporta `data_asset_fields >= 50`.
- `data-os:smoke` reporta `data_assets_without_fields = 0`.
- `data-os:smoke` reporta tags por `trigger`, `barrier`, `journey_stage`,
  `value_perception`, `audience`, `demographic`, `sentiment_polarity`, `source_type`,
  `content_format` y `record_feature_values`.
- `data-os:smoke` reporta `tagging_rule_sets >= 1` y
  `tagging_model_versions_with_rule_set >= 1`.
- `data-os:smoke` reporta lineage por `data_source`, `import_batch`,
  `brand_knowledge_source`, `data_asset -> data_asset`,
  `data_asset -> dashboard_data_ref` y `dashboard_data_ref -> published_output`.
- No quedan contenedores locales vivos.

## 3. Aplicar Schema En Staging

Solo despues de confirmar el target:

```bash
export NOISIA_REMOTE_DATABASE_TARGET=staging
NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=true \
corepack pnpm db:apply:existing
```

Verificar schema:

```bash
NOISIA_DATA_OS_VERIFY_DB=true \
NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE=true \
corepack pnpm data-os:verify
```

## 4. Elegir Corpus Real

```bash
NOISIA_DATA_OS_CANDIDATES_ALLOW_REMOTE=true \
corepack pnpm data-os:candidates
```

Tomar del candidato recomendado:

```bash
export NOISIA_DATA_OS_BACKFILL_CORPUS_ID=<study_corpus_id>
export NOISIA_DATA_OS_SHADOW_OUTPUT_ID=<published_output_id>
```

`apps/studio/.env.example` incluye estos nombres en blanco para que el operador los
copie a su entorno local/seguro. No pegar los UUIDs reales en PRs, docs ni chat; los
checks sólo deben mostrar `set` y `*_FORMAT=uuid`.

No avanzar si el candidato trae `failures`. Si trae warnings, resolverlos o ejecutar
`NOISIA_DATA_OS_SHADOW_RUN_STRICT=false` solo con aprobacion explicita en PR.

Antes de ejecutar el shadow run, validar que el entorno esté completo sin imprimir
secretos ni IDs:

```bash
corepack pnpm data-os:staging-check
```

Debe terminar con `ready_for_staging_shadow=true`. Si `DATABASE_URL` contiene marcadores
tipo `prod` o `production`, el check imprime
`DATABASE_URL_ENVIRONMENT=production_like_refused` y no permite continuar, sin exponer
el host, usuario, password ni nombre de la base.
También debe imprimir `DATABASE_URL_FORMAT=postgres_url`; si imprime
`DATABASE_URL_FORMAT=placeholder_refused` o `DATABASE_URL_FORMAT=invalid_postgres_url`,
hay que reemplazar la flight card o corregir la URL antes de seguir.
También debe imprimir `LOCAL_DATA_OS_VERIFY=passed`; eso prueba que `data-os:verify`
pasó justo antes del shadow remoto, incluyendo contratos, defaults seguros y linaje
desde `codex/signal-pulse` cuando la ref existe.
También debe reportar `NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid` y
`NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid`; si imprime `invalid_uuid`, corregir el
valor sin pegarlo en el PR o en chat.
Si se va a registrar la muestra humana en el wrapper con
`NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true`, el mismo precheck debe reportar
`NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid` y
`NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid`; las acciones opcionales sólo pueden
ser `approve`, `reject` o `needs_review`. Si falta o falla alguno, corregirlo antes de
crear el evidence pack final.
Para `NOISIA_REMOTE_DATABASE_TARGET=staging` o `preview`, el artifact
`staging-check.txt` debe incluir `DATABASE_URL_ENVIRONMENT=remote_redacted`. Si imprime
`local_redacted`, sirve como prueba local/throwaway, pero `data-os:release-gate` lo
rechaza para produccion.

## 5. Shadow Run Staging

Ruta recomendada:

```bash
export NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true
corepack pnpm data-os:staging-check
corepack pnpm data-os:staging-shadow
```

Ese wrapper ejecuta candidatos, shadow run, `ANALYZE`, serving smoke y evidencia. Antes
de crear el directorio de evidencia corre `data-os:staging-check` y un
`data-os:preflight` remoto del par output/corpus; si el entorno o los IDs no pasan,
falla y no deja un evidence pack parcial. Si todavía no se aplicó schema en la DB
elegida, se puede incluir; en ese caso aplica schema antes del preflight output/corpus
y antes de crear el evidence pack, y luego copia el output como `apply-schema.log`:

```bash
export NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA=true
corepack pnpm data-os:staging-shadow
```

El wrapper escribe un paquete local de evidencia en `.data/data-os-evidence/<timestamp>`
por default. Para elegir ruta explícita:

```bash
export NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=.data/data-os-evidence/sephora-shadow-2026-07-01
corepack pnpm data-os:staging-shadow
```

Archivos esperados:

- `README.md`: resumen de target, corpus/output redactados y comandos ejecutados
  con UUIDs/URLs redactados.
- `apply-schema.log`: output de `db:apply:existing`, obligatorio sólo cuando
  `README.md` marca `Schema apply requested: true`.
- `staging-check.txt`: verificación redacted de env vars y aprobación operativa,
  con `ready_for_staging_shadow=true` y sin URLs/UUIDs.
- `candidates.json`: candidatos y candidato recomendado, salvo que se use
  `NOISIA_DATA_OS_STAGING_SHADOW_SKIP_CANDIDATES=true`.
- `shadow-run.log`: preflight, backfill, shadow QA y verify.
- `analyze.json`: `ANALYZE` post-backfill y confirmación de lecturas serving.
- `serving-smoke.json`: validación de endpoints live, fallback de kill-switch y
  `visibility_checks`, con `corpus_id`/`output_id` redactados para PR. Incluye la
  cola interna `review-queue` para tags/assertions.
  La cola debe poder registrar acciones humanas via
  `POST /api/data-os/corpora/:id/review-queue`, actualizando
  `record_tags.review_status` o `knowledge_assertions.status` y guardando
  `tag_review_events` o `knowledge_assertion_review_events` antes de cualquier
  activación cliente-visible.
- `review-queue.json`: output redactado de `data-os:review-queue`, capturado sin IDs
  ni contexto privado. Debe probar que hay candidatos con evidencia para revisión
  humana antes de registrar `review-sample.json`.
- `review-sample.json`: output redactado de `data-os:review-sample`; obligatorio para
  release gate. Debe probar que una muestra humana inspeccionada creó al menos un
  `tag_review_event` y un `knowledge_assertion_review_event`, sin URLs, UUIDs ni texto
  de cliente.
- `evidence.json`: reporte machine-readable, incluyendo `architecture_decision` para
  confirmar que Cut 1 es `customer_intelligence_lakehouse_cdp_like`, no Customer 360
  CDP/reverse ETL, y `review_queue` con `ready_for_human_review: true` y
  `required_before_client_visible: true`. Para pasar release gate debe incluir también
  `tag_review_events >= 1` y `knowledge_assertion_review_events >= 1`. Puede contener
  UUIDs reales de corpus/output/brand; se revisa dentro de `.data` y no se pega crudo
  en PR ni chat.
- `evidence.md`: evidencia lista para pegar en PR, con identificadores redactados y
  las secciones `Architecture Decision` y `Review Queue`.
- `evidence-pack-validation.json`: validación automática del paquete completo, con
  `artifact_manifest_algorithm: "sha256"` y checksums de cada artifact revisado.
- `release-gate.json`: resultado de `data-os:release-gate` cuando el target es
  `staging` o `preview`; se omite en `throwaway`.
- `pr-summary.md`: resumen PR-safe generado por `data-os:pr-summary`; falla si el
  markdown contiene UUIDs, URLs de DB, API keys o tokens.
- `completion-audit.json`: salida de `data-os:completion-audit`. Para staging/preview
  productivo debe traer `ready_for_goal_completion: true`; para `throwaway` debe quedar
  en `false` porque no reemplaza release gate.

### 5.1 Review Humano Mínimo

El primer shadow puede dejar la cola lista pero sin eventos humanos. Eso es correcto:
la revisión ocurre después de inspeccionar `review-queue` y antes de generar el
evidence pack final para PR/prod.

Inspeccionar la cola con la API interna:

```bash
GET /api/data-os/corpora/:id/review-queue?limit=25&review_status=unreviewed&assertion_status=candidate
```

Si la API interna todavía no está desplegada en el entorno de revisión, inspeccionar
la misma cola desde CLI. Este output puede incluir IDs y texto de cliente cuando se
activan los flags de inspección; no guardarlo en el evidence pack, no pegarlo en PR y
no pegarlo en chat:

```bash
NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true \
NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=true \
NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=true \
corepack pnpm data-os:review-queue
```

El comando devuelve `suggested_exports` para `NOISIA_DATA_OS_REVIEW_TAG_ID` y
`NOISIA_DATA_OS_REVIEW_ASSERTION_ID`. Por default, sin
`NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=true` y
`NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=true`, redacta IDs/contexto para que no se
confunda con evidencia de PR.

Elegir al menos un `tag_id` y un `assertion_id` con evidencia suficiente. Después,
registrar la muestra humana sin imprimir IDs ni texto de cliente en el artifact:

```bash
export NOISIA_DATA_OS_REVIEW_CORPUS_ID=$NOISIA_DATA_OS_BACKFILL_CORPUS_ID
export NOISIA_DATA_OS_REVIEW_TAG_ID=<record_tag_id>
export NOISIA_DATA_OS_REVIEW_ASSERTION_ID=<knowledge_assertion_id>
export NOISIA_DATA_OS_REVIEW_TAG_ACTION=approve
export NOISIA_DATA_OS_REVIEW_ASSERTION_ACTION=approve
export NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true

NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=true \
corepack pnpm data-os:review-sample
```

Reglas:

- No usar este comando para decidir por el operador; el humano debe haber leído el
  tag/assertion antes de pasar los IDs.
- `NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=true` sólo se usa con
  `NOISIA_REMOTE_DATABASE_TARGET=staging`, `throwaway` o `preview`.
- El output del comando redacta corpus, usuario e IDs; si se guarda como
  `review-sample.json`, no debe incluir URL de DB, UUIDs ni texto de cliente.
- Después de correrlo, volver a generar `serving-smoke.json`, `evidence.json`,
  `evidence.md`, `evidence-pack-validation.json` y `release-gate.json` sobre el
  mismo evidence dir o sobre un dir nuevo.
- El gate final debe ver `tag_review_events >= 1`,
  `knowledge_assertion_review_events >= 1`,
  `review_queue_tag_review_events >= 1` y
  `review_queue_assertion_review_events >= 1`.

`data-os:staging-shadow` también puede aplicar esta muestra durante el wrapper si ya
se conocen los IDs y se exporta `NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true`. Si no
hay eventos humanos todavía, el wrapper se detiene después de `serving-smoke.json`,
antes de `evidence.json`/`release-gate.json`, y conserva el evidence dir parcial para
inspección.

Para cerrar ese mismo paquete parcial sin repetir todo el shadow/backfill, usar el
finalizer después de inspeccionar la cola y exportar los IDs humanos:

```bash
export NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=.data/data-os-evidence/sephora-shadow-2026-07-01
export NOISIA_DATA_OS_REVIEW_CORPUS_ID=$NOISIA_DATA_OS_BACKFILL_CORPUS_ID
export NOISIA_DATA_OS_REVIEW_TAG_ID=<record_tag_id>
export NOISIA_DATA_OS_REVIEW_ASSERTION_ID=<knowledge_assertion_id>
export NOISIA_DATA_OS_REVIEW_TAG_ACTION=approve
export NOISIA_DATA_OS_REVIEW_ASSERTION_ACTION=approve
export NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true

corepack pnpm data-os:staging-finalize
```

`data-os:staging-finalize` exige el evidence dir parcial, refresca
`staging-check.txt` con los UUIDs redactados/formato validado, captura
`review-queue.json` redactado, registra `review-sample.json`, regenera
`serving-smoke.json`, `evidence.json`, `evidence.md`, `evidence-pack-validation.json`
y corre `release-gate.json` cuando el target es `staging` o `preview`; después escribe
`pr-summary.md` y `completion-audit.json` sobre el mismo paquete. Esto evita reejecutar
el shadow completo sólo para cerrar el paquete final tras la revisión humana.

Para validar un paquete ya generado:

```bash
NOISIA_DATA_OS_EVIDENCE_PACK_DIR=.data/data-os-evidence/sephora-shadow-2026-07-01 \
corepack pnpm data-os:validate-evidence-pack
```

Esta validación no sólo revisa archivos: también emite un manifest SHA-256 para que
`data-os:release-gate` detecte si `README.md`, `staging-check.txt`, `candidates.json`,
`shadow-run.log`, `analyze.json`, `serving-smoke.json`, `review-queue.json`,
`review-sample.json`, `evidence.json`, `evidence.md` o, cuando aplique,
`apply-schema.log` cambiaron después de validar.
Si `README.md` marca `Schema apply requested: true`, `apply-schema.log` debe existir,
estar libre de URLs de DB y quedar incluido en `checked_files` y en el manifest
SHA-256. También exige `analyze.json` con
`ready_for_serving_reads: true`, `staging-check.txt` sin `DATABASE_URL` ni UUIDs,
target consistente entre `README.md` y `staging-check.txt`,
mínimos de Data Catalog (`catalog_assets`,
`catalog_fields`, `catalog_contracts`, `catalog_quality_results`), cero
`catalog_assets_without_fields`/`catalog_failed_quality`, Brand OS, Knowledge,
`brand_os_briefs >= 1`, `brand_os_links >= 3`, `knowledge_assertion_links >= 3`,
`knowledge_usage_events >= 3` y `lineage_edges >= 9` en `serving-smoke.json`, además
de `fallback_checks` para rollback y `visibility_checks` para evitar exposición
cliente-visible de `source_health` o refs internas. Además exige que
`serving-smoke.json` pruebe `review_queue_ready_for_human_review`,
`review_queue_tags_with_evidence` y `review_queue_assertions_with_evidence`. También
escanea los artifacts contra
URLs de DB, API keys/tokens y exige que `evidence.md` no contenga UUIDs reales de
corpus/output. El validator también exige que `evidence.json` y `evidence.md` declaren
la decisión de arquitectura: Data OS es lakehouse/CDP-like sobre Postgres/Drizzle, con
APIs live detrás de flags/shadow y fallback a `published_outputs.payload`.
Además exige el gate `tag_assertion_review_queue`: todos los `record_tags` deben tener
evidencia, la muestra debe cubrir al menos cinco taxonomías (`record_tag_taxonomies`) y
las `knowledge_assertions` candidatas deben incluir evidencia. Este gate no reemplaza
review humano: garantiza que la muestra ya está lista para revisión. El paso de
release exige además eventos humanos auditables para tags y assertions antes de
cualquier activación cliente-visible, y `review-sample.json` debe estar en el pack
validado para que esos eventos queden trazables al comando que los registró.

Ruta manual equivalente para debug:

```bash
NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=true \
NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE=true \
NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE=true \
NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE=true \
NOISIA_DATA_OS_SHADOW_RUN_ENABLED=true \
corepack pnpm data-os:shadow-run
```

El runner ejecuta:

1. `data-os:preflight`
2. `data-os:backfill`
3. `data-os:shadow-qa`
4. `data-os:verify`

Después del runner manual, ejecutar `corepack pnpm data-os:analyze` antes de
`data-os:serving-smoke` o `data-os:evidence`.

Resultado esperado:

- `preflight.ok = true`
- `shadow_qa.ready_for_shadow = true`
- `shadow_qa.ready_for_live_switch = true`
- `verify.database.skipped = false`
- `ready_for_live_api_shadow = true`
- `shadow_qa.live.data_asset_fields >= 50`
- `shadow_qa.live.data_assets_without_fields = 0`
- `shadow_qa.live.record_tags > 0`
- `shadow_qa.live.record_feature_values > 0`
- `shadow_qa.live.brand_os_briefs >= 1`
- `shadow_qa.live.brand_os_links >= 3`
- `shadow_qa.live.knowledge_assertion_links >= 3`
- `shadow_qa.live.knowledge_usage_events >= 3`
- `shadow_qa.live.tagging_rule_sets >= 1`
- `shadow_qa.live.tagging_model_versions_with_rule_set >= 1`
- `shadow_qa.live.source_lineage_edges > 0`
- `shadow_qa.live.asset_lineage_edges > 0`
- `shadow_qa.live.dashboard_lineage_edges >= 4`
- `shadow_qa.live.dashboard_refs_with_source_id = 4`

## 6. Activacion Interna

Solo si el shadow run pasa:

```bash
export NOISIA_DATA_OS_ENABLED=true
export NOISIA_DATA_OS_SERVING_ENABLED=true
export NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=true
export NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false
export NOISIA_DATA_OS_SHADOW_MODE=true
```

Validar serving live antes de mostrar UI interna:

```bash
NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE=true \
NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false \
NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID=$NOISIA_DATA_OS_BACKFILL_CORPUS_ID \
NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID=$NOISIA_DATA_OS_SHADOW_OUTPUT_ID \
corepack pnpm data-os:serving-smoke
```

Reglas:

- Activacion primero para Noisia/internal.
- UI cliente mantiene fallback a `published_outputs.payload`.
- `NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=true` sólo se prende para internos después
  de `serving-smoke`, paridad live-vs-payload y sample humano aprobados.
- No borrar snapshots legacy.
- No encender `NOISIA_DATA_OS_TAGGING_ENABLED` para enriquecimiento LLM automatico en Cut 1.

## 6.1 Camino Worker Opcional

La ruta recomendada para PR sigue siendo `corepack pnpm data-os:staging-shadow` porque
produce un paquete de evidencia local. Cuando staging ya tenga worker y Redis activos,
se puede correr la misma secuencia desde BullMQ con:

```bash
export NOISIA_DATA_OS_WORKER_ENABLED=true
export NOISIA_DATA_OS_WORKER_RUNS_ENABLED=true
export NOISIA_DATA_OS_WORKER_REMOTE_APPROVED=true
export NOISIA_REMOTE_DATABASE_TARGET=staging
```

El worker sólo añade overrides remotos cuando `NOISIA_DATA_OS_WORKER_REMOTE_APPROVED=true`
y `NOISIA_REMOTE_DATABASE_TARGET` es `staging`, `throwaway` o `preview`; sin ese target
permitido, el contrato compartido mantiene los scripts remotos cerrados.

Contrato de job:

```json
{
  "name": "data_os_shadow_run",
  "data": {
    "corpusId": "<study_corpus_id>",
    "outputId": "<published_output_id>",
    "strict": true,
    "includeServingSmoke": true,
    "includeReviewQueue": true,
    "includeEvidence": true
  }
}
```

Cuando `includeReviewQueue` no es `false`, el worker corre `data-os:review-queue`
después de `serving-smoke` y antes de `data-os:evidence`. Ese paso fuerza
`NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=false` y
`NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=false`, incluso si el shell del operador dejó
flags privados encendidos.

No usar este camino si falta el evidence pack de PR. El worker es el camino operativo
para no hacer backfill/QA desde route handlers de Studio.

### 6.1 Reconciliar Sources Ya Cargadas

Si un corpus se creo antes de que existiera el materializador actual, o si cambio el
contrato de observaciones, reconciliar sus fuentes de forma idempotente antes del shadow.
Este comando vuelve a perfilar cada `brand_knowledge_source`, actualiza su
`data_contract`, ejecuta quality checks y materializa `data_observations` normalizadas.
No crea otro corpus, no duplica menciones y no llama a Claude para volver a resumir la
fuente.

```bash
export NOISIA_DATA_OS_RECONCILE_CORPUS_ID=<study_corpus_id>
export NOISIA_DATA_OS_RECONCILE_APPROVED=true
export NOISIA_DATA_OS_RECONCILE_ALLOW_REMOTE=true
export NOISIA_REMOTE_DATABASE_TARGET=staging
corepack pnpm data-os:reconcile-sources
```

Para targets remotos, `NOISIA_REMOTE_DATABASE_TARGET` solo puede ser `staging`,
`preview` o `throwaway`. Revisar el JSON final: `sources_failed` debe ser `0`. Después
confirmar en `data-os:analyze` que existen periodos, familias métricas, quality results y
lineage para las fuentes reconciliadas. Este replay es una reparación controlada de
materialización; no sustituye `data-os:staging-shadow` ni su evidence pack.

## 6.2 Gate Backend Ready For Signal V2

El wrapper de staging integra el gate workspace-centric de SB-10. Además del par
corpus/output exige:

```bash
export NOISIA_SIGNAL_WORKSPACE_ID=<signal_workspace_uuid>
export NOISIA_SIGNAL_V2_BACKFILL_APPROVED=true
export NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED=true
```

`data-os:staging-check` valida presencia/formato sin imprimir IDs. Durante
`data-os:staging-shadow` se aplican, en orden:

1. backfill dirigido idempotente con interpretaciones y LLM forzados a `false`;
2. reconciliación materialización → planner SQL → drill-down;
3. EXPLAIN sobre el corpus observado, con índices `0055` y budgets de costo/tiempo;
4. shadow del facade interno/cliente contra cobertura legacy;
5. serving smoke legacy con payload parity, fallback y visibilidad;
6. `signal:v2:backend-gate`.

Artifacts adicionales del evidence pack:

- `signal-v2-backfill.json`: `mode=apply`, payload preservado, gasto cero y sin
  activación cliente;
- `signal-v2-reconcile.json`: serie canónica completa, breakdown payloads, value,
  denominator, sample y page bounded reconciliados;
- `signal-v2-explain.json`: elegibilidad operativa (`included_mentions > 0`), volumen
  como contexto de muestra, índices y budgets de costo/tiempo. El referente de 1,000
  sirve para performance de alto volumen; no es un mínimo para graficar;
- `signal-v2-shadow.json`: cinco metric groups, visibilidad y fallback como checks
  técnicos; interpretaciones, release current y comparación compatible como
  `capability_checks` que pueden estar pendientes o `not_available`;
- `serving-smoke.json`: paridad legacy, kill-switch fallback y visibilidad interna/cliente
  verdes; el backend gate lo consume directamente;
- `backend-ready-signal-v2.json`:
  `backend_ready_for_signal_v2=true`.

El validador del evidence pack exige estos cinco artifacts Signal V2, valida sus
estados/redacción y los incluye en el manifest SHA-256 que luego verifica release-gate.

El wrapper conserva los artifacts aunque el gate quede bloqueado y termina non-zero.
Eso es evidencia honesta, no un error que se deba ocultar. Si pide review humano,
ejecutar `data-os:staging-finalize` sobre el mismo evidence dir; finalize vuelve a
correr reconciliación, EXPLAIN y shadow antes de decidir.

Las cinco interpretaciones Claude requieren budget cap, credenciales y aprobación
separados conforme SB-07. Este runbook no los enciende ni ejecuta un LLM. Su ausencia,
igual que no tener todavía una release estratégica o una segunda corrida comparable,
degrada la capacidad correspondiente pero no invalida el backend operativo. Nunca
resolver esos estados habilitando flags cliente, usando producción o presentando
fallback determinístico como si fuera Claude.

El gate distingue tres niveles:

1. **Técnico:** datos observados, contrato, materialización, queries, authZ, lineage,
   fallback y performance. Este nivel decide `backend_ready_for_signal_v2`.
2. **Analítico:** volumen, cobertura, calidad y review determinan confianza y
   advertencias por corte/filtro; no impiden chartear datos observados.
3. **Estratégico:** una release T&B y su comparación temporal solo existen cuando hay
   corridas aprobadas compatibles; mientras tanto el contrato sirve `not_available`.

Para ejecutar exclusivamente los cinco grupos del filtro home, primero hacer dry-run y
después aplicar con un cap total explícito:

```bash
NOISIA_SIGNAL_INTERPRETATION_TOTAL_BUDGET_USD=<total_usd> \
NOISIA_SIGNAL_INTERPRETATION_ALLOW_REMOTE=true \
corepack pnpm signal:v2:interpret-home

NOISIA_SIGNAL_INTERPRETATION_TOTAL_BUDGET_USD=<total_usd> \
NOISIA_SIGNAL_INTERPRETATION_ALLOW_REMOTE=true \
NOISIA_SIGNAL_INTERPRETATION_RUN_APPROVED=true \
corepack pnpm signal:v2:interpret-home -- --apply
```

El runner exige un solo corpus operacional, un único watermark compartido y los cinco
grupos canónicos; distribuye el cap entre ellos, es idempotente y nunca activa clientes.
Una respuesta Claude que no respete refs exactas se cobra dentro del cap y se degrada a
fallback en lugar de persistir una interpretación numéricamente inválida.

## 7. Rollback

Rollback logico, sin revertir migraciones:

```bash
export NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=false
export NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false
export NOISIA_DATA_OS_SERVING_ENABLED=false
export NOISIA_DATA_OS_ENABLED=false
export NOISIA_DATA_OS_SHADOW_MODE=true
```

Efecto esperado:

- Las rutas live responden 503 con `fallback: "published_outputs.payload"`.
- El dashboard vuelve a `payload fallback`.
- Las tablas Data OS quedan como memoria/backfill auditable para diagnostico.

No borrar filas Data OS salvo decision explicita de limpieza en staging/throwaway.

## 8. Evidencia Para PR

Generar evidencia estructurada despues de `data-os:shadow-run`, `data-os:analyze` y
`data-os:serving-smoke`:

```bash
NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE=true \
corepack pnpm data-os:evidence
```

Para pegar directo en la PR:

```bash
NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE=true \
NOISIA_DATA_OS_EVIDENCE_FORMAT=markdown \
corepack pnpm data-os:evidence
```

Pegar en la PR:

- commit/branch base;
- output de `corepack pnpm data-os:verify`;
- output resumido de `data-os:candidates` con candidato recomendado;
- resumen redactado de `shadow-run.log` con `ready_for_live_api_shadow: true`;
- resumen redactado de `analyze.json` con `ready_for_serving_reads: true`;
- output final de `data-os:serving-smoke`;
- output final de `data-os:review-sample` como `review-sample.json`, sin IDs ni
  contenido de cliente;
- output final de `data-os:evidence` con `ready_for_pr_review: true`;
- ruta del evidence pack `.data/data-os-evidence/...` y contenido de `evidence.md`
  con IDs redactados y secciones `Architecture Decision` y `Review Queue`;
- no pegar crudos `shadow-run.log`, `analyze.json` ni `evidence.json` si contienen
  UUIDs reales; esos archivos son para auditoría local dentro de `.data`;
- `staging-check.txt` con `ready_for_staging_shadow=true` y sin valores sensibles;
- output de `data-os:validate-evidence-pack` o `evidence-pack-validation.json`;
- `pr-summary.md` generado por `corepack pnpm data-os:pr-summary`;
- `completion-audit.json` generado por `corepack pnpm data-os:completion-audit`, con
  `ready_for_goal_completion: true` para staging/preview productivo;
- `review_queue` con `ready_for_human_review: true`,
  `required_before_client_visible: true`, `record_tags_with_evidence`,
  `record_tag_taxonomies`, `knowledge_assertions_with_evidence`,
  `tag_review_events >= 1` y `knowledge_assertion_review_events >= 1`;
- para producción o cliente-visible: `release-gate.json` del evidence pack, o output
  de `corepack pnpm data-os:release-gate`, con `ready_for_production_review: true`;
- `next_flags` con `NOISIA_DATA_OS_SHADOW_MODE=true` y `rollback_flags` que apaguen
  `NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED`, `NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED`,
  `NOISIA_DATA_OS_SERVING_ENABLED` y `NOISIA_DATA_OS_ENABLED`;
- conteos clave: `data_assets`, `data_asset_fields`, `data_contracts`,
  `data_assets_without_fields`,
  `data_quality_results`, `lineage_edges`, `source_lineage_edges`, `asset_lineage_edges`,
  `dashboard_lineage_edges`, `taxonomies`, `tagging_rule_sets`,
  `tagging_model_versions_with_rule_set`, `catalog_assets`, `catalog_fields`,
  `catalog_contracts`, `catalog_quality_results`, `catalog_assets_without_fields`,
  `catalog_failed_quality`, `record_tags`,
  `record_feature_values`, `brand_os_briefs`, `brand_os_links`, `knowledge_assertion_links`,
  `knowledge_usage_events`;
- decision de flags para staging y prod;
- rollback plan de la seccion 7;
- warnings aceptados, si alguno, con owner y fecha.

## 9. No-Go

No avanzar a live API si ocurre cualquiera:

- `preflight.failures.length > 0`;
- `shadow_qa.failures.length > 0`;
- `ready_for_live_api_shadow` no es `true`;
- faltan `dashboard_data_refs`;
- faltan `data_asset_fields` de assets críticos;
- `data_assets_without_fields > 0`;
- las `dashboard_data_refs` no tienen `source_id`;
- faltan `source_lineage_edges`, `asset_lineage_edges` o `dashboard_lineage_edges`;
- hay `data_quality_results` failed;
- falta `tagging_rule_sets` o el `tagging_model_versions` activo no apunta al rule set;
- no hay `record_tags` o `record_feature_values`;
- `brand_os_briefs < 1`, `brand_os_links < 3`, `knowledge_assertion_links < 3` o
  `knowledge_usage_events < 3`;
- `data-os:serving-smoke` no reporta `catalog_assets`, `catalog_fields` o
  `lineage_edges` con los mínimos esperados;
- `serving-smoke.json` no trae `fallback_checks` verdes para Data OS disabled y
  Signal Pulse live disabled;
- `serving-smoke.json` no trae `visibility_checks` verdes para ocultar
  `source_health`/refs internas a cliente default y conservarlas para interno;
- falta `analyze.json` o `ready_for_serving_reads` no es `true`;
- el output/corpus no es Signal Pulse;
- el target DB no fue confirmado como staging/preview/throwaway;
- no hay fallback `published_outputs.payload` verificado.
- `data-os:serving-smoke` no termina con `ready_for_serving_shadow: true`.
- no hay eventos humanos auditables de al menos un tag y una assertion.
- `backend-ready-signal-v2.json` no termina con
  `backend_ready_for_signal_v2: true`.
