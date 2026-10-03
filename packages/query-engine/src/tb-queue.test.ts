import assert from "node:assert/strict";
import test from "node:test";

import { TB_ANALYSIS_QUEUE_NAME, resolveTbAnalysisQueueName } from "./tb";

test("T&B queue keeps the canonical default", () => {
  assert.equal(resolveTbAnalysisQueueName({}), TB_ANALYSIS_QUEUE_NAME);
});

test("T&B queue accepts a server-owned environment override", () => {
  assert.equal(
    resolveTbAnalysisQueueName({ NOISIA_TB_ANALYSIS_QUEUE_NAME: "noisia-tb-analysis-uat" }),
    "noisia-tb-analysis-uat"
  );
});

test("T&B queue ignores an empty override", () => {
  assert.equal(
    resolveTbAnalysisQueueName({ NOISIA_TB_ANALYSIS_QUEUE_NAME: "  " }),
    TB_ANALYSIS_QUEUE_NAME
  );
});

test("T&B queue fails closed when UAT has no isolated override", () => {
  assert.throws(
    () => resolveTbAnalysisQueueName({ NOISIA_RUNTIME_PROFILE: "uat" }),
    /uat_tb_queue_name_must_end_in_uat/u
  );
});
