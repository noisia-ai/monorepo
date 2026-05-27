-- ============================================================
-- Corpus maintenance: snapshots + cleanup actions
-- Lets the Insights Manager keep iterating after an approval
-- without losing the approved state, and remove unwanted mentions
-- with Claude assistance — always reversibly.
-- ============================================================

-- Snapshots: a frozen view of which mentions were "included" at a moment in time.
-- Created on each approval AND on demand via the maintenance panel.
CREATE TABLE IF NOT EXISTS "corpus_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'manual', -- 'approval' | 'manual'
  "mention_count" integer NOT NULL DEFAULT 0,
  "scores_at_snapshot" jsonb,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_snap_corpus" ON "corpus_snapshots"("study_corpus_id", "created_at" DESC);

-- Join: which mentions belonged to a snapshot. Soft-stored — restoring
-- a snapshot rewrites mentions.inclusion_status to match this set.
CREATE TABLE IF NOT EXISTS "corpus_snapshot_mentions" (
  "snapshot_id" uuid NOT NULL REFERENCES "corpus_snapshots"("id") ON DELETE CASCADE,
  "mention_id" uuid NOT NULL REFERENCES "mentions"("id") ON DELETE CASCADE,
  PRIMARY KEY ("snapshot_id", "mention_id")
);

CREATE INDEX IF NOT EXISTS "idx_snap_mentions_mention" ON "corpus_snapshot_mentions"("mention_id");

-- Cleanup actions: every bulk exclusion (Claude or manual) is recorded
-- here so the IM can revert any batch.
CREATE TABLE IF NOT EXISTS "cleanup_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "study_corpus_id" uuid NOT NULL REFERENCES "study_corpora"("id") ON DELETE CASCADE,
  "kind" text NOT NULL, -- 'claude_instruction' | 'manual_bulk'
  "instruction" text,           -- user-supplied text (only for 'claude_instruction')
  "patterns" jsonb,             -- what Claude returned (or selection criteria)
  "claude_notes" text,          -- short reasoning string from Claude
  "mention_count" integer NOT NULL DEFAULT 0,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now(),
  "reverted_at" timestamp with time zone,
  "reverted_by_user_id" uuid REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "idx_cleanup_corpus" ON "cleanup_actions"("study_corpus_id", "created_at" DESC);

-- Link mentions to the cleanup that excluded them — so revert is O(N) by id
ALTER TABLE "mentions"
  ADD COLUMN IF NOT EXISTS "cleanup_action_id" uuid REFERENCES "cleanup_actions"("id");

CREATE INDEX IF NOT EXISTS "idx_mentions_cleanup_action" ON "mentions"("cleanup_action_id")
  WHERE "cleanup_action_id" IS NOT NULL;
