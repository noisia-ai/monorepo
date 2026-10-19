# Interest decision quality scorer V1

`score-v1.mjs` scores an independently labeled, frozen platform cohort against
one exact `interest_decision` model/prompt configuration. It is local, read-only,
and accepts only opaque IDs, digests, labels, verdicts, and citation audit flags.
It rejects source text, quotes, URLs, and extra fields. Run:

```bash
node tools/interest-decision-quality/score-v1.mjs /private/path/input.json > /private/path/report.json
node --test tools/interest-decision-quality/score-v1.test.mjs
```

The private input uses `signal-interest-decision-quality-input-v1` with:

- `cohort: {dataset_digest, sample_ids}`. Freeze the sorted ID list and source
  population digest before labeling or model evaluation. Include random and
  challenge strata; the scorer rejects missing and duplicate cases.
- `labels[]: {sample_id, annotator_a, annotator_b, adjudication}`. Each annotation
  has an opaque `actor_id`, binary `membership` (`positive` or `negative`), and
  `mixed` boolean. Two separate reviewers label without seeing model output.
  Their agreement is final; disagreement requires a third, distinct adjudicator.
  `mixed` is a subset of positive/negative, matching SQL0211's arithmetic.
- `predictions[]: {sample_id, verdict, request_digest, output_digest,
  parser_receipt_digest, citations}`. Each citation has an opaque
  `citation_digest`, role, `literal_valid`, `semantic_valid`, and independent
  `auditor_id`. A trusted run of the production parser must supply the literal
  check and receipt; a reviewer checks whether the exact span actually supports
  the verdict. The scorer rejects missing audits and marks any failed check as
  a quality failure. It cannot authenticate an invented parser receipt or prove
  reviewer blinding by itself.
- `thresholds` uses the exact field names and integer basis points required by
  `signal_interest_decision_platform_benchmarks_v1` in SQL0211. Register a row
  only after these thresholds are fixed in advance and an internal reviewer has
  checked the private packet, source rights, parser receipts, labels, and report.

The report returns SQL0211's confusion/abstention counts, exact threshold
comparison, citation error counts, and content-free digests. `quality_pass` is
only a local prerequisite. It does not approve a model, create a PostgreSQL
benchmark row, authorize a provider call, or estimate client-corpus precision.
The existing 160-row private candidate packet is unlabeled; a single GPT review
of selected Alexa+ rows remains exploratory evidence, never independent gold.
