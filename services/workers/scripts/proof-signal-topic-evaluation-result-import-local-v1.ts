/** Portable-result PostgreSQL proof. DDL/import/editorial writes share one outer transaction;
 * PostgreSQL rollback removes all of them. No new clone or remote target is supported. */
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { importSignalTopicEvaluationV2HistoricalResult, loadSignalTopicEvaluationV2CandidateDetail,
  reviewSignalTopicEvaluationV2Candidate, validateSignalTopicEvaluationV2HistoricalResultArtifact } from "@noisia/db";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { verifySignalTopicResultExportSourceLocalV1 } from "./export-signal-topic-evaluation-result-local-v1";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const ARTIFACT_DIRECTORY = resolve(ROOT, ".data/signal-topic-evaluation/lab-2u");
const CONFIRMATION = "PROVE_PORTABLE_TOPIC_RESULT_IMPORT_WITH_OUTER_ROLLBACK";
const MIGRATION_NAME = "0122_signal_topic_evaluation_v2_historical_result_import.sql";
type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
  rows: T[]; rowCount: number | null }> };

function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`topic_result_import_proof_${code}`);
}

async function readArtifact(path: string) {
  ensure(dirname(path) === ARTIFACT_DIRECTORY && /^historical-result-[0-9a-f]{64}\.json$/u.test(basename(path)),
    "artifact_path_invalid");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    ensure(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600
      && stat.uid === process.getuid?.() && stat.size <= 262_144, "artifact_custody_invalid");
    const artifact = validateSignalTopicEvaluationV2HistoricalResultArtifact(JSON.parse(await file.readFile("utf8")));
    const digest = signalTopicEvaluationDigestV2(artifact);
    ensure(basename(path) === `historical-result-${digest.slice(7)}.json`, "artifact_digest_mismatch");
    return { artifact, digest };
  } finally { await file.close(); }
}

async function baseline(queryable: Queryable) {
  const tables = ["signal_topic_evaluation_v2_snapshots", "signal_topic_evaluation_v2_clusters",
    "signal_topic_evaluation_v2_execution_authorizations", "signal_topic_evaluation_v2_execution_outbox",
    "signal_topic_evaluation_v2_cluster_memberships", "signal_topic_evaluation_v2_runs",
    "signal_topic_evaluation_v2_model_turns", "signal_topic_evaluation_v2_retrievals",
    "signal_topic_evaluation_v2_retrieval_evidence", "signal_topic_evaluation_v2_candidates",
    "signal_topic_evaluation_v2_candidate_revisions", "signal_topic_evaluation_v2_candidate_evidence",
    "signal_topic_evaluation_v2_rankings", "signal_topic_evaluation_v2_candidate_refinement_proposals",
    "signal_topic_evaluation_v2_candidate_editorial_revisions", "signal_topic_evaluation_v2_candidate_review_operations",
    "signal_topic_evaluation_v2_candidate_review_events"];
  const row = (await queryable.query<{ state_digest: string; import_plane_absent: boolean;
    candidates: number; proposals: number; editorials: number; ledger: number }>(`SELECT
    signal_semantic_context_digest_v1(jsonb_build_array(${tables.map((table) =>
      `(SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM ${table} row)`
    ).join(",")})::text) state_digest,
    to_regclass('public.signal_topic_evaluation_v2_result_import_receipts') IS NULL
      AND to_regclass('public.signal_topic_evaluation_v2_archived_refinements') IS NULL import_plane_absent,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_refinement_proposals) proposals,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_editorial_revisions) editorials,
    (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger) ledger`)).rows[0];
  ensure(row, "baseline_missing");
  return row;
}

async function importCounts(queryable: Queryable) {
  return (await queryable.query<{ receipts: number; runs: number; candidates: number;
    archived: number; outbox: number; authorities: number }>(`SELECT
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_result_import_receipts) receipts,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_runs) runs,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_archived_refinements) archived,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_outbox) outbox,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations) authorities`)).rows[0];
}

