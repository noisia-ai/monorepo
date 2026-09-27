# Reintento durable de preparación editorial: esquema UAT — 27 septiembre 2026

El SQL0197 de reintento durable se aplicó una sola vez a `noisia-staging` y se verificó después desde la conexión directa y el pooler. El recibo de sólo lectura produjo `state=complete`, 305 tablas, las tres funciones y el trigger esperados. La constraint permite `preparation_failed`; las funciones mantienen ejecución no pública para `PUBLIC`, `anon` y `authenticated`.

La verificación terminó sin escrituras (`writes_performed=false`). Los conteos y digests de `signal_topic_editorial_batch_owners_v2`, `signal_topic_editorial_provider_batches_v2`, `signal_topic_editorial_batch_items_v2` y `signal_topic_editorial_reused_decisions_v2` permanecieron vacíos e idénticos. No se creó una admisión, lote, llamada, ejecución ni transporte de proveedor. El SHA-256 del SQL fue `8308232dc89318797214a3ae2b936a5c3bf9f5d885d2ff6d34131e2c620c9142`.

El recibo se puede volver a comprobar sin mutación con `apply-signal-topic-editorial-preparation-retry-uat.mjs verify`. **No ejecutar nuevamente `apply`.** La migración de esquema por sí sola no entrega ni habilita el flujo de retry en Studio/Worker.

El ensayo privado rollback-only del código sigue pendiente. La ejecución fallida del 27 de septiembre sí incluyó el hash correcto de SQL0197 y confirmó rollback físico, esquema idéntico después del rollback y cero transportes, pero Railway indica que la imagen provenía de `f015570`; esa imagen no contenía la corrección de fixture `3b4b20d`. Falló en `provider_batch_id` consultado desde la tabla de llamadas, que no posee esa columna. La fixture corregida verifica el estado del lote en `signal_topic_editorial_provider_batches_v2` y los estados de llamada por separado. El siguiente ensayo debe construir desde un commit que incluya esa corrección y el retry UI `aec4fca`; no se debe presentar el intento viejo como aceptación del código actual.

No hubo llamadas a Claude, Voyage o JEV. Tampoco se alteraron corpus, selecciones, Topics, Signal, permisos, políticas o recibos monetarios.
