#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: $name" >&2
    exit 1
  fi
}

require_env DATABASE_URL
require_env NOISIA_REMOTE_DATABASE_TARGET
require_env NOISIA_DATA_OS_BACKFILL_CORPUS_ID
require_env NOISIA_DATA_OS_SHADOW_OUTPUT_ID
require_env NOISIA_SIGNAL_WORKSPACE_ID
require_env NOISIA_DATA_OS_STAGING_EVIDENCE_DIR

case "${NOISIA_REMOTE_DATABASE_TARGET}" in
  staging|throwaway|preview)
    ;;
  *)
    echo "Refusing to finalize Data OS evidence without NOISIA_REMOTE_DATABASE_TARGET=staging|throwaway|preview." >&2
    exit 1
    ;;
esac

if [[ "${NOISIA_DATA_OS_STAGING_SHADOW_APPROVED:-false}" != "true" ]]; then
  echo "Refusing to finalize until NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true." >&2
  exit 1
fi

if [[ "${NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED:-false}" != "true" ]]; then
  echo "Refusing to finalize until NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true." >&2
  echo "Inspect the review queue first, then export NOISIA_DATA_OS_REVIEW_TAG_ID and NOISIA_DATA_OS_REVIEW_ASSERTION_ID." >&2
  exit 1
fi

require_env NOISIA_DATA_OS_REVIEW_TAG_ID
require_env NOISIA_DATA_OS_REVIEW_ASSERTION_ID

if [[ ! -d "$NOISIA_DATA_OS_STAGING_EVIDENCE_DIR" ]]; then
  echo "Evidence directory does not exist: $NOISIA_DATA_OS_STAGING_EVIDENCE_DIR" >&2
  exit 1
fi

EVIDENCE_DIR="$(cd "$NOISIA_DATA_OS_STAGING_EVIDENCE_DIR" && pwd)"
SUMMARY_FILE="$EVIDENCE_DIR/README.md"

for file_name in README.md shadow-run.log analyze.json serving-smoke.json; do
  if [[ ! -f "$EVIDENCE_DIR/$file_name" ]]; then
    echo "Missing partial staging evidence artifact: $file_name" >&2
    echo "Run corepack pnpm data-os:staging-shadow first, then finalize after human review." >&2
    exit 1
  fi
done

for file_name in signal-v2-backfill.json signal-v2-reconcile.json signal-v2-explain.json signal-v2-shadow.json; do
  if [[ ! -f "$EVIDENCE_DIR/$file_name" ]]; then
    echo "Missing Signal V2 staging artifact: $file_name" >&2
    echo "Run corepack pnpm data-os:staging-shadow before finalizing." >&2
    exit 1
  fi
done

if [[ "${NOISIA_REMOTE_DATABASE_TARGET}" =~ ^(staging|preview)$ && ! -f "$EVIDENCE_DIR/candidates.json" ]]; then
  echo "Missing candidates.json; release-gate evidence requires candidate selection for staging/preview." >&2
  echo "Rerun corepack pnpm data-os:staging-shadow without NOISIA_DATA_OS_STAGING_SHADOW_SKIP_CANDIDATES=true." >&2
  exit 1
fi

readme_target="$(sed -n 's/^Target: //p' "$SUMMARY_FILE" | head -n 1)"
if [[ "$readme_target" != "$NOISIA_REMOTE_DATABASE_TARGET" ]]; then
  echo "Evidence target ($readme_target) does not match NOISIA_REMOTE_DATABASE_TARGET ($NOISIA_REMOTE_DATABASE_TARGET)." >&2
  exit 1
fi

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

run_capture_without_summary() {
  local file_name="$1"
  shift

  "$@" 2>&1 | tee "$EVIDENCE_DIR/$file_name"
  local status="${PIPESTATUS[0]}"
  if [[ "$status" -ne 0 ]]; then
    echo "Command failed with exit code $status. See $EVIDENCE_DIR/$file_name" >&2
    exit "$status"
  fi
}

run_capture_allow_failure() {
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

  set +e
  "$@" 2>&1 | tee "$EVIDENCE_DIR/$file_name"
  local status="${PIPESTATUS[0]}"
  set -e
  if [[ "$status" -ne 0 ]]; then
    echo "Recorded Signal V2 gate failure (exit $status): $file_name" >&2
  fi
}

