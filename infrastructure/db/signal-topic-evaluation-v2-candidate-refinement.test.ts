import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import {
  appendSignalTopicCandidateRefinementProposalV1,
  createSignalTopicCandidateRefinementSessionV1,
  navigateSignalTopicCandidateRefinementV1,
  signalTopicCandidateRefinementTestOnly
} from "./signal-topic-evaluation-v2-candidate-refinement";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  run: "00000000-0000-4000-8000-000000000002",
  snapshot: "00000000-0000-4000-8000-000000000003",
  candidate: "00000000-0000-4000-8000-000000000004",
  base: "00000000-0000-4000-8000-000000000005",
  actor: "00000000-0000-4000-8000-000000000006"
};
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const changedDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const actor = { id: ids.actor, user_type: "noisia_internal" as const };

const currentCandidate = {
  workspace_id: ids.workspace, run_id: ids.run, run_key: "run.topic-eval", snapshot_id: ids.snapshot,
  candidate_id: ids.candidate, base_model_revision_id: ids.base, candidate_editorial_revision_id: null,
  candidate_key: "topic.echo-deals", candidate_revision: 1, candidate_version_digest: digest,
  candidate_state_token: digest, brand_os_authority_digest: digest, source_cluster_keys: ["cluster.echo"],
  title: "Echo deals", description: "Customer interest in Amazon Echo pricing", inclusion: ["Echo"],
  exclusion: ["unrelated"]
};

const sealedSession = {
  ...currentCandidate, id: "00000000-0000-4000-8000-000000000007", session_key: "topic-refine-0123456789abcdef",
  actor_user_id: ids.actor, start_input_digest: digest, trace_count: 0,
  expires_at: "2099-01-01T00:15:00.000Z", session_digest: digest
};

test("session-bound paged cursor fits the unchanged API and DB limit with real-shaped signed evidence", () => {
  const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const inner = Buffer.from(JSON.stringify({ payload: { operation: "search_cluster",
    filter_digest: sha("filter"), value: sha("member"), rank: 21 }, signature: sha("inner") })).toString("base64url");
  const api = signalTopicCandidateRefinementTestOnly;
  const cursor = api.encodeRefinementCursor(sealedSession, sha("filter"), inner);
  assert.ok(cursor.length <= 512);
  assert.equal(api.decodeRefinementCursor(sealedSession, sha("filter"), cursor, new Date("2099-01-01T00:00:00Z")), inner);
  for (const [session, filter, token, now] of [
    [{ ...sealedSession, session_key: "topic-refine-other" }, sha("filter"), cursor, new Date("2099-01-01T00:00:00Z")],
    [sealedSession, sha("other-filter"), cursor, new Date("2099-01-01T00:00:00Z")],
    [sealedSession, sha("filter"), cursor.slice(0, -1) + (cursor.endsWith("a") ? "b" : "a"), new Date("2099-01-01T00:00:00Z")],
    [sealedSession, sha("filter"), cursor, new Date("2099-01-01T00:15:00Z")],
    [sealedSession, sha("filter"), `v2.${deflateRawSync(Buffer.alloc(10_000)).toString("base64url")}.${"a".repeat(64)}`, new Date("2099-01-01T00:00:00Z")]
  ] as const) {
    assert.throws(() => api.decodeRefinementCursor(session, filter, token, now),
      /topic_candidate_refinement_cursor_invalid/u);
  }
});

function scriptedPool(rows: Array<Array<Record<string, unknown>>>) {
  const sql: string[] = [];
  const client = {
    async query(query: string) {
      sql.push(query);
      const next = rows.shift();
      assert.ok(next, `unexpected query: ${query.slice(0, 160)}`);
      return { rows: next, rowCount: next.length };
    },
    release() { /* test double */ }
  };
  return { pool: { async connect() { return client; } }, sql };
}

test("refinement session is a server-clock sealed proposal-only write", async () => {
  const scripted = scriptedPool([
    [], [], [{ digest }], [], [currentCandidate], [{ session_digest: digest,
      expires_at: "2099-01-01T00:15:00.000Z" }], []
  ]);
  const result = await createSignalTopicCandidateRefinementSessionV1({ pool: scripted.pool as never,
    workspace_id: ids.workspace, actor, idempotency_key: "refinement.test.session.001",
    input: { run_key: "run.topic-eval", candidate_key: "topic.echo-deals", expected_revision: 1,
      state_token: digest } });
  assert.equal(result.provider_calls_allowed, 0);
  assert.equal(result.topic_adoption, false);
  assert.equal(result.publication, false);
  assert.equal(result.serving, false);
  const writes = scripted.sql.filter((query) => /\bINSERT\s+INTO\b/iu.test(query));
  const candidateRead = scripted.sql.find((query) => /FROM signal_topic_evaluation_v2_candidates candidate/iu.test(query));
  assert.equal(writes.length, 1);
  assert.ok(candidateRead);
  assert.doesNotMatch(candidateRead!, /candidate\.serving\n\s+WHERE candidate\.workspace_id/iu);
  assert.match(candidateRead!, /AND candidate\.workspace_id=\$1::uuid/iu);
  assert.match(writes[0]!, /candidate_refinement_sessions/u);
  assert.doesNotMatch(writes[0]!, /candidate_editorial_revisions|topic_contract|published|serving/iu);
  assert.match(writes[0]!, /clock_timestamp\(\)/u);
});

