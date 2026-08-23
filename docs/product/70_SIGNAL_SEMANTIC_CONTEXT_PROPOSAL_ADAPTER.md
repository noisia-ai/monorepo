# Semantic Context Proposal Adapter — 69A.2 / NOI-72

| Field | Value |
|---|---|
| Status | `implemented_local_provider_fake_only` |
| Recorded | `2026-08-22T09:53:36-06:00` (`America/Mexico_City`) |
| Authority | Semantic Context Pack 69A, Brand OS, Knowledge and DB-owned AuthZ |
| Migration | `0092_signal_semantic_context_proposal_execution.sql` |
| Migration SHA-256 | `5e52de57dd31ee9ca3d699ddfd76280a02c67b6dee7a3be71be66fa24227cc8f` |

## Outcome

69A.2 adds a bounded, durable adapter that may ask one server-pinned provider call to
propose a structured Semantic Context Pack. It does not approve or publish anything.
Every accepted output is appended through the 69A canonical writer with:

```text
origin_kind = provider_proposal
disposition = pending
confidence_authoritative = false
```

Confidence `1.0` remains pending. No path added by this gate writes Topic Contracts,
classification assignments, `record_tags`, serving, pointers or governed bindings.

## Transport and authority decision

The preimplementation audit selected the existing Workers AI SDK Anthropic transport,
not the Study OS persistence and not the synchronous legacy fetch adapter. Query Composer
and Semantic Context now share a bounded text transport; their provider-neutral prompts,
schemas and persistence adapters remain separate.

The durable path is:

```text
management POST + Idempotency-Key
  -> operation ledger + exact preflight CAS
  -> micro-USD reservation + one run per generation
  -> PostgreSQL outbox
  -> existing Data OS BullMQ queue
  -> Worker resolves sealed Brand OS/Knowledge context
  -> one provider call maximum
  -> private response persisted
  -> closed all-or-nothing validation
  -> canonical 69A append (pending only) + settlement + terminal event
```

The context contains no mentions. Brand identity, aliases, products, competitors,
locale/markets, structured context and Knowledge blocks remain distinct. Authority refs
and entities are replaced by deterministic opaque aliases before transport; only the
server resolves them back to 69A evidence refs.

## Recovery contract

- The provider request identity is deterministic and sealed to generation, preflight,
  context, prompt and model.
- A generation has at most one durable run and at most one effective provider call.
- A response is stored privately before validation. Recovery from that state performs
  validation and append without calling the provider again.
- A transport error that proves no request was sent is retryable through the same run.
- An ambiguous provider outcome is dead-lettered, never retried automatically, and its
  full reservation is conservatively settled.
- Invalid JSON, unknown evidence aliases or any other partial-invalid response append
  zero elements and terminally reconcile the outbox.
- Brand OS, Knowledge or locale drift before/during execution produces `stale` and zero
  proposals.

## Persistence

`0092` adds:

- `signal_semantic_context_proposal_runs` — immutable run authority, sealed lineage,
  provider request/usage and sanitized terminal result;
- `signal_semantic_context_budget_reservations` — exact micro-USD reservation,
  settlement or release;
- `signal_semantic_context_proposal_outbox` — leased recovery/dispatch authority;
- `signal_semantic_context_proposal_run_events` — append-only sanitized transitions.

Identity and terminal state protections reject destructive rewrites. The migration also
adds only the three new operation actions needed for start, retry and the already
canonical append boundary. It does not change 0091.

## Management API

| Contract | Purpose |
|---|---|
| `GET .../semantic-context/preflight` | free exact-authority/runtime/budget preflight; zero writes and calls |
| `POST .../semantic-context/proposals` | confirm and queue one bounded run |
| `GET .../semantic-context/proposals/{runKey}` | sanitized status, progress, settlement and result digest |
| `POST .../semantic-context/proposals/{runKey}/retry` | only definitely-not-sent recovery |

Writes require `Idempotency-Key`. The browser may provide only the generation key,
preflight digest, literal confirmation and a hard cap no greater than the platform cap.
It cannot provide prompt, provider/model/pricing, workspace authority, Brand OS or
Knowledge IDs/digests, evidence IDs or approval state. Responses are `private,no-store`
and omit prompts, raw provider output, Knowledge blobs, evidence UUIDs and stack traces.

## Local rehearsal

A disposable PostgreSQL fixture with Brand OS, multiple Knowledge records, products,
competitors, MX/US locale authority and a fake provider demonstrated:

- one draft and one completed run;
- exactly one fake call;
- one appended pending proposal and zero approved/rejected proposals;
- exact evidence alias reconciliation;
- concurrent same-key replay to one run;
- crash-after-provider recovery with no second call;
- invalid output and unknown alias with zero append;
- drift before/during execution with zero append;
- hard-cap rejection before operation/outbox/provider work;
- cross-workspace rejection;
- zero changes to Topic Contracts, assignments, tags, serving, pointers and bindings.

No real provider, remote database, staging or production was accessed. The 10C.3B
context-aware preflight remains blocked until an operator reviews and publishes a real
pack. 10D remains blocked.

## Canon reconciliation anchors

Docs 31, 56 and 68 contained preexisting worktree changes and were intentionally not
rewritten by 69A.2. Their next clean reconciliation should change only these facts:

- 69A.2 is implemented locally with provider fake only;
- 69B frontend may consume the preflight/start/status/retry contracts;
- real provider execution remains separately authorized;
- context-aware discovery readiness still requires a published, current pack;
- 10D remains blocked.

## 69A.3 dependency closure

**Recorded:** 2026-08-22T15:05:20-06:00 (`America/Mexico_City`).

Proposal execution now resolves only the effective leaf generation. A stale draft,
published generation, or legacy draft without provider lineage is replaced by the
append-only reconciliation contract in migration 0093 before preflight can become
ready. Nonterminal proposal runs block supersession; reconciliation never retries or
starts a provider call. Historical runs retain their original generation digests.

## Preview/UAT dependency state

**Recorded:** 2026-08-22T15:34:17-06:00 (`America/Mexico_City`).

The append-only stale-draft reconciliation dependency is deployed through migration
0093 and `POST /semantic-context/reconcile`. The durable adapter remains closed: UAT has
zero proposal runs, reservations, outbox rows and real proposals, and Anthropic was not
called. Authenticated visual QA still requires renewal of the expired Kinde session;
until then this document does not declare a real provider generation or 10C.3B
readiness.

## Authenticated UAT dependency closure

**Recorded:** 2026-08-22T18:38:55-06:00 (`America/Mexico_City`).

The real Preview/UAT flow created draft v1, detected missing provider lineage and
reconciled it append-only into draft v2. A generic runtime defect was fixed before that
transition: durable preflight now distinguishes `provider_lineage_required` from
`provider_lineage_drift`, so Frontend 69B submits the closed
`provider_lineage_missing` reason only when the writer will independently classify the
same condition. The server remains the authority for snapshots, digests, provider,
model and pricing.

The reconciled free preflight is ready with model `claude-sonnet-4-6`, one maximum call,
USD 0.255 estimated maximum cost, USD 1 platform cap and healthy Worker/recovery. The
budget confirmation remained unchecked and the paid action remained disabled. Database
evidence records zero proposal runs, reservations, outbox rows, run events and elements;
therefore no provider request identity was dispatched and no settlement occurred.

This checkpoint validates only the free management path and recovery readiness. It does
not authorize a real proposal run, publish a pack, open context-aware discovery, or
advance 10D.

## 69A.4 — validation incident and closed recovery

**Recorded:** 2026-08-22T23:31:58-06:00 (`America/Mexico_City`).

The first authorized Preview/UAT proposal run reached the provider exactly once and was
rejected atomically. A private, repeatable-read/read-only audit reproduced two generic
contract failures without logging the response: output usage reached its sealed
`5000/5000` token limit and left one open Markdown fence with no balanced JSON object;
the free-text prompt also described “closed proposal objects” without supplying their
field schema. The partial shape contained 36 `element_kind` entries but no
`element_key`, `canonical_key` or `evidence` fields. The canonical parser therefore
rejected the response before append. Settlement stayed within reservation, the outbox
dead-lettered, and proposal/approval/serving writes remained zero.

The corrected adapter keeps the same shared Anthropic transport but supplies the closed
schema through structured output. The governed prompt policy now enumerates the same
closed fields and therefore has a new lineage digest; the failed generation is not
silently treated as compatible with the corrected transport. A versioned 256-token allowance derives a dynamic
proposal maximum from each run's sealed output budget; the canonical parser validates
the complete result again and accepts only raw JSON or one exact JSON fence. Complete
schema failure still creates zero proposals. The DB now persists a precise private
diagnostic and append-only failed event while returning only a translated, operator-safe
error. A response at the exact output cap is classified
`semantic_context_provider_response_truncated`; retry remains blocked after any paid
response.

The unrelated PostgreSQL warning was traced to parallel `query()` calls against one
transaction-scoped `pg.Client` while preparing Brand OS/Knowledge context. Those reads
are now sequential. The warning did not cause the rejected response: the provider input
was prepared, the response was durably stored, and validation failed later on its
content envelope.

No migration was required. The failed UAT run remains immutable and is not retried.
This correction does not authorize another provider call, publish a Semantic Context
Pack, open context-aware 10C.3B, or advance 10D.

## 69A.4 Preview/UAT verification

**Recorded:** 2026-08-22T23:55:00-06:00 (`America/Mexico_City`).

Preview/UAT deployed the validation correction on Studio and Workers. The original run
remains the single failed run with one settled provider response, zero elements and a
dead-letter outbox; no runnable proposal work exists. Protected mentions, imports,
classification assignments, `record_tags`, pointers and governed bindings retain their
pre-deploy digest.

The new free preflight is operator-safe and reports one maximum call, 19 proposals for
the sealed 5,000-token output budget, USD 0.115899 estimated maximum cost, the existing
USD 1 platform cap and healthy Worker/recovery. It correctly fails closed with
`provider_lineage_drift`, because the explicit closed prompt/schema policy has a new
digest. The UI exposes `Reconciliar contexto`, leaves budget confirmation unchecked and
keeps the paid action disabled. This checkpoint deliberately did not create the
successor generation; that append-only reconciliation and any later paid execution need
a separate operator authorization.
