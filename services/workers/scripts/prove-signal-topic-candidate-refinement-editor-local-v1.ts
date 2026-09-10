/** One reusable product proof on the exact completed local Lab clone. Every editorial write
 * stays inside one outer SERIALIZABLE transaction and is unconditionally rolled back. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSignalTopicEvaluationV2CandidateDetail, reviewSignalTopicEvaluationV2Candidate,
  type SignalTopicEvaluationV2CandidateCommand } from "@noisia/db";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createSignalTopicEvaluationLabDockerWritePoolV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1 } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";

const EXACT_CLONE = "noisia_topic_eval_lab_20260906_1cd623f0d548";
const EXACT_PROPOSAL = "sha256:85854b9ab4c12dee9396dc2ef05d24729281b31da2943bae561d14d7418d236c";
const CONFIRMATION = "PROVE_COMPLETED_LOCAL_REFINEMENT_EDITOR_WITH_ROLLBACK";
type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
  rows: T[]; rowCount: number | null }> };

function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`topic_refinement_editor_proof_${code}`);
}

// Digests cover complete source bindings, model result, refinement result, and reversible
// editorial history. Only aggregate hashes/counters cross this proof's output boundary.
const IMMUTABLE_TABLES = {
  source: ["signal_topic_evaluation_v2_snapshots", "signal_topic_evaluation_v2_clusters",
    "signal_topic_evaluation_v2_cluster_memberships"],
  model: ["signal_topic_evaluation_v2_execution_authorizations", "signal_topic_evaluation_v2_runs",
    "signal_topic_evaluation_v2_model_turns", "signal_topic_evaluation_v2_retrievals",
    "signal_topic_evaluation_v2_retrieval_evidence", "signal_topic_evaluation_v2_candidates",
    "signal_topic_evaluation_v2_candidate_revisions", "signal_topic_evaluation_v2_candidate_evidence",
    "signal_topic_evaluation_v2_rankings"],
  refinement: ["signal_topic_evaluation_v2_candidate_refinement_sessions",
    "signal_topic_evaluation_v2_candidate_refinement_navigation_traces",
    "signal_topic_evaluation_v2_candidate_refinement_proposals",
    "signal_topic_evaluation_v2_candidate_refinement_flights",
    "signal_topic_evaluation_v2_candidate_refinement_flight_dispatch_claims",
    "signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts"]
} as const;

async function snapshot(queryable: Queryable) {
  const digestFields = Object.entries(IMMUTABLE_TABLES).map(([key, tables]) =>
    `signal_semantic_context_digest_v1(jsonb_build_array(${tables.map((table) =>
      `(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM ${table} row)`
    ).join(",")})::text) ${key}_digest`).join(",");
  const row = (await queryable.query<{ source_digest: string; model_digest: string; refinement_digest: string;
    candidates: number; editorial_revisions: number; review_operations: number; review_events: number;
    proposals: number; completed_refinements: number; adopted: number; published: number; serving: number }>(
    `SELECT ${digestFields},
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_editorial_revisions) editorial_revisions,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_review_operations) review_operations,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_review_events) review_events,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_proposals) proposals,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts
        WHERE terminal_status='completed') completed_refinements,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE adopted) adopted,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE published) published,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE serving) serving`)).rows[0];
  ensure(row, "snapshot_missing");
  return row;
}

export async function proveSignalTopicCandidateRefinementEditorLocalV1(environment: NodeJS.ProcessEnv) {
  ensure(environment.NOISIA_RUNTIME_PROFILE === "local_disposable_lab_v1"
    && environment.NOISIA_TOPIC_REFINEMENT_EDITOR_PROOF_ENABLED === "true"
    && environment.NOISIA_TOPIC_REFINEMENT_EDITOR_PROOF_CONFIRMATION === CONFIRMATION, "disabled");
  const { receipt, container } = await verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1();
  ensure(receipt.clone_name === EXACT_CLONE, "target_mismatch");
  const pool = createSignalTopicEvaluationLabDockerWritePoolV2(receipt);
  const containerDigest = signalTopicEvaluationDigestV2({ container_id: container.container_id,
    image_id: container.image_id });
  const anchor = (await pool.query<{ database_name: string; system_identifier: string; anchor_count: number }>(
    `SELECT current_database() database_name,
      (SELECT system_identifier::text FROM pg_control_system()) system_identifier,
      (SELECT count(*)::int FROM noisia_topic_evaluation_lab.host_receipt_anchor
        WHERE marker_id AND clone_name=current_database() AND host_receipt_digest=$1
          AND container_identity_digest=$2) anchor_count`, [receipt.receipt_digest, containerDigest])).rows[0];
  ensure(anchor?.database_name === EXACT_CLONE && anchor.system_identifier === receipt.server_system_identifier
    && anchor.anchor_count === 1, "database_anchor_mismatch");
  const before = await snapshot(pool);
  ensure(before.candidates === 10 && before.proposals === 1 && before.completed_refinements === 1
    && before.editorial_revisions === 0 && before.review_operations === 0 && before.review_events === 0
    && before.adopted === 0 && before.published === 0 && before.serving === 0, "baseline_mismatch");
  const outer = await pool.connect();
  let proofError: unknown;
  let proofCompleted = false;
  let nestedTransactionsSuppressed = 0;
  try {
    await outer.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    // Existing core owns nested transactions; this single-purpose wrapper keeps them inside the
    // proof transaction. Releasing a core client must never release the outer psql connection.
    const scoped: Queryable & { release(): void } = {
      async query<T = Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (/^\s*(?:BEGIN(?:\s+ISOLATION\s+LEVEL\s+SERIALIZABLE)?|COMMIT|ROLLBACK)\s*;?\s*$/iu.test(sql)) {
          nestedTransactionsSuppressed += 1;
          return { rows: [] as T[], rowCount: null };
        }
        return outer.query<T>(sql, values);
      },
      release() { /* Outer transaction owns the sole connection. */ }
    };
    const authority = (await outer.query<{ workspace_id: string; actor_id: string; run_key: string;
      candidate_key: string; session_expired: boolean }>(`SELECT proposal.workspace_id::text,
        session.actor_user_id::text actor_id,run.run_key,candidate.candidate_key,
        session.expires_at<=clock_timestamp() session_expired
      FROM signal_topic_evaluation_v2_candidate_refinement_proposals proposal
      JOIN signal_topic_evaluation_v2_candidate_refinement_sessions session ON session.id=proposal.session_id
      JOIN signal_topic_evaluation_v2_runs run ON run.id=proposal.run_id
      JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=proposal.candidate_id
      WHERE proposal.proposal_digest=$1`, [EXACT_PROPOSAL])).rows[0];
    ensure(authority?.session_expired, "completed_expired_session_not_found");
    const actor = { id: authority.actor_id, user_type: "noisia_internal" as const };
    const scope = { workspace_id: authority.workspace_id, run_key: authority.run_key,
      candidate_key: authority.candidate_key, actor, queryable: scoped };
    const original = await loadSignalTopicEvaluationV2CandidateDetail(scope);
    ensure(original.candidate.revision === 1 && original.refinement.status === "available"
      && original.refinement.proposal.proposal_digest === EXACT_PROPOSAL
      && !original.refinement.proposal.is_stale, "initial_reader_mismatch");
    const proposal = original.refinement.proposal;
    for (const wrongScope of [{ workspace_id: "00000000-0000-4000-8000-000000000000" },
      { run_key: "lab2s.nonexistent.run" }, { candidate_key: "lab2s.nonexistent.candidate" }]) {
      let rejected = false;
      try { await loadSignalTopicEvaluationV2CandidateDetail({ ...scope, ...wrongScope }); }
      catch (error) { rejected = error instanceof Error && error.message === "topic_evaluation_v2_candidate_not_found"
        && "status" in error && error.status === 404; }
      ensure(rejected, "wrong_scope_read_not_rejected");
    }
    // The existing core is typed as pg.PoolClient but uses only query/release; the fixed local
    // psql adapter supplies exactly those operations, never an arbitrary connection target.
    const corePool = { connect: async () => scoped } as unknown as
      Parameters<typeof reviewSignalTopicEvaluationV2Candidate>[0]["pool"];
    const commandScope = { run_key: authority.run_key, candidate_key: authority.candidate_key };
    const execute = async (command: SignalTopicEvaluationV2CandidateCommand, suffix: string) => {
      const result = await reviewSignalTopicEvaluationV2Candidate({ pool: corePool,
        workspace_id: authority.workspace_id, actor, idempotency_key: `lab2s.rollback.editor.${suffix}`, command });
      // Exercise the real deferred cohort constraints as a commit would, then restore their
      // deferred mode for the next existing-core append-only operation in this transaction.
      await outer.query("SET CONSTRAINTS ALL IMMEDIATE");
      await outer.query("SET CONSTRAINTS ALL DEFERRED");
      return result;
    };
    ensure(Array.isArray(original.candidate.inclusion) && Array.isArray(original.candidate.exclusion),
      "candidate_values_invalid");
    const saved = await execute({ ...commandScope, action: "save", expected_revision: 1,
      state_token: original.candidate.state_token, values: { title: proposal.display_name,
        description: proposal.description, inclusion: original.candidate.inclusion as string[],
        exclusion: original.candidate.exclusion as string[] } }, "save");
    const edited = await loadSignalTopicEvaluationV2CandidateDetail(scope);
    ensure(saved.revision === 2 && edited.candidate.revision === 2
      && edited.candidate.title === proposal.display_name && edited.candidate.description === proposal.description
      && edited.refinement.status === "available" && edited.refinement.proposal.is_stale
      && edited.refinement.proposal.proposal_digest === EXACT_PROPOSAL, "saved_reader_mismatch");
    const undone = await execute({ ...commandScope, action: "undo", expected_revision: 2,
      state_token: edited.candidate.state_token, target_revision: 1 }, "undo");
    const restoredWording = await loadSignalTopicEvaluationV2CandidateDetail(scope);
    ensure(undone.revision === 3 && restoredWording.candidate.revision === 3
      && restoredWording.candidate.title === original.candidate.title
      && restoredWording.candidate.description === original.candidate.description
      && JSON.stringify(restoredWording.candidate.inclusion) === JSON.stringify(original.candidate.inclusion)
      && JSON.stringify(restoredWording.candidate.exclusion) === JSON.stringify(original.candidate.exclusion),
    "undo_did_not_restore_original");
    const rejected = await execute({ ...commandScope, action: "reject", expected_revision: 3,
      state_token: restoredWording.candidate.state_token }, "reject");
    const rejectedDetail = await loadSignalTopicEvaluationV2CandidateDetail(scope);
    ensure(rejected.revision === 4 && rejectedDetail.candidate.review_state === "rejected", "reject_mismatch");
    const restored = await execute({ ...commandScope, action: "restore", expected_revision: 4,
      state_token: rejectedDetail.candidate.state_token }, "restore");
    const restoredDetail = await loadSignalTopicEvaluationV2CandidateDetail(scope);
    ensure(restored.revision === 5 && restoredDetail.candidate.review_state === "pending"
      && restoredDetail.candidate.title === original.candidate.title
      && restoredDetail.candidate.description === original.candidate.description, "restore_mismatch");
    const during = await snapshot(scoped);
    ensure(during.source_digest === before.source_digest && during.model_digest === before.model_digest
      && during.refinement_digest === before.refinement_digest && during.editorial_revisions === 4
      && during.review_operations === 4 && during.review_events === 4
      && during.adopted === 0 && during.published === 0 && during.serving === 0, "protected_state_changed");
    proofCompleted = true;
  } catch (error) {
    proofError = error;
  } finally {
    // ON_ERROR_STOP may already have disconnected psql; disconnect itself rolls back PostgreSQL.
    // A fresh connection below verifies the actual final state in either case.
    try { await outer.query("ROLLBACK"); } catch { /* verify rollback with a fresh connection */ }
    outer.release();
  }
  const after = await snapshot(pool);
  ensure(JSON.stringify(after) === JSON.stringify(before), "rollback_reconciliation_failed");
  if (proofError) throw proofError;
  ensure(proofCompleted && nestedTransactionsSuppressed === 8, "transaction_proof_incomplete");
  return { status: "pass", contract_version: "signal-topic-candidate-refinement-editor-local-proof-v1",
    proof: { fixed_local_host_verified: true, expired_session_proposal_readable: true,
      wrong_scope_reads_not_found: 3, saved_revision: 2, saved_proposal_stale: true,
      undo_revision: 3, original_wording_restored: true, reject_revision: 4, restore_revision: 5,
      source_model_proposal_unchanged: true, deferred_constraints_verified: true,
      outer_rollback_reconciled: true },
    final_counts: { candidates: after.candidates, refinement_proposals: after.proposals,
      editorial_revisions: after.editorial_revisions, review_operations: after.review_operations,
      review_events: after.review_events },
    effects: { provider_calls: 0, persistent_writes: 0, migration: 0, remote: 0,
      adoption: 0, publication: 0, serving: 0 }, evidence_digest: signalTopicEvaluationDigestV2({ before, after }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  proveSignalTopicCandidateRefinementEditorLocalV1(process.env).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    const message = error instanceof Error && /^topic_refinement_editor_proof_[a-z_]+$/u.test(error.message)
      ? error.message : "topic_refinement_editor_proof_failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
