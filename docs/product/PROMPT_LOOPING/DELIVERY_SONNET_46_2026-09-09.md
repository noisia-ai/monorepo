# Sonnet 4.6 para interpretación de Topics

9 septiembre UTC / 8 septiembre México de 2026. Estado: comprobación local en cierre; aún no desplegado.

El operador pidió Sonnet 4.6 y ninguna nueva llamada Opus. Sonnet 5 queda como una opción posterior, sin activación. El cambio sigue la entrega Topics → clasificación → selección individual → Signal; no reinicia el corpus ni el proyecto.

## Estado real previo al cambio

UAT Studio/Worker ejecutan 99b2b58 y SQL0142. Worker deshabilitado para nuevas interpretaciones, confirmado en el despliegue ec6e6773-44c9-4946-8e04-39261b8954ab. La misma ejecución 4c55af5c-e17f-430a-b17d-6771e94bd30e falló en dispatch 5 con workspace_engine_interpretation_repair_invalid. Conserva 6,826 raíces, 20,821 fragmentos, 357 grupos y 15 artefactos numéricos; cuatro interpretaciones válidas y cero Topics materializados.

La respuesta y reparación del segundo lote llegaron completas, pero contenían identificadores de citas alterados. La reparación además omitió citas generales en un grupo mixto. No se aceptaron. Las cuatro interpretaciones previas permanecen verificadas. Su coherencia no acredita relevancia para National.

Claude confirmado USD 1.042910, reserva terminal USD 1.6818, exposición USD 2.724710. Sin llamadas en vuelo al cierre de Opus. Voyage USD 0.594449 intacto. Sonnet nuevo USD 0.

## Implementación

Perfil claude-sonnet-4-6 con tarifas propias, citas cortas por grupo y resolución exacta a evidencia canónica. Opus se conserva para lectura histórica; el adaptador impide enviarlo. Configuración Sonnet SHA d23b144f358208094d423473d01dcbbdf08f7a43096f45db291c9266ff7a27b9.

SQL0143 y la operación interna de revisión permiten continuar la misma ejecución, conservar los cuatro grupos interpretados y procesar sólo los pendientes. No renuevan actor, derechos, topes o fecha; no liberan la reserva terminal. [Decisión de arquitectura](../../adr/029-workspace-interpretation-model-revision.md).

Tarifas consultadas en [documentación oficial de Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview): USD 3 por millón de tokens de entrada y USD 15 de salida, con tarifas de caché separadas.

## Validación y siguiente resultado

Shared: 10 pruebas focales y 439 pruebas del paquete correctas. Workers: 61 focales, 355 correctas y 5 omitidas en el paquete. Typecheck y lint de raíz: 11/11 tareas correctas; advertencias anteriores de lint sin errores. PG local comprobó materialización real con una respuesta histórica y otra Sonnet, recuperación y contabilidad conservada. Revisión independiente, negativos PG finales, DB suite y build en cierre.

Siguiente: cerrar la entrega focal, verificar UAT y continuar sólo con Sonnet dentro del permiso vigente. No afirmar catálogo ni Signal completos antes de su prueba real. El tope de Claude es USD 30 sólo el 8 septiembre America/Mexico_City; nuevas admisiones terminan a 2026-09-09T06:00:00.000Z. El loop no renueva ese permiso.

Después del primer recorrido siguen la actualización automática por nuevas cargas y la detección de temas emergentes, además de la publicación parcial con excepciones y la eliminación de recuperación manual. El Compass y Linear conservan esos pendientes.

## Corte local cerrado — 9 septiembre 05:37 UTC

Revisión independiente de perfiles, aliases, SQL y Worker: cero P0/P1/P2 pendientes. Los 9 lotes y 9 reparaciones históricas reconstruidos mantienen exactamente sus bytes, y 43 comparaciones de costo conservan las tarifas anteriores. Se rechazaron 240 alteraciones de configuración y 27 variantes de citas inválidas; el JSON bruto no cambia.

DB: 231 pruebas correctas, 68 omitidas; PG focal ejecutado por separado con rollback, incluyendo materializador real de perfiles mixtos. Build Studio correcto. Typecheck, lint y diff-check completos. Los tres archivos ajenos de contract-drafts conservan sus SHA previos y quedan fuera del commit. SQL0143 SHA fbb95fb6e36f1ff7c50ed58a94debfec34b70a6373f6754290c88364a962a627. Proveedor UAT sigue deshabilitado; Sonnet pagado cero.

## SQL0143 aplicado y verificado en UAT — 9 septiembre 05:41 UTC

