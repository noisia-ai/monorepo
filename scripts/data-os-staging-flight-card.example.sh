#!/usr/bin/env bash
# Noisia Data OS staging/preview flight card.
# Copy the exports into a secure local shell and replace placeholders there.
# Do not fill real values in this tracked example file.

set -euo pipefail

# Required remote target. Accepted values: staging, preview, throwaway.
# Production is intentionally not accepted by the Data OS staging wrappers.
export NOISIA_REMOTE_DATABASE_TARGET=staging

# Required DB connection. Confirm visually that this points to staging/preview,
# never production, before exporting NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true.
export DATABASE_URL="<staging_or_preview_database_url>"

# Required Signal Pulse pair. Get these from data-os:candidates or Studio DB.
export NOISIA_DATA_OS_BACKFILL_CORPUS_ID="<study_corpus_uuid>"
export NOISIA_DATA_OS_SHADOW_OUTPUT_ID="<published_signal_pulse_output_uuid>"

# Required operational approval for any remote shadow run.
export NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=false

# Optional: set true only when the selected remote DB still needs the Data OS schema.
export NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA=false

# Optional: set a deterministic evidence dir when resuming the same run.
export NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=".data/data-os-evidence/<target>-<yyyymmdd>"

# Optional human-review closeout. Leave unset for the first shadow run; after reviewing
# the queue in a secure terminal, set these and run data-os:staging-finalize.
# export NOISIA_DATA_OS_REVIEW_CORPUS_ID="$NOISIA_DATA_OS_BACKFILL_CORPUS_ID"
# export NOISIA_DATA_OS_REVIEW_TAG_ID="<record_tag_uuid>"
# export NOISIA_DATA_OS_REVIEW_ASSERTION_ID="<knowledge_assertion_uuid>"
# export NOISIA_DATA_OS_REVIEW_TAG_ACTION=approve
# export NOISIA_DATA_OS_REVIEW_ASSERTION_ACTION=approve
# export NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true

cat <<'NEXT'
Next safe sequence:
  corepack pnpm data-os:staging-check
  corepack pnpm data-os:staging-shadow

If the shadow stops after review-queue.json, inspect IDs/context only in a secure
terminal, export the human-review closeout values, then run:
  corepack pnpm data-os:staging-finalize

Production review requires:
  release-gate.json -> ready_for_production_review: true
  completion-audit.json -> ready_for_goal_completion: true
NEXT
