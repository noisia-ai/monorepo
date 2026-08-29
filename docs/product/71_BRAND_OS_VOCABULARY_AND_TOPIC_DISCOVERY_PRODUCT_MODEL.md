# Brand OS Vocabulary and Topic Discovery Product Model

Status: operator-approved product direction; local implementation began in gate
69B.5I-E-A on 2026-08-27. This document describes the current shipped behavior first,
then the target operator experience. Remote deployment, provider execution, publication
and Signal serving still require their own gated evidence.

## 1. Plain-language model

### “Vocabulario y límites de marca”

This feature builds a structured description of what belongs to the brand and what does
not. It turns Brand OS, Knowledge and the Acquisition Plan into reusable elements such
as aliases, products, competitors, categories, benefits, boundaries and typed
relationships.

It is a hybrid pipeline, not a single ETL and not an unconstrained AI chat:

1. Deterministic backend code resolves the active Brand OS, products, competitors,
   Knowledge assertions and the Acquisition Plan's countries, languages and timezone.
2. The backend creates a compact, versioned context with evidence aliases and a closed
   output schema.
3. A separately bounded AI proposal step generates structured candidate elements. It
   has its own preflight, one-call limit, cost cap and operator confirmation. Its prose
   is never evidence and its candidates are never authority by themselves.
4. Runtime validators enforce the schema and verify that every evidence reference
   points to a governed source.
5. A deterministic, versioned server policy makes ordinary valid results ready and
   sends only closed exceptions to focused human review.
6. Ready results remain editable through the reversible ordinary commands described
   below; exception decisions use the deliberate review contract.
7. Publication freezes the approved snapshot for downstream experiments and consumers.

The AI does not train BERTopic here. It proposes a semantic contract from governed
business context. The backend owns evidence, validation, lineage and publication.

### What a “leaf” means

A leaf is one current semantic element, not a screen, document or task. Examples are a
single alias, benefit, boundary, category or typed relation. The current reviewed
generation contains 80 leaves: 69 approved and 11 rejected.

The formerly reported 67, then 52, “unresolved leaves” are not unreviewed semantic
ideas. They are approved elements whose applicability was represented as `locale=null`
and therefore lacked an additional explicit global-versus-locale resolution record.
Treating each of those records as a separate human decision produced unnecessary
operator work.

## 2. Current Brand OS behavior

The backend uses an append-only review ledger. Provider exceptions, deliberate review,
publication and serving boundaries retain their explicit authority contracts. The
ordinary Brand OS vocabulary path is intentionally shorter: Add, Edit and Save,
version-aware Undo, reversible Archive and Restore. These single-element commands do not
ask the operator for a closed reason, prose rationale or duplicate confirmation. The
server derives the ordinary action class and records authenticated actor, time,
idempotency input, before/after diff and successor lineage.

Ordinary elements inherit markets and languages from the sealed parent Brand OS and
Acquisition Plan. Their raw locale remains null. A supported locale can be selected as a
simple per-element exception; existing explicit locale variants and existing explicit
Global authority remain preserved. Generic editing never invents or silently changes
that authority. Evidence links remain immutable across ordinary successors, and Archive
never deletes history.

This is also a direct-API boundary, not a UI convention. Ordinary create accepts only
parent inheritance or a locale contained in the sealed parent envelope; ordinary save
adds only `preserve`. Both reject `explicit_global` before any database write. Existing
valid Global lineage can still be copied byte-for-byte by preserve, Undo, Archive and
Restore. Minting a new Global decision remains exclusive to the deliberate locale-
authority command with its explicit decision basis and confirmation.

## 3. Target Brand OS experience

### Automatic first result

Running “Vocabulario y límites de marca” should return a usable, fully populated draft.
The system should automatically:

- inherit the Acquisition Plan's market and language envelope;
- classify elements that are workspace-wide versus genuinely locale-specific;
- validate evidence and relationships;
- remove exact duplicates and surface only uncertain exceptions;
- approve high-confidence, evidence-backed proposals into an editable draft; and
- present a short exception queue instead of a form for every element.

The default applicability rule should not copy the primary UI locale onto every
semantic element. A concept such as `smart-home integration` can apply across the
workspace's declared markets even when the primary language is `en-US`. The inherited
state should therefore be a workspace-wide applicability envelope derived from the
parent Acquisition Plan. Explicit `en-US` or `es-MX` values are reserved for real
locale variants or exceptions.

