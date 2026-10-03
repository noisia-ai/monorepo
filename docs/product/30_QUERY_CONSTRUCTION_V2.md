# Query Construction v2

**Status:** Canon for the production-bound Data OS branch
**Date:** 16 July 2026
**Implementation:** `packages/query-engine/src/query-construction.ts`

## 1. Decision

Listening queries are governed, versioned retrieval artifacts. Claude may propose a
candidate, but it is not the authority that decides query scope, entity identity,
aliases, competitors, exclusions, execution settings or readiness.

Every generated query goes through a deterministic construction plan and two compilers:

1. a structural compiler for the portable listening dialect;
2. a semantic compiler for retrieval mode, entity ambiguity, term quality and scope.

If a model candidate fails either compiler, the worker performs one bounded repair. A
candidate that still fails is replaced by the deterministic plan for that exact scope.
The rejected candidate, reports and fallback decision remain in lineage.

## 2. Retrieval modes

| Mode | Used for | Canonical shape | Where themes live |
|---|---|---|---|
| `exploratory` | T&B, VPM, Cultural Codes, Journey Friction and open discovery | `ANCHOR AND NOT NOISE` | Post-ingest tag plan |
| `detection` | Known incidents, campaigns, products or explicitly bounded phenomena | `ANCHOR AND BALANCED_THEME AND NOT NOISE` | Query gate and post-ingest tags |

An exploratory query must not require a theme phrase such as `"me convencio"` or
`"me frena"`. Doing so removes unanticipated language before Noisia can observe and
classify it. Retrieval defines the universe; tagging explains the universe.

A detection query may use a thematic gate, but positive and negative evidence must both
be represented. The semantic compiler rejects one-sided detection plans.

## 3. Versioned construction artifact

The `query-construction-v2` plan persists:

- canonical subject and scope;
- `ANCHOR`, optional `THEME` and `NOISE` components;
- permissive and themed variants when the mode supports both;
- one independent query and `entity_key` per competitor;
- ambiguity warnings and unsafe standalone terms;
- market languages, source recommendations, time window and country policy;
- handle verification state;
- post-ingest tag expressions for triggers, barriers, experiences and comparisons;
- structural and semantic compiler reports.

The portable expression contains only retrieval logic. Language, country, source and
time-window settings are execution metadata, not hidden boolean clauses.

## 4. Entity and competitor identity

Canonical identities are:

- `brand` or `theme` for the study subject;
- `category` for category retrieval;
- `competitor:<normalized-entity>` for each competitor.

Competitors are never merged into one anonymous query. Every competitor receives its own
anchors, ambiguity profile, query text, query pack and evidence lineage. A payment study
with Visa and Mastercard, for example, cannot use bare `Visa` or bare `Mastercard`; it
must contextualize each entity with product language such as `tarjeta Visa`,
`cartao Visa`, `pago con Visa` or an equivalent natural construction.

Imported mentions preserve the exact relationship through `query_pack_id`,
`import_batch_id` and `mention_query_sources`. A later iteration creates new pack IDs and
cannot inherit the old pack's evidence score.

## 5. Language quality and ambiguity

The compiler favors natural consumer language:

- exact short phrases for stable expressions;
- terminal wildcards for productive morphology;
- portable phrase proximity (`"phrase"~n`) for flexible multiword concepts;
- preemptive exclusions for known homonyms and lexical collisions;
- market-native languages plus English as execution metadata.

It rejects:

- ambiguous standalone terms such as bare `Laika`, `Visa`, `Nu`, `Elo`, `PIX` or
  equivalent domain collisions;
- long literal social-language sentences that should use shorter phrases or proximity;
- broad thematic `AND` gates in exploratory mode;
- invented handles or aliases;
- more than one competitor identity inside the same competitor pack;
- provider-specific fields embedded in the canonical expression.

Domain profiles currently add governed ambiguity and noise rules for pet care and
payments. Unknown domains still receive the generic compiler and an explicit warning;
passing syntax is never presented as proof of recall or precision.

Handles from Brand OS remain `verification_required` until an operator or imported
evidence confirms them. Claude cannot promote a guessed handle into the canonical query.

## 6. Provider-neutral execution

The persisted dialect is `portable-listen-v2`. It supports explicit boolean operators,
quoted phrases, terminal wildcards, `?`, balanced parentheses and portable phrase
proximity. Provider fields and project-specific syntax are outside the canonical query.

The current execution mode is `manual_export_import`; production does not call the
SentiOne API or depend on a SentiOne project. A future provider adapter may translate the
portable artifact into `_all:`, `NEAR/n` or another provider's fields, but that translation
must be versioned separately and cannot mutate the canonical query.

Country is open by default because social geolocation is incomplete. Market relevance is
measured after import. Recommended sources, language set, special-character strategy and
window are persisted so an operator can reproduce the extraction.

## 7. Lifecycle and validation boundaries

1. Resolve Brand OS or Theme OS plus Study OS and accepted Knowledge Sources.
2. Build the deterministic construction plan.
3. Ask Claude for candidate expressions constrained by that plan.
4. Compile structure and semantics.
5. Repair once or use the deterministic fallback per failed scope.
6. Materialize exact entity query packs and persist the generation contract.
7. Export from the listening provider and import evidence against each exact pack.
8. Classify imported evidence and calculate deterministic pack metrics.
9. Create a new iteration for refinements; never mutate evidence lineage in place.
10. Certify the corpus independently before approval and analysis.

Pre-import validation proves only that a query is governed and executable. It cannot
prove quality. Query-pack evidence evaluation measures retrieval behavior after import.
Corpus certification measures the complete versioned corpus and is the only analysis
readiness gate. See `28_CORPUS_ENGINE_VALIDATION_CONTRACT.md`.

## 8. Required production regressions

The automated suite must continue to reject:

```text
("Laika Mascotas" OR "Laika MX" OR "Laika Mexico")
AND ("lo compre porque" OR "me convencio" OR "no me conviene" OR "me frena")
```

for an exploratory T&B study, because it makes discovery conditional on four phrases.

For ambiguous payment entities, tests must prove that:

- bare network or issuer names do not survive compilation;
- ES/PT market language can coexist without merging competitors;
- positive and negative detection phrases are balanced;
- migration, SIM, gift-card, identity-card, investment and other known noise is excluded;
- every materialized pack retains its `entity_key`, construction plan and tag plan.

## 9. Non-claims

Query Construction v2 does not claim perfect precision or recall before evidence exists.
It does not verify provider coverage, invent unavailable handles or certify a corpus. It
raises the quality floor, prevents known destructive patterns and makes every decision
auditable through Data OS.
