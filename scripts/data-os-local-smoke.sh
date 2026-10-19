#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SMOKE_DATABASE_URL="${NOISIA_DB_SMOKE_LOCAL_DATABASE_URL:-postgres://postgres:postgres@localhost:55432/noisia_migration_smoke}"
EVIDENCE_DIR="${NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR:-.data/data-os-local-smoke/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_DIR="$(cd "$EVIDENCE_DIR" && pwd)"
SUMMARY_FILE="$EVIDENCE_DIR/README.md"

export NOISIA_DB_SMOKE_LOCAL_DATABASE_URL="$SMOKE_DATABASE_URL"
export DATABASE_URL="$SMOKE_DATABASE_URL"
export DATABASE_SSL=false
export NOISIA_DATA_OS_BACKFILL_CORPUS_ID="${NOISIA_DATA_OS_BACKFILL_CORPUS_ID:-10000000-0000-4000-8000-000000000004}"
export NOISIA_DATA_OS_SHADOW_OUTPUT_ID="${NOISIA_DATA_OS_SHADOW_OUTPUT_ID:-10000000-0000-4000-8000-000000000017}"
export NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID="${NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID:-$NOISIA_DATA_OS_BACKFILL_CORPUS_ID}"
export NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID="${NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID:-$NOISIA_DATA_OS_SHADOW_OUTPUT_ID}"

run_pnpm() {
  corepack pnpm "$@"
}

run_capture() {
  local file_name="$1"
  shift

  {
    echo ""
    echo "## ${file_name}"
    echo ""
    echo '```bash'
    redacted_command_summary "$@"
    echo
    echo '```'
  } >>"$SUMMARY_FILE"

  "$@" 2>&1 | tee "$EVIDENCE_DIR/$file_name"
  local status="${PIPESTATUS[0]}"
  if [[ "$status" -ne 0 ]]; then
    echo "Command failed with exit code $status. See $EVIDENCE_DIR/$file_name" >&2
    exit "$status"
  fi
}

redacted_command_summary() {
  printf '%q ' "$@" \
    | sed -E \
      -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/<uuid_redacted>/g' \
      -e 's#postgres(ql)?://[^[:space:]]+#<database_url_redacted>#g'
}

cleanup() {
  run_pnpm db:smoke:local:down || true
}

if [[ "${NOISIA_DATA_OS_LOCAL_SMOKE_KEEP_DB:-false}" != "true" ]]; then
  trap cleanup EXIT
fi

cat >"$SUMMARY_FILE" <<EOF
# Noisia Data OS Local Smoke Evidence

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Target: local disposable Postgres
Corpus: set (redacted)
Output: set (redacted)

This is synthetic local preflight evidence. It is useful for technical review, but it
does not replace the staging/preview evidence pack required by data-os:release-gate.
This directory lives under .data by default and must not be committed.
EOF

echo "Data OS local smoke evidence dir: ${EVIDENCE_DIR}"

run_capture migrations.log \
  corepack pnpm --filter @noisia/db db:smoke:local
run_capture smoke.log \
  corepack pnpm --filter @noisia/db data-os:smoke
run_capture shadow-run.log \
  env NOISIA_DATA_OS_SHADOW_RUN_ENABLED=true \
  corepack pnpm --filter @noisia/db data-os:shadow-run
run_capture analyze.json \
  corepack pnpm --filter @noisia/db data-os:analyze
run_capture review-queue.json \
  corepack pnpm --filter @noisia/db data-os:review-queue
run_capture review-sample.json \
  env NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true \
  NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL=true \
  corepack pnpm --filter @noisia/db data-os:review-sample
run_capture evidence.json \
  corepack pnpm --filter @noisia/db data-os:evidence
run_capture serving-smoke.json \
  env NOISIA_DATA_OS_ENABLED=true \
  NOISIA_DATA_OS_SERVING_ENABLED=true \
  NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=true \
  NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false \
  corepack pnpm --filter @noisia/studio data-os:serving-smoke
run_capture local-smoke-validation.json \
  env NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR="$EVIDENCE_DIR" \
  corepack pnpm --filter @noisia/db data-os:validate-local-smoke

echo "Data OS local smoke completed."
echo "Local smoke evidence package: ${EVIDENCE_DIR}"
