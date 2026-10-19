import { createHash } from "node:crypto";

import type pg from "pg";

export type SignalWorkspaceHashTarget = {
  workspace_id: string;
  brand_id: string;
  brand_slug: string;
};

export type SignalWorkspaceContentHash = { row_count: number; digest: string };

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashPayloads(payloads: string[]) {
  const hash = createHash("sha256");
  for (const payload of payloads) {
    hash.update(`${Buffer.byteLength(payload, "utf8")}:`);
    hash.update(payload, "utf8");
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

const CONTENT_DOMAINS = [
  {
    name: "canonical_roots",
    sql: `
      SELECT mention.workspace_id::text AS workspace_id,
        jsonb_build_array(
          mention.workspace_id::text, mention.id::text,
          mention.canonical_mention_id::text,
          COALESCE(mention.data_source_id::text, ''),
          COALESCE(mention.source_file_id::text, ''),
          COALESCE(mention.study_corpus_id::text, ''),
          COALESCE(mention.source_system, ''), COALESCE(mention.external_id, ''),
          COALESCE(mention.provider_record_id, ''), COALESCE(mention.text_hash, ''),
          mention.inclusion_status, COALESCE(mention.quality_score::text, ''),
          COALESCE(to_char(mention.published_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
        )::text AS row_payload
      FROM mentions mention
      WHERE mention.workspace_id = ANY($1::uuid[])
        AND mention.canonical_mention_id = mention.id
      ORDER BY mention.workspace_id, mention.id
    `
  },
  {
    name: "canonical_aliases",
    sql: `
      SELECT mention.workspace_id::text AS workspace_id,
        jsonb_build_array(
          mention.workspace_id::text, mention.id::text,
          mention.canonical_mention_id::text,
          COALESCE(mention.data_source_id::text, ''),
          COALESCE(mention.source_file_id::text, ''),
          COALESCE(mention.study_corpus_id::text, ''),
          COALESCE(mention.source_system, ''), COALESCE(mention.external_id, ''),
          COALESCE(mention.provider_record_id, ''), COALESCE(mention.text_hash, ''),
          mention.inclusion_status, COALESCE(mention.quality_score::text, ''),
          COALESCE(to_char(mention.published_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
        )::text AS row_payload
      FROM mentions mention
      WHERE mention.workspace_id = ANY($1::uuid[])
        AND mention.canonical_mention_id <> mention.id
      ORDER BY mention.workspace_id, mention.id
    `
  },
  {
    name: "import_provenance",
    sql: `
      SELECT membership.workspace_id::text AS workspace_id,
        jsonb_build_array(
          membership.workspace_id::text, membership.mention_id::text,
          membership.import_batch_id::text, membership.data_source_id::text
        )::text AS row_payload
      FROM signal_mention_import_memberships membership
      WHERE membership.workspace_id = ANY($1::uuid[])
      ORDER BY membership.workspace_id, membership.mention_id,
               membership.import_batch_id, membership.data_source_id
    `
  },
  {
    name: "study_provenance",
    sql: `
      SELECT membership.workspace_id::text AS workspace_id,
        jsonb_build_array(
          membership.workspace_id::text, membership.mention_id::text,
          membership.study_corpus_id::text,
          COALESCE(membership.import_batch_id::text, ''), membership.membership_role
        )::text AS row_payload
      FROM signal_mention_study_memberships membership
      WHERE membership.workspace_id = ANY($1::uuid[])
      ORDER BY membership.workspace_id, membership.mention_id,
               membership.study_corpus_id, membership.membership_role,
               membership.import_batch_id
    `
  },
  {
    name: "attributions",
    sql: `
      SELECT attribution.workspace_id::text AS workspace_id,
        jsonb_build_array(
          attribution.workspace_id::text, attribution.mention_id::text,
          attribution.data_source_id::text,
          COALESCE(attribution.import_batch_id::text, ''), attribution.scope,
          attribution.entity_type, COALESCE(attribution.entity_id::text, ''),
          COALESCE(attribution.entity_label, ''), COALESCE(attribution.confidence::text, ''),
          attribution.review_status, attribution.attribution_source,
          attribution.policy_version, COALESCE(attribution.model_version, ''),
          COALESCE(attribution.approved_by_user_id::text, ''),
          COALESCE(attribution.approval_source, ''),
          COALESCE(to_char(attribution.approved_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
        )::text AS row_payload
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id = ANY($1::uuid[])
      ORDER BY attribution.workspace_id, attribution.mention_id,
               attribution.data_source_id, attribution.import_batch_id,
               attribution.scope, attribution.entity_type, attribution.entity_id
    `
  },
  {
    name: "operational_population_memberships",
    sql: `
      SELECT membership.workspace_id::text AS workspace_id,
        jsonb_build_array(
          membership.workspace_id::text, membership.population_id::text,
          membership.mention_id::text, membership.membership_status,
          membership.membership_reason, membership.removed_at IS NOT NULL
        )::text AS row_payload
      FROM signal_population_memberships membership
      JOIN signal_workspace_population_pointers pointer
        ON pointer.workspace_id = membership.workspace_id
       AND pointer.population_id = membership.population_id
       AND pointer.purpose = 'operational'
      WHERE membership.workspace_id = ANY($1::uuid[])
      ORDER BY membership.workspace_id, membership.population_id, membership.mention_id
    `
  },
  {
    name: "current_population_pointers",
    sql: `
      SELECT pointer.workspace_id::text AS workspace_id,
        jsonb_build_array(
          pointer.workspace_id::text, pointer.purpose, pointer.population_id::text,
          COALESCE(pointer.promoted_by_user_id::text, ''),
          COALESCE(to_char(pointer.promoted_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          definition.population_key, definition.version, definition.purpose,
          definition.status, definition.acceptance_status,
          ARRAY(SELECT scope FROM unnest(definition.allowed_scopes) scope ORDER BY scope),
          COALESCE(definition.min_quality_score::text, ''),
          COALESCE(definition.period_start::text, ''),
          COALESCE(definition.period_end::text, ''), definition.definition_hash
        )::text AS row_payload
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions definition
        ON definition.id = pointer.population_id
       AND definition.workspace_id = pointer.workspace_id
      WHERE pointer.workspace_id = ANY($1::uuid[])
      ORDER BY pointer.workspace_id, pointer.purpose, pointer.population_id
    `
  }
] as const;

export async function signalWorkspaceContentHashes(
  client: pg.Client,
  targets: SignalWorkspaceHashTarget[]
) {
  const workspaceIds = targets.map((target) => target.workspace_id);
  const domains: Record<string, SignalWorkspaceContentHash> = {};
  const byWorkspace = new Map<string, Record<string, SignalWorkspaceContentHash>>(
    workspaceIds.map((workspaceId) => [workspaceId, {}])
  );
  for (const domain of CONTENT_DOMAINS) {
    const result = await client.query<{ workspace_id: string; row_payload: string }>(
      domain.sql,
      [workspaceIds]
    );
    domains[domain.name] = {
      row_count: result.rows.length,
      digest: hashPayloads(result.rows.map((row) => row.row_payload))
    };
    for (const workspaceId of workspaceIds) {
      const rows = result.rows
        .filter((row) => row.workspace_id === workspaceId)
        .map((row) => row.row_payload);
      byWorkspace.get(workspaceId)![domain.name] = {
        row_count: rows.length,
        digest: hashPayloads(rows)
      };
    }
  }
  const aggregate = sha256(JSON.stringify(
    Object.entries(domains).sort(([left], [right]) => left.localeCompare(right))
  ));
  return {
    aggregate,
    domains,
    by_workspace: targets.map((target) => {
      const workspaceDomains = byWorkspace.get(target.workspace_id)!;
      return {
        workspace_key: sha256(target.workspace_id),
        brand_key: sha256(target.brand_id),
        brand_slug: target.brand_slug,
        aggregate: sha256(JSON.stringify(
          Object.entries(workspaceDomains).sort(([left], [right]) => left.localeCompare(right))
        )),
        domains: workspaceDomains
      };
    })
  };
}
