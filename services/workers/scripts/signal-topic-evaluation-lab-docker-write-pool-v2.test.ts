import assert from "node:assert/strict";
import test from "node:test";

import { signalTopicEvaluationLabExtractSqlDiagnosticForTestV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";

test("local PostgreSQL diagnostics preserve only the expected SQLSTATE and allowlisted domain", () => {
  assert.deepEqual(signalTopicEvaluationLabExtractSqlDiagnosticForTestV2(
    "ERROR:  23514: topic_refinement_terminal_authority_invalid\nLOCATION: exec_simple_query"), {
    sqlstate: "23514", domain_code: "topic_refinement_terminal_authority_invalid"
  });
  assert.deepEqual(signalTopicEvaluationLabExtractSqlDiagnosticForTestV2(
    "ERROR:  23514: arbitrary database detail"), { sqlstate: "23514", domain_code: null });
});
