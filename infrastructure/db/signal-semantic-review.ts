import {
  resolveSignalSemanticCandidatesV1,
  SIGNAL_SEMANTIC_CANDIDATE_MODEL_VERSION,
  SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY,
  SIGNAL_SEMANTIC_CANDIDATE_POLICY_VERSION,
  SIGNAL_SEMANTIC_REVIEW_CURSOR_VERSION,
  SIGNAL_SEMANTIC_REVIEW_POLICY_KEY,
  SIGNAL_SEMANTIC_REVIEW_POLICY_VERSION,
  signalSemanticCandidateSetDigestV1,
  signalSemanticStableHashV1,
  type SignalSemanticCandidateResolutionV1,
  type SignalSemanticCandidateV1,
  type SignalSemanticConfidenceBandV1,
  type SignalSemanticEntityTypeV1,
  type SignalSemanticEvidenceKindV1,
  type SignalSemanticGovernedIdentityV1,
  type SignalSemanticQueueStateV1,
  type SignalSemanticScopeV1
} from "@noisia/query-engine";
import type { QueryResult, QueryResultRow } from "pg";

export type SignalSemanticQueryable = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

export type SignalSemanticReviewFiltersV1 = {
  mention_id?: string;
  state?: SignalSemanticQueueStateV1;
  proposed_scope?: SignalSemanticScopeV1;
  confidence_band?: SignalSemanticConfidenceBandV1;
  data_source_id?: string;
  platform?: string;
  start?: string;
  end?: string;
};

export type SignalSemanticReviewListInputV1 = {
  workspace_id: string;
  filters?: SignalSemanticReviewFiltersV1;
  cursor?: string | null;
  limit?: number;
};

export type SignalSemanticCurrentAssertionV1 = {
  id: string;
  scope: SignalSemanticScopeV1;
  entity_type: SignalSemanticEntityTypeV1;
  entity_id: string | null;
  entity_label: string | null;
  confidence: number | null;
  review_status: "pending" | "approved" | "rejected";
  eligibility_status: "not_eligible" | "candidate" | "eligible";
  evidence_kind: SignalSemanticEvidenceKindV1 | null;
  evidence_hash: string | null;
  semantic_policy_key: string | null;
  policy_version: string;
  model_version: string | null;
  approval_source: string | null;
  approved_at: string | null;
  approved_by_user_id: string | null;
  assertion_version: number;
  is_current: boolean;
  resolution_state:
    | "pending"
    | "approved_by_model"
    | "approved_by_human"
    | "approved_by_policy"
    | "rejected"
    | "superseded";
  created_at: string;
  updated_at: string;
};

export type SignalSemanticSourceIntentV1 = {
  attribution_id: string;
  data_source_id: string;
  source_name: string;
  import_batch_id: string | null;
  scope: SignalSemanticScopeV1;
  entity_type: SignalSemanticEntityTypeV1;
  entity_id: string | null;
  entity_label: string | null;
  review_status: string;
  policy_version: string;
};

export type SignalSemanticReviewQueueItemV1 = {
  mention_id: string;
  state: SignalSemanticQueueStateV1;
  published_at: string;
  platform: string;
  excerpt: string;
  title: string | null;
  account: { handle: string | null; display_name: string | null } | null;
  url_host: string | null;
  source_intent: SignalSemanticSourceIntentV1[];
  proposed_assertions: SignalSemanticCandidateV1[];
  current_assertions: SignalSemanticCurrentAssertionV1[];
  candidate_resolution: SignalSemanticCandidateResolutionV1["resolution_reason"];
};

export type SignalSemanticCandidateGenerationResultV1 = {
  workspace_id: string;
  included_root_count: number;
  state_counts: Record<SignalSemanticQueueStateV1, number>;
  candidate_assertion_count: number;
  candidate_counts_by_scope: Record<SignalSemanticScopeV1, number>;
  candidate_counts_by_confidence: Record<SignalSemanticConfidenceBandV1, number>;
  unresolved_count: number;
  needs_context_count: number;
  candidate_digest: string;
  created_count: number;
  existing_count: number;
  conflict_count: number;
  writes_performed: boolean;
};

export class SignalSemanticReviewContractError extends Error {
  constructor(
    public readonly code: "invalid_input" | "not_found" | "conflict" | "forbidden_state",
    message: string
  ) {
    super(message);
    this.name = "SignalSemanticReviewContractError";
  }
}

type WorkspaceIdentityRow = {
  workspace_id: string;
  organization_id: string;
  brand_id: string;
  brand_name: string;
  brand_slug: string;
  brand_handles: string[] | null;
};

type SemanticReviewIdentityContextRow = WorkspaceIdentityRow & {
  governance_available: boolean;
  brand_os_terms: Array<{
    term: string;
    term_type: string;
    brand_seed_id: string | null;
  }>;
  competitors: Array<{
    competitor_id: string;
    seed_id: string;
    canonical_name: string;
    aliases: string[] | null;
    detection_patterns: string[] | null;
  }>;
  entities: Array<{
    entity_id: string;
    entity_type: "category" | "reference";
    canonical_name: string;
    aliases: string[] | null;
  }>;
};

type MentionRow = {
  mention_id: string;
  published_at: string;
  platform: string;
  text_clean: string;
  text_snippet: string | null;
  title: string | null;
  url: string | null;
  author_handle: string | null;
  author_name: string | null;
  thread_context: string | null;
  review_requested_at: string | null;
  source_intents: unknown;
  current_assertions: unknown;
};

type ReviewQueueState = {
  workspace: WorkspaceIdentityRow;
  identities: SignalSemanticGovernedIdentityV1[];
  items: SignalSemanticReviewQueueItemV1[];
  resolutions: SignalSemanticCandidateResolutionV1[];
  digest: string;
};

type ProjectionStateRow = {
  current_generation: string | number;
  snapshot_digest: string | null;
  population_digest: string | null;
  projected_root_count: number;
  reconciled_at: string | null;
};

type ProjectionItemRow = {
  mention_id: string;
  queue_state: SignalSemanticQueueStateV1;
  published_at: string;
  platform: string;
  excerpt: string;
  title: string | null;
  account: { handle: string | null;display_name: string | null } | null;
  url_host: string | null;
  source_intents: unknown;
  proposed_assertions: unknown;
  current_assertions: unknown;
  candidate_resolution: SignalSemanticCandidateResolutionV1["resolution_reason"];
};

type ProjectionRecord = {
  mention_id: string;
  queue_state: SignalSemanticQueueStateV1;
  published_at: string;
  platform: string;
  excerpt: string;
  title: string | null;
  account: { handle: string | null; display_name: string | null } | null;
  url_host: string | null;
  source_intents: SignalSemanticSourceIntentV1[];
  source_ids: string[];
  proposed_assertions: SignalSemanticCandidateV1[];
  proposed_scopes: SignalSemanticScopeV1[];
  current_scopes: SignalSemanticScopeV1[];
  confidence_bands: SignalSemanticConfidenceBandV1[];
  current_assertions: SignalSemanticCurrentAssertionV1[];
  candidate_resolution: SignalSemanticCandidateResolutionV1["resolution_reason"];
  character_count: number;
  context_hash: string;
  projection_hash: string;
};

const QUEUE_STATES: SignalSemanticQueueStateV1[] = [
  "candidate_pending",
  "current_approved",
  "current_rejected",
  "unresolved",
  "needs_context"
];

const SCOPES: SignalSemanticScopeV1[] = [
  "primary_brand",
  "competitor",
  "category",
  "reference",
  "unattributed"
];

export async function loadSignalSemanticReviewQueueV1(
  queryable: SignalSemanticQueryable,
  input: SignalSemanticReviewListInputV1
) {
  const filters = input.filters ?? {};
  const filterHash = signalSemanticStableHashV1(normalizeReviewFilters(filters));
  const projection = await loadReadyProjectionState(queryable,input.workspace_id);
  const generation=Number(projection.current_generation);
  const cursor = input.cursor ? decodeReviewCursor(input.cursor) : null;
  if (cursor && (
    cursor.workspace_id !== input.workspace_id
    || cursor.filter_hash !== filterHash
    || cursor.queue_digest !== projection.snapshot_digest
  )) {
    throw new SignalSemanticReviewContractError(
      "conflict",
      "Semantic Review cursor no longer matches the governed queue state."
    );
  }
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new SignalSemanticReviewContractError("invalid_input", "limit must be between 1 and 100.");
  }
  const pageResult=await loadProjectionPage(queryable,{
    workspaceId:input.workspace_id,generation,filters,cursor,limit:limit+1
  });
  const hasNext=pageResult.rows.length>limit;
  const pageItems=pageResult.rows.slice(0,limit).map(projectionRowToItem);
  const last = pageItems.at(-1);
  const nextCursor = hasNext && last
    ? encodeReviewCursor({
        v: SIGNAL_SEMANTIC_REVIEW_CURSOR_VERSION,
        workspace_id: input.workspace_id,
        filter_hash: filterHash,
        queue_digest: projection.snapshot_digest!,
        published_at: last.published_at,
        mention_id: last.mention_id
      })
    : null;
  const [aggregateRows,totalFiltered]=await Promise.all([
    queryable.query<{dimension:string;dimension_value:string;root_count:number}>(`
      SELECT dimension,dimension_value,root_count
      FROM signal_semantic_review_projection_aggregates
      WHERE workspace_id=$1::uuid AND generation=$2::bigint
      ORDER BY dimension,dimension_value
    `,[input.workspace_id,generation]),
    countProjectionFilter(queryable,input.workspace_id,generation,filters)
  ]);
  const summary=projectionAggregates(aggregateRows.rows);
  const identities=(await loadSemanticReviewIdentityContext(queryable,input.workspace_id)).identities;
  return {
    contract_version: "signal-semantic-review-v1" as const,
    workspace_id: input.workspace_id,
    policy: {
      key: SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY,
      version: SIGNAL_SEMANTIC_CANDIDATE_POLICY_VERSION,
      model_version: SIGNAL_SEMANTIC_CANDIDATE_MODEL_VERSION
    },
    governed_entities: identities.map((identity) => ({
      scope: identity.scope,
      entity_type: identity.entity_type,
      entity_id: identity.entity_id,
      entity_label: identity.entity_label
    })),
    filters: normalizeReviewFilters(filters),
    reconciliation: summary,
    snapshot: {
      generation,snapshot_digest:projection.snapshot_digest,
      population_digest:projection.population_digest,reconciled_at:projection.reconciled_at
    },
    page: {
      limit,
      returned: pageItems.length,
      total_filtered: totalFiltered,
      next_cursor: nextCursor,
      queue_digest: projection.snapshot_digest
    },
    records: pageItems
  };
}

