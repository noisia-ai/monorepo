# Signal Topic Discovery — Operator Review Workbench

| Campo | Valor |
|---|---|
| Estado | `staging_verified_pending_operator_review` |
| Registrado | `2026-08-21T17:02:18-06:00` (`America/Mexico_City`) |
| Gate | `10C.3A-R` |
| Superficie | Admin interno, nunca Signal cliente |
| Holdout | `sealed` |
| 10C.3B / 10D | no autorizados |

## Veredicto

El workbench convierte el packet ciego 10C.3A en una revisión operatoria canónica sin
crear una autoridad paralela. Reutiliza el analysis artifact/evidence graph, los
primitives Admin, `WorkspaceDrawer`, AuthZ DB-owned y el ledger idempotente de governance.
Una propuesta sigue siendo `pending`; guardar o finalizar una rúbrica no crea Topic
Contracts, assignments, tags ni serving.

0090 quedó aplicado exactamente una vez en Preview/UAT y el packet real fue registrado
server-side con replay idempotente. El navegador autenticado reconcilió 115 proposals
paginadas, 805 evidencias cluster registradas, 5 muestras de outliers y progreso inicial
0/115. La finalización real continúa expresamente prohibida; sólo el fixture PostgreSQL
pequeño recorre cierre, export y supersession.

## Arquitectura y autoridad

```text
10C.3A packet privado (holdout sealed)
  -> registration server-owned + hash/rights/workspace checks
  -> analysis_artifact packet
       -> proposal artifacts pending
       -> canonical-root evidence links
  -> review ledger append-only
       -> drafts humanos
       -> finalización atómica
       -> supersession correctiva
  -> exports contractuales

NO -> Topic Contract / classification assignment / record_tags
NO -> pointer / governed binding / Signal serving / 10C.3B / 10D
```

`analysis_artifacts` conserva ownership mutuamente exclusivo:

- Study OS histórico: `study_corpus_id + tb_analysis_id|engine_analysis_id`;
- Discovery workspace-owned: `workspace_id + discovery_run_digest`.

No se fabrica un Study OS ni se copia texto canónico. Los evidence links apuntan a
canonical roots y conservan locator/redacted excerpt del packet. El graph queda
inmutable una vez que existe `signal_topic_discovery_review_packets`.

## Registration privada

El runner `signal:topic-discovery-review:register` ofrece `preflight | apply | verify`.
Antes de escribir comprueba:

- target directo, pooler y storage = `noisia-staging` por fingerprint;
- restore point verificado menor a 24 horas;
- checksum y aplicación exacta de 0090;
- manifests 10C.2C/10C.3A, packet y candidate artifacts inmutables;
- export original `REPEATABLE READ READ ONLY`, providers/writes = 0;
- holdout `sealed` y candidate role `discovery_proposal_only`;
- workspace desde `workspace_ref` HMAC, nunca por input browser;
- canonical roots desde pseudonym refs;
- completed provenance, latest typed observations y rights `strategic-analysis`
  vigentes, incluyendo expiración efectiva;
- actor interno server-resolved y management AuthZ;
- ausencia de jobs/outbox ejecutables.

El pseudonym key y los archivos privados sólo se leen en el boundary server-owned. No se
persisten en DB, respuesta HTTP, documentación o manifest sanitizado. La operación usa
SERIALIZABLE, advisory lock, idempotency y replay compatible.

## Persistencia append-only

Cada decisión conserva proposal/candidate lineage, cluster key, evidence refs, split,
reviewer server-owned, timestamp, cuatro scores 1–5, merge/split/candidate/none,
notas y decision digest. Todos los campos empiezan `NULL`; no existen defaults humanos.

`none_acceptable=true` es incompatible con
`convert_to_topic_contract_candidate=true`. Un draft queda `draft`; finalizar crea
sucesoras `finalized` dentro de una sola transacción. Una corrección posterior crea una
review revision nueva y preserva filas/events anteriores.

El outlier reservoir tiene decisión separada: estudiar frontera, familias faltantes y/o
recovery posterior. Un outlier no se reetiqueta como noise, rejected o assignment.

## API y performance

