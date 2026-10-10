# Frente 5 — revisión 7 del audit (§12.3)

PR #40 sigue draft, sin merge, UAT ni producción. Este recibo documenta preparación e integración; el [recibo final del PR](https://github.com/noisia-ai/monorepo/pull/40) conservará el HEAD, CI/PG y despliegues finales sin un commit documental recursivo.

## Cambios propios de #40

- Correcciones de pertenencia por UI: origen fijo `human_ui`, sin selector. `agent_assisted` sigue disponible explícitamente por API/script y conserva su atribución histórica. Test ejecuta el payload de una corrección por lote; la prueba real de UI permanece pendiente.
- Lecturas pesadas de fichas/miembros: una consulta activa por proceso antes del pool, global compartido entre bundles, pestañas y workspaces. Ocho pendientes como máximo; cancelación o espera de 60 s nunca inicia el query. Errores liberan el slot. Dos conexiones del pool de 3 conexiones siguen disponibles para otras consultas. No se limita ni reintenta una escritura; grants se revalidan en el servicio DB original. MFP Studio tiene una réplica; esto no es un semáforo distribuido entre procesos.
- Recuperación bilingüe de `hybrid_route_upgrade_required`, con selección explícita Estándar→Híbrido experimental. El consumidor de configuración ya envía `expected_route_digest` obligatorio, incluyendo null explícito sólo cuando no hay ruta.
- Guía del fundador reescrita: pasos individuales, controles reales, recuperación en el paso, archivos de 1,000/250 filas verificados y costo orientativo híbrido. El panel editorial actual inicia directamente y no renderiza cotización ni casilla de autorización previa; la guía registra esa limitación en el paso correspondiente.

## Integración y checks

Código integrado provisional `e09ba164191c9424959ae0ee5579b19fbba66fb8`, con #39 `320c64c89950eeb18843f5b0a8c68f346a1bdfb8`, merge automático sin conflictos. El recibo final de #39 `f5d9c0e0835a5cab524a2f9cb126ffe50c2156be` también queda integrado antes del despliegue. Su código 320c64c8 tiene CI 38083812008 y PG 38083812002 SUCCESS; la integración de #40 deberá obtener sus propios gates finales. Workflow conserva main/develop y añade sus tests de evaluación TS; F5-12 y procedencia de #40 quedan conservados. No se modifican prompts/umbrales ni se reaplica 0260.

Copia aislada del Runner remoto: monorepo typecheck 11/11, harness typecheck y lint 11/11 (0 errores, 13 warnings previos);23 tests focales antes de la integración. El PR contiene CI/PG sobre el código integrado; las suites completas y la prueba UI desplegada se acreditarán sólo con sus resultados finales.

## Preflight sin mutación

Servicios verificados en dev-test: Runner `a5706eaa-7d67-4d63-8e7e-2b9fc7424508`, Studio `f87fe1ae-5f7e-45e0-9a19-7c162b315b1b`; ambos con 1 réplica, fuente develop, UI Railway muestra autodeploy desactivado en ambos. Deploys históricos siguen `df39c4ee…` / `2271084f…`; no se atribuyen al código integrado.

Runner tiene Worker/DATA_OS activos pero editorial/batch/global stage desactivados. Hay 3 ejecuciones editoriales queued, todas review_pending con global materialized ; 3 batches applied y 6 global imported. Marca QA muestra 13/13 resultados editoriales guardados, 5 Topics/4 Noise/4 insuficientes, 0 errores/pendientes, USD 0.093035 confirmado y 0 reservado/ambiguo. Esa lectura es histórica y no acredita una nueva demo desde UI. Activación normal y nuevas solicitudes deberán seguir los controles del producto, sin jobs manuales.

## Costos y límites

Proveedor nuevo durante esta preparación: USD 0. La fórmula y alcance de USD 7 estándar/USD 5 híbrido/USD 1 de comparación adicional están en el anexo del operador; no son cotizaciones exactas ni caps. Modelo/effort efectivo de Codex no observable en el runtime; no se acredita una configuración comunicada como medición. Modelos y costos de la ejecución editorial se registrarán desde recibos reales.

Gates para cerrar §12.3 (resultado final en el PR): CI/PG final #40; desplegar y fijar ambos servicios con flags operativos y autodeploy OFF; consolidación editorial por UI hasta final; medición autenticada de dos pestañas; recibo de costos/modelos y guía apuntando al corte verificado. Sin aceptación del fundador ni publicación.
