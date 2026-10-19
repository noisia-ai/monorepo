import { resolveSignalWorkspaceCapabilitiesV1, type SignalWorkspaceCapabilityAuthorityV1 } from './signal-workspace-capabilities';
import type { SignalWorkspaceCorpusReadinessQueryableV1 } from './signal-workspace-corpus-readiness';

/** Receipt accounting for the entire workspace, not brand attribution, analytical
 * readiness or Signal publication. Capture scopes count accepted files, not roots. */
export type AdminWorkspaceCorpusSummaryV1 = {
  contract_version: 'admin-workspace-corpus-summary-v1';
  workspace_id: string;
  observed_at: string;
  state: 'awaiting_import' | 'received' | 'needs_attention';
  received_unique_roots: number | null;
  measurement_state: 'complete' | 'partial' | 'unavailable';
  unmeasured_sources: number;
  included_roots: number;
  excluded_roots: number;
  pending_roots: number;
  accepted_files: number;
  records_read: number;
  duplicate_rows: number;
  sources_with_accepted_imports: number;
  /** Existing sources without accepted import evidence are not measured here. */
  sources_without_accepted_imports: number;
  capture_scopes: { primary_brand: number; competitor: number; category: number; reference: number; unknown: number };
  coverage: {
    from: string | null; through: string | null; timezone: string;
    dated_roots: number; unknown_date_roots: number;
    state: 'observed' | 'partial' | 'unavailable';
  };
  reconciliation_errors: string[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const count = (value: unknown) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/u.test(value))) throw new Error('admin_workspace_corpus_count_invalid');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('admin_workspace_corpus_count_invalid');
  return n;
};

/** Two constant batch queries (authority, aggregates), never one corpus scan per
 * brand. The capability resolver is shared with workspace APIs; unauthorized IDs
 * produce no result. No text, provider call, mutation or legacy corpus is read. */
export async function loadAdminWorkspaceCorpusSummariesV1(args: {
  queryable: SignalWorkspaceCorpusReadinessQueryableV1;
  workspace_ids: string[];
  actor_user_id: string;
}): Promise<Map<string, AdminWorkspaceCorpusSummaryV1>> {
  if (!uuid.test(args.actor_user_id) || args.workspace_ids.some(id => !uuid.test(id))) throw new Error('admin_workspace_corpus_scope_invalid');
  const ids = [...new Set(args.workspace_ids.map(id => id.toLowerCase()))];
  if (!ids.length) return new Map();
  const authority = await args.queryable.query<SignalWorkspaceCapabilityAuthorityV1 & { workspace_id: string }>(`
    SELECT workspace.id::text workspace_id, workspace.status workspace_status, brand.status brand_status,
      actor.status actor_status,actor.user_type,actor.primary_role,
      (actor.organization_id=workspace.organization_id) same_organization,grant_access.access_level brand_access_level
    FROM signal_workspaces workspace JOIN users actor ON actor.id=$2::uuid
    LEFT JOIN brands brand ON brand.id=workspace.brand_id
    LEFT JOIN LATERAL (
      SELECT access.access_level FROM user_brand_access access
      WHERE access.user_id=actor.id AND access.brand_id=workspace.brand_id AND access.revoked_at IS NULL
      ORDER BY CASE access.access_level WHEN 'admin' THEN 0 WHEN 'comment' THEN 1 ELSE 2 END LIMIT 1
    ) grant_access ON true
    WHERE workspace.id=ANY($1::uuid[])
  `, [ids, args.actor_user_id]);
  const visible = authority.rows.filter(row => resolveSignalWorkspaceCapabilitiesV1(row).can_view).map(row => row.workspace_id);
  if (!visible.length) return new Map();
  const result = await args.queryable.query<Record<string, unknown>>(ADMIN_WORKSPACE_CORPUS_SUMMARIES_SQL, [visible]);
  return new Map(result.rows.map(row => {
    const workspaceId = String(row.workspace_id);
    if (!visible.includes(workspaceId)) throw new Error('admin_workspace_corpus_scope_invalid');
    const acceptedFiles = count(row.accepted_files), received = count(row.received_unique_roots), dated = count(row.dated_roots);
    const included = count(row.included_roots), excluded = count(row.excluded_roots), pending = count(row.pending_roots);
    if (dated > received || included + excluded + pending !== received) throw new Error('admin_workspace_corpus_count_invalid');
    const errors: string[] = [];
    for (const [key, code] of [['invalid_links', 'canonical_root_link_invalid'], ['missing_import_links', 'accepted_import_membership_missing'],
      ['invalid_sources', 'accepted_import_source_unavailable'], ['invalid_counters', 'accepted_import_counters_mismatch']] as const) {
      if (count(row[key]) > 0) errors.push(code);
    }
    const observedAt = String(row.observed_at);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(observedAt)) throw new Error('admin_workspace_corpus_timestamp_invalid');
    const from = row.coverage_from === null ? null : String(row.coverage_from), through = row.coverage_through === null ? null : String(row.coverage_through);
    if ((dated > 0) !== (from !== null && through !== null) || from !== null && (!/^\d{4}-\d{2}-\d{2}$/u.test(from) || !/^\d{4}-\d{2}-\d{2}$/u.test(through!) || from > through!)) {
      throw new Error('admin_workspace_corpus_timestamp_invalid');
    }
    const unmeasured = count(row.unmeasured_sources);
    const measurement = unmeasured > 0 && acceptedFiles === 0 ? 'unavailable' : unmeasured > 0 || errors.length ? 'partial' : 'complete';
    const summary: AdminWorkspaceCorpusSummaryV1 = {
      contract_version: 'admin-workspace-corpus-summary-v1', workspace_id: workspaceId, observed_at: observedAt,
      state: errors.length ? 'needs_attention' : acceptedFiles ? 'received' : 'awaiting_import',
      received_unique_roots: measurement === 'unavailable' ? null : received, measurement_state: measurement, unmeasured_sources: unmeasured, included_roots: included, excluded_roots: excluded, pending_roots: pending,
      accepted_files: acceptedFiles, records_read: count(row.records_read), duplicate_rows: count(row.duplicate_rows),
      sources_with_accepted_imports: count(row.sources_with_accepted_imports), sources_without_accepted_imports: count(row.sources_without_accepted_imports),
      capture_scopes: { primary_brand: count(row.scope_primary_brand), competitor: count(row.scope_competitor),
        category: count(row.scope_category), reference: count(row.scope_reference), unknown: count(row.scope_unknown) },
      coverage: { from, through, timezone: String(row.timezone), dated_roots: dated, unknown_date_roots: received - dated,
        state: !dated ? 'unavailable' : dated < received || errors.length || unmeasured > 0 ? 'partial' : 'observed' },
      reconciliation_errors: errors
    };
    if (Object.values(summary.capture_scopes).reduce((a,b) => a+b,0) !== acceptedFiles) throw new Error('admin_workspace_corpus_count_invalid');
    return [workspaceId, summary];
  }));
}

