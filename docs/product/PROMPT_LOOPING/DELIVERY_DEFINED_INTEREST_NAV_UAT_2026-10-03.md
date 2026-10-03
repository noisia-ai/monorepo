# Intereses definidos visibles en Topics — 3 octubre 2026

Este corte complementa el Compass y `QUALITY_HOLD_DEFINED_INTEREST_2026-10-03.md`; no cambia la clasificación ni cierra el recorrido E2E.

## Resultado para el usuario

En una marca con consolidación activa, Topics coloca primero los intereses creados por el usuario. Los resultados parciales anteriores permanecen disponibles en una sección plegable y en la búsqueda. El enlace «Ir a tus intereses definidos» lleva al editor. Al entrar, el editor abre el primer interés manual activo. El estado «Búsqueda terminada · clasificación pendiente» permanece visible: los candidatos de similitud no son membresías aprobadas.

Alexa+ expuso el problema real: 36 resultados parciales ocupaban la lista antes del único interés definido «Activación no solicitada y consentimiento de Alexa+». El cambio se aplica a cualquier marca con intereses manuales y catálogo consolidado; no usa IDs de Alexa+.

## Entrega y aceptación

- Código UAT `453c94a` y ajuste visual `2e9bd62`, checkout limpio; Studio Railway deployment `e035bbff-1b7e-440b-a62f-416a5272fb97` ACTIVE. Worker sin cambio.
- UI real en [Topics de Alexa+](https://studio-uat-uat.up.railway.app/signal/alexa-plus-e2e-2026-09-12/manage/topics#defined-interests): encabezado de intereses definidos con cuenta 1, interés primero y seleccionado, 36 resultados parciales plegados. Al abrir la sección histórica apareció «Acceso anticipado a Alexa+»; se volvió a plegar. El título y la etiqueta de estado del interés quedaron legibles en la segunda pasada.
- La tarjeta consolidada seguía mostrando 42 Topics, 17 Narrativas y 17 conceptos seleccionados; no se alteró la selección. No se modificaron datos, SQL, permisos, importaciones ni proveedores. Esta comprobación no repitió QA de Signal ni acredita membresías del interés.
- Typecheck y lint de los 11 paquetes PASS antes del ajuste visual; después, typecheck/lint Studio y 16 pruebas focales PASS. Lint Studio conservó 13 advertencias preexistentes y cero errores. El ajuste CSS final pasó `git diff --check` y build Railway.
- Los mismos cambios se integraron al draft [PR #14](https://github.com/noisia-ai/monorepo/pull/14) como `4c67e63` y `d084d85`. No se fusionó ni se entregó a producción.

## Límite y siguiente paso

Claude Console aún mostró USD 1.24 impagos; no se llamó al proveedor ni se reanudó V2. V2 conserva falsos positivos y sus membresías siguen retenidas. V3 continúa local sin evaluación de calidad con proveedor. El siguiente corte de producto es cerrar **un** interés con evidencia calibrada sobre el corpus, membresías persistentes y selección reversible visible en Signal junto al descubrimiento; después probar otra marca con varios intereses y una segunda carga real desde la UI. No extender la afinación de Alexa+ indefinidamente.
