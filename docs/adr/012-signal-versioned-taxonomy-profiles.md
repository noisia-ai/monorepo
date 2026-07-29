# ADR 012: Versioned Signal Taxonomy Profiles

## Status

Accepted for the Signal Topics & Narratives backend work. Client-visible activation
still requires the Data OS staging/preview release gates and human taxonomy approval.

## Context

Data OS already owns reusable taxonomies, terms, rules, model versions, tags, review
events and materializations. Those tables do not identify which topic or narrative
taxonomy version is active for a Signal workspace. Inferring the active vocabulary from
free-form taxonomy keys is ambiguous and cannot preserve historical classification.

Topics and narratives also have different semantics and review lifecycles. They must
not be aliases of Triggers & Barriers codings or of each other.

## Decision

Add `signal_taxonomy_profiles` as the versioned workspace binding:

- one row binds a workspace, kind, taxonomy, ruleset, model version and context hash;
- `kind` is exactly `topic` or `narrative`;
- version is monotonic per workspace and kind;
- a partial unique index allows at most one active profile per workspace and kind;
- activation retires the prior active version atomically and requires a human approver;
- prior profiles, tags and lineage remain immutable historical evidence.

Extend `record_tags` with an optional profile reference. TN assignments require that
reference and a model version, and use the logical identity
`mention + profile + term + model_version`. Existing deterministic and T&B tags remain
compatible and keep their current identity.

Extend `signal_refresh_runs` for TN enrichment usage, heartbeat, profile/model scope,
budget and cost. This preserves the canonical run/outbox instead of creating a parallel
enrichment-run store.

## Consequences

- Metrics and filters resolve exact profile and term IDs instead of taxonomy-name
  patterns.
- Topic and narrative evolution can be backfilled and compared without rewriting
  older evidence.
- Pending/rejected tags remain in the review/audit trail but are excluded from
  client-safe SQL.
- Published strategic releases are unaffected by a later operational profile.
- Discovery and classification can use Claude/Voyage asynchronously, while serving
  remains Postgres-only.

## Rejected alternatives

### Store the active taxonomy in workspace metadata

Rejected because JSON metadata does not enforce a single active version, atomic
promotion or foreign-key lineage.

### Add dedicated topic and narrative tag tables

Rejected because that duplicates `record_tags`, review events and evidence semantics.

### Infer kind from taxonomy key text

Rejected because `LIKE`-based identity is ambiguous, cannot prove workspace ownership
and does not freeze a version.

