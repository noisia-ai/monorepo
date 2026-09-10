# Continuidad incremental de Topics a Signal — entrega UAT

Estado vigente: Studio y Worker d4cd78e, SQL0148–0151 verificado en UAT el 10 septiembre a las 02:03 UTC. Incluye Menciones nativo ya aceptado. Este documento complementa el Compass y PLAN_COMPLETE_INCREMENTAL_MONITORING_2026-09-09.md; conserva debajo la secuencia histórica de construcción y entrega.

## Resultado que se está cerrando

Después de una carga nueva, el motor numérico existente reutiliza el corpus y sus modelos y registra la actualización. Desde Topics se prepara la evidencia de los grupos nuevos sin llamar a un proveedor. El usuario confirma interpretación con importe y vencimiento explícitos. El mismo Worker guarda la respuesta, los Topics nuevos y su evidencia; conserva los Topics editados, archivados y su selección. El catálogo y su proyección se completan en etapas comprobables, de modo que Signal sólo cambia cuando existe la clasificación persistente correspondiente.

Menciones nativo forma parte de la base y sigue mostrando todas las conversaciones de la generación actual. Los nuevos Topics se guardan editables y sin selección automática. Una edición que cambia su significado no hereda sin más la membresía semántica anterior. Los grupos pendientes de la primera corrida conservan su interpretación y autorización separadas.

## Composición y responsabilidades

Checkout /Users/brandhon_o/Downloads/noisia-incremental-monitoring-completion-2026-09-09, rama codex/noisia-incremental-monitoring-completion-2026-09-09. Base5501a91 conserva el commit UAT1836972 y recompone las entregas locales previas de foundation0148, consumer0149 y resolver070c94e. No se despliega su base histórica anterior ni se toca el checkout con los tres drafts ajenos.

Backend cierra SQL0150 y el productor de evidencia en la cola existente; Import cierra SQL0151 y la entrega de resultados a catálogo/proyección; Frontend conecta el recorrido, confirmación, progreso y recuperación; Root compone admisión y cola en una transacción, estado editorial y recuperación de resultados pagados. No hay framework, cola ni plano de datos nuevo.

## Evidencia local retenida

- Productor real del Worker con stores PG reales y almacenamiento privado local simulado:1/1,5.80s.3raíces/133fragmentos, validación de bytes/SHA/censo, replay sin IO; no engine, grant o llamada nueva. Addendum compuesto Backend conserva los11archivos originales.
- Consumidor real con transporte local simulado → catálogo real → proyección real:1/1,18.38s tras ampliación de disponibilidad.3raíces/133fragmentos,6asociaciones pendientes y0aprobadas. Recibo de catálogo y cambio de job comprobados; edición/archivo preservados y replay sin IO.
- Admisión+outbox atómicos: fallo deINSERT o proveedor deshabilitado revierte dueño/claim/grant/outbox; pérdida deACK y repetición con proveedor apagado no reencolan ni renuevan gasto.
- Estado/retry:1/1PG,11.29s; key histórica prioritaria, actor/job/scope comprobados, incertidumbre bloqueada, recuperación de respuesta ya pagada con grant revocado y proveedor apagado sin gasto nuevo. Revisión independiente sinP0/P1/P2.
- Studio:91pruebas focales previas y33DOM reales localesES/EN; seam deACK histórico añade26servicePASS. Root pidió simplificar los detalles históricos/de costos en un desplegable; cierre visual y checks conjuntos pendientes.

Los recibos privados están bajo .data/workspace-incremental-editorial-preparation-2026-09-09, .data/incremental-editorial-to-signal-2026-09-09, .data/incremental-editorial-status-2026-09-09 e .data/incremental-editorial-ui-2026-09-09 del checkout compuesto. Las fixtures son locales, no datos introducidos en UAT. Estos gates no prueban volumen de millones ni calidad semántica.

## Pendiente antes de entrega

Cerrar lector histórico begin/revoke por key y seam Studio, freeze final, typecheck/lint/suites/build conjuntos y revisión exacta. Después preparar una única migración0148–0151, comprobar invariantes y desplegar el commit focal en ambos runtimes UAT. Todavía no se ha aplicado ninguna de esas cuatro migraciones en UAT.

