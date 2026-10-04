# WS7 — UI de ficha y pertenencia · 2026-10-04

PR draft: [#21](https://github.com/noisia-ai/monorepo/pull/21), base `develop`. Sin migraciones ni gasto de proveedor.

- Topics muestra Importar → Preparar → Ficha → Descubrir → Pertenencia → Signal. Ficha: distribución y filtros por dimensión, página de 30, selección por lote, correcciones con entidades múltiples/prominencia y enlace directo a raíz.
- Editor completo, preview asíncrono de 30 raíces, costes estimado/real/reservado y máximo estricto opcional, pertenencia completa, cola por veredicto y overrides aceptar/rechazar. Selección MFP en Signal usa el contrato WS5; adopción usa POST Topics de WS6 con revisión exacta y ámbito explícito.
- GET facets `view=mentions` y PATCH escriben/leen el contrato real. La lectura conserva permisos vigentes de texto/métricas por procedencia y no usa una ficha obsoleta; muestra dimensiones humanas válidas aunque falte ficha de proveedor. Un lote tiene una transacción, autoridad revalidada y escrituras multirregistro.
- Textos ES-MX/EN-US; citas resaltadas en contexto original, enlaces web seguros, resultados experimentales identificados. `NOISIA_CONCEPT_MEMBERSHIP_ENABLED=true` oculta controles de interest decision V1/V2; no se altera Kinde, prefetch ni políticas de autorización.

## Evidencia

- `node --test --import tsx …mfp-ui.test.ts …signal-mention-facets-ui.test.ts`: **10 PASS**, 0.35 s local; helpers, Unicode/citas, costes, locales, atomicidad y permisos revocados con DB simulada.
- `node --test --import tsx …MfpEvidence.test.tsx`: **6 PASS**, 0.26 s local; render SSR en ambos idiomas, cita dentro del original, negativa sin evidencia inventada, nulo distinto de máximo cero.
- Parser TypeScript de archivos tocados: sin diagnósticos. `git diff --check`: limpio. Typecheck, lint, suites completas y build: CI remoto del PR, pendiente de conclusión al escribir este recibo.

## Límites de entrega

No es QA de navegador autenticado, demo de proveedor ni aceptación semántica. Requiere integrar WS5/WS6 y desplegar antes de activar el flag; Root gestiona callback y QA dev-test. El camino Discovery existente aún exige cap heredado/autoridad interna: WS6 prepara un segundo corte para `NULL` y `can_request_processing`; este PR no lo elude. El recorrido integral (crear/probar/lanzar/corregir tres/seleccionar, ES/EN) y segunda carga siguen pendientes. No entregado a UAT ni producción.
