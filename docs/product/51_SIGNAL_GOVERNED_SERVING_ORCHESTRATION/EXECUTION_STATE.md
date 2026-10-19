# Execution State · Governed Serving → Gate D

> Bitácora durable. Actualizar después de cada checkpoint. No incluir secretos, DSNs,
> UUIDs privados ni contenido de menciones.

## Autorización

```yaml
target: noisia-staging
advisor_model: Claude Fable 5
advisor_total_budget_usd: 20
advisor_spend_observed_usd: 10.32320
allow_forward_only_staging_migrations: true
allow_staging_policy_or_binding_writes: true
allow_visible_staging_canary: true
allow_paid_tb_run: false
```

## Baseline 05A

```yaml
gate_05a: passed
migrations_staging_verified: 0068-0071
current_brand_bindings: 3
derived_populations_distinct: true
operational_v2_pointers: 0
visible_readers_connected: false
rollback_rehearsed: promote-withdraw-to-bridge-promote
production_touched: false
```

## Gate status

| Gate | Estado | Advisor | Evidence | Bloqueo |
|---|---|---|---|---|
| 05B | passed | approved with P2/P3; 0 P0/P1 | `.data/signal-governed-serving/05b/` | — |
| 05C | passed | approved with P2/P3; 0 P0/P1 | `.data/signal-governed-serving/05c/` | — |
| 06 | passed | approved with P2/P3; 0 P0/P1 | `.data/signal-governed-serving/06/`, `.data/signal-governed-serving/backend-06/` | — |
| Gate D preflight | passed; 0074–0076 `staging_verified` | approved with P2/P3; 0 P0/P1 | `.data/signal-governed-serving/backend-07/` | corrida pagada queda exclusivamente en manos del operador |

## Latest verified invariants

| Invariante | Valor/hash sanitizado | Verificado en |
|---|---|---|
| Operational V1 memberships | 18,996 | Backend 05A |
| Operational V1 included | 927 | Backend 05A |
| Semantic base memberships | 276 | Backend 05A |
| Current brand bindings | 3 | Backend 05A |
| Current non-brand bindings | 9 (3 por competition/category/all-governed) | Backend 06 |
| Current governed bindings / compilations | 12 / 12 | Gate D migration verify |
| Strategic binding / compilation / roots | 1 / 1 / 483 | Backend 07 |
| V2 operational pointers | 0 | Backend 05A |

## Changes by gate

### 05B

- Estado: `passed`. Implementación, checks determinísticos, shadow staging read-only y
  re-review focal exacta verdes. Advisor autorizó avanzar con cero P0/P1.
- Migraciones: 0072 local forward-only; no aplicada remotamente. SHA-256
  `1c974ec09871c28a439bb23a7753b6b0a9d8915539493bff3c364515bbbd4738`.
- Contratos/readers: resolver current-binding fail-closed; scope canónico por módulo/view;
  boundary server-owned; ETags/cursores ligados a policy/population/compilation/watermark;
  evidence Monitoring/T&N intersectada con Mentions; shadow HTTP durable exacto por binding.
  Read mode visible y frontend permanecen sin cambios.
- Checks: Query Engine 251/251; DB 74 pass + 14 opt-in skip; Studio 323 pass + 1
  skip; PostgreSQL 0072 1/1; PostgreSQL governed brand 3/3; smoke 0000–0072
  (73 migraciones); lint 0 errores/14 warnings preexistentes; `git diff --check` verde.
- Evidence/hash: preflight
  `sha256:181adc917937f6c97192f6cdbee69923eed8618fd0f05a259eafeb8fee4fabe5`;
  shadow `sha256:82c76638a0d0d44ed80589c0d16f09769f134bf1fe008e41be710149d0828932`;
  Advisor packet
  `sha256:a3b8a9458ca60dff13cde3138e064a08b977f94bbec48aed1d33b4d50722b60a`;
  primera revisión exacta
  `sha256:5d410e013b60f53de9a4e0d9c60fa6d8a9d4cdcf3d9723babbc669833f464d2f`;
  re-review focal
  `sha256:6040ade15d1a4afa19764090b266e68bdf95b0f149714390ef09da4eeec447a7`;
  blocker revalidado
  `sha256:eb73d46ece2b640d98cebd4c77eae5e6b481c0b9547a04a16bd099c38365f043`.
- Shadow staging: read-only; writes=0; 3 bindings/3 populations; denominator 271 por
  módulo; coverage `partial`; abstained `not_available/count=null`;
  `unexplained_count=0`; operational pointer seguido=false. Duración observada del
  rehearsal: Monitoring 660.2 ms, Mentions 3976.9 ms, T&N 824.3 ms, total 5612.9 ms.
