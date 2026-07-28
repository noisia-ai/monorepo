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

Si el dry-run reporta que `signal_taxonomy_profiles` no existe, aplicar únicamente la
migración forward-only TN mediante el wrapper protegido; no usar
`drizzle-kit generate` ni reejecutar indiscriminadamente migraciones anteriores:

```bash
export NOISIA_DB_APPLY_SIGNAL_TAXONOMY_ALLOW_REMOTE=true
export NOISIA_SIGNAL_TAXONOMY_SCHEMA_APPLY_APPROVED=true
corepack pnpm --filter @noisia/db db:apply:signal-topics-narratives
```

El wrapper toma un advisory lock, ejecuta `0057` en una transacción y verifica tabla,
columna, funciones e índices antes de reportar éxito. No imprime la URL ni IDs.

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

El comando operator-only resuelve el workspace desde corpus/output, recupera contexto
versionado con Voyage, aplica el cap antes de cada llamada y persiste únicamente drafts:

```bash
export NOISIA_REMOTE_DATABASE_TARGET=staging
export NOISIA_SIGNAL_TAXONOMY_DISCOVERY_ALLOW_REMOTE=true
export NOISIA_SIGNAL_TAXONOMY_DISCOVERY_APPROVED=true
export NOISIA_SIGNAL_TAXONOMY_DISCOVERY_ENABLED=true
export NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED=true

corepack pnpm --filter @noisia/workers signal:discover-topics-narratives -- \
  --budget-cap-usd <CAP_USD_APROBADO> \
  --corpus-id 3d32472d-9720-4fae-b6d2-a73152c5f0a4 \
  --historical-output-id aaafa040-ca2f-49a6-afd0-e872b6706476
```

Si un intento pagado falla después de llegar al proveedor, reservar su costo de forma
conservadora mediante `--prior-cost-usd` antes de reintentar. Un rerun con drafts ya
persistidos no llama proveedores: devuelve `mode=existing_drafts`.

Un reviewer interno inspecciona terms, definitions, examples, exclusions y statement.
Debe aprobar ambos perfiles mediante los endpoints de review protegidos. Registrar
reviewer, timestamp y notes. Sin esta aprobación:

```text
NOISIA_SIGNAL_TAXONOMY_HUMAN_APPROVED=false
```

y el backfill apply debe fallar.

Para una aprobación operator-only sin sesión web, usar el wrapper protegido. Resuelve
exactamente un founder interno activo; nunca acepta un reviewer UUID por argumento:

```bash
export NOISIA_SIGNAL_TAXONOMY_REVIEW_ALLOW_REMOTE=true
export NOISIA_SIGNAL_TAXONOMY_HUMAN_APPROVED=true
corepack pnpm --filter @noisia/studio signal:review-topics-narratives -- \
  --apply \
  --notes "<DECISION_HUMANA>" \
  --corpus-id 3d32472d-9720-4fae-b6d2-a73152c5f0a4 \
  --historical-output-id aaafa040-ca2f-49a6-afd0-e872b6706476
```

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

El runner operator-only permite consumir únicamente los runs gobernados de este
corpus/output, sin iniciar workers de otras colas:

```bash
export NOISIA_SIGNAL_TAXONOMY_WORKER_ALLOW_REMOTE=true
export NOISIA_SIGNAL_TAXONOMY_WORKER_APPROVED=true
export NOISIA_DATA_OS_WORKER_ENABLED=true
export NOISIA_SIGNAL_TAXONOMY_ENRICHMENT_ENABLED=true
export NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED=true
export NOISIA_SIGNAL_TAXONOMY_PAID_BATCH_ATTEMPTS=1
corepack pnpm --filter @noisia/workers signal:run-topics-narratives-backfill -- \
  --corpus-id 3d32472d-9720-4fae-b6d2-a73152c5f0a4 \
  --historical-output-id aaafa040-ca2f-49a6-afd0-e872b6706476
```

