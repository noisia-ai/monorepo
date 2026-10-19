# ADR 013 — Evidence-bound insight research for Topics & Narratives

## Status

Accepted for the Data OS Cut 1 branch.

## Context

Topics & Narratives already has governed profiles, mention-level assignments,
deterministic materializations and evidence drill-down. A second descriptive summary
would add little value, while sending an unconstrained corpus to an LLM would recreate
the static “data blender” that Data OS is meant to prevent.

The product needs a qualitative investigation layer that can read conversational
language, consult approved Brand OS / Study OS context and use bounded external
research without weakening the existing ETL or turning outside pages into social
evidence.

## Decision

`topics_narratives.insights` uses the existing versioned
`metric_interpretation_runs` / `metric_interpretations` stores.

- The analysis window is always the latest rolling thirty days available in the
  operational corpus. The page filter does not silently change it.
- The packet contains no more than two hundred unique conversation roots and no more
  than one hundred twenty thousand mention characters.
- Sampling is deterministic and stratified across governed terms, week, platform,
  sentiment and engagement.
- Claude may read at most twenty approved internal context records and thirty thousand
  context characters.
- Claude may perform at most six web searches. At most eight accepted URL sources are
  persisted, with `evidence_role=external_context` and `causal_authority=false`.
- Every insight cites exact sampled mention IDs. Context references cannot replace
  mention evidence, and the worker persists no causal claims.
- Before a provider call, every sampled mention receives a permanent
  `record_feature_values` analysis-ledger enrichment. The same record is finalized
  as supporting evidence, counterevidence or analyzed-but-not-cited; failed attempts
  remain visible as failed rather than disappearing.
- Accepted web sources are stored as separate feature records owned by the resulting
  metric interpretation.
- Interpretation, finalized mention enrichments, external sources and run completion
  are written in one transaction. The earlier analysis ledger may remain after a
  failed run, but a partial interpretation is never served.
- The client requests a run through an authorized, budget-capped API. Workers write
  the canonical stores directly; there is no second unauthenticated HTTP ingestion
  path.

## Consequences

The carousel can provide interpretive value without recomputing the taxonomy or
turning generated copy into a metric source. A run remains reproducible through its
packet hash, context watermark, prompt/model versions, exact mention IDs and accepted
URLs. No schema migration or parallel insight table is required.

External research remains contextual. A matching news event may make a hypothesis
more plausible, but it cannot establish that the event caused the observed
conversation.