Renovación del permiso editorial incremental vencido sigue pendiente: existen admisión inicial y revocación, sin CTA de renovación inventado. No afirmar monitoreo remoto completo: faltan segunda carga real por UI, autorización del proveedor vigente, rol cliente y calibración/valor editorial. Reportes/MCP siguen en Compass/Linear y no se sustituyen por controles internos.

Cero proveedores o permisos nuevos. ClaudeUSD1.918865 confirmado+USD1.6818reserva terminal, VoyageUSD0.594449. Sonnet4.6/noOpus. Loop activo en este chat sin renovar la ventana antigua de ocho horas. No producción, reimportaciones, fit repetido ni recuperación de marcas históricas.

## Cierre del código — 10sept01:37UTC

Commit d4cd78e0bbbee30895580a820404f6d5d3e8d46b, checkout limpio;37archivos nuevos y59diferentescontraUAT1836972 incluyendo los22archivos de entregaslocalesprevias. Manifest exacto y recibo de checks en .data/incremental-editorial-release-2026-09-09. Typecheck/lint11/11, DB238PASS87skip, Studio836PASS7skip, Worker641PASS8skip. Los skips no se afirman como PGremoto: los gates PGcompuestos focales sí constan en sus recibos. Build finalPASS73s.33DOMlocalesES/EN y revisionesindependientes sinP0/P1/P2.

La revisión conjunta detectó una incompatibilidad de typing/lint sólo en dos fixturesNextIntl; quedaron en JSXcon.test.tsx ymanifesttestactualizado, sin casts ni reglasdeshabilitadas.17focal/TC/lint/build posterioresPASS; no se repitieron las suites sin causa. Sólo otra líneaenblancoalEOF de fixture nueva se retirótras staging. Runtimecongelado sin alteraciones no revisadas.

UI compacta: importe/vencimiento/acción/progreso yalertasvisibles; historial, gruposheredados ydesglosecostosen detalles cerrado. Reader histórico begin/revoke yflagserver despuésreplay cerrados2/2PG6.806s. PreflightrealreadonlyUAT01:24:19.600: ceroexec/calls/outbox/preparación/embeddings/candidatos/hijosnuméricos/owners/permisos en todosworkspaces; SQL0147presente y0148–0151ausentes. Proveedortruecondeadlineexpirado intacto. Paquetemigracióncon49funciones/13triggers/4columnas se preparaLOCAL para DB→Worker→Studio; aplicación y entrega todavía pendientes. Tresdraftsajenos comparadosbyteidénticos;070c94epreviolocal limpio.

