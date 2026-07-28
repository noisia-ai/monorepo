# 40 · Signal Topics & Narratives Staging Runbook

> Estado: procedimiento operator-only. No autoriza producción, gasto ni clientes.
> Canon de implementación y estado: `39_SIGNAL_TOPICS_NARRATIVES_BACKEND_AUDIT.md`.

## Scope fijo de Laika

- Corpus: `3d32472d-9720-4fae-b6d2-a73152c5f0a4`
- Output histórico de referencia: `aaafa040-ca2f-49a6-afd0-e872b6706476`
- Workspace: se resuelve desde Postgres mediante la membership operational activa y el
  mismo subject/organization. Nunca se inventa ni se copia de payload.

Usar sólo una base `staging` o `preview` confirmada. No usar producción.

## 1. Preflight sin gasto

```bash
export NOISIA_REMOTE_DATABASE_TARGET=staging
export NOISIA_SIGNAL_TAXONOMY_BACKFILL_ALLOW_REMOTE=true

corepack pnpm data-os:staging-check
corepack pnpm --filter @noisia/studio signal:backfill-topics-narratives -- \
  --corpus-id 3d32472d-9720-4fae-b6d2-a73152c5f0a4 \
  --historical-output-id aaafa040-ca2f-49a6-afd0-e872b6706476
```

El dry-run debe resolver exactamente un workspace operational, el periodo real, una
revisión de corpus y los perfiles `topic`/`narrative`. Si falta un perfil activo,
volver al endpoint interno de proposals/review; no crear rows manuales para saltar
review.

## 2. Discovery y aprobación humana

Discovery con Claude/Voyage requiere que el operador obtenga antes un cap USD explícito
en la tarea y configure las flags cerradas por defecto. Las propuestas deben distinguir:

- topic: sujeto concreto de conversación;
- narrative: afirmación, historia o marco;
- nunca trigger, barrier, decision layer, observed signal, finding o recommendation.

Un reviewer interno inspecciona terms, definitions, examples, exclusions y statement.
Debe aprobar ambos perfiles mediante los endpoints de review protegidos. Registrar
reviewer, timestamp y notes. Sin esta aprobación:

```text
NOISIA_SIGNAL_TAXONOMY_HUMAN_APPROVED=false
```

y el backfill apply debe fallar.

## 3. Apply y workers

Sólo después de cap y aprobación:

```bash
export NOISIA_SIGNAL_TAXONOMY_BACKFILL_APPROVED=true
export NOISIA_SIGNAL_TAXONOMY_HUMAN_APPROVED=true
export NOISIA_SIGNAL_TAXONOMY_ENRICHMENT_ENABLED=true
export NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED=true

corepack pnpm --filter @noisia/studio signal:backfill-topics-narratives -- \
  --apply \
  --budget-cap-usd <CAP_USD_APROBADO> \
  --corpus-id 3d32472d-9720-4fae-b6d2-a73152c5f0a4 \
  --historical-output-id aaafa040-ca2f-49a6-afd0-e872b6706476
```

El comando persiste dos runs idempotentes en el outbox Postgres y no llama al provider.
Workers aprobados reconcilian queued/failed runs, hacen batches, heartbeat, retry y
dead-letter. Una nueva importación debe crear sólo enrichment incremental y sus
invalidaciones; no debe ejecutar T&B.

## 4. Evidence pack obligatorio

Guardar outputs redactados en `NOISIA_SIGNAL_TAXONOMY_EVIDENCE_DIR`:

- `staging-check.txt`;
- `laika-taxonomy-backfill.json`: scope resuelto, profiles activos, term counts,
  aprobación humana, client activation false;
- `signal-topics-narratives-worker.json`: runs completos, tag counts, costo/cap,
  import trigger, retry/idempotency/dead-letter y `tb_rerun=false`;
- `signal-topics-narratives-reconcile.json`: counts y mention IDs exactos para topic y
  narrative, pending/rejected excluidos, `EXPLAIN ANALYZE` e índices;
- `signal-topics-narratives-serving.json`: filter parity, authZ negativa, lineage,
  payload/chart reads false y client activation false;
- `release-gate.json`: release gate Data OS real.

No incluir URLs de DB, API keys, texto sensible ni UUIDs adicionales en summaries
compartibles. Los artifacts de trabajo pueden contener refs gobernadas sólo dentro del
directorio protegido de evidence.

## 5. Gates

```bash
corepack pnpm data-os:staging-shadow
corepack pnpm signal:topics-narratives:backend-gate
```

El resultado válido exige:

```json
{
  "backend_ready_for_signal_topics_narratives": true,
  "client_activation": false
}
```

Además, `release-gate.json` debe contener
`ready_for_production_review: true` y `database_format: "postgres_url"`.
Pasar estos gates no habilita frontend ni clientes.

## 6. Fallo y rollback operacional

- Desactivar las dos flags TN detiene gasto y nuevos enqueues.
- Los últimos tags/materializaciones aprobados permanecen disponibles; fallos no los
  sobrescriben.
- No borrar profiles, tags, runs ni payload legacy. Corregir mediante una nueva
  versión de perfil y rematerialización.
- Un run queued/failed permanece reconciliable en Postgres después de Redis/deploy.