Los contratos están documentados en [API Contracts](./08_API_CONTRACTS.md#25-operator-topic-discovery-review-10c3a-r)
y OpenAPI. Son management-only, `private,no-store`, strict y workspace-scoped.

- resumen y runs: respuesta pequeña;
- lista: keyset pagination de 25, máximo 50;
- cursor HMAC ligado al packet y digest de filtros;
- búsqueda sólo sobre términos/frases locales del packet;
- detalle: una proposal y máximo ocho excerpts;
- siguiente detail puede precargarse de forma limitada por el browser, nunca 805 a la vez;
- `Server-Timing` mide operación sin capturar texto.

Presupuestos warm de producto: overview p95 ≤500 ms, lista p95 ≤700 ms, detalle y draft
p95 ≤500 ms. Son objetivos a validar en UAT, no resultados inventados.

## Experiencia Admin

La ruta canónica es:

```text
/studio/brands/:brandId/data/discovery-review
```

El master/detail ofrece resumen, progreso, warning de no-adopción, filtros, tabla
paginada, drawer de detalle, rubric sticky, drafts, anterior/siguiente, `Cmd/Ctrl+S`,
guard de cambios, skeletons, retry, empty/error states y layout responsive. No presenta
el nombre técnico del candidate como contenido principal ni muestra raw JSON, UUIDs,
hashes completos o paths privados.

Finalizar exige census completo, decisión de outliers, actor autenticado y confirmación.
`candidate_preferred` sólo significa que el operador considera útil al candidate para
producir proposals; no lo adopta para propagation o serving. Blind key permanece cerrada.

## Pruebas y flight card UAT

Automatización obligatoria:

1. migration fresh 0000–0090;
2. registro de packet sintético 3 proposals;
3. pagination sin overlap y cursor/filter mismatch;
4. cross-workspace y rights expiry fail-closed;
5. draft replay/incompatible replay;
6. census + outlier + finalización atómica;
7. export sin excerpts/root IDs;
8. direct graph/ledger mutation bloqueada;
9. supersession y replay;
10. cero classification assignments/pointer side effects;
11. hostile browser authority fields rechazados;
12. packet y nested packet digest tampering rechazados.

QA real, sin decisiones humanas fabricadas:

1. abrir Admin y observar skeleton → 115 proposals, 0/115;
2. comprobar 805 evidencias declaradas y 5 outliers;
3. filtrar estado/scope/size/stability y buscar términos;
4. abrir propuestas de distintos scopes/tamaños y vecinos;
5. guardar únicamente un draft QA incompleto sin scores/decisiones;
6. recargar y comprobar persistencia sin incrementar reviewed;
7. probar teclado, desktop y viewport angosto;
8. comprobar retry/error operator-safe;
9. no finalizar el review real;
10. verificar health, zero providers/jobs/serving y read mode legacy.

## Reconciliación documental pendiente

10C.3A-R no sobrescribe archivos dirty de otro workstream. Al reconciliarlos, insertar
un checkpoint aditivo en estos anchors:

- `31_SIGNAL_PRODUCT_NORTH_STAR.md`: tras el checkpoint 10C.3A/10C.2B, aclarar que el
  review es Admin y no adopta artifacts;
- `55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md`: en
  `Discovery → Contract → Propagation`, insertar el workbench humano;
- `56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md`: entre 10C.3A y la autorización 10C.3B;
- `63_NOISIA_V02_CANONICAL_PRODUCT_PROGRAM_AND_DELIVERY_LAYER.md`: en Cadena de
  Inteligencia, separar proposal review de Product Registry/serving;
- `AGENTS.md` y `docs/product/00_README.md`: indexar doc 67 cuando sus owners terminen la
  reconciliación actual.

## Safety state

```ini
SIGNAL_10C3A_OPERATOR_REVIEW_COMPLETE=false
SIGNAL_10C3B_EXECUTION_AUTHORIZED=false
SIGNAL_10D_READY=false
HOLDOUT_OPENED=false
PRODUCT_PROVIDER_CALLS=0
SERVING_WRITES=0
```

## Checkpoint Preview/UAT · 2026-08-21

El deployment `af947b0` cargó la superficie real en el workspace greenfield. La sesión
autenticada verificó:

- primera página de 25 proposals y segunda página acumulada de 50 sin overlap;
- filtros por scope y estado, empty state y búsqueda limitada a términos/frases;
- detalle bajo demanda con 7 evidencias en la proposal inspeccionada, dentro del máximo
  contractual de 8;
- términos, distribuciones, vecinos, limitaciones y lineage operator-safe;
- rúbrica sin scores ni decisiones preseleccionadas;
- un draft QA vacío persistido y rehidratado sin cambiar `0/115`;
- navegación anterior/siguiente y replay por `Cmd+S`;
- reservoir separado con 5 outliers y decisión aún vacía;
- finalización deshabilitada, blind key cerrada y holdout sellado.

Tiempos warm observados —muestras individuales, no p95—: lista filtrada 667 ms y detalle
290 ms. La navegación completa hasta primera página tardó 7,343 ms, por encima del
presupuesto de overview y debe perfilarse antes de tratar ese objetivo como cumplido.

El host del navegador integrado retuvo un ancho mínimo de 1100 px aun con override; la
sesión real validó desktop, mientras el breakpoint angosto quedó como limitación de QA,
no como evidencia inventada. Los breakpoints de 760/460 px permanecen implementados y
las suites de componentes están verdes; un siguiente pase operatorio debe repetir el
viewport angosto en un browser que permita emulación real.

Evidence sanitizada privada:

```text
.data/signal-topic-discovery-review/backend-10c3ar/manifest.sanitized.json
sha256:8797d528deabdf14f7edf96224626b4980b2683c32af1b765d50a99e67d38ce8
```

Estado resultante:

```ini
SIGNAL_10C3A_REVIEW_WORKBENCH_READY=true
SIGNAL_10C3A_REAL_PACKET_LOADS=true
SIGNAL_10C3A_OPERATOR_REVIEW_COMPLETE=false
SIGNAL_10C3B_EXECUTION_AUTHORIZED=false
SIGNAL_10D_READY=false
HOLDOUT_OPENED=false
PRODUCT_PROVIDER_CALLS=0
SERVING_WRITES=0
```
