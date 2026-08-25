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
4. bulk approval requiere 2–15 hojas pending explícitas, únicas, del mismo kind y una
   base de decisión compartida confirmada por el operador.
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

## Checkpoint UAT autenticado · 2026-08-22T18:38:55-06:00

El operador renovó la sesión Kinde de Preview/UAT y el flujo real de Amazon Alexa cerró
la dependencia anterior. Brand OS y los tres bloques Knowledge cargaron bajo el rol DB
`Admin Noisia`; Semantic Context apareció inmediatamente después de Knowledge y creó la
generación draft v1. El preflight detectó correctamente que ese draft legacy carecía de
provider lineage y ofreció la transición soportada, sin borrar ni actualizar la fila.

`Reconciliar contexto` creó exactamente una generación v2 enlazada a v1, con causa
`provider_lineage_missing`, provider lineage current y evento `generation_reconciled`.
Refresh y `Actualizar` conservaron v2. El preflight posterior quedó sin blockers y mostró
modelo `claude-sonnet-4-6`, una llamada máxima, estimación USD 0.255, hard cap USD 1 y
Worker/recovery listos. El consentimiento inició desmarcado y la acción pagada permaneció
deshabilitada.

La verificación read-only de `noisia-staging` reconcilió 2 generations, 0 elements,
2 events, 0 proposal runs, 0 budget reservations, 0 proposal outbox y 0 proposal-run
events. Mentions, imports, `record_tags`, population pointers y governed bindings
conservaron sus conteos y digests protegidos. Studio y Workers ejecutan el commit
`172f3cd`; ambos están `Online`, el deep health está verde y el Worker inició una sola
réplica con cinco colas `-uat`, cero jobs ejecutables y cero filas reclamables.

No se ejecutó `POST /proposals`, no hubo llamada a Anthropic, gasto, publicación,
serving write, cambio de reader/pointer/binding ni cambio de read mode. 10C.3B y 10D
continúan bloqueados por sus gates independientes.

## Authority boundary 69A.6 · proposed knowledge versus governed context

**Recorded:** 2026-08-23T02:13:03-06:00 (`America/Mexico_City`).

El contrato V2 separa dos autoridades que V1 mezclaba: `element_kind` es el tipo de
conocimiento pending que el provider propone; `entity_ref` sólo puede apuntar, de forma
opcional, a una entidad opaca que el servidor ya resolvió. El provider no declara
`entity_type`, no fabrica IDs y no tiene que enlazar una categoría o producto nuevo a
una entidad relacional inexistente. El servidor deriva el tipo contextual o conserva
ambos campos de entidad como null.

La revalidación de un response ya pagado es una derivación append-only, no una mutación
de la generación ni una nueva autoridad. Aun cuando su adaptación sea válida, todos los
elementos nacen `provider_proposal/pending` y confidence permanece informativa. Si existe
un duplicado semántico conflictivo, la derivación se registra `rejected` y anexa cero
elementos. No cambia Topic Contracts, classification assignments, `record_tags`,
readers, pointers, bindings ni serving.

Los anchors pendientes de reconciliar en North Star y Execution Plan son: output V2 sin
`entity_type` del provider, revalidación pagada sin retry/costo y política de duplicado
fail-closed. Esos documentos estaban modificados por otro workstream y no se
sobrescribieron en este corte.

## Checkpoint 69A.6 Preview/UAT · revalidación rechazada y auditable

**Registrado:** 2026-08-23T02:51:00-06:00 (`America/Mexico_City`).

La operación management-only se ejecutó una vez sobre la respuesta pagada preservada y
registró exactamente una derivación append-only `rejected`. El adapter V1→V2 encontró
un grupo de tres propuestas con la misma clave semántica pero distinto `display_text`
normalizado; la política canónica prohíbe colapsarlas. El replay con la misma key devolvió
el mismo resultado sin crear otra derivación.

La generación continúa draft con cero elementos pending o approved. El run original
permanece failed y settled con el mismo digest y costo; no hubo provider call, reserva,
outbox o job adicional. El Admin consume ahora el descriptor operator-safe
`paid_response_revalidation` dentro del banner de run existente. La validación visual
autenticada queda delegada y no se declara cerrada en este checkpoint.

## Authority boundary 69A.7A · terminal run y nueva hoja draft

**Registrado:** 2026-08-23T14:07:30-06:00 (`America/Mexico_City`).

Una generación draft que ya consumió su única corrida no se reabre ni se recicla. La
transición `terminal_provider_run` crea una hoja sucesora append-only, ligada a los
snapshots current de Brand OS, Knowledge, locale/markets y provider lineage. El
predecessor, su run, response, settlement, revalidación y eventos permanecen inmutables.

La transición sólo es válida para un run terminal inequívoco y una generación sin
elementos que requieran review. Trabajo no terminal o ambiguo, outbox reclamable,
presupuesto reservado y elementos current bloquean fail-closed. La preparación de la
nueva hoja es gratuita: no reserva presupuesto, no crea outbox/job y no llama al
provider. No concede aprobación, publicación, Topic Contract, assignment ni serving.

Los anchors pendientes en North Star y Execution Plan son: generación consumida como
historia inmutable, successor gratuito como única ruta de nueva ejecución y blocker
durable de run en preflight/start. Ambos documentos estaban modificados por otro
workstream y no se sobrescribieron en este corte.

