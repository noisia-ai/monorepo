# PR #36 — cierre de robustez MFP tras auditoría §9.4

Rama `fix/mfp-phase-b-critical`, base funcional `32211a49` antes de este recibo, PR a `develop` sin fusión. Integra #34 `1e9d7e6d` (incluida 0252 para exposición) y las dependencias anteriores de Fases A/B. Modelo/esfuerzo real de esta corrección: **gpt-6-sol / high**. No hubo llamadas a proveedores ni gasto externo (USD 0).

| Hallazgo | Cambio | Prueba de aceptación |
|---|---|---|
| `releaseUnknown` liberaba una llamada y el mismo tick enviaba otra página | La reconciliación reporta la liberación; ambos workers releen `status/error_code` desde PostgreSQL y terminan el tick sin reservar. | Runner PG real: `runMentionFacetsTickV1` y `runConceptMembershipTickV1` con store de producto, lista exhaustiva vacía y provider spy: **cero** `get/create/results` y una sola llamada terminal, sin reserva nueva. |
| `provider_usage_invalid` desaparecía del tope y exposición | `finish` cierra la llamada aplicada como `failed` con `settled_micro_usd=reserved_micro_usd`. El cálculo del run y la función diaria 0252 de #34 cuentan ese importe. | Runner PG: transición terminal y 83 µUSD guardados; gate #34 de la función real: delta +83 µUSD en tope y exposición bajo rollback. |
| `provider_result_missing` con `results_applied=true` quedaba `unknown` | `finish` da estado terminal `failed`, registra reserva como cargo conservador y error del run `labeling_provider_result_missing`. | Runner PG: transición terminal, 83 µUSD y run `failed`; no queda `unknown`. |

Aceptación PG del HEAD integrado: **5/5 PASS** en el runner MFP, tablas temporales aisladas por `pg_temp`, cero escrituras persistentes y cero proveedor. Validación local sobre cabeza final: DB **630 PASS / 103 SKIP**, Worker **806 PASS / 42 SKIP**, typecheck DB/Worker y `git diff --check` verdes. La migración 0252 se probó en transacción con rollback; 0255 conserva su SHA y no se reaplicó. #36 conserva la revisión del auditor y la fusión a `develop` pendientes.
