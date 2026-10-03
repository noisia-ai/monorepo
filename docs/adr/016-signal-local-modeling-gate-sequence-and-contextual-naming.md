# ADR 016: Signal Separates Local Modeling, Semantic Shadow And Contextual Naming

## Status

Accepted as the corrective Gate 10C.0 architecture decision on 2026-08-16. This ADR
does not adopt a model, authorize Gate 10D, authorize provider calls, or permit writes
to serving.

## Context

The first Gate 10C benchmark correctly returned `technical_no_adoption` for its frozen
matrix, but later audit found that BERTopic's lexical representations were dominated by
stopwords, no locale-aware multilingual vectorizer was installed, a single UMAP/HDBSCAN
profile was used, parameters were silently adapted to corpus size, and missing
probabilities were represented as strength `1.0`. Those defects limit the conclusion to
the executed configurations; they do not prove that local document clustering is
inviable.

The product canon also named Gate 10D inconsistently. One document called it the Topic
Contract control plane while the execution plan called it the local semantic cascade
shadow. That ambiguity could allow contextual naming or publication work to start
without a valid modeling decision.

## Decision

### Canonical sequence

The only valid sequence is:

1. **10A — Acquisition Plan**;
2. **10B — Semantic Authority**;
3. **10C/10C.1 — Local Modeling Benchmark**;
4. **10D — Local Semantic Cascade Shadow**;
5. **10E — Topic Contract Control Plane And Bounded Contextual Naming**;
6. **10F — Propagation, Incremental Processing And Drift**;
7. **10G — Signal Prepublish**;
8. **10H — Production Readiness And Bridge Retirement**.

Gate 10C.1 never executes 10D. Gate 10E cannot open without a valid 10C.1 decision and
the applicable operator gate. Designing a future naming contract in 10C.1 does not
authorize calling a provider or building the 10E control plane.

### Three independent evaluation layers

The benchmark evaluates separately:

1. multilingual embeddings and document clustering;
2. lexical/semantic cluster representation;
3. human quality of a proposed name and definition.

A poor c-TF-IDF representation does not prove that document memberships are poor. A
coherent cluster does not become an approved topic because a machine-generated name
sounds useful. Missing membership probability is `not_available`, never synthetic
confidence.

### Governed analysis context

Every future discovery or contextual-naming run resolves a server-owned, digest-sealed
`Governed Analysis Context Snapshot` from existing authorities:

- Brand OS is required for brand workspaces;
- Study OS is required only for study-scoped work; always-on Signal records it as
  `not_applicable`;
- Acquisition Plan supplies exact slot/entity intent, import/query provenance, period
  and timezone;
- Knowledge Base and methodology context are referenced by digest, not copied as dumps.

The resolver fails closed when the Brand OS and Acquisition Plan identity-catalog
digests differ, or when a study scope/period falls outside the sealed acquisition
envelope. The future context envelope must prove that every Brand OS, Study OS,
Acquisition Plan, Knowledge Base and methodology source digest is exactly the one in
the analysis snapshot; listing plausible context sources is not sufficient lineage.

Locale precedence is Study OS when explicitly study-scoped, Brand OS defaults for
always-on Signal, Acquisition Plan for effective scope/period/timezone, and an explicit
workspace fallback only when governed. Missing or contradictory locale is
`requires_operator_decision`; runtime never assumes `es-MX`, English, Mexico, or another
market.

### Local full-population authority and optional naming

Eligible canonical roots are normalized, embedded, clustered and assigned locally. A
bounded representative packet may later support a Claude proposal in Gate 10E, but the
provider cannot calculate population counts, alter memberships, emit executable policy,
approve a Topic Contract or become a publication dependency. Manual operator naming
must remain available.

Future provider context is a server-owned `Governed Context Envelope` with explicit
rights, relevant source refs, versions, digests and token bounds. Its closed output may
propose a display name, definition, inclusion/exclusion summaries, evidence references
and merge/split flags. It cannot return counts, SQL, regex, confidence, promotion or
policy expressions. Cache identity includes cluster, packet, context, retrieval policy,
model and prompt digests.

### Adoption boundary

A technical finalist from 10C.1 is not an adopted model. Adoption requires a completed
blind operator review and a separate adoption ADR. A single-scope corpus can prove scale
and that scope's noise handling, but cannot prove general multi-scope quality.

## Consequences

- 10D remains blocked throughout 10C.1.
- Corrective benchmark parameters are preregistered and must equal effective parameters
  or fail; silent clamps are invalid evidence.
- Locale-aware preprocessing and BERTopic representation share one versioned policy.
- Every eligible root is reconciled as assigned, multi-assigned, outlier, pending,
  abstained or technical error; unknown never becomes zero.
- Claude naming remains O(clusters), optional, bounded, rights-aware and operator-gated.
- No Python service, database migration, reader change or serving write is authorized by
  this ADR.

## Rejected Alternatives

### Treat the first BERTopic labels as proof that clustering failed

Rejected because lexical representation and membership quality are distinct layers.

### Hardcode Spanish or Mexico because most expected work is es-MX

Rejected because product priority is not runtime authority.

### Let Claude name or classify every root

Rejected because it makes provider availability and cost part of full-population
authority and breaks reproducible denominator ownership.

### Open Topic Contracts directly after a technical benchmark

Rejected because operator review and a separate adoption decision are required first.
