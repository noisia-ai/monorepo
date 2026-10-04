# MFP · Recibo del programa · 4 octubre 2026

Corte observado: **17:00 UTC**. Canon: `SPEC_FICHA_Y_PERTENENCIA_2026-10-04.md` **v1.3**, preservado con los accesos antes de delegar. Este recibo distingue código integrado, ejecución real remota y aceptación pendiente. No acredita producción ni sustituye la evaluación humana.

## Resultado demostrable

Las funciones reales de producto permiten importar dos cargas, generar fichas, descubrir propuestas, adoptar dos conceptos editables y consultar pertenencias con citas en Signal. La segunda carga conserva lo ya procesado y recalcula los pares afectados por una edición de concepto. Estas operaciones se ejecutaron en el runner privado: **todavía no se ha acreditado el recorrido por UI autenticada**.

- **WS0:** 110 documentos históricos preservados e inventariados, con copias verificadas; originales intactos. Spec y accesos versionados. Sin reactivar planes ni automatizaciones históricas.
- **WS1:** PostgreSQL lógico `noisia_mfp`, Redis, runner y Studio dedicados en Railway dev-test; datos por conexiones privadas. PR28 añade revisión explícita de contenido por identidad de fuente, con historia y publicación atómica; sigue en prueba, SQL0241 no instalada.
- **WS2:** primera carga con 905 estados Claude: 831 `labeled`, 74 `abstained`. Cambio de alias afectó 58 raíces y dejó 847 intactas; restauración posterior de 63 desde caché, sin proveedor. En la segunda carga se procesaron 181 raíces nuevas y se recuperaron selectivamente dos errores de formato. La admisión numérica posterior verificó que no quedaban fichas pendientes. Etiquetador experimental, no aprobado.
- **WS3:** JEV completó 905 estados: 898 `labeled`, 7 `abstained`, cero errores pendientes; 915 llamadas contando recuperación. Condiciones oficiales y restricciones documentadas en `JEV_DUE_DILIGENCE.md`. Acuerdo de relevancia Claude–JEV: 686/905 (75.8%); monitor sin gold, no precisión ni prueba de superioridad.
- **WS4:** evaluador offline integrado por PR29, `fccc2fc23daed4135465ec1e0ebada852b7c6c8a`. CI completo 37217875023 y 14 pruebas focales aprobados. CLI con la selección privada fija produjo `no_evaluado`; gold humano de 150 raíces, split 90 dev/60 test, todavía pendiente. No hay evaluación semántica aprobada.
- **WS5:** pertenencia real inicial de 122 pares: 4 `belongs`, 118 `not_belongs`, sin errores pendientes. Replay completo desde caché, cero llamadas. Edición de un concepto invalidó sólo sus 61 pares; el otro concepto y 905 fichas permanecieron intactos. Detalle de segunda carga abajo.
- **WS6:** discovery real inicial sobre 374 relevantes y 1,259 fragmentos; 11 grupos interpretados, consolidados en 2 Topics, 7 Noise y 2 insufficient. Dos propuestas adoptadas como conceptos; la pertenencia se calculó por separado con evidencia, no por similitud vectorial.
- **WS7:** UI y contratos integrados; consulta real de Signal con denominador 1,086 y 4 menciones asignadas, base `concept_membership`, evidencia navegable. Falta QA de navegador bilingüe y del fundador.
- **WS8:** segunda carga y cálculo incremental numérico reales completados. La preparación editorial posterior informa `source_stale`; diagnóstico focal en curso, sin repetir el fit. No se declara terminado el análisis incremental ni E2E.

## Segunda carga y vigencia

Primera carga: 1,000 filas recibidas, 977 únicas, 905 elegibles, 72 excluidas, 23 duplicados; 3,158 fragmentos. Segunda carga: 250 filas recibidas, 181 incluidas nuevas, 18 excluidas nuevas y 51 duplicadas. Preparación acumulada: 1,176 raíces, 1,086 elegibles, 90 excluidas y 3,634 fragmentos. Reutilizó 931 raíces, incorporó 199 y detectó 46 cambios de procedencia; estos últimos no eran cambios de texto. Voyage generó 475 fragmentos nuevos y reutilizó 3,159, coste USD0.013297.

El CSV contiene 20 ediciones de identidades existentes que el comportamiento append-only conservó como duplicados. **Esas ediciones aún no están publicadas.** PR28 introduce la opción explícita para corregir contenido sin borrar historia ni servir etiquetas obsoletas. Sus pruebas usan PostgreSQL real y rollback; no se debilitaron permisos ni triggers para hacer pasar las fixtures.

Antes de la segunda carga se editó la inclusión del concepto de upsell. La corrida `38f3f7f2-eea3-48cc-9637-162ae263c17c` terminó a las **16:20:34 UTC**: 73 pares procesados (61 por edición y 12 de raíces nuevas), USD0.419499 liquidados, cero reservas, errores o pendientes. Estado acumulado: 134 decisiones, 4 `belongs`, 1 `insufficient`, 129 `not_belongs`. La estimación para repetir sin cambios es cero. El concepto editado fue seleccionado en su revisión 2.

Signal observado a las **16:25 UTC**: fuente vigente, denominador 1,086, cuatro menciones únicas asignadas; una en el concepto de viajes y tres en el de upsell, ambas con base `concept_membership`. Calidad `not_calibrated`. Selección y evidencia verificadas por funciones de producto, no mediante sesión UI.