- Advisor verdict/spend: primera revisión exacta `reject`; re-review focal
  `approve_with_p2_p3`, `can_advance=true`, cero P0/P1. Re-review: 73,930 input / 2,509
  output / USD 0.86475. Acumulado conservador (incluye reserva de la respuesta no
  parseable previa): USD 3.29048 / USD 20.
- Open findings no bloqueantes: retirar el identificador de compatibilidad legacy de
  cualquier path governed-visible; no ampliar el scope operacional estrecho para
  multi-view; perfilar Mentions (~4 s en shadow) y duración del drainer en 05C.
- 0072 continúa sin aplicar en staging al cierre de 05B.
- Entorno local: el PostgreSQL 16 + pgvector desechable usado por integraciones/smoke
  quedó detenido; Redis local no fue modificado.

### 05C

- Estado: `passed`. 0072 aplicada/verificada exclusivamente en `noisia-staging`,
  canary governed visible completado y proceso restaurado a legacy.
- Target/restore: direct/pooler reconciliados al mismo project-ref; fingerprint direct
  `sha256:594e5c…2a19`, pooler `sha256:0630a1…815`; restore físico
  `2026-08-11T14:17:07Z`, edad observada 17.2 h; cero writers/apps incompatibles.
- Remote actions: sólo 0072, checksum
  `sha256:1c974ec09871c28a439bb23a7753b6b0a9d8915539493bff3c364515bbbd4738`;
  ledger único, 9/9 sentinels, verify read-only. Aggregate protegido before/after
  `sha256:96aa26833abc2c32c03d5b200f734b9df8718614550a311faf11a2e7d4a228e3`.
  V1 18,996/927, base 276, tres bindings y tres compilaciones quedaron idénticos;
  V2 pointers=0.
- Canary/rollback: los tres módulos resolvieron `governed-binding` con populations
  derivadas distintas; shadow post-0072 `gate_passed=true`, operational pointer
  seguido=false y `unexplained_count=0`. Rollback por proceso al modo legacy sin
  escritura de pointers/bindings; SSR legacy sin `serving_scope`, conteo visible 32;
  ambos procesos terminaron limpiamente.
- Browser QA: HTTP/SSR autenticado; navegación y refresh; Monitoring, Mentions y T&N;
  búsqueda/orden/focused drawer; T&N detail/evidence y deep link a la mención canónica;
  intento de autoridad cliente ignorado; viewport 390×844; es-MX/en-US; cero raw keys,
  errores de consola u overflow. Warm dev p50/p95: Monitoring 448/480 ms, Mentions
  432/502 ms, T&N 435/1177 ms.
- Checks: Query Engine 251/251; DB 74 pass + 15 opt-in skip; Studio 328 pass + 1 skip,
  build 18/18, lint 0 errores/14 warnings existentes; PostgreSQL focal 10/10; smoke
  0000–0072 (73 migraciones, 60 tablas, 48 índices); `git diff --check` verde.
- Evidence/hash: browser canary
  `sha256:71d36c7ce6001e0e91698f3ea4205e29f896b87eb05f64ceb0452a667b49dc43`;
  shadow post-0072
  `sha256:29119755b51dd83962c0afd238908660c462c6cb6810544799b9480ade9eff49`;
  apply JSON
  `sha256:d2d282e7e9e66a5b4c5649387892a2beee3963dea75736a5200b685548f91f21`;
  verify JSON
  `sha256:0778e64a419af4976432f20aa2840aff29c9e808856d4bcbcb0fcf04dcec31d4`;
  Advisor packet
  `sha256:b6652657a24fb3803b68042fd2d1c07cf131026d50066d8c5d370ab715cc798e`;
  última revisión
  `sha256:5272d3cd60f20bf9d7f19f12ba78283d6e00762404374217e3064c63e184339d`.
- Advisor verdict/spend: `approve_with_p2_p3`, `can_advance=true`, cero P0/P1.
  Revisión final: 79,364 input / 2,111 output / USD 0.89919. Se registraron dos
  respuestas 05C porque la primera terminó sin stdout visible y se reintentó antes de
  detectar sus artefactos; la primera costó USD 0.91364 y conserva hash en el ledger.
  Acumulado explícito: USD 5.10331 / USD 20.
- Open findings no bloqueantes: repetir QA manual de cursor con un periodo governed
  >100 cuando exista esa fixture; perfilar el outlier p95 de T&N en build de producción
  antes de Gate E; monitorizar retiros de bindings; mover el drainer shadow a un proceso
  supervisado antes de producción.

### 06

- Estado: `passed`. 0073, contratos, policies, derivaciones, binding sets y shadow
  governed-only quedaron verdes localmente y en `noisia-staging`; Advisor autorizó
  avanzar con cero P0/P1.
