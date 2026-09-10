# 74 · Topic Candidate Refinement Flight Card

> **Status:** implemented and independently audited locally; one real proposal-only flight
> completed on 2026-09-06. UAT rollout and operator-facing proposal integration are not shipped.
> **Purpose:** turn one already-generated, pending Topic candidate into a human-reviewable
> naming/description/relationship proposal after bounded navigation of its own evidence.
> **Not a Topic activation:** the flight never adopts, publishes, serves, merges, splits or edits
> the candidate.

## Why this is a separate flight

BERTopic and the local LAB-2G evaluation already produced a useful candidate pool. Refinement is
the small second job: make one candidate legible to an Insights Manager by letting a model inspect
only the candidate's own source clusters and current Brand OS context. It is not another corpus
clustering run and it must not silently turn a candidate into a governed Topic.

The `0118` control plane is intentionally limited to a local disposable Lab database.
It persists sealed sessions, evidence-navigation traces and one proposal. The local flight
implementation and `0119`–`0121` now provide bounded provider orchestration, reviewed execution
seals and host provenance. Configuring an UAT secret does not make these local migrations UAT-ready.

## Proposed first flight

| Field | Bound |
| --- | --- |
| Target | New **local-disposable successor** of the completed LAB-2G evidence database; retain the original LAB-2G clone immutable. The flight authority must bind the source clone/receipt digest, run/snapshot/Brand-OS digests, and `0116`/`0117`/`0118` ledger checksums before any write. |
| Candidate | Exactly one existing `pending && !adopted && !published && !serving` candidate, selected by explicit key/revision/state token. |
| Model | `claude-sonnet-5`, through the existing bounded provider adapter, with a server-owned model/pricing version tuple sealed in the flight authority. |
| Model turns | Maximum 12. The final turn must return a proposal only; no model-requested tool may mutate a candidate, editorial state, Topic Contract, publication or serving state. The wrapper may append its bounded trace. |
| Navigation | Maximum 12 operations; source clusters sealed at session start (between 1 and 12); `representative_mentions` max 12, `search_cluster` page max 20, comparisons exactly two clusters. |
| Evidence budget | 32 KiB per result and 192 KiB aggregate, enforced in PostgreSQL and rechecked by the orchestrator before calling the provider again. |
| Context | Sanitized candidate context plus server-derived relevant Brand OS elements. No raw artifact paths, private identities, SQL, credentials, whole-corpus export or unsealed cluster access. |
| Output | One append-only structured proposal: display name, description, evidence refs from this session trace, optional same-run related candidates, and `none` / `consider_merge` / `consider_split` recommendation. |
| Cost cap | Hard maximum **USD 1.00** (`1,000,000` micro-USD), calculated from sealed prices and token ceilings, atomically reserved before dispatch, and atomically settled at the terminal receipt. |
| Retry | None. A local pre-transport rejection may be recorded as definitely-not-sent; any provider/network/unknown outcome is terminal and requires a separately authorized successor. |
| Idempotency | One fresh bounded key for the flight, plus the session start and proposal idempotency already sealed in `0118`. |

## Server-owned tool surface

The local runner acts as a narrow internal tool host. It does not give the model database access.
Each provider tool request is parsed, authorized and executed by the existing refinement core:

1. `candidate_context` — candidate's sealed immutable/current revision. Historical citations are
   not presented to the model as newly retrieved, citable session evidence.
2. `brand_os_context` — relevant approved Brand OS context derived server-side from that candidate.
3. `cluster_profile` — one sealed source cluster profile.
4. `representative_mentions` — deterministic sanitized sample from one sealed source cluster.
5. `search_cluster` — paged, filter-bounded sanitized evidence within one sealed source cluster;
   its cursor is bound to session, candidate revision and expiry.
6. `compare_clusters` — exactly two distinct sealed source clusters.

Every response is recorded as a trace before it can be cited. The final structured response is
validated and appended as a proposal. The Worker never receives an editorial writer, a Topic
Contract writer, a publication action or a serving action.

## Sealed economic authority

The implementation must accept this flight only with the following server-owned authority values;
the Worker must not read any price, token limit or model name from a request, a prompt or a tool
result:

| Authority field | First-flight value |
| --- | --- |
| `pricing_version` | `anthropic-sonnet-5-topic-refinement-2026-09-05` |
| input price | `3` micro-USD per token |
| output price | `15` micro-USD per token |
| maximum input tokens | `240,000` aggregate, `24,000` per model turn |
| maximum output tokens | `12,000` aggregate, `1,000` per model turn |
| transport clamp | `maxOutputTokens: 1,000` on every request |
| worst-case reservation | `240,000 × 3 + 12,000 × 15 = 900,000` micro-USD |
| operational headroom | `100,000` micro-USD; total reservation is exactly `1,000,000` micro-USD |