Incremental numérico `29495512-9517-4a9b-b9fc-a119ff93ca11`: admitido a las 16:47:06 UTC, **READY a las 16:50:16 UTC**, 456 raíces relevantes, 1,449 fragmentos y dos componentes. Modo `frozen-model-delta`, reutilizando el modelo del fit original `7033cd67-8b6d-482c-ac37-085aefd0cfe1`. `numeric_complete=true`, `analysis_complete=false`, outbox de ejecución completado; sin nuevo fit completo ni llamadas de proveedor. El estado editorial a las 16:57 UTC rechaza su fuente como obsoleta; se conserva el resultado para diagnosticar la comparación exacta y continuar de forma recuperable.

## Recuperación WS6 integrada

PR24 → `develop` **6daf32e20088e2920cccd6aebace36e6cc1eaaa0**. CI final37212055173 sobre56e99bf completo: tipos, lint, suites, build y gates. Revisión independiente sin P1/P2 pendientes. PG con Worker y artifacts reales pasó dos escenarios en265.724s:905 raíces,374 selladas,531 fuera, corrección humana exterior preservada, cambio de relevancia antes de página y antes del INSERT rechazado, serving obsoleto e inmutabilidad comprobados. Páginas200/200/200/200/105; escrituras3.78–4.30s. Todas las mutaciones de prueba se revirtieron.

SQL0240 aplicada **una sola vez** en MFP a15:20:47.794Z, historial224→225; SHA256 `4b09d48eea1c4ad883f43be7583bb263ae61188e5676ea2933fc5628c5f2630f`. Corrige el escaneo global por fila mediante validación por sentencia, conservando identidad/evidencia por fila y vigencia global. No modificar ni repetir migraciones instaladas.

Ejecución original de proyección `e85a236c-3080-4f12-821e-c1d8263d101e` quedó **READY15:22:50.033Z**,905/905 raíces,3,158 fragmentos,343 asignaciones,118.976s. Reutilizó fit y artifacts; cero proveedor. Snapshot `957fb789-a587-4aa0-a676-47f9bc127f5f` preparado15:23:18.502Z,denominador905,fuente vigente,dos candidatos,activación pendiente. No confundir snapshot preparado, adopción y selección. El checkout WS6 fue archivado conservando Git y sus ramas se retiraron conforme§7.

## Código, infraestructura y coste

PR25 integrado en `00b6e3f9`, PR27 en `61006bca`, PR26 en `18f2b0ae` y PR29 en `fccc2fc2`, todos con CI completo. Las pruebas de proveedor y PostgreSQL están identificadas por separado en sus recibos. PR28 permanece abierto.

Studio y runner dev-test ejecutan imágenes **18f2b0ae** verificadas; Studio devuelve HTTP200. Runner general desactivado y trabajos finitos ya terminados. Se prepararon variables privadas mínimas de Claude/Voyage y flags por servicio con `--skip-deploys`, sin reiniciar: esa configuración todavía no está activa en las imágenes existentes. La activación persistente queda posterior a las pruebas y al censo de trabajos. UAT y producción no se modificaron.

SQL0237 y SQL0238 se instalaron una sola vez a las **15:47:57 UTC**, historial 225→227, después de los ensayos con rollback. SQL0240 ya estaba instalada según el recibo anterior. SQL0241 sólo se ha ensayado dentro de transacciones revertidas; no figura instalada. No repetir las migraciones cerradas.

Coste conocido acumulado de proveedores: **USD6.928751684**. Incluye discovery USD0.410444; pertenencia inicial/preview USD0.607159; segunda carga de fichas USD0.584245, recuperaciones USD0.022075, Voyage USD0.013297 y pertenencia USD0.419499. Uso de algunas solicitudes históricas rechazadas de formato no fue informado por el proveedor: se conserva como desconocido, no como cero. No quedan reservas en las corridas aquí cerradas. Presupuestos orientativos, sin máximo estricto configurado para MFP; se actualizan las estimaciones al admitir cada ejecución.

Railway observado a las 15:10 UTC: servicios dedicados MFP USD0.069597942 (runner 0.044080049, Studio 0.022465134, Redis 0.003052759); PostgreSQL compartido USD0.257477397 sin atribución exclusiva. Es una observación anterior, no el coste final del corte. No sumar gasto UAT al programa.

## Pendientes concretos

Finalizar y verificar revisión de texto por identidad de fuente; resolver el rechazo editorial incremental; activar y comprobar el Worker persistente; completar la entrada autenticada de una marca nueva, cambios de Brand OS, ambas cargas y Signal. El callback/logout exacto de Studio dev-test en Kinde sigue pendiente de la confirmación específica solicitada por el control del navegador; a las 16:39 UTC seguía devolviendo `Invalid callback URL`. No faltan claves ni autorización genérica para el programa.

Gold humano, conceptos de evaluación y QA del fundador siguen pendientes. Las fechas de ingeniería del spec son estimaciones de alcance; estas pruebas no permiten prometer una fecha de aceptación integral. Las entregas parciales coherentes en UAT están permitidas cuando sean verificadas y recuperables; este recibo no acredita aún una entrega UAT del recorrido completo.
