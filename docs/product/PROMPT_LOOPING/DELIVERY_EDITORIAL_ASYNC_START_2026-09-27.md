# Inicio editorial V2: diagnóstico y corte focal (27 septiembre 2026)

## Evidencia del fallo

En UAT, POST `start_editorial` para Alexa+ se quedaba en `quote_policy` y el proxy devolvía 502 tras 300 s; GET seguía en `not_requested`. La prueba de sólo lectura con la misma entrada de 1,652 grupos produjo un plan de **80,924,308 bytes**. De ellos, 25,706,772 bytes eran contexto de marca repetido y 42,640,808 bytes mensajes de proveedor. Studio enviaba el JSON completo y su representación canónica a una cotización que volvía a validar grupo por grupo. PostgreSQL canceló esa validación con `57014` bajo un plazo de 25 s. Además, dos columnas imponían 64 MiB al plan, de modo que mover solamente el trabajo al Worker tampoco habría permitido admitirlo.

## Cambio

- POST guarda una intención pequeña en PostgreSQL y responde sin reconstruir el corpus. GET muestra `preparing` o una falla de inicio con causa segura; la UI consulta hasta ver la ejecución.
- El Worker existente reclama la intención, carga el corpus, arma el plan y usa la misma clave idempotente para la admisión V2. El Worker no lee la clave de Claude en este paso. La cola lleva sólo un UUID; PostgreSQL guarda el estado y recupera leases vencidos.
- La cotización no pagada envía sólo digest y cantidad de grupos. La admisión continúa comprobando plan canónico, fuente, evidencia por grupo, política, presupuesto y ledger bajo sus locks. El límite de almacenamiento sube a 256 MiB sin recortar respuestas de Claude.
- La autorización de la cotización dura hasta una hora para dar margen al Worker. La política y la fuente se vuelven a comprobar al admitir y enviar.

## Recibo de base de datos

SQL0198 `0198_signal_topic_editorial_async_start_v2.sql` se ensayó primero en una transacción con rollback sobre UAT. Se aplicó **una sola vez** a UAT el `2026-09-27T21:15:01.483Z`, SHA-256 `62c242da7454d5b80bacd8eb653d8bc9cebfbb506a78bae70b3fe8a19083d123`. Pre/post: seis admisiones, dos ejecuciones editoriales, 32 llamadas y 15 claves; cantidades idénticas. Verificados tabla de intenciones, función de cotización rápida y nueva capacidad de plan. SQL0197 ya estaba presente en UAT y **no se reaplicó**. La cotización rápida real con una entrada sin gasto devolvió `policy_required` en 959 ms.

## Estado pendiente al redactar

El código está en checkout focal `codex/uat-editorial-polling-2026-09-27`; falta integrarlo y desplegar Worker→Studio en UAT, comprobar desde la interfaz, y decidir una nueva política de Alexa+ si se quiere enviar trabajo pagado. La política actual marcaba `valid_until=2026-09-27T05:59:00Z` y máximo diario/ejecución USD 30; no se renovó ni se hizo llamada a Claude en este corte. No declarar la consolidación de 1,652 grupos terminada por esta reparación.