- Migración: 0073 forward-only aplicada/verificada exclusivamente en staging, SHA-256
  `8cc2d1c5ae3338cb6189f13b851c96474329159358d0f0c7d3bec17284158cae`;
  39/39 sentinels, 12/12 markers y un ledger. Apply JSON
  `sha256:ef58d453638f5103eb6daecb8e954ec08c450bfa93869d112ae84a76cea36c9d`;
  verify JSON `sha256:498f2351049607d8fc2ca9732640d22af4b7d3a4f2847e0418843f2d6694a347`.
- Views/policies/bindings: `competition`, `category` y `all-governed`, cada una con
  bindings atómicos para Monitoring, Mentions y T&N; 9 bindings y 9 population refs
  distintas. Lifecycle real por view: promote → withdraw-to-absence → re-promote.
  Brand conserva sus tres bindings y su bridge; ningún pointer se movió.
- Counts/coverage/denominators: competition 184, category 51, all-governed 483 raíces.
  La unión all-governed fue exacta y deduplicada: expected=actual=483,
  missing=extra=duplicates=0; antes de dedupe: primary_brand 276, competitor 184,
  category 51. `governance_unknown_count=0` en las nueve compilaciones current/ready.
- AuthZ/cursors/evidence: el browser sólo puede enviar el enum cerrado `view`; IDs de
  authority/read mode/SQL se rechazan. Non-brand no cae al bridge. Cursor, ETag y
  population ref fueron distintos para cada view en los tres módulos. Evidence textual
  usa la capability de Mentions de la misma view. Shadow normal/inverso corrió en
  `REPEATABLE READ READ ONLY`, no siguió el pointer operacional y obtuvo
  `unexplained_count=0`.
- Recuperación: un primer intento falló por una columna incorrecta en el proof del
  rehearsal. La compensación guarded retiró únicamente bindings creados por esa
  invocación y demostró `restored_initial_absence=true`, `unsafe_views=[]`; el reintento
  posterior fue limpio. El runner no re-promueve después de un retiro del operador.
- Invariantes: protected-state e inputs de compilación conservaron respectivamente
  `sha256:d7a2773c9be26c5751713994c43e814246dcfb56531979d48ed20f084e427178`
  y `sha256:fbe62f519b7c80bc5d1a1445389dff161e5ed3fbe27a75bd482af1bc02a96e36`.
  V1 18,996/927, base brand 276, Review/assertions, brand bindings, otros workspaces,
  pointers y producción quedaron intactos.
- Checks: Query Engine 257/257; DB 74 pass + 17 opt-in skip; Studio 343 pass + 1 skip;
  PostgreSQL multi-view 4/4; integración 0073 y runner 1/1; smoke 0000–0073
  (74 migraciones); lint 0 errores/14 warnings preexistentes; `git diff --check` verde.
- Evidence/hash: rehearsal apply sanitizado
  `sha256:6c9da118574fb300f3447201e46d7478fd0a4cd043c3e7f68db07efe36f4d696`;
  verify independiente read-only
  `sha256:807f3f16807f0d88ebea87b300376d2f9a1f5fbc45700cb974b454e9cdb9f4dc`;
  packet Advisor
  `sha256:610164cb2aa475054738e291945737e0765fcf367c5625fa88d416f0f202974d`;
  review Advisor
  `sha256:c6ee18c2dd1591cbae8e8de97ea86a7fa844b607ab328adeb6613a1952e97b3b`.
- Advisor verdict/spend: `approve_with_p2_p3`, `can_advance=true`, cero P0/P1.
  115,952 input / 4,075 output / USD 1.36327. Acumulado USD 6.46658 / USD 20.
- Open findings no bloqueantes: en 0074 endurecer `governance_unknown_count` para que
  governance no resuelta sea null/not_available, no cero; invalidar dependencias
  primary_brand ante cambios de `signal_workspaces.brand_id/status`; derivar coverage
  completa en vez de dejar `partial` constante; documentar queryables externos del
  writer; durable non-brand post-response shadow y selector frontend quedan para el
  rollout posterior, no como autoridad de este gate.

### Gate D foundation preflight (checkpoint histórico)

- Estado: `blocked`. La foundation está `staging_verified` y el GET gratuito terminó
  correctamente, pero `ready=false` y `launch_authorized=false`; este checkpoint no
  está verde.
- Migración: 0074 aplicada/verificada exclusivamente en `noisia-staging`, checksum
  `1eb15739c17a17fb4c4f9924971447fbcb6a26bcfa6cfc68cf7847f5b5e13d69`;
  108/108 sentinels, 8/8 markers, ledger único y verify read-only
  (`writes_performed=false`). Direct/pooler reconciliaron mismo proyecto/estado. Restore
  point verificado de `2026-08-11T14:17:07Z`, edad observada 20.2 h.