## Contrato congelado 69B.2A · resolución N→1 y publicación sellada

**Registrado:** 2026-08-24 (`America/Mexico_City`).

Este contrato cierra los dos P1 encontrados después de la calibración read-only 69B.1
(`80 = 57 strong + 13 revise + 0 reject + 8 near-duplicate + 2 uncertain`). Extiende la
autoridad creada por `0091`; no crea otra autoridad, otro corpus ni un store paralelo.
Las versiones de elementos, sus evidence groups y los eventos existentes continúan
siendo el tronco. Los edges de merge y las review annotations definidos aquí son hijos
append-only de esa misma generación y de esas mismas cadenas.

Las dos decisiones congeladas son:

1. una absorción semántica N→1 termina cada cadena fuente como `merged`, no como
   `rejected` y tampoco la deja `pending`; y
2. publicar requiere sellar por separado candidatos, evidencia, revisión y autoridad
   viva, y luego sellar el conjunto completo dentro de la misma transacción.

Hasta implementar y probar este contrato, el writer/publicador V1 no acredita 69B.2.

### Definiciones de hoja, current y conteos

- Una **versión hoja** no tiene ninguna fila cuyo `supersedes_element_id` apunte a ella.
- Un **elemento current** es la única versión hoja de un `element_key` dentro de la
  generación efectiva. Una cadena con cero o más de una hoja es inválida y bloquea
  publicación.
- La **generación efectiva** continúa siendo la única generación sin successor. Review,
  merge, correction, preflight y publish aceptan únicamente esa generación, en estado
  `draft`.
- Las disposiciones de hoja cerradas son `pending`, `approved`, `rejected` y `merged`.
  `merged` es terminal: no puede aprobarse, rechazarse, corregirse ni reutilizarse como
  fuente o target de otro merge.
- `total_leaves = pending + approved + rejected + merged` debe cumplirse exactamente.
  Un edge o annotation nunca incrementa ese total.
- `pending > 0` bloquea publicación. `merged` y `rejected` no bloquean por sí mismos y
  no aparecen en el candidate pack. Siempre debe existir al menos una hoja `approved`.
- Un merge N→1 reemplaza N hojas fuente y una hoja target con N successors `merged` y
  un successor target `pending`. Por tanto, `total_leaves` no cambia. De cada conteo se
  resta el estado anterior de esas N+1 hojas, se suma N a `merged` y uno a `pending`.
  El target pendiente obliga a una decisión humana posterior antes de publicar.

### Extensión append-only de la autoridad

La implementación puede añadir DDL forward-only, pero las nuevas filas deben vivir bajo
la generación 0091 y respetar sus locks, workspace, actor y operation ledger:

- `signal_semantic_context_element_versions` extiende sus enums con disposition
  `merged` y origin `operator_merge`;
- un edge set N→1 append-only enlaza, por cada fuente, `source_predecessor`,
  `source_merged_successor`, `target_predecessor` y el mismo
  `target_pending_successor`; incluye generation/workspace, operation, actor, reason
  cerrado, rationale acotada y timestamp;
- review annotations append-only y versionadas pertenecen a la misma generación y a la
  versión de elemento a la que califican; cada resolución supersede la annotation
  anterior, nunca la actualiza o elimina;
- la generación publicada conserva los digests separados y el sobre de publicación en
  columnas selladas write-once de la autoridad existente. No se materializa un segundo
  pack mutable.

Restricciones mínimas del edge set:

- exactamente un target pending successor por operación y una o más fuentes;
- una versión `operator_merge/merged` pertenece a exactamente un edge;
- cada source predecessor y successor sólo puede aparecer una vez en el set;
- source y target pertenecen al mismo workspace, generación y `element_kind`;
- source keys son distintas y no contienen el target key;
- los predecessors eran hojas al adquirir el lock y cada predecessor tiene exactamente
  el successor esperado después del commit;
- no existe path source→…→target o target→…→source que forme ciclo directo o
  transitivo en el grafo histórico;
- un target current `merged` o una fuente current `merged` se rechazan.

`near_duplicate` no es una disposition. En la misma clase de elemento puede resolverse
como `merged` mediante la operación anterior o como `kept_distinct`. Entre clases
distintas sólo puede resolverse `kept_distinct`; jamás crea un merge destructivo.

Los reason codes de review quedan cerrados a:

```text
duplicate_same_concept
alias_or_variant
canonicalization
semantic_boundary
locale_resolution
competitive_unit_resolution
insufficient_context
operator_correction
```

Toda rationale se recorta en los extremos, se normaliza NFC y contiene entre 1 y 1,000
Unicode scalar values. Un merge acepta entre 1 y 100 source keys distintas. La
corrección semántica que aporta el browser se limita a `canonical_key`, `display_text`,
`scope`, `locale`, `relation_kind` y `relation_target_key`; el servidor preserva o
resuelve `entity_type/entity_id` y nunca acepta un UUID de entidad desde el browser.

### Evidencia del merge

El browser envía únicamente generation key, target key, source keys, reason code,
rationale acotada y la corrección semántica del target permitida por el contrato. No
envía UUIDs de elementos, evidence IDs, actors, versiones, digests ni authority IDs.

