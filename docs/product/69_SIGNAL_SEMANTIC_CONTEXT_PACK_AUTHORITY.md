# Signal Semantic Context Pack Authority — Backend 10C.3B-A / NOI-71

| Campo | Valor |
|---|---|
| Estado | `frontend_69b_implemented_local` |
| Registrado | `2026-08-22T01:00:09-06:00` (`America/Mexico_City`) |
| Scope | Backend/control plane local |
| Migración | `0091_signal_semantic_context_pack_authority.sql` |
| Provider calls | `0` |
| Serving writes | `0` |

## Veredicto ejecutivo

El Semantic Context Pack ya tiene una autoridad estructurada, versionada y append-only.
Convierte únicamente decisiones legibles y evidence refs exactas de Brand OS/Knowledge
en un pack publicable. No concatena Knowledge a menciones, no crea otro corpus y no usa
confidence como autoridad.

Este gate no ejecuta provider. El adapter futuro sólo podrá producir propuestas
`pending`, acotadas a una generación por snapshot. El frontend 69B puede consumir los
contratos management-only sin inventar ownership, digests, provider configuration o
estados.

## Data flow y authority boundaries

```text
Brand OS snapshot ─┐
Knowledge digest ──┼─> draft generation ─> pending element versions
Locale/market ─────┘             │
                                 ├─> approve/reject successors
                                 ├─> corrected successor (pending)
                                 └─> explicit publish ─> immutable pack digest

No path: Semantic Context Pack -> assignment / record_tags / Topic Contract / serving
```

`analysis_artifacts`, `analysis_evidence_groups` y `analysis_evidence_links` conservan el
lineage. El nuevo discriminator `workspace_artifact_kind=semantic_context` evita fingir
un `study_corpus_id` o `discovery_run_digest`.

## Lifecycle

1. `createSignalSemanticContextDraftV1` relee Brand OS, Knowledge y Acquisition Brief
   bajo lock/transaction SERIALIZABLE.
2. `appendSignalSemanticContextProposalsV1` es server-only, valida cada ref contra el
   workspace y crea artifacts/evidence antes del elemento registrado.
3. approve, reject y edit crean successors. Confidence `1.0` permanece informativa.
4. bulk approval requiere una lista explícita, deduplicada y acotada a 100.
5. publish relee digests current, exige cero pending y al menos un approved, y sella el
   digest determinista del pack.
6. Brand OS/Knowledge/locale drift no cambia historia; readiness pasa a `stale`.
7. Una reconciliación crea otra generación que apunta a la publicada anterior.

Una generación publicada no permite `UPDATE/DELETE`. Los elementos y eventos nunca se
mutan; effective `superseded` se deriva de la existencia del successor.

## Elementos y relaciones cerradas

Los 20 tipos autorizados son identidad, alias, producto, feature, surface, categoría,
need, benefit, friction, usage occasion, competitor term, locale variant, exclusion,
homonym, ambiguous term, abstention rule, tres anchors y typed relation.

Las relaciones iniciales son `is_a`, `part_of`, `surface_of`, `competes_with` y
`associated_with`. SQL y TypeScript rechazan tipos abiertos.

## API management-only

La base `/api/data-os/signal/{workspaceId}/semantic-context` ofrece generación,
readiness, diff, preflight, decisiones y publication. Los writes requieren
`Idempotency-Key`; el actor siempre viene de la sesión. Los schemas son strict y no
aceptan workspace/profile/Knowledge UUIDs, digests, prompt, modelo o pricing.

El preflight devuelve un máximo de una llamada, estimate y hard cap server-owned. En
este gate sólo se verificó `provider_calls=0` y `writes_performed=false`.
El focused read conserva origin, timestamps y lineage; actor, entidad y evidence refs se
pseudonimizan y nunca expone bloques Knowledge, prompt privado o UUIDs de autoridad.

## Invariantes verificadas en PostgreSQL

- migration smoke limpio `0000–0091`;
- confidence alta no aprueba;
- draft/edit/approve/bulk/publish son idempotentes y append-only;
- replay concurrente con la misma key converge al mismo resultado;
- published y element rows rechazan mutación;
- Brand OS y Knowledge drift no reescriben generaciones históricas;
- successor generation conserva lineage;
- cross-workspace falla cerrado;
- digest de serialización canónica coincide entre TypeScript y PostgreSQL;
- classification assignments, `record_tags`, pointers y governed bindings no cambian;
- preflight no crea operation, job, outbox ni provider call.

## Gates posteriores

- 69A.2 quedó implementado localmente el 2026-08-22 mediante 0092. Respeta preflight,
  hard cap, operación/outbox/recovery y sólo anexa propuestas `pending` por el writer
  canónico. El provider real no se ejecutó; ver
  [doc 70](./70_SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_ADAPTER.md).
- 69B quedó implementado localmente el 2026-08-22 dentro de Brand OS, después de
  Knowledge Base. Reutiliza las superficies canónicas de Admin para crear una
  generación draft, ejecutar el preflight gratuito, confirmar una sola corrida
  provider acotada, recuperar su estado, revisar/editar/rechazar/aprobar propuestas y
  publicar únicamente con cero elementos pending y al menos uno approved.
- El preflight context-aware 10C.3B permanece bloqueado hasta que exista un pack
  publicado real y reconciliado.
- 10D permanece bloqueado.

