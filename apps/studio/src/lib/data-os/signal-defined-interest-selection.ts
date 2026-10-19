import { loadSignalWorkspaceCapabilitiesStoreV1, loadSignalWorkspaceClassificationStatusV1,
  loadSignalWorkspaceDefinedInterestSelectionV1, mutateSignalWorkspaceDefinedInterestSelectionV1,
  type SignalWorkspaceDefinedInterestSelectionCommandV1 } from "@noisia/db";
import { z } from "zod";

type Scope = { workspace_id: string; actor_user_id: string };
const hash = /^sha256:[a-f0-9]{64}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const commandSchema = z.object({ term_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  selected: z.boolean(), snapshot_id: z.string().uuid().nullable(),
  expected_snapshot_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  generation_id: z.string().uuid(), taxonomy_term_id: z.string().uuid(),
  definition_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  definition_revision: z.number().int().positive(), expected_selection_revision: z.number().int().nonnegative() }).strict();
export function parseDefinedInterestSelectionCommandV1(value: unknown, routeTermKey: string): SignalWorkspaceDefinedInterestSelectionCommandV1 {
  const command = commandSchema.parse(value);
  if (command.term_key !== routeTermKey || (command.snapshot_id === null) !== (command.expected_snapshot_digest === null))
    throw Object.assign(new Error("defined_interest_selection_request_invalid"),
      { code: "defined_interest_selection_request_invalid", status: 422 });
  return command;
}
export type DefinedInterestSelectionCandidateV1 = {
  generation_id: string; taxonomy_term_id: string; definition_digest: string;
  definition_revision: number; approved_memberships: number; approved_decisions: number;
};

export function definedInterestSelectionViewV1(args: {
  scope: Scope; selection: Awaited<ReturnType<typeof loadSignalWorkspaceDefinedInterestSelectionV1>>;
  latest: Awaited<ReturnType<typeof loadSignalWorkspaceClassificationStatusV1>>;
  can_select_signal: boolean; candidate: DefinedInterestSelectionCandidateV1 | null;
}) {
  const { scope, selection, latest, candidate } = args;
  if (selection.workspace_id !== scope.workspace_id) throw new Error("defined_interest_selection_scope_mismatch");
  const ready = Boolean(latest.latest_complete?.is_current && latest.latest_complete.status === "ready" && candidate
    && candidate.generation_id === latest.latest_complete.generation_id
    && (candidate.approved_decisions === 0 || candidate.approved_memberships > 0));
  return { ...selection, latest_run: latest.latest_run ? {
    status: latest.latest_run.status, complete: latest.latest_run.complete, is_current: latest.latest_run.is_current
  } : null, ready, can_select: args.can_select_signal && ready,
    candidate: ready ? candidate : null };
}

