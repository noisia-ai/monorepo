#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failures=()

check_required() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    printf '%s=set\n' "$name"
  else
    printf '%s=missing\n' "$name"
    failures+=("$name")
  fi
}

check_bool_if_set() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    printf '%s=unset\n' "$name"
    return
  fi
  case "$value" in
    true|false)
      printf '%s=%s\n' "$name" "$value"
      ;;
    *)
      printf '%s=invalid_bool\n' "$name"
      failures+=("$name")
      ;;
  esac
}

check_uuid_if_set() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    return
  fi
  if [[ "$value" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
    printf '%s_FORMAT=uuid\n' "$name"
  else
    printf '%s_FORMAT=invalid_uuid\n' "$name"
    failures+=("${name}_FORMAT")
  fi
}

check_review_action_if_set() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    printf '%s=unset\n' "$name"
    return
  fi
  case "$value" in
    approve|reject|needs_review)
      printf '%s=%s\n' "$name" "$value"
      ;;
    *)
      printf '%s=invalid_action\n' "$name"
      failures+=("$name")
      ;;
  esac
}

check_database_url_environment() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    return
  fi

  local value
  value="$(printf '%s' "$DATABASE_URL" | tr '[:upper:]' '[:lower:]')"
  case "$DATABASE_URL" in
    *"<"*">"*)
      echo "DATABASE_URL_FORMAT=placeholder_refused"
      failures+=("DATABASE_URL_PLACEHOLDER")
      return
      ;;
  esac
  if [[ ! "$value" =~ ^postgres(ql)?://[^[:space:]]+$ ]]; then
    echo "DATABASE_URL_FORMAT=invalid_postgres_url"
    failures+=("DATABASE_URL_FORMAT")
    return
  fi
  echo "DATABASE_URL_FORMAT=postgres_url"

  if [[ "$value" =~ (^|[^a-z0-9])(prod|production)([^a-z0-9]|$) ]]; then
    echo "DATABASE_URL_ENVIRONMENT=production_like_refused"
    failures+=("DATABASE_URL_PRODUCTION_LIKE")
    return
  fi
  if [[ "$value" =~ ://localhost([:/?]|$) || "$value" =~ ://127\.0\.0\.1([:/?]|$) || "$value" =~ ://\[::1\]([:/?]|$) ]]; then
    echo "DATABASE_URL_ENVIRONMENT=local_redacted"
    return
  fi
  echo "DATABASE_URL_ENVIRONMENT=remote_redacted"
}

echo "Noisia Data OS staging environment check"
echo "Values are intentionally redacted; this command only reports set/missing."
echo ""

if corepack pnpm --silent data-os:verify >/dev/null; then
  echo "LOCAL_DATA_OS_VERIFY=passed"
else
  echo "LOCAL_DATA_OS_VERIFY=failed"
  failures+=("LOCAL_DATA_OS_VERIFY")
fi

check_required DATABASE_URL
check_database_url_environment

case "${NOISIA_REMOTE_DATABASE_TARGET:-}" in
  staging|throwaway|preview)
    printf 'NOISIA_REMOTE_DATABASE_TARGET=%s\n' "$NOISIA_REMOTE_DATABASE_TARGET"
    ;;
  "")
    printf 'NOISIA_REMOTE_DATABASE_TARGET=missing\n'
    failures+=("NOISIA_REMOTE_DATABASE_TARGET")
    ;;
  *)
    printf 'NOISIA_REMOTE_DATABASE_TARGET=invalid\n'
    failures+=("NOISIA_REMOTE_DATABASE_TARGET")
    ;;
esac

check_required NOISIA_DATA_OS_BACKFILL_CORPUS_ID
check_required NOISIA_DATA_OS_SHADOW_OUTPUT_ID
check_required NOISIA_SIGNAL_WORKSPACE_ID
# Emits NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid/invalid_uuid without printing the ID.
# Emits NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid/invalid_uuid without printing the ID.
check_uuid_if_set NOISIA_DATA_OS_BACKFILL_CORPUS_ID
check_uuid_if_set NOISIA_DATA_OS_SHADOW_OUTPUT_ID
check_uuid_if_set NOISIA_SIGNAL_WORKSPACE_ID

if [[ "${NOISIA_DATA_OS_STAGING_SHADOW_APPROVED:-}" == "true" ]]; then
  echo "NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true"
else
  echo "NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=missing_or_false"
  failures+=("NOISIA_DATA_OS_STAGING_SHADOW_APPROVED")
fi

if [[ "${NOISIA_SIGNAL_V2_BACKFILL_APPROVED:-}" == "true" ]]; then
  echo "NOISIA_SIGNAL_V2_BACKFILL_APPROVED=true"
else
  echo "NOISIA_SIGNAL_V2_BACKFILL_APPROVED=missing_or_false"
  failures+=("NOISIA_SIGNAL_V2_BACKFILL_APPROVED")
fi

if [[ "${NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED:-}" == "true" ]]; then
  echo "NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED=true"
else
  echo "NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED=missing_or_false"
  failures+=("NOISIA_SIGNAL_V2_EXPLAIN_ANALYZE_REMOTE_APPROVED")
fi

check_bool_if_set NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA
check_bool_if_set NOISIA_DATA_OS_STAGING_SHADOW_SKIP_CANDIDATES
check_bool_if_set NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED

if [[ "${NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED:-}" == "true" ]]; then
  check_required NOISIA_DATA_OS_REVIEW_TAG_ID
  check_required NOISIA_DATA_OS_REVIEW_ASSERTION_ID
fi

# Emits review sample UUID/action status without printing IDs or notes.
check_uuid_if_set NOISIA_DATA_OS_REVIEW_TAG_ID
check_uuid_if_set NOISIA_DATA_OS_REVIEW_ASSERTION_ID
check_uuid_if_set NOISIA_DATA_OS_REVIEWER_USER_ID
check_uuid_if_set NOISIA_DATA_OS_REVIEW_CORPUS_ID
check_review_action_if_set NOISIA_DATA_OS_REVIEW_TAG_ACTION
check_review_action_if_set NOISIA_DATA_OS_REVIEW_ASSERTION_ACTION

if [[ -n "${NOISIA_DATA_OS_STAGING_EVIDENCE_DIR:-}" ]]; then
  echo "NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=set"
else
  echo "NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=default:.data/data-os-evidence/<utc-timestamp>"
fi

case "${NOISIA_REMOTE_DATABASE_TARGET:-}" in
  staging|preview)
    echo "release_gate_artifact=will_write:release-gate.json"
    ;;
  throwaway)
    echo "release_gate_artifact=skipped_for_throwaway"
    ;;
esac

echo ""
if [[ "${#failures[@]}" -gt 0 ]]; then
  echo "ready_for_staging_shadow=false"
  echo "missing_or_invalid=${failures[*]}"
  echo "Next: export the missing values, visually confirm DATABASE_URL is not production, then rerun:"
  echo "  corepack pnpm data-os:staging-check"
  exit 1
fi

echo "ready_for_staging_shadow=true"
echo "Next:"
echo "  corepack pnpm data-os:staging-shadow"