export async function reconcileSignalSemanticReviewProjectionV1(
  queryable: SignalSemanticQueryable,
  args: {workspace_id:string;lease_token:string;page_size?:number}
) {
  const pageSize=Math.max(100,Math.min(2_000,Math.floor(args.page_size??1_000)));
  const identityContext=await loadSemanticReviewIdentityContext(queryable,args.workspace_id);
  const previousState=await queryable.query<{
    current_generation:string|number;full_rebuild_required:boolean;dirty_root_count:number
  }>(`
    SELECT current_generation,full_rebuild_required,dirty_root_count
    FROM signal_semantic_review_projection_state
    WHERE workspace_id=$1::uuid
  `,[args.workspace_id]);
  const previous=previousState.rows[0];
  const incremental=Boolean(previous
    && Number(previous.current_generation)>0
    && previous.full_rebuild_required===false
    && Number(previous.dirty_root_count)>0);
  const generationResult=await queryable.query<{generation:string|number}>(`
    SELECT begin_signal_semantic_review_projection_v1($1::uuid,$2::uuid) AS generation
  `,[args.workspace_id,args.lease_token]);
  const generation=Number(requiredRow(generationResult).generation);
  await queryable.query(`DELETE FROM signal_semantic_review_projection_items
    WHERE workspace_id=$1::uuid AND generation=$2::bigint`,[args.workspace_id,generation]);
  let projected=0;
  let rebuilt=0;
  if(incremental){
    const copied=await queryable.query(`
      INSERT INTO signal_semantic_review_projection_items(
        workspace_id,generation,mention_id,queue_state,published_at,platform,excerpt,title,
        account,url_host,source_intents,source_ids,proposed_assertions,proposed_scopes,
        current_scopes,confidence_bands,current_assertions,candidate_resolution,character_count,
        resolution_eligibility,resolution_authority_digest,
        resolution_next_policy_transition_at,context_hash,projection_hash,created_at,updated_at
      )
      SELECT item.workspace_id,$2::bigint,item.mention_id,item.queue_state,item.published_at,
        item.platform,item.excerpt,item.title,item.account,item.url_host,item.source_intents,
        item.source_ids,item.proposed_assertions,item.proposed_scopes,item.current_scopes,
        item.confidence_bands,item.current_assertions,item.candidate_resolution,
        item.character_count,item.resolution_eligibility,item.resolution_authority_digest,
        item.resolution_next_policy_transition_at,item.context_hash,item.projection_hash,
        item.created_at,now()
      FROM signal_semantic_review_projection_items item
      WHERE item.workspace_id=$1::uuid AND item.generation=$3::bigint
        AND NOT EXISTS(
          SELECT 1 FROM signal_semantic_review_projection_dirty_roots dirty
          WHERE dirty.workspace_id=item.workspace_id AND dirty.mention_id=item.mention_id
        )
    `,[args.workspace_id,generation,Number(previous!.current_generation)]);
    projected=Number(copied.rowCount??0);
  }
  let cursor:{published_at:string;mention_id:string}|null=null;
  for (;;) {
    const rows=await loadIncludedMentionRowsPage(queryable,args.workspace_id,
      identityContext.governance_available,cursor,pageSize,incremental);
    if(rows.length===0)break;
    const records=rows.map((row)=>buildProjectionRecord(
      row,args.workspace_id,identityContext.workspace,identityContext.identities
    ));
    await queryable.query(`
      INSERT INTO signal_semantic_review_projection_items(
        workspace_id,generation,mention_id,queue_state,published_at,platform,excerpt,title,
        account,url_host,source_intents,source_ids,proposed_assertions,proposed_scopes,
        current_scopes,confidence_bands,current_assertions,candidate_resolution,character_count,
        context_hash,projection_hash
      ) SELECT $1::uuid,$2::bigint,input.mention_id::uuid,input.queue_state,
        input.published_at::timestamptz,input.platform,input.excerpt,input.title,
        input.account,input.url_host,input.source_intents,input.source_ids,
        input.proposed_assertions,input.proposed_scopes,input.current_scopes,input.confidence_bands,
        input.current_assertions,input.candidate_resolution,input.character_count,
        input.context_hash,input.projection_hash
      FROM jsonb_to_recordset($3::jsonb) AS input(
        mention_id text,queue_state text,published_at text,platform text,excerpt text,title text,
        account jsonb,url_host text,source_intents jsonb,source_ids uuid[],
        proposed_assertions jsonb,proposed_scopes text[],current_scopes text[],confidence_bands text[],
        current_assertions jsonb,candidate_resolution text,character_count integer,
        context_hash text,projection_hash text
      )
      ON CONFLICT(workspace_id,generation,mention_id) DO UPDATE SET
        queue_state=EXCLUDED.queue_state,published_at=EXCLUDED.published_at,
        platform=EXCLUDED.platform,excerpt=EXCLUDED.excerpt,title=EXCLUDED.title,
        account=EXCLUDED.account,url_host=EXCLUDED.url_host,
        source_intents=EXCLUDED.source_intents,source_ids=EXCLUDED.source_ids,
        proposed_assertions=EXCLUDED.proposed_assertions,proposed_scopes=EXCLUDED.proposed_scopes,
        current_scopes=EXCLUDED.current_scopes,
        confidence_bands=EXCLUDED.confidence_bands,current_assertions=EXCLUDED.current_assertions,
        candidate_resolution=EXCLUDED.candidate_resolution,character_count=EXCLUDED.character_count,
        context_hash=EXCLUDED.context_hash,projection_hash=EXCLUDED.projection_hash,updated_at=now()
    `,[args.workspace_id,generation,JSON.stringify(records)]);
    projected+=records.length;
    rebuilt+=records.length;
    const last=rows.at(-1)!;
    cursor={published_at:last.published_at,mention_id:last.mention_id};
  }
  const identityDigest=signalSemanticStableHashV1(identityContext.identities);
  const governance=await queryable.query<{digest:string}>(`
    SELECT 'sha256:'||encode(sha256(convert_to(concat_ws('|',
      count(*)::text,COALESCE(max(changed_at)::text,'∅')),'UTF8')),'hex') AS digest
    FROM (
      SELECT workspace_id,updated_at AS changed_at FROM signal_provenance_policy_bindings
      UNION ALL SELECT workspace_id,updated_at FROM signal_quality_policies
      UNION ALL SELECT workspace_id,updated_at FROM signal_retention_policies
      UNION ALL SELECT workspace_id,updated_at FROM signal_licensing_policies
      UNION ALL SELECT workspace_id,created_at FROM signal_licensing_policy_usages
    ) authority WHERE workspace_id=$1::uuid
  `,[args.workspace_id]);
  if(!incremental){
    await queryable.query("ANALYZE signal_semantic_review_projection_items");
  }
  const authorityRefresh=await queryable.query<{refreshed:number}>(`
    SELECT refresh_signal_semantic_review_resolution_authority_v1(
      $1::uuid,$2::bigint,$3::boolean
    )::int AS refreshed
  `,[args.workspace_id,generation,incremental]);
  const expectedAuthorityRefresh=incremental?rebuilt:projected;
  if(Number(requiredRow(authorityRefresh).refreshed)!==expectedAuthorityRefresh){
    throw new SignalSemanticReviewContractError(
      "forbidden_state","Semantic Review resolution authority did not reconcile every projected root."
    );
  }
  const completed=await queryable.query<{
    snapshot_digest:string;population_digest:string;projected_root_count:number
  }>(`SELECT * FROM complete_signal_semantic_review_projection_v1(
    $1::uuid,$2::bigint,$3,$4,$5::uuid
  )`,[args.workspace_id,generation,identityDigest,requiredRow(governance).digest,args.lease_token]);
  return {...requiredRow(completed),generation,projected};
}

async function loadReadyProjectionState(
  queryable: SignalSemanticQueryable,
  workspaceId: string
) {
  const result = await queryable.query<ProjectionStateRow>(`
    SELECT current_generation, snapshot_digest, population_digest,
      projected_root_count, reconciled_at::text
    FROM signal_semantic_review_projection_state
    WHERE workspace_id = $1::uuid
      AND status = 'ready'
      AND snapshot_digest IS NOT NULL
      AND population_digest IS NOT NULL
      AND reconciled_at IS NOT NULL
  `, [workspaceId]);
  const row = result.rows[0];
  if (!row) {
    throw new SignalSemanticReviewContractError(
      "forbidden_state",
      "Semantic Review projection is not ready."
    );
  }
  return row;
}

type ProjectionFilterSql = { clauses: string[]; values: unknown[] };