- Invariantes: aggregate protegido before/after
  `sha256:4f007cb4a08caf96824f1036684d9d012050ba2ecf28039d1fcf0f6394c6f63e`;
  V1 18,996/927, base semántica 276 y 12 bindings/12 compilaciones current quedaron
  idénticos. Cero nuevas filas estratégicas, jobs, runs, snapshots, pointers, readers,
  provider calls, LLM/T&B o producción.
- Contrato: GET puro en `REPEATABLE READ READ ONLY`; POST recomputa autoridad y sólo
  acepta periodo/timezone/study size/business inputs/hard cap/digest, nunca IDs de
  policy/population/binding/compilation. Polling GET no encola; cancelación es durable;
  Review+release draft y promoción de release current son operaciones V2 atómicas e
  idempotentes.
- Free preflight: `read_only=true`, `writes_performed=false`, `jobs_enqueued=0`,
  `provider_calls=0`, protected counts before/after iguales. Inventario: cero current
  bindings estratégicos y cero rutas de provenance que autoricen ambos usos.
  `blocking_reasons`: `provider_authority_unavailable`,
  `strategic_governed_binding_unavailable`, `strategic_recovery_not_ready` y
  `strategic_worker_not_alive`.
- Snapshot candidate: `null`; population, authority, sample, denominator, coverage,
  provider, budget, destinations y preflight digest permanecen null hasta resolver la
  authority. No se congeló ningún snapshot.
- Worker/queue readiness: queue configurada y provider key disponible; Worker no vivo y
  recovery no listo.
- Estimated run budget: `null`. El hard cap diagnóstico de USD 1 no fue autoridad del
  operador; no se reservó ni gastó presupuesto T&B.
- Rights gate: la decisión staging de 04B no autorizó `llm-processing` ni
  `strategic-analysis`, y el inventario confirmó cero rutas que autoricen ambos. Se
  requiere una decisión explícita posterior; la autorización técnica general de
  staging no crea esos derechos.
- UI flight card: no entregable mientras `ready=false`; primero se resuelven authority,
  Worker/recovery y se repite el GET hasta obtener population, periodo,
  denominator/coverage, plan cerrado, readiness y hard cap reproducibles.
- Checks: Query Engine typecheck + 260/260; DB typecheck + 74 pass/19 integraciones
  opt-in skip; integración PostgreSQL 0074 y runner 1/1; contrato estratégico focal
  13/13; Studio typecheck + 357 pass/1 integración skip con DB sintética no alcanzable,
  build 18/18 y lint 0 errores/15 warnings preexistentes; Workers typecheck + 167 pass/3
  integraciones skip; `git diff --check` verde. El primer `studio test` sin
  `DATABASE_URL` salió 1 por el guard de entorno; el mismo suite salió 0 al proveer una
  URL local sintética, sin conectar una base ni hacer operaciones remotas.
- Evidence/hash: migration preflight
  `sha256:3e1391fa1b50f1a960148e183a0cf39f9c248572c71fb679eca50792d969a473`;
  apply `sha256:03ba25cbd58bc01f52d87573d8d51cac1043e68bbf531370ae3e16335fb81311`;
  verify `sha256:7065b478c374cd25b8d26a00606169522e0132c0aad35d03f1a2a1079a8943fb`;
  free preflight sanitizado
  `sha256:f2dd2087743634dd4ec94897572c64df5e0bb573b8aaf25ea15565efa2602479`;
  private artifact hash referenciado
  `sha256:e90b3de9edce86bc441148421b2f3d120f73571d2c289a26fe93990acafdf96e`;
  Advisor packet
  `sha256:f2cbcf3660812755607b6ebfe73963d97ea392314baee3bc05190432c87d4a6f`;
  re-review focal sanitizado
  `sha256:2c03af68efd8ea23cdbf6d7b8325c5b54d95193a5357defa3a16e78b74046b9c`.
- Advisor verdict/spend: primera revisión 107,349 input / 3,368 output / USD 1.24189;
  re-review focal 10,091 input / 1,803 output / USD 0.19106; acumulado USD 7.89953 / USD
  20. Veredicto `approve_with_p2_p3`, `can_advance=true`, cero P0/P1.
- Open findings no bloqueantes para apply/preflight gratuito: P2 por posible frontera
  IEEE-754 exacta entre el `ceil` TypeScript y `numeric` PostgreSQL (el camino actual
  falla cerrado; cerrar con aritmética exacta/property tests antes de una corrida pagada)
  y P3 para reforzar `settlement <= reservation`.
- `READY_FOR_GATE_D_OPERATOR` en ese checkpoint: false

### Backend 07 · Gate D unblock

- Estado: `passed`. Exclusivamente en `noisia-staging` y el workspace Laika, el GET
  gratuito autenticado devolvió `ready=true`, `launch_authorized=true`, cero blockers,
  `writes_performed=false`, `jobs_enqueued=0` y `provider_calls=0`. No se ejecutó el
  POST, no se congeló snapshot y no se inició una corrida T&B.
