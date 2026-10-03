# Diagnóstico seguro del despacho Message Batches — corte LOCAL

Fecha: 2026-09-27

## Qué se encontró

En UAT, el Worker repetía `topic_editorial_batch_dispatch_failed` sin fase ni código de error. El mismo patrón genérico impedía distinguir una consulta PostgreSQL, una lectura de BullMQ o el enqueue de un lote. Los logs del dashboard no daban evidencia suficiente para corregir el envío sin adivinar.

## Corte

El drainer V2 ahora etiqueta los fallos con una fase limitada (`database_read`, `queue_lookup`, `queue_state`, `queue_retry`, `queue_enqueue`) y conserva únicamente códigos conocidos de transporte/PostgreSQL o un mensaje interno bajo una allowlist estricta. El texto original de una excepción nunca se imprime; una excepción que contenga URI, credenciales o datos privados termina en un código genérico. No se modificaron admisión, manifiestos, claves idempotentes, estados, SQL ni llamadas al proveedor.

## Verificación

- Prueba focal del drainer: 4/4 PASS, incluido el rechazo de una URI con secreto en el mensaje.
- Typecheck de `@noisia/workers`: PASS.
- Suite completa del Worker: 640 PASS, 42 SKIP, 1 FAIL. El fallo aislado está en `signal-topic-editorial-queue.test.ts` (prueba V1 de reparación: esperaba una llamada y observó dos); reproducido al ejecutar sólo esa prueba. No toca el drainer V2 modificado, pero requiere diagnóstico antes de declarar la suite verde.
- UAT: pendiente; esta instrumentación sólo será útil tras el deployment Worker. No se inició ni duplicó una ejecución pagada.

## Siguiente acción

Publicar el commit focal en la rama UAT conectada al Worker, verificar que Railway ejecuta exactamente ese commit y leer el nuevo código de error. Corregir la causa concreta en un corte acotado. Volver a Topics y comprobar el estado de la misma solicitud idempotente; no crear otra solicitud. Si el despacho funciona, verificar progreso y resultados recibidos antes de evaluar la materialización del catálogo. Un código de despacho por sí solo no acredita interpretación completa ni calidad semántica.
