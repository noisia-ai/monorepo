# Recuperación de Batches de intereses — 3 octubre 2026

Este recibo complementa `PLAN_DEFINED_INTEREST_TO_PRODUCTION_2026-10-02.md`. Alexa+ es el corpus de aceptación; su clasificación no equivale a disponibilidad general ni a precisión semántica aprobada.

## Estado comprobado

- La ejecución V2 `7ea63f0d-a857-4cec-ba5e-597544c7057c` selló 43,159/43,159 raíces. A las 06:47 UTC había 80 Batches aplicados, 367 preparados, 156 `submission_unknown` y 72 `submitting`. Sólo los 80 aplicados tienen identidad de Batch de Claude; las solicitudes inciertas **no se reenvían** por inferencia.
- Claude Console mostró un saldo impago de USD 1.24 y pidió agregar fondos para reanudar el acceso API. El Worker emitía `interest_decision_release_invalid` mientras se acumulaban lotes inciertos. No se observó el cuerpo HTTP de esos envíos; HTTP 402 es una causa consistente con la consola y el código, no una atribución comprobada para cada lote.
- El proveedor devolvió un inventario completo (`has_more=false`) de 191 Batches el 3 de octubre a las 06:49:21 UTC, digest SHA-256 `6f7e7eea1cec88c747765a4974615dc4ca2668e65f5c86d2bf4dbfd993f1a6a5`. Contiene los 80 IDs conocidos de esta ejecución; no hay un Batch ajeno al registro desde las 06:20 UTC. El último Batch aceptado por Claude fue creado a las 06:27:22 UTC; el último intento incierto se marcó enviado a las 06:38:45 UTC, 636 segundos antes del inventario. Este recibo sustenta una reconciliación controlada, no autoriza actualizar filas sin conservar evidencia.
- El flag `NOISIA_SIGNAL_INTEREST_DECISION_BATCH_PROVIDER_ENABLED` está en `false` en Worker UAT. Se detuvieron nuevos POST mientras persista el saldo y la reconciliación. No se cancelaron los 80 Batches aceptados ni se tocaron las menciones, el catálogo o Laika.

## Corrección entregable

El commit `f739404` reconoce HTTP 402 y 429 como rechazos explícitos sólo cuando el transporte recibió cuerpo completo; conserva el recibo privado, clasifica el resultado como definitivamente no enviado y evita tratarlo como POST ambiguo. SQL `0219_signal_interest_decision_explicit_rejections.sql` permite exactamente esos estados y libera la reserva de la llamada sólo después de asentar el rechazo. HTTP 500, timeout y respuesta perdida siguen inciertos.

Worker: 737 pruebas PASS, 42 omitidas; typecheck PASS para `f739404`. El ensayo PostgreSQL UAT dentro de transacción comprobó que una actualización directa de la llamada y HTTP 500 son rechazados, mientras HTTP 402 asienta el recibo y libera una llamada; la transacción se revirtió. SQL 0219 se aplicó **una vez** en UAT a las 06:48:38 UTC, SHA-256 `92ea11d8592ee8aa12288e62a095cdb01b94caf9d3e4ed7f5ef499c2b2220a37`. No reaplicar. El despliegue de Worker/Studio disparado por el push estaba construyendo al escribir este recibo; comprobar ACTIVE antes de declararlo entregado.

## Reconciliación de los 228 lotes anteriores

La migración `0220_signal_interest_decision_provider_inventory_reconciliation.sql` guarda el inventario completo en una tabla inmutable y permite una sola transición privada a «no enviado» cuando: la lista no tiene más páginas, incluye todos los 80 IDs conocidos, ningún Batch del proveedor fue creado después del primer intento incierto, pasaron al menos diez minutos desde el último intento, y coinciden exactamente identidad, conteo, estados y recibos. Una lista incompleta, un ID conocido ausente, un Batch nuevo o un conteo cambiado fueron rechazados en ensayos con rollback. El ensayo positivo liberó 228 reservas y dejó 80 aplicados/367 preparados, también con rollback.

SQL 0220 se aplicó **una vez** en UAT el 3 de octubre a las 06:53:14 UTC, SHA-256 `288a35b5c4eff48c8e76a7fbdfc79dd03a5dbc2bacecaa96a7c3716a839507e6`. En la misma transacción se conservó el inventario digest `sha256:6f7e7eea1cec88c747765a4974615dc4ca2668e65f5c86d2bf4dbfd993f1a6a5` bajo reconciliación `dcd8f802-ee6e-41d6-b776-ffbf72d93aa8` y se liberaron exactamente 228 llamadas. Estado confirmado tras commit: 80 Batches `applied`, 367 `prepared`, 228 `rejected` con prueba de ausencia; cero `submission_unknown` o `submitting`. No reaplicar SQL ni repetir la reconciliación.

El Worker incorpora un sucesor idempotente **sólo** para rechazos con inventario probado. Un HTTP explícito sin ese inventario sigue fuera de reintento automático. Se ensayó en UAT dentro de una transacción: una llamada reconciliada produjo un intento 2 `reserved` con el mismo manifiesto y referencia al intento 1; se revirtió sin llamar al proveedor. El flag de envío continúa `false` hasta resolver facturación y comprobar el nuevo Worker activo.

## Próxima acción

1. El operador agrega fondos en Claude Console. Esa transacción financiera queda de su lado. El saldo por sí solo **no** reactiva el proveedor: primero resolver el hold semántico de `QUALITY_HOLD_DEFINED_INTEREST_2026-10-03.md` con una evaluación independiente. No repetir importación, embeddings ni BERTopic.
2. Sólo con calidad comprobada, decidir explícitamente si se puede continuar la ejecución sellada o si hace falta una identidad nueva; no mutar los prompts ni reutilizar decisiones incompatibles. Completar 43,159 decisiones, membresías persistentes, selección reversible y Signal. Las citas literales no prueban pertinencia por sí solas.
3. Cerrar Alexa+ al demostrar un interés completo con evidencia, recuperación y costo. La aceptación restante para producto general es otra marca creada desde UI con una segunda carga incremental, más el corte de release integrado. El draft PR #14 integra `main` y UAT para validar CI; no implica merge o despliegue de producción.
