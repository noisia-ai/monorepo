# Repair editorial agotado: diagnóstico y continuación con excepciones

Fecha: 12 septiembre 2026. Estado: **propuesta local; no implementada ni autorizada para envío**.
Complementa el [recibo Alexa Plus E2E](DELIVERY_ALEXA_PLUS_E2E_2026-09-12.md).

## Causa comprobada

La ejecución `46c735c7-dcb0-4fa4-aa42-2ef0b0b7a93d`, workspace
`979b8f96-3366-463d-8ee8-8c0cce460a71`, conserva 36 unidades interpretadas y sus Topics.
La lectura de `2026-09-12T12:58:40Z` encontró `status=failed`,
`error_code=workspace_engine_interpretation_repair_invalid`, sin revisión editorial y con
`workspace_interpretation_admission_eligible_v1=false`.

| Recibo | Identidad | SHA-256 de la respuesta | Bytes |
| --- | --- | --- | ---: |
| Original | `d125b5c4-ff74-424e-8f10-60fa3101a376` | `101f84953cd8ff1eff1ae885ba1131feb45ea230de9484371c0dca50167c45e4` | 8,245 |
| Único repair | `9a84c6b3-f117-4920-a4a4-c2a72088a59c` | `1fb675a5c193ea1bf55aa3972631f0187c6540209e8c9b0c0d075c9c2e630f2f` | 8,843 |

Ambas llamadas están `settled`, con HTTP 200, respuesta completa, modelo Sonnet 4.6,
`stop_reason=end_turn`, un bloque de texto y JSON parseable con cuatro interpretaciones. En ambas,
la primera interpretación tiene `status=coherent`, nombre y definición presentes, pero
`citations=[]`. Las citas de condiciones no sustituyen el respaldo exigido para nombre/definición.
Esta ausencia basta para rechazar el resultado; no se afirma que los otros tres grupos hayan
superado toda la validación de autoridad.

`validateSignalWorkspaceInterpretationResultV1` rechaza `output_evidence_missing`;
`validateWorkspaceInterpretationReceiptV1` lo resume como `output_invalid`; el Worker, después del
único repair, termina con `repair_invalid`. No es un JSON truncado, un límite de tokens ni el
terminal de transporte histórico. Los dos recibos carecen de checkpoint editorial válido.

Se descargaron los objetos privados persistidos con el adapter de storage, verificación de hash
y un fence que permitió únicamente GET al proyecto UAT existente: cinco GET, cero llamadas a
Anthropic. Los bytes y metadatos permanecen en `.data/alexa-plus-e2e-2026-09-12/release/`, ignorados
por Git. Este memo no contiene textos, citas ni credenciales.

## Frontera actual

El bloqueo monetario es correcto: un retry común vuelve a leer el mismo repair inválido y no
puede crear un segundo repair lógico. La revisión SQL0143 sólo admite la transición histórica
Opus → Sonnet; no es una renovación Sonnet → Sonnet. Ampliar el allowlist de retry o inferir citas
desde condiciones no resuelve esa frontera de forma segura.

Los 36 Topics, su proyección y la selección ya son utilizables mediante el recorrido de cobertura
parcial. La brecha es continuar los grupos restantes sin quedar detenido por ese mismo lote.

## Corte mínimo recomendado

1. **Registrar una excepción gratuita y explícita para el lote completo.** La UI ofrece «Aislar
   este lote y conservar los resultados». El servidor reconstruye el batch exacto desde el
   checkpoint y contexto sellados, verifica ambos request digests, SHA de respuestas y protocolo
   de repair, y ejecuta el validador vigente. No rescata automáticamente tres de cuatro grupos ni
   inventa una interpretación `insufficient` para el grupo inválido.
2. **Continuar sólo con confirmación de gasto separada.** Registrar la excepción no reserva,
   encola ni envía. Una nueva autorización explícita de interpretación sobre la misma ejecución
   permite procesar los grupos restantes, dentro del cap original y del saldo vigente. No abre
   una nueva ejecución, cambia configuración ni repite los grupos checkpointados o aislados.
3. **Conservar la semántica parcial.** El Worker omite únicamente el conjunto de unidades sellado
   como excepción. Materializa los resultados válidos mediante el productor progresivo existente.
   Si sólo quedan excepciones, termina sin nuevos envíos con un estado legible de resultados
   parciales y sin ofrecer retry. El corte mínimo conserva `status=failed` con un código específico
   propuesto, `workspace_engine_interpretation_exceptions_remaining`; no redefine `ready` como
   interpretación completa ni relaja la comprobación final de cobertura.

## Contrato durable propuesto

Requiere una migración forward-only nueva; no editar SQL0143/0147 ni los recibos existentes.

- Nueva tabla `signal_workspace_interpretation_exceptions`, append-only, con `id`, `workspace_id`,
  `execution_id`, `operation_id`, `source_call_id`, `repair_call_id`, ambos request digests y SHA de
  respuestas, `input_digest`, `fit_checkpoint_digest`, `configuration_digest`, `validator_version`,
  `diagnostic_code`, `unit_manifest`, `created_by_user_id` y `created_at`. El único estado inicial
  es `quarantined`; la resolución posterior queda fuera de este corte.
