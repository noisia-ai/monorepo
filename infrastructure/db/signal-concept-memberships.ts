import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  conceptForJudgeSchemaV1,
  conceptCompatibleV1,
  conceptSetDigestV1,
  membershipLabelerIdentityV1,
  signalWorkspaceEmbeddingDigestV1 as digest,
  type ConceptForJudgeV1,
  type MembershipInputV1,
  type MembershipResultV1,
  type EntityContextV1,
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import {
  inspectFacetContextChangeV1,
  type LabelingDatabaseV1,
} from "./signal-mention-facets";
import {
  createSignalLabelingStoreV1,
  requestMentionFacetsV1,
  SignalLabelingError,
  type LabelingRunV1,
} from "./signal-labeling-runs";
type Queryable = Pick<PoolClient, "query">;
type Snapshot = {
  preview: boolean;
  concepts: ConceptForJudgeV1[];
  sample_root_ids: string[] | null;
};
export type MembershipRunV1 = LabelingRunV1 & { membership_snapshot: Snapshot };
const fail = (code: string, status = 409): never => {
  throw new SignalLabelingError(code, status);
};
async function transaction<T>(
  database: LabelingDatabaseV1,
  work: (c: PoolClient) => Promise<T>,
) {
  const c = await database.connect();
  try {
    await c.query("BEGIN");
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function authorize(
  c: Queryable,
  workspace_id: string,
  actor_user_id: string,
  edit = false,
) {
  const caps = await loadSignalWorkspaceCapabilitiesStoreV1({
    queryable: c,
    workspace_id,
    actor_user_id,
    lock_authority: edit,
  });
  if (edit ? !caps.can_edit_topics : !caps.can_view)
    fail("membership_forbidden", 403);
  return caps;
}
export async function loadMembershipConceptsV1(
  c: Queryable,
  workspace: string,
): Promise<ConceptForJudgeV1[]> {
  const rows = (
    await c.query<{ concept_key: string; topic: Record<string, unknown> }>(
      "SELECT concept_key,topic FROM signal_membership_concepts_v1 WHERE workspace_id=$1 ORDER BY concept_key",
      [workspace],
    )
  ).rows;
  return rows.map((r) =>
    conceptForJudgeSchemaV1.parse({
      concept_key: r.concept_key,
      ...Object.fromEntries(
        [
          "label",
          "scope",
          "definition",
          "inclusion",
          "exclusion",
          "positive_examples",
          "negative_examples",
          "definition_digest",
        ].map((key) => [key, r.topic[key]]),
      ),
    }),
  );
}
function snapshot(run: LabelingRunV1): Snapshot {
  const s = (run as MembershipRunV1).membership_snapshot;
  if (!s?.concepts) fail("membership_snapshot_missing");
  return s;
}
/** Select by full-text fingerprint, effective entities and per-concept definition. No vectors or V2 classifications. */
export async function selectMembershipInputsV1(
  c: Queryable,
  run: LabelingRunV1,
): Promise<MembershipInputV1[]> {
  const s = snapshot(run);
  return (
    await c.query<MembershipInputV1>(
      `WITH concepts AS (SELECT * FROM jsonb_to_recordset($4::jsonb) c(concept_key text,definition_digest text,scope text)), roots AS (
 SELECT f.*,COALESCE(f.entity_context_digest,(SELECT digest FROM signal_entity_context_versions ce WHERE ce.workspace_id=f.workspace_id ORDER BY version_no DESC LIMIT 1)) effective_ce
 FROM signal_mention_facets_current_v1 f WHERE f.workspace_id=$1 AND f.relevance='relevant' AND NOT f.requires_context_review
 AND ($2::uuid IS NULL OR f.root_id>$2) AND ($3::uuid[] IS NULL OR f.root_id=ANY($3)))
 SELECT f.root_id,f.input_digest,f.input_digest root_fingerprint,f.full_text text,f.title,f.platform,f.content_type,f.author,f.published_at::text,f.language,
 f.effective_ce entity_context_digest,f.effective_entities_digest,f.facets#>'{entities,value}' entities,f.facets#>>'{voice,value}' voice,f.facets#>>'{act,value}' act,
 (SELECT jsonb_agg(concept) FROM jsonb_array_elements($4::jsonb) concept WHERE concept->>'concept_key'=ANY(pending.keys)) evaluated_concepts
 FROM roots f JOIN LATERAL (
 SELECT array_agg(c.concept_key) keys FROM concepts c
 WHERE (c.scope='all_conversations' OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.facets#>'{entities,value}') e WHERE e->>'kind'=c.scope))
 AND ($5::boolean OR NOT EXISTS(SELECT 1 FROM signal_concept_memberships_current_v1 current WHERE current.workspace_id=f.workspace_id AND current.root_id=f.root_id
 AND current.concept_key=c.concept_key AND current.definition_digest=c.definition_digest AND current.verdict NOT IN('pending','error') AND (current.source='human' OR current.labeler_digest=$6)))
 AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls uncertain JOIN signal_labeling_runs r ON r.id=uncertain.run_id
 WHERE uncertain.workspace_id=f.workspace_id AND r.kind='membership' AND uncertain.status IN('submitting','unknown')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(uncertain.inputs) i WHERE i->>'root_id'=f.root_id::text AND i->>'input_digest'=f.input_digest
 AND i->>'entity_context_digest'=f.effective_ce AND i->>'effective_entities_digest'=f.effective_entities_digest
 AND i->'evaluated_concepts' @> jsonb_build_array(jsonb_build_object('concept_key',c.concept_key,'definition_digest',c.definition_digest))))
 ) pending ON cardinality(pending.keys)>0 ORDER BY f.root_id LIMIT 200`,
      [
        run.workspace_id,
        run.cursor_root_id,
        s.sample_root_ids,
        JSON.stringify(s.concepts),
        s.preview,
        run.labeler_digest,
      ],
    )
  ).rows;
}
function estimate(
  roots: number,
  characters: number,
  concepts: ConceptForJudgeV1[],
  context: EntityContextV1,
) {
  const requests = Math.ceil(roots / 8),
    input = Math.ceil(
      characters / 3.5 +
        (requests *
          (JSON.stringify(context).length +
            JSON.stringify(concepts).length +
            2500)) /
          3.5,
    );
  return {
    roots,
    estimated_requests: requests,
    estimated_micro_usd: Math.ceil(
      input * 2 + roots * Math.max(1, concepts.length) * 160 * 5,
    ),
  };
}
export async function requestConceptMembershipsV1(args: {
  database: LabelingDatabaseV1;
  workspace_id: string;
  actor_user_id: string;
  idempotency_key: string;
  budget_micro_usd?: number | null;
  cap_micro_usd?: number | null;
  full_recalculation?: boolean;
  provider_available: boolean;
  concept?: ConceptForJudgeV1;
}) {
  const identity = membershipLabelerIdentityV1();
  const previewConcept = args.concept
    ? conceptForJudgeSchemaV1.parse({
        ...args.concept,
        definition_digest: digest({
          ...args.concept,
          definition_digest: undefined,
        }),
      })
    : null;
  return requestMentionFacetsV1({
    ...args,
    identity,
    adapter: {
      request_identity: { kind: "membership", preview: previewConcept },
      select_labeler: !previewConcept,
      validateIdentity: (id) => {
        if (digest(id) !== digest(identity))
          fail("membership_identity_invalid");
      },
      prepare: async (c, w, _id, ld, context) => {
        const concepts = previewConcept
          ? [previewConcept]
          : await loadMembershipConceptsV1(c, w);
        if (!concepts.length) fail("membership_concepts_required");
        // Round-robin across platform/month strata, deterministically ordered within each stratum.
        const sample = previewConcept
          ? (
              await c.query<{ root_id: string }>(
                `SELECT root_id FROM (SELECT root_id,platform,published_at,row_number() OVER(PARTITION BY platform,date_trunc('month',published_at) ORDER BY input_digest,root_id) rank FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 AND relevance='relevant' AND NOT requires_context_review AND ($2='all_conversations' OR EXISTS(SELECT 1 FROM jsonb_array_elements(facets#>'{entities,value}') e WHERE e->>'kind'=$2))) sample ORDER BY rank,platform,published_at,root_id LIMIT 30`,
                [w, previewConcept.scope],
              )
            ).rows.map((r) => r.root_id)
          : null;
        const pop = (
          await c.query<{ roots: number; characters: string }>(
            `SELECT count(*)::int roots,COALESCE(sum(length(full_text)),0)::text characters FROM signal_mention_facets_current_v1 f WHERE workspace_id=$1 AND relevance='relevant' AND ($2::uuid[] IS NULL OR root_id=ANY($2)) AND EXISTS(SELECT 1 FROM jsonb_to_recordset($3::jsonb) c(scope text) WHERE c.scope='all_conversations' OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.facets#>'{entities,value}') e WHERE e->>'kind'=c.scope))`,
            [w, sample, JSON.stringify(concepts)],
          )
        ).rows[0]!;
        return {
          ...estimate(pop.roots, Number(pop.characters), concepts, context),
          snapshot: {
            preview: !!previewConcept,
            concepts,
            sample_root_ids: sample,
          },
          concept_set_digest: conceptSetDigestV1(concepts),
        };
      },
      persist: async (c, id, p) => {
        await c.query(
          "UPDATE signal_labeling_runs SET membership_snapshot=$2::jsonb,concept_set_digest=$3 WHERE id=$1",
          [id, JSON.stringify(p.snapshot), p.concept_set_digest],
        );
      },
    },
  });
}
export function createConceptMembershipStoreV1(
  options: Omit<Parameters<typeof createSignalLabelingStoreV1>[0], "adapter">,
) {
  return createSignalLabelingStoreV1<MembershipInputV1, MembershipResultV1>({
    ...options,
    adapter: {
      kind: "membership",
      inputs: selectMembershipInputsV1,
      authority: async (c, run) => {
        if (
          !snapshot(run).preview &&
          conceptSetDigestV1(
            await loadMembershipConceptsV1(c, run.workspace_id),
          ) !== conceptSetDigestV1(snapshot(run).concepts)
        )
          fail("labeling_concepts_changed");
      },
      pending: async (c, run) =>
        Number(
          (
            await c.query(
              `SELECT count(*) count FROM signal_concept_memberships_current_v1 WHERE workspace_id=$1 AND verdict='pending'`,
              [run.workspace_id],
            )
          ).rows[0]!.count,
        ) * (snapshot(run).preview ? 0 : 1),
      write: async (c, run, pages) => {
        if (snapshot(run).preview) return;
        const rows = pages.flatMap((p) =>
          p.results
            .filter((r) => r.verdict !== "error")
            .map((r) => ({ ...r, call_id: p.call.id })),
        );
        if (!rows.length) return;
        await c.query(
          `INSERT INTO signal_concept_memberships(workspace_id,root_id,root_fingerprint,concept_key,definition_digest,labeler_digest,entity_context_digest,effective_entities_digest,run_id,call_id,verdict,citations,rationale)
   SELECT $1,r.root_id,r.root_fingerprint,r.concept_key,r.definition_digest,$2,r.entity_context_digest,r.effective_entities_digest,$3,r.call_id,r.verdict,r.citations,r.rationale
   FROM jsonb_to_recordset($4::jsonb) r(root_id uuid,root_fingerprint text,concept_key text,definition_digest text,entity_context_digest text,effective_entities_digest text,call_id uuid,verdict text,citations jsonb,rationale text) ON CONFLICT DO NOTHING`,
          [run.workspace_id, run.labeler_digest, run.id, JSON.stringify(rows)],
        );
      },
    },
  });
}
export type ConceptMembershipStoreV1 = ReturnType<
  typeof createConceptMembershipStoreV1
>;
export type MembershipAccessV1 = {
  database: LabelingDatabaseV1;
  workspace_id: string;
  actor_user_id: string;
};
const latestSql = `SELECT r.id,r.status,r.counts,r.estimated_micro_usd::text,r.budget_micro_usd::text,r.cap_micro_usd::text,r.waiting_full_confirmation,r.entity_context_digest,r.error_code,
 COALESCE((SELECT sum(settled_micro_usd) FROM signal_labeling_calls WHERE run_id=r.id AND status='settled'),0)::text settled_micro_usd,
 COALESCE((SELECT sum(reserved_micro_usd) FROM signal_labeling_calls WHERE run_id=r.id AND status IN('reserved','submitting','submitted','unknown')),0)::text reserved_micro_usd
 FROM signal_labeling_runs r WHERE r.workspace_id=$1 AND r.kind='membership'`;
export async function loadConceptMembershipsStatusV1(
  args: MembershipAccessV1 & {
    concept_key?: string | null;
    verdict?: string | null;
    cursor?: string | null;
    limit?: number;
  },
) {
  return transaction(args.database, async (c) => {
    const caps = await authorize(c, args.workspace_id, args.actor_user_id);
    const change = await inspectFacetContextChangeV1(c, args.workspace_id);
    const concepts = await loadMembershipConceptsV1(c, args.workspace_id);
    const population = (
      await c.query(
        `SELECT count(*) FILTER(WHERE relevance='relevant')::int relevant,count(*) FILTER(WHERE relevance='unrelated')::int unrelated,count(*) FILTER(WHERE relevance='unknown')::int unknown,count(*) FILTER(WHERE relevance='spam')::int spam,
   count(*) FILTER(WHERE relevance='relevant' AND NOT EXISTS(SELECT 1 FROM signal_concept_memberships_current_v1 m WHERE m.workspace_id=f.workspace_id AND m.root_id=f.root_id AND m.verdict='belongs'))::int without_concept,COALESCE(sum(length(full_text)) FILTER(WHERE relevance='relevant'),0)::text characters FROM signal_mention_facets_current_v1 f WHERE workspace_id=$1 AND EXISTS(SELECT 1 FROM signal_membership_evidence_rights_v1 rights WHERE rights.workspace_id=f.workspace_id AND rights.root_id=f.root_id AND rights.metrics)`,
        [args.workspace_id],
      )
    ).rows[0]!;
    const counts = (
      await c.query(
        "SELECT verdict,count(*)::int count FROM signal_concept_memberships_current_v1 m WHERE workspace_id=$1 AND EXISTS(SELECT 1 FROM signal_membership_evidence_rights_v1 rights WHERE rights.workspace_id=m.workspace_id AND rights.root_id=m.root_id AND rights.metrics) GROUP BY verdict",
        [args.workspace_id],
      )
    ).rows;
    const latest =
      (
        await c.query(
          `${latestSql} AND NOT COALESCE((membership_snapshot->>'preview')::boolean,false) ORDER BY r.created_at DESC LIMIT 1`,
          [args.workspace_id],
        )
      ).rows[0] ?? null;
    const selections = (
      await c.query(
        "SELECT term_key,selected,selection_revision::int,definition_digest FROM signal_defined_interest_selections WHERE workspace_id=$1 AND generation_id IS NULL",
        [args.workspace_id],
      )
    ).rows;
    const limit = Math.min(100, Math.max(1, args.limit ?? 50));
    let cursorRoot: string | null = null,
      cursorConcept: string | null = null;
    if (args.cursor) {
      const parts = args.cursor.split(":");
      if (
        parts.length !== 2 ||
        !/^[a-f0-9-]{36}$/u.test(parts[0]!) ||
        !parts[1]
      )
        fail("membership_cursor_invalid", 400);
      [cursorRoot, cursorConcept] = parts as [string, string];
    }
    const rows = (
      await c.query(
        `SELECT m.*,CASE WHEN rights.evidence THEN f.full_text ELSE NULL END text,CASE WHEN rights.evidence THEN f.title ELSE NULL END title,
   CASE WHEN rights.evidence THEN mention.url ELSE NULL END url, f.platform,NOT COALESCE(rights.evidence,false) evidence_withheld,
   CASE WHEN rights.evidence THEN m.citations ELSE '[]'::jsonb END visible_citations,
   CASE WHEN rights.evidence THEN m.rationale ELSE NULL END visible_rationale
   FROM signal_concept_memberships_current_v1 m JOIN signal_mention_facets_current_v1 f ON f.workspace_id=m.workspace_id AND f.root_id=m.root_id
   JOIN mentions mention ON mention.id=m.root_id LEFT JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=m.workspace_id AND rights.root_id=m.root_id
   WHERE m.workspace_id=$1 AND rights.metrics AND ($2::text IS NULL OR m.concept_key=$2) AND ($3::text IS NULL OR m.verdict=$3)
   AND ($4::uuid IS NULL OR (m.root_id,m.concept_key)>($4::uuid,$5::text)) ORDER BY m.root_id,m.concept_key LIMIT $6`,
        [
          args.workspace_id,
          args.concept_key ?? null,
          args.verdict ?? null,
          cursorRoot,
          cursorConcept,
          limit + 1,
        ],
      )
    ).rows;
    const items = rows
      .slice(0, limit)
      .map(
        ({
          citations: _c,
          rationale: _r,
          visible_citations,
          visible_rationale,
          ...row
        }) => ({
          ...row,
          citations: visible_citations,
          rationale: visible_rationale,
        }),
      );
    return {
      contract_version: "concept-membership-status-v1",
      can_request_processing: caps.can_request_processing,
      can_edit_topics: caps.can_edit_topics,
      counts,
      population,
      latest,
      entity_context_digest: change.digest,
      stale_count: change.changed ? change.affected.length : 0,
      estimated_micro_usd: estimate(
        population.relevant,
        Number(population.characters),
        concepts,
        change.context,
      ).estimated_micro_usd,
      preview_estimated_micro_usd: estimate(
        Math.min(30, population.relevant),
        population.relevant
          ? Math.ceil(
              (Number(population.characters) *
                Math.min(30, population.relevant)) /
                population.relevant,
            )
          : 0,
        concepts,
        change.context,
      ).estimated_micro_usd,
      concepts: concepts.map((concept) => {
        const selection = selections.find(
          (s) => s.term_key === concept.concept_key,
        );
        return {
          ...concept,
          selected:
            !!selection?.selected &&
            selection.definition_digest === concept.definition_digest,
          selection_revision: selection?.selection_revision ?? 0,
        };
      }),
      items,
      next_cursor:
        rows.length > limit
          ? `${items.at(-1)!.root_id}:${items.at(-1)!.concept_key}`
          : null,
    };
  });
}
export async function loadConceptMembershipPreviewV1(
  args: MembershipAccessV1 & { run_id: string },
) {
  return transaction(args.database, async (c) => {
    const caps = await authorize(c, args.workspace_id, args.actor_user_id);
    if (!caps.can_request_processing) fail("membership_forbidden", 403);
    const run = (
      await c.query(
        `${latestSql} AND r.id=$2 AND (membership_snapshot->>'preview')::boolean`,
        [args.workspace_id, args.run_id],
      )
    ).rows[0];
    if (!run) fail("membership_preview_not_found", 404);
    const rows = (
      await c.query(
        `SELECT DISTINCT ON(result->>'root_id',result->>'concept_key') result,
   CASE WHEN rights.evidence THEN f.full_text ELSE NULL END text,CASE WHEN rights.evidence THEN f.title ELSE NULL END title,
   CASE WHEN rights.evidence THEN mention.url ELSE NULL END url,f.platform,NOT COALESCE(rights.evidence,false) evidence_withheld
   FROM signal_labeling_calls call CROSS JOIN LATERAL jsonb_array_elements(call.results) result
   JOIN signal_mention_facets_current_v1 f ON f.workspace_id=call.workspace_id AND f.root_id=(result->>'root_id')::uuid
   JOIN mentions mention ON mention.id=f.root_id LEFT JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=f.workspace_id AND rights.root_id=f.root_id
   WHERE call.run_id=$1 AND call.workspace_id=$2 AND rights.metrics AND call.results_applied ORDER BY result->>'root_id',result->>'concept_key',call.created_at DESC`,
        [args.run_id, args.workspace_id],
      )
    ).rows;
    return {
      contract_version: "concept-membership-preview-v1",
      run,
      sample_size: 30,
      items: rows.map(({ result, ...row }) => ({
        ...result,
        ...row,
        source: "model",
        citations: row.evidence_withheld ? [] : result.citations,
        rationale: row.evidence_withheld ? null : result.rationale,
      })),
    };
  });
}
export async function overrideConceptMembershipsV1(
  args: MembershipAccessV1 & {
    overrides: Array<{
      root_id: string;
      concept_key: string;
      verdict: "belongs" | "not_belongs";
    }>;
  },
) {
  if (
    !args.overrides.length ||
    args.overrides.length > 500 ||
    new Set(args.overrides.map((r) => `${r.root_id}:${r.concept_key}`)).size !==
      args.overrides.length
  )
    fail("membership_overrides_invalid", 400);
  return transaction(args.database, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",
      [args.workspace_id],
    );
    await authorize(c, args.workspace_id, args.actor_user_id, true);
    const matches = (
      await c.query(
        `SELECT count(*)::int count FROM jsonb_to_recordset($2::jsonb) r(root_id uuid,concept_key text,verdict text) JOIN signal_concept_memberships_current_v1 m ON m.workspace_id=$1 AND m.root_id=r.root_id AND m.concept_key=r.concept_key WHERE r.verdict IN('belongs','not_belongs')`,
        [args.workspace_id, JSON.stringify(args.overrides)],
      )
    ).rows[0]!.count;
    if (matches !== args.overrides.length)
      fail("membership_override_target_invalid", 400);
    await c.query(
      `UPDATE signal_concept_membership_overrides o SET superseded_at=now() FROM jsonb_to_recordset($2::jsonb) r(root_id uuid,concept_key text) WHERE o.workspace_id=$1 AND o.root_id=r.root_id AND o.concept_key=r.concept_key AND o.superseded_at IS NULL`,
      [args.workspace_id, JSON.stringify(args.overrides)],
    );
    await c.query(
      `INSERT INTO signal_concept_membership_overrides(workspace_id,root_id,concept_key,verdict,actor_user_id) SELECT $1,r.root_id,r.concept_key,r.verdict,$3 FROM jsonb_to_recordset($2::jsonb) r(root_id uuid,concept_key text,verdict text)`,
      [args.workspace_id, JSON.stringify(args.overrides), args.actor_user_id],
    );
    return { updated: args.overrides.length };
  });
}
export async function selectConceptMembershipV1(
  args: MembershipAccessV1 & {
    idempotency_key: string;
    selection: {
      concept_key: string;
      selected: boolean;
      expected_selection_revision: number;
    };
  },
) {
  return transaction(args.database, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",
      [args.workspace_id],
    );
    await authorize(c, args.workspace_id, args.actor_user_id, true);
    const requestDigest = digest({
      actor: args.actor_user_id,
      ...args.selection,
    });
    const replay = (
      await c.query(
        "SELECT request_digest,result_selection FROM signal_defined_interest_selection_operations WHERE workspace_id=$1 AND idempotency_key=$2",
        [args.workspace_id, args.idempotency_key],
      )
    ).rows[0];
    if (replay) {
      if (replay.request_digest !== requestDigest)
        fail("membership_selection_conflict");
      return replay.result_selection;
    }
    const term = (
      await c.query(
        "SELECT * FROM signal_membership_concepts_v1 WHERE workspace_id=$1 AND concept_key=$2",
        [args.workspace_id, args.selection.concept_key],
      )
    ).rows[0];
    if (!term) fail("membership_concept_not_found", 404);
    const prior = (
      await c.query(
        "SELECT selection_revision::int FROM signal_defined_interest_selections WHERE workspace_id=$1 AND term_key=$2 FOR UPDATE",
        [args.workspace_id, args.selection.concept_key],
      )
    ).rows[0];
    if (
      (prior?.selection_revision ?? 0) !==
      args.selection.expected_selection_revision
    )
      fail("membership_selection_conflict");
    const operation = randomUUID();
    const result = {
      workspace_id: args.workspace_id,
      snapshot_id: null,
      generation_id: null,
      taxonomy_term_id: term.taxonomy_term_id,
      term_key: args.selection.concept_key,
      definition_digest: term.definition_digest,
      definition_revision: term.topic.definition_revision,
      selected: args.selection.selected,
      selection_revision: (prior?.selection_revision ?? 0) + 1,
      selection_digest: digest({ requestDigest, operation }),
      operation_id: operation,
    };
    await c.query(
      `INSERT INTO signal_defined_interest_selection_operations(id,workspace_id,actor_user_id,idempotency_key,request_digest,term_key,request,result_selection) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
      [
        operation,
        args.workspace_id,
        args.actor_user_id,
        args.idempotency_key,
        requestDigest,
        args.selection.concept_key,
        JSON.stringify(args.selection),
        JSON.stringify(result),
      ],
    );
    await c.query(
      `INSERT INTO signal_defined_interest_selections(workspace_id,term_key,snapshot_id,generation_id,taxonomy_term_id,definition_digest,definition_revision,selected,selection_revision,selection_digest,operation_id)
   VALUES($1,$2,NULL,NULL,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,term_key) DO UPDATE SET snapshot_id=NULL,generation_id=NULL,taxonomy_term_id=excluded.taxonomy_term_id,definition_digest=excluded.definition_digest,definition_revision=excluded.definition_revision,selected=excluded.selected,selection_revision=excluded.selection_revision,selection_digest=excluded.selection_digest,operation_id=excluded.operation_id,updated_at=now()`,
      [
        args.workspace_id,
        result.term_key,
        result.taxonomy_term_id,
        result.definition_digest,
        result.definition_revision,
        result.selected,
        result.selection_revision,
        result.selection_digest,
        operation,
      ],
    );
    return result;
  });
}
