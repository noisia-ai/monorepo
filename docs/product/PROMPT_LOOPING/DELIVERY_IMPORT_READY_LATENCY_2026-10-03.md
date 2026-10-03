# Importación visible antes de diagnósticos — 3 octubre 2026

Este corte complementa el Compass y el hold de calidad del interés definido. No cambia el corpus, la clasificación ni el estado de release.

## Problema y cambio

En Datos y fuentes de Alexa+, el HTML empezaba a llegar rápido, pero la página tardaba unos 21–27 segundos en completar el renderizado. Antes de mostrar el formulario de importación, el servidor esperaba el resumen pesado del corpus, el estado numérico y los diagnósticos de gobernanza. Esto hacía que una marca nueva pareciera bloqueada en el paso de carga aunque el formulario no dependía de esos cálculos.

El commit UAT `2445d02` lee primero la identidad y permisos del workspace. Presenta el gestor de importación mientras el recibo del corpus se resuelve en `Suspense`; la preparación numérica usa su endpoint scoped y la gobernanza avanzada carga sólo cuando se abre su sección. La identidad ligera trae la zona horaria necesaria para el formulario. Los comandos de gobernanza conservan su autorización existente y refrescan el diagnóstico tras guardar. No se modificaron SQL, importaciones, Worker, proveedores ni permisos.

## Verificación

- Studio UAT desplegado: `2445d02`, Railway deployment `e4e41f56-9072-48d4-953e-1cee0f7630eb` ACTIVE. Desde el navegador interno se abrió Datos, se desplegaron los diagnósticos avanzados y se abrió el formulario de importación de marca primaria. No se subió archivo.
- En esta sesión, el documento de la página pasó de ~21.2 s a ~12.0 s; la primera pintura con contenido, de ~22 s a ~7.9 s. Son mediciones puntuales, no un SLO ni una mejora estadística. La pantalla sigue lenta y requiere una investigación de rendimiento separada si afecta una marca nueva.
- Recibos visibles de Alexa+ sin cambio: 47,285 menciones únicas, 9 CSV, 43,159 raíces preparadas, 4,126 excluidas y 124,867 fragmentos calculados. El diagnóstico de gobernanza mostró 7/10 preparados al abrirlo.
- Prueba focal del contrato de la página 8/8, typecheck y build Studio PASS; lint sin errores y 13 advertencias preexistentes. La compilación local usó placeholders sólo para validar build; la comprobación real fue en UAT.
- El mismo cambio está en el draft PR #14 como `5da9db7`; verificar la CI de ese commit. El PR permanece draft y no se entregó a producción.

## Siguiente corte de producto

Este cambio facilita llegar al formulario; **no** certifica que una marca nueva pueda completar el recorrido ni la segunda carga incremental. El interés V2 de Alexa+ sigue retenido por falsos positivos y el proveedor está apagado; V3 no está validado. Tras resolver el bloqueo del proveedor y la calidad, cerrar un interés con membresías verificadas en Signal y luego probar otra marca y dos cargas reales desde la UI. No reanudar V2 ni publicar sus membresías por esta mejora de importación.
