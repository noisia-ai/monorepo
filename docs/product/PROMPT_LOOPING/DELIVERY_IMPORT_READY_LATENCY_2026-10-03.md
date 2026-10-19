# Importación visible antes de diagnósticos — 3 octubre 2026

Este corte complementa el Compass y el hold de calidad del interés definido. No cambia el corpus, la clasificación ni el estado de release.

## Problema y cambio

En Datos y fuentes de Alexa+, el HTML empezaba a llegar rápido, pero la página tardaba unos 21–27 segundos en completar el renderizado. Antes de mostrar el formulario de importación, el servidor esperaba el resumen pesado del corpus, el estado numérico y los diagnósticos de gobernanza. Esto hacía que una marca nueva pareciera bloqueada en el paso de carga aunque el formulario no dependía de esos cálculos.

El commit UAT `2445d02` lee primero la identidad y permisos del workspace. Presenta el gestor de importación mientras el recibo del corpus se resuelve en `Suspense`; la preparación numérica usa su endpoint scoped y la gobernanza avanzada carga sólo cuando se abre su sección. La identidad ligera trae la zona horaria necesaria para el formulario. Los comandos de gobernanza conservan su autorización existente y refrescan el diagnóstico tras guardar. No se modificaron SQL, importaciones, Worker, proveedores ni permisos.

## Verificación

- Studio UAT desplegado: `2445d02`, Railway deployment `e4e41f56-9072-48d4-953e-1cee0f7630eb` ACTIVE. Desde el navegador interno se abrió Datos, se desplegaron los diagnósticos avanzados y se abrió el formulario de importación de marca primaria. No se subió archivo.
- En la primera pasada, el documento de la página pasó de ~21.2 s a ~12.0 s; la primera pintura con contenido, de ~22 s a ~7.9 s. Son mediciones puntuales, no un SLO ni una mejora estadística. La duplicación restante motivó la segunda pasada descrita abajo.
- Recibos visibles de Alexa+ sin cambio: 47,285 menciones únicas, 9 CSV, 43,159 raíces preparadas, 4,126 excluidas y 124,867 fragmentos calculados. El diagnóstico de gobernanza mostró 7/10 preparados al abrirlo.
- Prueba focal del contrato de la página 8/8, typecheck y build Studio PASS; lint sin errores y 13 advertencias preexistentes. La compilación local usó placeholders sólo para validar build; la comprobación real fue en UAT.
- El mismo cambio está en el draft PR #14 como `5da9db7`; la CI de `8ab6ee0` terminó correctamente en [run 37123166921](https://github.com/noisia-ai/monorepo/actions/runs/37123166921). El PR permanece draft y no se entregó a producción.

## Segunda pasada focal: un solo recibo

La captura UAT mostró que la franja superior repetía 47,285 menciones y 9 archivos que ya aparecían en «Datos recibidos». La franja hacía esperar otra consulta de corpus en el renderizado del servidor. `ae70a19` la retiró **sólo de Datos y fuentes**; el recibo inferior conserva archivos, filas, menciones únicas, texto disponible, preparación y exclusiones. La cobertura temporal sigue disponible en Overview. No se cambiaron las consultas de importación ni las rutas de otros módulos.

Con Railway deployment `34d91fb1-f155-40cb-a520-7ab462df474d` ACTIVE, la medición puntual del documento bajó de ~6.26 s antes de este corte a 0.654 s y el primer botón «Importar» quedó visible a los 2.26 s desde recarga. El endpoint de configuración de importación respondió en 0.682 s y el plan en 0.592 s en esa navegación. No son percentiles ni prueba de carga. Desde la UI se abrió el formulario de marca primaria; no se envió CSV. El recibo se cargó después sin bloquear la acción y conservó 9 archivos, 57,334 filas, 47,285 menciones únicas, 43,159 preparadas, 4,126 excluidas y 124,867 fragmentos. Typecheck/lint de 11 paquetes y 15 pruebas focales PASS; lint conserva 13 advertencias preexistentes y cero errores. El cambio está en el draft PR como `f4bb8d9`; su CI nueva debe terminar antes de considerarlo validado para release.

## Siguiente corte de producto

Este cambio facilita llegar al formulario; **no** certifica que una marca nueva pueda completar el recorrido ni la segunda carga incremental. El interés V2 de Alexa+ sigue retenido por falsos positivos y el proveedor está apagado; V3 no está validado. Tras resolver el bloqueo del proveedor y la calidad, cerrar un interés con membresías verificadas en Signal y luego probar otra marca y dos cargas reales desde la UI. No reanudar V2 ni publicar sus membresías por esta mejora de importación.
