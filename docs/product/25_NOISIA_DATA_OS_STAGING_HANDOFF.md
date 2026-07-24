# 25 · Noisia Data OS Staging Handoff

Checklist de operador para llevar **Noisia Data OS Cut 1** del estado local verificado a
un shadow run real en staging/preview.

Este documento es deliberadamente corto. La fuente completa sigue siendo
`23_NOISIA_DATA_OS_STAGING_RUNBOOK.md`.

## Estado Local Verificado

Antes de pedir una ventana de staging, el branch debe tener verdes:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm --filter @noisia/studio build
corepack pnpm data-os:verify
```

El lint puede mostrar warnings existentes en `apps/studio/public/deck/deck-stage.js`;
no deben existir errores.

## Valores Que Debe Proveer El Operador

No pegar valores reales en PR, docs ni chat. Usar
`scripts/data-os-staging-flight-card.example.sh` como flight card: copiar los exports a
una terminal segura, reemplazar placeholders ahi y dejar el archivo versionado sin
secretos ni UUIDs reales.

Exportar como minimo:

```bash
export DATABASE_URL=<staging_or_preview_database_url>
export NOISIA_REMOTE_DATABASE_TARGET=staging # o preview
export NOISIA_DATA_OS_BACKFILL_CORPUS_ID=<study_corpus_uuid>
export NOISIA_DATA_OS_SHADOW_OUTPUT_ID=<published_signal_pulse_output_uuid>
export NOISIA_SIGNAL_WORKSPACE_ID=<signal_workspace_uuid>
export NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true
export NOISIA_SIGNAL_V2_BACKFILL_APPROVED=true
export NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED=true
```

Si el schema todavia no fue aplicado en esa DB:

```bash
export NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA=true
```

No usar `production` como target. Los scripts remotos sólo aceptan `staging`,
`preview` o `throwaway`, y el release gate de produccion sólo acepta `staging` o
`preview`.

## Paso 1: Precheck Redactado

```bash
corepack pnpm data-os:staging-check
```

Debe terminar con:

- `DATABASE_URL_FORMAT=postgres_url`
- `DATABASE_URL_ENVIRONMENT=remote_redacted`
- `LOCAL_DATA_OS_VERIFY=passed`
- `NOISIA_REMOTE_DATABASE_TARGET=staging` o `preview`
- `NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid`
- `NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid`
- `NOISIA_SIGNAL_WORKSPACE_ID_FORMAT=uuid`
- `NOISIA_SIGNAL_V2_BACKFILL_APPROVED=true`
- `NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED=true`
- `ready_for_staging_shadow=true`

Si falta cualquier valor, corregir el env local. No copiar UUIDs ni URLs a GitHub.
Si aparece `DATABASE_URL_FORMAT=placeholder_refused` o
`DATABASE_URL_FORMAT=invalid_postgres_url`, la flight card todavía no fue reemplazada
correctamente o la URL no es una conexión Postgres valida.

### Reconciliacion opcional de un Signal T&B historico

Para validar `signal-serving-v2` sobre un output T&B publicado, ejecutar primero el
dry-run con el UUID solo en la terminal segura:

```bash
NOISIA_DATA_OS_SIGNAL_BACKFILL_ALLOW_REMOTE=true \
corepack pnpm --filter @noisia/studio signal:backfill-serving -- \
  --output-id=<published_tb_signal_output_uuid>
```

El dry-run reporta si faltan el coding bridge, oportunidades o Action Studio, sin
escribir. Si el target confirmado es `staging` o `preview`, aplicar con:

```bash
NOISIA_DATA_OS_SIGNAL_BACKFILL_ALLOW_REMOTE=true \
corepack pnpm --filter @noisia/studio signal:backfill-serving -- \
  --output-id=<published_tb_signal_output_uuid> --apply
```

La reconciliacion debe terminar con refs completos, cero hard blocks y checks de
preservacion en `true`. No cambia `published_outputs.payload`, status, version ni
`published_at`; solo materializa las entidades canonicas y actualiza el manifiesto.
No ejecutar este comando contra produccion.

### Bootstrap Signal V2 sobre un corpus T&B gobernado

Si el workspace real todavía no tiene un output `signal-pulse`, no sustituirlo por un
fixture de otra marca ni copiar sus menciones a un corpus artificial. El backfill
Signal V2 puede usar el output T&B publicado del mismo corpus como fallback transitorio:

```bash
NOISIA_SIGNAL_V2_BACKFILL_ALLOW_REMOTE=true \
NOISIA_SIGNAL_V2_BACKFILL_APPROVED=true \
NOISIA_SIGNAL_INTERPRETATIONS_ENABLED=false \
NOISIA_SIGNAL_INTERPRETATIONS_LLM_ENABLED=false \
corepack pnpm --filter @noisia/studio signal:backfill-v2 -- \
  --output-id=<published_tb_signal_output_uuid> \
  --workspace-id=<signal_workspace_uuid> \
  --apply