function projectionFilterSql(
  workspaceId: string,
  generation: number,
  filters: SignalSemanticReviewFiltersV1,
  cursor?: ReviewCursor | null
): ProjectionFilterSql {
  const values: unknown[] = [workspaceId, generation];
  const clauses = ["item.workspace_id = $1::uuid", "item.generation = $2::bigint"];
  const add = (value: unknown, expression: (placeholder: string) => string) => {
    values.push(value);
    clauses.push(expression(`$${values.length}`));
  };
  if (filters.mention_id) add(filters.mention_id, (p) => `item.mention_id = ${p}::uuid`);
  if (filters.state) add(filters.state, (p) => `item.queue_state = ${p}`);
  if (filters.proposed_scope) {
    add(filters.proposed_scope, (p) => `(
      item.proposed_scopes @> ARRAY[${p}]::text[]
      OR item.current_scopes @> ARRAY[${p}]::text[]
    )`);
  }
  if (filters.confidence_band) {
    add(filters.confidence_band, (p) => `item.confidence_bands @> ARRAY[${p}]::text[]`);
  }
  if (filters.data_source_id) {
    add(filters.data_source_id, (p) => `item.source_ids @> ARRAY[${p}::uuid]::uuid[]`);
  }
  if (filters.platform?.trim()) {
    add(filters.platform.trim().toLowerCase(), (p) => `lower(item.platform) = ${p}`);
  }
  if (filters.start) add(filters.start, (p) => `item.published_at >= ${p}::date`);
  if (filters.end) add(filters.end, (p) => `item.published_at < (${p}::date + interval '1 day')`);
  if (cursor) {
    values.push(cursor.published_at, cursor.mention_id);
    const dateParameter = `$${values.length - 1}`;
    const idParameter = `$${values.length}`;
    clauses.push(`(item.published_at,item.mention_id) < (
      ${dateParameter}::timestamptz,${idParameter}::uuid
    )`);
  }
  return { clauses, values };
}

async function loadProjectionPage(
  queryable: SignalSemanticQueryable,
  args: {
    workspaceId: string;
    generation: number;
    filters: SignalSemanticReviewFiltersV1;
    cursor: ReviewCursor | null;
    limit: number;
  }
) {
  const filter = projectionFilterSql(args.workspaceId, args.generation, args.filters, args.cursor);
  filter.values.push(args.limit);
  return queryable.query<ProjectionItemRow>(`
    SELECT item.mention_id::text, item.queue_state, item.published_at::text,
      item.platform, item.excerpt, item.title, item.account, item.url_host,
      item.source_intents, item.proposed_assertions, item.current_assertions,
      item.candidate_resolution
    FROM signal_semantic_review_projection_items item
    WHERE ${filter.clauses.join("\n      AND ")}
    ORDER BY item.published_at DESC,item.mention_id DESC
    LIMIT $${filter.values.length}::int
  `, filter.values);
}

async function countProjectionFilter(
  queryable: SignalSemanticQueryable,
  workspaceId: string,
  generation: number,
  filters: SignalSemanticReviewFiltersV1
) {
  const aggregateDimension = singleAggregateDimension(filters);
  if (aggregateDimension) {
    const result = await queryable.query<{ total: number }>(`
      SELECT COALESCE((SELECT aggregate.root_count
        FROM signal_semantic_review_projection_aggregates aggregate
        WHERE aggregate.workspace_id=$1::uuid AND aggregate.generation=$2::bigint
          AND aggregate.dimension=$3 AND aggregate.dimension_value=$4
      ),0)::int AS total
    `,[workspaceId,generation,aggregateDimension.dimension,aggregateDimension.value]);
    return Number(requiredRow(result).total);
  }
  const filter = projectionFilterSql(workspaceId, generation, filters);
  const result = await queryable.query<{ total: number }>(`
    SELECT count(*)::int AS total
    FROM signal_semantic_review_projection_items item
    WHERE ${filter.clauses.join("\n      AND ")}
  `, filter.values);
  return Number(requiredRow(result).total);
}

function singleAggregateDimension(filters: SignalSemanticReviewFiltersV1) {
  const entries = [
    filters.mention_id ? {dimension:"mention",value:filters.mention_id} : null,
    filters.state ? {dimension:"state",value:filters.state} : null,
    filters.proposed_scope ? {dimension:"scope",value:filters.proposed_scope} : null,
    filters.confidence_band ? {dimension:"confidence",value:filters.confidence_band} : null,
    filters.data_source_id ? {dimension:"source",value:filters.data_source_id} : null,
    filters.platform?.trim() ? {dimension:"platform",value:filters.platform.trim().toLowerCase()} : null,
    filters.start ? {dimension:"period",value:filters.start} : null,
    filters.end ? {dimension:"period",value:filters.end} : null
  ].filter((item):item is {dimension:string;value:string}=>item!==null);
  if(entries.length===0)return {dimension:"total",value:"all"};
  if(entries.length===1 && entries[0]!.dimension!=="mention" && entries[0]!.dimension!=="period"){
    return entries[0]!;
  }
  return null;
}

function projectionRowToItem(row: ProjectionItemRow): SignalSemanticReviewQueueItemV1 {
  return {
    mention_id: row.mention_id,
    state: row.queue_state,
    published_at: row.published_at,
    platform: row.platform,
    excerpt: row.excerpt,
    title: row.title,
    account: row.account,
    url_host: row.url_host,
    source_intent: parseSourceIntents(row.source_intents),
    proposed_assertions: Array.isArray(row.proposed_assertions)
      ? row.proposed_assertions as SignalSemanticCandidateV1[]
      : [],
    current_assertions: parseCurrentAssertions(row.current_assertions),
    candidate_resolution: row.candidate_resolution
  };
}

function projectionAggregates(
  rows: Array<{ dimension: string; dimension_value: string; root_count: number }>
) {
  const stateCounts = Object.fromEntries(QUEUE_STATES.map((state) => [state, 0])) as Record<SignalSemanticQueueStateV1, number>;
  const scopeCounts = Object.fromEntries(SCOPES.map((scope) => [scope, 0])) as Record<SignalSemanticScopeV1, number>;
  const confidenceCounts: Record<SignalSemanticConfidenceBandV1, number> = { high: 0, medium: 0, low: 0 };
  let includedRootCount = 0;
  let candidateAssertionCount = 0;
  for (const row of rows) {
    const count = Number(row.root_count);
    if (row.dimension === "total") includedRootCount = count;
    else if (row.dimension === "candidate_assertions") candidateAssertionCount = count;
    else if (row.dimension === "state" && QUEUE_STATES.includes(row.dimension_value as SignalSemanticQueueStateV1)) {
      stateCounts[row.dimension_value as SignalSemanticQueueStateV1] = count;
    } else if (row.dimension === "scope" && SCOPES.includes(row.dimension_value as SignalSemanticScopeV1)) {
      scopeCounts[row.dimension_value as SignalSemanticScopeV1] = count;
    } else if (row.dimension === "confidence" && ["high", "medium", "low"].includes(row.dimension_value)) {
      confidenceCounts[row.dimension_value as SignalSemanticConfidenceBandV1] = count;
    }
  }
  const reconciled = Object.values(stateCounts).reduce((sum, count) => sum + count, 0);
  if (reconciled !== includedRootCount) {
    throw new SignalSemanticReviewContractError(
      "forbidden_state",
      "Semantic Review projection aggregates do not reconcile."
    );
  }
  return {
    included_root_count: includedRootCount,
    state_counts: stateCounts,
    candidate_assertion_count: candidateAssertionCount,
    candidate_counts_by_scope: scopeCounts,
    candidate_counts_by_confidence: confidenceCounts,
    reconciled: true
  };
}

async function loadIncludedMentionRowsPage(
  queryable: SignalSemanticQueryable,
  workspaceId: string,
  governanceAvailable: boolean,
  cursor: { published_at: string; mention_id: string } | null,
  limit: number,
  onlyDirtyRoots: boolean
): Promise<MentionRow[]> {
  const reviewRequestProjection = governanceAvailable
    ? `(SELECT max(event.created_at)::text
        FROM signal_mention_governance_events event
        WHERE event.workspace_id=root.workspace_id
          AND event.mention_id=root.id
          AND event.action='send_to_review')`
    : "NULL::text";
  const result = await queryable.query<MentionRow>(`
    SELECT root.id::text AS mention_id,root.published_at::text,
      COALESCE(root.resolved_platform,root.platform) AS platform,
      root.text_clean,root.text_snippet,root.title,root.url,
      author.handle AS author_handle,author.display_name AS author_name,
      COALESCE(root.raw_metadata->>'thread_context',root.raw_metadata->>'root_post_text',
        root.raw_metadata->>'parent_text') AS thread_context,
      ${reviewRequestProjection} AS review_requested_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'attribution_id',intent.id::text,'data_source_id',intent.data_source_id::text,
          'source_name',source.name,'import_batch_id',intent.import_batch_id::text,
          'scope',intent.scope,'entity_type',intent.entity_type,
          'entity_id',intent.entity_id::text,'entity_label',intent.entity_label,
          'review_status',intent.review_status,'policy_version',intent.policy_version
        ) ORDER BY intent.created_at,intent.id)
        FROM signal_mention_attributions intent
        JOIN data_sources source ON source.id=intent.data_source_id
        JOIN import_batches batch ON batch.id=intent.import_batch_id
          AND batch.workspace_id=intent.workspace_id AND batch.status='completed'
        WHERE intent.workspace_id=root.workspace_id
          AND intent.mention_id=root.id AND intent.attribution_basis='source_intent'
      ),'[]'::jsonb) AS source_intents,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id',assertion.id::text,'scope',assertion.scope,
          'entity_type',assertion.entity_type,'entity_id',assertion.entity_id::text,
          'entity_label',assertion.entity_label,'confidence',assertion.confidence,
          'review_status',assertion.review_status,'eligibility_status',assertion.eligibility_status,
          'evidence_kind',assertion.evidence_kind,'evidence_hash',assertion.evidence_hash,
          'semantic_policy_key',assertion.semantic_policy_key,'policy_version',assertion.policy_version,
          'model_version',assertion.model_version,'approval_source',assertion.approval_source,
          'approved_at',assertion.approved_at,'approved_by_user_id',assertion.approved_by_user_id::text,
          'assertion_version',assertion.assertion_version,'is_current',assertion.is_current,
          'created_at',assertion.created_at,'updated_at',assertion.updated_at
        ) ORDER BY assertion.assertion_version DESC,assertion.id)
        FROM signal_mention_attributions assertion
        WHERE assertion.workspace_id=root.workspace_id AND assertion.mention_id=root.id
          AND assertion.attribution_basis='mention_semantic' AND assertion.is_current=true
      ),'[]'::jsonb) AS current_assertions
    FROM mentions root
    LEFT JOIN authors author ON author.id=root.author_id
    WHERE root.workspace_id=$1::uuid
      AND root.canonical_mention_id=root.id
      AND root.inclusion_status='included'
      AND EXISTS (
        SELECT 1 FROM signal_mention_attributions intent
        JOIN import_batches batch ON batch.id=intent.import_batch_id
          AND batch.workspace_id=intent.workspace_id AND batch.status='completed'
        WHERE intent.workspace_id=root.workspace_id AND intent.mention_id=root.id
          AND intent.attribution_basis='source_intent'
      )
      AND (NOT $5::boolean OR EXISTS(
        SELECT 1 FROM signal_semantic_review_projection_dirty_roots dirty
        WHERE dirty.workspace_id=root.workspace_id AND dirty.mention_id=root.id
      ))
      AND ($2::timestamptz IS NULL OR (root.published_at,root.id)<($2::timestamptz,$3::uuid))
    ORDER BY root.published_at DESC,root.id DESC
    LIMIT $4::int
  `, [workspaceId, cursor?.published_at ?? null, cursor?.mention_id ?? null, limit,onlyDirtyRoots]);
  return result.rows;
}