## Frontend 69B — contrato operator-facing

La UI vive en Brand OS y no crea un módulo AI paralelo. El operador conserva una sola
secuencia legible:

```text
Brand OS + Knowledge current
  -> preparar generación draft
  -> preflight gratuito
  -> confirmar presupuesto y generar propuestas pending
  -> revisar por tipo/status/evidence
  -> aprobar, rechazar o corregir
  -> publicar pack revisado
```

La flight card muestra modelo, pricing, máximo de llamadas, estimación, hard cap,
runtime y blockers. La acción pagada permanece deshabilitada hasta que exista una
confirmación humana explícita. El `run_key` se conserva en session storage para
rehidratar una operación después de refresh y el retry sólo se ofrece cuando el backend
demuestra que el provider no fue enviado.

La tabla y drawer omiten confidence como autoridad, refs privadas, UUIDs, hashes
completos y JSON crudo. La selección masiva está limitada a 100 elementos. Editar crea
otra propuesta pending: nunca convierte la corrección en aprobación implícita. Publish
usa confirmación separada y falla cerrado ante drift.

Validación local de 69B:

- Studio typecheck: pass;
- Studio tests: 374 pass, 1 opt-in skip;
- Studio build: pass, 18 páginas;
- Studio lint: 0 errores y 13 warnings preexistentes;
- focused semantic-context contract: 4/4;
- traducciones `es-MX` y `en-US`: JSON válido;
- `git diff --check`: pass.

No se aplicaron 0091/0092 remotamente, no se llamó al provider y no hubo serving
writes. Por ello el QA autenticado de navegador continúa siendo un gate UAT separado.

## P1 abierto antes de UAT: supersession de draft stale

El control plane detecta correctamente drift de Brand OS, Knowledge o locale, pero el
flujo soportado todavía no puede reemplazar una generación draft obsoleta. Crear otro
draft devuelve `semantic_context_draft_exists`; tampoco existe una acción management-only
para abandonar, reconciliar o superseder ese draft. El mismo bloqueo ocurre si el draft
se creó antes de que existiera el lineage de provider requerido.

Frontend 69B expone el estado y falla cerrado; no lo oculta ni lo repara con estado
local. Antes de desplegar a UAT, backend debe implementar una transición append-only e
idempotente que:

1. preserve íntegra la generación anterior;
2. cree un successor con snapshots/digests y provider lineage current;
3. registre actor, causa y evento de supersession;
4. rechace cross-workspace y replays contradictorios;
5. permita continuar con el preflight sin SQL o scripts especiales.

## Cambios canónicos pendientes de reconciliación

Los docs 31, 56 y 68 ya contenían trabajo preexistente no committeado. Esta misión no los
sobrescribe. Sus anchors a reconciliar después son `Gate 69A — Semantic Context
Authority`, la dependencia `69A -> 69B -> Gate 68` y el estado de ejecución local de
0091. El diseño no cambia esas decisiones: las materializa.

## Checkpoint 69A.3 · supersession de drafts stale

**Registrado:** 2026-08-22T15:05:20-06:00 (`America/Mexico_City`).

El P1 anterior queda resuelto mediante `0093_signal_semantic_context_draft_supersession.sql`.
Una reconciliación nunca actualiza o elimina la generación stale: crea una nueva hoja
`draft`, enlazada por `supersedes_generation_id`, con Brand OS, Knowledge, locale/market
y provider lineage resueltos de nuevo dentro del servidor. La causa cerrada queda en
`supersession_reason` y el ledger registra `generation_reconciled`.

La generación efectiva es la única hoja de la cadena. El writer y el trigger comparten
advisory lock workspace-scoped; el successor único y la versión workspace-scoped hacen
que dos keys concurrentes converjan. Una corrida provider en `queued`, `processing` o
`validating` bloquea la transición. Una generación current produce un no-op que consume
la idempotency key. Propuestas y decisiones históricas permanecen byte-for-byte y no se
copian a la sucesora.

El contrato management-only es `POST .../semantic-context/reconcile`; el browser aporta
únicamente una razón cerrada e `Idempotency-Key`. No aporta snapshots, digests, IDs de
autoridad, modelo, pricing o provider. Frontend 69B presenta `Reconciliar contexto` en
el notice stale y en el preflight bloqueado por lineage, sin ejecutar automáticamente
una propuesta.

## Preview/UAT cut · 2026-08-22T15:34:17-06:00

Las migraciones `0091`, `0092` y `0093` quedaron aplicadas exactamente una vez en el
target auditado `noisia-staging`. Un restore point nuevo fue restaurado en PostgreSQL 17
antes del apply. El hash del estado protegido permaneció idéntico antes/después y las
tablas nuevas continúan vacías: cero generations, elements, events, proposal runs y
proposal outbox rows. Studio y Workers publicaron el commit `0b8510d`; ambos deployments
reportan `Active`, el deep health de Studio está verde y el Worker UAT inició con cinco
colas `-uat`, cero jobs ejecutables y cero outboxes reclamables.

La comprobación visual autenticada quedó pendiente porque la sesión Kinde del navegador
expiró al recargar después del deploy. No se intentó eludir AuthN ni usar credenciales.
No se creó un draft UAT, no se ejecutó `POST /proposals` y no hubo provider calls, paid
jobs, publicación ni serving writes. Este checkpoint no abre 10C.3B ni 10D.
