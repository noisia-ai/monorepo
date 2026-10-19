import type { Pool } from "pg";

import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import {
  parseSignalTopicConsolidationRevisionV1,
  signalTopicConsolidationDigestV1,
  SignalTopicConsolidationContractError,
  type SignalTopicConsolidationDecisionV1,
  type SignalTopicEditorialConceptV1
} from "./signal-topic-consolidation";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = /^sha256:[0-9a-f]{64}$/u;
const fail = (code: string): never => { throw new SignalTopicConsolidationContractError(code); };
const field = (value: unknown, maxBytes: number): string =>
  typeof value === "string" && value.trim() === value && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maxBytes ? value : fail("topic_consolidation_edition_invalid");

/** One human edit creates a complete successor revision and a provider-free preview snapshot.
 * Decisions, group lineage and priority metadata are copied unchanged. Serving remains on
 * the prior snapshot until the user explicitly activates the successor.
 */
export async function editSignalTopicConsolidationConceptV1(args: {
  database: Pick<Pool, "connect">; workspace_id: string; actor_user_id: string;
  expected_revision_id: string; expected_revision_digest: string;
  concept_key: string; label: string; definition: string;
}): Promise<{ revision_id: string; revision: number; revision_digest: string; snapshot_id: string; snapshot_digest: string }> {
  if (!uuid.test(args.workspace_id) || !uuid.test(args.actor_user_id) || !uuid.test(args.expected_revision_id)
    || !digest.test(args.expected_revision_digest)) fail("topic_consolidation_edition_invalid");
  const conceptKey = field(args.concept_key, 256), label = field(args.label, 120), definition = field(args.definition, 500);
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`signal-taxonomy:${args.workspace_id}:topic`]);
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client,
      workspace_id: args.workspace_id, actor_user_id: args.actor_user_id, lock_authority: true });
    if (!capabilities.can_edit_topics || !capabilities.can_request_processing) fail("topic_consolidation_forbidden");
    const runRef = (await client.query<{ consolidation_run_id: string }>(`
      SELECT consolidation_run_id FROM signal_topic_consolidation_revisions
      WHERE id=$1::uuid AND workspace_id=$2::uuid`,[args.expected_revision_id,args.workspace_id])).rows[0];
    if (!runRef) throw new SignalTopicConsolidationContractError("topic_consolidation_edition_stale");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`topic-consolidation:${args.workspace_id}:${runRef.consolidation_run_id}:editorial`]);
    const current = (await client.query<{ id: string; revision: number; revision_digest: string; consolidation_run_id: string;
      source_engine_execution_id: string; status: string; run_status: string }>(`
      SELECT r.id,r.revision,r.revision_digest,r.consolidation_run_id,r.source_engine_execution_id,r.status,run.status run_status
      FROM signal_topic_consolidation_revisions r JOIN signal_topic_consolidation_runs run
        ON run.id=r.consolidation_run_id AND run.workspace_id=r.workspace_id
      WHERE r.id=$1::uuid AND r.workspace_id=$2::uuid FOR UPDATE OF r,run`,
    [args.expected_revision_id,args.workspace_id])).rows[0];
    if (!current || current.status !== "validated" || current.run_status !== "validated"
      || current.revision_digest !== args.expected_revision_digest)
      throw new SignalTopicConsolidationContractError("topic_consolidation_edition_stale");
    const concepts = (await client.query<SignalTopicEditorialConceptV1 & { metadata: Record<string, unknown> }>(`
      SELECT concept_key,kind,label,definition,locale,source,metadata
      FROM signal_topic_editorial_concepts WHERE revision_id=$1::uuid ORDER BY concept_key COLLATE "C"`,
    [current.id])).rows;
    const original = concepts.find(concept => concept.concept_key === conceptKey);
    if (!original) throw new SignalTopicConsolidationContractError("topic_consolidation_edition_concept_missing");
    if (original.label === label && original.definition === definition) fail("topic_consolidation_edition_unchanged");
    const decisions = (await client.query<SignalTopicConsolidationDecisionV1>(`
      SELECT g.group_key,d.disposition,c.concept_key,d.source,d.confidence,d.rationale
      FROM signal_topic_consolidation_decisions d JOIN signal_topic_atomic_groups g ON g.id=d.atomic_group_id
      LEFT JOIN signal_topic_editorial_concepts c ON c.id=d.concept_id
      WHERE d.revision_id=$1::uuid ORDER BY g.group_key COLLATE "C"`,[current.id])).rows;
    const nextConcepts = concepts.map(({ metadata: _metadata, ...concept }) => concept.concept_key === conceptKey
      ? { ...concept, label, definition, source: "human" as const } : concept);
    const body = { contract_version: "signal-topic-consolidation-revision-v1" as const,
      revision: current.revision + 1, concepts: nextConcepts, decisions };
    const next = parseSignalTopicConsolidationRevisionV1({ ...body,
      revision_digest: signalTopicConsolidationDigestV1(body) }, decisions.map(item => item.group_key));
    const inserted = (await client.query<{ id: string }>(`
      INSERT INTO signal_topic_consolidation_revisions(consolidation_run_id,workspace_id,source_engine_execution_id,
        revision,status,parent_revision_id,created_by_user_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,'draft',$5::uuid,$6::uuid) RETURNING id`,
    [current.consolidation_run_id,args.workspace_id,current.source_engine_execution_id,next.revision,current.id,args.actor_user_id])).rows[0];
    if (!inserted) throw new SignalTopicConsolidationContractError("topic_consolidation_edition_unavailable");
    await client.query(`INSERT INTO signal_topic_editorial_concepts(id,revision_id,consolidation_run_id,workspace_id,
      concept_key,kind,label,definition,locale,source,metadata)
      SELECT gen_random_uuid(),$1::uuid,consolidation_run_id,workspace_id,concept_key,kind,
        CASE WHEN concept_key=$3 THEN $4 ELSE label END,CASE WHEN concept_key=$3 THEN $5 ELSE definition END,
        locale,CASE WHEN concept_key=$3 THEN 'human' ELSE source END,metadata
      FROM signal_topic_editorial_concepts WHERE revision_id=$2::uuid`,[inserted.id,current.id,conceptKey,label,definition]);
    await client.query(`INSERT INTO signal_topic_consolidation_decisions(revision_id,atomic_group_id,consolidation_run_id,
      workspace_id,disposition,concept_id,source,confidence,rationale,decision_digest)
      SELECT $1::uuid,d.atomic_group_id,d.consolidation_run_id,d.workspace_id,d.disposition,new_concept.id,
        d.source,d.confidence,d.rationale,d.decision_digest
      FROM signal_topic_consolidation_decisions d
      LEFT JOIN signal_topic_editorial_concepts old_concept ON old_concept.id=d.concept_id
      LEFT JOIN signal_topic_editorial_concepts new_concept ON new_concept.revision_id=$1::uuid
        AND new_concept.concept_key=old_concept.concept_key WHERE d.revision_id=$2::uuid`,[inserted.id,current.id]);
    const validation = (await client.query<{ validation: { complete?: boolean } }>(
      "SELECT validate_signal_topic_consolidation_revision_v1($1::uuid) validation",[inserted.id])).rows[0]?.validation;
    if (validation?.complete !== true) fail("topic_consolidation_edition_incomplete");
    await client.query("UPDATE signal_topic_consolidation_revisions SET status='superseded' WHERE id=$1::uuid",[current.id]);
    await client.query(`UPDATE signal_topic_consolidation_revisions SET status='validated',revision_digest=$2,
      validated_at=clock_timestamp() WHERE id=$1::uuid`,[inserted.id,next.revision_digest]);
    const receipt = (await client.query<{ receipt: { snapshot_id?: string; snapshot_digest?: string } }>(
      "SELECT prepare_signal_topic_consolidation_snapshot_v1($1::uuid,$2::uuid,$3::uuid,$4) receipt",
    [args.workspace_id,args.actor_user_id,inserted.id,next.revision_digest])).rows[0];
    if (!receipt?.receipt?.snapshot_id || !receipt.receipt.snapshot_digest)
      throw new SignalTopicConsolidationContractError("topic_consolidation_edition_snapshot_invalid");
    await client.query("COMMIT");
    return { revision_id: inserted.id, revision: next.revision, revision_digest: next.revision_digest,
      snapshot_id: receipt.receipt.snapshot_id, snapshot_digest: receipt.receipt.snapshot_digest };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally { client.release(); }
}
