# syntax=docker/dockerfile:1
# Both multi-platform image indexes are pinned; use linux/amd64 for Railway.
FROM python:3.12.14-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254 AS python-runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    NUMBA_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
    NOISIA_WORKSPACE_ENGINE_PYTHON=/opt/noisia-engine/bin/python \
    NOISIA_WORKSPACE_ENGINE_MODULE_ROOT=/app/tools/signal-semantic-lab/src
RUN python -m venv /opt/noisia-engine
COPY services/workers/requirements-workspace-engine.txt /opt/noisia-engine/requirements.txt
RUN /opt/noisia-engine/bin/pip install --no-cache-dir --no-deps --only-binary=:all: \
    -r /opt/noisia-engine/requirements.txt
WORKDIR /app
COPY tools/signal-semantic-lab/src/signal_semantic_lab/__init__.py \
     tools/signal-semantic-lab/src/signal_semantic_lab/workspace_engine.py \
     tools/signal-semantic-lab/src/signal_semantic_lab/discovery.py \
     tools/signal-semantic-lab/src/signal_semantic_lab/preprocess.py \
     /app/tools/signal-semantic-lab/src/signal_semantic_lab/
RUN /opt/noisia-engine/bin/python -c "from bertopic import BERTopic; from umap import UMAP; from hdbscan import HDBSCAN; import psutil"

FROM node:20.20.1-bookworm-slim@sha256:17281e8d1dc4d671976c6b89a12f47a44c2f390b63a989e2e327631041f544fd AS node-runtime

FROM python-runtime AS worker-runtime
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/corepack
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && corepack enable pnpm && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json /app/
COPY services/workers/package.json /app/services/workers/package.json
COPY infrastructure/db/package.json /app/infrastructure/db/package.json
COPY packages/query-engine/package.json /app/packages/query-engine/package.json
COPY packages/methodologies/package.json /app/packages/methodologies/package.json
COPY packages/types/package.json /app/packages/types/package.json
RUN pnpm install --frozen-lockfile --filter @noisia/workers...
# Dockerfile.dockerignore is an allowlist. No .env, private artifacts or local
# modules can enter either the build context or final image.
COPY services/workers/src /app/services/workers/src
COPY services/workers/scripts /app/services/workers/scripts
COPY services/workers/tsconfig.json /app/services/workers/tsconfig.json
COPY infrastructure/db/*.ts /app/infrastructure/db/
COPY infrastructure/db/schema /app/infrastructure/db/schema
COPY infrastructure/db/seeds/connection.ts /app/infrastructure/db/seeds/connection.ts
COPY packages/query-engine/src /app/packages/query-engine/src
COPY packages/query-engine/tsconfig.json /app/packages/query-engine/tsconfig.json
COPY packages/methodologies/src /app/packages/methodologies/src
COPY packages/methodologies/tsconfig.json /app/packages/methodologies/tsconfig.json
COPY packages/types/src /app/packages/types/src
COPY packages/types/tsconfig.json /app/packages/types/tsconfig.json
RUN pnpm --filter @noisia/workers build
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@noisia/workers", "start"]
