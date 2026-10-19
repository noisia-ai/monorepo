# Signal: métricas pendientes sin ceros ficticios

## Problema y alcance

UAT `a4081ee` mostraba correctamente 43,159 menciones de Alexa+, pero las métricas nativas no disponibles aparecían como 0 de 0 en sentimiento, seis cifras de engagement en cero y evidencia LIVE con títulos de tres señales vacías. No eran medidas reales.

Este corte sólo modifica presentación en el componente compartido BrandMonitoring y mensajes ES/EN. Si una métrica nativa está pending/not_available muestra su ausencia, conserva las tarjetas y el acceso a Menciones. Ceros legítimos fresh/stale/partial siguen visibles. Evidencia nativa vacía deja de anunciar LIVE o tres señales. Laika/legacy mantiene sus ramas de renderizado y cualquier evidencia existente se conserva. La copia genérica de ausencia de métricas deja de exponer Data OS al usuario.

No cambia el lector, contratos, permisos, población, análisis, SQL ni datos. Signal desde primera importación sigue separado en `noisia-signal-from-import-2026-09-24`, respaldado en `4a95592`, pendiente gatePG por autenticación privada dev-test28P01. Este ajuste visual no elude ese gate.

## Verificación

Catorce escenarios SSR reales ES/EN comprueban estados pendientes, ceros fresh/stale/partial, evidencia existente y legacy, además del adaptador nativo existente. La primera instalación reutilizada apuntaba a paquetes del checkout importado y produjo un error de tipos; se sustituyó por instalación offline local del lockfile, sin cambios de dependencias. Comprobación Studio: 1,082 tests PASS en la suite inicial y dos archivos no arrancaron por faltar DATABASE_URL de prueba; únicamente esos dos archivos se repitieron con URL sintética de loopback, 17 PASS. Total 1,099 tests aprobados y siete skips de integración, sin fallos pendientes. Lint raíz11/11 PASS (13 warnings previos). Build inicial detectó dependencias Worker ausentes en la instalación filtrada; instalación offline raíz completada, lockfile intacto. Build final PASS y typecheck raíz secuencial11/11 PASS sobre la base exacta de UAT. `git diff --check` limpio. No se repiten los checks cerrados. Revisión independiente del diff sin P0/P1/P2 concretos.

## Entrega

Checkout aislado `noisia-signal-pending-metrics-2026-09-24`, base `a4081ee`. Sólo cinco archivos de UI/prueba más este recibo. Entrega focal Studio UAT tras checks; no se requiere Worker ni migración. Pendiente verificación de runtime y UI. Cero proveedores nuevos. No declara el E2E completo.
