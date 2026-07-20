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
require_env NOISIA_DATA_OS_BACKFILL_CORPUS_ID
require_env NOISIA_DATA_OS_SHADOW_OUTPUT_ID

case "${NOISIA_REMOTE_DATABASE_TARGET:-}" in
  staging|throwaway|preview)
    ;;
  *)
    echo "Refusing to run staging shadow without NOISIA_REMOTE_DATABASE_TARGET=staging|throwaway|preview." >&2
    exit 1
    ;;
esac

if [[ "${NOISIA_DATA_OS_STAGING_SHADOW_APPROVED:-false}" != "true" ]]; then
  echo "Refusing to run staging shadow until NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true." >&2
  echo "Confirm DATABASE_URL points to staging/throwaway/preview, not production, before setting it." >&2
  exit 1
fi

echo "Prechecking Data OS staging shadow environment..."
corepack pnpm --silent data-os:staging-check

SCHEMA_BEFORE_EVIDENCE_LOG=""
if [[ "${NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA:-false}" == "true" ]]; then
  echo "Schema apply requested; applying schema before output/corpus preflight and evidence package..."
  SCHEMA_BEFORE_EVIDENCE_LOG="$(mktemp "${TMPDIR:-/tmp}/noisia-data-os-staging-apply-schema.XXXXXX")"
  if ! env NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=true \
    corepack pnpm --silent --filter @noisia/db db:apply:existing >"$SCHEMA_BEFORE_EVIDENCE_LOG" 2>&1; then
    rm -f "$SCHEMA_BEFORE_EVIDENCE_LOG"
    echo "Schema apply failed before evidence package creation." >&2
    echo "No evidence directory was created. Review the migration output locally, then rerun:" >&2
    echo "  NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA=true corepack pnpm data-os:staging-shadow" >&2
    exit 1
  fi
fi

echo "Environment precheck passed; verifying Signal Pulse output/corpus pair before evidence package..."

PREFLIGHT_BEFORE_EVIDENCE_LOG="$(mktemp "${TMPDIR:-/tmp}/noisia-data-os-staging-preflight.XXXXXX")"
if ! env NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=true \
  corepack pnpm --silent --filter @noisia/db data-os:preflight >"$PREFLIGHT_BEFORE_EVIDENCE_LOG" 2>&1; then
  rm -f "$PREFLIGHT_BEFORE_EVIDENCE_LOG"
  rm -f "$SCHEMA_BEFORE_EVIDENCE_LOG"
  echo "Signal Pulse output/corpus preflight failed before evidence package creation." >&2
  echo "No evidence directory was created. Review the redacted env, then run:" >&2
  echo "  NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=true corepack pnpm --filter @noisia/db data-os:preflight" >&2
  exit 1
fi
rm -f "$PREFLIGHT_BEFORE_EVIDENCE_LOG"
echo "Signal Pulse output/corpus preflight passed; creating evidence package."

EVIDENCE_DIR="${NOISIA_DATA_OS_STAGING_EVIDENCE_DIR:-.data/data-os-evidence/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_DIR="$(cd "$EVIDENCE_DIR" && pwd)"
SUMMARY_FILE="$EVIDENCE_DIR/README.md"

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

cat >"$SUMMARY_FILE" <<EOF
# Noisia Data OS Staging Shadow Evidence

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Target: ${NOISIA_REMOTE_DATABASE_TARGET}
Corpus: set (redacted)
Output: set (redacted)
Schema apply requested: ${NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA:-false}
Candidates skipped: ${NOISIA_DATA_OS_STAGING_SHADOW_SKIP_CANDIDATES:-false}

This directory is local evidence for PR/review. It lives under .data by default and
must not be committed because it can contain client IDs and operational metadata.
EOF

if [[ -n "$SCHEMA_BEFORE_EVIDENCE_LOG" ]]; then
  {
    echo ""
    echo "## apply-schema.log"
    echo ""
    echo '```bash'
    echo "env NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=true corepack pnpm --silent --filter @noisia/db db:apply:existing"
    echo '```'
  } >>"$SUMMARY_FILE"
  cp "$SCHEMA_BEFORE_EVIDENCE_LOG" "$EVIDENCE_DIR/apply-schema.log"
  rm -f "$SCHEMA_BEFORE_EVIDENCE_LOG"
fi

echo "Running Data OS staging shadow for target: ${NOISIA_REMOTE_DATABASE_TARGET}"
echo "Corpus: set (redacted)"
echo "Output: set (redacted)"
echo "Evidence dir: ${EVIDENCE_DIR}"

run_capture staging-check.txt \
  corepack pnpm --silent data-os:staging-check

if [[ "${NOISIA_DATA_OS_STAGING_SHADOW_SKIP_CANDIDATES:-false}" != "true" ]]; then
  run_capture candidates.json \
    env NOISIA_DATA_OS_CANDIDATES_ALLOW_REMOTE=true \
    corepack pnpm --silent --filter @noisia/db data-os:candidates
fi

run_capture shadow-run.log \
  env NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=true \
  NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE=true \
  NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE=true \
  NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE=true \
  NOISIA_DATA_OS_SHADOW_RUN_ENABLED=true \
  corepack pnpm --silent --filter @noisia/db data-os:shadow-run

run_capture analyze.json \
  env NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE=true \
  corepack pnpm --silent --filter @noisia/db data-os:analyze

run_capture serving-smoke.json \
  env NOISIA_DATA_OS_ENABLED=true \
  NOISIA_DATA_OS_SERVING_ENABLED=true \
  NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=true \
  NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false \
  NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE=true \
  NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID="$NOISIA_DATA_OS_BACKFILL_CORPUS_ID" \
  NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID="$NOISIA_DATA_OS_SHADOW_OUTPUT_ID" \
  corepack pnpm --silent --filter @noisia/studio data-os:serving-smoke

run_capture review-queue.json \
  env NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true \
  corepack pnpm --silent --filter @noisia/db data-os:review-queue

if [[ ! -f "$EVIDENCE_DIR/review-sample.json" ]]; then
  if [[ "${NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED:-false}" == "true" ]]; then
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
  else
    echo "Human review sample artifact is required before final Data OS evidence and release gate." >&2
    echo "Inspect /api/data-os/corpora/:id/review-queue, choose one tag_id and one assertion_id, then rerun:" >&2
    echo "  NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=true NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=true corepack pnpm data-os:review-queue" >&2
    echo "Then close this same evidence package with:" >&2
    echo "  NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=${EVIDENCE_DIR} NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true NOISIA_DATA_OS_REVIEW_TAG_ID=<uuid> NOISIA_DATA_OS_REVIEW_ASSERTION_ID=<uuid> corepack pnpm data-os:staging-finalize" >&2
    echo "The review-queue CLI output may include private IDs/context; do not attach it to PR evidence." >&2
    echo "  NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true NOISIA_DATA_OS_REVIEW_TAG_ID=<uuid> NOISIA_DATA_OS_REVIEW_ASSERTION_ID=<uuid> corepack pnpm data-os:staging-shadow" >&2
    echo "Evidence package kept for review queue inspection: ${EVIDENCE_DIR}" >&2
    exit 1
  fi
fi

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

echo "Data OS staging shadow completed."
echo "Evidence package: ${EVIDENCE_DIR}"