- Reutilizar `signal_classification_operations` con un nuevo tipo
  `quarantine-interpretation-batch`, recibo completado y unicidad de workspace/actor/key. Unicidad
  adicional de ejecución/repair impide aislar el mismo lote dos veces. `unit_manifest` contiene
  exactamente los cuatro grupos del request original; su censo/digest se validan en el servidor.
- El request gratuito incluye ejecución y CAS de `repair_call_id`, request digest y fit checkpoint.
  El actor procede de sesión. Bajo los locks de presupuesto del actor, taxonomía e input/ejecución
  existentes, revalidar autoridad activa, workspace, fuente vigente y ausencia de otro dueño en
  vuelo. Ambos calls deben ser settled/completos/configurados exactamente y carecer de checkpoint.
  Rechazar `reserved`, `in_flight`, `response_persisted` pendiente y `outcome_unknown`; conservar
  las reservas `terminal_confirmed` históricas como exposición, sin reutilizarlas ni liberarlas.
- Replay de la misma key y digest devuelve el recibo histórico sin otra excepción, admisión o job;
  payload distinto da conflicto. La operación y la excepción se confirman en una transacción con
  constraint diferida de integridad. RLS/ACL mantienen escritura exclusiva del servidor.
- Extender `workspace_interpretation_admission_eligible_v1` sólo para una ejecución fallida cuyo
  lote bloqueante tenga esa excepción íntegra y con grupos restantes. Reutilizar la admisión/CAS
  y outbox existentes para `authorize_interpretation`; mantener originales cap, configuración,
  run, call, reserva y presupuesto. Recovery gratuito de recibos no consume una admisión nueva.
- El lector de recuperación de request digests y el selector legacy/v2 deben reconocer la misma
  excepción sellada. Un lote aislado no vuelve al planner de recuperación ni mantiene legacy por
  carecer de un checkpoint válido. No cambiar los request digests o artefactos históricos.

No se tocan `signal_classification_generation_items`, `signal_classification_assignments` ni la
selección existente al registrar una excepción. Los 36 Topics y las 67 menciones seleccionadas
continúan servidos por sus generaciones y recibos originales.

## Archivos y validación necesaria

- `packages/query-engine/src/signal-workspace-interpretation-v1.ts`: diagnóstico tipado y digest
  del manifiesto de excepción; conservar el requisito de citas y el protocolo de un solo repair.
- `infrastructure/db/signal-workspace-engine.ts`, `signal-workspace-interpretation-admission.ts`
  y un store específico de excepciones: CAS, replay, lector de exclusiones, elegibilidad y censo
  de pendientes. La nueva migración impone las mismas guardas en DB.
- `services/workers/src/workers/signal-workspace-engine-interpret.ts`: reconstrucción/validación
  exacta, restauración de checkpoints, exclusión explícita y fin parcial; ninguna llamada desde
  el registro gratuito. El consumidor incremental debe permanecer sin cambios hasta tener su
  propio contrato equivalente; no ampliar un helper monetario global.
- Studio: GET muestra diagnóstico saneado, cantidad de grupos aislables, resultados conservados,
  costo confirmado y reserva terminal. Acción gratuita con CAS y confirmación diferenciada;
  continuación con tope/vencimiento explícitos. Ocultar reintentos imposibles y mantener el acceso
  a los Topics/Signal disponibles. Nunca mostrar contenido crudo del proveedor como instrucción.

Pruebas mínimas antes de implementar la entrega:

1. Fixture sintética con cuatro grupos, el primero coherent sin citas superiores: original y
   repair siguen inválidos; ninguna cita se infiere. Tres respuestas aparentemente válidas no
   pasan silenciosamente como un checkpoint de cuatro.
2. Cuarentena real PG: replay/concurrencia crean una excepción; CAS obsoleto, actor revocado,
   workspace ajeno, fuente/configuración alteradas o un solo recibo incierto rechazan sin cambios.
3. Snapshot antes/después: 36 unidades checkpointadas y sus Topics, selección, respuestas, settled y reserva
   terminal idénticos; registro gratuito crea cero calls/reservas/outbox.
4. Autorización nueva procesa únicamente pendientes, conserva el cap agregado y reanuda tras
   perder el ACK. Un reinicio no vuelve a enviar el batch aislado ni las unidades checkpointadas.
5. Cobertura, legacy/v2 y serving: los conjuntos válido/aislado/pendiente son disjuntos y suman el
   universo sellado. Al quedar sólo excepciones, no hay envío ni falso 100% semántico; Signal
   sigue mostrando el resultado parcial y su selección.

El riesgo principal es transformar una excepción editorial en aprobación implícita o en permiso
para repetir gasto. Por ello este memo propone un recibo nuevo y explícito, no un cambio de
allowlist. La migración, API/UI y prueba PG compuesta quedan pendientes de un corte autorizado.
