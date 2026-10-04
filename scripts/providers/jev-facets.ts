/** Real JEV corpus demo, opt-in only; root versions the processing policy separately. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { main, openDatabase } from '../dev-corpus/guard.mjs';
void main(async () => {
  if (process.env.NOISIA_MENTION_FACETS_ENABLED !== 'true' || process.env.NOISIA_JEV_PROVIDER_ENABLED !== 'true') throw new Error('mfp_jev_disabled');
  const key = process.argv.find(arg => arg.startsWith('--key='))?.slice(6);
  if (!key) throw new Error('mfp_jev_execution_key_required');
  const configuredPrice = process.env.NOISIA_JEV_INPUT_USD_PER_MTOK;
  const price = Number(configuredPrice);
  if (configuredPrice === undefined || !Number.isFinite(price) || price < 0) throw new Error('mfp_jev_price_required');
  const pool = await openDatabase();
  try {
    const identity = JSON.parse(await readFile('.data/dev-corpus/identity.json', 'utf8'));
    const { requestMentionFacetsV1 } = await import('../../infrastructure/db/signal-labeling-runs');
    const { jevFacetLabelerIdentityV1, JEV_FACET_EXPERIMENTAL_THRESHOLDS_V1, buildJevFacetRequestV1 } = await import('../../packages/query-engine/src/signal-mention-facets-jev-v1');
    const { inspectFacetContextChangeV1 } = await import('../../infrastructure/db/signal-mention-facets');
    const { createMentionFacetsRuntimeStoreV1 } = await import('../../services/workers/src/workers/signal-mention-facets-batch');
    const { processMentionFacetsJevV1 } = await import('../../services/workers/src/workers/signal-mention-facets-jev');
    const { createTypesafeJevClientV1 } = await import('../../services/workers/src/providers/typesafe-jev');
    const access = { database: pool, workspace_id: identity.workspace_id, actor_user_id: identity.internal_user_id };
    const context = await inspectFacetContextChangeV1(pool, identity.workspace_id);
    const labeler = jevFacetLabelerIdentityV1(JEV_FACET_EXPERIMENTAL_THRESHOLDS_V1, price);
    const census = (await pool.query(`SELECT count(*)::int roots,COALESCE(sum(length(full_text)+COALESCE(length(title),0)),0)::text characters FROM signal_mention_facets_current_v1 WHERE workspace_id=$1`, [identity.workspace_id])).rows[0];
    const reference = buildJevFacetRequestV1({ root_id: '', input_digest: '', text: '', title: null, platform: null, content_type: null, author: null, published_at: '', language: null }, context.context, labeler.model);
    const estimatedTokens = Math.ceil((Number(census.characters) + census.roots * JSON.stringify(reference).length) / 3.5);
    console.log(JSON.stringify({ stage: 'jev_estimate', roots: census.roots, estimated_input_tokens: estimatedTokens, estimated_usd: estimatedTokens * price / 1_000_000, price_usd_per_mtok: price, strict_cap_source: 'server_policy' }));
    const run = await requestMentionFacetsV1({ ...access, identity: labeler, idempotency_key: key, provider_available: true, full_recalculation: process.argv.includes('--full') });
    if (run.waiting_full_confirmation) { console.log(JSON.stringify({ stage: 'jev_waiting_full_scope', run_id: run.run_id })); return; }
    const store = createMentionFacetsRuntimeStoreV1(pool); let providerRequests = 0;
    const provider = createTypesafeJevClientV1({ fetch: async (url, init) => { providerRequests++; return fetch(url, init); } });
    const started = Date.now(); let state = 'running';
    while (state === 'running') {
      const page = await processMentionFacetsJevV1({ run_id: run.run_id, store, provider });
      state = page.status;
      if (state === 'not_claimed') state = (await pool.query('SELECT status FROM signal_labeling_runs WHERE id=$1', [run.run_id])).rows[0].status;
      console.log(JSON.stringify({ stage: 'jev_page', ...page, elapsed_ms: Date.now() - started }));
      if (state === 'running' && !page.roots) throw new Error('mfp_jev_no_progress');
    }
    const counts = (await pool.query(`SELECT status,relevance,count(*)::int roots FROM signal_mention_facets_current_v1 WHERE workspace_id=$1 GROUP BY status,relevance`, [identity.workspace_id])).rows;
    const billing = (await pool.query(`SELECT count(*)::int requests,COALESCE(sum(settled_micro_usd) FILTER(WHERE status='settled'),0)::text settled_micro_usd,
      COALESCE(sum(reserved_micro_usd) FILTER(WHERE status IN('reserved','submitting','submitted','unknown')),0)::text reserved_micro_usd,
      count(*) FILTER(WHERE status IN('submitting','submitted','unknown'))::int unresolved_billing_requests FROM signal_labeling_calls WHERE run_id=$1`, [run.run_id])).rows[0];
    const rawRows = (await pool.query(`SELECT workspace_id,run_id,id,raw_storage_key,raw_sha256,raw_size_bytes::int size_bytes
      FROM signal_labeling_calls WHERE run_id=$1 AND raw_storage_key IS NOT NULL`, [run.run_id])).rows;
    const { createWorkspaceEngineStorageV1 } = await import('../../services/workers/src/workers/signal-workspace-engine-storage');
    const { readSignalLabelingReceiptV1 } = await import('../../services/workers/src/workers/signal-labeling-receipt-storage');
    const storage = createWorkspaceEngineStorageV1();
    const rawBodies = await Promise.all(rawRows.map((row: any) => readSignalLabelingReceiptV1({ storage,
      workspace_id: row.workspace_id, run_id: row.run_id, storage_key: row.raw_storage_key,
      raw_sha256: row.raw_sha256, size_bytes: row.size_bytes })));
    const latencies = rawBodies.map(raw => JSON.parse(raw).latency_ms).filter((value: unknown) => typeof value === 'number' && Number.isFinite(value)).sort((a: number, b: number) => a - b);
    const summary = { stage: 'jev_result', run_id: run.run_id, status: state, counts, billing, price_usd_per_mtok: price, model: labeler.model,
      provider_requests_this_execution: providerRequests, elapsed_ms: Date.now() - started, latency_samples: latencies.length, p50_ms: latencies[Math.ceil(latencies.length * 0.5) - 1] ?? null, p95_ms: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? null, semantics: 'experimental_unvalidated' };
    await mkdir('.data/dev-corpus/jev-facets', { recursive: true, mode: 0o700 });
    await writeFile(`.data/dev-corpus/jev-facets/${run.run_id}-summary.json`, JSON.stringify(summary, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(summary));
  } finally { await pool.end(); }
});
