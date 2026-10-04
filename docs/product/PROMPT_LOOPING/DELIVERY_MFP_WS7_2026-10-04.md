# WS7 — UI de ficha y pertenencia · 2026-10-04

PR draft: [#21](https://github.com/noisia-ai/monorepo/pull/21), base `develop`. Sin migraciones ni gasto de proveedor.

- Topics muestra Importar → Preparar → Ficha → Descubrir → Pertenencia → Signal. Ficha: distribución y filtros por dimensión, página de 30, selección por lote, correcciones con entidades múltiples/prominencia y enlace directo a raíz.
- Editor completo, preview asíncrono de 30 raíces, costes estimado/real/reservado y máximo estricto opcional, pertenencia completa, cola por veredicto y overrides aceptar/rechazar. Selección MFP en Signal usa el contrato WS5; adopción usa POST Topics de WS6 con revisión exacta y ámbito explícito.
- GET facets `view=mentions` y PATCH escriben/leen el contrato real. La lectura conserva permisos vigentes de texto/métricas por procedencia y no usa una ficha obsoleta; muestra dimensiones humanas válidas aunque falte ficha de proveedor. Un lote tiene una transacción, autoridad revalidada y escrituras multirregistro.
- Textos ES-MX/EN-US; citas resaltadas en contexto original, enlaces web seguros, resultados experimentales identificados. `NOISIA_CONCEPT_MEMBERSHIP_ENABLED=true` oculta controles de interest decision V1/V2; no se altera Kinde, prefetch ni políticas de autorización.

## Evidencia

- `node --test --import tsx …mfp-ui.test.ts …signal-mention-facets-ui.test.ts`: **10 PASS**, 0.35 s local; helpers, Unicode/citas, costes, locales, atomicidad y permisos revocados con DB simulada.
- `node --test --import tsx …MfpEvidence.test.tsx`: **6 PASS**, 0.26 s local; render SSR en ambos idiomas, cita dentro del original, negativa sin evidencia inventada, nulo distinto de máximo cero.
- Regresión Topics/editor/flag MFP: **18 PASS**, ambos idiomas. Tres regresiones de estado adicionales verifican preview A → edición B → reintento A, nueva solicitud para contexto cambiado sin eludir confirmación y selección borrada al navegar entre raíces/página. Última tanda UI: **33 PASS**, 1.53 s local.
- **PostgreSQL real PASS**, ejecutado por Root sobre las 905 raíces del corpus privado: browser, nueve dimensiones, tres correcciones por lote, dimensiones humanas conservadas al cambiar CE, revisión/reparación de entidades, texto retenido al revocar derechos y rollback verificado; **cero llamadas de proveedor**. Código DB equivalente a `5f304eb`, harness `9a8b165`. El retiro de competidor y la sucesora de licencia usan los writers de gobierno existentes; no se modificó ni reaplicó 0225.
- El plan inicial expandía la vista completa por cada raíz y obligó a cancelar la consulta. La proyección materializada por workspace permitió completar todas las lecturas/filtros sin timeout. El harness conserva plan privado saneado (`--explain-only`), fases/SQLSTATE y timeout de 60 s por sentencia; los dos fallos posteriores de fixture quedaron corregidos mediante los writers reales.
- Parser TypeScript sin diagnósticos y `git diff --check` limpio. [CI completo verde de `5ba195b`](https://github.com/noisia-ai/monorepo/actions/runs/37200807400); las revisiones posteriores requieren CI final. Rama rebasada sin conflictos sobre `develop` `1b3ebe7`; resultado final de CI se registra en el PR.

## Límites de entrega

No es QA de navegador autenticado, demo de proveedor ni aceptación semántica. Requiere integrar WS5/WS6 y desplegar antes de activar el flag; Root gestiona callback y QA dev-test. El camino Discovery existente aún exige cap heredado/autoridad interna: WS6 prepara un segundo corte para `NULL` y `can_request_processing`; este PR no lo elude. El recorrido integral (crear/probar/lanzar/corregir tres/seleccionar, ES/EN) y segunda carga siguen pendientes. No entregado a UAT ni producción.