- Restore/target: direct `sha256:594e5c…2a19`, pooler `sha256:0630a1…815` y project-ref
  `sha256:030c5a…aa32` reconciliados. Restore nuevo y restorable de
  `2026-08-12T14:21:13Z`, verificado antes de las escrituras; reference hash
  `sha256:125e54…99847`.
- Migraciones: 0075 `staging_verified`, checksum
  `sha256:a364841b20228025b91d9b032fd77ce14dc46027ed0e90d7bfc87af0b3fe6b9e`;
  elimina cálculo monetario IEEE-754 y exige paridad micro-USD exacta y
  `settlement <= reservation`. 0076 `staging_verified`, checksum
  `sha256:270a6d265202b14f329a6db36c1466b9d6426e23f825c0c97cfda455e785c759`;
  introduce/protege la base semántica estratégica neutral sin tocar populations ni
  pointers operacionales. Ambos verify fueron read-only y conservaron el aggregate
  protegido `sha256:9c411b…21cfa`.
- Rights: nueva versión `laika-staging-client-usage@2`, sin modificar la v1. Cuatro
  bindings import-specific cubren únicamente imports contribuyentes actuales; conservan
  `client-derived-metrics`, `client-mention-list`, `client-text-or-excerpt` y añaden
  exactamente `llm-processing`, `strategic-analysis`. No autorizan `internal-qa`, no se
  heredan a futuros imports y expiran el `2026-08-19T16:57:26Z`. Quality/retention
  vigentes fueron reutilizadas; retention permite la ventana completa.
- Authority: bundle/binding `triggers-barriers/strategic`, visibility
  `strategic-internal`, population dedicada `purpose=analysis`, current compilation
  `ready`, governance unknown=0 y próxima transición temporal sellada. La unión exacta
  primary-brand + competitor + category tiene 483 raíces canónicas, aliases=0,
  unattributed excluido y membership digest
  `sha256:43f27f99a52129b11c96dae36df69daaf4194365190567c4c214068b8f5021cc`.
  Se creó un único corpus de ejecución server-owned vacío; no contiene menciones ni
  constituye un snapshot/run.
- Operacional protegido: las 12 compilaciones y bindings operacionales conservaron
  exactamente sus population refs, memberships, digests y coverage: brand 276,
  competition 184, category 51 y all-governed 483 por cada uno de los tres módulos.
  V1, Review/assertions, readers, flags y pointers no cambiaron; producción no fue
  leída ni modificada.
- Queue/Worker: auditoría previa read-only confirmó active/delayed/paused/prioritized/
  waiting/waiting-children=0 y cero estado DB no terminal. Permanecen dos tombstones
  históricos `failed`, no consumibles y sin tocar. El proceso supervisado comprobó cero
  trabajo antes de crear Worker, luego levantó Worker T&B, heartbeat y los dos drainers
  sin drenar ni reencolar al arranque. Worker y recovery están listos; jobs/provider
  calls siguen en cero.
- Flight card: periodo `2025-07-14`–`2026-07-24`, timezone
  `America/Mexico_City`, tamaño `medium`; denominator 483; coverage `partial` con
  abstained `not_available/count=null`; provider Anthropic, modelo
  `claude-sonnet-4-6`, pricing `anthropic-public-2026-08-12` (USD 3/M input,
  USD 15/M output), 120,000 input tokens máximos por call; estimate USD 11.13,
  hard/server cap USD 15; preflight digest
  `sha256:1896c63aae5fd647740c56741f7ccbbf82e122ff3cc4b7a7d44bed722607f9aa`.
- HTTP/UI: el operador interno abrió la superficie canónica de Reports y ejecutó sólo
  “Comprobar preflight”. El GET respondió 200 y la card mostró 483, coverage partial,
  modelo pinneado, USD 11.13 y Worker listo. La confirmación quedó desmarcada y no se
  pulsó “Iniciar corrida”.
- Checks: Query Engine typecheck + 263/263; DB typecheck + 74 pass/21 opt-in skip;
  Studio typecheck + 357 pass/1 skip, build 18/18, lint 0 errores/15 warnings;
  Workers typecheck + 167 pass/3 opt-in skip; integraciones 0075/0076, paridad exacta
  property/fuzz y `git diff --check` verdes.
- Evidence/hash: restore sanitizado
  `sha256:f8d1038bda1f768489780ac3505189974179bab362902eab11fe656cdc2cd4c0`;
  authority `sha256:53ff8b3893ba4225e6501b0963216cc2b80902e69f208931fb4ebb82e57f4dc2`;
  queue audit `sha256:5039cba7b5bb3d539395876c3967afffd882bd70c3343a62f927ae9578d8a6e5`;
  supervisor `sha256:0058d07007b21a60dc008d68fa4fe16fa8cc1729bedb2f6b1c5c9b34ee65586e`;
  free preflight sanitizado
  `sha256:7f99008779ecf55c1a77409d46836228b172d640a0843b5c5c354388c30ea22d`;
  Advisor final sanitizado
  `sha256:5210bceee72384e627ef416f91b9e35faaa1fab230ac28e71684bb24913cd302`.