Dentro del servidor se leen los evidence links de los predecessors current y se forma
la unión del target y todas las fuentes. La clave de deduplicación exacta es:

```text
(source_type, lowercase_uuid(source_id), relation_type)
```

La lista se ordena byte-wise por `source_type`, `source_id`, `relation_type`, preserva
`supports`, `limits` y `contradicts`, y se copia al evidence group del target pending.
Los successors fuente `merged` conservan, sin reinterpretación, la evidencia y los
digests de su propia cadena. La unión nunca convierte `limits` o `contradicts` en
`supports`. Cada ref se revalida contra el workspace y la autoridad sellada de la
generación; una ref inválida revierte toda la operación.

### Tabla de transición de disposiciones

| Estado current | Operación | Estado successor | Condición y efecto |
|---|---|---|---|
| inexistente | append proposal | `pending` | Sólo writer server-owned; confidence no concede autoridad. |
| `pending` | approve | `approved` | Un successor `operator_decision`; predecessor inmutable. |
| `pending` | reject | `rejected` | Un successor `operator_decision`; no se publica. |
| `pending` | correct | `pending` | Un successor `operator_correction`; requiere nueva decisión. |
| `approved` | correct | `pending` | Reabre append-only; resta uno de approved y bloquea publish. |
| `rejected` | correct | `pending` | Reabre append-only; resta uno de rejected y bloquea publish. |
| `pending`, `approved` o `rejected` como target N→1 | merge | `pending` | Un solo target successor `operator_correction` con evidencia unionada. |
| `pending`, `approved` o `rejected` como source N→1 | merge | `merged` | Un successor `operator_merge` por fuente y un edge al target. |
| `merged` | approve, reject, correct o merge | — | Rechazo fail-closed; `merged` es terminal. |
| cualquier hoja de generación no current, no draft o publicada | cualquier decisión | — | Rechazo fail-closed; history permanece inmutable. |

No existe transición directa `approved→rejected`, `rejected→approved` o
`approved/rejected→merged` fuera de la operación N→1. Para cambiar una decisión se crea
primero un successor correction `pending` y se decide de nuevo, salvo que la operación
atómica de merge sea la corrección explícita elegida por el operador.

### Tabla de transición de annotations

Los tipos cerrados son `uncertain`, `needs_more_context`, `near_duplicate`,
`locale_unresolved` y `competitive_unit_unresolved`. Son estado de review, no etiquetas
semánticas.

| Estado current | Operación | Estado successor | Regla |
|---|---|---|---|
| inexistente | annotate | `open` | Se liga a una hoja `pending`, con reason/rationale y actor server-owned. |
| `open` | add context | `open` | Nueva versión que supersede la anterior; no borra rationale previa. |
| `open near_duplicate` same-kind | merge N→1 | `resolved/merged` | La resolución y todos los successors/edges ocurren en una transacción. |
| `open near_duplicate` | keep distinct | `resolved/kept_distinct` | No crea edges ni cambia disposition. |
| `open uncertain` o `needs_more_context` | resolve | `resolved/context_sufficient` o `resolved/not_supported` | La hoja permanece pending hasta una decisión explícita. |
| `open locale_unresolved` | resolve locale | `resolved/governed_locale` o `resolved/global` | `global` debe elegirse explícitamente; nunca es fallback. |
| `open competitive_unit_unresolved` | resolve | `resolved/canonical_unit` o `resolved/not_applicable` | La entidad/unidad resuelta queda en la correction pendiente. |
| `resolved` | reopen | nueva annotation `open` | Nueva annotation key; la resolución anterior permanece terminal e inmutable. |

Toda annotation `open` bloquea publicación. Resolver una annotation no aprueba el
elemento. Si la resolución cambia datos efectivos, la misma transacción debe crear un
successor `operator_correction/pending`.

Para una correction que no es merge, cada annotation abierta de la hoja predecessor
recibe una annotation successor con el mismo `annotation_key`, ligada al element
successor; permanece abierta salvo resolución explícita en esa misma transacción. Nunca
se borra, copia sin lineage o cambia de subject silenciosamente.

Para un merge N→1 rige una precondición distinta y cerrada:

- cada source debe tener al menos una annotation current `open/near_duplicate` que
  relacione explícitamente esa source leaf con la target leaf elegida;
- todas y sólo esas annotations source→target reciben successor
  `resolved/merged` dentro del merge;
- cualquier otra annotation abierta sobre una source —incluidas `uncertain`,
  `needs_more_context`, `locale_unresolved`, `competitive_unit_unresolved` o un
  `near_duplicate` hacia otro target— bloquea toda la operación;
- las annotations resueltas de source permanecen históricas, sujetas al source
  predecessor e incluidas en `review_graph_digest`. No se copian o transfieren al
  target ni al merged successor;
- cada merged successor termina con cero annotations abiertas;
- todas las annotations abiertas del target permanecen semánticamente en la cadena del
  target: cada una recibe un successor append-only re-bound al target pending successor,
  con el mismo annotation key y state `open`, salvo que el operador la resuelva
  explícitamente en la misma transacción mediante una resolución permitida;
- el browser identifica resoluciones target sólo por `annotation_key` y resolución
  cerrada; el servidor resuelve current annotation version, subject y actor;
- cada `annotation_key` aparece como máximo una vez por comando. Duplicados idénticos o
  contradictorios se rechazan en Zod y de nuevo en el writer; nunca se aplica
  `last-wins`;
