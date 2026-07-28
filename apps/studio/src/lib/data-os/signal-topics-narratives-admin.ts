import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import {
  normalizeSignalTaxonomyProposalV1,
  signalTaxonomyContextHashV1,
  signalTaxonomyProfileKeyV1,
  type SignalTaxonomyCandidateV1,
  type SignalTaxonomyContextRefV1,
  type SignalTaxonomyKindV1,
  type SignalTaxonomyProposalV1
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import { reconcileSignalTaxonomyProfileV1 } from "@/lib/data-os/signal-topics-narratives-review";

type DiscoveryContextRow = {
  source_type: SignalTaxonomyContextRefV1["source_type"];
  source_id: string;
  version: string;
  content: string;
};

export type SignalTaxonomyDiscoveryContextV1 = {
  workspace_id: string;
  study_corpus_id: string;
  corpus_revision: number;
  kind: SignalTaxonomyKindV1;
  context_refs: SignalTaxonomyContextRefV1[];
  context_hash: string;
  context_items: Array<DiscoveryContextRow & { content_hash: string }>;
};

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
  const corpusResult = await pool.query<{ corpus_revision: number }>(`
    SELECT corpus_revision
    FROM study_corpora
    WHERE id = $1::uuid
  `, [corpus.id]);
  const corpusRevision = Number(corpusResult.rows[0]?.corpus_revision ?? 0);

  const governed = await pool.query<DiscoveryContextRow>(`
    WITH workspace_scope AS (
      SELECT brand_id, theme_id
      FROM signal_workspaces
      WHERE id = $1::uuid
    ), active_profile AS (
      SELECT profile.id, profile.version
      FROM brand_os_profiles profile
      CROSS JOIN workspace_scope scope
      WHERE profile.status = 'active'
        AND (
          (scope.brand_id IS NOT NULL AND profile.brand_id = scope.brand_id)
          OR (scope.theme_id IS NOT NULL AND profile.theme_id = scope.theme_id)
        )
      ORDER BY profile.version DESC, profile.created_at DESC
      LIMIT 1
    )
    SELECT 'brand_os_objective'::text AS source_type,
      objective.id::text AS source_id,
      ('brand-os:' || profile.version::text) AS version,
      concat_ws(' — ', objective.name, objective.description) AS content
    FROM brand_os_objectives objective
    JOIN active_profile profile ON profile.id = objective.brand_os_profile_id
    WHERE objective.status = 'active'
    UNION ALL
    SELECT 'brand_os_brief', brief.id::text,
      ('updated:' || brief.updated_at::text),
      concat_ws(' — ', brief.title, brief.summary)
    FROM brand_os_briefs brief
    JOIN active_profile profile ON profile.id = brief.brand_os_profile_id
    WHERE brief.status = 'active'
      AND (brief.study_corpus_id IS NULL OR brief.study_corpus_id = $2::uuid)
    UNION ALL
    SELECT 'brand_os_audience', audience.id::text,
      ('created:' || audience.created_at::text),
      concat_ws(' — ', audience.name, audience.description)
    FROM brand_os_audiences audience
    JOIN active_profile profile ON profile.id = audience.brand_os_profile_id
    WHERE audience.status = 'active'
    UNION ALL
    SELECT 'knowledge_assertion', assertion.id::text,
      ('updated:' || assertion.updated_at::text),
      assertion.assertion_text
    FROM knowledge_assertions assertion
    JOIN brand_knowledge_sources source ON source.id = assertion.knowledge_source_id
    CROSS JOIN workspace_scope scope
    WHERE assertion.status = 'active'
      AND (
        source.study_corpus_id = $2::uuid
        OR (scope.brand_id IS NOT NULL AND source.brand_id = scope.brand_id)
      )
    ORDER BY source_type, source_id
  `, [workspace.id, corpus.id]);

  const mentions = await pool.query<DiscoveryContextRow>(`
    SELECT 'mention_sample'::text AS source_type,
      mention.id::text AS source_id,
      ('corpus:' || $2::int::text) AS version,
      left(mention.text_clean, 1200) AS content
    FROM mentions mention
    WHERE mention.study_corpus_id = $1::uuid
      AND mention.inclusion_status = 'included'
    ORDER BY md5(mention.id::text || ':' || $2::int::text), mention.id
    LIMIT 100
  `, [corpus.id, corpusRevision]);

  const contextItems = [...governed.rows, ...mentions.rows]
    .filter((item) => item.content.trim().length > 0)
    .map((item) => ({
      ...item,
      content_hash: sha256(item.content)
    }));
  const contextRefs = contextItems.map(({ source_type, source_id, version, content_hash }) => ({
    source_type,
    source_id,
    version,
    content_hash
  }));
  return {
    workspace_id: workspace.id,
    study_corpus_id: corpus.id,
    corpus_revision: corpusRevision,
    kind,
    context_refs: contextRefs,
    context_hash: signalTaxonomyContextHashV1(contextRefs),
    context_items: contextItems
  };
}

