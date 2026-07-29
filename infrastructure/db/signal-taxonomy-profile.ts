import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import {
  normalizeSignalTaxonomyProposalV1,
  signalTaxonomyContextHashV1,
  signalTaxonomyProfileKeyV1,
  type SignalTaxonomyCandidateV1,
  type SignalTaxonomyContextRefV1,
  type SignalTaxonomyKindV1,
  type SignalTaxonomyProposalV1
} from "@noisia/query-engine";

type DiscoveryContextRow = {
  source_type: SignalTaxonomyContextRefV1["source_type"];
  source_id: string;
  version: string;
  content: string;
};

export type SignalTaxonomyDiscoveryContextStoreV1 = {
  workspace_id: string;
  study_corpus_id: string;
  corpus_revision: number;
  kind: SignalTaxonomyKindV1;
  context_refs: SignalTaxonomyContextRefV1[];
  context_hash: string;
  context_items: Array<DiscoveryContextRow & { content_hash: string }>;
};

export type CreateSignalTaxonomyDraftStoreInputV1 = {
  kind: SignalTaxonomyKindV1;
  terms: SignalTaxonomyCandidateV1[];
  provider: SignalTaxonomyProposalV1["provider"];
  model_version: string;
  prompt_hash: string;
  expected_context_hash?: string;
  additional_context_items?: Array<DiscoveryContextRow & {
    content_hash: string;
  }>;
  discovery_usage?: {
    input_tokens: number;
    output_tokens: number;
    voyage_tokens: number;
    cost_usd: number;
  };
};

export async function loadSignalTaxonomyDiscoveryContextStoreV1(args: {
  pool: Pool;
  workspace_id: string;
  study_corpus_id: string;
  kind: SignalTaxonomyKindV1;
}): Promise<SignalTaxonomyDiscoveryContextStoreV1> {
  const corpusResult = await args.pool.query<{ corpus_revision: number }>(`
    SELECT corpus_revision
    FROM study_corpora
    WHERE id = $1::uuid
  `, [args.study_corpus_id]);
  if (!corpusResult.rows[0]) throw new Error("Signal serving corpus not found.");
  const corpusRevision = Number(corpusResult.rows[0].corpus_revision);

  const governed = await args.pool.query<DiscoveryContextRow>(`
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
  `, [args.workspace_id, args.study_corpus_id]);

  const mentions = await args.pool.query<DiscoveryContextRow>(`
    SELECT 'mention_sample'::text AS source_type,
      mention.id::text AS source_id,
      ('corpus:' || $2::int::text) AS version,
      left(mention.text_clean, 1200) AS content
    FROM mentions mention
    WHERE mention.study_corpus_id = $1::uuid
      AND mention.inclusion_status = 'included'
    ORDER BY md5(mention.id::text || ':' || $2::int::text), mention.id
    LIMIT 100
  `, [args.study_corpus_id, corpusRevision]);

  const contextItems = [...governed.rows, ...mentions.rows]
    .filter((item) => item.content.trim().length > 0)
    .map((item) => ({ ...item, content_hash: sha256(item.content) }));
  const contextRefs = contextItems.map(
    ({ source_type, source_id, version, content_hash }) => ({
      source_type,
      source_id,
      version,
      content_hash
    })
  );
  return {
    workspace_id: args.workspace_id,
    study_corpus_id: args.study_corpus_id,
    corpus_revision: corpusRevision,
    kind: args.kind,
    context_refs: contextRefs,
    context_hash: signalTaxonomyContextHashV1(contextRefs),
    context_items: contextItems
  };
}

export async function createSignalTaxonomyDraftStoreV1(args: {
  pool: Pool;
  workspace_id: string;
  study_corpus_id: string;
  input: CreateSignalTaxonomyDraftStoreInputV1;
}) {
  const baseContext = await loadSignalTaxonomyDiscoveryContextStoreV1({
    pool: args.pool,
    workspace_id: args.workspace_id,
    study_corpus_id: args.study_corpus_id,
    kind: args.input.kind
  });
  const context = appendDiscoveryContext(
    baseContext,
    args.input.additional_context_items ?? []
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
  const client = await args.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`signal-taxonomy:${args.workspace_id}:${proposal.kind}`]
    );
    const existing = await client.query<{ id: string; version: number }>(`
      SELECT id::text, version
      FROM signal_taxonomy_profiles
      WHERE workspace_id = $1::uuid
        AND kind = $2
        AND status = 'draft'
        AND context_hash = $3
      ORDER BY version DESC
      LIMIT 1
    `, [args.workspace_id, proposal.kind, proposal.context_hash]);
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return {
        contract_version: proposal.contract_version,
        profile_id: existing.rows[0].id,
        workspace_id: args.workspace_id,
        study_corpus_id: context.study_corpus_id,
        kind: proposal.kind,
        version: existing.rows[0].version,
        status: "draft" as const,
        context_hash: proposal.context_hash,
        terms: proposal.terms,
        reused: true
      };
    }
    const versionResult = await client.query<{ version: number }>(`
      SELECT COALESCE(MAX(version), 0)::int + 1 AS version
      FROM signal_taxonomy_profiles
      WHERE workspace_id = $1::uuid AND kind = $2
    `, [args.workspace_id, proposal.kind]);
    const version = versionResult.rows[0]?.version ?? 1;
    const taxonomyKey = signalTaxonomyProfileKeyV1({
      workspace_id: args.workspace_id,
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
      `signal_tn_${args.workspace_id.replaceAll("-", "")}_${proposal.kind}`,
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
      `signal_tn_${args.workspace_id.replaceAll("-", "")}_${proposal.kind}`,
      proposal.provider,
      `profile-v${version}:${proposal.model_version}`,
      ruleSetId,
      proposal.prompt_hash,
      JSON.stringify({
        context_hash: proposal.context_hash,
        discovery_usage: args.input.discovery_usage ?? null
      })
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
      args.workspace_id,
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
        corpus_revision: context.corpus_revision,
        discovery_usage: args.input.discovery_usage ?? null
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
      workspace_id: args.workspace_id,
      study_corpus_id: context.study_corpus_id,
      kind: proposal.kind,
      version,
      status: "draft" as const,
      context_hash: proposal.context_hash,
      terms: proposal.terms,
      reused: false
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function appendDiscoveryContext(
  context: SignalTaxonomyDiscoveryContextStoreV1,
  additions: Array<DiscoveryContextRow & { content_hash: string }>
): SignalTaxonomyDiscoveryContextStoreV1 {
  const byIdentity = new Map(
    context.context_items.map((item) => [
      `${item.source_type}:${item.source_id}:${item.version}`,
      item
    ])
  );
  for (const item of additions) {
    if (sha256(item.content) !== item.content_hash) {
      throw new Error("Additional discovery context content_hash is invalid.");
    }
    byIdentity.set(`${item.source_type}:${item.source_id}:${item.version}`, item);
  }
  const contextItems = Array.from(byIdentity.values()).sort((left, right) =>
    left.source_type.localeCompare(right.source_type)
    || left.source_id.localeCompare(right.source_id)
    || left.version.localeCompare(right.version)
  );
  const contextRefs = contextItems.map(
    ({ source_type, source_id, version, content_hash }) => ({
      source_type,
      source_id,
      version,
      content_hash
    })
  );
  return {
    ...context,
    context_items: contextItems,
    context_refs: contextRefs,
    context_hash: signalTaxonomyContextHashV1(contextRefs)
  };
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
      metadata: { version: ref.version, content_hash: ref.content_hash }
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
