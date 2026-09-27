# Preparación editorial asíncrona y recuperación durable — 27 septiembre 2026

## Resultado

El inicio V2 de revisión editorial ya no espera a copiar resultados pagados compatibles ni a construir el manifiesto de Message Batches. Después de que PostgreSQL confirme la admisión durable, Studio responde con el recibo idempotente y el Worker existente realiza esa preparación usando sólo el ID de ejecución. La preparación no lee claves del proveedor ni envía solicitudes; el envío sigue separado y sujeto a las cercas de política existentes.

La admisión conserva el plan V2 exacto que el servidor ya cotizó. El helper de DB nuevo evita reconstruir el plan grande una segunda vez entre cotización y admisión; la función SQL vuelve a comprobar digest, cotización, política y fuente dentro de la transacción.

Un fallo permanente antes del primer lote o llamada ahora queda guardado en la etapa del dueño `preparation_failed`. Topics lo muestra como error técnico explícito y ofrece reintentar esa misma ejecución. El retry requiere una clave idempotente nueva, verifica actor, workspace, admisión y fuente, y conserva el plan, el tope y los recibos originales. No crea otra admisión ni autoriza gasto. La migración `0197_signal_topic_editorial_preparation_retry.sql` es local y **no se ha ejecutado**.

Mientras no exista ningún manifiesto, la interfaz distingue «preparando» de «lotes listos/en curso» y deja claro que Claude aún no ha recibido solicitudes.

El drainer deja de reenviar preparaciones que ya están marcadas como fallidas. Los fallos intermedios siguen usando los tres intentos de BullMQ; sólo el último registra el estado terminal.

## Rendimiento de la carga previa

La lectura de evidencia completa continúa antes de la admisión, porque el plan validado y cotizado forma parte de la autoridad de gasto. Se elevó de 128 a 512 referencias el tamaño de cada consulta acotada de evidencia. Para el máximo observado de unas 3,304 referencias en los 1,652 grupos de Alexa+, el número estimado de consultas baja de 26 a 7. Una prueba sintética de 513 referencias verifica los lotes `512 + 1` y el cotejo de cada evidencia; no prueba latencia de UAT ni cambia la cobertura semántica.

La duración de cada fase del POST ya se registra en `signal-topic-editorial-start-observability.ts`. El siguiente corte debe usar esas mediciones para decidir si conviene sellar y reutilizar una preparación previa entre cotización e inicio; no se debe mover la validación previa al Worker sin rediseñar antes la autoridad que depende de ella.

## Verificación local

- DB: prueba focal del lote editorial, 17/17.
- Evidencia fuente: 4/4, incluyendo lote 512+1 y rechazos de evidencia faltante, alterada, duplicada o fuera de ámbito.
- Studio: 40/40, incluyendo retry de la misma ejecución, copia es-MX/en-US y selección de la ruta V2 antes del fallback V1.
- Worker: 7/7, incluyendo persistencia sólo al último intento, exclusión de `preparation_failed` del drainer y preparación sin proveedor.
- `pnpm typecheck`: 11/11 paquetes.
- `pnpm lint`: 11/11 paquetes, sin errores; 13 warnings preexistentes en Studio.
- Revisión focal del SQL 0197: sin hallazgos accionables.

El runner privado rollback-only quedó ampliado para incluir SQL0197. Su fixture
añade la secuencia fallo terminal → retry con clave nueva → replay de esa clave
→ preparación del manifiesto, y comprueba que se mantiene una admisión, el
recibo de retry es durable, no se duplica la admisión y no hay envío al
proveedor. Las filas `reserved` que crea la preparación no cuentan como envío;
el fixture las distingue por estado y ausencia de `provider_batch_id`. También
se exige ahora que el runner complete al menos siete escenarios. Esta extensión
sigue **sin ejecutarse contra PostgreSQL**.

## Límites

Este corte está **sólo en el worktree local**. No ejecuté SQL, no desplegué Studio/Worker, no repetí el POST UAT incierto luego del único replay con su misma clave, no llamé a Claude/JEV/Voyage y no alteré Alexa+, Signal ni Laika. No se ha probado todavía la recuperación real desde la interfaz UAT ni el fixture ampliado en PostgreSQL. Los checks locales no demuestran latencia, concurrencia ni recuperación física en PostgreSQL remoto.

## Siguiente corte

1. Mantener sin cambios la solicitud UAT cuyo POST quedó incierto hasta poder reconciliarla por su clave original y un GET/recibo de sólo lectura.
2. Construir y probar la imagen privada que contiene el runner actualizado; ejecutar SQL0184–0197 sólo en la transacción sintética con aprobación específica y recibo físico de rollback.
3. Entregar Worker y Studio en orden compatible con DB; verificar estado de preparación, fallo terminal simulado y retry del mismo ID sin crear lote ni llamada al proveedor.
4. Si ese corte pasa, evaluar los tiempos por fase del inicio en UAT y seguir con la consolidación completa de Alexa+ sólo bajo la política y ledger vigentes.

La consolidación actual de Alexa+ no se declara completa: siguen siendo válidas las cifras históricas de 1,652 grupos originales y 2/42 lotes editoriales hasta que un recibo nuevo de UAT demuestre otra cosa.