- re-bound no significa cambiar subject en una fila existente: predecessor y annotation
  previa permanecen byte-for-byte y la nueva versión apunta al target successor.

El resultado/evento del merge sella estos conteos exactos:

```text
source_count
source_matching_near_duplicate_resolved
source_other_open_annotations = 0
target_open_annotations_before
target_annotations_rebound_open
target_annotations_resolved_in_merge
merged_successor_open_annotations = 0
open_annotations_after = open_annotations_before
  - source_matching_near_duplicate_resolved
  - target_annotations_resolved_in_merge
```

Además,
`target_open_annotations_before = target_annotations_rebound_open +
target_annotations_resolved_in_merge`. Cualquier diferencia, annotation faltante o
subject inesperado revierte el merge completo.

### Serialización canónica y digests

Todos los digests de 69B.2 usan `canonical_json_v2`:

1. Se rechaza cualquier string con un surrogate UTF-16 sin pareja. Después se normaliza
   NFC. La salida es UTF-8 sin BOM; UUIDs lower-case; timestamps UTC RFC3339 con
   milisegundos (`YYYY-MM-DDTHH:mm:ss.sssZ`).
2. Los objetos contienen todos los campos del schema, incluidos los null explícitos, y
   ordenan keys por bytes UTF-8 ascendentes. No se admiten campos desconocidos.
   Dos keys fuente distintas que colisionan después de NFC hacen fallar todo el objeto
   tanto en TypeScript como en PostgreSQL; nunca se pierde una por coerción de `jsonb`.
3. Booleanos JSON, integers base 10 sin ceros iniciales y ninguna cifra floating-point.
   Confidence se excluye de autoridad y de todos los digests de publicación.
4. Cada array usa el orden indicado abajo; no se confía en orden de inserción, locale o
   `JSON.stringify` de un driver.
5. Después de NFC, strings y object keys escapan `"` como `\"`, backslash como `\\` y
   dejan slash `/` sin escapar. U+0000–U+001F siempre usan `\u00XX` con hex uppercase;
   no se permiten los atajos `\b`, `\t`, `\n`, `\f` o `\r`. U+2028 y U+2029 usan
   exactamente `\u2028` y `\u2029`. Todos los demás Unicode scalar values, incluidos
   astrales, se emiten directamente como UTF-8, nunca como surrogate escapes.
6. `digest(x) = "sha256:" + lowercase_hex(SHA256(UTF8(canonical_json_v2(x))))`.

Golden vectors obligatorios —la columna bytes es el texto UTF-8 exacto que se hashea—:

| Caso | Input semántico | Bytes canónicos esperados | SHA-256 esperado |
|---|---|---|---|
| quote/backslash/control | quote, slash, backslash, LF y NUL | `{"s":"quote\" slash/ backslash\\ LF\u000A NUL\u0000"}` | `c0998b854a4e659786347d2f3bdbed948fe8091f73161be23a18e21e50a53b41` |
| combining NFC | `Cafe` + U+0301 | `{"s":"Café"}` | `d4f21edc957c8d5f5c6ba620f820dabb8b4afc2398a7603cf49e875cf2a36269` |
| astral directo | U+1F9E0 | `{"s":"🧠"}` | `b2d883dfb70d681a2de3ee4bc8866c220e62896dc61a333cd348fe7a01c37283` |
| separators | `a` + U+2028 + `b` + U+2029 + `c` | `{"s":"a\u2028b\u2029c"}` | `7970f45418dae559568b46bf9e8df590584d1f531ad30fe670521565d2b36cf4` |
| object/array order | object insertado `b`, luego `a`; nested `z`, luego `a` | `{"a":[3,{"a":"first","z":"last"}],"b":2}` | `c707db5812c5616df37b78e3147bfb3ae755ffd7b0f716e42321a4ac92099111` |

Un vector adicional con cualquier lone high o low surrogate debe fallar antes de
producir bytes. TypeScript y PostgreSQL deben comparar los bytes canónicos y los cinco
hashes anteriores, no sólo objetos parseados equivalentes.

#### `candidate_pack_digest`

```json
{
  "contract_version": "signal-semantic-context-candidate-pack-v2",
  "generation": {"key": "...", "version": 0},
  "elements": [{
    "element_key": "...", "element_version": 0, "element_kind": "...",
    "canonical_key": "...", "display_text": "...", "scope": null,
    "entity_type": null, "entity_id": null, "locale": "...",
    "relation_kind": null, "relation_target_key": null
  }]
}
```

Incluye sólo hojas `approved`. `elements` se ordena por `element_key` y luego por
`element_version`. No incluye evidencia, confidence, actor ni disposition implícita.

#### `evidence_graph_digest`

```json
{
  "contract_version": "signal-semantic-context-evidence-graph-v2",
  "generation": {"key": "...", "version": 0},
  "elements": [{
    "element_key": "...", "element_version": 0,
    "refs": [{"source_type": "...", "source_id": "...", "relation_type": "supports"}]
  }]
}
```

Incluye las mismas hojas approved. `elements` usa el orden anterior y `refs` se ordena
por el triple exacto definido para la unión. Cada ref debe existir, pertenecer al
workspace y ser válida para el snapshot Brand OS/Knowledge de la generación.

