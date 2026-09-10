/** Read-only export of one completed local experiment into a bounded portable result package.
 * No raw mention, credential, provider prompt, or response body is exported. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateSignalTopicEvaluationV2HistoricalResultArtifact,
  type SignalTopicEvaluationV2HistoricalResultArtifact } from "@noisia/db";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createSignalTopicEvaluationLabDockerWritePoolV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1 } from
  "./signal-topic-candidate-refinement-successor-host-provenance-v1";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const RESULT_EXPORT_SOURCE_CLONE = "noisia_topic_eval_lab_20260906_1cd623f0d548";
export const RESULT_EXPORT_SOURCE_RUN = "topic-v2-lab-run-ee9dcedca1342d414d6646fd";
const PARENT_DIGEST = "sha256:1a473971787650acc71f1631e0e30940b81397f181ae89074e1dee591eac960b";
const PROPOSAL_DIGEST = "sha256:85854b9ab4c12dee9396dc2ef05d24729281b31da2943bae561d14d7418d236c";
const CONFIRMATION = "EXPORT_COMPLETED_LOCAL_TOPIC_RESULT_WITHOUT_MENTION_TEXT";
const MAX_ARTIFACT_BYTES = 262_144;
type Queryable = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
  rows: T[]; rowCount: number | null }> };

function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`topic_result_export_${code}`);
}

const OUTPUT_DIGEST_SQL = `signal_semantic_context_digest_json_v2(jsonb_build_object(
  'authorization',(SELECT jsonb_agg(to_jsonb(auth) ORDER BY auth.id) FROM signal_topic_evaluation_v2_execution_authorizations auth),
  'run',(SELECT jsonb_agg(to_jsonb(run) ORDER BY run.id) FROM signal_topic_evaluation_v2_runs run),
  'model_turn',(SELECT jsonb_agg(to_jsonb(turn) ORDER BY turn.run_id,turn.turn_index) FROM signal_topic_evaluation_v2_model_turns turn),
  'retrieval',(SELECT jsonb_agg(to_jsonb(retrieval) ORDER BY retrieval.id) FROM signal_topic_evaluation_v2_retrievals retrieval),
  'retrieval_evidence',(SELECT jsonb_agg(to_jsonb(evidence) ORDER BY evidence.retrieval_id,evidence.evidence_ref) FROM signal_topic_evaluation_v2_retrieval_evidence evidence),
  'candidate',(SELECT jsonb_agg(to_jsonb(candidate) ORDER BY candidate.id) FROM signal_topic_evaluation_v2_candidates candidate),
  'candidate_revision',(SELECT jsonb_agg(to_jsonb(revision) ORDER BY revision.id) FROM signal_topic_evaluation_v2_candidate_revisions revision),
  'candidate_evidence',(SELECT jsonb_agg(to_jsonb(evidence) ORDER BY evidence.candidate_id,evidence.retrieval_id,evidence.evidence_ref) FROM signal_topic_evaluation_v2_candidate_evidence evidence),
  'ranking',(SELECT jsonb_agg(to_jsonb(ranking) ORDER BY ranking.candidate_id) FROM signal_topic_evaluation_v2_rankings ranking)
))`;

export async function verifySignalTopicResultExportSourceLocalV1() {
  const proof = await verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1();
  ensure(proof.receipt.clone_name === RESULT_EXPORT_SOURCE_CLONE
    && proof.receipt.parent_output_digest === PARENT_DIGEST, "source_receipt_mismatch");
  const pool = createSignalTopicEvaluationLabDockerWritePoolV2(proof.receipt);
  const anchored = (await pool.query<{ database_name: string; system_identifier: string; anchors: number }>(
    `SELECT current_database() database_name,(pg_control_system()).system_identifier::text system_identifier,
      (SELECT count(*)::int FROM noisia_topic_evaluation_lab.host_receipt_anchor
        WHERE marker_id AND clone_name=current_database() AND host_receipt_digest=$1
          AND container_identity_digest=$2) anchors`, [proof.receipt.receipt_digest,
      signalTopicEvaluationDigestV2({ container_id: proof.container.container_id,
        image_id: proof.container.image_id })])).rows[0];
  ensure(anchored?.database_name === RESULT_EXPORT_SOURCE_CLONE
    && anchored.system_identifier === proof.receipt.server_system_identifier && anchored.anchors === 1,
  "source_database_anchor_mismatch");
  return { ...proof, pool };
}

async function extract(queryable: Queryable,
  receipt: Awaited<ReturnType<typeof verifySignalTopicResultExportSourceLocalV1>>["receipt"]
): Promise<SignalTopicEvaluationV2HistoricalResultArtifact> {
  const provenance = (await queryable.query<{ snapshot_id: string; workspace_id: string;
    snapshot_digest: string; rights_digest: string; semantic_context_authority_digest: string;
    artifact_binding_digest: string; membership_binding_digest: string;
    snapshot_recomputed: string; membership_recomputed: string; semantic_recomputed: string; rights_packet_valid: boolean;
    clusters: number; members: number; assigned: number; outliers: number; parent_digest: string }>(
    `SELECT snapshot.id::text snapshot_id,snapshot.workspace_id::text,snapshot.snapshot_digest,
      snapshot.rights_digest,snapshot.semantic_context_authority_digest,snapshot.artifact_binding_digest,
      snapshot.membership_binding_digest,
      signal_semantic_context_digest_json_v2(jsonb_build_object(
        'contract_version','signal-topic-evaluation-full-evidence-v2',
        'import_contract_version',snapshot.import_contract_version,'source_run_key',snapshot.source_run_key,
        'workspace_id',snapshot.workspace_id::text,'snapshot_key',snapshot.snapshot_key,
        'source_manifest_digest',snapshot.source_manifest_digest,
        'packet_source_manifest_digest',snapshot.packet_source_manifest_digest,
        'source_export_digest',snapshot.source_export_digest,'source_assignment_digest',snapshot.source_assignment_digest,
        'source_result_digest',snapshot.source_result_digest,'source_packet_file_digest',snapshot.source_packet_file_digest,
        'packet_digest',snapshot.packet_digest,'rights_digest',snapshot.rights_digest,
        'semantic_context_authority_digest',snapshot.semantic_context_authority_digest,
        'artifact_binding_digest',snapshot.artifact_binding_digest,
        'membership_binding_digest',snapshot.membership_binding_digest)) snapshot_recomputed,
      (SELECT 'sha256:'||encode(digest(convert_to(string_agg(assignment_index::text||'|'||
        assignment_label::text||'|'||source_record_key||'|'||canonical_binding_digest,E'\\n'
        ORDER BY assignment_index),'UTF8'),'sha256'),'hex') FROM signal_topic_evaluation_v2_cluster_memberships
        WHERE snapshot_id=snapshot.id) membership_recomputed,
      signal_topic_evaluation_v2_semantic_authority_digest_v1(snapshot.semantic_context_generation_id) semantic_recomputed,
      EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets packet
        JOIN signal_semantic_context_generations generation ON generation.id=snapshot.semantic_context_generation_id
        WHERE packet.artifact_id=snapshot.packet_artifact_id AND packet.workspace_id=snapshot.workspace_id
          AND packet.packet_digest=snapshot.packet_digest AND packet.rights_digest=snapshot.rights_digest
          AND packet.packet_file_digest=snapshot.source_packet_file_digest
          AND packet.source_manifest_digest=snapshot.packet_source_manifest_digest
          AND packet.proposal_count=115 AND packet.modeling_denominator=21195
          AND generation.workspace_id=snapshot.workspace_id AND generation.status='draft'
          AND NOT EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets newer
            WHERE newer.workspace_id=packet.workspace_id AND newer.registered_at>packet.registered_at)
          AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations newer
            WHERE newer.workspace_id=generation.workspace_id AND newer.supersedes_generation_id=generation.id)
      ) rights_packet_valid,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_clusters WHERE snapshot_id=snapshot.id) clusters,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=snapshot.id) members,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships
        WHERE snapshot_id=snapshot.id AND assignment_label>=0) assigned,
      (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships
        WHERE snapshot_id=snapshot.id AND assignment_label=-1) outliers,
      ${OUTPUT_DIGEST_SQL} parent_digest
    FROM signal_topic_evaluation_v2_snapshots snapshot
    JOIN signal_topic_evaluation_v2_runs run ON run.snapshot_id=snapshot.id
    WHERE run.run_key=$1 AND run.status='completed' AND snapshot.state='frozen'`, [RESULT_EXPORT_SOURCE_RUN])).rows[0];
  ensure(provenance && provenance.parent_digest === PARENT_DIGEST && provenance.rights_packet_valid
    && provenance.snapshot_digest === receipt.source_snapshot_digest
    && provenance.snapshot_recomputed === provenance.snapshot_digest
    && provenance.artifact_binding_digest === receipt.source_artifact_binding_digest
    && provenance.membership_binding_digest === receipt.source_membership_binding_digest
    && provenance.membership_recomputed === provenance.membership_binding_digest
    && provenance.semantic_recomputed === provenance.semantic_context_authority_digest
    && provenance.clusters === 116 && provenance.members === 21_195
    && provenance.assigned === 11_186 && provenance.outliers === 10_009, "source_provenance_mismatch");
  const sourceRun = (await queryable.query<Record<string, unknown>>(`SELECT id::text,run_key,flight_card,
    flight_card_digest,provider_call_count,reserved_micro_usd::text,settled_micro_usd::text,
    model_turn_count,tool_call_count,total_input_tokens,total_output_tokens,total_tool_result_bytes,
    output_digest,created_at::text,completed_at::text
    FROM signal_topic_evaluation_v2_runs WHERE run_key=$1 AND status='completed'`, [RESULT_EXPORT_SOURCE_RUN])).rows[0];
  ensure(sourceRun && typeof sourceRun.id === "string", "source_run_missing");
  const runId = sourceRun.id;
  const modelTurns = (await queryable.query(`SELECT turn_index,turn_kind,input_digest,output_digest,
    input_tokens,output_tokens,created_at::text FROM signal_topic_evaluation_v2_model_turns
    WHERE run_id=$1::uuid ORDER BY turn_index`, [runId])).rows;
  const retrievals = (await queryable.query(`SELECT id::text,retrieval_index,operation,tool_input_digest,
    result_digest,result_bytes,created_at::text FROM signal_topic_evaluation_v2_retrievals
    WHERE run_id=$1::uuid ORDER BY retrieval_index`, [runId])).rows;
  const retrievalEvidence = (await queryable.query(`SELECT evidence.retrieval_id::text,evidence.member_ref,
    evidence.evidence_ref FROM signal_topic_evaluation_v2_retrieval_evidence evidence
    JOIN signal_topic_evaluation_v2_retrievals retrieval ON retrieval.id=evidence.retrieval_id
    WHERE retrieval.run_id=$1::uuid ORDER BY retrieval.retrieval_index,evidence.evidence_ref`, [runId])).rows;
  const candidates = (await queryable.query(`SELECT id::text,candidate_key,candidate_digest,source_cluster_keys,
    created_at::text FROM signal_topic_evaluation_v2_candidates WHERE run_id=$1::uuid
      AND status='pending' AND NOT adopted AND NOT published AND NOT serving ORDER BY created_at,id`, [runId])).rows;
  const candidateRevisions = (await queryable.query(`SELECT revision.id::text,revision.candidate_id::text,
    revision.payload,revision.payload_digest,revision.created_at::text
    FROM signal_topic_evaluation_v2_candidate_revisions revision
    JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=revision.candidate_id
    WHERE candidate.run_id=$1::uuid AND revision.revision=1 ORDER BY revision.created_at,revision.id`, [runId])).rows;
  const candidateEvidence = (await queryable.query(`SELECT evidence.candidate_id::text,evidence.retrieval_id::text,
    evidence.evidence_ref,evidence.explanation_digest FROM signal_topic_evaluation_v2_candidate_evidence evidence
    JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=evidence.candidate_id
    WHERE candidate.run_id=$1::uuid ORDER BY candidate.candidate_key,evidence.evidence_ref`, [runId])).rows;
  const rankings = (await queryable.query(`SELECT candidate_id::text,rank,ranking_reason,ranking_digest,created_at::text
    FROM signal_topic_evaluation_v2_rankings WHERE run_id=$1::uuid ORDER BY rank`, [runId])).rows;
  const refinement = (await queryable.query<Record<string, unknown>>(`SELECT proposal.candidate_id::text,
    session.id::text source_session_id,session.session_digest source_session_digest,
    proposal.id::text source_proposal_id,proposal.proposal_digest source_proposal_digest,
    session.candidate_revision source_revision,session.candidate_version_digest source_version_digest,
    session.brand_os_authority_digest source_brand_os_authority_digest,
    session.created_at::text session_created_at,session.expires_at::text session_expires_at,
    proposal.created_at::text,proposal.display_name,proposal.description,proposal.rationale,
    proposal.evidence_refs,proposal.related_candidate_keys,proposal.recommendation
    FROM signal_topic_evaluation_v2_candidate_refinement_proposals proposal
    JOIN signal_topic_evaluation_v2_candidate_refinement_sessions session ON session.id=proposal.session_id
    JOIN signal_topic_evaluation_v2_candidate_refinement_flights flight ON flight.session_id=session.id
    JOIN signal_topic_evaluation_v2_candidate_refinement_flight_terminal_receipts terminal
      ON terminal.flight_id=flight.id AND terminal.terminal_status='completed'
    WHERE proposal.run_id=$1::uuid AND proposal.proposal_digest=$2`, [runId, PROPOSAL_DIGEST])).rows[0];
  ensure(refinement && Array.isArray(refinement.evidence_refs), "completed_refinement_missing");
  const refinementEvidence = (await queryable.query<{ member_ref: string; evidence_ref: string }>(`SELECT
    membership.member_ref,signal_semantic_context_digest_json_v2(jsonb_build_object(
      'snapshot',snapshot.snapshot_digest,'member_ref',membership.member_ref,
      'source',membership.source_record_digest)) evidence_ref
    FROM signal_topic_evaluation_v2_cluster_memberships membership
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=membership.snapshot_id
    WHERE snapshot.id=$1::uuid AND signal_semantic_context_digest_json_v2(jsonb_build_object(
      'snapshot',snapshot.snapshot_digest,'member_ref',membership.member_ref,
      'source',membership.source_record_digest))=ANY($2::text[])
      AND EXISTS(SELECT 1 FROM signal_topic_evaluation_v2_candidate_refinement_navigation_traces trace
        WHERE trace.session_id=$3::uuid AND trace.evidence_refs&&ARRAY[signal_semantic_context_digest_json_v2(
          jsonb_build_object('snapshot',snapshot.snapshot_digest,'member_ref',membership.member_ref,
          'source',membership.source_record_digest))])
    ORDER BY evidence_ref`, [provenance.snapshot_id, refinement.evidence_refs, refinement.source_session_id])).rows;
  ensure(modelTurns.length === 12 && retrievals.length === 11 && retrievalEvidence.length === 30
    && candidates.length === 10 && candidateRevisions.length === 10 && candidateEvidence.length === 30
    && rankings.length === 10 && refinementEvidence.length === refinement.evidence_refs.length
    && sourceRun.provider_call_count === 12 && sourceRun.model_turn_count === 12
    && sourceRun.tool_call_count === 11, "source_counts_mismatch");
  // PostgreSQL text retains microseconds but uses a space and a short UTC offset. Normalize
  // only that representation, without Date's millisecond rounding of historical timestamps.
  for (const row of [sourceRun, ...modelTurns, ...retrievals, ...candidates, ...candidateRevisions,
    ...rankings, refinement]) {
    for (const key of ["created_at", "completed_at", "session_created_at", "session_expires_at"]) {
      if (typeof row[key] === "string") row[key] = row[key].replace(" ", "T").replace(/([+-]\d{2})$/u, "$1:00");
    }
  }
  const artifact = validateSignalTopicEvaluationV2HistoricalResultArtifact({
    contract_version: "signal-topic-evaluation-v2-historical-result-import-v1",
    snapshot: { snapshot_digest: provenance.snapshot_digest, rights_digest: provenance.rights_digest,
      semantic_context_authority_digest: provenance.semantic_context_authority_digest,
      artifact_binding_digest: provenance.artifact_binding_digest,
      membership_binding_digest: provenance.membership_binding_digest },
    source_run: sourceRun, model_turns: modelTurns, retrievals, retrieval_evidence: retrievalEvidence,
    candidates, candidate_revisions: candidateRevisions, candidate_evidence: candidateEvidence, rankings,
    refinement: { ...refinement, evidence: refinementEvidence }
  });
  // The original writer awaited each base revision insert. Its distinct microsecond timestamps
  // recover the exact original candidate-array order; ordering by key would lose the final hash.
  ensure(new Set(artifact.candidate_revisions.map((row) => row.created_at)).size === 10,
    "original_output_order_ambiguous");
  const keys = new Map(artifact.candidates.map((candidate) => [candidate.id, candidate.candidate_key]));
  ensure(signalTopicEvaluationDigestV2({ contract_version: "signal-topic-evaluation-full-evidence-output-v2",
    candidates: artifact.candidate_revisions.map((row) => row.payload),
    ranking: artifact.rankings.map((row) => ({ rank: row.rank, candidate_key: keys.get(row.candidate_id),
      ranking_reason: row.ranking_reason })) }) === artifact.source_run.output_digest, "output_digest_mismatch");
  return artifact;
}

export async function exportSignalTopicEvaluationResultLocalV1(environment: NodeJS.ProcessEnv) {
  ensure(environment.NOISIA_RUNTIME_PROFILE === "local_disposable_lab_v1"
    && environment.NOISIA_TOPIC_RESULT_EXPORT_ENABLED === "true"
    && environment.NOISIA_TOPIC_RESULT_EXPORT_CONFIRMATION === CONFIRMATION, "disabled");
  const { receipt, pool } = await verifySignalTopicResultExportSourceLocalV1();
  const client = await pool.connect();
  let artifact: SignalTopicEvaluationV2HistoricalResultArtifact;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    artifact = await extract(client, receipt);
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* failed psql read already disconnected */ }
    client.release();
  }
  const artifactDigest = signalTopicEvaluationDigestV2(artifact);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  ensure(Buffer.byteLength(serialized, "utf8") <= MAX_ARTIFACT_BYTES, "artifact_too_large");
  const directory = resolve(ROOT, ".data/signal-topic-evaluation/lab-2u");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const artifactPath = resolve(directory, `historical-result-${artifactDigest.slice(7)}.json`);
  await writeFile(artifactPath, serialized, { mode: 0o600, flag: "wx" });
  return { artifact, artifact_path: artifactPath, artifact_digest: artifactDigest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportSignalTopicEvaluationResultLocalV1(process.env).then(({ artifact_path, artifact_digest }) => {
    process.stdout.write(`${JSON.stringify({ status: "pass", artifact_path, artifact_digest,
      counts: { candidates: 10, model_turns: 12, retrievals: 11, candidate_evidence: 30, ranks: 10,
        refinement_proposals: 1 }, effects: { source_writes: 0, provider_calls: 0, remote: 0 } })}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error && /^topic_result_export_[a-z_]+$/u.test(error.message)
      ? error.message : "topic_result_export_failed"}\n`);
    process.exitCode = 1;
  });
}
