# syntax=docker/dockerfile:1
# Same pinned CPU-only runtime as the product Worker; no encoders or model downloads.
FROM python:3.12.14-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254 AS python-runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    NUMBA_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
    NOISIA_WORKSPACE_ENGINE_PYTHON=/opt/noisia-engine/bin/python \
    NOISIA_WORKSPACE_ENGINE_MODULE_ROOT=/app/tools/signal-semantic-lab/src
RUN python -m venv /opt/noisia-engine
COPY services/workers/requirements-workspace-engine.txt /opt/noisia-engine/requirements.txt
RUN /opt/noisia-engine/bin/pip install --no-cache-dir --no-deps --only-binary=:all: -r /opt/noisia-engine/requirements.txt
RUN /opt/noisia-engine/bin/python -c "from bertopic import BERTopic; from umap import UMAP; from hdbscan import HDBSCAN; import psutil"

FROM node:20.20.1-bookworm-slim@sha256:17281e8d1dc4d671976c6b89a12f47a44c2f390b63a989e2e327631041f544fd AS node-runtime
FROM python-runtime AS mfp-runtime
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/corepack
RUN ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack
WORKDIR /app
ENV TSX_TSCONFIG_PATH=/app/apps/studio/tsconfig.json
RUN corepack enable pnpm && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/studio/package.json apps/studio/package.json
COPY services/workers/package.json services/workers/package.json
COPY infrastructure/db/package.json infrastructure/db/package.json
COPY packages/query-engine/package.json packages/query-engine/package.json
COPY packages/methodologies/package.json packages/methodologies/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/blocks/package.json packages/blocks/package.json
COPY packages/humanizer/package.json packages/humanizer/package.json
COPY packages/kb/package.json packages/kb/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @noisia/studio... --filter @noisia/workers...
COPY infrastructure/db infrastructure/db
COPY services/workers/src services/workers/src
COPY services/workers/tsconfig.json services/workers/tsconfig.json
COPY tools/signal-semantic-lab/src tools/signal-semantic-lab/src
COPY packages packages
COPY apps/studio/src apps/studio/src
COPY apps/studio/tsconfig.json apps/studio/tsconfig.json
COPY scripts/dev-corpus scripts/dev-corpus
COPY scripts/providers scripts/providers
RUN mkdir -p /app/.data/dev-corpus && chmod 700 /app/.data/dev-corpus
# Idle by default. An explicit MFP runtime flag starts the existing product Worker.
CMD ["node", "--import", "tsx", "scripts/dev-corpus/runtime.mjs"]
