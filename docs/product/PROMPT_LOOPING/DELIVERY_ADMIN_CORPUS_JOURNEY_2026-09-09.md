# Corpus recibido y recorrido de marca — 9 septiembre 2026

Corte focal `d419d656f2cb6567403b89c0bc1fdc1cd3d2d050` enviado únicamente a la rama UAT `codex/noisia-topic-results-uat-2026-09-06`. Incluye el diagnóstico local de admisión vencida `f6b3af1`. Despliegues en verificación; todavía no se afirma runtime entregado.

## Resultado de producto

Marcas, Overview y Datos comparten la recepción real del workspace: raíces únicas, archivos aceptados, filas originales y fechas observadas. Una lectura no disponible o una fuente sin medición no se convierte en cero. La población operativa anterior deja de presentarse como todo el corpus recibido. Overview explica el análisis y siguiente paso; no declara Signal listo por haber importado archivos. Diagnósticos antiguos de Datos quedan en un detalle cerrado y no aparecen como requisitos de cada Topic.

El lector usa dos consultas constantes, autorización por workspace y raíces de imports completados. No hay SQL nuevo, reimportación, cambios de población, fit, embeddings o proveedor. National sigue siendo caso de prueba, sin condiciones específicas en código.

## Verificación del corte

Snapshot aislado en `noisia-e2e-corpus-check-2026-09-09`, base f6b3af1; quince archivos exactos comparados antes de staging. Typecheck y lint11/11 PASS, DB235PASS/69SKIP, Studio723PASS/6SKIP; cuatro pruebas focales después de revisión PASS. PostgreSQL focal1/1 PASS, QA navegador local18comprobaciones ES/EN con escritorio/390px sin overflow. BuildStudio PASS con valores placeholder de autenticación y DB local inaccesible, sin credenciales ni proveedor. El primer build mostró la ausencia de KINDE_ISSUER_URL y se repitió con configuración sólo de build; no fue fallo de producto.

Dos P2 de revisión corregidos: copy de cobertura parcial no atribuye fechas faltantes sin evidencia; cero con archivos aceptados y reconciliación incompleta dirige a revisar recepción, no a otra carga. Revisión independiente cierra0P0/P1/P2. Tres drafts ajenos conservan SHA256 original; delta progresivo inacabado quedó fuera del commit.

Recibos privados en worktree focal `.data/admin-corpus-summary-2026-09-09/{backend-receipt.md,root-checks.json}` y `.data/admin-corpus-ui-2026-09-09/{frontend-receipt.md,browser-pass.json}`.

## Continuidad

Siguiente: comprobar runtimeStudio/Worker y Marcas/Overview/Datos reales; continuar mismo motor `4c55af5c-e17f-430a-b17d-6771e94bd30e` con Topics derivados de32/357 interpretaciones ya pagadas, clasificación completa del censo con pendientes explícitos y selección individual para Signal. SQL0144 es trabajo local en desarrollo; no aplicado. Nuevo gastoClaude0. Permiso fechado nuevo sigue preguntado, sin respuesta. Ventana de trabajo termina14:47:24UTC; Compass e historia conservados.

## UAT comprobado — 07:28 UTC

StudioDeployment `e41c55e2-f41f-4c0c-b201-153c37b70ec8` y WorkerDeployment `570bcdb2-2c72-458f-88eb-388ed7e875be` activos desde GitHub para d419d65; despliegues anteriores retirados. UI autenticada real: Marcas, Overview y Datos muestran7,396raíces/16archivos; Overview/Datos9,131filas, fechas observadas31dic2025–23ago2026; Overview muestra32/357 y análisis interrumpido, sin afirmar permiso vencido como causa histórica. Diagnósticos avanzados cerrados en Datos. No POST ni proveedor en esta aceptación. Las fechas son representación del valor observado en zona del workspace; no resuelven la zona de exportación SentiOne pendiente.

Este corte está entregado en UAT. Topics sigue0 hasta el siguiente corte progresivo. QA halló copy viejo de preparación que afirma “aún no analizado” incluso con fit real; se corrige de forma neutral sobre su propia etapa en el segundo corte, sin repetir preparación.
