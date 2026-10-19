# Revisión editorial V2: admisión por grupos, sin plan monolítico

Fecha: 27 septiembre 2026. Estado: diseño de ejecución; no se aplicó SQL nuevo ni se enviaron Message Batches.

Primer corte LOCAL: `signal-topic-editorial-admission-v3.ts` construye una cabecera versionada que conserva la identidad y el digest del plan V2, el contexto una sola vez y el índice/digest ordenado de cada grupo. Un generador transporta las solicitudes intactas en bloques de hasta 256, verificando la correspondencia con esa cabecera. La prueba de contrato cubre 1,652 grupos y tampering; **todavía no existe admisión PostgreSQL V3 ni entrega UAT de esta representación**.

## Decisión basada en el corpus real

El arranque HTTP ya es durable en UAT (`a477ff0`/SQL0198), pero el siguiente paso aún no admite los 1,652 grupos de Alexa+. El plan sellado actual mide 80,924,308 bytes. Sus 1,652 cuerpos de proveedor suman 42,493,780 bytes y los cuerpos canónicos por request 80,608,178 bytes. La llamada actual pasa estas tres representaciones y una segunda copia del plan a una sola función SQL. Esto es trabajo y memoria redundantes, no evidencia adicional.

Pruebas privadas sin proveedor ni cambios persistentes: el censo se cargó en ~15–17 s; el plan se construyó en ~2 s; un parámetro JSONB de 80.9 MB se transfirió y parseó en 7.7 s. Una función temporal conservando los guards devolvió `true` para 100, 500, 1,000 y 1,400 grupos; el caso de 1,400 tardó 91 s. Con 1,652, tanto la llamada monolítica como piezas guardadas en tablas temporales dejaron de devolver respuesta dentro del plazo observado; la sesión no apareció como activa en `pg_stat_activity` al comprobarla. El cliente se canceló, la transacción se revirtió y no hubo admisión, reserva ni proveedor. **No está probado que la causa exacta sea OOM.** Recalcular el digest canónico del contexto en cada grupo añade trabajo: una llamada aislada tardó 89 ms. Moverlo fuera del bucle es correcto, pero no resolvió el censo completo por sí solo.

## Corte mínimo de producto

Conservar la intención durable, el quote rápido, el modelo Sonnet 4.6, la política versionada, la admisión de producto y el ledger actual. Cambiar sólo el almacenamiento/admisión de screening nuevo; no reescribir V1 ni las ejecuciones pagadas existentes.

1. Sellar una cabecera compacta: workspace, actor, run, digests de fuente/contexto/configuración, recuento esperado, orden y digests de requests, presupuesto y clave idempotente. El objeto de ejecución no debe contener `source_context`, `source_group` ni `provider_request` repetidos 1,652 veces.
2. En una **misma transacción** de Worker, insertar esa cabecera y las 1,652 filas de `signal_topic_editorial_requests` en lotes pequeños. Cada fila conserva su request exacta y evidencia; el guard comprueba grupo/raíz/citas/identidad contra el censo publicado. Una falla revierte cabecera, admisión, requests y key completos. No hay Batch visible ni reserva hasta finalizar.
3. El finalizador comprueba cantidad, orden y digest de todas las filas; sólo entonces prepara el manifiesto durable sobre los requests existentes. La cola de Message Batches sigue siendo dueña del envío/importación. Una respuesta perdida recupera por la misma key antes de volver a construir evidencia.
4. Mantener lectura de ejecuciones V1/V2 e historial de pagos sin mutarlos. Una nueva identidad de contrato separa la representación compacta; no cambia las decisiones editoriales ni la salida Claude. La consolidación global posterior consume todas las decisiones con sus grupos originales.

## Criterio de aceptación, en ese orden

- Comprobar en PostgreSQL privado con **los 1,652 grupos reales de sólo lectura** que cabecera + todas las filas + finalizador terminan en un tiempo medido, con rollback y ninguna llamada/reserva. Casos de grupo alterado, evidencia ajena, request duplicada, lote faltante, quote/política vencidos e idempotencia deben dejar cero parcialidad. No admitir top-k ni muestras como cobertura completa.
- Activar en UAT una política vigente versionada con tope explícito y recibo; el tope experimental de USD 30 no define la calidad del producto. No saltar la autoridad ni enviar antes de la aceptación anterior.
- Reanudar la misma solicitud desde Topics, observar admisión 1,652/1,652, envío, resultados, errores recuperables y costo real. Después catálogo consolidado editable y selección comprobada en Signal. No declarar terminado antes de ese recorrido.

Este corte sustituye la idea de aumentar solamente el timeout o la memoria de PostgreSQL: aquello deja una única carga enorme y no mejora la capacidad para marcas con corpus mayores.