export const ADMIN_WORKSPACE_CORPUS_SUMMARIES_SQL = `
  WITH workspaces AS MATERIALIZED (
    SELECT id,timezone FROM signal_workspaces WHERE id=ANY($1::uuid[])
  ), accepted AS MATERIALIZED (
    SELECT batch.id,batch.workspace_id,batch.data_source_id,batch.record_count,batch.included_count,batch.excluded_count,batch.duplicate_count,
      source.id source_id,slot.scope
    FROM import_batches batch JOIN workspaces workspace ON workspace.id=batch.workspace_id
    LEFT JOIN data_sources source ON source.id=batch.data_source_id AND source.workspace_id=batch.workspace_id
    LEFT JOIN signal_acquisition_slots slot ON slot.id=batch.acquisition_slot_id AND slot.workspace_id=batch.workspace_id
      AND slot.plan_id=batch.acquisition_plan_id AND slot.definition_hash=batch.acquisition_slot_digest
    WHERE batch.status='completed'
  ), links AS MATERIALIZED (
    SELECT batch.workspace_id,batch.id import_batch_id,root.id root_id,root.inclusion_status,
      CASE WHEN isfinite(root.published_at) AND root.published_at>='0001-01-01T00:00:00Z'::timestamptz
        AND root.published_at<'10000-01-01T00:00:00Z'::timestamptz THEN root.published_at END published_at
    FROM accepted batch
    JOIN signal_mention_import_memberships membership ON membership.workspace_id=batch.workspace_id
      AND membership.import_batch_id=batch.id AND membership.data_source_id=batch.data_source_id
    -- Import membership integrity already requires mention_id to reference a canonical
    -- root. Keep the PK planning boundary so stale statistics cannot choose a workspace
    -- scan once per root, without resolving the same canonical mention twice.
    LEFT JOIN LATERAL (SELECT id,workspace_id,canonical_mention_id,inclusion_status,published_at FROM mentions WHERE id=membership.mention_id OFFSET 0)
      root ON root.workspace_id=batch.workspace_id AND root.canonical_mention_id=root.id
  ), roots AS MATERIALIZED (
    SELECT DISTINCT workspace_id,root_id,inclusion_status,published_at FROM links WHERE root_id IS NOT NULL
  ), root_summary AS (
    SELECT roots.workspace_id,count(*) received_unique_roots,
      count(*) FILTER(WHERE inclusion_status='included') included_roots,
      count(*) FILTER(WHERE inclusion_status='excluded') excluded_roots,
      count(*) FILTER(WHERE inclusion_status IS NULL OR inclusion_status NOT IN('included','excluded')) pending_roots,
      count(published_at) dated_roots,
      min((published_at AT TIME ZONE workspace.timezone)::date)::text coverage_from,
      max((published_at AT TIME ZONE workspace.timezone)::date)::text coverage_through
    FROM roots JOIN workspaces workspace ON workspace.id=roots.workspace_id GROUP BY roots.workspace_id
  ), import_summary AS (
    SELECT batch.workspace_id,count(*) accepted_files,COALESCE(sum(batch.record_count),0) records_read,
      COALESCE(sum(batch.duplicate_count),0) duplicate_rows,count(DISTINCT batch.source_id) sources_with_accepted_imports,
      count(*) FILTER(WHERE batch.scope='primary_brand') scope_primary_brand,
      count(*) FILTER(WHERE batch.scope='competitor') scope_competitor,
      count(*) FILTER(WHERE batch.scope='category') scope_category,
      count(*) FILTER(WHERE batch.scope='reference') scope_reference,
      count(*) FILTER(WHERE batch.scope IS NULL) scope_unknown,
      count(*) FILTER(WHERE batch.source_id IS NULL) invalid_sources,
      count(*) FILTER(WHERE batch.record_count IS NULL OR batch.included_count IS NULL OR batch.excluded_count IS NULL OR batch.duplicate_count IS NULL
        OR least(batch.record_count,batch.included_count,batch.excluded_count,batch.duplicate_count)<0
        OR batch.record_count::bigint<>batch.included_count::bigint+batch.excluded_count::bigint+batch.duplicate_count::bigint) invalid_counters,
      count(*) FILTER(WHERE batch.included_count::bigint+batch.excluded_count::bigint>0 AND link.import_batch_id IS NULL) missing_import_links
    FROM accepted batch LEFT JOIN (SELECT DISTINCT import_batch_id FROM links) link ON link.import_batch_id=batch.id
    GROUP BY batch.workspace_id
  ), link_errors AS (SELECT workspace_id,count(*) FILTER(WHERE root_id IS NULL) invalid_links FROM links GROUP BY workspace_id),
  other_sources AS (SELECT source.workspace_id,count(*) sources_without_accepted_imports,
      count(*) FILTER(WHERE source.status='active' AND source.connection_method IS DISTINCT FROM 'manual-csv') unmeasured_sources
    FROM data_sources source JOIN workspaces workspace ON workspace.id=source.workspace_id
    WHERE NOT EXISTS(SELECT 1 FROM accepted batch WHERE batch.workspace_id=source.workspace_id AND batch.source_id=source.id)
    GROUP BY source.workspace_id)
  SELECT workspace.id::text workspace_id,workspace.timezone,
    to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at,
    COALESCE(root_summary.received_unique_roots,0) received_unique_roots,
    COALESCE(root_summary.included_roots,0) included_roots,COALESCE(root_summary.excluded_roots,0) excluded_roots,
    COALESCE(root_summary.pending_roots,0) pending_roots,COALESCE(root_summary.dated_roots,0) dated_roots,
    root_summary.coverage_from,root_summary.coverage_through,
    COALESCE(import_summary.accepted_files,0) accepted_files,COALESCE(import_summary.records_read,0) records_read,
    COALESCE(import_summary.duplicate_rows,0) duplicate_rows,COALESCE(import_summary.sources_with_accepted_imports,0) sources_with_accepted_imports,
    COALESCE(other_sources.sources_without_accepted_imports,0) sources_without_accepted_imports,COALESCE(other_sources.unmeasured_sources,0) unmeasured_sources,
    COALESCE(import_summary.scope_primary_brand,0) scope_primary_brand,COALESCE(import_summary.scope_competitor,0) scope_competitor,
    COALESCE(import_summary.scope_category,0) scope_category,COALESCE(import_summary.scope_reference,0) scope_reference,
    COALESCE(import_summary.scope_unknown,0) scope_unknown,COALESCE(import_summary.invalid_sources,0) invalid_sources,
    COALESCE(import_summary.invalid_counters,0) invalid_counters,COALESCE(import_summary.missing_import_links,0) missing_import_links,
    COALESCE(link_errors.invalid_links,0) invalid_links
  FROM workspaces workspace LEFT JOIN root_summary ON root_summary.workspace_id=workspace.id
    LEFT JOIN import_summary ON import_summary.workspace_id=workspace.id LEFT JOIN link_errors ON link_errors.workspace_id=workspace.id
    LEFT JOIN other_sources ON other_sources.workspace_id=workspace.id
  ORDER BY workspace.id
`;