#### `review_graph_digest`

```json
{
  "contract_version": "signal-semantic-context-review-graph-v2",
  "generation": {"key": "...", "version": 0},
  "element_versions": [{
    "element_key": "...", "element_version": 0, "element_digest": "sha256:...",
    "disposition": "pending", "origin_kind": "provider_proposal",
    "supersedes_element_id": null, "original_proposal_element_id": null,
    "operation_id": "...", "decided_by_user_id": null, "decided_at": null
  }],
  "merge_edges": [{
    "operation_id": "...", "source_predecessor_id": "...",
    "source_element_key": "...", "source_element_version": 0,
    "source_merged_successor_id": "...", "target_predecessor_id": "...",
    "target_element_key": "...", "target_element_version": 0,
    "target_pending_successor_id": "...", "reason_code": "...",
    "rationale": "...", "actor_user_id": "...", "created_at": "..."
  }],
  "annotations": [{
    "annotation_key": "...", "annotation_version": 0, "annotation_type": "...",
    "state": "open", "resolution": null, "subject_element_id": "...",
    "related_element_ids": [], "reason_code": "...", "rationale": "...",
    "supersedes_annotation_id": null, "operation_id": "...",
    "actor_user_id": "...", "created_at": "..."
  }]
}
```

`element_versions` incluye toda la historia de la generación y se ordena por
`element_key`, `element_version`, `id`; edges por `operation_id`, source key y source
version; annotations por `annotation_key`, `annotation_version`, `id`; related IDs por
bytes. Así, cambiar reason/rationale, uncertainty, locale resolution, correction, edge,
actor o resolución invalida el preflight aun si el candidate pack no cambia.

#### Autoridad viva y `semantic_context_pack_digest`

La autoridad viva se vuelve a resolver server-side y se serializa así. El objeto
`proposal_provider_lineage` completo —provider, model/version, prompt/schema contracts,
pricing/rates, capacity, token ceilings y hard cap— es parte del seal; su digest no es
un sustituto de comparar el contenido completo:

```json
{
  "brand_os_digest": "sha256:...",
  "knowledge_digest": "sha256:...",
  "locale_context_digest": "sha256:...",
  "proposal_provider_lineage": {"contract_version": "...", "...": "..."},
  "proposal_provider_lineage_digest": "sha256:..."
}
```

El digest publicado del pack sella todos los componentes, no sólo candidatos:

```text
semantic_context_pack_digest = digest({
  contract_version: "signal-semantic-context-publication-graph-v2",
  generation: {key, version},
  candidate_pack_digest,
  evidence_graph_digest,
  review_graph_digest,
  authority: {brand_os_digest, knowledge_digest, locale_context_digest,
              proposal_provider_lineage_digest}
})
```

#### `publish_preflight_digest`

```json
{
  "contract_version": "signal-semantic-context-publish-preflight-v2",
  "generation": {"key": "...", "version": 0, "expected_status": "draft"},
  "candidate_pack_digest": "sha256:...",
  "evidence_graph_digest": "sha256:...",
  "review_graph_digest": "sha256:...",
  "authority": {
    "brand_os_digest": "sha256:...", "knowledge_digest": "sha256:...",
    "locale_context_digest": "sha256:...",
    "proposal_provider_lineage_digest": "sha256:..."
  },
  "semantic_context_pack_digest": "sha256:...",
  "counts": {
    "total_leaves": 0, "pending": 0, "approved": 0, "rejected": 0, "merged": 0,
    "open_annotations": 0, "open_uncertainty": 0, "open_near_duplicate": 0,
    "unresolved_locale": 0, "unresolved_competitive_unit": 0,
    "merge_edges": 0, "canonical_collisions": 0, "invalid_evidence_refs": 0
  },
  "collisions": [],
  "blockers": [],
  "publishable": true
}
```

`collisions` ordena claves `[element_kind, canonical_key, resolved_locale]` por bytes;
`blockers` es un set cerrado, deduplicado y ordenado. El preflight digest es el hash de
ese objeto exacto; el campo no se incluye dentro de sí mismo.

### Preflight management-only

El GET gratuito:

- requiere AuthZ DB-owned de operador interno;
- corre read-only en un snapshot consistente, escribe cero operaciones/eventos y llama
  cero providers;
- responde `Cache-Control: private, no-store`;
- expone el `preflight_digest` completo como token opaco necesario por el POST, pero
  sólo referencias abreviadas de los component digests; nunca expone UUIDs, actors,
  rationale privada, evidence IDs ni el envelope privado;
- devuelve counts exactos, collisions operator-safe, blockers, `publishable`,
  `writes_performed=false` y `provider_calls=0`.

Blockers cerrados mínimos:

- `generation_not_effective_draft`;
- `authority_drift` o provider lineage no current;
- `proposal_run_nonterminal`, executable outbox o reserved budget;
- `pending_elements`;
- `zero_approved_elements`;
- `open_uncertainty`, `open_near_duplicate`, `locale_unresolved`,
  `competitive_unit_unresolved` u otra annotation abierta;
- `unresolved_merge` por edge incompleto/dangling y `unresolved_correction` por cadena o
  annotation de correction abierta;