function buildProjectionRecord(
  row: MentionRow,
  workspaceId: string,
  workspace: WorkspaceIdentityRow,
  identities: SignalSemanticGovernedIdentityV1[]
): ProjectionRecord {
  const currentAssertions = parseCurrentAssertions(row.current_assertions);
  const sourceIntents = parseSourceIntents(row.source_intents);
  if (sourceIntents.length === 0) {
    throw new SignalSemanticReviewContractError(
      "forbidden_state",
      "Semantic Review projection row is missing accepted source provenance."
    );
  }
  const surfaces = [
    { kind: "text" as const, value: row.text_clean },
    { kind: "title" as const, value: row.title },
    { kind: "author_handle" as const, value: row.author_handle },
    { kind: "author_name" as const, value: row.author_name },
    { kind: "url_host" as const, value: safeUrlHost(row.url) },
    { kind: "thread_context" as const, value: row.thread_context }
  ];
  const resolution = resolveSignalSemanticCandidatesV1({
    workspace_id: workspaceId,
    mention_id: row.mention_id,
    brand_id: workspace.brand_id,
    identities,
    surfaces
  });
  const reviewRequestPending = Boolean(row.review_requested_at) && currentAssertions.every(
    (assertion) => Date.parse(assertion.updated_at) < Date.parse(row.review_requested_at!)
  );
  const queueState = reviewRequestPending
    ? "needs_context" as const
    : resolveQueueState(currentAssertions, resolution);
  const proposed = queueState === "candidate_pending" ? resolution.candidates : [];
  const contextHash = signalSemanticStableHashV1({ workspace_id: workspaceId, mention_id: row.mention_id, surfaces });
  const characterCount = surfaces.reduce((sum, surface) => sum + (surface.value?.length ?? 0), 0);
  const base = {
    mention_id: row.mention_id,
    queue_state: queueState,
    published_at: row.published_at,
    platform: row.platform,
    excerpt: singleExcerpt(row.text_snippet, row.text_clean),
    title: row.title,
    account: row.author_handle || row.author_name
      ? { handle: row.author_handle, display_name: row.author_name }
      : null,
    url_host: safeUrlHost(row.url),
    source_intents: sourceIntents,
    source_ids: [...new Set(sourceIntents.map((intent) => intent.data_source_id))].sort(),
    proposed_assertions: proposed,
    proposed_scopes: [...new Set(proposed.map((candidate) => candidate.scope))].sort(),
    current_scopes: [...new Set(currentAssertions.filter((item) => item.is_current).map((item) => item.scope))].sort(),
    confidence_bands: [...new Set(proposed.map((candidate) => candidate.confidence_band))].sort(),
    current_assertions: currentAssertions,
    candidate_resolution: resolution.resolution_reason,
    character_count: characterCount,
    context_hash: contextHash
  } satisfies Omit<ProjectionRecord, "projection_hash">;
  return {
    ...base,
    projection_hash: signalSemanticStableHashV1(base)
  };
}

export async function generateSignalSemanticCandidatesV1(
  queryable: SignalSemanticQueryable,
  args: { workspace_id: string; mode: "dry-run" | "apply" }
): Promise<SignalSemanticCandidateGenerationResultV1> {
  const state = await buildSignalSemanticReviewQueueStateV1(queryable, args.workspace_id);
  let createdCount = 0;
  let existingCount = 0;
  let conflictCount = 0;
  if (args.mode === "apply") {
    for (const item of state.items) {
      if (item.state !== "candidate_pending") continue;
      const anchor = item.source_intent[0];
      if (!anchor) {
        throw new SignalSemanticReviewContractError(
          "forbidden_state",
          "Candidate assertion is missing canonical source provenance."
        );
      }
      for (const candidate of item.proposed_assertions) {
        const sameCurrent = item.current_assertions.find((assertion) => (
          assertion.is_current
          && assertion.semantic_policy_key === candidate.policy_key
          && assertion.scope === candidate.scope
          && assertion.entity_type === candidate.entity_type
          && assertion.entity_id === candidate.entity_id
        ));
        if (sameCurrent) {
          if (sameCurrent.evidence_hash === candidate.evidence_hash) existingCount += 1;
          else conflictCount += 1;
          continue;
        }
        const before = await queryable.query<{ attribution_id: string }>(`
          SELECT id::text AS attribution_id
          FROM signal_mention_attributions
          WHERE workspace_id = $1::uuid
            AND attribution_basis = 'mention_semantic'
            AND idempotency_key = $2
        `, [args.workspace_id, candidate.idempotency_key]);
        const result = await queryable.query<{ attribution_id: string }>(`
          SELECT create_signal_mention_semantic_assertion(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid,
            $5, $6, $7::uuid, $8, $9::numeric,
            $10, $11, $12, $13, $14, $15
          )::text AS attribution_id
        `, [
          args.workspace_id,
          item.mention_id,
          anchor.data_source_id,
          anchor.import_batch_id,
          candidate.scope,
          candidate.entity_type,
          candidate.entity_id,
          candidate.entity_label,
          candidate.confidence,
          candidate.evidence_kind,
          candidate.evidence_hash,
          candidate.policy_key,
          candidate.policy_version,
          candidate.model_version,
          candidate.idempotency_key
        ]);
        if (!result.rows[0]) {
          throw new SignalSemanticReviewContractError("forbidden_state", "Candidate assertion was not persisted.");
        }
        if (before.rows[0]) existingCount += 1;
        else createdCount += 1;
      }
    }
  }
  const summary = summarizeReviewItems(state.items);
  return {
    workspace_id: args.workspace_id,
    included_root_count: summary.included_root_count,
    state_counts: summary.state_counts,
    candidate_assertion_count: summary.candidate_assertion_count,
    candidate_counts_by_scope: summary.candidate_counts_by_scope,
    candidate_counts_by_confidence: summary.candidate_counts_by_confidence,
    unresolved_count: summary.state_counts.unresolved,
    needs_context_count: summary.state_counts.needs_context,
    candidate_digest: state.digest,
    created_count: createdCount,
    existing_count: existingCount,
    conflict_count: conflictCount,
    writes_performed: createdCount > 0
  };
}

export async function createManualSignalSemanticAssertionV1(
  queryable: SignalSemanticQueryable,
  args: {
    workspace_id: string;
    mention_id: string;
    reviewer_user_id: string;
    scope: SignalSemanticScopeV1;
    entity_id: string | null;
    confidence: number;
    rationale: string;
    idempotency_key: string;
  }
) {
  assertConfidence(args.confidence);
  const target = await resolveMutationTarget(queryable, args.workspace_id, args.mention_id);
  const entity = await resolveSemanticEntity(queryable, target, args.scope, args.entity_id);
  const rationaleHash = signalSemanticStableHashV1({ rationale: cleanRationale(args.rationale) });
  const evidenceHash = signalSemanticStableHashV1({
    workspace_id: args.workspace_id,
    mention_id: target.mention_id,
    scope: args.scope,
    entity_type: entity.entity_type,
    entity_id: entity.entity_id,
    rationale_hash: rationaleHash,
    reviewer_user_id: args.reviewer_user_id
  });
  const idempotencyKey = signalSemanticStableHashV1({
    operation: "manual-semantic-assertion",
    supplied_key: cleanIdempotencyInput(args.idempotency_key),
    workspace_id: args.workspace_id,
    mention_id: target.mention_id,
    scope: args.scope,
    entity_type: entity.entity_type,
    entity_id: entity.entity_id,
    evidence_hash: evidenceHash
  });
  const result = await queryable.query<{ attribution_id: string }>(`
    SELECT create_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      $5, $6, $7::uuid, $8, $9::numeric,
      'human_reviewed_context', $10,
      $11, $12, NULL, $13
    )::text AS attribution_id
  `, [
    args.workspace_id,
    target.mention_id,
    target.data_source_id,
    target.import_batch_id,
    args.scope,
    entity.entity_type,
    entity.entity_id,
    entity.entity_label,
    args.confidence,
    evidenceHash,
    SIGNAL_SEMANTIC_REVIEW_POLICY_KEY,
    SIGNAL_SEMANTIC_REVIEW_POLICY_VERSION,
    idempotencyKey
  ]);
  return {
    assertion_id: requiredRow(result).attribution_id,
    mention_id: target.mention_id,
    review_status: "pending" as const,
    eligibility_status: "candidate" as const,
    evidence_hash: evidenceHash,
    idempotency_key: idempotencyKey
  };
}

