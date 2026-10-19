# ADR 008: Analysis Artifact and Evidence Graph

## Status

Accepted for the Data OS Cut 1 work branch. Client-visible activation still requires the
existing staging shadow and release gates.

## Context

Data OS already keeps uploaded Study sources in `data_asset_records` and
`data_observations`, and T&B keeps findings, citations, strategic opportunities and
Action Studio in relational tables. However, several editorial modules still live in
`tb_analyses.meta_json`, while Review and Signal have no common addressable unit that
can connect one analytical claim to its evidence and then freeze that exact revision at
publication.

A single large JSON payload is useful as a compatibility export, but it cannot be the
system of record for evidence coverage, per-artifact review or source-to-output lineage.

## Decision

Add a methodology-neutral analysis artifact layer:

- `analysis_artifacts` registers one independently addressable finding, insight,
  opportunity, action, narrative module or analysis-context receipt;
- `analysis_evidence_groups` states how evidence is grouped and whether it is
  supporting, protagonist, counter, contextual, denominator or limitation evidence;
- `analysis_evidence_links` connects a group to a governed source record such as a
  mention, knowledge source or Data OS asset;
- `analysis_artifact_relations` connects derived artifacts to the findings that support
  or are explained by them;
- `analysis_artifact_review_events` preserves editorial decisions;
- `published_output_artifacts` freezes the exact accepted/corrected/limited artifact
  rows and revisions used by a published output.

The layer is additive. Typed methodology tables remain canonical domain stores. Flexible
`content jsonb` is allowed per typed, versioned artifact; a monolithic report payload is
not the serving contract. `published_outputs.payload` remains a preserved compatibility
snapshot.

T&B Step 6 rebuilds only draft artifacts inside the same transaction as synthesis. It
fails closed if reviewed artifacts exist. Exact finding-to-mention citations become
evidence links and generic `lineage_edges`. Structured Study assets are attached to an
`analysis_context` artifact with `claim_specific=false`; they must not be represented as
support for a particular finding until the pipeline returns an explicit governed row or
observation reference.

Analysis approval accepts the artifact revision as one transaction. Publication links
only accepted, corrected or limited artifacts and records `artifact_revision`.

## Consequences

- Review and Signal can read the same graph without recalculating analysis.
- A published output can be traversed back through artifacts, findings and mentions to
  source evidence.
- Files consumed as general context are visible without overstating claim-level
  provenance.
- The next pipeline contract must return explicit `data_observation` or
  `data_asset_record` references for structured claims; until then those sources remain
  contextual.
- Historical approved outputs require the guarded serving backfill before the new
  readiness gate can pass.
- Approved or otherwise reviewed artifacts cannot be silently overwritten by rerunning
  Step 6; corrections require a new analysis revision.

## Validation

- forward-only migration `0046_analysis_artifact_evidence_graph.sql`;
- DB schema and migration tests;
- worker persistence tests for exact mention links, contextual file boundaries and
  reviewed-artifact immutability;
- Studio readiness blocks missing or incomplete artifact graphs;
- staging backfill and shadow evidence remain mandatory before production review.