### Simple editing with internal safety

The operator-facing actions should be:

- Edit and Save;
- Undo or restore a prior version;
- Archive or remove from the active pack;
- Add a new element; and
- Merge duplicates only when the UI can explain the result in plain language.

For ordinary single-element edits, `reason_code`, rationale and confirmation are not
operator inputs. The backend records the fixed ordinary command contract, actor,
timestamp, before/after diff and inherited or explicitly selected applicability.
Append-only history remains internal and reversible.

Explicit confirmation and a written basis remain appropriate for:

- publishing a pack;
- large bulk changes;
- destructive or irreversible actions;
- changes that affect serving or client-visible outputs; and
- resolving an ambiguity the evidence cannot support automatically.

## 4. Discovery Review: what exists today

The current Discovery Review is an operator rubric over diagnostic topic proposals.
It stores four 1–5 scores:

- internal coherence: whether the documents inside the cluster belong together;
- neighbor distinction: whether it is meaningfully different from nearby clusters;
- human nameability: whether a person can give it a clear useful name; and
- strategic utility: whether it is useful for the business question.

These scores do not train BERTopic, update embeddings, tune a tensor or alter a model.
Today they are used for review completeness, filtering and CSV/evidence exports.

The `merge needed`, `split needed` and `Topic Contract candidate` controls also record
review intent only. They do not currently:

- merge or split a cluster;
- rerun BERTopic;
- move mentions between topics;
- create a Topic Contract; or
- publish anything into Signal.

That gap is the main reason the screen feels ethereal: it collects expert judgment but
does not yet provide a real Topic workspace.

## 5. Target Topic workflow

The internal system should perform the exhaustive rubric and comparison loop. It may
use modeling metrics plus an AI reviewer grounded in the published Semantic Context
Pack. The Insights Manager should receive:

- proposed topics already named and summarized;
- a small exception list for ambiguous, duplicate or low-quality topics;
- plain-language evidence and representative mentions; and
- direct Edit, Archive and Add Topic actions.

The future Topic workspace, rather than the diagnostic Discovery Review page, should
own durable topic management:

1. Create or edit a Topic Contract.
2. Define examples, exclusions and applicable markets in plain language.
3. Run a shadow search/backfill against the frozen corpus.
4. Inspect matching and non-matching mentions.
5. Accept, refine or archive the topic.
6. Only later opt the topic into Signal serving.

An approved diagnostic proposal may become a Topic Contract candidate, but it must not
silently become a serving topic. The user can always return to the Topic workspace,
edit it, rerun shadow matching, or archive it.

## 6. Immediate low-risk experiment

Before redesigning the UI or publishing to Signal:

1. Freeze the currently reviewed Brand OS generation: 69 approved, 11 rejected.
2. Derive workspace-wide applicability from the parent Acquisition Plan for approved
   `locale=null` elements, while preserving the two existing explicit locale variants.
3. Produce a local-only Semantic Context Pack candidate and document its exact digest.
4. Run the contextual 10C.3B smoke/calibration against the frozen corpus.
5. Compare the resulting topic diagnostics with the earlier 115 BERTopic proposals.
6. Measure whether context improves naming, duplicate detection, boundary adherence,
   topic coverage and outlier handling.
7. Do not publish or activate Signal serving during this experiment.

This experiment answers the immediate product question: whether the structured Brand OS
actually improves topic modeling enough to justify the Topic Contract control plane.

## 7. Product boundary

- Brand OS defines reusable brand meaning and applicability.
- Semantic Context Pack is the frozen machine-readable artifact derived from Brand OS.
- Discovery Review evaluates modeling output; it is not the durable topic manager.
- Topic Contracts are the durable, editable definitions of what Signal should track.
- Reports use the governed corpus and topics later; they are not part of this cut.

This Brand OS simplification does not redesign **Discovery Review**. That diagnostic
surface remains unchanged until a separately bounded real-generation evaluation compares
the consolidated vocabulary against the historical 115 BERTopic proposals. Topic
discovery receives a later frozen Semantic Context Pack; it does not inherit mutation
authority from this editor.

The next product milestone is a contextual shadow experiment, followed by a simple Topic
workspace. It is not another round of per-leaf locale forms.
