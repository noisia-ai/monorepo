import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { prepareSignalTopicEditorialInputV1, signalTopicEditorialDigestV1,
  type SignalTopicEditorialEvidenceLoadV1, type SignalTopicEditorialPreparedInputV1 } from '@noisia/query-engine';
import { loadSignalTopicInheritedContextStoreV1 } from './signal-topic-catalog';
import { readSignalTopicConsolidationEditorialSourceWithQueryableV1,
  SignalTopicEditorialStoreError, type SignalTopicEditorialDatabaseV1 } from './signal-topic-consolidation-editorial';

type Scope = { workspace_id: string; actor_user_id: string; numeric_run_id: string };
type EvidenceRequest = Parameters<Parameters<typeof prepareSignalTopicEditorialInputV1>[0]['load_evidence']>[0];
const fail = (code: string): never => { throw new SignalTopicEditorialStoreError(code); };
const textHash = (value: string) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
const readers = { source: readSignalTopicConsolidationEditorialSourceWithQueryableV1, context: loadSignalTopicInheritedContextStoreV1 };

/** Private server projection, never a browser-supplied context or evidence locator. */
export async function loadSignalTopicConsolidationEditorialInputV1(args: Scope & { database: SignalTopicEditorialDatabaseV1 },
  dependencies: typeof readers = readers): Promise<SignalTopicEditorialPreparedInputV1> {
  const client = await args.database.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const source = await dependencies.source({ ...args, queryable: client });
    const inherited = await dependencies.context({ queryable: client, workspace_id: args.workspace_id,
      complete_context: true, require_current_semantic_authority: true, include_editorial_context: true });
    if (inherited.context_digest !== source.census.context_digest || !inherited.editorial_context)
      fail('topic_editorial_source_stale');
    const context = inherited.editorial_context ?? fail('topic_editorial_source_stale');
    const censusSnapshotDigest = signalTopicEditorialDigestV1(source.census);
    if (censusSnapshotDigest !== source.census_snapshot_digest) fail('topic_editorial_census_changed');
    const result = await prepareSignalTopicEditorialInputV1({ census: source.census,
      expected_census_digest: censusSnapshotDigest, source_census_digest: String(source.source_binding.census_digest), communities: source.community_plan,
      expected_community_plan_digest: String(source.source_binding.community_plan_digest),
      context, expected_source_context_digest: inherited.context_digest,
      expected_editorial_context_digest: signalTopicEditorialDigestV1(context),
      load_evidence: request => readEvidence(client, args, source.census.source_execution_id,
        censusSnapshotDigest, request),
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function readEvidence(client: PoolClient, scope: Scope, sourceExecution: string, censusDigest: string,
  request: EvidenceRequest): Promise<SignalTopicEditorialEvidenceLoadV1[]> {
  if (request.workspace_id !== scope.workspace_id || request.source_execution_id !== sourceExecution
    || request.census_digest !== censusDigest) fail('topic_editorial_evidence_scope_invalid');
  const loaded: SignalTopicEditorialEvidenceLoadV1[] = [];
  // Bound DB parameters and payloads while retaining every requested reference.
  for (let offset = 0; offset < request.refs.length; offset += 128) {
    const refs = request.refs.slice(offset, offset + 128);
    const rows = (await client.query<SignalTopicEditorialEvidenceLoadV1 & { asset_sha256: string }>(`
      WITH requested AS (
        SELECT * FROM jsonb_to_recordset($4::jsonb) AS ref(ref_id text,root_id uuid,chunk_index integer,
          start integer,"end" integer,chunk_sha256 text)
      )
      SELECT ref.ref_id,ref.root_id::text,ref.chunk_index,ref.start,ref."end",ref.chunk_sha256,
        asset.full_text AS root_text,item.asset_sha256
      FROM requested ref
      JOIN signal_topic_catalog_executions execution ON execution.id=$3::uuid AND execution.workspace_id=$1::uuid
      JOIN signal_corpus_preparation_items item ON item.run_id=execution.preparation_run_id
        AND item.workspace_id=execution.workspace_id AND item.root_id=ref.root_id AND item.disposition='eligible'
      JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
        AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
      WHERE (asset.chunks->'chunks'->ref.chunk_index->>'start')::integer=ref.start
        AND (asset.chunks->'chunks'->ref.chunk_index->>'end')::integer=ref."end"
        AND asset.chunks->'chunks'->ref.chunk_index->>'sha256'=ref.chunk_sha256
        AND EXISTS (
          SELECT 1 FROM signal_topic_atomic_group_evidence evidence
          JOIN signal_topic_atomic_groups atomic ON atomic.id=evidence.atomic_group_id
          JOIN signal_topic_atomic_group_roots member ON member.atomic_group_id=atomic.id
            AND member.canonical_root_id=ref.root_id
          WHERE atomic.consolidation_run_id=$2::uuid AND atomic.workspace_id=$1::uuid
            AND evidence.ref_id=ref.ref_id AND evidence.canonical_root_id=ref.root_id
            AND evidence.chunk_index=ref.chunk_index AND evidence.start_offset=ref.start
            AND evidence.end_offset=ref."end" AND evidence.chunk_sha256=ref.chunk_sha256
        ) ORDER BY ref.ref_id COLLATE "C"`,
    [scope.workspace_id, scope.numeric_run_id, sourceExecution, JSON.stringify(refs)])).rows;
    if (rows.length !== refs.length) fail('topic_editorial_evidence_unavailable');
    for (const row of rows) {
      if (typeof row.root_text !== 'string' || textHash(row.root_text) !== row.asset_sha256)
        fail('topic_editorial_evidence_asset_changed');
      const { asset_sha256: _asset, ...evidence } = row;
      loaded.push(evidence);
    }
  }
  return loaded;
}
