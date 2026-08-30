import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  projectSignalTopicEvaluationFullEvidenceStatusV2,
  shortSignalTopicEvaluationDigestV2
} from "./signal-topic-evaluation-full-evidence-status";

const digest = `sha256:${"a".repeat(64)}`;

function preflight() {
  return {
    contract_version: "signal-topic-evaluation-full-evidence-v2",
    execution_enabled: false,
    provider_calls_allowed: 0,
    no_retry: true,
    action_time_confirmation_required: true,
    max_model_turns: 12,
    max_tool_calls: 24,
    max_tool_result_bytes: 32_768,
    max_total_tool_result_bytes: 262_144,
    max_total_input_tokens: 450_000,
    max_total_output_tokens: 50_000,
    hard_cap_micro_usd: 20_000_000,
    preserve_complete_candidate_pool: true,
    top_view_limit: 10,
    snapshot_key: "topic-evaluation-snapshot",
    snapshot_digest: digest,
    cluster_count: 116,
    membership_count: 21_195,
    semantic_context_authority_digest: digest,
    historical_summary_evaluator_preserved: true,
    candidates_are_pending_only: true,
    topic_adoption: false,
    publication: false,
    serving: false
  };
}

test("full-evidence status projects only a closed, provider-disabled aggregate card", () => {
  const projected = projectSignalTopicEvaluationFullEvidenceStatusV2(preflight());
  assert.deepEqual(projected, {
    authorityDigest: digest,
    clusterCount: 116,
    hardCapMicroUsd: 20_000_000,
    membershipCount: 21_195,
    snapshotDigest: digest,
    topViewLimit: 10
  });
  assert.equal(shortSignalTopicEvaluationDigestV2(digest), "sha256:aaaaaaaa…aaaaaaaa");
  assert.doesNotMatch(JSON.stringify(projected), /snapshot_key|mention|artifact|text_clean/u);
});

test("full-evidence status rejects execution, provider, aggregate and shape drift before rendering", () => {
  for (const value of [
    { ...preflight(), execution_enabled: true },
    { ...preflight(), provider_calls_allowed: 1 },
    { ...preflight(), cluster_count: 115 },
    { ...preflight(), membership_count: 21_194 },
    { ...preflight(), snapshot_digest: "sha256:not-a-digest" },
    { ...preflight(), private_artifact_path: "/private/artifact" }
  ]) {
    assert.throws(() => projectSignalTopicEvaluationFullEvidenceStatusV2(value),
      /topic_evaluation_full_evidence_status_invalid/u);
  }
});

test("Brand OS status uses only the provider-disabled preflight GET and retains Discovery Review separation", async () => {
  const [component, projection, page, route, es, en] = await Promise.all([
    readFile(new URL("../../components/brands/FullEvidenceTopicEvaluationStatus.tsx", import.meta.url), "utf8"),
    readFile(new URL("./signal-topic-evaluation-full-evidence-status.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/studio/brands/[id]/brand-os/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../messages/es-MX.json", import.meta.url), "utf8"),
    readFile(new URL("../../../messages/en-US.json", import.meta.url), "utf8")
  ]);
  assert.match(component, /topic-evaluation\/full-evidence/u);
  assert.match(component, /method: "GET"/u);
  assert.doesNotMatch(component, /method:\s*"POST"|topic-evaluation\/full-evidence\/evidence/u);
  assert.match(projection, /execution_enabled !== false|provider_calls_allowed !== 0/u);
  assert.match(page, /FullEvidenceTopicEvaluationStatus/u);
  assert.ok(page.indexOf("<FullEvidenceTopicEvaluationStatus") > page.indexOf("<TopicEvaluationManager"));
  assert.doesNotMatch(page, /TopicDiscoveryReviewWorkbench/u);
  assert.match(route, /loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(route, /topic_evaluation_v2_disabled/u);
  assert.doesNotMatch(route, /enqueue|startSignalTopicEvaluation/u);
  for (const messages of [JSON.parse(es), JSON.parse(en)]) {
    assert.ok(messages.AdminWorkspace.brandOs.fullEvidenceTopicEvaluation.boundary.body);
    assert.ok(messages.AdminWorkspace.brandOs.fullEvidenceTopicEvaluation.navigation.catalog);
  }
});
