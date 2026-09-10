# Continuar una interpretación incremental después del vencimiento

NOI-82. Desarrollo iniciado el 10 septiembre de 2026 a las 02:07 UTC, después de comprobar la entrega d4cd78e en UAT. Complementa el Compass y el plan de monitoreo incremental; no cambia su rumbo ni autoriza gasto.

## Resultado para el usuario

Si una actualización conserva grupos pendientes y vence su permiso, Topics permite confirmar un importe y vencimiento nuevos sobre la misma actualización. Continúa desde las respuestas guardadas. Las menciones, modelos, evidencia, Topics editados y selección no se recrean. Recuperar un resultado ya pagado sigue siendo una acción independiente que puede terminar sin autorizar más llamadas.

Se reutiliza el bloque actual de importe/vencimiento y el botón de continuación. No hay formulario por grupo ni una sección nueva. El permiso debe ser una decisión explícita; cargar la página, consultar progreso o ejecutar un heartbeat no lo crea.

## Corte y responsabilidades

Checkout aislado `/Users/brandhon_o/Downloads/noisia-incremental-permission-renewal-2026-09-10`, rama `codex/noisia-incremental-permission-renewal-2026-09-10`, base `d4cd78e0bbbee30895580a820404f6d5d3e8d46b`. UAT sigue en d4cd78e/SQL0151 hasta cerrar y entregar este corte. No tocar las entregas anteriores ni los tres drafts ajenos.

- Backend: lector de renovación, recibo encadenado y guardas SQL0152 para el mismo dueño editorial; no otra ejecución.
- Root: estado y admisión/cola en una transacción, bloqueo de proveedor después de resolver repetición, servicio Studio y validación.
- Frontend: controles compactos, ES/EN, recuperación con la misma key y cuerpo después de una respuesta perdida.
- Import: comprobar consumidor real y recuperación con PostgreSQL real y proveedor HTTP local simulado; modificar runtime sólo si una incompatibilidad lo exige.

## Contrato acordado

El estado agrega `incremental_editorial.execution.renewal`: disponibilidad, motivo, permiso previo esperado, margen de importe y fecha máxima, con cifras del servidor. El POST `renew_incremental_editorial` sólo acepta el dueño actual, permiso previo esperado, importe, vencimiento y la key habitual. El servidor determina actor de presupuesto, modelo y configuración.

La renovación conserva el tope original de la ejecución y descuenta gasto/reservas de la ejecución y del día. Cambia el puntero al recibo nuevo sin reescribir el anterior. Un permiso aceptado y la recuperación de su trabajo se confirman juntos; si el proveedor está deshabilitado, una renovación nueva revierte completa, pero una key ya aceptada se puede consultar sin mutar nada. Los recibos históricos deben seguir resolviendo aunque cambie la fuente actual.

No se reenvían llamadas inciertas o en vuelo ni se libera reserva terminal. Sólo una reserva demostrablemente nunca enviada puede marcarse como tal según el protocolo existente; su historia e importe quedan. La prueba debe demostrar que un Worker viejo no puede enviar después de cambiar permiso/lease.

## Validación y entrega

Una prueba compuesta nueva: Worker real con tres lotes y nueve unidades → primer resultado pagado (4/9) → vencimiento → renovación explícita → sólo lotes pendientes → catálogo/proyección. Incluye pérdida de ACK, repetición, CAS, rechazo por rol/fuente, límites y rollback con proveedor apagado. Todo con transporte simulado y rollback local; no insertar otra carga ficticia en UAT. Pruebas de servicio y componente, typecheck/lint/build y revisión del corte exacto antes de commit focal. No repetir gates de d4cd78e.

La entrega UAT posterior debe instalar SQL0152 una sola vez, comprobar compatibilidad/orden de runtimes y mantener datos/costos. No activar un permiso real como parte de esta tarea. Continúan pendientes la segunda carga real por UI, permiso vigente, derechos cliente, calidad, reportes y MCP. No declarar E2E completo.

Costos conservados: ClaudeUSD1.918865 confirmado+USD1.6818 reserva terminal; VoyageUSD0.594449. Sonnet4.6/noOpus. Cero proveedores nuevos.