- `canonical_collision` entre hojas approved;
- `invalid_current_evidence`;
- `invalid_relation_target` cuando una hoja approved `typed_relation` no apunta a otra
  hoja current `approved` de la misma generación/workspace, apunta a merged/rejected/
  pending/superseded sin successor approved, falta o se apunta a sí misma;
- `locale_market_required_unresolved` cuando una hoja approved no tiene locale gobernado
  ni resolución explícita `global`;
- cualquier fork, ciclo o inconsistencia de counts del grafo.

### Corte obligatorio del publicador V1

El corte 69B.2 es no ambiguo:

- generaciones que ya estaban `published` bajo V1 antes de aplicar la migración siguen
  legibles byte-for-byte, con su `pack_digest` histórico; no se backfillean, rehashean ni
  reinterpretan;
- desde el commit de la migración 69B.2, ninguna generación `draft` —aunque haya sido
  creada antes— puede transicionar a `published` mediante el body, confirmation, writer
  o digest V1;
- la ruta canónica existente `POST .../semantic-context/publish` se actualiza **in
  place** al body V2. No se publica una ruta paralela que deje vivo el bypass;
- el writer canónico existente se actualiza in place para exigir preflight V2. Cualquier
  export/entrypoint legacy que no pueda eliminarse por compatibilidad se vuelve un
  tombstone terminal HTTP/servicio `410 semantic_context_publish_v1_retired` y nunca
  llama al writer de estado;
- la confirmation V1 `publish_reviewed_semantic_context` queda inválida. Sólo se acepta
  `publish_reviewed_semantic_context_v2` con `preflight_digest` e `Idempotency-Key`;
- un backstop PostgreSQL sobre cada nuevo `draft→published` exige
  `publication_schema_version = 'signal-semantic-context-publication-v2'`, todos los
  component digests y pack/preflight digests con formato válido, counts sellados que
  satisfagan sus invariantes y coincidencia con la recomputación DB-owned del grafo para
  esa generación. Ausencia, mismatch o V1 produce excepción antes del cambio de status;
- el backstop sólo inspecciona transiciones posteriores a la migración. Filas ya
  published V1 están exentas por estado inicial, no por workspace o fecha hardcodeada.

API, writer y DB deben fallar independientemente: retirar la ruta no sustituye el
backstop SQL, y el trigger no justifica aceptar un body legacy. No se permite feature
flag que reactive V1.

### Secuencia transaccional de merge

1. Validar el body cerrado y AuthZ; abrir transacción y adquirir el advisory lock del
   workspace antes de comenzar la operation idempotente.
2. Resolver la generación efectiva draft server-side y rechazar run no terminal,
   workspace/generation cruzados y authority drift.
3. Iniciar/reproducir el operation ledger con digest del payload semántico. Replay exacto
   devuelve el resultado persistido; misma key con otro payload falla.
4. Leer `FOR UPDATE` las hojas target/source y sus cadenas. Validar CAS, keys distintas,
   same-kind, no `merged`, sin forks y sin path que cree ciclo.
5. Leer `FOR UPDATE` las annotation leaves de target y sources. Por cada source exigir
   al menos una `open/near_duplicate` que apunte exactamente al target y cero annotations
   abiertas adicionales; capturar todas las annotations target y validar las
   resoluciones target explícitamente solicitadas.
6. Leer y validar evidence refs; construir la unión estable server-owned.
7. Crear exactamente un target `operator_correction/pending` successor con la unión.
8. Crear exactamente un `operator_merge/merged` successor por source, conservando su
   evidencia propia.
9. Insertar todos los edges N→1. Para sources, crear únicamente successors annotation
   `resolved/merged` de las near-duplicate matching, ligados al source predecessor; no
   copiar ninguna annotation a otro subject. Para target, crear un successor por cada
   annotation abierta re-bound al target pending: `open`, salvo resolución target
   explícita y válida en la misma transacción.
10. Verificar los conteos de annotations congelados, incluyendo cero abiertas en cada
    merged successor; una diferencia revierte todo.
11. Recalcular counts/draft digest, validar `total_leaves`, append event(s) y completar el
   operation ledger.
12. Commit único. Cualquier error revierte target, sources, edges, annotations, artifacts,
    evidence groups, events y operation completion; nunca existe merge parcial.

Dos keys concurrentes serializan por el mismo lock: la primera puede cerrar; la segunda
relee predecessors no current y falla CAS o converge en un no-op sólo si su payload
canónico representa exactamente el merge ya cerrado.

### Secuencia transaccional de correction

1. Validar AuthZ/body, lock workspace y comenzar/reproducir operation por digest.
2. Resolver generación efectiva draft y hoja current `pending|approved|rejected` con CAS;
   rechazar `merged`, run no terminal, drift o cross-workspace.
3. Revalidar e heredar evidencia server-owned; el browser no aporta IDs.
4. Insertar un successor `operator_correction/pending`, preservar predecessor y ligar
   original proposal.
5. Crear successors append-only re-bound para todas las annotations abiertas o
   resolver esos successors según la misma orden explícita; nunca copiar filas ni
   cambiar su subject in place.
6. Recalcular draft digest/counts, append event, completar ledger y commit. Nunca se
   aprueba dentro de correction.

### Secuencia del preflight y publish

El preflight ejecuta, sin lock de escritura, una transacción read-only con snapshot
consistente: resuelve generación/hojas, autoridad viva, evidencia, review graph, counts,
collisions y blockers; construye los cuatro digests y el envelope canónico; no persiste
nada.