- Advisor: revisión final encontró un P1 de orden de arranque; se corrigió para exigir
  las colas/DB vacías antes de crear Worker o drainers. Re-review focal con
  `claude-fable-5`: 9,131 input / 2,070 output / USD 0.19481,
  `approve_with_p2_p3`, `can_advance=true`, cero P0/P1. Acumulado Advisor:
  USD 10.32320 / USD 20.
- Riesgos no bloqueantes: dos records terminales `failed` permanecen para auditoría;
  los scripts staging tienen rutas canónicas locales y TLS de preview acotado al runner;
  la population de analysis es estado derivado draft/current, no un pointer; los
  procesos supervisados locales deben permanecer vivos hasta que el operador decida.
- `READY_FOR_GATE_D_OPERATOR`: true

## Resume instruction

Al reanudar después de compactación: lee el canon, esta bitácora y el evidence señalado
por el último checkpoint. No repitas gates marcados `passed` salvo que sus hashes o
invariantes hayan cambiado.

### Backend 09 · Greenfield Productization End-to-End

- Estado: `passed`, `GREENFIELD_PRODUCTIZED_READY_FOR_OPERATOR_QA=true`.
- Migrations: 0077 checksum
  `64b8302b598744807e6dba2aafd0d3e99f8e49192767cbcc82f70e02921f128c` y 0078
  checksum `5496e56013711267fe009298ee4ba69b9a43f1cade4335a8d89a14af7c40b96e`
  aplicadas exclusivamente a `noisia-staging`. Direct/pooler/project reconciliados,
  restore nuevo de 11.1h, 9/9 sentinels, ledger exacto y protected hash
  `sha256:29dd3b…a5cc8` idéntico before/after.
- Producto: Admin opera governance, provenance, category/reference, timezone, imports,
  Semantic Review, la matriz de governed views, authority estratégica y releases sin
  SQL ni scripts de rehearsal. El navegador no envía IDs de population/policy/binding.
- Rehearsal local: marca sintética, 0000–0078, handlers reales, 5 raíces + 1 alias,
  Review, doce compilaciones/bindings, Signal governed, authority/preflight, resultado
  determinista simulado, Review V2, draft r1, promote y consumo del release; cero jobs o
  proveedores.
- Rehearsal staging: marca `QA Greenfield Product 09 Staging`; quality/retention/
  licensing/provenance decididas desde Admin; 1 import, 5 raíces, 6 assertions aprobadas,
  una raíz multi-entidad y una unattributed. Quedaron 12 bindings operacionales current
  y 1 estratégico; denominadores 2/2/1/4; tres readers visibles gobernados probados.
- T&B: GET gratuito `ready=true`, `launch_authorized=true`, denominator 4, coverage
  `partial`, modelo `claude-sonnet-4-6`, pricing `anthropic-public-2026-08-12`, estimate
  USD 4.41 y hard cap USD 15. Worker, heartbeat y ambos drainers listos. La confirmación
  quedó desmarcada, el botón permaneció disabled y no se ejecutó POST.
- Invariantes: queue waiting/delayed/active/paused/prioritized=0; run controls, analyses y
  ambos outboxes=0; provider calls=0; paid cost USD 0; producción/pointers intactos;
  Alexa no creada; no commit/push.
- Evidence: `.data/noisia-greenfield-productization/backend-09/`, manifest con hashes y
  permisos 0600.

### Backend 09 P0 · Workspace async CSV import recovery

- Estado: `passed`, `staging_verified`. 0079 checksum
  `dbd1c0d32760666f7d81ea510e271cda2aaf31d29ec38c44250f7337cc242246` y 0080 checksum
  `b17b63a1f7c153338ea16758c1ed01b89fc8dd5c1f7cc1b66f291e8950413ed7` están aplicadas
  únicamente en `noisia-staging`. Restore point privado SHA
  `df6ae456c6fd08f14da79bb79a22184f84baa5a4469b715b7014d2286335af91`; protected hash
  `sha256:0b81daae5688ecae1291f2bf02f3714ce9a59490467fa6d431321eb3c427159e`
  idéntico durante el apply de 0080.
- Producto: el browser sube directamente a storage privado en partes firmadas de 48 MB;
  Studio devuelve 202 y polling; outbox + BullMQ + Worker CSV canónico procesan fuera de
  la request. El parser, normalizador, deduplicador, inserción y provenance tienen una sola
  implementación en `infrastructure/db/sentione-csv-ingest.ts`; Worker y Studio son
  adaptadores de pool. Admin muestra upload/queued/processing/progreso/completed/failed y retry.
