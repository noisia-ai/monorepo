import type { Job } from "bullmq";

import { pool } from "../db/client";

type CleanupApplyJobData = {
  corpusId: string;
  cleanupActionId: string;
  patterns: string[];
  instruction: string;
};

/**
 * Worker that applies a cleanup_action to the corpus. One UPDATE per pattern
 * so we can report granular progress to the UI ("Patrón 5/12 · 42%").
 * Each UPDATE stamps cleanup_action_id so a later revert is exact.
 */
export async function cleanupApplyJob(job: Job<CleanupApplyJobData>) {
  const { corpusId, cleanupActionId, patterns, instruction } = job.data;
  const total = patterns.length;

  if (total === 0) {
    await job.updateProgress(100);
    return { excluded_count: 0, cleanup_action_id: cleanupActionId };
  }

  await job.updateProgress(2);

  const exclusionReason = `cleanup: ${instruction.slice(0, 120)}`;
  let totalExcluded = 0;

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i]!.trim();
    if (pattern.length < 2) continue;

    // Escape % and _ so user text isn't misread as wildcards, then wrap.
    const ilikePattern = "%" + pattern.replace(/[\\%_]/g, (m) => `\\${m}`) + "%";

    const result = await pool.query<{ id: string }>(
      `UPDATE mentions
       SET inclusion_status = 'excluded',
           exclusion_reason = $1,
           cleanup_action_id = $2
       WHERE study_corpus_id = $3
         AND inclusion_status = 'included'
         AND text_clean ILIKE $4
       RETURNING id`,
      [exclusionReason, cleanupActionId, corpusId, ilikePattern]
    );

    totalExcluded += result.rowCount ?? 0;
    console.log(`[cleanup-apply] pattern ${i + 1}/${total} "${pattern}" → ${result.rowCount ?? 0} excluded`);

    // Progress from 2% → 95% over the patterns loop, leaving headroom for the final count update
    const pct = Math.round(2 + ((i + 1) / total) * 93);
    await job.updateProgress(pct);
  }

  await pool.query(
    `UPDATE cleanup_actions SET mention_count = $1 WHERE id = $2`,
    [totalExcluded, cleanupActionId]
  );

  await job.updateProgress(100);

  return {
    excluded_count: totalExcluded,
    cleanup_action_id: cleanupActionId,
    patterns_processed: total
  };
}