El POST acepta exclusivamente:

```text
generation_key
preflight_digest
confirmation = "publish_reviewed_semantic_context_v2"
Idempotency-Key header
```

La transacción de publish:

1. valida AuthZ/body y adquiere el workspace lock;
2. consulta el operation ledger sin escribir: replay exacto completed retorna el
   resultado sellado; la misma key con payload distinto o un estado ambiguo falla;
3. resuelve la misma generación como efectiva draft y rechaza run no terminal;
4. relee autoridad, todas las versiones/hojas, evidence refs, edges, annotations y
   resolutions;
5. recompone, dentro de la transacción, candidate/evidence/review/authority digests,
   semantic context pack digest, counts, collisions, blockers y preflight digest;
6. exige igualdad byte-for-byte con el token recibido y `publishable=true` antes de la
   primera escritura; cualquier cambio de rationale, uncertainty, locale, edge,
   evidence o autoridad produce `stale_preflight`;
7. sólo entonces crea la operation idempotente y, mediante CAS `draft→published`, llena
   exactamente una vez todos los digests/summary
   sellados y `published_operation/actor/at`; ninguna columna puede cambiar después;
8. inserta `generation_published` con referencias al publication graph, completa ledger
   y commit.

Replay exacto con la misma key devuelve la publicación original. Una key distinta sobre
la misma generación ya publicada falla `already_published`; no fabrica un segundo
ledger/event ni interpreta equivalencia desde el browser. Publish no escribe Topic
Contracts, assignments, `record_tags`, serving, readers, pointers, bindings o read mode.

### Matriz obligatoria de pruebas 69B.2

| Área | Caso | Evidencia requerida |
|---|---|---|
| Merge | 2→1 pending | Dos source leaves `merged`, un target `pending`, total leaves constante. |
| Merge | N→1 estados mixtos | Deltas exactos desde pending/approved/rejected y N edges al mismo target. |
| Merge | evidence union | Orden estable, dedupe por triple y preservación de supports/limits/contradicts. |
| Merge | mismo kind | Cross-kind sólo annotation; merge rechazado. |
| Merge annotations | source matching | Cada source tiene near-duplicate open hacia el target; sólo ésas terminan resolved/merged y quedan históricas en predecessor. |
| Merge annotations | source sin matching | Cero near-duplicate matching rechaza todo sin successors/edges/events. |
| Merge annotations | source blocker | Matching más cualquier otra open annotation rechaza todo; no se transfiere al target. |
| Merge annotations | merged successor | Cada merged successor termina con cero annotations abiertas y no hereda annotations source. |
| Merge annotations | target carry | Todas las open target reciben successor re-bound al target pending y siguen open/blocking. |
| Merge annotations | target resolution | Sólo resoluciones target explícitas cierran sus successors; conteos before/rebound/resolved/after satisfacen ecuaciones. |
| Merge | self/duplicate/cross authority | Self, source repetido, workspace/generation/stale rechazados sin filas. |
| Merge | ciclos | Ciclo directo y transitivo rechazados bajo lock. |
| Merge | replay | Misma key/payload mismo resultado; misma key/payload distinto conflicto. |
| Merge | concurrencia | Keys distintas convergen o una falla CAS; una sola rama de successors. |
| Merge | rollback | Fallo inducido después de target/source/edge no deja artifacts, refs, successors ni event parciales. |
| Correction | cada estado | pending, approved y rejected crean successor pending; merged falla. |
| Correction | annotation carry | Cada abierta recibe successor re-bound; resolución explícita es append-only; nunca se copia, borra ni cambia subject in place. |
| Annotation | near duplicate | same-kind merge resuelve atómicamente; cross-kind sólo kept_distinct. |
| Annotation | locale/global | Missing locale bloquea; governed locale o global explícito resuelve. |
| Counts | identidad | total = pending+approved+rejected+merged tras cada transición. |
| Preflight | read-only | Cero operations/events/writes/providers; respuesta private/no-store y operator-safe. |
| Preflight | componentes | Vectores golden de canonical JSON/TS/PostgreSQL producen bytes y digests idénticos. |
| Canonical JSON | escaping | Quote, backslash, U+0000–001F, U+2028/U+2029, NFC, astral y ordering coinciden con los cinco hashes congelados; lone surrogate falla. |
| Publish | happy path | Cero pending/open, ≥1 approved, todos los digests se sellan write-once. |
| Publish cutover | API V1 | Body/confirmation V1 contra la ruta canónica falla; no crea operation/event/publication. |
| Publish cutover | writer V1 | Entry point legacy es inexistente o tombstone 410 y no alcanza el writer de estado. |
| Publish cutover | DB V1 | UPDATE/función directa sin todos los seals V2 falla por backstop PostgreSQL. |
| Publish cutover | history V1 | Generación ya published V1 conserva bytes/digest y continúa legible sin backfill. |
| Publish | stale review | Cambiar rationale/annotation/merge/correction invalida token. |
| Publish | stale evidence | Cambiar evidence graph invalida token aunque candidates coincidan. |
| Publish | stale authority | Drift Brand OS/Knowledge/locale/provider invalida token. |
| Publish | relation target | Missing, pending, rejected, merged, self o cross-authority bloquean; sólo una hoja current approved es publicable y cambiarla invalida el token. |
| Authority | evidence bypass | Un INSERT SQL con evidence de otro profile/generation/workspace falla por trigger aunque omita el service. |
| Authority | annotation successor | Subject/related arbitrarios fallan; normal resolution conserva ambos, correction usa su successor exacto y merge sólo sus source/target successors exactos. |
| Canonical JSON | key collision NFC | `Café` y `Cafe\u0301` como keys distintas fallan igual en TypeScript y PostgreSQL. |
| Publish | blockers | Run no terminal, zero approved, collision, invalid evidence, fork/cycle fallan antes de write. |
| Publish | replay/concurrencia | Replay exacto y dos publicaciones concurrentes producen una sola publicación/evento. |
| Boundary | browser | No controla IDs, versions, actor, evidence, component digests, authority ni status. |
| Boundary | downstream | Cero diffs en Topic Contracts, assignments, record_tags, serving, readers, pointers, bindings y read mode. |

