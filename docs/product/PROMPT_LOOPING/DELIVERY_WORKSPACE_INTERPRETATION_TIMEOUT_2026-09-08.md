# Tiempo de espera de interpretación y recibo incierto

Fecha operativa:8sept2026, America/Mexico_City. Base9f5bc83.

La reparación real e8a1641b-7807-4629-8f57-ed72fbc3230e se envió a02:32:48.025UTC y terminó con error a02:34:48.471UTC: el transporte imponía120segundos. No llegó respuesta HTTP ni request-id; no existe recibo que permita confirmar el resultado o costo. ConservaUSD1.6818como reserva incierta. El recibo anterior continúa settledUSD0.147415. Exposición totalUSD1.829215; saldo después de exposiciónUSD28.170785delpermisoUSD30sólo8septMéxico. VoyageUSD0.594449intacto.

Se eleva a600000ms el timeout por defecto/máximo para futuras solicitudes, alineado con el SDK oficial de Anthropic. No cambia el modelo, la configuración, el cuerpo ni el digest de peticiones existentes. Un timeout propio se distingue de un fallo genérico de red mediante un código seguro; ambos permanecen desconocidos y no generan retry. Si hay bytes parciales, se conservan antes de reportar incertidumbre.

El cambio no recupera una respuesta perdida, liquida su reserva ni habilita repetirla. La consola de Claude requiere login del operador; se solicitó para buscar evidencia de conciliación. El análisis actual sigue fallido, con357grupos/15artefactos numéricos,0interpretacionesválidas y0Topics. Catálogo→clasificación→selección→Signal sigue pendiente.

Los tests usan un reloj inyectado: comprueban el límite sin esperar10minutos,1CAS/1send/0recibos cuando falla antes de HTTP, conservación de parcial, parámetros inválidos antes de CAS y códigos sin secretos. Source/budget/SQL0141 no cambian. Checks y despliegue se añaden al cierre.

Este ajuste evita nuestro corte prematuro; no garantiza que una conexión de red permanezca abierta10minutos. Streaming con recibos durables o Message Batches con recuperación porID es una evolución pendiente para operación masiva. Una publicación parcial con excepciones editoriales explícitas también permanece pendiente; no se afirma productoE2Ecompleto.

Referencias oficiales consultadas9sept2026UTC: [Python SDK — timeout por defecto](https://platform.claude.com/docs/en/api/sdks/python), [Long requests — límites de conexiones y streaming/Batch](https://platform.claude.com/docs/en/api/errors).

## Cierre local

Typecheck/lint raíz:11/11 tareas correctas; lint conserva13warnings previos y0errores. Provider14/14; Worker327PASS/5SKIP. Revisión focal de Root confirma la misma petición/CAS/validación, deadline por llamada y cancelación del timer al terminar. No cambios SQL ni nuevos proveedores. Tres archivos contract-drafts ajenos permanecen fuera del commit.