Brecha de renovación de permiso incremental desglosada como [NOI-82](https://linear.app/noisia/issue/NOI-82/ss-e2e-renovar-desde-topics-un-permiso-editorial-incremental-vencido), hija deNOI-78. Desarrollo pendiente después de esta entrega; no autorización de gasto.

## Paquete final revisado

Paquete autocontenido0148–0151 SHA3eac443c3a4c1930c671daa4feb55f79083a768cb2bed2ad0541d8c678213a52, release d4cd78e sellado. EnsayoLOCAL588ms verifica49funciones/13triggers/4columnas y15tablas/ACL intactos bajoROLLBACK; ejercicio deACK deCOMMIT usa savepoints en la misma conexión y comprueba selección de conexión nueva del driver, no concurrencia real. Revisión independienteBackend yRoot sinP0/P1/P2. Destino exacto StudioUAT; modospreflight/apply/verify y antes fsync privado. EnCOMMITincierto sóloverify, nunca reaplicar.

Transferencia por consola tuvo límite32769bytes, antes de ejecutarSQL; se reconectó y transfirió en3tramos menores conSHAfinal comprobado. Preflightremoto sólolectura en curso desdeStudio1836972, ninguna migración aplicada al redactar. AutodeploydeStudio todavía intacto. Recibosprivados PACKAGE_RECEIPT.md, PACKAGE_FREEZE.json y BACKEND_PACKAGE_INDEPENDENT_REVIEW.json en.data/incremental-editorial-release-2026-09-09.

## Instalación UAT — 10 septiembre 01:53 UTC

Preflight real del paquete pasó y la aplicación única terminó con `applied:true`, `verified:true`, sin permisos ni llamadas. Las 15 tablas y ACL mantienen sus huellas previas; SQL0148–0151 queda instalado y no debe repetirse. Recibo completo de 27,912 bytes conservado localmente en `.data/incremental-editorial-release-2026-09-09/uat-0148-0151-migration-receipt.json`, SHA256 `63fa66ee86d5a2bb1dfe85ad3ddce8376f7c9befa9301d3bcdd721b9aaa71cf5`.

Se deshabilitó temporalmente el autodeploy de Studio por UI y se envió el commit limpio `d4cd78e` mediante fast-forward sólo a la rama UAT. Worker se entrega primero; Studio sigue en `1836972`. Pendiente comprobar Worker, restaurar autodeploy y entregar/verificar Studio, luego comprobar el recorrido real sin autorizar proveedor ni simular una nueva carga.

## Resultado entregado y comprobación real — 10 septiembre 02:03 UTC

Worker `31f68d74-2418-4522-8465-36e231432390`, única réplica `f1223406-0118-4aee-a6b0-8fa7914d0189`, activo con `d4cd78e`; arranque recovery y preflight exitosos, Worker anterior retirado. Después se restauró autodeploy Studio y se ejecutó «Deploy latest commit» desde su comando de servicio. Studio `2c074f2a-d8ac-4d19-a207-04904506e749` activo con el mismo commit, una réplica y anterior retirado. Orden DB → Worker → Studio respetado. Ningún cambio de flags, fecha, presupuesto o permisos del proveedor.

Cuatro comprobaciones reales PASS: catálogo de 32 Topics y progreso32/357 con costos previos; Overview7,396recibidas/16archivos/9,131filas y ámbitos reales; ResumenSignal6,826/dosTopicsseleccionados/98 con cobertura parcial; Topics → Ver evidencia → Abrir mención conserva el foco de Madrid, título y URL original en Menciones nativo (1–50 de6,826). La evidencia responde y el enlace original está disponible; no se afirmó precisión semántica. Estas verificaciones no repiten la batería completa de Menciones cerrada en1836972.

Lectura posterior a UI, `2026-09-10T02:03:26.993Z`: ejecuciones/llamadas/outbox/preparaciones/embeddings activos0; hijos numéricos y dueños editoriales incrementales0; operaciones de permisos0. Selección revisión2, generación6,826 y15recibos Claude coinciden con el antes. USD1.918865 confirmado +USD1.6818 reserva terminal y VoyageUSD0.594449 sin gasto nuevo. La fecha de admisión original sigue vencida el9sept06UTC.

Recibos privados: `uat-runtime-release.json`, `uat-ui-smoke.json`, `uat-worker-comparison.json`, `uat-final-receipt.json` y `uat-0148-0151-migration-receipt.json` bajo `.data/incremental-editorial-release-2026-09-09` del checkout compuesto. Código final limpio y publicado sólo en rama UAT. Linear NOI-20/37/78 actualizado, aún In Progress.

## Próximo resultado de producto

1. Cerrar [NOI-82](https://linear.app/noisia/issue/NOI-82/ss-e2e-renovar-desde-topics-un-permiso-editorial-incremental-vencido): una continuación explícita y comprensible desde Topics cuando venza el permiso incremental, reutilizando operación y respuestas guardadas. Sin formularios adicionales ni otro framework. Desarrollar en checkout aislado desde d4cd78e; no equivale a autorizar llamadas reales.
2. Probar la siguiente carga real incorporada por UI y su actualización hasta Signal cuando haya datos y permiso vigente; no duplicar los CSV ni fabricar un hijo UAT para declarar éxito. La integración de este corte pasó con PG/Worker reales y transporte local simulado, pero la segunda carga remota todavía no existe.
3. Completar acceso cliente y calibración/calidad. Reportes con agente y MCP conservan su lugar en el Compass. El producto E2E self-service completo sigue abierto.
