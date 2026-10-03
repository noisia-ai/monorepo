# Guardia de consolidación global corregida en UAT — 28 septiembre

La ejecución V3 de Alexa+ `d4dee83e-f35d-43f7-865e-f868580a7427` cerró el cribado de 1,652/1,652 grupos (1,580 decisiones nuevas y 72 reutilizadas) y pasó a `review_pending`. El Worker falló al preparar el primer lote global: el trigger `signal_topic_editorial_global_stage_call_guard_v2` de SQL0202 leyó `e.provider` y `e.model`, columnas inexistentes en `signal_topic_editorial_executions`. Railway registró PostgreSQL `42703` y cero lotes globales preparados.

SQL0204 reemplaza sólo esa función. Compara `provider`, `model` y la configuración con la acción de política `topic_consolidation`, como hace la admisión V3 existente. Mantiene identidad de ejecución, presupuesto, deadline, ledger, estados y recibos. No modifica SQL0202 ni lo reaplica.

Recibo UAT: 2026-09-28T04:40:07.613Z; SHA256 `7bec2af85bd496a00abbd470b88749f442f3571a89a0c50eb3603399a08d4c15`. Antes: 1,652 solicitudes de cribado, cero stages/calls/batches globales. La consulta previa confirmó política activa, Sonnet4.6, configuración exacta, cap coincidente y ventana de envío abierta. La sustitución transaccional confirmó la función resultante y no alteró esas filas. A las 04:40:30Z el mismo Worker creó el stage global, preparó 42 shards y envió un Batch `in_progress` con reserva de USD55.127930; es reserva, no gasto confirmado.

Pendiente: importación y validación de los 42 shards, rondas merge/rank, catálogo final versionado, revisión de Noise/uniones/separaciones y selección comprobada en Topics/Signal. No declarar completa la consolidación por este arreglo. El plazo de nuevos envíos de la ejecución sigue 2026-09-28T06:00:00Z; los Batches ya enviados pueden terminar después.
