# Signal Semantic Lab

Private, local-only harness for Gate 10C. It benchmarks multilingual embeddings and
topic discovery without writing to Signal serving or adopting a production runtime.

The executable path is the CLI, not the notebook. The notebook only reads saved,
sanitized metrics. Raw benchmark text and embeddings must remain under `.data/` or an
explicit private output directory with mode `0600`.

## Reproducibility contract

- Python is pinned to 3.12 and dependencies to `uv.lock`.
- Model repositories, revisions, artifact hashes, seeds and parameters are frozen in a
  sealed plan before result inspection. The corrective 10C.1 plan is
  `config/benchmark-plan-10c1.json`; the original 10C plan remains historical evidence.
- The input must satisfy `signal-semantic-benchmark-export-v1` and reconcile its full
  denominator.
- Holdout membership is stable by canonical family and content hash. Duplicate content
  may not cross splits.
- A candidate never becomes `approved`. The strongest state this harness emits without
  human review is `operator_review_required`.
- No code in this directory writes classification authority, `record_tags`, governed
  populations, bindings, pointers or jobs.

## Commands

```bash
uv sync --frozen --extra dev
uv run signal-semantic-lab validate --input /private/export.jsonl --manifest /private/export.manifest.json
uv run signal-semantic-lab fixture --output /private/fixture --records 1500
uv run signal-semantic-lab prepare --input /private/export.jsonl --manifest /private/export.manifest.json --output /private/run --plan config/benchmark-plan-10c1.json --embedding-cache /private/embedding-cache
uv run signal-semantic-lab cache-import --manifest /private/sealed-embedding.json --embedding-cache /private/embedding-cache
uv run signal-semantic-lab run --stage smoke --run-dir /private/run
uv run signal-semantic-lab run --stage calibration --run-dir /private/run
uv run signal-semantic-lab run --stage full --run-dir /private/run
uv run signal-semantic-lab packet --run-dir /private/run
uv run signal-semantic-lab report --run-dir /private/run
uv run signal-semantic-lab notebook --run-dir /private/run --output /private/run/10c-report.executed.private.ipynb
uv run signal-semantic-lab contracts --output /private/run/10c1-offline-contract-fixtures.private.json
uv run pytest
./scripts/run-clean.sh validate --input /private/export.jsonl --manifest /private/export.manifest.json
```

`full` runs only the finalists selected by the preregistered technical hard gates. It
does not select a modeling winner. The operator completes the blinded packet before an
adoption decision can be recorded in a later gate.

10C.1 never calls a provider. The offline contracts describe the future 10E boundary:
a governed context snapshot, an adaptive sealed representative packet, a rights-aware
context envelope, a closed proposal schema and an O(clusters) integer cost simulation.
