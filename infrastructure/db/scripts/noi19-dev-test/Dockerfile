# syntax=docker/dockerfile:1
# Dedicated finite runner. No Python, Worker daemon, Redis or provider credentials.
FROM node:20.20.1-bookworm-slim@sha256:17281e8d1dc4d671976c6b89a12f47a44c2f390b63a989e2e327631041f544fd
WORKDIR /app
RUN corepack enable pnpm && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/workers/package.json services/workers/package.json
COPY infrastructure/db/package.json infrastructure/db/package.json
COPY packages/query-engine/package.json packages/query-engine/package.json
COPY packages/methodologies/package.json packages/methodologies/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @noisia/workers...
COPY infrastructure/db infrastructure/db
COPY services/workers/src services/workers/src
COPY packages/query-engine/src packages/query-engine/src
COPY packages/methodologies/src packages/methodologies/src
COPY packages/types/src packages/types/src
WORKDIR /app/infrastructure/db
CMD ["node", "scripts/noi19-dev-test/bootstrap-readonly.mjs"]
