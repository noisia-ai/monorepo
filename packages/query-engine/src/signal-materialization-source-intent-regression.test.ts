import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalMentionDrillDownPlanV1 } from "./signal-materialization-v1";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const baseFilter = {
  date_range: { start: "2026-01-01", end: "2026-08-04" },
  timezone: "America/Mexico_City",
  granularity: "day",
  dimensions: {}
};

test("workspace canonical Mentions exposes accepted acquisition source intent", () => {
  const plan = buildSignalMentionDrillDownPlanV1({
    filter: baseFilter,
    workspace_canonical: true,
    workspace_id: workspaceId
  });

  assert.match(plan.sql, /FROM signal_mention_attributions intent/u);
  assert.match(plan.sql, /intent\.attribution_basis = 'source_intent'/u);
  assert.match(plan.sql, /intent\.is_current = true/u);
  assert.match(plan.sql, /intent_batch\.status = 'completed'/u);
  assert.match(plan.sql, /WHEN intent\.scope = 'category' THEN 'category'/u);
  assert.match(plan.sql, /COALESCE\(NULLIF\(intent\.entity_label, ''\), 'Unattributed'\)/u);
  assert.match(
    plan.sql,
    /intent_mention\.workspace_id = m\.workspace_id\s+AND intent_mention\.canonical_mention_id = COALESCE\(m\.canonical_mention_id, m\.id\)/u
  );
});

test("workspace canonical corpus-scope filters use the same accepted source intent", () => {
  const plan = buildSignalMentionDrillDownPlanV1({
    filter: {
      ...baseFilter,
      dimensions: { corpus_scope: ["category"] }
    },
    workspace_canonical: true,
    workspace_id: workspaceId
  });

  assert.match(plan.predicate.sql, /FROM signal_mention_attributions intent/u);
  assert.match(plan.predicate.sql, /intent\.attribution_basis = 'source_intent'/u);
  assert.match(plan.predicate.sql, /intent_batch\.status = 'completed'/u);
  assert.match(plan.predicate.sql, /WHEN intent\.scope = 'category' THEN 'category'/u);
});
