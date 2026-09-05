# 73 · Topic Candidate Refinement Control Plane

> **Status:** local implementation audited; provider-disabled pending disposable PostgreSQL proof.
> **Scope:** enrich local, pending Topic candidates with bounded evidence navigation and
> human-reviewable proposals.
> **Does not authorize:** Topic Contract creation, adoption, publication, serving, UAT/prod
> writes, Discovery Review changes, raw corpus export or a provider invocation.

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

## Current state and required additions

The existing V2 evidence plane is a strong **snapshot-scoped**, read-only foundation. It has no
refinement session, navigation trace or refinement-proposal writer. Its candidate-detail route is
a bounded product reader, not a sealed model tool. Existing evidence navigation accepts any
cluster valid for the workspace snapshot; it is not bound to a candidate's source clusters.

LAB-2H must therefore add a separate refinement control plane rather than pretending those
properties already exist. It will wrap the existing bounded operations with one sealed candidate
revision/session. It must not add direct SQL, raw artifact or free-text corpus tools.

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
2. The model will receive only `candidate_context` from that session and can make only wrapped
   navigation calls. A later, separately approved provider flight card must cap turns,
   navigations, result bytes, input/output tokens and cost. The implemented local plane currently
   exposes only navigation/result-byte ceilings and permits zero provider calls.
3. The model returns one structured **proposal**: display name, short description, cited evidence
   references, related candidates and optional `consider_merge` / `consider_split` suggestions.
4. The wrapper appends a navigation-trace row for each validated result. A dedicated proposal
   writer validates the schema, citations against that session trace and related-candidate keys
   against the same run, then appends a proposal. It is distinct from the editorial writer and
   cannot update editorial state.
5. The Insights Manager sees a plain-language proposal and chooses ordinary save, reject, restore
   or undo through the existing candidate editor. A suggested merge/split is review context only;
   no model or operator action here creates a Topic Contract.

This keeps the useful “Claude can inspect more when needed” behavior while retaining a reversible
human control point. An operator can make a simple correction without writing a justification,
but history and concurrency remain durable.

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