- Fail-closed: migrations, readers de Admin/Review y populations exigen provenance de un
  batch `completed`. Conteos finales, acceptance, watermark, sync e invalidaciones sólo
  se publican al completar. Provenance/disposition se persiste antes de cualquier lookup
  que pueda quedar visible tras un crash.
- Local: archivo real de 91,890,499 bytes y 13,595 registros; aborto a 7,500, restart a
  5,000, replay de la misma job identity y recuperación de 5,500 roots. Resultado
  4,345 incluidos + 572 excluidos + 8,678 duplicados, un completed, un failed, un
  watermark/sync/invalidation y cero outbox huérfano. El rerun final sobre el core
  consolidado produjo 395.08 records/s, 2.67 MB/s y estimación 717 MB de 4.48 min.
- Staging: seis intentos failed permanecen auditables; exactamente un completed para el
  SHA esperado. Resultado 13,595 = 0 + 0 + 13,595; 10,417 roots con provenance aceptada,
  failed-only roots=0, watermark=1, sync=1 y dos invalidaciones contractualmente distintas
  emitidas una vez cada una. Queue final waiting/active/delayed/paused/prioritized=0;
  orphan import jobs=0. Admin Mentions y Semantic Review cargan el estado aceptado.
- Performance: processing remoto 124.01 s (0.74 MB/s); proyección lineal de 717 MB
  ~16.1 min. Local ~4.5 min. Upload usa quince partes para 717 MB y reintenta sólo la
  parte fallida; no existe una conexión HTTP de Studio de cientos de MB.
- Checks: Query Engine typecheck + 263/263; DB typecheck + 74 pass/23 opt-in skip;
  integración PostgreSQL 0079/0080 1/1; Studio typecheck + 358 pass/1 skip, build 18/18,
  lint 0 errores/13 warnings; Workers typecheck + 167 pass/3 opt-in skip; migration smoke
  0000–0080 (81 migraciones); `git diff --check` verde.
- Invariantes: producción no leída ni modificada; T&B/LLM/Voyage/providers no ejecutados;
  jobs pagados=0; pointers/promociones=0; no SQL ad hoc borró filas parciales; no
  commit/push.
- Evidence: `.data/noisia-workspace-async-import/backend-09-p0/`, manifest y artefactos
  sanitizados en modo 0600.

### Backend P0 · Semantic Review y Resolution para 100K+

- Estado: `passed`, `staging_verified`. 0082 checksum
  `f000bfffe4378c36dad444aaf18235e9ce7ba50cff83c87803f519096b024c25` y 0083 checksum
  `66049da1460b295ae00ec8b1b6d7ea9000d9b8894ef28c5cd15a20648c52e7cd`
  aplicadas exclusivamente a `noisia-staging`, con ledger único por ordinal. Restore point
  scheduled físico de `2026-08-13T14:26:28Z`; producción no fue consultada.
- Read model: proyección Alexa generación 1, 109,056 raíces, snapshot/population digests
  no nulos e incomplete provenance 0. GET limit 50 usa cinco queries; p95 warm first/cursor/
  filter = 427.7/287.9/415.9 ms. Plan: index scan, 51 filas, cero temp blocks.
- Preflight: read-only en 512.5 ms; 109,056 elegibles/unresolved, 24,577 determinísticas,
  84,479 ambiguas, tres child batches, estimate USD 327.233340. Hard cap observado USD 40
  produce `confirmation_required`; cero runs nuevos, jobs, provider calls y gasto.
- Runtime/UI: cola `noisia-semantic-resolution-local` aislada del query-engine legacy,
  worker/heartbeat/recovery vivos y child resolution queue sin non-terminal/failed jobs.
  Alexa carga en Admin; `Resolver` aparece habilitado tras la cola, el flight card declara
  el costo completo y el botón POST permanece disabled ante cap insuficiente.
- Monitor: `services/workers/scripts/monitor-signal-semantic-resolution-readonly.ts` observa
  parent/children, outbox, leases, heartbeat, tokens, estimate/reservation/actual, headroom y
  errores sin mutar. La DB impide contractualmente dispatches por encima del hard cap.
- Invariantes: producción/pointers/Signal visible intactos; LLM/Voyage/T&B/provider calls=0;
  spend USD 0; no commit/push.
- Evidence: `.data/signal-semantic-review-100k/backend-p0/`, manifest SHA-256
  `6be804433fa73526d7b2169d6acfa55ce78a768cb6691a7d216d6e02952c2e00`, archivos 0600.

#### Pausa segura · 2026-08-13 noche

