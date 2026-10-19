# Corpus Engine Validation Contract

**Status:** Canon for the production-bound Data OS branch
**Date:** 16 July 2026

## 1. Decision

The Engine has two evaluation systems with different populations, evidence and gates.
They must never share a readiness state or present their scores as interchangeable.

1. **Query-pack evidence evaluation** evaluates the mentions imported from a first
   extraction made with one exact query pack. It happens after ingestion and helps the
   analyst decide whether to keep or adjust that query.
2. **Corpus certification** evaluates the current versioned corpus as a whole. It is the
   only process allowed to approve a corpus for analysis.

The first answers: **"Did this exact query retrieve useful evidence for its pack?"**
The second answers: **"Does corpus revision rN contain enough usable evidence to run the
study?"**

The production Engine does not call the SentiOne API, or any other listening-provider API,
to predict query quality before extraction. Provider APIs may return later as optional,
project-scoped adapters, but they are outside this contract and cannot become a hidden
production dependency.

## 2. Production flow

### 2.1 Resolve the authoritative RAG context

Query generation starts from governed Data OS records, not from an isolated prompt:

- a brand study retrieves **Brand OS** identity, aliases, handles, markets, industries,
  competitors and accepted Knowledge Sources;
- a theme study retrieves **Theme OS** identity and accepted Knowledge Sources;
- both retrieve **Study OS** business question, structured objective, audiences,
  constraints, methodology and query-pack objective;
- the Strategy Brief is a prioritized compaction of those records for generation. It is
  not a second source of truth and cannot override the underlying canonical records.

Claude may propose query text, but its response is not authoritative for aliases,
competitors, categories, markets, exclusions or pack scope. Those components are rebuilt
from Data OS after parsing, so model-supplied `query_components` cannot replace canonical
values.

The generation trace persists the subject OS, retrieved RAG scopes, accepted source types
and count, whether the Strategy Brief was used, the required query scopes and the portable
dialect version. This makes the prompt context inspectable without storing a second,
uncontrolled copy of Brand OS, Theme OS or Study OS.

### 2.2 Compose and compile portable query hypotheses

Inputs:

- Brand OS identity, aliases, handles, competitors and countries;
- New Study business question, structured objective, audiences and constraints;
- accepted Knowledge Base assertions and source context;
- methodology and query-pack objective.

Output: one versioned boolean candidate per required production pack. The primary brand or
theme pack is always required. Competitor and category packs are required only when the
canonical Data OS context contains usable seeds for those scopes. For T&B this normally
produces brand, competitors and category, but the model must not invent optional packs to
complete a fixed count.

Queries use the production-safe subset of Listen Query Language: explicit `AND`, `OR`,
`NOT`, double-quoted phrases, portable phrase proximity (`"phrase"~n`), parentheses,
terminal `*` wildcards and single-character `?` wildcards. Provider-specific fields,
project IDs, source, language, country and date filters stay outside the expression as
metadata.

The semantic construction rules, exploratory/detection mode matrix, ambiguity profiles,
competitor identity and post-ingest tag contract are canonicalized in
`30_QUERY_CONSTRUCTION_V2.md`.

Before a candidate can be saved or materialized, the deterministic compiler verifies:

- balanced quotes and parentheses;
- explicit operators and valid operands;
- at least one positive inclusion before exclusions;
- wildcard placement and minimum prefix length;
- absence of advanced provider-specific fields;
- the maximum portable-query length;
- duplicate or excessively broad terms as warnings.

If Claude returns invalid syntax, the worker performs one bounded repair call using the
compiler errors. Any scope still invalid is replaced by a deterministic query assembled
from canonical components. The generation contract records every structural report,
rejected candidate and fallback scope. A structurally invalid query cannot reach a query
pack or an extraction workflow.

Structural validity means only that the query can be executed safely and audited. It is
not evidence that the query is relevant, precise or ready. Generation creates no quality
score and unlocks only the first extraction/import step.

### 2.3 Import first extraction per query pack

The analyst runs each candidate query in the listening provider of choice and imports a
first extraction for every required pack. Import must preserve:

- `query_iteration_id` and exact `query_pack_id`;
- exact query text and pack scope;
- `import_batch_id`, source file and file hash;
- external mention ID when available;
- mention-to-query lineage in `mention_query_sources`.

The UI cannot evaluate an iteration until every required pack has imported evidence. A CSV
without a pack link may enrich the corpus, but it cannot prove the behavior of a query.

### 2.4 Evaluate imported query-pack evidence

For each required pack:

1. Read the included mentions linked to the current `query_pack_id`.
2. Select up to 100 deterministic evidence rows from the imported population.
3. With fewer than 10 rows, return `insufficient_sample` without fabricated scores.
4. With 10-24 rows, classification may produce a preliminary diagnosis, but the pack
   cannot become `ready`.