/** Read a single defined interest; a score or unfinished run never enables selection. */
export async function loadDefinedInterestSelectionProductV1(scope: Scope, termKey: string, idempotencyKey?: string) {
  const { pool } = await import("@/lib/db");
  const [selection, latest, capabilities] = await Promise.all([
    loadSignalWorkspaceDefinedInterestSelectionV1({ database: pool, ...scope, term_key: termKey,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) }),
    loadSignalWorkspaceClassificationStatusV1({ database: pool, ...scope, interest_term_key: termKey }),
    loadSignalWorkspaceCapabilitiesStoreV1({ queryable: pool, ...scope })
  ]);
  let candidate: DefinedInterestSelectionCandidateV1 | null = null;
  const generationId = latest.latest_complete?.is_current && latest.latest_complete.status === "ready"
    ? latest.latest_complete.generation_id : null;
  if (generationId && uuid.test(generationId)) {
    const result = await pool.query<{ taxonomy_term_id: string; definition_digest: string;
      definition_revision: number; approved_memberships: string; approved_decisions: string }>(`
      SELECT topic->>'taxonomy_term_id' taxonomy_term_id,
       topic->'definition'->>'definition_digest' definition_digest,
       (topic->'definition'->>'definition_revision')::int definition_revision,
       count(DISTINCT assignment.canonical_root_id)::text approved_memberships,
       (SELECT count(DISTINCT original.canonical_root_id)::text FROM signal_classification_assignments original
         WHERE original.workspace_id=$1::uuid AND original.generation_id=generation.id
          AND original.taxonomy_term_id=term.id AND original.definition_digest=topic->'definition'->>'definition_digest'
          AND original.definition_revision=(topic->'definition'->>'definition_revision')::int
          AND original.disposition='approved' AND original.resolution_method IN ('model','human')
          AND signal_workspace_classification_assignment_current_v1(original,generation)
          AND NOT EXISTS (SELECT 1 FROM signal_classification_assignments correction
            WHERE correction.generation_id=generation.id AND correction.canonical_root_id=original.canonical_root_id
             AND correction.taxonomy_term_id=term.id AND correction.resolution_method='human'
             AND correction.disposition='rejected'
             AND signal_workspace_classification_assignment_current_v1(correction,generation))) approved_decisions
      FROM signal_classification_generations generation
      CROSS JOIN LATERAL jsonb_array_elements(generation.input_snapshot->'topics') topic
      JOIN taxonomy_terms term ON term.id=(topic->>'taxonomy_term_id')::uuid
       AND term.term_key=$3 AND term.status IN ('candidate','active')
       AND term.metadata->'topic'->>'definition_digest'=topic->'definition'->>'definition_digest'
       AND term.metadata->'topic'->>'definition_revision'=topic->'definition'->>'definition_revision'
       AND term.metadata->'topic'->>'lifecycle' IS DISTINCT FROM 'archived'
      LEFT JOIN signal_classification_assignments assignment ON assignment.generation_id=generation.id
       AND assignment.workspace_id=$1::uuid AND assignment.taxonomy_term_id=term.id
       AND EXISTS (SELECT 1 FROM signal_classification_generation_items item
        WHERE item.id=assignment.generation_item_id AND item.generation_id=generation.id
         AND item.canonical_root_id=assignment.canonical_root_id)
       AND EXISTS (SELECT 1 FROM mentions mention WHERE mention.id=assignment.canonical_root_id
        AND mention.workspace_id=$1::uuid AND mention.inclusion_status='included'
        AND mention.canonical_mention_id=mention.id)
       AND assignment.definition_digest=topic->'definition'->>'definition_digest'
       AND assignment.definition_revision=(topic->'definition'->>'definition_revision')::int
       AND assignment.disposition='approved' AND assignment.resolution_method IN ('model','human')
       AND signal_workspace_classification_assignment_current_v1(assignment,generation)
       AND NOT EXISTS (SELECT 1 FROM signal_classification_assignments correction
        WHERE correction.generation_id=generation.id AND correction.canonical_root_id=assignment.canonical_root_id
         AND correction.taxonomy_term_id=term.id AND correction.resolution_method='human'
         AND correction.disposition='rejected'
         AND signal_workspace_classification_assignment_current_v1(correction,generation))
       AND EXISTS (SELECT 1 FROM signal_mention_import_memberships path
        JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=$1::uuid
         AND batch.data_source_id=path.data_source_id AND batch.status='completed'
        JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1::uuid AND source.status='active'
        JOIN signal_provenance_policy_bindings binding ON binding.workspace_id=$1::uuid
         AND binding.data_source_id=source.id AND binding.status='active' AND binding.effective_from<=now()
         AND (binding.effective_to IS NULL OR binding.effective_to>now())
         AND (binding.import_batch_id=batch.id OR binding.import_batch_id IS NULL)
        JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=$1::uuid
         AND license.status='active' AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
        JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=$1::uuid
         AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
         AND (retention.effective_to IS NULL OR retention.effective_to>now())
         AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
        JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=$1::uuid
        WHERE path.workspace_id=$1::uuid AND origin.canonical_mention_id=assignment.canonical_root_id
         AND EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
          AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-derived-metrics' AND usage.decision='allowed')
         AND EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
          AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-mention-list' AND usage.decision='allowed')
         AND EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1::uuid
          AND usage.licensing_policy_id=license.id AND usage.usage_purpose='client-text-or-excerpt' AND usage.decision='allowed'))
      WHERE generation.workspace_id=$1::uuid AND generation.id=$2::uuid
       AND generation.input_contract='workspace-topic-classification-v1'
       AND generation.status='ready' AND generation.finalized_digest IS NOT NULL
       AND generation.input_snapshot->>'interest_term_key'=$3
       AND jsonb_array_length(generation.input_snapshot->'topics')=1
       AND NOT EXISTS (SELECT 1 FROM signal_topic_consolidation_bindings binding
        JOIN signal_topic_consolidation_snapshots snapshot ON snapshot.id=binding.snapshot_id
         AND snapshot.workspace_id=binding.workspace_id
        CROSS JOIN LATERAL jsonb_array_elements(snapshot.catalog) concept
        WHERE binding.workspace_id=$1::uuid AND concept->>'term_key'=$3)
      GROUP BY topic,generation.id,term.id`, [scope.workspace_id, generationId, termKey]);
    const row = result.rows[0];
    if (row && uuid.test(row.taxonomy_term_id) && hash.test(row.definition_digest)
      && Number.isSafeInteger(row.definition_revision) && row.definition_revision > 0) {
      candidate = { generation_id: generationId, taxonomy_term_id: row.taxonomy_term_id,
        definition_digest: row.definition_digest, definition_revision: row.definition_revision,
        approved_memberships: Number(row.approved_memberships), approved_decisions: Number(row.approved_decisions) };
    }
  }
  let selectionSnapshotDigest: string | null = null;
  if (selection.selection?.snapshot_id) {
    const row = (await pool.query<{ snapshot_digest: string }>(
      "SELECT snapshot_digest FROM signal_topic_consolidation_snapshots WHERE id=$1::uuid AND workspace_id=$2::uuid",
      [selection.selection.snapshot_id, scope.workspace_id])).rows[0];
    if (row && hash.test(row.snapshot_digest)) selectionSnapshotDigest = row.snapshot_digest;
  }
  return { ...definedInterestSelectionViewV1({ scope, selection, latest,
    can_select_signal: capabilities.can_select_signal, candidate }), selection_snapshot_digest: selectionSnapshotDigest };
}

export async function mutateDefinedInterestSelectionProductV1(scope: Scope, command: SignalWorkspaceDefinedInterestSelectionCommandV1,
  idempotencyKey: string) {
  const { pool } = await import("@/lib/db");
  return mutateSignalWorkspaceDefinedInterestSelectionV1({ database: pool, ...scope,
    command, idempotency_key: idempotencyKey });
}