append_release_gate_summary() {
  case "${NOISIA_REMOTE_DATABASE_TARGET}" in
    staging|preview)
      {
        echo ""
        echo "## release-gate.json"
        echo ""
        echo '```bash'
        redacted_command_summary \
          env NOISIA_DATA_OS_EVIDENCE_PACK_DIR="$EVIDENCE_DIR" \
          corepack pnpm --silent --filter @noisia/db data-os:release-gate
        echo
        echo '```'
      } >>"$SUMMARY_FILE"
      ;;
    throwaway)
      {
        echo ""
        echo "## release-gate.json"
        echo ""
        echo "Skipped: release gate only accepts staging or preview evidence."
      } >>"$SUMMARY_FILE"
      ;;
  esac
}

{
  echo ""
  echo "Finalized after human review at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >>"$SUMMARY_FILE"

echo "Finalizing Data OS staging evidence for target: ${NOISIA_REMOTE_DATABASE_TARGET}"
echo "Corpus: set (redacted)"
echo "Output: set (redacted)"
echo "Evidence dir: ${EVIDENCE_DIR}"

run_capture staging-check.txt \
  corepack pnpm --silent data-os:staging-check

run_capture review-queue.json \
  env NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true \
  corepack pnpm --silent --filter @noisia/db data-os:review-queue

run_capture review-sample.json \
  env NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=true \
  corepack pnpm --silent --filter @noisia/db data-os:review-sample

run_capture serving-smoke.json \
  env NOISIA_DATA_OS_ENABLED=true \
  NOISIA_DATA_OS_SERVING_ENABLED=true \
  NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=true \
  NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false \
  NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE=true \
  NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID="$NOISIA_DATA_OS_BACKFILL_CORPUS_ID" \
  NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID="$NOISIA_DATA_OS_SHADOW_OUTPUT_ID" \
  corepack pnpm --silent --filter @noisia/studio data-os:serving-smoke

run_capture signal-v2-reconcile.json \
  env NOISIA_SIGNAL_V2_RECONCILE_ALLOW_REMOTE=true \
  corepack pnpm --silent signal:v2:reconcile

run_capture signal-v2-explain.json \
  env NOISIA_SIGNAL_V2_EXPLAIN_ALLOW_REMOTE=true \
  NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE=true \
  NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED=true \
  corepack pnpm --silent signal:v2:explain

run_capture_allow_failure signal-v2-shadow.json \
  env NOISIA_SIGNAL_V2_SHADOW_ALLOW_REMOTE=true \
  NOISIA_SIGNAL_WORKSPACE_API_ENABLED=false \
  NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false \
  corepack pnpm --silent --filter @noisia/studio signal:v2:shadow

run_capture_allow_failure backend-ready-signal-v2.json \
  env NOISIA_DATA_OS_EVIDENCE_PACK_DIR="$EVIDENCE_DIR" \
  corepack pnpm --silent signal:v2:backend-gate

run_capture evidence.json \
  env NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE=true \
  corepack pnpm --silent --filter @noisia/db data-os:evidence

run_capture evidence.md \
  env NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE=true \
  NOISIA_DATA_OS_EVIDENCE_FORMAT=markdown \
  corepack pnpm --silent --filter @noisia/db data-os:evidence

append_release_gate_summary

run_capture evidence-pack-validation.json \
  env NOISIA_DATA_OS_EVIDENCE_PACK_DIR="$EVIDENCE_DIR" \
  corepack pnpm --silent --filter @noisia/db data-os:validate-evidence-pack

case "${NOISIA_REMOTE_DATABASE_TARGET}" in
  staging|preview)
    run_capture_without_summary release-gate.json \
      env NOISIA_DATA_OS_EVIDENCE_PACK_DIR="$EVIDENCE_DIR" \
      corepack pnpm --silent --filter @noisia/db data-os:release-gate
    ;;
esac

run_capture_without_summary pr-summary.md \
  env NOISIA_DATA_OS_EVIDENCE_PACK_DIR="$EVIDENCE_DIR" \
  corepack pnpm --silent --filter @noisia/db data-os:pr-summary

run_capture_without_summary completion-audit.json \
  env NOISIA_DATA_OS_EVIDENCE_PACK_DIR="$EVIDENCE_DIR" \
  corepack pnpm --silent --filter @noisia/db data-os:completion-audit

echo "Data OS staging evidence finalized."
echo "Evidence package: ${EVIDENCE_DIR}"
if ! grep -q '"backend_ready_for_signal_v2": true' "$EVIDENCE_DIR/backend-ready-signal-v2.json"; then
  echo "Backend Ready For Signal V2 remains blocked; inspect backend-ready-signal-v2.json." >&2
  exit 1
fi
