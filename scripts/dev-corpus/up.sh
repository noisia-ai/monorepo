#!/usr/bin/env bash
set -euo pipefail
# This launches only a remote command. No database URL, provider key or corpus is
# placed in CLI arguments, and no public database proxy is created.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/scripts/dev-corpus/target.json"
RUNNER="$(node -e 'const t=require(process.argv[1]); if(!t.runner_service_id)process.exit(2); process.stdout.write(t.runner_service_id)' "$TARGET")" || {
  echo 'MFP runner is not registered; complete the private dev-test provisioning in README.md.' >&2
  exit 2
}
exec pnpm dlx @railway/cli@5.63.1 ssh --project b7b7b325-f273-4eb6-80e0-d66e266159b2 --environment 5bad359d-cfa4-4e8f-aa41-98e6f075375a --service "$RUNNER" -- node /app/scripts/dev-corpus/up.mjs