The Worker reserves the complete `1,000,000` micro-USD in one serializable transaction before the
first provider edge. Before each turn it proves that that turn's input ceiling plus its `1,000`
output-token clamp fits the remaining token allocation. It settles actual metered usage once on a
terminal provider response; on a definitely-not-sent local pre-transport rejection it settles
zero provider usage, and on every provider/network/unknown outcome it leaves the reservation in a
terminal `outcome_unknown` receipt. Existing operator authority may allow a separately reviewed
successor; the terminal flight itself is never retried. One authority permits up to twelve bounded
model turns in one dispatch loop, not a second execution of that loop. The local database checks
its reservation; the orchestrator additionally reconciles settled usage and unknown caps across
all clones and passes the real remaining aggregate balance when preparing a new flight. Copied
historical receipts are counted once, not again in every clone.

## Local-Lab credential custody

This flight is **not** permitted to inherit `ANTHROPIC_API_KEY` from Studio UAT, Workers UAT, a
project `.env`, Docker Compose, the parent shell or any Railway runtime. The existing masked UAT
variables are explicitly out of scope for local execution.

Before a real local call, an operator must provision a distinct Keychain item for this Lab flight
under the fixed service `noisia.topic-refinement-lab.anthropic` and the current macOS account. The
only supported parent launcher reads it immediately before spawning one fixed child, passes it only
as the child variable `NOISIA_TOPIC_REFINEMENT_LAB_ANTHROPIC_API_KEY`, uses an allowlist that removes
all `ANTHROPIC_API_KEY`, `DATABASE_URL`, Railway, Studio, Supabase and Redis variables, and clears
the value on every child path (including a rejected flight claim). The provider-capable runner has
no credential parameter: it first validates the child custody profile, then atomically claims the
persisted flight before it constructs a provider client. The credential is never logged, returned,
written to a receipt, copied to `.env`, Docker or Railway, or read by Studio. Provider-disabled
preflight rejects a missing, wrong-service or inherited credential composition before transport.

## Preflight and terminal reconciliation

Before any provider connection, all of these must be true:

- new successor clone provenance matches the immutable completed LAB-2G source, and the source
  clone has not been modified;
- `0116`, `0117` and local-only `0118` are each present exactly once in the successor ledger;
- candidate/run/snapshot/Brand OS authority/state token reconcile and session creation succeeds;
- the candidate has evidence and at least one sealed source cluster;
- provider execution is explicitly enabled only for this flight, the budget reservation is within
  USD 1.00, the sealed token/price tuple passes the worst-case formula, the aggregate-budget CAS
  succeeds, and a fresh idempotency key is unused;
- the local-Lab credential custody check has passed without observing the credential value and
  without inheriting a UAT/Railway/Studio credential source;
- a sanitized negative-proof receipt schema is installed, so expected rejected attempts record
  authority key, operation, domain-code/SQLSTATE, digest and timestamp only—never SQL, secret,
  text or identity; and
- the action-time confirmation is stored as a digest in the authority/terminal receipt, never as
  an unbounded comment.

At terminal state, reconcile: provider attempts, turn count, trace count/bytes, proposal count,
reserved/settled spend, candidate revision/editorial count and all activation flags. Expected
activation effects are zero. The candidate remains editable by the Insights Manager through the
ordinary editor; accepting or declining the proposal is a separate human action.

## Implementation checklist (local implementation complete)

The required local implementation is deliberately narrow:

- add a Worker orchestration job plus input/output contracts for this flight;
- route every model tool decision to the existing `create`, `navigate` and `append proposal`
  refinement core; do not add any direct database or editorial shortcut;
- persist the flight authority, idempotency, pre-transport one-shot dispatch claim, budget
  reservation/settlement and terminal receipt append-only in the local Lab plane; and
- add fake-provider and PostgreSQL adversarial tests for maximum turns, all tool bounds, stale
  session, untraced citation, exhausted budget, pre-transport rejection, duplicate dispatch claim,
  ambiguous first outcome, nullable known settlement, forged run/checksum provenance, credential
  composition, token clamps and aggregate-budget contention.

This implementation is local-only and provider-disabled until a fresh independent P0/P1-free
audit. A future UAT rollout is a distinct forward-only migration/deploy/QA gate; applying `0118`
to UAT is explicitly out of scope.

## Observed result, 2026-09-06

Flight `topic-refinement-flight-6e2f5f94cdbaf922` completed in local clone
`noisia_topic_eval_lab_20260906_1cd623f0d548`: three provider calls, eight representative
mentions, five cited references and one stored proposal, USD0.048738. Ten original candidates
remained editable with zero editorial/adoption/publication/serving effects. The independent
review found a useful draft with provenance/citation caveats; it is not a publication approval.
The paid flight did not use Brand OS navigation or related-candidate comparison. A deterministic
initial Brand OS bootstrap is the next local correction; relationship discovery remains an
integration gap. See [readable result](PROMPT_LOOPING/RESULTADO_TOPIC_LAB_2026-09-06.md).