Commit focal 948d781e3022bf4e5283093c534d305583ccbd0c. SQL aplicado a las 05:41:13.249 UTC y verificado por una segunda lectura. Seis funciones y cinco triggers correctos. Los SHA de las 67 filas globales del ledger, la ejecución y sus 16 artefactos permanecen idénticos. No se creó revisión ni llamada. Recibo privado: uat-0143-migration-receipt.json. Código en entrega; verificar ambos servicios antes de continuar.

## Código Sonnet activo en ambos servicios

Studio 322d3a80-89a6-4da7-be5a-0784459126f4 y Worker bdb66902-b4a3-412a-8472-ea3e282eb08d confirmaron el commit completo 948d781. El Worker importó el perfil desde el código instalado: claude-sonnet-4-6, proveedor todavía false y vencimiento 06:00 UTC. Tras comprobar ambos, se desplegó una sola variable para activar el proveedor. Su nuevo runtime aún se verifica; la revisión editorial de la ejecución no se ha solicitado.

## Continuidad real con Sonnet — 9 septiembre 05:49 UTC

Worker 0199a503-536f-4b9a-b213-eb788f694177 verificado: mismo commit 948d781, proveedor true, vencimiento 06:00 UTC. La operación acotada de revisión fue aceptada una vez a las 05:49:27.197 UTC: misma ejecución, dispatch 6 queued, perfil claude-sonnet-4-6, revisión SHA 19df65a6cb5ffccf5e7a611234dc2c3d3302aba3bf027e942bea0edb09481e15. Snapshot, fit, cinco recibos antiguos y cada artefacto previo permanecen idénticos. Continúan las cuatro unidades válidas. No hay gasto nuevo al momento de este recibo; seguir esta ejecución, no volver a pedir revisión ni iniciar otro análisis. Recibo privado uat-sonnet-revision-receipt.json.

## Interpretación real comprobada — 9 septiembre 05:58 UTC

La misma ejecución alcanza 24 de 357 unidades interpretadas: cuatro previas y veinte nuevas con Sonnet; seis artefactos de interpretación privados. Cero Topics materializados todavía: la política actual exige completar todas las unidades. Primer artefacto Sonnet validado por descarga privada y SHA b60f3a20fac30046a493eb840bd1bbf6e325f256dbbe2e2bb7b06db10e9c45a5; cuatro grupos con 7, 9, 9 y 9 citas. Dos se marcaron mixed y dos coherent. Sus temas incluyen viajes, usos coloquiales de una palabra, tarjetas hoteleras y publicaciones bursátiles. No se fuerza relevancia para National ni se interpreta coherent como autorización para Signal. No hay comparación controlada con Opus.

A las 05:58:33.196 UTC: Claude confirmado USD 1.738406 (Sonnet nuevo USD 0.695496), reserva terminal USD 1.6818 y llamada Sonnet en vuelo con reserva USD 0.870048. Exposición total USD 4.290254. La admisión vence a las 06:00 UTC; no interrumpir una respuesta ya enviada ni iniciar nuevas fuera del permiso. Recibo privado uat-sonnet-valid-interpretations.json; consultar evidencia posterior antes de actuar.

## Cierre del permiso diario y saldo final — 9 septiembre 06:03 UTC

Sonnet produjo 28 unidades válidas adicionales. Total conservado: 32 de 357 unidades, ocho artefactos de interpretación, 15 artefactos numéricos y cero Topics materializados. Diez llamadas Sonnet settled, costo confirmado USD 0.875955; sin reservas Sonnet ni respuestas inciertas. Claude agregado USD 1.918865 confirmado + USD 1.6818 de reserva terminal histórica = exposición USD 3.600665. Cero envíos después de las 06:00 UTC, comprobado por lectura separada.

La ejecución terminó a las 06:00:03.073 UTC con el error genérico workspace_engine_worker_failed. Coincide con el vencimiento de admisión y la guardia SQL bloquea nuevas reservas fuera del permiso; el código genérico no identifica por sí mismo el motivo, y esa presentación debe corregirse. No reanudar por un error genérico ni intentar otro análisis: no existe autorización de gasto para el 9 septiembre. El proveedor permanece true pero su admisión está vencida; no hay llamadas en vuelo que interrumpir.

Sonnet 4.6 queda como modelo del producto y Opus está bloqueado para nuevos envíos. El loop permanece activo para trabajo sin proveedor. Pendientes: renovación explícita de permiso fechado y recuperación de esta misma ejecución con evidencia intacta; completar interpretación, catálogo, clasificación, selección y Signal; luego incremental automático. La revisión editorial es inmutable, por lo que un permiso futuro necesita una continuidad de admisión autorizada, no reescribir la revisión ni eludirla con un análisis nuevo. Recibo privado: uat-sonnet-daily-close-receipt.json.