export async function reviewSignalSemanticAssertionV1(
  queryable: SignalSemanticQueryable,
  args: {
    workspace_id: string;
    attribution_id: string;
    reviewer_user_id: string;
    decision: "approve" | "reject";
    rationale: string;
    idempotency_key: string;
  }
) {
  const assertion = await loadAssertionForMutation(queryable, args.workspace_id, args.attribution_id);
  if (args.decision === "approve" && assertion.inclusion_status !== "included") {
    throw new SignalSemanticReviewContractError(
      "forbidden_state",
      "Excluded or pending mentions cannot become semantically eligible."
    );
  }
  const rationaleHash = signalSemanticStableHashV1({ rationale: cleanRationale(args.rationale) });
  const idempotencyKey = signalSemanticStableHashV1({
    operation: "semantic-review",
    supplied_key: cleanIdempotencyInput(args.idempotency_key),
    workspace_id: args.workspace_id,
    attribution_id: args.attribution_id,
    reviewer_user_id: args.reviewer_user_id,
    decision: args.decision,
    rationale_hash: rationaleHash
  });
  const result = await queryable.query<{ attribution_id: string }>(`
    SELECT review_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, $3, 'noisia_admin_semantic_review',
      $4, $5, $6, $7
    )::text AS attribution_id
  `, [
    args.attribution_id,
    args.reviewer_user_id,
    args.decision,
    SIGNAL_SEMANTIC_REVIEW_POLICY_KEY,
    SIGNAL_SEMANTIC_REVIEW_POLICY_VERSION,
    rationaleHash,
    idempotencyKey
  ]);
  return {
    assertion_id: requiredRow(result).attribution_id,
    decision: args.decision,
    rationale_hash: rationaleHash,
    idempotency_key: idempotencyKey
  };
}

export async function supersedeSignalSemanticAssertionV1(
  queryable: SignalSemanticQueryable,
  args: {
    workspace_id: string;
    attribution_id: string;
    reviewer_user_id: string;
    scope: SignalSemanticScopeV1;
    entity_id: string | null;
    confidence: number;
    rationale: string;
    idempotency_key: string;
  }
) {
  assertConfidence(args.confidence);
  const assertion = await loadAssertionForMutation(queryable, args.workspace_id, args.attribution_id);
  const target = await resolveMutationTarget(queryable, args.workspace_id, assertion.mention_id);
  const entity = await resolveSemanticEntity(queryable, target, args.scope, args.entity_id);
  const rationaleHash = signalSemanticStableHashV1({ rationale: cleanRationale(args.rationale) });
  const evidenceHash = signalSemanticStableHashV1({
    operation: "semantic-supersession",
    prior_assertion_id: args.attribution_id,
    scope: args.scope,
    entity_type: entity.entity_type,
    entity_id: entity.entity_id,
    rationale_hash: rationaleHash
  });
  const suppliedKey = cleanIdempotencyInput(args.idempotency_key);
  const assertionIdempotency = signalSemanticStableHashV1({
    operation: "semantic-supersession-assertion",
    supplied_key: suppliedKey,
    prior_assertion_id: args.attribution_id,
    evidence_hash: evidenceHash
  });
  const reviewIdempotency = signalSemanticStableHashV1({
    operation: "semantic-supersession-review",
    supplied_key: suppliedKey,
    prior_assertion_id: args.attribution_id,
    reviewer_user_id: args.reviewer_user_id,
    rationale_hash: rationaleHash
  });
  const result = await queryable.query<{ attribution_id: string }>(`
    SELECT supersede_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7::numeric,
      'human_reviewed_context', $8, $9, NULL, $10,
      $11, $12, $13, $14
    )::text AS attribution_id
  `, [
    args.attribution_id,
    args.reviewer_user_id,
    args.scope,
    entity.entity_type,
    entity.entity_id,
    entity.entity_label,
    args.confidence,
    evidenceHash,
    SIGNAL_SEMANTIC_REVIEW_POLICY_VERSION,
    assertionIdempotency,
    SIGNAL_SEMANTIC_REVIEW_POLICY_KEY,
    SIGNAL_SEMANTIC_REVIEW_POLICY_VERSION,
    rationaleHash,
    reviewIdempotency
  ]);
  return {
    assertion_id: requiredRow(result).attribution_id,
    supersedes_assertion_id: args.attribution_id,
    review_status: "pending" as const,
    eligibility_status: "candidate" as const,
    evidence_hash: evidenceHash
  };
}

export async function listSignalSemanticAssertionHistoryV1(
  queryable: SignalSemanticQueryable,
  args: { workspace_id: string; attribution_id: string }
) {
  const assertion = await queryable.query<{ id: string }>(`
    SELECT id::text
    FROM signal_mention_attributions
    WHERE id = $2::uuid
      AND workspace_id = $1::uuid
      AND attribution_basis = 'mention_semantic'
  `, [args.workspace_id, args.attribution_id]);
  if (!assertion.rows[0]) {
    throw new SignalSemanticReviewContractError("not_found", "Semantic assertion was not found.");
  }
  const result = await queryable.query<{
    id: string;
    action: "approved" | "rejected" | "superseded";
    previous_review_status: string;
    next_review_status: string;
    previous_eligibility_status: string;
    next_eligibility_status: string;
    reviewer_user_id: string;
    review_policy_key: string;
    review_policy_version: string;
    rationale_hash: string;
    created_at: string;
  }>(`
    SELECT event.id::text, event.action,
      event.previous_review_status, event.next_review_status,
      event.previous_eligibility_status, event.next_eligibility_status,
      event.reviewer_user_id::text, event.review_policy_key,
      event.review_policy_version, event.rationale_hash,
      event.created_at::text
    FROM signal_mention_attribution_review_events event
    WHERE event.workspace_id = $1::uuid
      AND event.attribution_id = $2::uuid
    ORDER BY event.created_at, event.id
  `, [args.workspace_id, args.attribution_id]);
  return {
    assertion_id: args.attribution_id,
    events: result.rows
  };
}

export async function inspectSignalSemanticReviewInvariantsV1(
  queryable: SignalSemanticQueryable,
  workspaceId: string
) {
  const state = await buildSignalSemanticReviewQueueStateV1(queryable, workspaceId);
  const result = await queryable.query<{
    v1_definition_digest: string;
    v1_pointer_digest: string;
    v1_membership_count: number;
    v1_membership_digest: string;
    v1_active_membership_count: number;
    v1_active_membership_digest: string;
    source_intent_count: number;
    source_intent_digest: string;
    semantic_assertion_count: number;
    semantic_assertion_digest: string;
    approved_semantic_count: number;
    review_event_count: number;
    v2_definition_count: number;
    v2_pointer_count: number;
    v2_membership_count: number;
  }>(`
    WITH v1 AS (
      SELECT definition.*
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions definition ON definition.id = pointer.population_id
      WHERE pointer.workspace_id = $1::uuid
        AND pointer.purpose = 'operational'
    ), v2 AS (
      SELECT definition.*
      FROM signal_population_definitions definition
      WHERE definition.workspace_id = $1::uuid
        AND definition.definition->>'contract_version'
          = 'signal-operational-primary-brand-semantic-v2'
    )
    SELECT
      COALESCE((SELECT 'sha256:' || encode(sha256(convert_to(
        string_agg((to_jsonb(v1) - 'updated_at')::text, E'\n' ORDER BY v1.id), 'UTF8')), 'hex') FROM v1),
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') AS v1_definition_digest,
      COALESCE((SELECT 'sha256:' || encode(sha256(convert_to(
        string_agg(concat_ws('|', pointer.id, pointer.population_id, pointer.purpose,
          pointer.promoted_by_user_id, pointer.promoted_at), E'\n' ORDER BY pointer.id), 'UTF8')), 'hex')
        FROM signal_workspace_population_pointers pointer
        WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'),
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') AS v1_pointer_digest,
      (SELECT count(*)::int FROM signal_population_memberships membership
       JOIN v1 ON v1.id = membership.population_id) AS v1_membership_count,
      COALESCE((SELECT 'sha256:' || encode(sha256(convert_to(
        string_agg(concat_ws('|', membership.mention_id, membership.membership_status,
          membership.membership_reason, membership.removed_at), E'\n' ORDER BY membership.mention_id), 'UTF8')), 'hex')
        FROM signal_population_memberships membership JOIN v1 ON v1.id = membership.population_id),
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') AS v1_membership_digest,
      (SELECT count(*)::int FROM signal_population_memberships membership
       JOIN v1 ON v1.id = membership.population_id
       WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL) AS v1_active_membership_count,
      COALESCE((SELECT 'sha256:' || encode(sha256(convert_to(
        string_agg(membership.mention_id::text, E'\n' ORDER BY membership.mention_id), 'UTF8')), 'hex')
        FROM signal_population_memberships membership JOIN v1 ON v1.id = membership.population_id
        WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL),
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') AS v1_active_membership_digest,
      (SELECT count(*)::int FROM signal_mention_attributions attribution
       WHERE attribution.workspace_id = $1::uuid AND attribution.attribution_basis = 'source_intent') AS source_intent_count,
      COALESCE((SELECT 'sha256:' || encode(sha256(convert_to(
        string_agg(concat_ws('|', attribution.id, attribution.mention_id,
          attribution.data_source_id, attribution.import_batch_id, attribution.scope,
          attribution.entity_type, attribution.entity_id, attribution.review_status,
          attribution.eligibility_status, attribution.policy_version), E'\n' ORDER BY attribution.id), 'UTF8')), 'hex')
        FROM signal_mention_attributions attribution
        WHERE attribution.workspace_id = $1::uuid AND attribution.attribution_basis = 'source_intent'),
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') AS source_intent_digest,
      (SELECT count(*)::int FROM signal_mention_attributions attribution
       WHERE attribution.workspace_id = $1::uuid AND attribution.attribution_basis = 'mention_semantic') AS semantic_assertion_count,
      COALESCE((SELECT 'sha256:' || encode(sha256(convert_to(
        string_agg(concat_ws('|', attribution.id, attribution.mention_id, attribution.scope,
          attribution.entity_type, attribution.entity_id, attribution.review_status,
          attribution.eligibility_status, attribution.evidence_hash,
          attribution.semantic_policy_key, attribution.policy_version,
          attribution.assertion_version, attribution.is_current, attribution.idempotency_key),
          E'\n' ORDER BY attribution.id), 'UTF8')), 'hex')
        FROM signal_mention_attributions attribution
        WHERE attribution.workspace_id = $1::uuid AND attribution.attribution_basis = 'mention_semantic'),
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') AS semantic_assertion_digest,
      (SELECT count(*)::int FROM signal_mention_attributions attribution
       WHERE attribution.workspace_id = $1::uuid
         AND attribution.attribution_basis = 'mention_semantic'
         AND attribution.review_status = 'approved') AS approved_semantic_count,
      (SELECT count(*)::int FROM signal_mention_attribution_review_events event
       WHERE event.workspace_id = $1::uuid) AS review_event_count,
      (SELECT count(*)::int FROM v2) AS v2_definition_count,
      (SELECT count(*)::int FROM signal_workspace_population_pointers pointer
       JOIN v2 ON v2.id = pointer.population_id) AS v2_pointer_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
       JOIN v2 ON v2.id = membership.population_id
       WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL) AS v2_membership_count
  `, [workspaceId]);
  return {
    ...requiredRow(result),
    included_root_count: state.items.length,
    candidate_digest: state.digest,
    queue_state_counts: summarizeReviewItems(state.items).state_counts
  };
}