5. With at least 25 rows, ask Claude to classify every selected mention against the pack
   objective, study and Data OS context. Claude does not calculate scores.
6. Code computes quality, density and noise deterministically from the persisted
   mention-level classifications.
7. Persist the run, exact query, population size, sampled mention IDs, import batches,
   classifications, metrics, model and evaluator pipeline version.

Tables:

- `query_validation_runs`
- `query_validation_attempts`
- `query_validation_mentions`
- `query_packs`
- `query_iterations`
- `import_batches`
- `mention_query_sources`

Gate: every required pack must have a current `imported_evidence` attempt for the exact
query text, at least 25 unique classified mentions and passing deterministic thresholds
before the analyst can keep the iteration.

### 2.5 Adjust without evidence leakage

Applying proposed adjustments never mutates the current query pack. It creates a new query
iteration and new pack IDs. The old extraction remains linked to the old packs for audit,
but the new iteration starts with no evidence and no inherited score.

The new queries must be extracted and imported again before they can be evaluated. This
prevents a changed query from passing with mentions retrieved by an older expression.

### 2.6 Certify the imported corpus

Corpus certification is independent from query-pack evaluation and bound to an immutable
revision number:

- up to 5,000 included mentions: classify the complete population;
- above 5,000: classify a deterministic, platform-stratified sample of up to 2,000;
- Claude assigns mention-level relevance and signal types only;
- code computes coverage, density, noise, confidence and readiness;
- every classified mention and reason is persisted.

Tables:

- `corpus_assessments`
- `corpus_assessment_mentions`
- `study_corpora.corpus_revision`
- `study_corpora.latest_assessed_revision`

An assessment is current only when `latest_assessed_revision = corpus_revision`. CSV
ingestion, bulk inclusion changes, cleanup apply/revert and snapshot restore increment the
revision and make an earlier assessment stale immediately.

### 2.7 Approve, snapshot and analyze

Corpus approval requires:

- a completed assessment for the current revision;
- an explicit Insights Manager decision;
- an approval snapshot for the same operational state.

An override is allowed only as an explicit human exception after a current assessment; it
is not a substitute for evaluation. Analysis and Signal consume the approved revision and
retain lineage back to query packs, imports, source assets and assessment evidence.

## 3. UI contract

The Engine sequence is:

`Resolve RAG -> Generate -> Compile -> Import first extraction -> Evaluate packs -> Keep or adjust -> Certify corpus -> Approve -> Analyze`

Language rules:

- query-pack metrics say **imported evidence**, **population** and **classified sample**;
- structural query status says **valid syntax** or **repaired/fallback**, never **quality**;
- corpus metrics say **corpus**, **population**, **revision** and **certification**;
- no button or status names a listening provider;
- the header never labels query-pack evidence as corpus quality;
- the corpus certification panel never reuses query-pack samples;
- stale corpus assessments show both assessed and current revision;
- the cost cap is visible before classification is queued: at most 100 rows per pack.

## 4. Failure semantics

- A generated query that fails the portable compiler cannot be saved or materialized.
- A failed repair uses the deterministic canonical fallback and records the rejected model
  candidate; it never silently accepts malformed syntax.
- Missing canonical competitors or categories remove that optional scope from the required
  generation contract; Claude cannot manufacture the scope.
- Missing evidence for any required pack blocks query evaluation with `409`.
- A pack with fewer than 25 linked mentions cannot become `ready` automatically.
- A failed Claude classification produces no score and cannot preserve an older status.
- A new or edited query must not reuse classifications from another pack or iteration.
- A corpus-assessment batch failure leaves the assessment `failed`; it cannot update
  `latest_assessed_revision`.
- A new corpus revision blocks corpus approval until it is assessed again.
- Workers are mandatory for both asynchronous evaluation paths.

## 5. Audit verdict

The former contract assumed a provider API could validate arbitrary candidate queries
before extraction. In practice, the available API was project-scoped and could not support
one independent validation cycle per new study without operationally mutating provider
projects. That made the flow misleading and brittle.

The production contract now uses evidence Noisia actually owns: imported mentions with
explicit query-pack lineage. It preserves useful per-pack feedback, makes adjustments
auditable, removes the provider dependency and keeps corpus certification as the only gate
for analysis.

## 6. Dialect references

The portable compiler is intentionally narrower than the complete provider language. Its
syntax rules are derived from the public Listen Query Language documentation while keeping
provider selection and advanced fields outside the persisted expression:

- <https://listen.help.sentione.com/reference/listen-query-language>
- <https://listen.help.sentione.com/docs/making-queries-projects-rules-faq>
- <https://listen.help.sentione.com/docs/operators>
- <https://listen.help.sentione.com/docs/keyword-based-rules>
