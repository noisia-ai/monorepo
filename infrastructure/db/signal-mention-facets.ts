import type { Pool, PoolClient } from "pg";
import {
  canonicalEntityContextV1,
  entityContextDigestV1,
  diffEntityContextV1,
  isEntityContextAffectedV1,
  type EntityContextV1,
  type FacetInput,
  type FacetResult,
  deriveRelevanceV1,
  type MentionFacetsV1,
  effectiveEntitiesDigestV1,
  validateMentionFacetsV1,
} from "@noisia/query-engine";
import { loadSignalSemanticResolutionGovernedContextV1 } from "./signal-semantic-resolution";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
export type LabelingDatabaseV1 = Pick<Pool, "connect" | "query">;
export async function loadFacetEntityContextV1(
  client: Pick<PoolClient, "query">,
  workspaceId: string,
): Promise<EntityContextV1> {
  const governed = await loadSignalSemanticResolutionGovernedContextV1(
    client,
    workspaceId,
    { complete_brand_context: true },
  );
  return canonicalEntityContextV1({
    entities: governed.identities
      .filter((e) => e.scope !== "reference")
      .map((e) => ({
        entity_id: e.entity_id,
        kind: e.scope as "primary_brand" | "competitor" | "category",
        name: e.entity_label,
        aliases: e.aliases,
        disambiguation: e.disambiguation ?? null,
      })),
  });
}
export async function inspectFacetContextChangeV1(
  client: Pick<PoolClient, "query">,
  workspaceId: string,
) {
  const context = await loadFacetEntityContextV1(client, workspaceId),
    contextDigest = entityContextDigestV1(context);
  const previous = (
    await client.query<{
      context: EntityContextV1;
      digest: string;
      version_no: number;
    }>(
      `SELECT context,digest,version_no FROM signal_entity_context_versions WHERE workspace_id=$1 ORDER BY version_no DESC LIMIT 1`,
      [workspaceId],
    )
  ).rows[0];
  const diff = diffEntityContextV1(previous?.context ?? null, context),
    changed = previous?.digest !== contextDigest;
  // Read every known canonical root, including roots outside the current preparation.
  // A later re-inclusion must not make an old label appear current. Labels from every
  // labeler matter when a deleted entity was identified by a previous labeler.
  const roots = changed
    ? (
        await client.query<{
          root_id: string;
          title: string | null;
          full_text: string;
          entity_ids: string[];
        }>(
          `WITH labeled_entities AS (
             SELECT label.root_id,array_agg(DISTINCT entity->>'entity_id') entity_ids
             FROM signal_mention_facet_labels label
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(label.facets#>'{entities,value}','[]'::jsonb)) entity
             WHERE label.workspace_id=$1 GROUP BY label.root_id
           ) SELECT mention.id root_id,mention.title,mention.text_clean full_text,
             COALESCE(labels.entity_ids,ARRAY[]::text[]) entity_ids
           FROM mentions mention LEFT JOIN labeled_entities labels ON labels.root_id=mention.id
           WHERE mention.workspace_id=$1 AND mention.canonical_mention_id=mention.id`,
          [workspaceId],
        )
      ).rows
    : [];
  const affected = roots
    .filter((r) =>
      isEntityContextAffectedV1(diff, {
        title: r.title,
        text: r.full_text,
        entity_ids: r.entity_ids,
      }),
    )
    .map((r) => r.root_id);
  return { context, digest: contextDigest, previous, diff, changed, affected };
}
/** Caller holds the workspace labeling lock; CE transition and run commit together. */
export async function registerFacetContextV1(
  client: Pick<PoolClient, "query">,
  workspaceId: string,
  forceFull = false,
) {
  const change = await inspectFacetContextChangeV1(client, workspaceId);
  if (forceFull) {
    change.changed = true;
    change.diff = {
      affected_mode: "full",
      lexical_terms: [],
      labeled_entity_ids: [],
    };
    change.affected = (
      await client.query<{ root_id: string }>(
        "SELECT root_id FROM signal_mention_facets_current_v1 WHERE workspace_id=$1",
        [workspaceId],
      )
    ).rows.map((row) => row.root_id);
  }
  if (change.changed) {
    const version = (change.previous?.version_no ?? 0) + 1;
    await client.query(
      `INSERT INTO signal_entity_context_versions(workspace_id,version_no,digest,parent_digest,context,diff,affected_mode,affected_count)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
      [
        workspaceId,
        version,
        change.digest,
        change.previous?.digest ?? null,
        JSON.stringify(change.context),
        JSON.stringify(change.diff),
        change.diff.affected_mode,
        change.affected.length,
      ],
    );
    if (change.diff.affected_mode === "targeted" && change.affected.length)
      await client.query(
        `INSERT INTO signal_entity_context_affected_roots(workspace_id,version_no,root_id) SELECT $1,$2,unnest($3::uuid[])`,
        [workspaceId, version, change.affected],
      );
  }
  return change;
}
export async function selectFacetInputsV1(
  client: Pick<PoolClient, "query">,
  workspaceId: string,
  cursor: string | null = null,
  limit = 200,
): Promise<FacetInput[]> {
  if (limit < 200 || limit > 1000) throw new Error("facets_page_size_invalid");
  return (
    await client.query<FacetInput>(
      `SELECT root_id,input_digest,full_text text,title,platform,content_type,author,published_at::text,language
    FROM signal_mention_facets_current_v1 current WHERE workspace_id=$1 AND status IN('pending','error') AND NOT requires_context_review AND ($2::uuid IS NULL OR root_id>$2)
    AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls uncertain JOIN signal_labeling_runs r ON r.id=uncertain.run_id JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
      JOIN signal_workspace_labelers chosen ON chosen.workspace_id=current.workspace_id AND chosen.kind='facets' AND chosen.labeler_version_id=l.id
      WHERE uncertain.workspace_id=current.workspace_id AND uncertain.status IN('submitting','unknown')
      AND uncertain.inputs @> jsonb_build_array(jsonb_build_object('root_id',current.root_id::text,'input_digest',current.input_digest)))
    ORDER BY root_id LIMIT $3`,
      [workspaceId, cursor, limit],
    )
  ).rows;
}
export async function writeFacetResultsV1(
  client: Pick<PoolClient, "query">,
  args: {
    workspace_id: string;
    labeler_digest: string;
    call_id: string;
    results: Array<FacetResult & { call_id?: string }>;
  },
) {
  if (!args.results.length) return;
  const rows = args.results
    .filter((r) => r.status !== "error")
    .map((r) => ({
      ...r,
      call_id: r.call_id ?? args.call_id,
      facets: r.facets ?? null,
      relevance: r.facets ? deriveRelevanceV1(r.facets) : "unknown",
      effective_entities_digest: effectiveEntitiesDigestV1(
        r.facets?.entities.value ?? [],
      ),
      refusal_category: r.refusal_category ?? null,
      error_code: r.error_code ?? null,
    }));
  await client.query(
    `INSERT INTO signal_mention_facet_labels(workspace_id,root_id,input_digest,labeler_digest,entity_context_digest,facet_schema_version,status,facets,relevance,effective_entities_digest,call_id,refusal_category,error_code)
    SELECT $1,r.root_id,r.input_digest,$2,r.entity_context_digest,'mention-facets-v1',r.status,r.facets,r.relevance,r.effective_entities_digest,r.call_id,r.refusal_category,r.error_code
    FROM jsonb_to_recordset($3::jsonb) r(call_id uuid,root_id uuid,input_digest text,entity_context_digest text,status text,facets jsonb,relevance text,effective_entities_digest text,refusal_category text,error_code text)
    ON CONFLICT DO NOTHING`,
    [args.workspace_id, args.labeler_digest, JSON.stringify(rows)],
  );
}
export async function overrideMentionFacetV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
  root_id: string; dimension: string; value: unknown;
}) {
  return overrideMentionFacetsBatchV1({ ...args, overrides: [args] });
}

const emptyHumanFacets = (): MentionFacetsV1 => ({
  entities: { value: [], confidence: "high", abstained: true }, unrelated_reason: null,
  voice: { value: "unknown", confidence: "high", abstained: true },
  act: { value: "other", confidence: "high", abstained: true },
  spam_or_bot: { value: false, confidence: "high", abstained: true },
  language: { value: null, confidence: "high", abstained: true },
  asunto: { value: null, confidence: "high", abstained: true },
});

/** One authority check and transaction per page, including corrections of abstentions. */
export async function overrideMentionFacetsBatchV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
  overrides: Array<{ root_id: string; dimension: string; value: unknown }>;
}) {
  if (!args.overrides.length || args.overrides.length > 500) throw new Error("facets_override_invalid");
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))", [args.workspace_id]);
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ ...args, queryable: client, lock_authority: true });
    if (!caps.can_edit_topics) throw new Error("facets_forbidden");
    const context = await loadFacetEntityContextV1(client, args.workspace_id);
    const rows = (await client.query<{ root_id: string; facets: MentionFacetsV1 | null }>(
      `SELECT current.root_id,COALESCE(current.facets,CASE WHEN current.requires_context_review THEN
        (SELECT label.facets FROM signal_mention_facet_labels label
         JOIN signal_workspace_labelers chosen ON chosen.workspace_id=label.workspace_id AND chosen.kind='facets'
         JOIN signal_labeler_versions version ON version.id=chosen.labeler_version_id AND version.labeler_digest=label.labeler_digest
         WHERE label.workspace_id=current.workspace_id AND label.input_digest=current.input_digest AND label.facets IS NOT NULL
         ORDER BY label.created_at DESC LIMIT 1)
        || COALESCE((SELECT jsonb_object_agg(dimension,value) FROM signal_mention_facet_overrides patch
         WHERE patch.workspace_id=current.workspace_id AND patch.root_id=current.root_id AND patch.superseded_at IS NULL),'{}'::jsonb)
        END) facets FROM signal_mention_facets_current_v1 current WHERE workspace_id=$1 AND root_id=ANY($2::uuid[])`,
      [args.workspace_id, [...new Set(args.overrides.map(p => p.root_id))]])).rows;
    const current = new Map(rows.map(row => [row.root_id, row.facets ?? emptyHumanFacets()]));
    const patches = new Map<string, {root_id: string; dimension: string; value: unknown}>();
    for (const patch of args.overrides) {
      const before = current.get(patch.root_id);
      if (!before || !Object.hasOwn(before, patch.dimension)) throw new Error("facets_override_invalid");
      const candidate = { ...before, [patch.dimension]: patch.value };
      if (patch.dimension === "unrelated_reason" && patch.value !== null) {
        if (before.entities.value.length) throw new Error("facets_override_contradiction");
        candidate.entities = { ...before.entities, abstained: false };
      }
      const normalized = validateMentionFacetsV1(candidate, context);
      current.set(patch.root_id, normalized);
      const dimensions = patch.dimension === "entities" || patch.dimension === "unrelated_reason"
        ? ["entities", "unrelated_reason"] : [patch.dimension];
      for (const dimension of dimensions) patches.set(`${patch.root_id}:${dimension}`, {
        root_id: patch.root_id, dimension, value: normalized[dimension as keyof MentionFacetsV1],
      });
    }
    const payload = JSON.stringify([...patches.values()]);
    await client.query(`UPDATE signal_mention_facet_overrides old SET superseded_at=now()
      FROM jsonb_to_recordset($2::jsonb) patch(root_id uuid,dimension text)
      WHERE old.workspace_id=$1 AND old.root_id=patch.root_id AND old.dimension=patch.dimension AND old.superseded_at IS NULL`,
      [args.workspace_id, payload]);
    await client.query(`INSERT INTO signal_mention_facet_overrides(workspace_id,root_id,dimension,value,actor_user_id)
      SELECT $1,patch.root_id,patch.dimension,COALESCE(patch.value,'null'::jsonb),$3
      FROM jsonb_to_recordset($2::jsonb) patch(root_id uuid,dimension text,value jsonb)`,
      [args.workspace_id, payload, args.actor_user_id]);
    await client.query("COMMIT");
    return { updated: current.size };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Current provenance rights, with import-specific bindings taking precedence. */
const facetDisplayPopulation = `WITH display_roots AS MATERIALIZED (
  SELECT DISTINCT origin.canonical_mention_id root_id
  FROM signal_mention_import_memberships path
  JOIN mentions origin ON origin.id=path.mention_id AND origin.workspace_id=$1
  JOIN import_batches batch ON batch.id=path.import_batch_id AND batch.workspace_id=$1
    AND batch.data_source_id=path.data_source_id AND batch.status='completed'
  JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=$1 AND source.status='active'
  JOIN LATERAL (SELECT b.* FROM signal_provenance_policy_bindings b
    WHERE b.workspace_id=$1 AND b.data_source_id=source.id AND b.status='active'
      AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
      AND (b.import_batch_id=batch.id OR b.import_batch_id IS NULL)
    ORDER BY (b.import_batch_id IS NOT NULL) DESC,b.binding_version DESC,b.id LIMIT 1) binding ON true
  JOIN signal_licensing_policies license ON license.id=binding.licensing_policy_id AND license.workspace_id=$1
    AND license.status='active' AND license.effective_from<=now() AND (license.effective_to IS NULL OR license.effective_to>now())
  JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id AND retention.workspace_id=$1
    AND retention.status='active' AND retention.retention_state='allowed' AND retention.effective_from<=now()
    AND (retention.effective_to IS NULL OR retention.effective_to>now())
    AND (retention.retention_mode='indefinite' OR retention.retention_mode='until' AND retention.retain_until>now())
  WHERE path.workspace_id=$1 AND NOT EXISTS (
    SELECT purpose FROM unnest(ARRAY['client-derived-metrics','client-mention-list','client-text-or-excerpt']) purpose
    WHERE NOT EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage WHERE usage.workspace_id=$1
      AND usage.licensing_policy_id=license.id AND usage.usage_purpose=purpose AND usage.decision='allowed'))
), current_facets AS MATERIALIZED (
  -- Keep the canonical human/context projection, but evaluate it once per workspace.
  -- Joining the expanded view directly to underestimated rights roots caused its
  -- entire population and correlated label lookups to run again for every root.
  SELECT workspace_id,root_id,full_text,title,platform,status,facets,requires_context_review,pending_context_review
  FROM signal_mention_facets_current_v1 WHERE workspace_id=$1
), scoped AS MATERIALIZED (
  SELECT f.*,m.url,o.patch,
    f.root_id=ANY($2::uuid[]) stale
  FROM current_facets f JOIN display_roots d USING(root_id)
  JOIN mentions m ON m.id=f.root_id AND m.workspace_id=$1
  LEFT JOIN LATERAL (SELECT jsonb_object_agg(o.dimension,o.value) patch FROM signal_mention_facet_overrides o
    WHERE o.workspace_id=f.workspace_id AND o.root_id=f.root_id AND o.superseded_at IS NULL) o ON true
  WHERE f.workspace_id=$1 AND m.inclusion_status='included' AND m.canonical_mention_id=m.id
), projected AS MATERIALIZED (
  SELECT scoped.*,CASE WHEN stale THEN CASE WHEN patch IS NOT NULL THEN
    '${JSON.stringify(emptyHumanFacets())}'::jsonb || patch ELSE NULL END ELSE facets END effective_facets,
    requires_context_review OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(patch#>'{entities,value}','[]')) entity
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements($3::jsonb->'entities') known
        WHERE known->>'entity_id'=entity->>'entity_id' AND known->>'kind'=entity->>'kind')) review
  FROM scoped
), population AS MATERIALIZED (
  SELECT root_id,full_text text,title,platform,url,
    CASE WHEN review THEN 'error' WHEN stale THEN 'pending' ELSE status END status,
    CASE WHEN review THEN 'unknown'
      WHEN NOT COALESCE((effective_facets#>>'{spam_or_bot,abstained}')::boolean,true) AND (effective_facets#>>'{spam_or_bot,value}')::boolean THEN 'spam'
      WHEN effective_facets IS NULL OR (effective_facets#>>'{entities,abstained}')::boolean THEN 'unknown'
      WHEN jsonb_array_length(effective_facets#>'{entities,value}')>0 THEN 'relevant'
      WHEN effective_facets->>'unrelated_reason' IN('homonym','off_topic') THEN 'unrelated' ELSE 'unknown' END relevance,
    CASE WHEN review THEN NULL ELSE effective_facets END facets,review requires_context_review,pending_context_review,
    COALESCE((SELECT jsonb_agg(key) FROM jsonb_object_keys(patch) key),'[]') human_dimensions
  FROM projected
)`;

export async function loadMentionFacetBrowserV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
  dimension?: string; value?: string; cursor?: string; root_id?: string; limit?: number;
}) {
  const dimensions = ["status", "relevance", "entities", "voice", "act", "spam_or_bot", "language", "asunto", "salience"];
  if (args.dimension && !dimensions.includes(args.dimension)) throw new Error("facets_filter_invalid");
  const client = await args.database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ ...args, queryable: client });
    if (!caps.can_view) throw new Error("facets_forbidden");
    const change = await inspectFacetContextChangeV1(client, args.workspace_id);
    const parameters = [args.workspace_id, change.changed ? change.affected : [], JSON.stringify(change.context)];
    const distributions = (await client.query<{dimension: string; value: string; count: number}>(`${facetDisplayPopulation}
      SELECT dimension,value,count(*)::int count FROM population p CROSS JOIN LATERAL (
        SELECT 'status' dimension,p.status value UNION ALL SELECT 'relevance',p.relevance
        UNION ALL SELECT dimension,CASE WHEN (p.facets->dimension->>'abstained')::boolean THEN 'abstained'
          ELSE COALESCE(p.facets->dimension->>'value','abstained') END
          FROM unnest(ARRAY['voice','act','spam_or_bot','language','asunto']) dimension
        UNION ALL SELECT 'entities',entity->>'entity_id' FROM jsonb_array_elements(COALESCE(p.facets#>'{entities,value}','[]')) entity
        UNION ALL SELECT 'salience',entity->>'salience' FROM jsonb_array_elements(COALESCE(p.facets#>'{entities,value}','[]')) entity
        UNION ALL SELECT 'entities','abstained' WHERE p.facets IS NULL OR (p.facets#>>'{entities,abstained}')::boolean
      ) dimension_values GROUP BY dimension,value ORDER BY dimension,count DESC,value`, parameters)).rows;
    const limit = Math.max(1, Math.min(100, args.limit ?? 30));
    const items = (await client.query<{root_id:string;text:string;title:string|null;url:string|null;platform:string|null;
      status:string;relevance:string;facets:MentionFacetsV1|null;requires_context_review:boolean;pending_context_review:boolean;human_dimensions:string[]}>(`${facetDisplayPopulation}
      SELECT * FROM population p WHERE ($8::uuid IS NULL OR p.root_id=$8::uuid) AND ($4::uuid IS NULL OR p.root_id>$4::uuid) AND ($5::text IS NULL OR
        CASE WHEN $5='status' THEN p.status=$6 WHEN $5='relevance' THEN p.relevance=$6
          WHEN $5 IN('entities','salience') THEN CASE WHEN $6='abstained' THEN p.facets IS NULL OR (p.facets#>>'{entities,abstained}')::boolean
            ELSE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.facets#>'{entities,value}','[]')) e
              WHERE e->>(CASE WHEN $5='entities' THEN 'entity_id' ELSE 'salience' END)=$6) END
          WHEN $6='abstained' THEN p.facets IS NULL OR (p.facets->$5->>'abstained')::boolean
          ELSE NOT (p.facets->$5->>'abstained')::boolean AND p.facets->$5->>'value'=$6 END)
      ORDER BY p.root_id LIMIT $7`, [...parameters, args.cursor ?? null, args.dimension ?? null, args.value ?? null, limit + 1, args.root_id ?? null])).rows;
    const labeler = (await client.query<{status:string}>(`SELECT l.status FROM signal_workspace_labelers w
      JOIN signal_labeler_versions l ON l.id=w.labeler_version_id WHERE w.workspace_id=$1 AND w.kind='facets'`, [args.workspace_id])).rows[0];
    await client.query("COMMIT");
    return { contract_version: "mention-facets-browser-v1", workspace_id: args.workspace_id,
      can_edit: caps.can_edit_topics, can_request_processing: caps.can_request_processing,
      labeler_status: labeler?.status ?? null, entities: change.context.entities.map(({entity_id,name,kind})=>({entity_id,name,kind})),
      distributions, items: items.slice(0,limit), next_cursor: items.length>limit ? items[limit-1]!.root_id : null };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
