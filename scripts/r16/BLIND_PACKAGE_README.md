# R16 blind package tooling

This utility packages an already exported **private JSON snapshot** for an auditor. It does not query a database, edit labels, call a provider, or run either study. Use synthetic fixtures in tests; real use stays under the ignored `.data/piloto-masivo/r16/` tree after native exports are available.

## Commands

```sh
pnpm exec tsx --test scripts/r16/blind-package.test.ts
pnpm exec tsx scripts/r16/blind-package.ts build \
  --snapshot .data/piloto-masivo/r16/<native-snapshot>.json \
  --seed .data/piloto-masivo/r16/<custody-seed>.txt \
  --out .data/piloto-masivo/r16/<blind-package> \
  --key .data/piloto-masivo/r16/custody/<answer-key>.json
pnpm exec tsx scripts/r16/blind-package.ts verify --package .data/piloto-masivo/r16/<blind-package>
```

The custody seed must be at least 32 bytes, have no group/other permissions, and be created and retained privately by the custodian. The snapshot must also have no group/other permissions. The packet directory and custody key must be separate, new paths under `.data/piloto-masivo/r16/`; the builder refuses existing output/key paths and symlinked paths. It uses mode `0700` for directories and `0600` for files, builds in a temporary sibling directory, then publishes the packet directory by atomic rename. Back up the custody key separately from the auditor packet. Do not send the manifest or answer key until the auditor has frozen results; do not share the seed.

Packet filenames and row order are deterministic from the custody seed but opaque: they do not encode study, stage, cohort, label, or stratum. Each packet has an opaque `packet_ref`; the manifest maps that ref to a generic filename and aggregate census counts so each shortfall is identifiable to the auditor without exposing the stage or semantic stratum. The manifest also records source snapshot digest, measured receipts, and packet file hashes. `SHA256SUMS` covers every packet and the manifest, excluding the separately held answer key. `verify` checks packet structure, manifest-to-packet digests and ref coverage, and all SHA256 entries. A build with any shortfall still writes the census and artifacts, then exits with status 2; that package must be reported as incomplete and cannot be presented as meeting the target sample.

## Snapshot contract (`r16-blind-snapshot-v1`)

The native exporter writes one JSON object with:

- `exported_at`, and `source.export_contract` plus `source.export_digest` (SHA-256 hex of the immutable export/artifact manifest).
- `study_provenance.listening_before_digest` and `.listening_after_digest` (SHA-256 hex of each immutable configuration/map), `study_contract_version: "signal-study-v1"`, `methodology_template_version: "r16-v1"`, and the exact `methodology_template_digest` (`sha256:` prefix plus hex). These values bind the packet to the native versioned study contracts and keep before/after map provenance separate.
- `receipts.total_cost_usd`, `receipts.total_elapsed_ms`, and a nonempty `receipts.stages[]` with unique actual stage names, cost, and elapsed time. Stage sums must match the totals (cost within USD 0.000001, time within 1 ms). Use zero only when measured as zero. Missing receipt measurements block export; the packager never estimates them.
- `listening[]`: one record per unique mention and stage (`before` or `after`), containing a custody-only `mention_id`, `redacted_text`, and `assignments[]`. Each assignment includes the stable configured topic key, auditor-facing topic name and definition, one of ten volume cohorts `C01`–`C10` derived from the topic's native volume rank, and the final Boolean assignment. The two stages must be separate immutable snapshots/configuration digests even when they reuse a corpus.
- `study[]`: one record per unique cut/corpus mention with `mention_id`, redacted text, final direction / target / use labels, `in_cut`, and `review_flags`. `review_flags` are native-exporter candidates `false_none_candidate` / `false_irony_candidate`, not packager-inferred labels. To build motive strata, include key, display name, definition, layer and volume cohort for the assigned motive. For nearest-four auditing, include `nearest_volume_cohort` and exactly four `nearest_motives` with stable key, name, definition and native volume cohort. The packager preserves the four options in the blind prompt and keeps all answers/keys in custody storage.

The snapshot has no authoritative production-native export yet. The current study source contract (`signal-study-contracts.ts`) establishes study configuration and axes, while the query-engine source/output and listening exports still need to assemble the following together: per-mention redacted source text; immutable before/after assignments joined to the versioned Brand OS listening configuration and topic volume cohort; study cut membership and direction/target/use answers; upstream review-candidate flags for false `none` and false irony; motive IDs, names, definitions, layers and volume ranks; four nearest motive candidates and a per-case volume cohort; separate before/after configuration/map digests; source/artifact digests; and per-stage actual cost/time receipts. Do not query or infer these ad hoc inside this tool. Add/validate a native export first.

## Sampling and audit boundaries

- Listening uses 500 distinct mentions in each stage, 50 per volume cohort. The whole package deduplicates source identities across both stages; when the two stage exports share the same mention IDs, the second stage can therefore report a shortfall. Shortfalls are explicit; records are never duplicated to reach quota.
- T&B direction/target/use has disjoint auditor cases: mixed 50; category, own brand, competitor brand, alternative 40 each; false-irony candidates 30; false `none` candidates inside and outside the cut 30 each. The flags and current answers are private-key material, not visible to auditors.
- Motive purity/layer evidence takes 10 distinct mentions for each of the 20 largest motives. Nearest-four assignment takes 20 distinct mentions per each of the ten motive-volume cohorts. All T&B selected source identities are disjoint from the Listening selections and from other T&B strata.
- Human-study comparison for the 22 causes is deliberately not part of the snapshot schema, selection, manifest, or key generator. It may be prepared only by a separate post-freeze process against the private human study, after the blind results are sealed.

The structure of study axes and methodology templates is based on the versioned query-engine study contract. These sample sizes define an audit census protocol, not classifier accuracy targets or release gates.
