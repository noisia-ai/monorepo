#!/bin/sh
set -eu
if [ "${RAILWAY_ENVIRONMENT_NAME:-}" != "dev-test" ] || [ "${RAILWAY_SERVICE_NAME:-}" != "mfp-studio" ]; then
  echo "This image requires the mfp-studio service in dev-test." >&2
  exit 1
fi
exec pnpm --filter @noisia/studio start