### Riesgos residuales no bloqueantes del contrato

- La UI 69B.2 debe representar merge/annotations sin ocultar que el target vuelve a
  pending; este gate no diseña esa UI.
- La cardinalidad de annotations/edges es pequeña en Semantic Context, pero el
  implementation gate debe medir el preflight con al menos 250 elementos y preservar un
  query plan acotado.
- Consumers existentes de `counts` y `pack_digest` necesitan compatibilidad explícita al
  introducir `merged` y publication graph V2; no se permite reinterpretar publicaciones
  V1 históricas.

## Implementación local 69B.2

**Registrado:** 2026-08-24 (`America/Mexico_City`).

La migración forward-only 0097 y los writers management-only implementan el contrato
congelado anterior sobre la autoridad 0091. El merge N→1 crea successors
`operator_merge/merged`, un único target `operator_correction/pending`, une evidence
server-side y resuelve/re-bindea annotations dentro de la misma transacción. Correction
siempre reabre como pending; `merged` es terminal. Review puede filtrar y leer historia
merged, sin convertirla en rechazo.

La ruta canónica de publish quedó cortada a V2 y el entrypoint V1 es un tombstone 410.
El GET de preflight usa snapshot read-only, y tanto el writer como PostgreSQL recomponen
candidate, evidence, review, autoridad, pack y preflight antes de sellar columnas
write-once. La integración local conserva una publicación histórica V1 sin backfill y
demuestra que API, writer y SQL V1 ya no pueden publicar un draft.

El cierre adversarial 69B.2B reforzó cinco trust boundaries: relations sólo apuntan a
hojas current approved; el seal compara lineage provider completo y mete todos los
blockers en el token; `canonical_json_v2` detecta colisiones NFC de keys también en SQL;
la validación de evidence de 0091 permanece activa; y cada annotation successor conserva
el subject/related exacto permitido por su transición. Merge/correction rechazan keys de
resolución duplicadas y sus respuestas operator-safe sólo exponen un `draft_digest_ref`
abreviado. La integración incluye publicación concurrente y fault injection con rollback
completo.

Este gate no implementa UI, no despliega, no toma decisiones reales y no conecta el
pack a Topic Contracts, assignments, `record_tags`, serving, readers, pointers,
bindings o read mode.

## Implementación local 69B.4C-A — aprobación deliberada

**Registrado:** 2026-08-25 (`America/Mexico_City`).

La aprobación y el rechazo comparten ahora un único writer V2. Cada transición exige
un motivo cerrado y una justificación NFC de 1–1000 Unicode scalars; la base forma parte
del input idempotente, del `element_digest` y del `review_graph_digest`. Las entradas V1
single/bulk son tombstones y el rechazo ya no crea annotations sintéticas para simular
rationale. Bulk approval se limita a 2–15 hojas pending del mismo kind y exige una
confirmación explícita de que la base compartida aplica a cada selección visible.

0098 preserva decisiones anteriores con basis NULL, pero impide nuevas decisiones sin
base tanto por servicio como por trigger. Un draft con una hoja current approved o
rejected sin esa base recibe `decision_basis_missing` en el preflight gratuito; una
publicación histórica permanece inmutable. El detalle management-only proyecta el
motivo, la justificación y el timestamp operator-safe; las decisiones históricas sin
base se identifican como tales sin exponer el actor privado. Esta implementación local no corrige la
aprobación histórica del canary, no decide propuestas y no publica el pack.

## Implementación local 69B.4C-B — backstop colectivo DB-owned

**Registrado:** 2026-08-25 (`America/Mexico_City`).

0098 sella además el input colectivo de cada operación single/bulk en el ledger. Un
constraint trigger deferred valida al commit que la selección sea exactamente la misma
que los successors: single produce una hoja; bulk produce 2–15 hojas únicas, approved,
same-kind y con un único `decision_basis_digest`. También exige predecessors current
pending, confirmación/action exactas, actor, resultado y cardinalidad de eventos. Una
cohorte parcial, sustituida, mixta, terminal→terminal o completada manualmente aborta la
transacción aunque cada fila aislada sea válida.

La regla no cambia decisiones históricas ni añade otra autoridad. El ledger, el grafo
append-only y los triggers de fila existentes siguen siendo las únicas superficies de
persistencia; replay y concurrencia convergen sobre el mismo successor current.
