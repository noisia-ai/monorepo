# Menciones nativo de Signal — entrega UAT aceptada

## Resultado de producto

La lista global de Menciones usa la misma generación vigente que Resumen y Topics. Incluye las conversaciones sin tópico seleccionado o asignado, con filtros reales de fecha UTC, búsqueda literal, plataformas y orden de publicación. Las citas de Topics abren su mención en esta lista. El drawer muestra un fragmento de hasta2.000 caracteres y un enlace original válido; no lo presenta como texto completo o enriquecimiento semántico.

Las conversaciones incluidas en métricas, las que tienen texto visible y el resultado filtrado son cifras distintas. La selección de Topics no reduce la lista global. Un cambio de derechos o de generación retira evidencia previa y exige una lectura actual. Los controles antiguos que no tienen datos nativos respaldados no aparecen.

## Estado al redactar

Commit focal `8fdf94e992d204000ccc4ff979c9ad60d3f8c360`, 19 archivos, checkout limpio. Studio y Worker UAT activos; SQL0147 intacto, sin migración nueva. Checks y revisión cerrados: typecheck/lint 11/11, DB 238 PASS / 82 skip, PG focal 2/2, Studio 812 PASS / 7 skip, UI 9/9 y 33 comprobaciones DOM locales. Build con configuración local de compilación PASS. Los skips no representan pruebas remotas realizadas. Primeros intentos de suite/build requirieron configurar placeholders locales (DB/Kinde), no arreglos de producto ni credenciales reales.

QA UAT confirmó Resumen → Menciones, 6,826 conversaciones en métricas y con texto disponible, página 1–50 y 51–100, retorno a 1–50. **P2 pendiente de rendimiento:** el retorno aún estaba cargando a los 24.161 segundos observados; había terminado al observarlo a los 98.988 segundos. Son cotas de observación, no una medición exacta de latencia. Root/Backend diagnostican el lector con evidencia real antes de cerrar aceptación. Búsqueda/plataforma/foco y su verificación final quedan pendientes.

Diagnóstico causal posterior READ ONLY, 10 septiembre00:33–00:40UTC: el lector real tardó39.202s (resumen18.739s, página19.873s); JIT ya estaba deshabilitado. EXPLAIN encontró cardinalidad de workspace estimada1 frentea7,396 y nestedloops de7,396×7,396 sobre derechos y3,704×6,826 probes sobre menciones. La comparación con `SET LOCAL enable_nestloop=off` sólo para sus dosSELECT redujo las lecturas a1.168s/1.092s/1.085s para primera/siguiente/retorno, conservando scope, generación,6,826conteos y offsets0/50/0. No se aplicó ANALYZE, SQLdeproducto ni cambios de datos. Corrección focal local en pruebas; aceptación UAT pendiente de su despliegue. Recibos privados `uat-mentions-profile-default.json` y `uat-mentions-profile-no-nestloop-compact.json` en `.data/signal-mentions-native-2026-09-09` del checkout Menciones.

Worker ae0e9bc9-73b0-4258-b08f-657890a4b12a y Studio 3177dc6b-2b2a-4d6f-ba12-daa509d7995a. Recibo READ ONLY a 2026-09-10T00:20:20.518Z: cero ejecuciones, llamadas y outbox activos; 15 recibos de costo, USD 1.918865 confirmado y USD 1.6818 reserva intactos; cero permisos nuevos. Comparación antes/después conserva generación y selección byteidénticas.

## Reutilización e invariantes

No SQL de producto nuevo, tabla, proveedor, importación ni ajuste especial para National. Se extiende el lector existente, se conserva el shell Signal y sus componentes. Los UUID de actor/workspace se resuelven en servidor; censo, permisos de texto y SHA preparado se verifican antes de buscar o entregar contenido. Cursor con microsegundos, alcance y ordinal comprobados; el texto no se restaura desde caché antes de revalidar. El lector deja intactos costos, selección y generación.