Una clasificación válida queda `pending`; aprobar el perfil no aprueba sus tags.
Antes de materializar evidencia client-safe, un reviewer humano debe inspeccionar las
asignaciones y registrar eventos accept/reject/needs_review. No promover en bloque por
confianza ni convertir pending/rejected en métricas.

Cuando el reviewer humano apruebe explícitamente el conjunto revisado, el wrapper
operator-only puede persistir la decisión y rematerializar. Resuelve exactamente un
founder interno configurado, crea un `tag_review_event` por assignment, conserva
rejected, emite invalidación selectiva y fuerza Claude/interpretations apagados:

```bash
export NOISIA_SIGNAL_TAXONOMY_TAG_REVIEW_ALLOW_REMOTE=true
export NOISIA_SIGNAL_TAXONOMY_TAG_REVIEW_APPROVED=true
corepack pnpm --filter @noisia/studio \
  signal:review-topics-narratives-tags -- \
  --apply \
  --notes "<DECISION_HUMANA>" \
  --corpus-id 3d32472d-9720-4fae-b6d2-a73152c5f0a4 \
  --historical-output-id aaafa040-ca2f-49a6-afd0-e872b6706476
```

El dry-run usa el mismo comando sin `--apply` ni la flag de aprobación. No ejecutar
el apply si la decisión humana no cubre todos los assignments pending reportados.
La revisión es gobernada, no una regla de promoción automática.

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

El wrapper general de Data OS valida un par Signal Pulse antes de crear su evidence
pack. El output histórico T&B usado únicamente para resolver el scope de Laika no
satisface ese preflight. No reemplazarlo por un UUID supuesto: el operador debe
proporcionar un output/corpus Signal Pulse real compatible o aprobar una evolución
del release gate para aceptar evidencia TN workspace-centric.

## 6. Fallo y rollback operacional

- Desactivar las dos flags TN detiene gasto y nuevos enqueues.
- Los últimos tags/materializaciones aprobados permanecen disponibles; fallos no los
  sobrescriben.
- No borrar profiles, tags, runs ni payload legacy. Corregir mediante una nueva
  versión de perfil y rematerialización.
- Un run queued/failed permanece reconciliable en Postgres después de Redis/deploy.

## 7. Operación recurrente y recuperación

Una importación sobre el único corpus `operational` crea o recupera los runs por perfil
activo sin ejecutar T&B. El estado esperado es:

- `queued/running`: trabajo en curso;
- `partial`: presupuesto agotado con progreso y pendientes exactos;
- `blocked`: configuración, providers o activación todavía recuperables;
- `completed`: no quedan menciones sin feature para el perfil/revisión;
- `skipped`: condición permanente para ese scope;
- `failed/dead_letter`: error técnico con retries acotados.

Para continuar un `partial` o `blocked`, corregir flags/credenciales o autorizar un cap
mayor y repetir el backfill operator-only con el mismo corpus/output. El upsert conserva
el run, costo y tokens, incrementa `continuation` y genera un job ID nuevo sin duplicar
tags. Nunca modificar `corpus_revision` para forzar el resume.

Cada página usa orden `(published_at, id)`, máximo 500 por default y cero `OFFSET`.
Features ya confirmados son el checkpoint durable. Un crash repite como máximo la
página/batch no confirmado; la transacción y los unique indexes evitan duplicados.

La política automática v1 publica directamente sólo assignments con evidence,
confidence high y score mínimo 0.90 contra términos/perfil ya aprobados. El resto va a
review o rejected. Un reviewer humano puede hacer override y queda registrado sin
falsificar identidad automática.

Al aprobar una nueva versión, el estado queda `activating` y el perfil anterior continúa
en serving. Ejecutar su backfill; el worker sólo completa el cutover cuando coverage del
nuevo perfil está drenado. Si se bloquea, recuperar el run: no retirar manualmente el
perfil anterior.
