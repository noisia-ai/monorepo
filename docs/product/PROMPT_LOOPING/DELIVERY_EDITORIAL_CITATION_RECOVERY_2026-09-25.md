# Recuperación focal de citas editoriales — 25 septiembre 2026

## Problema real

Alexa+ conserva 43,159 menciones elegibles y 1,652 grupos BERTopic. La ejecución editorial vigente `b82e0335-5e7b-42c0-af0e-a2e8c3cefba8` tenía 2/42 lotes terminados. El lote 2 (tercero) y su única reparación pagada estaban asentados, ambos con 40 decisiones, pero el original citó referencias ajenas en tres grupos y la reparación conservó una referencia ajena en uno. `topic_editorial_repair_invalid` impedía avanzar y el replay no generaba más llamadas.

## Cambio

Después de una sola reparación fallida por `topic_editorial_output_citation_invalid`, el Worker deriva una salida conservadora: la decisión con cita ajena queda `unresolved`, sin candidato ni citas; las otras decisiones pasan por el mismo validador. No se acepta la cita inventada ni se modifica ningún cuerpo, hash, solicitud, recibo o respuesta pagada. La derivación SQL es determinista desde la respuesta asentada y los recibos sellados del grupo; el guard de checkpoint sólo admite esa derivación bajo la relación parent/child existente. Otros errores continúan fallando cerrados. No hay nuevo proveedor, retry monetario ni contrato de modelo.

Producto `551ee92`. Query Engine: 497 tests y typecheck PASS. SQL0186 SHA256 `9d8fcd16100379312fe2acdba1251762f1229c2c5d6dad7dec1fed005f6923fd`; ensayo completo en UAT con rollback físico: 40 decisiones, una `unresolved`, función previa intacta al revertir. Luego SQL0186 aplicado una vez con advisory lock, owner fallido y cero llamadas activas. No repetir.

## Autoridad y gasto

El operador autorizó hasta USD30 adicionales para la consolidación. Política UAT v5 `bdffb728-517f-4fee-8549-7940413a4fc3`, sólo `topic_consolidation`/Sonnet4.6, hasta 27 septiembre 05:59 UTC. Renovación de la misma ejecución `458bb669-8ae7-4b52-8913-f47eb145a8af` tiene cap restante de USD28.414368 y admisión hasta 26 septiembre 00:00 UTC (cierre del día presupuestario). Antes del nuevo despliegue, confirmado USD1.585632 asentado, cero reservas/llamadas activas y ninguna llamada nueva por el primer reintento fallido. No Opus.

## Continuación del mismo owner

Tras SQL0186, el replay recuperó el lote 2 sin otra llamada y avanzó a 3/42. El lote 3 destapó un segundo caso distinto: el original tenía citas ajenas, pero su cuarentena conservadora era válida; la respuesta de reparación pagada tenía esquema inválido, por lo que no podía servir de checkpoint. El Worker falló cerrado con `topic_editorial_repair_invalid`, conservando ambos recibos, costo confirmado USD2.046735 y cero reservas activas.

El commit `bf97d40` permite recurrir a la cuarentena del original **sólo después de comprobar que original y reparación están asentados**. La extensión SQL0187 conserva la identidad, cuerpo y recibos de ambas solicitudes; no acepta citas ajenas ni relaja cobertura de 40 grupos. Query Engine 498/498 y typecheck PASS. La función SQL0187 se ensayó en UAT con rollback físico: cuarentena de 40 decisiones y checkpoint 4/42 aceptado por el guard, sin cambios persistentes. Luego se instaló una vez mediante la conexión privada del Worker; se verificó que el owner aún estaba fallido en 3/42 antes del COMMIT y que la nueva rama quedó en la función. SHA256 del archivo SQL0187: `f81f699a855fc70f78d39cc5cb6e78948f12fae7fd2d13e4137863c60fe8b64a`. No reaplicar SQL0186 ni SQL0187.

Worker `198fa9d8-2874-4f9e-9b43-83d156f19190` y Studio `9a6b1dcc-3945-4a97-83ac-0ed57cba17dc` ACTIVE con `bf97d40`. Se reanudó **la misma** ejecución desde Topics; llegó a 4/42 sin repetir llamadas pagadas del lote 3 y prosiguió a 5/42. La ejecución sigue activa al escribir esta nota; el costo confirmado leído en UI en 5/42 era USD2.598039, con USD0.603603 reservado para la siguiente llamada. Estos valores son una observación intermedia, no cierre de gasto.

## Estado pendiente

Continuar la misma revisión hasta 42/42 bajo el tope adicional autorizado, sin reiniciar el análisis. Si falla, diagnosticar la respuesta y el ledger antes de reintentar. Después faltan la revisión global, materialización del catálogo consolidado, ejemplos reales de Noise/uniones/separaciones, edición y selección en Signal. La etiqueta de 30,377 menciones «sin resolver» no equivale a 30,377 llamadas Claude ni desaparecerá íntegramente como Topics: el resultado válido puede ser Topic, Narrative, Noise o pendiente con evidencia insuficiente.

Loop programado continúa PAUSED. No repetir imports, embeddings, BERTopic ni tocar Laika/producción.
