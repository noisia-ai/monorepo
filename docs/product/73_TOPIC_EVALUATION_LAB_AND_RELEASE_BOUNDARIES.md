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

## Release comes later

Once a Lab produces candidates worth keeping, the work may enter the separately audited
Preview/UAT release path. The protected executor, restore point, migration ledger and deep-health
checks are release controls. They are not prerequisites for proving the product in a disposable
local database.
