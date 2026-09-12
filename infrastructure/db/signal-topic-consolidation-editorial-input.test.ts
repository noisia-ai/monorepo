import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { signalTopicEditorialDigestV1 as digest, type SignalTopicEditorialEvidenceLoadV1 } from '@noisia/query-engine';
import { loadSignalTopicConsolidationEditorialInputV1 } from './signal-topic-consolidation-editorial-input';
import type { SignalTopicAtomicCensusV1, SignalTopicConsolidationCommunityPlanV1 } from './signal-topic-consolidation';
import type { SignalTopicInheritedContextStoreV1 } from './signal-topic-catalog';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const scope = { workspace_id: id(9001), actor_user_id: id(9002), numeric_run_id: id(9003) };
const context = { brand_name: 'Synthetic', default_locale: 'es-MX', summary: 'Asistencia por voz.', audiences: [], categories: [],
  competitors: [], positive_anchors: ['Rutinas'], negative_anchors: ['Otra persona'], abstention_anchors: ['Ambiguo'] };
function fixture(count = 2) {
  const trace: string[] = [], batches: number[] = [];
  const text = 'Rutinas por voz', rootText = `😀${text} FIN`;
  const config = { contract_version: 'signal-topic-consolidation-config-v1', dossier_version: 'signal-topic-group-dossier-v1',
    representative_limit: 10, neighbor_limit: 10, community_algorithm: 'centroid-knn-v1', neighbor_k: 10,
    min_similarity_ppm: 720000, assignment_policy: 'partition-all-groups-v1' } as const;
  const census: SignalTopicAtomicCensusV1 = { contract_version: 'signal-topic-consolidation-v1', workspace_id: scope.workspace_id,
    source_execution_id: id(9004), source_checkpoint_digest: digest('checkpoint'), output_artifact_id: id(9005),
    output_artifact_sha256: digest('output'), model_artifact_id: id(9006), model_artifact_sha256: digest('model'),
    centroid_artifact_id: null, centroid_artifact_sha256: null, context_digest: digest('context'), configuration: config,
    configuration_digest: digest(config), expected_group_count: count, groups: Array.from({ length: count }, (_, index) => {
      const coords = { root_id: id(index + 1), chunk_index: 0, start: 2, end: 2 + text.length, chunk_sha256: sha(text) };
      const dossier = { contract_version: 'signal-topic-group-dossier-v1' as const, scope_counts: { brand: 1, competitor: 0, category: 0, unknown: 0 },
        locale_counts: [{ key: 'es-MX', count: 1 }], platform_counts: [], month_counts: [],
        brand_affinity: { positive: [], negative: [], abstention: [] }, neighbors: [], metrics: { cohesion: null, outlier_ratio: null },
        evidence: [{ ...coords, ref_id: digest(coords), locale: 'es-MX', platform: null, occurred_at: null }] };
      return { group_key: `open:cluster-${index}`, lane: 'open', stable_cluster_id: `cluster-${index}`, local_label: index,
        group_digest: digest(['group', index]), root_count: 1, chunk_count: 1, terms: ['voz'], dossier, dossier_digest: digest(dossier),
        centroid: null, roots: [{ root_id: coords.root_id, chunk_count: 1, strength: null, assignment_digest: digest(['root', index]) }] };
    }) };
  const members = census.groups.map((g, rank) => ({ group_key: g.group_key, rank, similarity: .8 }));
  const community_plan: SignalTopicConsolidationCommunityPlanV1 = { contract_version: 'signal-topic-centroid-community-plan-v1',
    configuration_digest: census.configuration_digest, communities: [{ community_key: 'community-all', members, community_digest: digest({ members }) }] };
  const source = { numeric_run_id: scope.numeric_run_id, census, census_snapshot_digest: digest(census), community_plan,
    source_binding: { census_digest: digest(census), community_plan_digest: digest(community_plan) } };
  const inherited: SignalTopicInheritedContextStoreV1 = { context_digest: census.context_digest, editorial_context: structuredClone(context),
    embedding_text: '', negative_embedding_text: '', embedding_contexts: {} as SignalTopicInheritedContextStoreV1['embedding_contexts'], context_refs: [],
    locale: { primary_locale: 'es-MX', languages: ['es-MX'], markets: ['MX'], timezone: 'America/Mexico_City' } };
  let alter = (rows: Array<SignalTopicEditorialEvidenceLoadV1 & { asset_sha256: string }>) => rows;
  const client = { query: async (sql: string, params?: unknown[]) => {
    trace.push(sql);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/u);
    if (!sql.includes('WITH requested AS')) return { rows: [] };
    assert.deepEqual(params?.slice(0, 3), [scope.workspace_id, scope.numeric_run_id, census.source_execution_id]);
    assert.match(sql, /execution\.preparation_run_id/u); assert.match(sql, /atomic\.consolidation_run_id=\$2/u);
    assert.match(sql, /evidence\.start_offset=ref\.start/u); assert.match(sql, /evidence\.end_offset=ref\."end"/u);
    const refs = JSON.parse(String(params?.[3])) as Array<Omit<SignalTopicEditorialEvidenceLoadV1, 'root_text'>>;
    batches.push(refs.length);
    return { rows: alter(refs.map(ref => ({ ...ref, root_text: rootText, asset_sha256: sha(rootText) }))) };
  }, release: () => trace.push('release') } as unknown as PoolClient;
  const dependencies: NonNullable<Parameters<typeof loadSignalTopicConsolidationEditorialInputV1>[1]> = {
    source: async args => { trace.push('source'); assert.equal(args.queryable, client); return source; },
    context: async args => { trace.push('context'); assert.equal(args.queryable, client);
      assert.equal(args.complete_context, true); assert.equal(args.require_current_semantic_authority, true);
      assert.equal(args.include_editorial_context, true); return inherited; },
  };
  return { source, inherited, trace, batches, dependencies, alter: (fn: typeof alter) => { alter = fn; },
    args: { ...scope, database: { connect: async () => client } } };
}
test('loads all groups through bounded snapshot evidence reads and emits only verified UTF-16 fragments', async () => {
  const f = fixture(129), result = await loadSignalTopicConsolidationEditorialInputV1(f.args, f.dependencies);
  assert.deepEqual(f.batches, [128, 1]); assert.equal(result.groups.length, 129); assert.equal(result.root_lineage.length, 129);
  assert.equal(result.source_context_digest, f.source.census.context_digest); assert.equal(result.editorial_context_digest, digest(context));
  assert.equal(result.groups[0]!.evidence[0]!.text, 'Rutinas por voz'); assert.ok(!JSON.stringify(result).includes('root_text'));
  assert.deepEqual(f.trace.slice(-2), ['COMMIT', 'release']); assert.equal(f.trace[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('authorization failures stop before context/evidence and release the snapshot', async () => {
  const f = fixture(); f.dependencies.source = async () => { throw Error('processing_forbidden'); };
  await assert.rejects(loadSignalTopicConsolidationEditorialInputV1(f.args, f.dependencies), /processing_forbidden/u);
  assert.equal(f.batches.length, 0); assert.ok(!f.trace.includes('context')); assert.deepEqual(f.trace.slice(-2), ['ROLLBACK', 'release']);
});
test('rejects changed context and census before reading raw evidence', async () => {
  for (const change of ['context', 'census']) {
    const f = fixture();
    if (change === 'context') f.inherited.context_digest = digest('stale');
    else f.source.census.groups[0]!.terms.push('changed');
    await assert.rejects(loadSignalTopicConsolidationEditorialInputV1(f.args, f.dependencies), /source_stale|source_digest_invalid|census_changed/u);
    assert.equal(f.batches.length, 0); assert.equal(f.trace.at(-1), 'release');
  }
});
test('rejects missing, duplicate, foreign and changed evidence without partial results', async () => {
  for (const mode of ['missing', 'duplicate', 'foreign', 'asset', 'fragment', 'range']) {
    const f = fixture(); f.alter(rows => {
      if (mode === 'missing') return rows.slice(1);
      if (mode === 'duplicate') return [rows[0]!, rows[0]!];
      const row = rows[0]!;
      if (mode === 'foreign') row.root_id = id(8000);
      if (mode === 'asset') row.root_text += 'changed';
      if (mode === 'fragment') { row.root_text = row.root_text.replace('Rutinas', 'Otraaaa'); row.asset_sha256 = sha(row.root_text); }
      if (mode === 'range') row.end++;
      return rows;
    });
    await assert.rejects(loadSignalTopicConsolidationEditorialInputV1(f.args, f.dependencies), /evidence_unavailable|evidence_duplicate|range_invalid|asset_changed|hash_invalid/u);
    assert.deepEqual(f.trace.slice(-2), ['ROLLBACK', 'release']);
  }
});
