# R13 audit export

`pilot-r13-audit-export.mjs` wires the repeatable private evidence exports for the two R13 audit phases. It reads only mode-restricted files under `.data`, writes private evidence with mode `0600`, and never prints source text, root IDs, the blind key, or per-case decisions. Phase A publishes the corrected public receipt and creates a reproducible 100-case consumer sample. Phase B adds interest coverage, the native paired cost comparison, and language-pair linkage for the historical blind cases. The generated public receipt also links the current R14 seven-question projection and its per-interest increment; `DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_R13_HISTORICO_2026-11-08.md` preserves the prior R13 receipt bytes and SHA-256.

Create the operator JSON config under the R13 `.data` directory with mode `0600`. Paths below are absolute. `repository_root` must be this checkout; `workspace_data_root` and `r13_data_root` must each point to a `.data` directory. A shared `.data` root may be group-readable; every descendant directory containing private material must be mode `0700`, and private files must be mode `0600`. The exporter does not change permissions on the root.

```json
{
  "repository_root": "/absolute/path/to/noisia-website",
  "workspace_data_root": "/absolute/path/to/noisia-website/.data",
  "r13_data_root": "/absolute/path/to/private-data/.data",
  "h4": {
    "snapshot": "/absolute/path/to/noisia-website/.data/pilot-audit-h4/inputs/h2-snapshot.json",
    "snapshot_proof": "/absolute/path/to/noisia-website/.data/pilot-audit-h4/inputs/h2-snapshot-proof.json",
    "operator_receipt": "/absolute/path/to/noisia-website/.data/pilot-audit-h4/output/operator-receipt-<snapshot-sha256>.json",
    "comparison": "/absolute/path/to/noisia-website/.data/pilot-audit-h4/inputs/comparison.json",
    "answer_key": "/absolute/path/to/noisia-website/.data/pilot-audit-h4/custodia/clave-sellada.json",
    "blind_samples": "/absolute/path/to/noisia-website/.data/pilot-audit-h4/auditor/muestras-ciegas.jsonl"
  },
  "root_hashtag_flags": "/absolute/path/to/private-data/.data/piloto-masivo/r13/inputs/root-hashtag-only.json",
  "variant_private_link": "/absolute/path/to/private-data/.data/piloto-masivo/r13/inputs/variant-private-link.json",
  "translation_receipt": "/absolute/path/to/private-data/.data/piloto-masivo/r13/translation-success.json",
  "translation_translations": "/absolute/path/to/private-data/.data/piloto-masivo/r13/translation-translations.json",
  "stages": {
    "repair": "/absolute/path/to/private-data/.data/piloto-masivo/r13/repair/results.jsonl",
    "interests": "/absolute/path/to/private-data/.data/piloto-masivo/r13/interests/results.jsonl",
    "cost13": "/absolute/path/to/private-data/.data/piloto-masivo/r13/cost13/results.jsonl",
    "cost7": "/absolute/path/to/private-data/.data/piloto-masivo/r13/cost7/results.jsonl",
    "cost_comparison": "/absolute/path/to/private-data/.data/piloto-masivo/r13/cost-comparison.json",
    "language_pt": "/absolute/path/to/private-data/.data/piloto-masivo/r13/language-pt/results.jsonl",
    "language_en": "/absolute/path/to/private-data/.data/piloto-masivo/r13/language-en/results.jsonl"
  },
  "outputs": {
    "audit_dir": "/absolute/path/to/private-data/.data/piloto-masivo/auditor",
    "custody_dir": "/absolute/path/to/private-data/.data/piloto-masivo/custodia",
    "new_blind_samples": "/absolute/path/to/private-data/.data/piloto-masivo/auditor/muestras-ciegas-r13.jsonl",
    "new_blind_key": "/absolute/path/to/private-data/.data/piloto-masivo/custodia/clave-sellada-r13.json",
    "comparison_addendum": "/absolute/path/to/private-data/.data/piloto-masivo/auditor/comparacion-r13.json",
    "phase_a_evidence": "/absolute/path/to/private-data/.data/piloto-masivo/auditor/phase-a-evidence.json",
    "phase_a_manifest": "/absolute/path/to/private-data/.data/piloto-masivo/auditor/phase-a-manifest.json",
    "phase_b_evidence": "/absolute/path/to/private-data/.data/piloto-masivo/auditor/phase-b-evidence.json",
    "phase_b_manifest": "/absolute/path/to/private-data/.data/piloto-masivo/auditor/phase-b-manifest.json",
    "language_variants": "/absolute/path/to/private-data/.data/piloto-masivo/auditor/variantes-r13.jsonl"
  },
  "public_receipt_path": "/absolute/path/to/noisia-website/docs/product/PROMPT_LOOPING/DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_2026-11-08.md"
}
```

Run the phases after their inputs are complete:

```bash
node scripts/dev-corpus/pilot-r13-audit-export.mjs --phase phase-a --config /absolute/path/to/private-data/.data/piloto-masivo/r13/audit-config.json
node scripts/dev-corpus/pilot-r13-audit-export.mjs --phase phase-b --config /absolute/path/to/private-data/.data/piloto-masivo/r13/audit-config.json
```

Phase A may be rerun to verify the exact same immutable packet and evidence. Phase A refuses to overwrite a receipt after Phase B has superseded it. Phase B reuses an identical variant export and evidence; changed source bytes fail closed. The public receipt is updated atomically. The new sample key remains in the separate custody directory. The language variant JSONL contains blinded case IDs, language, the full trigger/barrier/none probability distribution, request/input digests and token/hash metadata. Probabilities are checked against each result's raw response and sealed body hash. The export omits root IDs, choices, the blind key and answer-key decisions.

Claude's observed pilot cost is divided by the 144 BERTopic groups in the measured run to estimate cost per editorial group. The public forecast shows 180, 225 and 270 groups, with Voyage and JEV scaled by root count. The central scenario is 225 groups; Claude's call count is not used as a proxy for group count.
