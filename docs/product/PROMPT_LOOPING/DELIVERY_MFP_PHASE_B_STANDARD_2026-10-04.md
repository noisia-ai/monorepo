# Recibo Fase B estándar — 4 octubre 2026

Alcance: B5, B6, B7 y punto 7 de Fase B (B8); rama `fix/mfp-phase-b-robustness`, base `develop` `4bbd2e25`. Subagente real: `gpt-6-sol`, esfuerzo `medium`. No modifica B1–B4, el harness ni el spec.

| Corte | Resultado |
|---|---|
| B5 | `NOISIA_MFP_IN_FLIGHT_PAGES` permite 1–16 páginas de 200 raíces por Message Batch; valor predeterminado 1. Las reservas y el cursor siguen transaccionales. Prueba con dos páginas y cuatro decisiones en un envío simulado. |
| B6 | El parser valida cada raíz. Conserva resultados válidos, reintenta sola la raíz inválida y guarda un error técnico si falla aislada; la selección no vuelve a cobrar ese error para la misma identidad. Pruebas de parser y worker, incluido replay sin nuevo envío. |
| B7 | Migración 0250: los overrides nuevos guardan `definition_digest` y `root_fingerprint`; la vista sólo aplica uno que coincide con ambos. Los históricos sin identidad quedan señalados para revisión. Studio muestra la advertencia en ES/EN. |
| B8 | Migración 0251: la vista de consolidación separa la rama sin opt-in, sin join a fichas, de la rama con `mention_facets` opt-in de 0243. Las consultas de pertenencia ya acotan las vistas por workspace. |

Pruebas locales: query-engine 11/11; workers focales 17/17; Studio UI 8/8; migraciones estáticas 2/2. Typecheck de query-engine, DB, workers y Studio verde. Lint Studio sin errores (13 advertencias preexistentes fuera del diff); DB, workers y query-engine sin lint configurado. `git diff --check` verde. Transporte simulado; gasto nuevo de proveedor **USD 0**, frente a estimación **USD 0**.

**Gate restante (coordina orquestador tras Fase A):** integrar Fase A/0243, aplicar 0250→0251 una vez y correr PG opt-in en `mfp-private-runner` sobre `noisia_mfp`; comprobar overrides tras edición de definición/texto y equivalencia de consolidación sin MFP. Aún no hay verificación de SQL en PostgreSQL ni despliegue UAT. La fusión a `develop` espera revisión del auditor.