export async function createSignalTaxonomyDraftV1(args: {
  workspace: ResolvedSignalWorkspace;
  input: CreateSignalTaxonomyDraftInput;
}) {
  const context = await loadSignalTaxonomyDiscoveryContextV1(
    args.workspace,
    args.input.kind
  );
  if (
    args.input.expected_context_hash
    && args.input.expected_context_hash !== context.context_hash
  ) {
    throw new Error("Discovery context changed; rebuild the taxonomy proposal.");
  }
  const proposal = normalizeSignalTaxonomyProposalV1({
    ...args.input,
    context_refs: context.context_refs,
    context_hash: context.context_hash
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`signal-taxonomy:${args.workspace.id}:${proposal.kind}`]
    );
    const versionResult = await client.query<{ version: number }>(`
      SELECT COALESCE(MAX(version), 0)::int + 1 AS version
      FROM signal_taxonomy_profiles
      WHERE workspace_id = $1::uuid AND kind = $2
    `, [args.workspace.id, proposal.kind]);
    const version = versionResult.rows[0]?.version ?? 1;
    const taxonomyKey = signalTaxonomyProfileKeyV1({
      workspace_id: args.workspace.id,
      kind: proposal.kind,
      version
    });
    const taxonomy = await client.query<{ id: string }>(`
      INSERT INTO taxonomies (
        taxonomy_key, name, description, scope, methodology_slug, status
      ) VALUES ($1, $2, $3, 'workspace', 'signal-topics-narratives', 'draft')
      RETURNING id::text
    `, [
      taxonomyKey,
      `${proposal.kind === "topic" ? "Topics" : "Narratives"} v${version}`,
      proposal.kind === "topic"
        ? "Concrete recurring subjects discussed in the Signal workspace."
        : "Recurring propositions, stories or frames constructed in the Signal workspace."
    ]);
    const taxonomyId = requiredId(taxonomy.rows[0]?.id, "taxonomy");
    await insertCandidateTerms(client, taxonomyId, proposal.terms);
    const ruleSet = await client.query<{ id: string }>(`
      INSERT INTO tagging_rule_sets (
        rule_set_key, version, methodology_slug, subject_type,
        scope, taxonomy_id, rules, status, metadata
      ) VALUES (
        $1, $2, 'signal-topics-narratives', 'mention',
        'workspace', $3::uuid, $4::jsonb, 'draft', $5::jsonb
      )
      RETURNING id::text
    `, [
      `signal_tn_${args.workspace.id.replaceAll("-", "")}_${proposal.kind}`,
      version,
      taxonomyId,
      JSON.stringify({
        contract_version: proposal.contract_version,
        kind: proposal.kind,
        terms: proposal.terms
      }),
      JSON.stringify({ context_hash: proposal.context_hash })
    ]);
    const ruleSetId = requiredId(ruleSet.rows[0]?.id, "rule set");
    const model = await client.query<{ id: string }>(`
      INSERT INTO tagging_model_versions (
        model_key, provider, version, methodology_slug,
        tagging_rule_set_id, prompt_hash, metadata
      ) VALUES (
        $1, $2, $3, 'signal-topics-narratives',
        $4::uuid, $5, $6::jsonb
      )
      RETURNING id::text
    `, [
      `signal_tn_${args.workspace.id.replaceAll("-", "")}_${proposal.kind}`,
      proposal.provider,
      `profile-v${version}:${proposal.model_version}`,
      ruleSetId,
      proposal.prompt_hash,
      JSON.stringify({ context_hash: proposal.context_hash })
    ]);
    const modelVersionId = requiredId(model.rows[0]?.id, "model version");
    const profile = await client.query<{ id: string }>(`
      INSERT INTO signal_taxonomy_profiles (
        workspace_id, taxonomy_id, kind, version, status,
        context_hash, rule_set_id, model_version_id, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, 'draft',
        $5, $6::uuid, $7::uuid, $8::jsonb
      )
      RETURNING id::text
    `, [
      args.workspace.id,
      taxonomyId,
      proposal.kind,
      version,
      proposal.context_hash,
      ruleSetId,
      modelVersionId,
      JSON.stringify({
        contract_version: proposal.contract_version,
        discovery_provider: proposal.provider,
        context_refs: proposal.context_refs,
        corpus_revision: context.corpus_revision
      })
    ]);
    const profileId = requiredId(profile.rows[0]?.id, "taxonomy profile");
    await insertDiscoveryLineage(client, profileId, {
      taxonomyId,
      ruleSetId,
      modelVersionId,
      contextRefs: proposal.context_refs
    });
    await client.query("COMMIT");
    return {
      contract_version: proposal.contract_version,
      profile_id: profileId,
      taxonomy_id: taxonomyId,
      rule_set_id: ruleSetId,
      model_version_id: modelVersionId,
      workspace_id: args.workspace.id,
      study_corpus_id: context.study_corpus_id,
      kind: proposal.kind,
      version,
      status: "draft" as const,
      context_hash: proposal.context_hash,
      terms: proposal.terms
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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

async function insertCandidateTerms(
  client: PoolClient,
  taxonomyId: string,
  terms: SignalTaxonomyCandidateV1[]
) {
  for (const [index, term] of terms.entries()) {
    await client.query(`
      INSERT INTO taxonomy_terms (
        taxonomy_id, term_key, label, description,
        sort_order, metadata, status
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6::jsonb, 'candidate'
      )
    `, [
      taxonomyId,
      term.term_key,
      term.label,
      term.definition,
      index + 1,
      JSON.stringify({
        statement: term.statement,
        examples: term.examples,
        exclusions: term.exclusions
      })
    ]);
  }
}

async function insertDiscoveryLineage(
  client: PoolClient,
  profileId: string,
  input: {
    taxonomyId: string;
    ruleSetId: string;
    modelVersionId: string;
    contextRefs: SignalTaxonomyContextRefV1[];
  }
) {
  const edges = [
    ...input.contextRefs.map((ref) => ({
      source_type: ref.source_type,
      source_id: ref.source_id,
      target_type: "signal_taxonomy_profile",
      target_id: profileId,
      relation_type: "context_for_taxonomy_discovery",
      metadata: {
        version: ref.version,
        content_hash: ref.content_hash
      }
    })),
    {
      source_type: "signal_taxonomy_profile",
      source_id: profileId,
      target_type: "taxonomy",
      target_id: input.taxonomyId,
      relation_type: "binds",
      metadata: {}
    },
    {
      source_type: "tagging_rule_set",
      source_id: input.ruleSetId,
      target_type: "signal_taxonomy_profile",
      target_id: profileId,
      relation_type: "classifies_with",
      metadata: {}
    },
    {
      source_type: "tagging_model_version",
      source_id: input.modelVersionId,
      target_type: "signal_taxonomy_profile",
      target_id: profileId,
      relation_type: "classifies_with",
      metadata: {}
    }
  ];
  for (const edge of edges) {
    await client.query(`
      INSERT INTO lineage_edges (
        source_type, source_id, target_type, target_id, relation_type, metadata
      ) VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6::jsonb)
      ON CONFLICT (
        source_type, source_id, target_type, target_id, relation_type
      ) DO UPDATE SET metadata = EXCLUDED.metadata
    `, [
      edge.source_type,
      edge.source_id,
      edge.target_type,
      edge.target_id,
      edge.relation_type,
      JSON.stringify(edge.metadata)
    ]);
  }
}

function requiredId(value: string | undefined, label: string) {
  if (!value) throw new Error(`Failed to persist Signal taxonomy ${label}.`);
  return value;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
