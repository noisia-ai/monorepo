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
