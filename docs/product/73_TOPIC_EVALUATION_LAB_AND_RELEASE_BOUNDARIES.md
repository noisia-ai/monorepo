# Topic Evaluation Lab and release boundaries

Status: active product-development policy as of 2026-09-04.

## Why this exists

Noisia needs to learn whether its frozen BERTopic output plus Brand OS and bounded Claude evidence
navigation can produce useful Topic candidates. That is a product experiment. It is distinct from
shipping a migration or activating Topics in Signal.

Treating both as the same gate made a release-executor requirement block ordinary development. This
document separates them without weakening integrity controls.

## Three environments, three commitments

| Environment | What may change | What it proves | What it cannot do |
| --- | --- | --- | --- |
| Disposable local Lab | A newly named loopback Postgres clone; forward-only V2 schema; temporary candidate rows | The full frozen corpus can yield useful candidates under a bounded evaluation | It cannot target Preview/UAT, publish, adopt or serve Topics |
| Preview/UAT | Audited commits and forward-only migrations after target, restore, ledger and health checks | The feature can be operated in the shared test product | It cannot activate production or Signal serving |
| Production | Only a separately reviewed release path | Client-visible reliability and governed operations | It cannot be used as an experiment sandbox |

The first lane is intentionally cheap to reverse: drop the named local clone after preserving its
sanitized evidence receipt. The second and third lanes need release controls because other people
can see or depend on their state.

## Disposable clone setup and provenance

The Lab preflight accepts `NOISIA_RUNTIME_PROFILE=local_disposable_lab_v1` only. A clone name
must match `noisia_topic_eval_lab_*` and may not contain Preview, UAT, staging or production labels.
These caller-visible checks are necessary but not sufficient: loopback can still terminate a tunnel
to a remote database.

Run `pnpm --filter @noisia/workers signal:topic-evaluation:lab-clone` only with the closed local Lab
runtime profile. That step accepts no target, URI, source database, clone name, marker or credential
argument. It inspects the fixed local pgvector container, verifies the registered frozen source,
generates a fresh clone name, applies the hand-verified candidate-review schema and installs the
database marker. The marker SQL takes no variables and derives the connected database name, frozen
source run, snapshot/artifact digests and PostgreSQL system identifier from the server.

After verifying the clone, the creation step writes
`.data/signal-topic-evaluation/lab-1b/clone-provenance.current.json` with mode `0600`. This
host-side receipt binds the immutable Docker container and image identities, loopback port, clone,
server system identity and frozen source digests. It lives outside PostgreSQL and is never supplied
as a preflight argument.

The provider-disabled preflight loads that fixed receipt, re-inspects the fixed container and
derives its endpoint and expected identity from the receipt. Every Docker command uses the fixed
Docker Desktop binary and the current OS user's owned Unix socket explicitly; any ambient
`DOCKER_*` routing/configuration value is rejected before filesystem probing or process creation,
and the child receives a minimal environment without `HOME` or Docker context state. It then opens
one persistent `psql` session inside the fixed container, not a caller-provided URL or an extracted password. Inside its
`REPEATABLE READ READ ONLY` transaction it reconciles the external anchor with the database marker
as defence in depth and emits only derived provenance/container digests. Missing, copied or drifted
receipts, containers, sources, clone names or system identities fail closed.

## What the Lab evaluates

The computational input is the entire frozen model population, not a random sample:

- 21,195 canonical roots;
- 115 historical BERTopic proposals and 116 catalog entries;
- 11,186 assigned memberships; and
- 10,009 explicit outliers.

BERTopic has already processed that population. Claude is not asked to receive 21,195 raw messages
in one prompt. It is a constrained evidence investigator: the server preserves all memberships and
lets the model request bounded, sanitized representative slices, in-cluster searches, comparisons
and current Brand OS context. The server chooses the records, limits and cursors. This is how the
model can investigate a cluster without becoming a general database client or receiving an
unbounded export.

## Lab success and failure

One flight card records a purpose, model, fixed input authority, tool and token limits, a maximum
cost and a terminal reconciliation rule. The current aggregate ceiling is USD 18.147816.

Success is a complete editable candidate pool with a recognizable Top 10 containing at least ten
coherent, evidence-linked Topic candidates. “Top 10” is a view of the pool, never a deletion of the
other candidates. Candidate output is pending only: it is not an adopted Topic Contract, a
publication or a serving instruction.

If the Lab produces weak candidates, the next step is to inspect the frozen corpus-to-Brand-OS
handoff and compare local bounded clustering or ranking alternatives. A paid call is never retried
blindly. The operator can then authorize a new sealed experiment with its own cost cap.

