# Backend 05C · Apply guarded, canary visible y rollback

## Precondiciones

- `gate_05b: passed`.
- Advisor 05B sin P0/P1.
- Target `noisia-staging` reconciliado direct/pooler.
- Autorizaciones de migración y canary visibles en `true`.
- Restore point fresco, verificado y con edad registrada.

Si falta una precondición, detente en `READY_FOR_OPERATOR_AUTHORIZATION`.

## 1. Apply de 0072, sólo si existe

Usa runner guarded. Registra checksum, ledger y sentinels. Prueba idempotencia. Captura
antes/después de:

- V1 definitions/memberships/pointer/digest;
- semantic base y digest;
- assertions y Review;
- derivations/compilations;
- bindings current e historial;
- policies y governance authorities.

Sólo deben cambiar los objetos de integridad previstos por 0072. Producción queda fuera.

## 2. Canary gobernado

Activa `governed` sólo en la instancia local/preview que sirve `noisia-staging`; no
edites un `.env` versionado ni cambies producción. Los tres módulos deben consumir sus
bindings current y populations distintas.

Comprueba por HTTP autenticado y SSR:

- response scope literal con binding/policy/population/watermark/coverage/denominator;
- Monitoring, Mentions y T&N usan identidades correctas;
- filtros, comparativos, pagination, cursor, ETag y focused records;
- evidence respeta capabilities y reporta withheld sin alterar el denominador;
- invalid/stale binding falla cerrado;
- no puede seleccionarse `population_id`, policy o read mode desde el cliente;
- cross-workspace y cross-view bloqueados.

## 3. QA visible real

Usa el navegador contra la app autenticada. Recorre al menos:

1. entrada por URL estable del workspace;
2. Brand Monitoring y cambio de fechas/filtros;
3. chart → menciones constituyentes;
4. Mentions: búsqueda, orden, pagination, focused drawer y abrir original;
5. Topics & Narratives: overview, término, evidence y lineage;
6. navegación directa y refresh de cada módulo;
7. responsive desktop y viewport angosto;
8. es-MX y en-US.

Exige cero raw translation keys, cero hydration/runtime errors, cero requests cross-view
no autorizados y cero console errors atribuibles al cambio. Mide p50/p95 warm por ruta;
no inventes thresholds a partir de Laika, pero identifica regresiones y N+1.

No rediseñes la interfaz durante esta fase. Si hay un defecto visual preexistente,
regístralo para Gate E.

## 4. Rollback visible

Restaura la configuración visible a `legacy` y demuestra que:

- la app vuelve a legacy sin escribir pointers;
- SSR y fetches cliente coinciden;
- cursores/ETags governed no se reutilizan;
- bindings current permanecen intactos;
- V1 y la base semántica conservan sus digests.

El rehearsal `withdraw-to-bridge` de 05A ya cubre rollback de binding. No repitas
mutaciones de binding remotas salvo que una falla concreta lo haga necesario y exista
autorización explícita.

El estado seguro al cierre de 05C es visible legacy/shadow, bindings current conservados
y canary gobernado demostrado mediante evidence.

## Checkpoint 05C

- Tests/typechecks/lint/smoke verdes.
- Apply guarded e idempotente de 0072, si existió.
- HTTP + SSR + browser QA completos.
- Canary y rollback demostrados.
- `unexplained_count=0`.
- Evidence y timings con hashes.
- Advisor review; cero P0/P1 abiertos.
- Producción intacta.

Marca `gate_05c: passed` en `EXECUTION_STATE.md` antes de continuar.