```

El comando sólo acepta las parejas exactas `signal-pulse`/`signal_pulse` o
`triggers-barriers`/`signal`, exige que output, corpus y workspace compartan sujeto y
organización, preserva `published_outputs.payload` y deja Claude apagado. Después se
ejecutan `signal:v2:reconcile`, `signal:v2:explain` y `signal:v2:shadow` con los UUIDs
del mismo workspace/corpus/output.

Esta vía valida el facade unificado sobre datos reales, pero no convierte el output T&B
en Signal Pulse ni satisface por sí sola el release gate de Data OS, cuyo evidence pack
histórico sigue exigiendo un candidato Pulse. Los resultados de dos marcas distintas no
se pueden combinar en un solo cierre.

## Paso 2: Shadow Run

```bash
corepack pnpm data-os:staging-shadow
```

El wrapper crea `.data/data-os-evidence/<timestamp>` y corre:

- candidatos;
- preflight output/corpus;
- backfill;
- shadow QA;
- `ANALYZE`;
- serving smoke;
- review queue redactada.
- backfill dirigido Signal V2 con payload preservado;
- reconciliación SQL/materialización/drill-down;
- EXPLAIN con volumen e índices;
- facade shadow interno/cliente y gate Backend Ready.

Si todavía no hay muestra humana, el wrapper se detiene después de `review-queue.json`.
Eso es esperado: el paquete queda parcial para inspección.

## Paso 3: Review Humano

Inspeccionar la cola con IDs/contexto sólo en terminal segura:

```bash
NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true \
NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=true \
NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=true \
corepack pnpm data-os:review-queue
```

Elegir un tag y una assertion con evidencia suficiente. Después exportar:

```bash
export NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=.data/data-os-evidence/<timestamp>
export NOISIA_DATA_OS_REVIEW_CORPUS_ID=$NOISIA_DATA_OS_BACKFILL_CORPUS_ID
export NOISIA_DATA_OS_REVIEW_TAG_ID=<record_tag_uuid>
export NOISIA_DATA_OS_REVIEW_ASSERTION_ID=<knowledge_assertion_uuid>
export NOISIA_DATA_OS_REVIEW_TAG_ACTION=approve
export NOISIA_DATA_OS_REVIEW_ASSERTION_ACTION=approve
export NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true
```

## Paso 4: Finalizar Evidence Pack

```bash
corepack pnpm data-os:staging-finalize
```

Debe regenerar:

- `staging-check.txt`
- `review-queue.json`
- `review-sample.json`
- `serving-smoke.json`
- `evidence.json`
- `evidence.md`
- `evidence-pack-validation.json`
- `release-gate.json`
- `pr-summary.md`
- `completion-audit.json`
- `signal-v2-backfill.json`
- `signal-v2-reconcile.json`
- `signal-v2-explain.json`
- `signal-v2-shadow.json`
- `backend-ready-signal-v2.json`

El último artifact se calcula después de `serving-smoke.json` y exige explícitamente
payload parity, fallback y visibilidad legacy verdes, además del shadow workspace-centric.
`signal-v2-reconcile.json` debe reportar series, breakdowns y páginas de drill-down
reconciliadas para el filtro home canónico vigente.
`evidence-pack-validation.json` debe incluir los artifacts Signal V2 en su manifest
SHA-256; un archivo ausente, degradado o modificado después de validar bloquea el cierre.
`pr-summary.md` debe declarar `Backend Ready For Signal V2: true`.

## Paso 5: Gate De Produccion

Leer `release-gate.json`. Para abrir PR productivo debe decir:

```json
{
  "ready_for_production_review": true
}
```

Confirmar el cierre del Goal con:

```bash
NOISIA_DATA_OS_EVIDENCE_PACK_DIR=.data/data-os-evidence/<timestamp> \
corepack pnpm data-os:completion-audit
```

Debe terminar con `"ready_for_goal_completion": true`.

El Goal de Data OS no se considera completo hasta tener ese artifact de staging/preview.
SB-10 tampoco se considera completa hasta que
`backend-ready-signal-v2.json` diga:

```json
{
  "backend_ready_for_signal_v2": true,
  "llm_spend_usd": 0,
  "client_activation": false
}
```

El campo de gasto en este artifact describe los scripts de backfill/shadow, no autoriza
las cinco interpretaciones Claude. Si estas faltan, el gate debe quedar bloqueado y el
operador debe coordinar budget/credenciales/review fuera de este handoff antes de
reintentar. No activar `NOISIA_SIGNAL_WORKSPACE_API_ENABLED` ni render cliente para
hacer pasar el gate.

## Que Pegar En La PR

Pegar sólo:

- `pr-summary.md`;
- `completion-audit.json`;
- `evidence.md`;
- output resumido de `corepack pnpm data-os:verify`;
- confirmación de `release-gate.json` con `ready_for_production_review: true`;
- plan de flags y rollback.

No pegar:

- `DATABASE_URL`;
- UUIDs reales;
- `shadow-run.log` crudo;
- `analyze.json` crudo;
- `evidence.json` crudo;
- outputs de review queue con `SHOW_IDS=true` o `SHOW_CONTEXT=true`.

## Flags Iniciales Para Rollout

Activacion interna/shadow:

```bash
NOISIA_DATA_OS_ENABLED=true
NOISIA_DATA_OS_SERVING_ENABLED=true
NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=true
NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false
NOISIA_DATA_OS_SHADOW_MODE=true
```

Rollback logico:

```bash
NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false
NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=false
NOISIA_DATA_OS_SERVING_ENABLED=false
NOISIA_DATA_OS_ENABLED=false
NOISIA_DATA_OS_SHADOW_MODE=true
```