export async function proofSignalTopicEvaluationResultImportLocalV1(environment: NodeJS.ProcessEnv) {
  ensure(environment.NOISIA_RUNTIME_PROFILE === "local_disposable_lab_v1"
    && environment.NOISIA_TOPIC_RESULT_IMPORT_PROOF_ENABLED === "true"
    && environment.NOISIA_TOPIC_RESULT_IMPORT_PROOF_CONFIRMATION === CONFIRMATION, "disabled");
  const { artifact, digest } = await readArtifact(resolve(environment.NOISIA_TOPIC_RESULT_IMPORT_ARTIFACT_PATH ?? ""));
  const { pool } = await verifySignalTopicResultExportSourceLocalV1();
  const migration = await readFile(resolve(ROOT, "infrastructure/db/migrations", MIGRATION_NAME), "utf8");
  const migrationDigest = `sha256:${createHash("sha256").update(migration).digest("hex")}`;
  const before = await baseline(pool);
  ensure(before.import_plane_absent && before.candidates === 10 && before.proposals === 1
    && before.editorials === 0, "baseline_not_pristine");
  const outer = await pool.connect();
  let error: unknown;
  let completed = false;
  try {
    await outer.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    // The fixed psql adapter binds this trusted local file as a base64 string expression. SPI
    // executes its DDL in this same transaction, never another connection or persistent migration.
    await outer.query("DO $lab2u_migration$ BEGIN EXECUTE $1; END $lab2u_migration$", [migration]);
    const authority = (await outer.query<{ workspace_id: string; actor_id: string }>(`SELECT
      workspace_id::text,created_by_user_id::text actor_id FROM signal_topic_evaluation_v2_snapshots
      WHERE snapshot_digest=$1 AND rights_digest=$2 AND semantic_context_authority_digest=$3`,
    [artifact.snapshot.snapshot_digest, artifact.snapshot.rights_digest,
      artifact.snapshot.semantic_context_authority_digest])).rows[0];
    ensure(authority, "target_snapshot_missing");
    const actor = { id: authority.actor_id, user_type: "noisia_internal" as const };
    const rejectedWithoutWrites = async (args: Parameters<typeof importSignalTopicEvaluationV2HistoricalResult>[0],
      expectedCode: string) => {
      const previous = await importCounts(outer);
      let code: string | undefined;
      try { await importSignalTopicEvaluationV2HistoricalResult(args); }
      catch (caught) { code = caught instanceof Error ? caught.message : undefined; }
      ensure(code === expectedCode, "negative_import_unexpected_result");
      ensure(JSON.stringify(await importCounts(outer)) === JSON.stringify(previous), "negative_import_changed_counts");
    };
    const baseImport = { client: outer, workspace_id: authority.workspace_id, actor,
      idempotency_key: "lab2u.rollback.result.import", expected_artifact_digest: digest, artifact };
    await rejectedWithoutWrites({ ...baseImport, expected_artifact_digest: `sha256:${"0".repeat(64)}` },
      "topic_result_import_artifact_digest_mismatch");
    await rejectedWithoutWrites({ ...baseImport, workspace_id: "00000000-0000-0000-0000-000000000000" },
      "topic_result_import_forbidden");
    for (const field of ["snapshot_digest", "rights_digest"] as const) {
      const changed = structuredClone(artifact);
      changed.snapshot[field] = `sha256:${"0".repeat(64)}`;
      await rejectedWithoutWrites({ ...baseImport, artifact: changed,
        expected_artifact_digest: signalTopicEvaluationDigestV2(changed) }, "topic_result_import_snapshot_mismatch");
    }
    const imported = await importSignalTopicEvaluationV2HistoricalResult({ client: outer,
      workspace_id: authority.workspace_id, actor, idempotency_key: "lab2u.rollback.result.import",
      expected_artifact_digest: digest, artifact });
    ensure(imported.run_id !== artifact.source_run.id && imported.run_key !== artifact.source_run.run_key
      && !imported.replayed, "destination_identity_not_distinct");
    await outer.query("SET CONSTRAINTS ALL IMMEDIATE");
    await outer.query("SET CONSTRAINTS ALL DEFERRED");
    const counts = (await outer.query<{ candidates: number; revisions: number; links: number; ranks: number;
      collisions: number; turns: number; retrievals: number; provider_calls: number; reserved: string;
      settled: string; provider_disabled: boolean; authority_absent: boolean; outbox: number;
      adoption: number; publication: number; serving: number }>(`SELECT
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid) candidates,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_revisions WHERE run_id=$1::uuid) revisions,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence evidence
        JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=evidence.candidate_id
        WHERE candidate.run_id=$1::uuid) links,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings WHERE run_id=$1::uuid) ranks,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates
        WHERE run_id=$1::uuid AND id=ANY($2::uuid[])) collisions,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns WHERE run_id=$1::uuid) turns,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals WHERE run_id=$1::uuid) retrievals,
      run.provider_call_count provider_calls,run.reserved_micro_usd::text reserved,run.settled_micro_usd::text settled,
      NOT run.provider_execution_enabled provider_disabled,run.execution_authorization_id IS NULL authority_absent,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_outbox WHERE run_id=run.id) outbox,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=run.id AND adopted) adoption,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=run.id AND published) publication,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE run_id=run.id AND serving) serving
      FROM signal_topic_evaluation_v2_runs run WHERE run.id=$1::uuid`,
    [imported.run_id, artifact.candidates.map((candidate) => candidate.id)])).rows[0];
    ensure(counts?.candidates === 10 && counts.revisions === 10 && counts.links === 30
      && counts.ranks === 10 && counts.collisions === 0 && counts.turns === 12 && counts.retrievals === 11
      && counts.provider_calls === 0 && counts.reserved === "0" && counts.settled === "0"
      && counts.provider_disabled && counts.authority_absent && counts.outbox === 0
      && counts.adoption === 0 && counts.publication === 0 && counts.serving === 0, "imported_counts_mismatch");
    const conflicting = structuredClone(artifact);
    // A still-valid historical timestamp changes the artifact, not its semantic/model payload.
    conflicting.source_run.completed_at = new Date(Date.parse(artifact.source_run.completed_at) + 1000).toISOString();
    await rejectedWithoutWrites({ ...baseImport, artifact: conflicting,
      expected_artifact_digest: signalTopicEvaluationDigestV2(conflicting) }, "topic_result_import_idempotency_conflict");
    // Existing editorial core requires a PoolClient; preserve its query/release shape while
    // suppressing only its nested transaction boundaries. The outer connection owns rollback.
    const scoped = { query: async <T = Record<string, unknown>>(sql: string, values?: unknown[]) => {
      if (/^\s*(?:BEGIN(?:\s+ISOLATION\s+LEVEL\s+SERIALIZABLE)?|COMMIT|ROLLBACK)\s*;?\s*$/iu.test(sql)) {
        return { rows: [] as T[], rowCount: null };
      }
      return outer.query<T>(sql, values);
    }, release() { /* outer-owned */ } };
    const corePool = { connect: async () => scoped } as unknown as
      Parameters<typeof reviewSignalTopicEvaluationV2Candidate>[0]["pool"];
    let proposalCount = 0;
    let edited = false;
    for (const sourceCandidate of artifact.candidates) {
      const scope = { queryable: scoped, workspace_id: authority.workspace_id, actor,
        run_key: imported.run_key, candidate_key: sourceCandidate.candidate_key };
      const detail = await loadSignalTopicEvaluationV2CandidateDetail(scope);
      ensure(detail.candidate.revision === 1 && detail.candidate.review_state === "pending", "imported_detail_invalid");
      if (detail.refinement.status !== "available") continue;
      proposalCount += 1;
      ensure(detail.refinement.proposal.proposal_digest === artifact.refinement.source_proposal_digest
        && !detail.refinement.proposal.is_stale, "archived_refinement_mismatch");
      const proposal = detail.refinement.proposal;
      const commandScope = { run_key: imported.run_key, candidate_key: sourceCandidate.candidate_key };
      const save = await reviewSignalTopicEvaluationV2Candidate({ pool: corePool,
        workspace_id: authority.workspace_id, actor, idempotency_key: "lab2u.rollback.imported.save",
        command: { ...commandScope, action: "save", expected_revision: 1, state_token: detail.candidate.state_token,
          values: { title: proposal.display_name, description: proposal.description,
            inclusion: detail.candidate.inclusion as string[], exclusion: detail.candidate.exclusion as string[] } } });
      await outer.query("SET CONSTRAINTS ALL IMMEDIATE");
      await outer.query("SET CONSTRAINTS ALL DEFERRED");
      const changed = await loadSignalTopicEvaluationV2CandidateDetail(scope);
      ensure(save.revision === 2 && changed.candidate.title === proposal.display_name
        && changed.refinement.status === "available" && changed.refinement.proposal.is_stale, "save_failed");
      const undo = await reviewSignalTopicEvaluationV2Candidate({ pool: corePool,
        workspace_id: authority.workspace_id, actor, idempotency_key: "lab2u.rollback.imported.undo",
        command: { ...commandScope, action: "undo", expected_revision: 2, state_token: changed.candidate.state_token,
          target_revision: 1 } });
      await outer.query("SET CONSTRAINTS ALL IMMEDIATE");
      await outer.query("SET CONSTRAINTS ALL DEFERRED");
      const restored = await loadSignalTopicEvaluationV2CandidateDetail(scope);
      ensure(undo.revision === 3 && restored.candidate.title === detail.candidate.title
        && restored.candidate.description === detail.candidate.description, "undo_failed");
      edited = true;
    }
    ensure(proposalCount === 1 && edited, "refinement_reader_or_editor_missing");
    const replay = await importSignalTopicEvaluationV2HistoricalResult({ client: outer,
      workspace_id: authority.workspace_id, actor, idempotency_key: "lab2u.rollback.result.import",
      expected_artifact_digest: digest, artifact });
    ensure(replay.replayed && replay.run_id === imported.run_id, "replay_mismatch");
    completed = true;
  } catch (caught) { error = caught; }
  finally {
    try { await outer.query("ROLLBACK"); } catch { /* ON_ERROR_STOP disconnect also rolls back. */ }
    outer.release();
  }
  const after = await baseline(pool);
  ensure(JSON.stringify(after) === JSON.stringify(before), "outer_rollback_mismatch");
  if (error) throw error;
  ensure(completed, "incomplete");
  return { status: "pass", contract_version: "signal-topic-evaluation-result-import-local-proof-v1",
    artifact_digest: digest, migration_digest: migrationDigest,
    proof: { imported_candidates: 10, imported_model_turns: 12, imported_retrievals: 11,
      imported_evidence_links: 30, imported_rankings: 10,
      imported_refinements: 1, destination_ids_distinct: true, detail_reader: true,
      save_undo: true, idempotent_replay: true, rejected_imports_without_writes: 5,
      provider_disabled_zero_cost_no_authority_or_outbox: true,
      deferred_constraints: true, outer_rollback: true },
    final_counts: { candidates: after.candidates, proposals: after.proposals, editorial_revisions: after.editorials },
    effects: { persistent_writes: 0, provider_calls: 0, remote: 0, adoption: 0, publication: 0, serving: 0 } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  proofSignalTopicEvaluationResultImportLocalV1(process.env).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error && /^topic_result_import_proof_[a-z_]+$/u.test(error.message)
      ? error.message : "topic_result_import_proof_failed"}\n`);
    process.exitCode = 1;
  });
}