test("session idempotency replays only the exact sealed start input", async () => {
  const replay = scriptedPool([[], [], [{ digest }], [sealedSession], []]);
  const same = await createSignalTopicCandidateRefinementSessionV1({ pool: replay.pool as never,
    workspace_id: ids.workspace, actor, idempotency_key: "refinement.test.replay.001",
    input: { run_key: "run.topic-eval", candidate_key: "topic.echo-deals", expected_revision: 1,
      state_token: digest } });
  assert.equal(same.session_key, sealedSession.session_key);
  const changed = scriptedPool([[], [], [{ digest: changedDigest }], [sealedSession]]);
  await assert.rejects(createSignalTopicCandidateRefinementSessionV1({ pool: changed.pool as never,
    workspace_id: ids.workspace, actor, idempotency_key: "refinement.test.replay.001",
    input: { run_key: "run.topic-eval", candidate_key: "topic.echo-deals", expected_revision: 1,
      state_token: changedDigest } }), /topic_candidate_refinement_idempotency_conflict/u);
  assert.equal(changed.sql.filter((query) => /\bINSERT\s+INTO\b/iu.test(query)).length, 0);
});

test("refinement proposal appends context only and cannot enter editorial or Topic planes", async () => {
  const scripted = scriptedPool([
    [], [], [sealedSession], [currentCandidate], [{ digest }], [], [{ evidence_ref: digest }], [], []
  ]);
  const result = await appendSignalTopicCandidateRefinementProposalV1({ pool: scripted.pool as never,
    workspace_id: ids.workspace, actor, session_key: sealedSession.session_key,
    idempotency_key: "refinement.test.proposal.001", proposal: {
      contract_version: "signal-topic-candidate-refinement-v1", display_name: "Echo value signals",
      description: "A proposal for later human review.", evidence_refs: [digest], related_candidate_keys: [],
      recommendation: "none", rationale: "The traced evidence is specific to Echo purchase intent."
    } });
  assert.equal(result.topic_adoption, false);
  assert.equal(result.publication, false);
  assert.equal(result.serving, false);
  const writes = scripted.sql.filter((query) => /\bINSERT\s+INTO\b/iu.test(query));
  assert.equal(writes.length, 1);
  assert.match(writes[0]!, /candidate_refinement_proposals/u);
  assert.doesNotMatch(writes[0]!, /candidate_editorial_revisions|candidate_review_operations|topic_contract|published|serving/iu);
  assert.doesNotMatch(scripted.sql.join("\n"), /ANTHROPIC|fetch\(|provider/iu);
});

test("proposal idempotency is bound to its exact sealed proposal payload", async () => {
  const replay = scriptedPool([[], [], [sealedSession], [currentCandidate], [{ digest }],
    [{ proposal_digest: digest, idempotency_key: "refinement.test.proposal.002" }], []]);
  const proposal = {
    contract_version: "signal-topic-candidate-refinement-v1" as const,
    display_name: "Echo value signals", description: "A proposal for later human review.",
    evidence_refs: [digest], related_candidate_keys: [], recommendation: "none" as const,
    rationale: "The traced evidence is specific to Echo purchase intent."
  };
  const replayed = await appendSignalTopicCandidateRefinementProposalV1({ pool: replay.pool as never,
    workspace_id: ids.workspace, actor, session_key: sealedSession.session_key,
    idempotency_key: "refinement.test.proposal.002", proposal });
  assert.equal(replayed.idempotent_replay, true);
  assert.equal(replay.sql.filter((query) => /\bINSERT\s+INTO\b/iu.test(query)).length, 0);

  const conflict = scriptedPool([[], [], [sealedSession], [currentCandidate], [{ digest: changedDigest }],
    [{ proposal_digest: digest, idempotency_key: "refinement.test.proposal.002" }]]);
  await assert.rejects(appendSignalTopicCandidateRefinementProposalV1({ pool: conflict.pool as never,
    workspace_id: ids.workspace, actor, session_key: sealedSession.session_key,
    idempotency_key: "refinement.test.proposal.002", proposal }),
  /topic_candidate_refinement_proposal_already_exists/u);
  assert.equal(conflict.sql.filter((query) => /\bINSERT\s+INTO\b/iu.test(query)).length, 0);
});

test("aggregate evidence budget permits six maximum results and rejects a seventh", () => {
  const maximum = 32_768;
  assert.doesNotThrow(() => signalTopicCandidateRefinementTestOnly.assertRefinementResultBudget(
    maximum * 5, maximum));
  assert.throws(() => signalTopicCandidateRefinementTestOnly.assertRefinementResultBudget(
    maximum * 6, maximum), /topic_candidate_refinement_total_result_limit_reached/u);
});

test("expired and out-of-scope sessions reject before generic navigation or trace insertion", async () => {
  const expired = scriptedPool([[], [], [{ ...sealedSession, expires_at: "2000-01-01T00:00:00.000Z" }]]);
  await assert.rejects(navigateSignalTopicCandidateRefinementV1({ pool: expired.pool as never,
    workspace_id: ids.workspace, actor, session_key: sealedSession.session_key,
    request: { operation: "candidate_context" }, now: new Date("2026-09-05T00:00:00.000Z") }),
  /topic_candidate_refinement_session_expired/u);
  const forbidden = scriptedPool([[], [], [sealedSession], [currentCandidate]]);
  await assert.rejects(navigateSignalTopicCandidateRefinementV1({ pool: forbidden.pool as never,
    workspace_id: ids.workspace, actor, session_key: sealedSession.session_key,
    request: { operation: "cluster_profile", cluster_key: "cluster.not-in-candidate" } }),
  /topic_candidate_refinement_cluster_forbidden/u);
  assert.equal(forbidden.sql.filter((query) => /\bINSERT\s+INTO\b/iu.test(query)).length, 0);
});
