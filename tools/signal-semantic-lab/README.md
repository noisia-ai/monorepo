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
  `config/benchmark-plan-10c1.json`. The signed conceptual 10C.2 preregistration remains
  byte-for-byte at `config/benchmark-plan-10c2.json`; its executable schema-only
  normalization is `config/benchmark-plan-10c2-v3.json`.
- 10C.1 accepts `signal-semantic-benchmark-export-v1`. The multi-scope 10C.2 harness
  requires `signal-semantic-benchmark-export-v2`, Acquisition-owned authority and exact
  reconciliation of both the global denominator and every required partition.
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
uv run signal-semantic-lab validate-plan --plan config/benchmark-plan-10c2-v3.json --output /private/plan-validation.json
uv run signal-semantic-lab export-v2 --input /private/export-v2.jsonl --manifest /private/export-v2.manifest.json
uv run signal-semantic-lab fixture --output /private/fixture --records 1500
uv run signal-semantic-lab fixture-v2 --output /private/multiscope-fixture
uv run signal-semantic-lab fixture-smoke --input /private/multiscope-fixture/source-export-v2.private.jsonl --manifest /private/multiscope-fixture/source-export-v2.manifest.private.json --plan config/benchmark-plan-10c2-v3.json --output /private/fixture-smoke.json
uv run signal-semantic-lab prepare --input /private/export.jsonl --manifest /private/export.manifest.json --output /private/run --plan config/benchmark-plan-10c1.json --embedding-cache /private/embedding-cache
uv run signal-semantic-lab cache-import --manifest /private/sealed-embedding.json --embedding-cache /private/embedding-cache
uv run signal-semantic-lab authorize-execution --run-dir /private/run --authorization /private/operator-execution-authorization.json
uv run signal-semantic-lab run --stage smoke --run-dir /private/run
uv run signal-semantic-lab run --stage calibration --run-dir /private/run
uv run signal-semantic-lab run --stage full --run-dir /private/run
uv run signal-semantic-lab freeze-finalists --run-dir /private/run
uv run signal-semantic-lab open-holdout --run-dir /private/run --authorization /private/operator-holdout-authorization.json
uv run signal-semantic-lab packet --run-dir /private/run
uv run signal-semantic-lab report --run-dir /private/run
uv run signal-semantic-lab notebook --run-dir /private/run --output /private/run/10c-report.executed.private.ipynb
uv run signal-semantic-lab contracts --output /private/run/10c1-offline-contract-fixtures.private.json
uv run signal-semantic-lab diagnose-role-separation --run-dir /private/10c2c-evidence --output /private/10c3a-diagnostic --source-manifest-sha256 sha256:<sealed-manifest>
uv run pytest
./scripts/run-clean.sh validate --input /private/export.jsonl --manifest /private/export.manifest.json
```

The server-owned staging boundary lives in Studio. Run its read-only preflight first:

```bash
pnpm --filter @noisia/studio signal:semantic-benchmark:preflight-v2
```

`signal:semantic-benchmark:export-v2` writes the private JSONL/manifest only after the
separate export approval flag is present and every Acquisition/right invariant passes.
The lab's `export-v2` command then validates those artifacts; it never opens a database.

`full` runs only the finalists selected by the preregistered technical hard gates. It
does not select a modeling winner. The operator completes the blinded packet before an
adoption decision can be recorded in a later gate.

10C.1 never calls a provider. The offline contracts describe the future 10E boundary:
a governed context snapshot, an adaptive sealed representative packet, a rights-aware
context envelope, a closed proposal schema and an O(clusters) integer cost simulation.

## 10C.2 execution boundary

The V3 loader validates the frozen corpus digests, four required partitions, equal
partition weights, immutable model revisions and artifacts, budgets, stages, hard gates
and stop conditions. `prepare` seals plan/corpus/exporter/harness/lock/hardware lineage;
`smoke`, `calibration` and `full` enforce stage order and reject partial artifacts from a
different plan or corpus. The V3 plan intentionally contains
`execution_authorized=false` and keeps the holdout sealed, so this repository state
cannot run real 10C.2 candidates.

Execution authorization is a separate, externally supplied, digest-sealed artifact; the
harness cannot manufacture it and never edits the preregistration to make a run pass.
It binds the exact plan and export manifest and still forbids providers, remote writes,
serving writes and 10D. After all full-population seeds complete, `freeze-finalists`
seals the finalist, summary and stability digests. A second explicit authorization may
then run the one-way `open-holdout` transition. A finalist packet fails closed until
that transition is recorded; replay is idempotent and incompatible replay is rejected.
Private JSON state is replaced atomically; a crash after sealing an authorization but
before updating run state resumes from the exact same authorization instead of widening it.
No such authorization or holdout transition was applied during 10C.2A.

The V2 manifest separately seals the exporter source digest and the rights authority
digest. Candidate ranking uses equal-partition macro coverage as its primary coverage
term; global micro coverage remains supplementary. The blind decision sheet supports
`candidate_preferred`, `none_acceptable` and `rerun_requested`; none authorizes adoption
or opens 10D.

The V2 exporter is read-only and requires `strategic-analysis`; it does not use
Semantic Review or `llm-processing` as population authority. A root is serialized once
while retaining all of its partition memberships. No local benchmark or fixture command
can emit `adopted` or open 10D.

## 10C.3A role-separated diagnostics

`diagnose-role-separation` consumes only a frozen 10C.2C run, its existing full-seed
assignments and its memory-mapped embedding artifact. It verifies the source evidence
manifest, sealed plan, freeze, result, assignment and embedding digests; rejects any
holdout/split artifact; and never exports, embeds, clusters or writes remotely.

The diagnostic makes four roles explicit: `discovery_proposal`,
`topic_contract_candidate`, `approved_topic_contract` and `propagation_assignment`.
A discovery cluster is always a pending proposal. Human review or a separately approved,
versioned policy is required at the authority boundary, and propagation belongs to a
different generation. Scores and confidence never grant approval.

The command creates a private deterministic cluster/outlier diagnostic and reuses the
bounded representative selector in `review_packet.py` for an operator packet. Its
sanitized manifest contains only hashes, counts, resource telemetry and safety state.
The proposed follow-on plan is `config/benchmark-plan-10c3b-proposed.json`; it is not an
execution authorization, keeps holdout sealed and leaves 10D blocked.