async function buildSignalSemanticReviewQueueStateV1(
  queryable: SignalSemanticQueryable,
  workspaceId: string
): Promise<ReviewQueueState> {
  const identityContext = await loadSemanticReviewIdentityContext(queryable, workspaceId);
  const workspace = identityContext.workspace;
  const identities = identityContext.identities;
  const rows = await loadIncludedMentionRows(
    queryable,
    workspaceId,
    identityContext.governance_available
  );
  const items: SignalSemanticReviewQueueItemV1[] = [];
  const resolutions: SignalSemanticCandidateResolutionV1[] = [];
  for (const row of rows) {
    const currentAssertions = parseCurrentAssertions(row.current_assertions);
    const sourceIntents = parseSourceIntents(row.source_intents);
    const resolution = resolveSignalSemanticCandidatesV1({
      workspace_id: workspaceId,
      mention_id: row.mention_id,
      brand_id: workspace.brand_id,
      identities,
      surfaces: [
        { kind: "text", value: row.text_clean },
        { kind: "title", value: row.title },
        { kind: "author_handle", value: row.author_handle },
        { kind: "author_name", value: row.author_name },
        { kind: "url_host", value: safeUrlHost(row.url) },
        { kind: "thread_context", value: row.thread_context }
      ]
    });
    resolutions.push(resolution);
    const reviewRequestPending = Boolean(row.review_requested_at) && currentAssertions.every(
      (assertion) => Date.parse(assertion.updated_at) < Date.parse(row.review_requested_at!)
    );
    const state = reviewRequestPending
      ? "needs_context" as const
      : resolveQueueState(currentAssertions, resolution);
    items.push({
      mention_id: row.mention_id,
      state,
      published_at: row.published_at,
      platform: row.platform,
      excerpt: singleExcerpt(row.text_snippet, row.text_clean),
      title: row.title,
      account: row.author_handle || row.author_name
        ? { handle: row.author_handle, display_name: row.author_name }
        : null,
      url_host: safeUrlHost(row.url),
      source_intent: sourceIntents,
      proposed_assertions: state === "candidate_pending" ? resolution.candidates : [],
      current_assertions: currentAssertions,
      candidate_resolution: resolution.resolution_reason
    });
  }
  items.sort(compareReviewItems);
  return {
    workspace,
    identities,
    items,
    resolutions,
    digest: signalSemanticCandidateSetDigestV1(resolutions)
  };
}

async function loadSemanticReviewIdentityContext(
  queryable: SignalSemanticQueryable,
  workspaceId: string
) {
  const result = await queryable.query<SemanticReviewIdentityContextRow>(`
    SELECT workspace.id::text AS workspace_id,
      workspace.organization_id::text,
      brand.id::text AS brand_id,
      COALESCE(brand.display_name, brand.name) AS brand_name,
      brand.slug AS brand_slug,
      brand.brand_seed_handles AS brand_handles,
      to_regclass('public.signal_mention_governance_events') IS NOT NULL
        AS governance_available,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'term', term.term,
          'term_type', term.term_type,
          'brand_seed_id', term.brand_seed_id::text
        ) ORDER BY profile.version DESC, term.term, term.id)
        FROM brand_os_profiles profile
        JOIN brand_os_seed_sets seed_set
          ON seed_set.brand_os_profile_id = profile.id
         AND seed_set.status = 'active'
        JOIN brand_os_seed_terms term ON term.seed_set_id = seed_set.id
        WHERE profile.brand_id = brand.id AND profile.status = 'active'
      ), '[]'::jsonb) AS brand_os_terms,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'competitor_id', competitor.id::text,
          'seed_id', seed.id::text,
          'canonical_name', seed.canonical_name,
          'aliases', seed.aliases,
          'detection_patterns', seed.detection_patterns
        ) ORDER BY competitor.priority NULLS LAST, competitor.id)
        FROM competitors competitor
        JOIN brand_seeds seed ON seed.id = competitor.competitor_brand_seed_id
        WHERE competitor.brand_id = brand.id AND seed.active = true
      ), '[]'::jsonb) AS competitors,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'entity_id', governed_entity.entity_id,
          'entity_type', governed_entity.entity_type,
          'canonical_name', governed_entity.canonical_name,
          'aliases', governed_entity.aliases
        ) ORDER BY governed_entity.entity_type, governed_entity.entity_id)
        FROM (
          SELECT entity.id::text AS entity_id, entity.entity_type,
            entity.canonical_name,
            COALESCE(array_agg(alias.alias ORDER BY alias.alias)
              FILTER (WHERE alias.id IS NOT NULL), ARRAY[]::text[]) AS aliases
          FROM intelligence_entities entity
          LEFT JOIN entity_aliases alias ON alias.entity_id = entity.id
          WHERE entity.brand_id = brand.id
            AND entity.status = 'active'
            AND entity.entity_type IN ('category', 'reference')
          GROUP BY entity.id, entity.entity_type, entity.canonical_name
        ) governed_entity
      ), '[]'::jsonb) AS entities
    FROM signal_workspaces workspace
    JOIN brands brand ON brand.id = workspace.brand_id
    WHERE workspace.id = $1::uuid
      AND workspace.status = 'active'
      AND brand.status = 'active'
  `, [workspaceId]);
  const row = result.rows[0];
  if (!row) throw new SignalSemanticReviewContractError("not_found", "Active brand workspace was not found.");
  const workspace: WorkspaceIdentityRow = {
    workspace_id: row.workspace_id,
    organization_id: row.organization_id,
    brand_id: row.brand_id,
    brand_name: row.brand_name,
    brand_slug: row.brand_slug,
    brand_handles: row.brand_handles
  };
  const primaryTerms = new Map<string, "canonical_name" | "alias" | "handle">();
  primaryTerms.set(workspace.brand_name, "canonical_name");
  primaryTerms.set(workspace.brand_slug, "alias");
  for (const value of workspace.brand_handles ?? []) {
    primaryTerms.set(value, value.trim().startsWith("@") ? "handle" : "alias");
  }
  for (const term of row.brand_os_terms) {
    if (["brand_name", "brand_slug", "alias"].includes(term.term_type)) {
      primaryTerms.set(term.term, term.term.trim().startsWith("@") ? "handle" : term.term_type === "brand_name" ? "canonical_name" : "alias");
    }
  }
  const identities: SignalSemanticGovernedIdentityV1[] = [{
    scope: "primary_brand",
    entity_type: "brand",
    entity_id: workspace.brand_id,
    entity_label: workspace.brand_name,
    terms: [...primaryTerms.entries()].map(([value, kind]) => ({ value, kind }))
  }];

  for (const competitor of row.competitors) {
    const terms = new Map<string, "canonical_name" | "alias" | "handle">();
    terms.set(competitor.canonical_name, "canonical_name");
    for (const value of [...(competitor.aliases ?? []), ...(competitor.detection_patterns ?? [])]) {
      terms.set(value, value.trim().startsWith("@") ? "handle" : "alias");
    }
    for (const term of row.brand_os_terms) {
      if (term.term_type === "competitor" && term.brand_seed_id === competitor.seed_id) {
        terms.set(term.term, term.term.trim().startsWith("@") ? "handle" : "alias");
      }
    }
    identities.push({
      scope: "competitor",
      entity_type: "competitor",
      entity_id: competitor.competitor_id,
      entity_label: competitor.canonical_name,
      terms: [...terms.entries()].map(([value, kind]) => ({ value, kind }))
    });
  }

  for (const entity of row.entities) {
    identities.push({
      scope: entity.entity_type,
      entity_type: entity.entity_type,
      entity_id: entity.entity_id,
      entity_label: entity.canonical_name,
      terms: [
        { value: entity.canonical_name, kind: "canonical_name" },
        ...(entity.aliases ?? []).map((value) => ({ value, kind: "alias" as const }))
      ]
    });
  }
  return {
    workspace,
    identities,
    governance_available: row.governance_available
  };
}

