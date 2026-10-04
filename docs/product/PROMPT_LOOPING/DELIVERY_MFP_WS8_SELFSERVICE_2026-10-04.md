# WS8 — Embeddings self-service y selección persistida de fichas

Spec canónico v1.3. Continuación focal de PR25, base `00b6e3f9`. Sin migración nueva, cambio de roles, despliegue ni proveedor en este corte.

## Cambio y demostración pendiente

Datos cliente puede solicitar vectores tras completar la preparación. En MFP Studio exige `can_request_processing`, consulta el máximo configurado de la política y omite el máximo heredado de USD5. La estimación no se convierte en un máximo; el usuario puede establecer uno explícito. Un máximo de entorno o política conserva precedencia. Cada solicitud MFP, con máximo nulo o finito, crea admisión y ejecución atómicamente. El Worker reconoce esa admisión corpus y revalida capacidad antes de nueva actividad, además de los guards SQL existentes de reserva/envío. Reutilización total de caché sin proveedor sigue exigiendo cero entradas pendientes y cap0; replay conserva el intento. Fuera de MFP permanece la autoridad interna y el máximo histórico.

Status y POST de fichas resuelven la identidad seleccionada del workspace antes del default. Los ensayos conservan su selector explícito y una marca sin selección conserva el default. Replay usa la identidad inmutable del intento original incluso si cambió la selección; los nuevos intentos rechazan versiones retiradas. Esto no aprueba un modelo experimental ni cambia su estado. El Worker consume la identidad inmutable del run. El default actual ya es ordinal V3 con máximo8; la corrección evita sustituciones futuras o de otra selección, sin afirmar que el corpus real tenía un digest distinto.

Pruebas focales locales ligeras: 42 PASS; fixtures/mocks y render SSR, no navegador real. Typecheck, lint, suites y build se ejecutan en CI remoto. `scripts/dev-corpus/embeddings-selfservice-check.ts --rollback-check` queda preparado para Root: identidad dev-test verificada, cliente y políticas sintéticas sólo dentro de rollback, Studio→DB→Worker de caché real; reserva SQL sintética para revocación antes del envío y liquidación de recibo sin transporte. Comprueba máximo nulo/finito, replay y censos. PG aún pendiente al preparar este recibo; no es evidencia de llamadas reales, aceptación semántica ni recorrido UAT.

## Configuración mínima persistente propuesta

Los flags de esta sección son propuesta operativa, no constancia de activación. Un solo Worker persistente consume la cola MFP privada; no mantener ticks manuales concurrentes. PostgreSQL/Redis/Worker/builds permanecen remotos. Conexiones privadas y claves server-side se configuran por servicio; no copiar env históricos.

| Servicio | Configuración necesaria | Evidencia de código |
|---|---|---|
| Studio y Worker | `NOISIA_MENTION_FACETS_ENABLED=true`, `NOISIA_MENTION_FACETS_PROVIDER_ENABLED=true` | `apps/studio/src/lib/data-os/signal-mention-facets.ts`; `services/workers/src/workers/signal-mention-facets-batch.ts` |
| Studio y Worker | `NOISIA_CONCEPT_MEMBERSHIP_ENABLED=true`, `NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED=true` | `services/workers/src/workers/signal-concept-membership-batch.ts` y ruta de membresías |
| Studio y Worker | `NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED=true`, `VOYAGE_API_KEY` privada | `apps/studio/src/lib/data-os/workspace-corpus-embeddings.ts`; `services/workers/src/workers/signal-workspace-embeddings-provider.ts` |
| Studio y Worker | `NOISIA_WORKSPACE_INTERPRETATION_ENABLED=true`, `ANTHROPIC_API_KEY` privada | `apps/studio/src/lib/data-os/signal-workspace-analysis.ts`; `services/workers/src/workers/signal-workspace-interpretation-batch.ts` |
| Studio y Worker | `NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED=true`, `NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED=true` | Ruta `topics/consolidation/editorial`; `services/workers/src/workers/signal-topic-editorial-batch-queue-v2.ts` |
| Worker | `NOISIA_DATA_OS_WORKER_ENABLED=true`, `NOISIA_WORKSPACE_NUMERIC_PRODUCER_ENABLED=true`, `NOISIA_WORKSPACE_INCREMENTAL_PROJECTION_ENABLED=true`, `NOISIA_WORKSPACE_TOPIC_PROGRESS_ENABLED=true` | `services/workers/src/index.ts`; `signal-topic-classification-outbox.ts`; `infrastructure/db/signal-workspace-numeric-producer.ts` |
| Runner dedicado | `NOISIA_MFP_ENABLED=true`, `NOISIA_MFP_WORKER_ENABLED=true` | `scripts/dev-corpus/runtime.mjs`, `guard.mjs`; guard exacto de servicios/destino privado |
| Studio | `NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID` de usuario interno financiero activo verificado | `infrastructure/db/signal-brand-context-policy-provisioning.ts`: sólo founder/noisia_admin/admin; nunca actor inventado ni autoridad del navegador |

El bootstrap MFP instala ocho acciones, incluida `topic_fit_incremental` gratuita/automática. En organizaciones existentes no reescribe historia: comprobar las acciones de la política activa y crear un sucesor por el mecanismo del operador si falta alguna. Ausencia de `NOISIA_MFP_PROCESSING_DAILY_CAP_MICRO_USD` y `NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD` significa sin máximo explícito; no asignar valores históricos de demos ni strings vacíos.

Las etapas editoriales globales del mismo pipeline batch requieren además `NOISIA_SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_ENABLED` y `NOISIA_SIGNAL_TOPIC_EDITORIAL_GLOBAL_STAGE_PROVIDER_ENABLED` en Worker cuando la consolidación requiera esa fase (`signal-topic-editorial-global-stage-queue-v2.ts`). No son los pipelines congelados de interest decision.

Mantener apagados los flags `NOISIA_SIGNAL_INTEREST_DECISION_*` de preparación/materialización/batch/proveedor/V2/V3, `NOISIA_ENGINE_RUNTIME_ENABLED`, `NOISIA_SIGNAL_REFRESH_SCHEDULER_ENABLED` y los flags editoriales V1 `NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED`/`NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED`. No habilitar JEV para el recorrido Claude por defecto. No trasladar caps, vencimientos ni autorizaciones legacy de interpretación al recorrido MFP gobernado por política.

Worker necesita Supabase URL/service key/bucket privado para archivos y artefactos (`signal-workspace-engine-storage.ts`). Studio conserva su auth Kinde y almacenamiento existentes; Worker no necesita Kinde/Resend/SentiOne. No inferir validez de credenciales por presencia: Root verifica modelos, accesos y selección del labeler antes de habilitar transporte persistente.

Coste de este corte: cero llamadas de proveedor; estimación de ejecución de checks PG, 2–5 minutos una vez libre el runner, a verificar. No es fecha de aceptación del producto.
