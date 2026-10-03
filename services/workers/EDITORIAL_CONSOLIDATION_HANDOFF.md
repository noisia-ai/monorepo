# Wiring editorial de consolidación — 2026-09-12

El job `signal-topic-consolidation-editorial-v1` conecta el outbox y el lease de
SQL0176 con `runSignalTopicEditorialConsolidationV1` y el adaptador Anthropic
existente. El bootstrap sólo reclama trabajo con
`NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED=true`; los envíos requieren además
`NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED=true` y `ANTHROPIC_API_KEY` válida.
Todos los flags están apagados por defecto. Sin el primero no hay acceso DB,
cola, storage ni proveedor por esta vía. Las pruebas usan transporte simulado.

## Runtime DB compuesto

`signalTopicEditorialJobV1` construye `createSignalTopicEditorialRuntimeStoresV1`
al habilitar la vía. Reutiliza owner input, runnerStore, bindGlobal, bindRepair,
readRecovery, reserve, markSent, persistReceipt, settle y fail de DB; no implementa
SQL alternativo. La composición exige los contratos de SQL0178 y no acredita su
aplicación remota. Estos son los invariantes de los tres seams de recuperación:

1. `loadInput({database, lease})`: devuelve `{plan, groups}` desde el plan
   inmutable de la ejecución editorial admitida. Debe verificar
   execution/token/workspace/actor/numeric run/source, validar los digests y
   conservar el plan histórico al recuperar resultados pagados. No reconstruirlo
   desde el contexto vivo ni usar el source numérico actual como autorización.
2. `ledger.readRecovery({database, lease, request_digest})`: devuelve `null` o
   `SignalTopicEditorialRecoveredCallV1`, con request body exacto, call/attempt,
   estado, importe reservado/asentado y respuesta privada con body, SHA,
   storage key, HTTP status, complete y provider request ID. Debe resolver los
   intentos de la request exacta y rechazar historia ambigua; no llamar a reserve
   para encontrar una respuesta anterior. El lector `loadPaidResponse` que sólo
   devuelve output no prueba este contrato.
3. `ledger.persistReceipt(...)`: persiste los bytes/metadatos HTTP anteriores
   ligados a call/attempt antes de settlement. `response_body_private` sin
   status/completitud HTTP no permite reconstruir un receipt válido. Los bytes
   originales se guardan mediante `storeRawReceipt`; nunca se inventa status 200
   durante replay. La persistencia y settlement deben poder concluir después de
   perder permiso o lease cuando el envío ya ocurrió.

Reserve/markSent/settle/failCall se adaptan a sus funciones DB existentes. Cada
operación debe cerrar y liberar su transacción antes de devolver. El transporte
se ejecuta después de reserve y markSent; ninguna conexión se entrega al
adaptador HTTP. La prueba de Worker comprueba que no queda una operación de
ledger pendiente al entrar al transporte; la duración real de conexiones sigue
siendo una responsabilidad de los stores DB.

## Invariantes del Worker

- Un solo heartbeat pendiente; lease perdido impide futuros envíos y saves.
- Respuesta recibida después de perder lease: conservar bytes y settlement;
  recuperar el checkpoint bajo el lease siguiente, sin repetir la llamada.
- Recuperar y validar bytes pagados antes de los gates de proveedor/configuración;
  el proveedor deshabilitado sigue impidiendo toda reserva y envío nuevo.
- In-flight/unknown sin respuesta verificable bloquea; no existe retry HTTP.
- Binding global exacto antes de su primera reserva y después de cobertura completa.
- ACK perdido reutiliza el mismo job ID durable, con attempts=1.
- El runner termina en `review_ready`; el cierre provider-free posterior materializa la revisión y deja la ejecución `completed`, sin activar serving ni selección.

El recibo privado es un envelope inmutable con execution/call, bytes base64, SHA
del cuerpo HTTP, status, completitud y request ID. El storage existente exige
bucket privado, `x-upsert:false` y lectura de verificación por hash. Su readiness
se comprueba antes de reservar, fuera de cualquier transacción DB. Los archivos
temporales son 0600 bajo directorio 0700 y se eliminan al terminar o fallar.
La recuperación de DB no exige credenciales storage/proveedor actuales.

Validación focal: `pnpm --filter @noisia/workers exec node --test --import tsx
src/workers/signal-topic-editorial-queue.test.ts src/workers/signal-topic-editorial-runtime.test.ts
src/providers/signal-topic-editorial.test.ts` (30 pruebas; 33 incluyendo storage). No acredita ejecución
PostgreSQL, proveedor real ni entrega UAT del wiring.

## Reparación semántica única — contrato para SQL0178

`SignalTopicEditorialRuntimeStoresV1` requiere ahora:

```ts
bindRepair(args: {
  database: SignalTopicEditorialDatabaseV1;
  lease: SignalTopicEditorialLeaseV1;
  request: SignalTopicEditorialRunnerProviderRequestV1;
}): Promise<SignalTopicEditorialRunnerProviderRequestV1>;
```

El request normal permanece intacto. El hijo conserva `phase: screening|global`,
Sonnet4.6, configuración y schema de esa fase, y agrega únicamente:

```ts
repair: {
  contract_version: "signal-topic-editorial-repair-v1";
  repair_index: 1;
  parent_request_digest: string;
  parent_idempotency_key: string;
  parent_response_digest: string;
  error_code: string;
}
```

`parent_response_digest` es el digest canónico del output normalizado por el
schema de transporte, no el hash del cuerpo HTTP. El original mantiene ambos
recibos, el estado settled y su costo. El hijo tiene request body, request digest,
idempotency key y call ledger propios. Su costo consume el MISMO cap de ejecución
y policy; una reparación no concede presupuesto ni renueva la admisión.

El builder `buildSignalTopicEditorialRepairRequestV1({original,response,error_code})`
es determinista; su key usa `topic-consolidation-repair-v1:<phase>:<digest hex>`.
`validateSignalTopicEditorialRepairRequestV1(request)` devuelve
`{original,response,request}`. Esta validación estructural no concede autoridad:
el binding DB debe hacer lo siguiente en transacción corta bajo lease:

1. Probar ejecución/workspace y parent request exactos, original no-repair,
   call settled con output y receipt verificables; comprobar el body original y
   `parent_response_digest`. Repetir el validador semántico de la fase contra el
   batch/review sellado y exigir el mismo `error_code`. Un output válido no da
   permiso para crear reparación. Los errores de red, schema, fuente,
   autorización, persistencia o configuración tampoco.
2. Guardar el child inmutable con FK al parent y unicidad por parent request.
   Una repetición devuelve los mismos bytes; otra identidad/error/output bajo
   ese parent debe rechazar. El parent nunca se convierte en child y un child
   no puede tener descendiente repair. Mantener un solo call de reparación:
   no aplicar el retry genérico de tres intentos a este tipo de request.
3. Admitir reserve/markSent del child sólo con cap restante, proveedor explícito,
   source/admisión/lease vigentes; persistencia y settlement de llamadas pagadas
   siguen disponibles tras revocación. In-flight/unknown nunca reenvía.
4. Los validators de checkpoint, binding global y finish deben resolver el
   resultado efectivo como original válido o hijo settled semánticamente válido
   bajo esa relación exacta. `state_body` v1 no cambia: screening outputs y global
   conservan la request lógica original; el ledger prueba la procedencia del
   resultado corregido. No aceptar un output arbitrario ni sustituir el recibo
   original para hacerlo coincidir.

El Worker llama a bindRepair antes de load/reserve del hijo. En replay vuelve a
leer el resultado original desde su ledger, reconstruye el mismo child y recupera
su resultado. Si el child falla semánticamente devuelve
`topic_editorial_repair_invalid`, sin segundo hijo ni replay de transporte. Si
supera el límite conservador de contexto/bytes, falla antes de otra llamada.
Los defaults siguen deshabilitados; este corte no activa flags ni proveedores.

Activación operativa: todas las réplicas que consumen `data-os` deben compartir
el flag editorial antes de producir su outbox. Una réplica deshabilitada no hace
claims ni mutaciones DB. Este corte no añade recuperación SQL de un job entregado
a una réplica con configuración incompatible; no mezclar consumers on/off.


## Cierre automático provider-free — SQL0179

Después de `finish` (`review_ready`), el Worker llama a
`materializeSignalTopicEditorialWorkerExecutionV1({database, execution_id, worker_job_id})`.
Este adaptador valida el job ID durable y usa el servicio compartido:

```ts
materializeSignalTopicEditorialExecutionV1({
  database, workspace_id, actor_user_id, execution_id
})
```

La CTA de Studio puede importar ese mismo servicio desde `@noisia/db`. No acepta
un plan, un resultado LLM, un count ni un state digest enviados por el navegador:
lee owner/state sellados, comprueba SHA, fase, identidad y cobertura declarada,
y entrega el digest exacto al materializador SQL0179 bajo su lock/CAS. La revisión
queda `validated`, la ejecución `completed`, y `activation` siempre
`not_activated`. Serving, selección y catálogo actualmente servido permanecen intactos.

Un claim terminal (`review_ready` o `completed`) pasa directamente al mismo
servicio. No construye runtime/transport/storage, no lee la API key y no ejecuta
el runner otra vez. Una interrupción antes de materializar conserva `review_ready`;
un ACK perdido después del commit recupera la misma revisión por replay idempotente.
Los fallos posteriores a `finish` no llaman a `failExecution` ni reabren el owner
editorial; se reportan con código saneado. El usuario puede reintentar por la CTA.

Pruebas locales: Worker queue/runtime 27 PASS; DB materialización/wrapper 7 PASS.
Incluyen crash tras `review_ready`, ACK perdido, replay con proveedor deshabilitado,
API-key getter prohibido, misma revisión, pagos intactos y `not_activated`.
El rehearsal privado `rehearse-editorial-composed.ts` ahora genera un concepto
sintético válido y el resto Noise, aplica0178+0179 sólo en su transacción rollback,
provoca el crash antes de materializar, reentra sin proveedor y verifica hashes
antes/después de profiles/terms/classification generations/catalog.
Este cambio de rehearsal todavía no acredita una nueva ejecución PG/UAT.
