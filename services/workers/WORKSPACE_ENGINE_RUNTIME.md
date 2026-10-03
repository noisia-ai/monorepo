# Workspace topic engine runtime

`services/workers/railway.json` builds `services/workers/Dockerfile` from the repository root. The existing Worker command and BullMQ queues remain the entry point. Railway supports `DOCKERFILE` plus `dockerfilePath` in its [configuration reference](https://docs.railway.com/config-as-code/reference).

The image pins Python3.12.14 and Node20.20.1 to official multi-platform image-index digests, and pnpm10.33.2 to the monorepo version. `requirements-workspace-engine.txt` pins the numerical runtime used by the offline BERTopic/UMAP/HDBSCAN tests. It deliberately installs with `--no-deps`: BERTopic lists encoder/plotting packages in its distribution metadata but supports their absence when supplied precomputed vectors. Its numerical dependency closure is explicit, including scipy, numba, llvmlite, pynndescent, pandas and narwhals. The image does not contain Torch/CUDA, sentence-transformers, transformers, Plotly, notebooks or a downloaded embedding model. This is the fixed workspace BERTopic profile, not the full experimental lab environment or its optional FASTopic/NMF commands.

The numerical subprocess receives:

- `NOISIA_WORKSPACE_ENGINE_PYTHON=/opt/noisia-engine/bin/python`
- `NOISIA_WORKSPACE_ENGINE_MODULE_ROOT=/app/tools/signal-semantic-lab/src`

The Node caller supplies its own sanitized subprocess environment, a server-owned storage directory, complete hash-verified input artifacts and a lease heartbeat. Python does not receive database or provider credentials. HF/transformers offline flags and single-thread numerical settings are also defaults in the image. Neither build nor container startup applies a migration or creates product records. The only file included from the DB seeds directory is the existing `connection.ts` runtime authority helper exported by `@noisia/db`; no seed data or migration runner is copied.

The Dockerfile-specific ignore file is an allowlist. It excludes `.env*`, `.data`, local dependencies, tests and model artifacts even inside allowed directories. Docker BuildKit is required so `Dockerfile.dockerignore` controls the context. The final image contains the Worker, its runtime TypeScript packages, DB source and the four Python modules needed by the engine.

## Local validation

Build the Linux deployment architecture from the repository root:

```sh
docker buildx build --load --platform linux/amd64 --target worker-runtime \
  -f services/workers/Dockerfile -t noisia-workers-engine:local .
```

The build runs the existing Worker TypeScript check. A separate `python-runtime` target permits numerical testing without starting any queue consumer. Do not start the normal Worker entry point with inherited remote environment variables merely to test Python. Offline checks run this target with `docker run --network none`, explicit synthetic input mounts, and `/opt/noisia-engine/bin/python -m signal_semantic_lab.workspace_engine`. The numerical adapter requires `PYTHONPATH=/app/tools/signal-semantic-lab/src` for a direct CLI invocation; the Node caller supplies it automatically.

Private receipts for the 2026-09-08 cut are under `.data/workspace-engine-2026-09-08/`: native Python seven-case algorithm/contract proof; Linux/amd64 two-process fit/predict proof using synthetic vectors and no network; and eight focused routing cases for numerical/platform/context changes. None establish semantic precision, production-scale capacity, or two accepted PostgreSQL imports. The end-to-end import/Worker evidence is a separate integration receipt.

## Recovery and capacity

Models are private joblib artifacts. SHA-verified manifests bind workspace, input/profile/context, exact package versions, operating system and architecture. Matching runtime allows provisional known-cluster prediction before a full current-corpus refit. A different runtime or context automatically selects `full_refit_only`, skips deserialization of the old model and preserves lineage from the verified JSON root memberships. `parent_reuse` records the reason. Model format/runtime upgrades therefore do not require a user to repair an incompatible pickle.

Every eligible chunk participates in the final open fit; guided fit is a separate full-population view when positive guidance exists. Neither prior classification nor known prediction removes chunks from discovery. Final root memberships count each root once per cluster and can include multiple clusters. Models and artifact receipts are persisted by the Node coordinator; local container files are only scratch space.

Memmap is an input transport, not a guarantee that full UMAP/HDBSCAN graphs fit in memory. The fixed4GiB preflight bound is per Python process and does not bound aggregate memory across concurrent jobs. Inadequate capacity must remain an explicit failure, never a sample reported as complete. The current proof is hundreds of roots; two-million-record capacity is not established. A fit below the fixed population minimum returns `insufficient_population`, includes all root/occurrence counts and writes no model.