## Disposable execution authority

Migration 0116 is local-Lab-only and begins by proving the externally anchored clone marker, frozen
snapshot, 21,195 memberships and empty execution state. It must never be included in a Preview/UAT
or production release. It adds one `local_disposable_lab_v1` authority/run pair with no outbox. The
database derives workspace and actor from the frozen snapshot, accepts no caller workspace or actor,
and permits at most one Lab flight for that snapshot. The historical `uat` profile remains separate
and still requires its exact outbox cohort.

The only executable local entrypoint is
`pnpm --filter @noisia/workers signal:topic-evaluation:lab-execute`. It is disabled unless the
closed Lab runtime, literal action-time confirmation, fresh idempotency key and dedicated Lab
credential configuration are all present. The runner replays the externally anchored read-only
preflight immediately before its first write, then creates and claims the authority directly through
the fixed Docker container transport. It does not use HTTP, BullMQ, the UAT drainer or a product
credential lane. The dedicated credential value is read once only after the pristine/0116 check and
immediately before durable claim. It is never written to a receipt or log.

The sealed flight allows at most 12 model turns, 24 evidence navigations, 450,000 input tokens,
50,000 output tokens and USD 2.10. Each attempted provider turn is durably counted before transport.
A proven local pre-transport failure can settle as `failed`; an HTTP, network or otherwise unknown
after-send boundary remains `outcome_unknown`. Neither state is retried automatically. Successful
output remains append-only local `pending` candidates with evidence links and a Top-10 projection;
adoption, publication and serving stay structurally false.

## What remains non-negotiable

- Use the real registered importer and frozen artifacts; never synthetic memberships or a sample
  presented as the full corpus.
- Keep evidence navigation server-owned, bounded and sanitized. No generic SQL or raw corpus export
  goes to a model.
- Keep credentials out of source, receipts and logs. A preflight may report only whether the
  dedicated configuration is present.
- Keep migrations forward-only and hand-reviewed. In a Lab they are applied only to a newly named
  local clone, never to UAT by convenience.
- Keep Topic adoption, publication, Signal serving, production and Discovery Review redesign out
  of the experiment.

## Evaluación explícita de bloqueos del Lab

El corpus y los registros del Lab son **datos desechables de desarrollo**, no un compromiso con
Amazon, Alexa, UAT ni un contrato de Signal. Por ello, el Lab no se detiene por controles cuyo
propósito es proteger un release: puede aplicar migraciones nuevas, forward-only y verificadas
manualmente dentro de su clon local anclado, y puede reinicializar ese clon desde la fuente congelada
si un experimento falla. No necesita un ejecutor de release de UAT ni un despliegue remoto para
seguir construyendo y probando el producto.

| Situación | Decisión para desarrollo | Por qué |
| --- | --- | --- |
| Un ejecutor protegido de Preview/UAT no está disponible | **No bloquea el Lab.** Se difiere el release. | El runner, 0116 y sus resultados viven sólo en el clon local desechable. |
| Una migración local forward-only está lista y auditada | **Se aplica al clon del Lab.** | Permite probar el control plane real sin tocar UAT ni fabricar resultados. |
| Un resultado es débil o falla | **No bloquea el desarrollo.** Se conserva el recibo, se diagnostica el handoff o algoritmo y se abre el siguiente experimento sellado. | Así se itera hacia diez candidatos útiles sin presentar una muestra como evidencia. |
| Existe riesgo de adopción, publicación o serving | **Fuera de alcance del Lab.** | Es una frontera de producto, no una excusa para detener la experimentación. |
| Falta la credencial de Lab vigente en el proceso que ejecutará la llamada | **Único bloqueo de configuración para una llamada pagada.** Todo lo demás puede continuar. | No se puede deducir ni reutilizar una clave histórica; el runner necesita una credencial nueva, dedicada e inyectada sólo en el proceso de ejecución. |

La regla operativa es proporcional: no se añaden formularios, aprobaciones ni gates de release para
arreglos locales, migraciones del clon o iteración algorítmica. Cada llamada de proveedor sí queda
limitada por su presupuesto, recibo terminal y salida no-adoptada, para que el experimento sea
recuperable y medible en vez de opaco.

## Release comes later

Once a Lab produces candidates worth keeping, the work may enter the separately audited
Preview/UAT release path. The protected executor, restore point, migration ledger and deep-health
checks are release controls. They are not prerequisites for proving the product in a disposable
local database.
