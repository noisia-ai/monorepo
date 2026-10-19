# ADR 015: Signal Uses A Semantic Cascade And Governed Topic Contracts

## Status

Accepted as product and architecture direction on 2026-08-15. The current semantic and
taxonomy workers do not yet comply. This ADR does not authorize provider spend, schema
changes, remote writes, reader cutover or client publication.

## Context

Alexa demonstrated that a workspace can ingest more than 100,000 canonical roots, but
the current Semantic Review preflight sends every unresolved root toward Claude and the
current Topics & Narratives worker drains the included population through Voyage and
Claude. Provider cost therefore grows with every mention before Noisia sells a strategic
study.

Signal is the low-marginal-cost operational layer. T&B is the separately budgeted
strategic layer. The data plane already distinguishes source/import acquisition intent
from approved semantic assertions; its classification architecture must preserve that
distinction at scale.

## Decision

### Governed acquisition

Brand OS identities produce server-owned acquisition slots for primary brand,
category/industry and each competitor. A source remains the stable connector. Import
batches own the query/version, period and expected identity. Acquisition intent is
evidence and never automatic semantic approval.

### Semantic cascade

Classification proceeds through exact governed identity, abstaining labeling functions,
a calibrated local multilingual classifier, human review and an optional bounded Claude
exception lane. Each stage may abstain. `abstained` is distinct from an operator
`rejected` decision.

Autoaccept requires a versioned policy measured on a held-out operator-approved gold set.
Model self-reported confidence never authorizes approval.

### Partial publication

Incomplete Semantic Review does not block all Signal publication. It creates a declared
`partial` state. Every reader must return eligible, classified, pending, abstained and
rejected counts, exact metric denominator, coverage, limitations, versions and watermark.
Unknown never becomes approved or zero. A reader that cannot declare this state fails
closed.

### Topics & Narratives

Local embeddings and topic modeling discover structure over the full eligible
population. A bounded representative packet may be used by Claude to propose names,
definitions, examples, exclusions and merges/splits. Sample-only evidence never becomes
a full-population count.

Claude and the browser cannot emit executable SQL, regex or policy expressions. They
produce a closed Topic & Narrative Rule Spec. A server-owned validator/compiler injects
workspace, rights, eligibility and canonical-root predicates and emits parameterized
PostgreSQL full-text/pgvector plans. Narratives require semantic evidence and stronger
thresholds than lexical topic matches.

Approved contracts classify current and future mentions through append-only versioned
assignments. Contract, model, embedding or threshold changes invalidate affected
assignments and create a new generation. Novelty and drift create review work; they do
not mutate an approved catalog silently.

### One classification authority

The existing full-population Voyage/Claude enrichment path must be disabled or retired
before the new cascade is activated. It cannot remain as a permanent parallel truth.

## Technology Boundary

The first benchmark uses a multilingual Sentence Transformer, BERTopic-style discovery,
FASTopic as challenger, Snorkel-style labeling functions and PostgreSQL FTS + pgvector.
SetFit and Cleanlab follow after a gold set exists. Elasticsearch Percolator is only a
future scale option.

The production runtime remains Node/TypeScript by default. Python-first frameworks may
be evaluated in an isolated reproducible harness. Adding a Python service or a new model
artifact requires an ADR covering license, hashes/signing, supply chain, operation,
invalidation and rollback.

The 2026-08-16 Gate 10C harness completed with an explicit `no_adoption` result. Neither
BERTopic embedding configuration passed all semantic gates, and both FASTopic variants
exceeded the preregistered eight-hour full-pop runtime lower bound during calibration.
No artifact was recommended or approved, so this ADR does not authorize a Python
service, model runtime, 10D execution, or serving integration. A later attempt requires
a new preregistered benchmark and human review; it may not reinterpret the calibration
packet as a winning model decision.

## Consequences

- Provider cost no longer scales linearly with all operational mentions.
- Operator effort focuses on uncertainty, examples and catalog governance.
- A discovered topic becomes reusable knowledge for the current corpus and future
  imports.
- Full-population metrics remain SQL-derived and coverage-aware.
- Assignment storage must become append-only and gain explicit abstention.
- The current score-based taxonomy autoapproval is a release blocker.
- Signal prepublish gains a T&N contract gate and a partial-coverage state.

## Rejected Alternatives

### Ask Claude to classify every mention

Rejected because cost scales with volume, the model becomes the classification store and
approved knowledge is not reused economically.

### Run a 10,000-row sample and extrapolate its topic counts

Rejected because discovery evidence does not prove full-population membership. Local
full-population scoring is required for full-population counts.

### Execute SQL generated by Claude

Rejected because it bypasses AuthZ, data rights, schema evolution, resource limits,
testing and reproducibility.

### Treat acquisition query intent as semantic truth

Rejected because a listening query may contain noise and multi-entity mentions. Intent
remains lineage evidence.

### Build a proprietary topic model before benchmarking existing frameworks

Rejected because mature discovery, weak-supervision and few-shot components already
exist. Noisia's differentiation belongs in governance, evaluation, operator UX and
longitudinal contracts.

## Implementation Gate

The ADR is not implemented until all of the following are proven:

- score-based self-autoapproval removed;
- append-only assignments and `abstained` disposition shipped;
- old full-population provider worker unavailable;
- acquisition slots reconciled server-side from Brand OS;
- local benchmark selects a licensed, pinned model/artifact;
- Rule Spec validator/compiler passes injection, timeout and cross-workspace tests;
- a contract classifies 100K+ roots and a later import reproducibly;
- gold-set evaluation and drift queues operate;
- every reader declares denominator/coverage/limitations;
- preview, partial publish, ready publish and rollback pass real browser QA.

The complete product contract and rollout gates live in
`docs/product/55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md`.

## Amendment 2026-08-17 · Acquisition query evidence

For manual CSV acquisition, a stored query is not proof of provider execution. Query
lineage is attested evidence unless a provider adapter proves execution. Imports therefore
seal one closed evidence class: `operator_attested`, `unavailable`, or server-only
`provider_verified`. The browser cannot request provider verification.

Missing query evidence does not erase file, slot, actor, period, or connector lineage and
does not block later semantic review or serving by itself. It remains an explicit
provenance limitation. Acquisition intent never becomes semantic approval, regardless of
evidence class, and completing the query playbook prospectively never rewrites history.
