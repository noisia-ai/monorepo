import {
  type SignalTaxonomyCandidateV1,
  type SignalTaxonomyKindV1,
  type SignalTaxonomyProposalV1
} from "@noisia/query-engine";
import {
  createSignalTaxonomyDraftStoreV1,
  loadSignalTaxonomyDiscoveryContextStoreV1,
  type SignalTaxonomyDiscoveryContextStoreV1
} from "@noisia/db";

import { pool } from "@/lib/db";
import { canManageCorpus } from "@/lib/auth/roles";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import { reconcileSignalTaxonomyProfileV1 } from "@/lib/data-os/signal-topics-narratives-review";

export function canAdministerSignalTaxonomyV1(role: string) {
  return canManageCorpus(role);
}

export type SignalTaxonomyDiscoveryContextV1 =
  SignalTaxonomyDiscoveryContextStoreV1;

export type CreateSignalTaxonomyDraftInput = {
  kind: SignalTaxonomyKindV1;
  terms: SignalTaxonomyCandidateV1[];
  provider: SignalTaxonomyProposalV1["provider"];
  model_version: string;
  prompt_hash: string;
  expected_context_hash?: string;
};

export async function listSignalTaxonomyProfilesV1(
  workspace: ResolvedSignalWorkspace
) {
  const result = await pool.query(`
    SELECT profile.id::text, profile.kind, profile.version, profile.status,
      profile.context_hash, profile.approved_by_user_id::text,
      profile.approved_at, profile.created_at, profile.updated_at,
      taxonomy.id::text AS taxonomy_id, taxonomy.taxonomy_key,
      rule_set.id::text AS rule_set_id, rule_set.rule_set_key,
      model.id::text AS model_version_id, model.model_key, model.provider,
      model.version AS model_version,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', term.id,
            'term_key', term.term_key,
            'label', term.label,
            'definition', term.description,
            'status', term.status,
            'metadata', term.metadata
          )
          ORDER BY term.sort_order NULLS LAST, term.term_key
        ) FILTER (WHERE term.id IS NOT NULL),
        '[]'::jsonb
      ) AS terms
    FROM signal_taxonomy_profiles profile
    JOIN taxonomies taxonomy ON taxonomy.id = profile.taxonomy_id
    JOIN tagging_rule_sets rule_set ON rule_set.id = profile.rule_set_id
    JOIN tagging_model_versions model ON model.id = profile.model_version_id
    LEFT JOIN taxonomy_terms term ON term.taxonomy_id = taxonomy.id
    WHERE profile.workspace_id = $1::uuid
    GROUP BY profile.id, taxonomy.id, rule_set.id, model.id
    ORDER BY profile.kind, profile.version DESC
  `, [workspace.id]);
  return {
    contract_version: "signal-topics-narratives-v1",
    workspace_id: workspace.id,
    profiles: result.rows
  };
}

export async function loadSignalTaxonomyDiscoveryContextV1(
  workspace: ResolvedSignalWorkspace,
  kind: SignalTaxonomyKindV1
): Promise<SignalTaxonomyDiscoveryContextV1> {
  const corpus = workspace.corpora[0];
  if (!corpus) throw new Error("Signal workspace has no serving corpus.");
  return loadSignalTaxonomyDiscoveryContextStoreV1({
    pool,
    workspace_id: workspace.id,
    study_corpus_id: corpus.id,
    kind
  });
}

export async function createSignalTaxonomyDraftV1(args: {
  workspace: ResolvedSignalWorkspace;
  input: CreateSignalTaxonomyDraftInput;
}) {
  const corpus = args.workspace.corpora[0];
  if (!corpus) throw new Error("Signal workspace has no serving corpus.");
  return createSignalTaxonomyDraftStoreV1({
    pool,
    workspace_id: args.workspace.id,
    study_corpus_id: corpus.id,
    input: args.input
  });
}

export async function reviewSignalTaxonomyProfileV1(args: {
  workspace: ResolvedSignalWorkspace;
  profile_id: string;
  reviewer_user_id: string;
  action: "approve" | "reject";
  notes?: string;
}) {
  const profile = await pool.query<{ id: string; workspace_id: string }>(`
    SELECT id::text, workspace_id::text
    FROM signal_taxonomy_profiles
    WHERE id = $1::uuid AND workspace_id = $2::uuid
  `, [args.profile_id, args.workspace.id]);
  if (!profile.rows[0]) return null;
  if (args.action === "approve") {
    const reconciliation = await reconcileSignalTaxonomyProfileV1({
      workspace: args.workspace,
      profile_id: args.profile_id
    });
    if (!reconciliation?.ready_for_activation) {
      throw new Error(
        `Taxonomy profile reconciliation failed: ${
          reconciliation?.blockers.join(", ") || "profile_not_available"
        }`
      );
    }
  }
  const reviewed = args.action === "approve"
    ? await pool.query(`
        SELECT id::text, workspace_id::text, taxonomy_id::text,
          kind, version, status, context_hash, rule_set_id::text,
          model_version_id::text, approved_by_user_id::text, approved_at
        FROM activate_signal_taxonomy_profile($1::uuid, $2::uuid)
      `, [args.profile_id, args.reviewer_user_id])
    : await pool.query(`
        SELECT id::text, workspace_id::text, taxonomy_id::text,
          kind, version, status, context_hash, rule_set_id::text,
          model_version_id::text, approved_by_user_id::text, approved_at
        FROM reject_signal_taxonomy_profile($1::uuid, $2::uuid, $3)
      `, [args.profile_id, args.reviewer_user_id, args.notes ?? ""]);
  return reviewed.rows[0] ?? null;
}
