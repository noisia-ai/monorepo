import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { editSignalTopicConsolidationConceptV1 } from "../signal-topic-consolidation-edition";
import {
  parseSignalTopicConsolidationRevisionV1,
  signalTopicConsolidationDigestV1 as digest,
  type SignalTopicConsolidationDecisionV1,
  type SignalTopicEditorialConceptV1,
} from "../signal-topic-consolidation";
import {
  seedSignalTopicEditorialRenewalSourceV1,
  type SignalTopicEditorialRenewalSyntheticSeedArgsV1,
} from "./signal-topic-editorial-renewal.synthetic.fixture";

type Case = { test(name: string, fn: () => Promise<void>): Promise<void> };

/** Reuses the real, provider-simulated numerical source and writes no real corpus.
 * The caller owns one physical transaction, identity/schema/empty guards and rollback. */
export async function assertSignalTopicConsolidationEditionV1(
  t: Case, tx: SignalTopicEditorialRenewalSyntheticSeedArgsV1 & { onStage?: (stage: string) => void },
): Promise<void> {
  const { database, query } = tx;
  tx.onStage?.("synthetic_source");
  const seed = await seedSignalTopicEditorialRenewalSourceV1(tx);
  tx.onStage?.("baseline_revision");
  const workspace = seed.scope.workspace_id, actor = seed.scope.actor_user_id, runId = seed.scope.numeric_run_id;
  const run = (await query(`SELECT source_engine_execution_id,status FROM signal_topic_consolidation_runs
    WHERE id=$1::uuid AND workspace_id=$2::uuid FOR UPDATE`, [runId, workspace])).rows[0];
  assert.equal(run?.status, "ready_for_review");
  const groups = (await query(`SELECT id,group_key FROM signal_topic_atomic_groups
    WHERE consolidation_run_id=$1::uuid ORDER BY group_key COLLATE "C"`, [runId])).rows as Array<{ id: string; group_key: string }>;
  assert.equal(groups.length, 2);
  const concepts: SignalTopicEditorialConceptV1[] = [
    { concept_key: "bike-brakes", kind: "topic", label: "Frenos", definition: "Conversaciones sobre frenos de bicicletas", locale: "es-MX", source: "human" },
    { concept_key: "bike-prices", kind: "topic", label: "Precios", definition: "Conversaciones sobre precios de bicicletas", locale: "es-MX", source: "human" },
  ];
  const decisions: SignalTopicConsolidationDecisionV1[] = groups.map((group, index) => ({
    group_key: group.group_key, disposition: "topic", concept_key: concepts[index]!.concept_key,
    source: "human", confidence: 1, rationale: "Evidencia sintética del grupo",
  }));
  const body = { contract_version: "signal-topic-consolidation-revision-v1" as const, revision: 1, concepts, decisions };
  const parsed = parseSignalTopicConsolidationRevisionV1({ ...body, revision_digest: digest(body) }, groups.map(group => group.group_key));
  const revisionId = randomUUID(), conceptIds = concepts.map(() => randomUUID());
  await query(`INSERT INTO signal_topic_consolidation_revisions(id,consolidation_run_id,workspace_id,source_engine_execution_id,
    revision,status,created_by_user_id) VALUES($1,$2,$3,$4,1,'draft',$5)`, [revisionId, runId, workspace, run.source_engine_execution_id, actor]);
  for (const [index, concept] of concepts.entries()) await query(`INSERT INTO signal_topic_editorial_concepts(
    id,revision_id,consolidation_run_id,workspace_id,concept_key,kind,label,definition,locale,source,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`, [conceptIds[index], revisionId, runId, workspace,
    concept.concept_key, concept.kind, concept.label, concept.definition, concept.locale, concept.source,
    JSON.stringify({ priority_rank: index === 0 ? 2 : 1, priority_rationale: "Prioridad sintética explícita" })]);
  for (const [index, decision] of decisions.entries()) await query(`INSERT INTO signal_topic_consolidation_decisions(
    revision_id,atomic_group_id,consolidation_run_id,workspace_id,disposition,concept_id,source,confidence,rationale,decision_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [revisionId, groups[index]!.id, runId, workspace,
    decision.disposition, conceptIds[index], decision.source, decision.confidence, decision.rationale, digest(decision)]);
  const validation = (await query("SELECT validate_signal_topic_consolidation_revision_v1($1::uuid) value", [revisionId])).rows[0]?.value;
  assert.equal(validation?.complete, true, "the complete synthetic revision must pass the real coverage guard");
  await query("UPDATE signal_topic_consolidation_revisions SET status='validated',revision_digest=$2,validated_at=clock_timestamp() WHERE id=$1", [revisionId, parsed.revision_digest]);
  await query("UPDATE signal_topic_consolidation_runs SET status='validated',completed_at=clock_timestamp() WHERE id=$1", [runId]);

  const oldReceipt = (await query("SELECT prepare_signal_topic_consolidation_snapshot_v1($1,$2,$3,$4) value",
    [workspace, actor, revisionId, parsed.revision_digest])).rows[0]?.value;
  assert.ok(oldReceipt?.snapshot_id && oldReceipt?.snapshot_digest);
  const oldSnapshot = (await query("SELECT catalog FROM signal_topic_consolidation_snapshots WHERE id=$1", [oldReceipt.snapshot_id])).rows[0];
  assert.deepEqual(oldSnapshot.catalog.map((concept: { concept_key: string }) => concept.concept_key), ["bike-prices", "bike-brakes"]);
  const oldBinding = (await query("SELECT signal_topic_consolidation_binding_v1($1::uuid) value", [workspace])).rows[0]?.value;
  const oldActivation = { action: "activate", snapshot_id: oldReceipt.snapshot_id, snapshot_digest: oldReceipt.snapshot_digest,
    revision_digest: parsed.revision_digest, expected_binding_revision: oldBinding.binding_revision,
    expected_selection_revision: oldBinding.selection_revision, expected_snapshot_id: oldBinding.snapshot_id,
    expected_legacy_generation_id: oldBinding.legacy_generation_id, selected_concept_keys: ["bike-prices"] };
  await query("SELECT mutate_signal_topic_consolidation_binding_v1($1,$2,$3,$4::jsonb)",
    [workspace, actor, `synthetic-edition-${randomUUID()}`, JSON.stringify(oldActivation)]);

  tx.onStage?.("edit_and_activate");
  await t.test("one edit retains all decisions, priority and old Signal while preparing a successor", async () => {
    const next = await editSignalTopicConsolidationConceptV1({ database, workspace_id: workspace,
      actor_user_id: actor, expected_revision_id: revisionId, expected_revision_digest: parsed.revision_digest,
      concept_key: "bike-brakes", label: "Frenos y mantenimiento", definition: "Experiencias de mantenimiento y frenos de bicicletas" });
    assert.equal(next.revision, 2);
    const state = (await query(`SELECT (SELECT status FROM signal_topic_consolidation_revisions WHERE id=$1) old_status,
      (SELECT status FROM signal_topic_consolidation_revisions WHERE id=$2) new_status,
      signal_topic_consolidation_snapshot_current_v1($3) old_current,
      (SELECT snapshot_id FROM signal_topic_consolidation_bindings WHERE workspace_id=$4) serving`,
    [revisionId, next.revision_id, oldReceipt.snapshot_id, workspace])).rows[0];
    assert.deepEqual(state, { old_status: "superseded", new_status: "validated", old_current: true, serving: oldReceipt.snapshot_id });
    const copied = (await query(`SELECT c.concept_key,c.label,c.definition,c.metadata FROM signal_topic_editorial_concepts c
      WHERE c.revision_id=$1 ORDER BY c.concept_key COLLATE "C"`, [next.revision_id])).rows;
    assert.deepEqual(copied.map((concept: { metadata: { priority_rank: number } }) => concept.metadata.priority_rank), [2, 1]);
    assert.equal(copied[0]?.label, "Frenos y mantenimiento");
    const copiedDecisions = (await query("SELECT count(*)::int count FROM signal_topic_consolidation_decisions WHERE revision_id=$1", [next.revision_id])).rows[0];
    assert.equal(copiedDecisions?.count, groups.length);
    const nextSnapshot = (await query("SELECT catalog FROM signal_topic_consolidation_snapshots WHERE id=$1", [next.snapshot_id])).rows[0];
    assert.deepEqual(nextSnapshot.catalog.map((concept: { concept_key: string }) => concept.concept_key), ["bike-prices", "bike-brakes"]);
    const serving = (await query("SELECT signal_topic_consolidation_binding_v1($1::uuid) value", [workspace])).rows[0]?.value;
    const activate = { action: "activate", snapshot_id: next.snapshot_id, snapshot_digest: next.snapshot_digest,
      revision_digest: next.revision_digest, expected_binding_revision: serving.binding_revision,
      expected_selection_revision: serving.selection_revision, expected_snapshot_id: serving.snapshot_id,
      expected_legacy_generation_id: serving.legacy_generation_id, selected_concept_keys: ["bike-brakes"] };
    await query("SELECT mutate_signal_topic_consolidation_binding_v1($1,$2,$3,$4::jsonb)",
      [workspace, actor, `synthetic-edition-${randomUUID()}`, JSON.stringify(activate)]);
    const active = (await query("SELECT signal_topic_consolidation_binding_v1($1::uuid) value", [workspace])).rows[0]?.value;
    assert.equal(active.snapshot_id, next.snapshot_id);
  });
}
