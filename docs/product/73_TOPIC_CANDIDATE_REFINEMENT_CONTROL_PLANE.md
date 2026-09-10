# 73 · Topic Candidate Refinement Control Plane

> **Status (2026-09-06):** local control plane and bounded provider runner implemented. A real
> refinement completed with one persisted proposal, eight retrieved mentions and five citations
> (USD0.048738). The ten-candidate result and its archived proposal are now imported and visible
> in Preview/UAT on dc48104 (LAB-2V); the paid refinement runner itself remains local.
> See document74 and the dated result
> in `PROMPT_LOOPING/RESULTADO_TOPIC_LAB_2026-09-06.md` for current receipts and limitations.
> **Scope:** enrich local, pending Topic candidates with bounded evidence navigation and
> human-reviewable proposals.
> **Does not authorize:** Topic Contract creation, adoption, publication, serving, UAT/prod
> writes, Discovery Review changes, raw corpus export or a provider invocation.

> **Provider custody:** the implemented local flight uses a dedicated Keychain-scoped child
> composition and sealed price/token/budget authority. The masked UAT service variable is neither
> a local credential source nor an execution authorization. This document itself starts no call.

## Why this exists

The discovery pipeline has two different jobs:

1. local clustering finds candidate structures across the eligible corpus; and
2. a bounded language-model pass makes those structures legible to a human by naming, explaining
   and comparing them against Brand OS.

The model should not be handed 21,195 raw mentions, nor should it receive a magic database tool.
It needs the useful middle ground: it can ask the server for small, attributable views of a
candidate's source-cluster evidence. This is analogous to a narrow internal MCP surface, not an
unbounded agent and not an autonomous Topic writer.

## Proven starting point

LAB-2G produced ten local pending candidates from 115 frozen historical BERTopic proposals. The
run used 12 model turns and 11 bounded retrievals, persisted 30 immutable evidence links, and
settled USD 0.396885. Its independent audit found all ten candidates coherent and editable. That
result is sufficient to build the refinement experience; it does not imply that any candidate is
an adopted Topic.

## Original design baseline and additions (implemented locally)

Before LAB-2H, the V2 evidence plane was a **snapshot-scoped**, read-only foundation. It had no
refinement session, navigation trace or refinement-proposal writer. Its candidate-detail route is
a bounded product reader, not a sealed model tool. Existing evidence navigation accepts any
cluster valid for the workspace snapshot; it is not bound to a candidate's source clusters.

LAB-2H added a separate refinement control plane wrapping the bounded operations with one sealed
candidate revision/session. It exposes no direct SQL, raw artifact or free-text corpus tools.
The table below records the design boundary, not missing work in today's implementation.

| Operation | Current fact | Refinement wrapper requirement |
| --- | --- | --- |
| `candidate_context` | A bounded candidate-detail reader exists, but no model tool | New projection from the sealed candidate/base-editorial revision |
| `brand_os_context` | Caller selects up to 40 approved element keys | Server derives a relevant allowed subset from the sealed candidate/session |
| `cluster_catalog` / `cluster_profile` | Snapshot-scoped bounded reads | Omit catalog or expose only the session's sealed source clusters |
| `representative_mentions` | Deterministic, sanitized bounded slice | Reject every cluster outside the session allowlist |
| `search_cluster` | Server-query-owned page ≤20 with stable, snapshot/rights/filter-bound cursor | Reissue cursor bound to session, candidate revision and explicit expiry |
| `compare_clusters` | Snapshot-scoped comparison accepts two to five keys | Permit exactly two, both in the session allowlist |

## Proposed refinement protocol

1. The server creates an append-only refinement session that seals the workspace, run, candidate,
   exact base/editorial revision digest, Brand OS authority digest, actor, allowed source-cluster
   keys and a short expiry. A stale candidate or changed authority cannot be silently substituted.
2. The model receives session-bound context and can make only wrapped navigation calls. The
   implemented flight card caps turns, navigations, result bytes, input/output tokens and cost.
   Deterministic candidate and Brand OS bootstrap before the first paid turn passed independent
   review and15/15local tests; the completed ninth experiment predates that change and did not
   retrieve Brand OS.
3. The model returns one structured **proposal**: display name, short description, cited evidence
   references, related candidates and optional `consider_merge` / `consider_split` suggestions.
4. The wrapper appends a navigation-trace row for each validated result. A dedicated proposal
   writer validates the schema, citations against that session trace and related-candidate keys
   against the same run, then appends a proposal. It is distinct from the editorial writer and
   cannot update editorial state.
5. The verified product integration, now deployed in Preview/UAT, exposes the persisted proposal in the existing editor.
   “Usar propuesta” copies wording into unsaved fields; ordinary save creates a reversible
   candidate revision. Dismissing a suggestion is not a durable rejection; existing reject/restore
   acts on the candidate. A suggested merge/split is review context only. No action creates or
   activates a Topic Contract.

This keeps the useful “Claude can inspect more when needed” behavior while retaining a reversible
human control point. An operator can make a simple correction without writing a justification,
but history and concurrency remain durable.

The historical-result import described in [ADR018](../adr/018-topic-lab-result-product-import.md)
has passed local PostgreSQL integration and independent audit to bring the existing result into
UAT without a duplicate paid run. A separate product-only schema proof passes without Lab
0116–0121. LAB-2V deployed only0115/0122 and the focused Studio editor; authenticated UI and
independent read-only DB reconciliation passed on2026-09-06. Workers was unchanged. The import preserves the
original proposal as history, not an expired live session to be replayed.

The next local cut (LAB-2W) makes the exact cited mention excerpts readable inside this editor.
It does not retrieve a substitute sample or rerun the model. Original candidate citations and
the archived proposal's citations are separate collections, resolved against their original run
snapshot and current rights. Missing or revoked evidence is shown as unavailable, not replaced.

## Non-goals and hard stops

- No automatic approval, merge, split, adoption, publication or Signal serving.
- No access to every mention at once; pagination deliberately prevents an accidental
  unbounded-context request. A later policy may allow more pages only through a sealed flight card.
- No provider call in the design or implementation gate.
- No change to Discovery Review. Candidate refinement is a separate surface from BERTopic proposal
  review and from governed Topic Contracts.

## Implementation and audit checklist

Before an implementation gate may open, confirm:

- a session seals workspace/run/candidate/revision/Brand OS authority and source-cluster
  ownership before any refinement navigation;
- cursor reuse across sessions or candidates, expired cursors, changed filters and oversized page
  sizes fail closed;
- tool results remain sanitized and byte-bounded;
- the structured proposal cannot invoke an editorial writer or any Topic Contract path;
- idempotency, optimistic concurrency and append-only trace are independently tested; and
- a provider-enabled evaluation has its own purpose, preflight, budget, confirmation and fresh
  idempotency key; and
- a disposable PostgreSQL proof has exercised the actual session, trace and proposal triggers
  before any provider-enabled flight card is opened.

## Current verified boundary

The actual trigger proof ran in an externally anchored, disposable local PostgreSQL clone only.
The proof confirmed the cumulative 192-KiB trace ceiling, server-sealed 15-minute sessions,
append-only rows, input-bound idempotency and one-proposal-per-session enforcement. It made no
provider call and did not mutate editorial candidates or any Topic activation surface.

Railway UAT variables and the dedicated local Keychain item are separate configurations. Neither
presence alone authorizes a flight. The executable refinement design is specified separately in
[`74_TOPIC_CANDIDATE_REFINEMENT_FLIGHT_CARD.md`](./74_TOPIC_CANDIDATE_REFINEMENT_FLIGHT_CARD.md).
