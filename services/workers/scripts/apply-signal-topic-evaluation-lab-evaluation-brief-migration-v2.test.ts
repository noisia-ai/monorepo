import assert from "node:assert/strict";
import test from "node:test";

import { applySignalTopicEvaluationLabEvaluationBriefMigrationV2 } from
  "./apply-signal-topic-evaluation-lab-evaluation-brief-migration-v2";

test("0117 Lab migration helper is disabled before any host or database access", async () => {
  await assert.rejects(applySignalTopicEvaluationLabEvaluationBriefMigrationV2({}),
    /topic_evaluation_lab_evaluation_brief_migration_apply_disabled/u);
});