async function loadIncludedMentionRows(
  queryable: SignalSemanticQueryable,
  workspaceId: string,
  governanceAvailable: boolean
) {
  const reviewRequestProjection = governanceAvailable
    ? `(
        SELECT max(event.created_at)::text
        FROM signal_mention_governance_events event
        WHERE event.workspace_id = root.workspace_id
          AND event.mention_id = root.id
          AND event.action = 'send_to_review'
      )`
    : "NULL::text";
  const result = await queryable.query<MentionRow>(`
    SELECT root.id::text AS mention_id,
      root.published_at::text,
      COALESCE(root.resolved_platform, root.platform) AS platform,
      root.text_clean, root.text_snippet, root.title, root.url,
      author.handle AS author_handle, author.display_name AS author_name,
      COALESCE(
        root.raw_metadata->>'thread_context',
        root.raw_metadata->>'root_post_text',
        root.raw_metadata->>'parent_text'
      ) AS thread_context,
      ${reviewRequestProjection} AS review_requested_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'attribution_id', intent.id::text,
          'data_source_id', intent.data_source_id::text,
          'source_name', source.name,
          'import_batch_id', intent.import_batch_id::text,
          'scope', intent.scope,
          'entity_type', intent.entity_type,
          'entity_id', intent.entity_id::text,
          'entity_label', intent.entity_label,
          'review_status', intent.review_status,
          'policy_version', intent.policy_version
        ) ORDER BY intent.created_at, intent.id)
        FROM signal_mention_attributions intent
        JOIN data_sources source ON source.id = intent.data_source_id
        JOIN import_batches batch
          ON batch.id = intent.import_batch_id
         AND batch.workspace_id = intent.workspace_id
         AND batch.status = 'completed'
        WHERE intent.workspace_id = root.workspace_id
          AND intent.mention_id = root.id
          AND intent.attribution_basis = 'source_intent'
      ), '[]'::jsonb) AS source_intents,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', assertion.id::text,
          'scope', assertion.scope,
          'entity_type', assertion.entity_type,
          'entity_id', assertion.entity_id::text,
          'entity_label', assertion.entity_label,
          'confidence', assertion.confidence,
          'review_status', assertion.review_status,
          'eligibility_status', assertion.eligibility_status,
          'evidence_kind', assertion.evidence_kind,
          'evidence_hash', assertion.evidence_hash,
          'semantic_policy_key', assertion.semantic_policy_key,
          'policy_version', assertion.policy_version,
          'model_version', assertion.model_version,
          'approval_source', assertion.approval_source,
          'approved_at', assertion.approved_at,
          'approved_by_user_id', assertion.approved_by_user_id::text,
          'assertion_version', assertion.assertion_version,
          'is_current', assertion.is_current,
          'created_at', assertion.created_at,
          'updated_at', assertion.updated_at
        ) ORDER BY assertion.is_current DESC, assertion.assertion_version DESC, assertion.id)
        FROM signal_mention_attributions assertion
        WHERE assertion.workspace_id = root.workspace_id
          AND assertion.mention_id = root.id
          AND assertion.attribution_basis = 'mention_semantic'
          AND assertion.is_current = true
      ), '[]'::jsonb) AS current_assertions
    FROM mentions root
    LEFT JOIN authors author ON author.id = root.author_id
    WHERE root.workspace_id = $1::uuid
      AND root.canonical_mention_id = root.id
      AND root.inclusion_status = 'included'
      AND NOT signal_mention_has_only_incomplete_imports_v1(root.workspace_id,root.id)
      AND EXISTS (
        SELECT 1
        FROM signal_mention_attributions intent
        JOIN import_batches batch
          ON batch.id = intent.import_batch_id
         AND batch.workspace_id = intent.workspace_id
         AND batch.status = 'completed'
        WHERE intent.workspace_id = root.workspace_id
          AND intent.mention_id = root.id
          AND intent.attribution_basis = 'source_intent'
      )
    ORDER BY root.published_at DESC, root.id DESC
  `, [workspaceId]);
  return result.rows;
}

async function resolveMutationTarget(
  queryable: SignalSemanticQueryable,
  workspaceId: string,
  mentionId: string
) {
  const result = await queryable.query<{
    mention_id: string;
    brand_id: string;
    inclusion_status: string;
    data_source_id: string;
    import_batch_id: string | null;
  }>(`
    SELECT root.id::text AS mention_id, workspace.brand_id::text,
      root.inclusion_status,
      intent.data_source_id::text,
      intent.import_batch_id::text
    FROM mentions observed
    JOIN mentions root
      ON root.id = observed.canonical_mention_id
     AND root.workspace_id = observed.workspace_id
    JOIN signal_workspaces workspace ON workspace.id = root.workspace_id
    JOIN LATERAL (
      SELECT attribution.data_source_id, attribution.import_batch_id
      FROM signal_mention_attributions attribution
      JOIN import_batches batch
        ON batch.id = attribution.import_batch_id
       AND batch.workspace_id = attribution.workspace_id
       AND batch.status = 'completed'
      WHERE attribution.workspace_id = root.workspace_id
        AND attribution.mention_id = root.id
        AND attribution.attribution_basis = 'source_intent'
      ORDER BY attribution.created_at, attribution.id
      LIMIT 1
    ) intent ON true
    WHERE observed.id = $2::uuid
      AND observed.workspace_id = $1::uuid
      AND root.canonical_mention_id = root.id
      AND NOT signal_mention_has_only_incomplete_imports_v1(root.workspace_id,root.id)
  `, [workspaceId, mentionId]);
  const row = result.rows[0];
  if (!row) {
    throw new SignalSemanticReviewContractError(
      "not_found",
      "Canonical mention or source provenance was not found in this workspace."
    );
  }
  if (row.inclusion_status !== "included") {
    throw new SignalSemanticReviewContractError(
      "forbidden_state",
      "The initial operational Review queue only accepts included canonical mentions."
    );
  }
  return row;
}

async function loadAssertionForMutation(
  queryable: SignalSemanticQueryable,
  workspaceId: string,
  attributionId: string
) {
  const result = await queryable.query<{
    attribution_id: string;
    mention_id: string;
    inclusion_status: string;
    review_status: string;
    eligibility_status: string;
    is_current: boolean;
  }>(`
    SELECT assertion.id::text AS attribution_id,
      assertion.mention_id::text, mention.inclusion_status,
      assertion.review_status, assertion.eligibility_status,
      assertion.is_current
    FROM signal_mention_attributions assertion
    JOIN mentions mention
      ON mention.id = assertion.mention_id
     AND mention.workspace_id = assertion.workspace_id
     AND mention.canonical_mention_id = mention.id
    WHERE assertion.id = $2::uuid
      AND assertion.workspace_id = $1::uuid
      AND assertion.attribution_basis = 'mention_semantic'
      AND NOT signal_mention_has_only_incomplete_imports_v1(
        assertion.workspace_id,assertion.mention_id
      )
  `, [workspaceId, attributionId]);
  const row = result.rows[0];
  if (!row) throw new SignalSemanticReviewContractError("not_found", "Semantic assertion was not found.");
  if (!row.is_current) {
    throw new SignalSemanticReviewContractError("forbidden_state", "Only a current semantic assertion can mutate.");
  }
  return row;
}

async function resolveSemanticEntity(
  queryable: SignalSemanticQueryable,
  target: { brand_id: string },
  scope: SignalSemanticScopeV1,
  suppliedEntityId: string | null
) {
  if (scope === "primary_brand") {
    if (suppliedEntityId && suppliedEntityId !== target.brand_id) {
      throw new SignalSemanticReviewContractError(
        "invalid_input",
        "Primary-brand assertions must resolve to the workspace brand."
      );
    }
    const result = await queryable.query<{ label: string }>(`
      SELECT COALESCE(display_name, name) AS label FROM brands WHERE id = $1::uuid
    `, [target.brand_id]);
    return { entity_type: "brand" as const, entity_id: target.brand_id, entity_label: requiredRow(result).label };
  }
  if (scope === "competitor") {
    if (!suppliedEntityId) {
      throw new SignalSemanticReviewContractError("invalid_input", "Competitor assertions require a governed entity id.");
    }
    const result = await queryable.query<{ label: string }>(`
      SELECT seed.canonical_name AS label
      FROM competitors competitor
      JOIN brand_seeds seed ON seed.id = competitor.competitor_brand_seed_id
      WHERE competitor.id = $1::uuid AND competitor.brand_id = $2::uuid AND seed.active = true
    `, [suppliedEntityId, target.brand_id]);
    const row = result.rows[0];
    if (!row) throw new SignalSemanticReviewContractError("not_found", "Governed competitor was not found.");
    return { entity_type: "competitor" as const, entity_id: suppliedEntityId, entity_label: row.label };
  }
  if (scope === "category") {
    if (!suppliedEntityId) {
      throw new SignalSemanticReviewContractError("invalid_input", "Category assertions require a governed entity id.");
    }
    const result = await queryable.query<{ label: string }>(`
      SELECT canonical_name AS label
      FROM intelligence_entities
      WHERE id = $1::uuid AND brand_id = $2::uuid
        AND entity_type = 'category' AND status = 'active'
    `, [suppliedEntityId, target.brand_id]);
    const row = result.rows[0];
    if (!row) throw new SignalSemanticReviewContractError("not_found", "Governed category was not found.");
    return { entity_type: "category" as const, entity_id: suppliedEntityId, entity_label: row.label };
  }
  if (scope === "reference") {
    if (!suppliedEntityId) {
      return { entity_type: "reference" as const, entity_id: null, entity_label: "Reference" };
    }
    const result = await queryable.query<{ label: string }>(`
      SELECT canonical_name AS label
      FROM intelligence_entities
      WHERE id = $1::uuid AND brand_id = $2::uuid
        AND entity_type = 'reference' AND status = 'active'
    `, [suppliedEntityId, target.brand_id]);
    const row = result.rows[0];
    if (!row) throw new SignalSemanticReviewContractError("not_found", "Governed reference was not found.");
    return { entity_type: "reference" as const, entity_id: suppliedEntityId, entity_label: row.label };
  }
  if (suppliedEntityId) {
    throw new SignalSemanticReviewContractError("invalid_input", "Unattributed assertions cannot claim an entity id.");
  }
  return { entity_type: "unattributed" as const, entity_id: null, entity_label: "Unattributed" };
}

