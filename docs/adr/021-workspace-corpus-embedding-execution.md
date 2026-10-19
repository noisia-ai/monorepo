# ADR 021 — Workspace corpus embeddings with durable cost evidence

Date: 2026-09-08
Status: Accepted for provider-disabled implementation; real-provider activation remains a separate bounded execution.

## Context

ADR020 provides an immutable, full-text manifest of eligible workspace mentions. Its completion does not mean semantic computation has run. Legacy embedding readers operate on study-corpus identities, copy text and silently limit inputs; the legacy transport also truncates and discards billable usage. Reusing those contracts would obscure incomplete computation and monetary recovery.

## Decision

Consume the prepared manifest directly. Add only execution/cost state, physical call receipts and a workspace-scoped chunk-vector cache. Reuse the Data OS queue, Worker and PostgreSQL outbox/lease pattern. No second population, legacy study bridge, global vector reuse or new queue framework.

The versioned vector identity seals provider, model, dimensions, input type, output dtype, no-truncation policy, chunk policy, request contract and tokenizer/bound versions. Price is sealed in the execution profile separately so a rate change does not invalidate compatible vectors. This first profile is Voyage voyage-4-large, 1024 float dimensions, document input, truncation false.

Iterate ordered asset/chunk references without a corpus cap. Repeated identical chunks reuse successful vectors, while coverage accounts for every original eligible root and chunk reference. A root is complete only when every chunk is represented. A new import invalidates currentness, then reuses compatible unchanged chunks under a new explicit cost authorization.

Quote locally using a conservative UTF-8/token bound, pending assets/chunks and per-call upward rounding. Monetary authority uses integer microUSD. Reserve before a single physical send; mark sent before transport; persist the bounded private response before validation. Exact indices, cardinality, dimensions, float32-representable finite vectors and usage are required. An optional returned model must match the sealed request. Never repair missing/invalid vectors or silently retry a request.

A response to an already-sent call remains accounting evidence after authorization, rights or lease expiry. Its observed cost is recorded independently from a current cache/checkpoint commit. Cache writes and checkpoint advancement revalidate current inputs, rights and actor authority. An observed cost exceeding a reservation is retained as an exception and blocks additional sends; it is not discarded to satisfy a CHECK.

A local failure with a durable receipt resumes the same run, cap and cursor without another provider call. An unknown transport outcome retains its reserve and blocks overlapping requests across runs. An explicit provider reconciliation path is still required before production activation; the UI must not promise a generic retry for unknown charges.

The provider defaults disabled with one explicit flag. A disabled transport cannot create a new paid intent through Studio, while the Worker may reconcile existing receipts. Clients' existing import authority does not grant paid execution; server-side `can_execute_topics` remains authoritative.

## Consequences

This enables a complete, recoverable embedding foundation without claiming classification, topic discovery, Claude naming or Signal completion. Topic guidance, clustering/emergence, incremental monitoring budgets, self-service financial reconciliation and production client access remain explicit successor work. Physical retention/withdrawal of derived assets is tracked separately; invalidating use does not erase stored receipts or vectors.

Local tests inject a fake transport against an isolated database and Redis. No fake vectors or fixtures are uploaded to UAT. The first real provider request requires its own current corpus, verified rights and visible cost cap.

References: [Voyage embeddings API](https://docs.voyageai.com/reference/embeddings-api), [pricing](https://docs.voyageai.com/docs/pricing), [tokenization](https://docs.voyageai.com/docs/tokenization), [official response type](https://github.com/voyage-ai/typescript-sdk/blob/main/src/api/types/EmbedResponse.ts).