- Estado de la misión: `paused_safely`; el resultado técnico de staging está verificado,
  pero el handoff final permanece pendiente hasta reactivar el runtime y hacer una última
  lectura de continuidad. No se ejecutó ningún POST de Resolution.
- Estado durable: Alexa conserva la proyección `ready`, generación 1 y 109,056 raíces.
  Sus resolution runs activos=0, child outbox activos=0 y provider batches=0. Antes de
  apagar, BullMQ tenía waiting/active/delayed/paused=0. Studio local y el supervisor
  semántico se detuvieron de forma ordenada; el heartbeat expirará naturalmente.
- El shutdown dejó un lease de proyección de otro workspace sin job activo. Se devolvió a
  `failed` recuperable mediante `fail_signal_semantic_review_projection_v1`; leases de
  proyección finales=0 y no se borró ninguna fila. Una corrida `partial` preexistente del
  2026-08-07 pertenece a otro workspace, no tiene child outbox/provider batch activo y no
  fue mutada.
- Validación completada antes de pausar: Query Engine typecheck + 267/267; DB typecheck +
  74 pass/25 opt-in skip; Studio typecheck + 359 pass/1 skip, build 18/18 y lint 0 errores/
  13 warnings; Workers typecheck + 168 pass/3 opt-in skip; integración PostgreSQL 120K 1/1;
  smoke 0000–0083 (84 migraciones); OpenAPI 433 refs resueltas/54 operationIds únicos;
  `git diff --check` verde.
- Al reanudar: (1) confirmar de nuevo projection `ready` y colas vacías; (2) arrancar sólo
  `signal:semantic-review:staging-supervisor` con target/approval staging y queue
  `noisia-semantic-resolution-local`; (3) esperar heartbeat; (4) arrancar Studio en 3001;
  (5) repetir el GET/verificador y el QA visual, sin POST; (6) regenerar hashes si cambia
  cualquier evidence; (7) emitir el veredicto final. No reaplicar 0082/0083 si ledger y
  checksum continúan exactos.
- Stop conditions al reanudar: cualquier resolution child no terminal, provider batch,
  queue activa, projection distinta de `ready`, digest distinto o gasto no cero. No
  consumir ni limpiar trabajo desconocido; documentar y detenerse.
- Evidence de pausa: `.data/signal-semantic-review-100k/backend-p0/safe-pause.sanitized.json`.

#### Reanudación y cierre · 2026-08-14

- Estado: `resumed_verified`; Alexa conserva `ready`, generación 1, 109,056 raíces,
  snapshot `sha256:5f13c34ea23e3c4fc830a2fbd9a7b77f90a97df598ed6ba5e244e2a9d1f2d99b`
  y population `sha256:46dcc771f4cd1a98c1b4267b0d92b6efdccffe9715abd616d32921ece6c12d03`.
  Dirty roots, provenance incompleta, active runs, child outbox y provider batches son 0.
- El supervisor arrancó con fingerprint direct staging exacto, queue semántica local aislada,
  heartbeat y ambos drainers. Un refresh inválido de otro workspace expuso que los dos paths
  de error casteaban `$3::jsonb` aunque `fail_signal_semantic_review_projection_v1` recibe
  `text`; ambos se corrigieron y el test impide reintroducir el mismatch. El refresh agotó
  sus reintentos y quedó `dead_letter`, sin lease ni trabajo no terminal. Alexa no fue mutada.
- Recheck directo/pooler: cold 861.5 ms; p95 warm first/cursor/filter
  427.7/287.9/415.9 ms; cinco queries; plan `Index Scan`, 51 filas y cero temp blocks.
  Preflight 512.5 ms, 109,056 elegibles, tres batches y USD 327.233340. Con cap USD 40 el
  único blocker es `semantic_resolution_hard_cap_insufficient` y el botón pagado sigue
  disabled. Writes, jobs, provider calls y spend continúan en 0.
- QA localhost: la cola mostró 30 de 24,577 candidatos, `Cargar más`, `Resolver` habilitado
  sólo después de cargar y ningún error temporal ni de consola. El flight card declaró las
  109,056 seleccionadas, el estimate completo, el cap, Worker/Recovery disponibles y cero
  side effects; recarga warm completa 3,455 ms. No se ejecutó POST.
- Checks posteriores al fix: Workers typecheck y 168 pass/3 opt-in skip; Studio typecheck y
  359 pass/1 skip; `git diff --check` verde. Las suites completas, build, integración 120K,
  smoke 0000–0083 y OpenAPI del checkpoint anterior continúan aplicables porque no cambió
  DB, Query Engine, contrato HTTP ni UI productiva.
- Evidence adicional: `resume.sanitized.json`; manifest
  `sha256:6be804433fa73526d7b2169d6acfa55ce78a768cb6691a7d216d6e02952c2e00`;
  nueve artefactos con hashes verificados y modo 0600.
