# Enlace de evidencia de intereses a menciones — LOCAL

24 septiembre 2026. Continúa el Compass y las entregas de preparación y recuperación de intereses; no sustituye sus recibos.

El resultado editorial de un par grupo/interés ahora puede enlazar cada `ref_id` citado con la raíz y el fragmento exactos del dossier sellado. El enlace conserva grupo, interés, revisión de definición, digests, disposición, justificación y todas las citas. Si varias citas o grupos señalan la misma raíz e interés, se conserva una sola entrada con todas sus observaciones. Una decisión insuficiente sin cita permanece a nivel grupo: no se inventa una raíz.

Este objeto es **evidencia candidata**, no una asignación. `supports` valida fragmentos representativos y jamás adjudica todas las raíces del grupo; `mixed` e `insufficient` quedan sin resolver. El contrato declara `approval_policy: none` y `membership_effect: none`. El binder vuelve a validar el snapshot de revisión y la matriz completa de respuestas antes de producirlo; digests por sí solos no autentican un snapshot suministrado por un cliente.

Archivos: `packages/query-engine/src/signal-topic-interest-evidence-candidates-v1.ts`, prueba focal homónima y export de `index.ts`. Las tres pruebas focales, los 512 tests del paquete, typecheck del paquete y `git diff --check` pasaron. Sin SQL, proveedores, importaciones ni cambios UAT. La entrega Signal desde importación queda separada y ya está documentada en `DELIVERY_SIGNAL_IMPORTED_UAT_2026-09-24.md` del checkout de entrega.

Para convertir esto en clasificación persistente falta recuperar cada raíz canónica vigente y comprobar fingerprint, fragmentos, ámbito y derechos; tomar una decisión por raíz sobre todo el corpus elegible; registrar versión, evidencia y resultado mediante el escritor paginado existente; y extender con guardas de vigencia/autoridad la selección y lectura de Signal. Las citas del dossier abarcan como máximo diez fragmentos representativos por grupo y no proporcionan un censo completo. La preparación SQL0183 tuvo aceptación sintética con rollback en dev-test, pero aún no está instalada en UAT ni tiene admisión pagada/checkpoints PostgreSQL. No se habilitó un botón de ejecución ni se renovó autoridad de proveedor.

Consolidación/ranking de Alexa+ y la segunda carga real siguen pendientes. La última cifra de interpretación editorial fue 2/42 lotes; no se reanudaron envíos. El loop programado permanece pausado por petición del operador.
