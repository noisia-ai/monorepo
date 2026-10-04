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
  effectiveEntitiesDigestV1,
  validateMentionFacetsV1,
  signalWorkspaceEmbeddingDigestV1 as digest,
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
  const roots = changed
    ? (
        await client.query<{
          root_id: string;
          title: string | null;
          full_text: string;
          facets: FacetResult["facets"];
        }>(
          `SELECT root_id,title,full_text,facets FROM signal_mention_facets_current_v1 WHERE workspace_id=$1`,
          [workspaceId],
        )
      ).rows
    : [];
  const affected = roots
    .filter((r) =>
      isEntityContextAffectedV1(diff, {
        title: r.title,
        text: r.full_text,
        entity_ids: r.facets?.entities.value.map((e) => e.entity_id) ?? [],
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
  database: LabelingDatabaseV1;
  workspace_id: string;
  actor_user_id: string;
  root_id: string;
  dimension: string;
  value: unknown;
}) {
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",
      [args.workspace_id],
    );
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({
      ...args,
      queryable: client,
      lock_authority: true,
    });
    if (!caps.can_edit_topics) throw new Error("facets_forbidden");
    const row = (
      await client.query<{ facets: unknown }>(
        `SELECT COALESCE(current.facets,CASE WHEN current.requires_context_review THEN
          (SELECT label.facets FROM signal_mention_facet_labels label
           JOIN signal_workspace_labelers chosen ON chosen.workspace_id=label.workspace_id AND chosen.kind='facets'
           JOIN signal_labeler_versions version ON version.id=chosen.labeler_version_id AND version.labeler_digest=label.labeler_digest
           WHERE label.workspace_id=current.workspace_id AND label.input_digest=current.input_digest AND label.facets IS NOT NULL
           ORDER BY label.created_at DESC LIMIT 1)
          || COALESCE((SELECT jsonb_object_agg(dimension,value) FROM signal_mention_facet_overrides patch
           WHERE patch.workspace_id=current.workspace_id AND patch.root_id=current.root_id AND patch.superseded_at IS NULL),'{}'::jsonb)
          END) facets
         FROM signal_mention_facets_current_v1 current WHERE workspace_id=$1 AND root_id=$2`,
        [args.workspace_id, args.root_id],
      )
    ).rows[0];
    if (
      !row?.facets ||
      ![
        "entities",
        "unrelated_reason",
        "voice",
        "act",
        "spam_or_bot",
        "language",
        "asunto",
      ].includes(args.dimension)
    )
      throw new Error("facets_override_invalid");
    const before = row.facets as ReturnType<typeof validateMentionFacetsV1>;
    const candidate = { ...before, [args.dimension]: args.value };
    if (args.dimension === "unrelated_reason" && args.value !== null) {
      if (before.entities.value.length)
        throw new Error("facets_override_contradiction");
      candidate.entities = { ...before.entities, abstained: false };
    }
    const normalized = validateMentionFacetsV1(
      candidate,
      await loadFacetEntityContextV1(client, args.workspace_id),
    );
    const dimensions = new Set([args.dimension as keyof typeof normalized]);
    if (
      args.dimension === "entities" ||
      args.dimension === "unrelated_reason"
    ) {
      for (const dimension of ["entities", "unrelated_reason"] as const) {
        if (
          digest(normalized[dimension]) !==
          digest((row.facets as typeof normalized)[dimension])
        )
          dimensions.add(dimension);
      }
    }
    const patches = [...dimensions].map((dimension) => ({
      dimension,
      value: normalized[dimension],
    }));
    await client.query(
      "UPDATE signal_mention_facet_overrides SET superseded_at=now() WHERE workspace_id=$1 AND root_id=$2 AND dimension=ANY($3::text[]) AND superseded_at IS NULL",
      [args.workspace_id, args.root_id, [...dimensions]],
    );
    await client.query(
      `INSERT INTO signal_mention_facet_overrides(workspace_id,root_id,dimension,value,actor_user_id)
       SELECT $1,$2,patch.dimension,COALESCE(patch.value,'null'::jsonb),$4
       FROM jsonb_to_recordset($3::jsonb) patch(dimension text,value jsonb)`,
      [
        args.workspace_id,
        args.root_id,
        JSON.stringify(patches),
        args.actor_user_id,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
