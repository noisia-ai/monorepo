# Refresco explícito de intereses después de Brand Context

Estado: corte local cerrado; SQL0161 todavía no aplicado en UAT. Sin proveedores,
importaciones ni entrega remota.

Cuando Stage2 terminó y cambian los Topics/intereses, el contexto publicado sigue válido pero sus guías pueden necesitar vectores nuevos. El cliente debe poder preparar el plan actual sin ejecutar Claude de nuevo ni modificar los recibos anteriores.

## Contrato

- Reutilizar el constructor servidor del plan, el endpoint de cotización/confirmación, la cadena de recibos Stage2 y el ledger Voyage existente. No aceptar perfil, plan, modelo ni tope del navegador.
- SQL0161 permite sucesor de una hoja completed únicamente con plan distinto y prueba íntegra de su run/admisión/recibo, sin reservas ni llamadas inciertas pendientes. La rama DNC existente conserva sus reglas.
- Una decisión de refresco siempre exige confirmación y clave nueva, incluso si la caché cubre todo y el cap es cero. Nunca hereda el permiso Stage1. Policy/actor/fuente/plan se revalidan dentro de la admisión atómica; los topes organizacionales existentes siguen aplicando.
- El replay de una clave aceptada devuelve su recibo histórico, incluso después de un sucesor, un fallo rápido o vencimiento de cotización. No crea trabajo ni llama Claude.
- El Worker sólo ejecuta owners ya admitidos. Su descubrimiento automático no inicia refrescos de hojas completed.
- La UI muestra `guides_pending` (contexto listo, intereses cambiados), exige click explícito y vuelve a leer al guardar el catálogo. La espera de menciones continúa separada.

## Archivos y validación

SQL0161 y test contractual; adaptador DB y tests; service/DTO/componente de cotización Studio; TopicsManager; claves ES/EN. Se evitan auth, alta, BrandOsForm y preparación de contexto en edición paralela.

Focales: plan cambiado/completed, mismo plan rechazado, DNC preservado, uncertain/source/policy rechazados, cap0 explícito, replay histórico, provider off, ninguna llamada Claude, estado y confirmación ES/EN. Typecheck DB/Studio y lint focal. Este corte no ejecuta SQL: la prueba PG de admisión/rollback y el Worker con proveedor falso quedan como gate de integración previo a entrega.


## Assertion PostgreSQL componible

`infrastructure/db/migrations/signal-brand-context-prototype-refresh.assertions.ts` no abre conexiones ni ejecuta al importar. `assertSignalBrandContextPrototypeRefreshPostgresV1` recibe el Pool de savepoints del runner, su client y parent/workspace/actor/source. Requiere Stage1 publicado + Stage2 completed reales, con un interés manual creado por store antes del primer Stage2 y cacheado por el Worker falso. Archiva ese interés por store/CAS: el nuevo plan conserva contexto y es un subconjunto físico de textos, por lo que exige confirmación pero cap0 y cero envíos. Comprueba fuente/policy negativas, sucesor, replay histórico, hash íntegro previo, conteos y rollback del savepoint.

`assertSignalBrandContextPrototypeRefreshUncertainPostgresV1` recibe la rama donde el Worker falso ya produjo outcome_unknown; exige ese estado y una llamada incierta real antes de comprobar la denegación. No lo simula con UPDATE ni siembra caché/respuestas.

El runner compuesto ejecutó ambas assertions sobre PostgreSQL real local con SQL0141–0161: 10
casos PASS, cero transportes externos, rollback físico exacto, base temporal eliminada y los 269
censos de la base fuente idénticos antes/después. El refresco con caché completa terminó con cap0,
confirmación explícita y cero llamadas; la rama `outcome_unknown` quedó bloqueada. Recibo privado:
`.data/topic-guides-refresh-2026-09-11/PG_RECEIPT.md`.
