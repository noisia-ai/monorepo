# syntax=docker/dockerfile:1
FROM node:20.20.1-bookworm-slim@sha256:17281e8d1dc4d671976c6b89a12f47a44c2f390b63a989e2e327631041f544fd
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
COPY packages packages
COPY apps/studio/src apps/studio/src
COPY apps/studio/tsconfig.json apps/studio/tsconfig.json
COPY scripts/dev-corpus scripts/dev-corpus
RUN mkdir -p /app/.data/dev-corpus && chmod 700 /app/.data/dev-corpus
# No ports, automatic jobs or provider calls. Execute explicit commands over Railway SSH.
CMD ["node", "-e", "console.log(JSON.stringify({status:'ready',execution:'remote_private',automatic_work:false}));setInterval(()=>{},60000)"]