function resolveQueueState(
  assertions: SignalSemanticCurrentAssertionV1[],
  resolution: SignalSemanticCandidateResolutionV1
): SignalSemanticQueueStateV1 {
  const current = assertions.filter((assertion) => assertion.is_current);
  // A multi-entity mention is not resolved until every current assertion has
  // left Review. One approved identity must never hide a sibling that is still
  // pending.
  if (current.some((assertion) => assertion.review_status === "pending")) return "candidate_pending";
  if (current.some((assertion) => assertion.review_status === "approved")) return "current_approved";
  if (current.some((assertion) => assertion.review_status === "rejected")) return "current_rejected";
  if (resolution.state === "candidate") return "candidate_pending";
  return resolution.state;
}

function summarizeReviewItems(items: SignalSemanticReviewQueueItemV1[]) {
  const stateCounts = Object.fromEntries(QUEUE_STATES.map((state) => [state, 0])) as Record<SignalSemanticQueueStateV1, number>;
  const scopeCounts = Object.fromEntries(SCOPES.map((scope) => [scope, 0])) as Record<SignalSemanticScopeV1, number>;
  const confidenceCounts: Record<SignalSemanticConfidenceBandV1, number> = { high: 0, medium: 0, low: 0 };
  let candidateAssertionCount = 0;
  for (const item of items) {
    stateCounts[item.state] += 1;
    for (const candidate of item.proposed_assertions) {
      candidateAssertionCount += 1;
      scopeCounts[candidate.scope] += 1;
      confidenceCounts[candidate.confidence_band] += 1;
    }
  }
  const reconciled = Object.values(stateCounts).reduce((sum, count) => sum + count, 0);
  if (reconciled !== items.length) {
    throw new SignalSemanticReviewContractError("forbidden_state", "Semantic Review queue does not reconcile.");
  }
  return {
    included_root_count: items.length,
    state_counts: stateCounts,
    candidate_assertion_count: candidateAssertionCount,
    candidate_counts_by_scope: scopeCounts,
    candidate_counts_by_confidence: confidenceCounts,
    reconciled: true
  };
}

function matchesReviewFilters(item: SignalSemanticReviewQueueItemV1, filters: SignalSemanticReviewFiltersV1) {
  if (filters.mention_id && item.mention_id !== filters.mention_id) return false;
  if (filters.state && item.state !== filters.state) return false;
  if (filters.proposed_scope) {
    const scopes = new Set([
      ...item.proposed_assertions.map((candidate) => candidate.scope),
      ...item.current_assertions.filter((assertion) => assertion.is_current).map((assertion) => assertion.scope)
    ]);
    if (!scopes.has(filters.proposed_scope)) return false;
  }
  if (filters.confidence_band && !item.proposed_assertions.some((candidate) => candidate.confidence_band === filters.confidence_band)) {
    return false;
  }
  if (filters.data_source_id && !item.source_intent.some((intent) => intent.data_source_id === filters.data_source_id)) return false;
  if (filters.platform && item.platform.toLowerCase() !== filters.platform.toLowerCase()) return false;
  const published = new Date(item.published_at).getTime();
  if (filters.start && published < new Date(`${filters.start}T00:00:00.000Z`).getTime()) return false;
  if (filters.end && published >= new Date(`${filters.end}T00:00:00.000Z`).getTime() + 86_400_000) return false;
  return true;
}

function normalizeReviewFilters(filters: SignalSemanticReviewFiltersV1) {
  return {
    mention_id: filters.mention_id ?? null,
    state: filters.state ?? null,
    proposed_scope: filters.proposed_scope ?? null,
    confidence_band: filters.confidence_band ?? null,
    data_source_id: filters.data_source_id ?? null,
    platform: filters.platform?.trim().toLowerCase() || null,
    start: filters.start ?? null,
    end: filters.end ?? null
  };
}

function parseSourceIntents(value: unknown): SignalSemanticSourceIntentV1[] {
  return Array.isArray(value) ? value as SignalSemanticSourceIntentV1[] : [];
}

function parseCurrentAssertions(value: unknown): SignalSemanticCurrentAssertionV1[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const assertion = item as SignalSemanticCurrentAssertionV1 & { confidence: string | number | null };
    return {
      ...assertion,
      confidence: assertion.confidence === null ? null : Number(assertion.confidence),
      resolution_state: semanticAssertionResolutionState(assertion)
    };
  });
}

function semanticAssertionResolutionState(assertion: Omit<SignalSemanticCurrentAssertionV1, "resolution_state">) {
  if (!assertion.is_current) return "superseded" as const;
  if (assertion.review_status === "rejected") return "rejected" as const;
  if (assertion.review_status === "pending") return "pending" as const;
  if (assertion.approval_source === "claude_semantic_resolution"
      || assertion.evidence_kind === "model_reviewed_context") {
    return "approved_by_model" as const;
  }
  if (assertion.approved_by_user_id || assertion.approval_source === "noisia_admin_semantic_review") {
    return "approved_by_human" as const;
  }
  return "approved_by_policy" as const;
}

function singleExcerpt(snippet: string | null, text: string) {
  const value = (snippet || text).replace(/\s+/gu, " ").trim();
  return value.length <= 2_000 ? value : `${value.slice(0, 1_999)}…`;
}

function safeUrlHost(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function compareReviewItems(left: SignalSemanticReviewQueueItemV1, right: SignalSemanticReviewQueueItemV1) {
  const byDate = right.published_at.localeCompare(left.published_at);
  return byDate || right.mention_id.localeCompare(left.mention_id);
}

function reviewQueueDigest(items: SignalSemanticReviewQueueItemV1[]) {
  return signalSemanticStableHashV1(items.map((item) => ({
    mention_id: item.mention_id,
    state: item.state,
    published_at: item.published_at,
    candidate_ids: item.proposed_assertions.map((candidate) => candidate.idempotency_key),
    current: item.current_assertions.filter((assertion) => assertion.is_current).map((assertion) => ({
      id: assertion.id,
      review_status: assertion.review_status,
      eligibility_status: assertion.eligibility_status,
      evidence_hash: assertion.evidence_hash
    }))
  })));
}

type ReviewCursor = {
  v: typeof SIGNAL_SEMANTIC_REVIEW_CURSOR_VERSION;
  workspace_id: string;
  filter_hash: string;
  queue_digest: string;
  published_at: string;
  mention_id: string;
};

function encodeReviewCursor(cursor: ReviewCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeReviewCursor(value: string): ReviewCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ReviewCursor>;
    if (
      parsed.v !== SIGNAL_SEMANTIC_REVIEW_CURSOR_VERSION
      || typeof parsed.workspace_id !== "string"
      || typeof parsed.filter_hash !== "string"
      || typeof parsed.queue_digest !== "string"
      || typeof parsed.published_at !== "string"
      || typeof parsed.mention_id !== "string"
    ) throw new Error("invalid cursor");
    return parsed as ReviewCursor;
  } catch {
    throw new SignalSemanticReviewContractError("invalid_input", "Semantic Review cursor is invalid.");
  }
}

function compareReviewItemToCursor(item: SignalSemanticReviewQueueItemV1, cursor: ReviewCursor) {
  if (item.published_at < cursor.published_at) return 1;
  if (item.published_at > cursor.published_at) return -1;
  if (item.mention_id < cursor.mention_id) return 1;
  if (item.mention_id > cursor.mention_id) return -1;
  return 0;
}

function cleanRationale(value: string) {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (cleaned.length < 3 || cleaned.length > 2_000) {
    throw new SignalSemanticReviewContractError("invalid_input", "Review rationale must be between 3 and 2000 characters.");
  }
  return cleaned;
}

function cleanIdempotencyInput(value: string) {
  const cleaned = value.trim();
  if (cleaned.length < 8 || cleaned.length > 500) {
    throw new SignalSemanticReviewContractError("invalid_input", "Idempotency-Key must be between 8 and 500 characters.");
  }
  return cleaned;
}

function assertConfidence(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new SignalSemanticReviewContractError("invalid_input", "confidence must be between 0 and 1.");
  }
}

function requiredRow<T>(result: QueryResult<T & QueryResultRow>) {
  const row = result.rows[0];
  if (!row) throw new SignalSemanticReviewContractError("forbidden_state", "Semantic Review operation returned no row.");
  return row;
}