## Límites y continuación

Esta entrega conecta Menciones; no declara monitoreo incremental completo, precisión semántica, autoservicio del rol cliente ni escala de dos millones probada. UAT conserva 32 Topics de 32/357 unidades. Corrección del resumen histórico: la lectura tomada al retomar ya tenía selección revisión 2 con dos Topics, registrada antes de esta sesión; el Resumen actual muestra 98 menciones (35 + 63). No revertir a la selección antigua de sólo 63 ni atribuir este cambio a la entrega de Menciones. Continúa PLAN_COMPLETE_INCREMENTAL_MONITORING_2026-09-09.md. SQL0148/0149 y nuevo productor0150 permanecen locales en el checkout separado de composición; no están incluidos en este corte.

ClaudeUSD1.918865confirmado+USD1.6818reserva, VoyageUSD0.594449; no permiso nuevo ni gasto nuevo. Sonnet4.6/noOpus. No producción. Compass e historia preservados.

## Corrección focal enviada — 10 septiembre00:56UTC

Commit `1836972c990eea4ac92d45f4bb71ca1cca5b424e`, dos archivos, enviado sólo a ramaUAT. La preferencia de joins y `jit=off` están limitados a la transacción de Menciones. La segunda condición evita que la penalización estimada del planner active compilación JIT costosa en otros entornos: PG local tenía jit=on, produjo81s con el primer ajuste aislado; corrección completa recuperó9.51s para el gate y31ms para su primera lectura. Se comprobaron cuatro combinaciones de settings anteriores y su restauración por COMMIT/ROLLBACK/error, derechos/censo/offset, unit2/2, TC/lintDB y revisiónRoot sinP0/P1/P2. No nuevas tablas/SQL/importe. Runtime1836972 y QA UI final pendientes de comprobación; no confundir el diagnóstico readonly con entrega aceptada.

## Aceptación final — 10 septiembre01:14UTC

Studio `5d6a86c2-1c00-44d3-9a39-e6c4c841ce9d` y Worker `f772cd29-cc3d-4c85-bd63-711167229f6b` activos en `1836972`. La medición del lector desplegado, sin modificar sus consultas, registró1.161s/1.085s/1.097s para primera/siguiente/retorno, páginas50, offsets0/50/0 y el mismo scope/generación/6,826conteos. Las consultas mayores tardaron233–260ms. **P2 de rendimiento cerrado**; estas cifras corresponden al corpus real de UAT, no prueban escala de millones.

QA real adicional: búsqueda Europcar286; Facebook+forum13; Hoy UTC10sept sin datos y retorno a toda cobertura13; fecha ascendente; foco de una fila y recarga directa del URL; Topics→Ver evidencia→Abrir mención llega al original Madrid con el foco correcto. No se cambió la selección. Diez comprobaciones guardadas en `uat-ui-qa.json`. Atrás/Adelante del navegador no se afirmó probado en UAT: la sesión independiente del agente no tenía acceso al navegador; recuperación de historial/BFCache sí está cubierta por las pruebas locales previas. El texto importado conserva algunas entidades HTML literales, observación de presentación pendiente; no se reescribió la fuente.

Recibo `uat-final-receipt.json` a2026-09-10T01:14:34.708Z: cero ejecuciones/llamadas/outbox activos, cero operaciones de permiso,15 recibosClaude,USD1.918865confirmado+USD1.6818reserva. `uat-final-comparison.json` confirma estado y costos byteidénticos frente al recibo anterior; generación6,826y selecciónrevisión2 intactas. El ajuste no generó costo de proveedor ni SQLnuevo. Evidencia privada en `.data/signal-mentions-native-2026-09-09/` y `.data/signal-mentions-native-ui-2026-09-09/` del checkout Menciones. Las notas de pendientes inferiores/superiores anteriores se conservan como historia cronológica.
