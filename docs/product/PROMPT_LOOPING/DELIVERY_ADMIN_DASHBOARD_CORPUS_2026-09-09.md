# Dashboard coherente con el corpus recibido

9 septiembre 2026, 12:32 UTC. Corte focal `d97ada457370c435fb6492a517fbc36a1d711cf8`, enviado sólo a rama UAT; runtime pendiente de verificar.

Dashboard usa el mismo resumen autorizado de corpus que Marcas y Overview. Muestra las menciones únicas recibidas, archivos, cobertura observada y problemas de recepción; no confunde la ausencia de una población clasificada con cero menciones importadas. Los totales son suma por workspace, sin afirmar deduplicación global entre marcas. Un resumen no disponible o parcial conserva esa incertidumbre en lugar de fabricar ceros. No añade consultas por marca: reutiliza dos consultas batch existentes.

8 archivos propios. Typecheck/lint11/11; Studio784PASS6SKIP, build86.585s; DB/Worker no cambiados conservan sus recibos. Siete pruebas focales y12 interacciones de componente real ES390/EN1280, revisión independiente sin P0/P1/P2. Mensajes de permiso y recuperación de la entrega anterior conservados en la composición. Sin SQL, proveedores ni cambios a los tres drafts ajenos.

Falta verificar el runtime y Dashboard real después del despliegue. El corte no completa interpretación, nueva carga ni monitoreo automático de extremo a extremo.

Evidencia privada focal `.data/dashboard-corpus-2026-09-09/check-receipt.json`, `cut-files.json`, logs y recibos UAT posteriores.

## Runtime y recorrido reales comprobados — 12:39 UTC

Studio `5dc740fe-bfa8-4836-b9d8-319a51acee46` y Worker `73d2340e-b61c-4753-b5da-74cec981e0af` ejecutan `d97ada4`. Dashboard muestra National con7,396menciones/16archivos, y su enlace abre Overview con los mismos conteos y9,131filas originales. Dashboard agrega170,049menciones por workspace/53archivosmedidos/223,944filas y señala2marcas con recepción parcial o no disponible; no se interpreta como corpus global deduplicado o completamente analizado.

Overview distingue recepción, análisis interrumpido32/357 y selección para Signal. Navegación Dashboard→National→Topics comprobada. No se recuperaron ni modificaron marcas históricas al leer el listado. SQL0147, selección y costos siguen intactos, cero llamadas o permisos nuevos. Evidencia privada: uat-delivery-receipt.json, recibos de runtime y uat-dashboard-ui.txt.

Observación no bloqueante conservada: la tabla de fuentes de Overview todavía muestra el Scope del conector general como no disponible; no resume allí los ámbitos asignados a cada CSV. La recepción y el cómputo por import permanecen separados. Se debe mejorar ese resumen como parte de coherencia de datos, sin reinterpretar archivos ni reimportarlos.
