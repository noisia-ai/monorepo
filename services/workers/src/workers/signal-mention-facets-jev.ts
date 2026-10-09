import { signalWorkspaceEmbeddingDigestV1 as digest } from '@noisia/query-engine/src/signal-workspace-embeddings-v1';
import { buildJevFacetRequestV1, mapJevFacetResponseV1, validateJevThresholdsV1, type JevFacetThresholdsV1 } from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
import { llmPriceV1, llmCostMicroUsdV1 } from '@noisia/query-engine/src/llm-pricing-v1';
import type { FacetResult } from '@noisia/query-engine/src/signal-mention-labeler-v1';
import { signalWorkspaceFeatureEnabledV1, type SignalLabelingStoreV1 } from '@noisia/db';
import type { JevProviderV1 } from '../providers/typesafe-jev';
import { processJevLabelingPageV1, jevUsageV1 } from './signal-jev-labeling-page';
export { jevUsageV1 } from './signal-jev-labeling-page';
/** Facet-specific mapping over the common 200-call JEV page transport. */
export function processMentionFacetsJevV1(args: {run_id:string;store:SignalLabelingStoreV1;provider:JevProviderV1;lease_renewal_ms?:number}) {
  let thresholds:JevFacetThresholdsV1;
  return processJevLabelingPageV1({...args,hooks:{
    price:run=>{
      if(run.identity.provider!=='typesafe'||run.identity.kind!=='facets')throw new Error('jev_run_provider_mismatch');
      const p=run.identity.params;thresholds={entity:p.entity as number,salience:p.salience as number,spam:p.spam as number,minimum_choice_confidence:p.minimum_choice_confidence as number};
      validateJevThresholdsV1(thresholds);return llmPriceV1('typesafe',run.identity.model,'sync',p.input_usd_per_mtok as number);
    },
    propose:(run,inputs)=>inputs.map(input=>{
      const request=buildJevFacetRequestV1(input,run.context,run.identity.model),requestDigest=digest({run_id:run.id,root_id:input.root_id,input_digest:input.input_digest,entity_context_digest:run.entity_context_digest,labeler_digest:run.labeler_digest,request});
      return {custom_id:`mfj1_${requestDigest.replace(/^sha256:/u,'').slice(0,60)}`,request_digest:requestDigest,request,inputs:[input],
        reserved_micro_usd:llmCostMicroUsdV1(jevUsageV1({input_tokens:Math.ceil(JSON.stringify(request).length/3.5),output_tokens:0}),llmPriceV1('typesafe',run.identity.model,'sync',run.identity.params.input_usd_per_mtok as number))};
    }),
    map:(run,call,parsed)=>{const input=call.inputs[0];if(!input||call.inputs.length!==1)throw new Error('jev_input_invalid');return [mapJevFacetResponseV1(input,run.context,parsed,thresholds)];},
    error:(run,call,code):FacetResult[]=>call.inputs.map(input=>({root_id:input.root_id,input_digest:input.input_digest,entity_context_digest:run.entity_context_digest,status:'error',error_code:code})),
    labeled:result=>result.status==='labeled',
  }});
}

export const SIGNAL_MENTION_FACETS_JEV_JOB_V1 = 'signal-mention-facets-jev-v1';
let runtimeProvider: JevProviderV1 | undefined;
export async function signalMentionFacetsJevJobV1(job: { data: { run_id: string } }) {
  if (process.env.NOISIA_MENTION_FACETS_ENABLED !== 'true' || process.env.NOISIA_JEV_PROVIDER_ENABLED !== 'true') throw new Error('jev_disabled');
  const { pool } = await import('../db/client');
  const workspace = (await pool.query<{workspace_id:string}>(
    "SELECT workspace_id FROM signal_labeling_runs WHERE id=$1::uuid AND kind='facets'",[job.data.run_id])).rows[0];
  if (!workspace || !await signalWorkspaceFeatureEnabledV1({queryable:pool,workspace_id:workspace.workspace_id,feature:'mention_facets'}))
    throw new Error('jev_workspace_not_enabled');
  const { createMentionFacetsRuntimeStoreV1 } = await import('./signal-mention-facets-batch');
  const { createTypesafeJevClientV1 } = await import('../providers/typesafe-jev');
  runtimeProvider ??= createTypesafeJevClientV1();
  return processMentionFacetsJevV1({ run_id: job.data.run_id, store: createMentionFacetsRuntimeStoreV1(pool), provider: runtimeProvider });
}
export function startMentionFacetsJevDrainerV1() {
  let active: Promise<void> | undefined;
  const tick = async () => {
    if (process.env.NOISIA_MENTION_FACETS_ENABLED !== 'true' || process.env.NOISIA_JEV_PROVIDER_ENABLED !== 'true') return;
    const { pool } = await import('../db/client');
    if (!(await pool.query("SELECT to_regclass('signal_labeling_runs') IS NOT NULL ready")).rows[0]?.ready) return;
    const rows = (await pool.query(`SELECT r.id FROM signal_labeling_runs r JOIN signal_labeler_versions l ON l.id=r.labeler_version_id
      WHERE r.kind='facets' AND l.provider='typesafe' AND r.status IN('queued','running') AND NOT r.waiting_full_confirmation
      AND r.next_poll_at<=now() AND (r.lease_until IS NULL OR r.lease_until<now()) ORDER BY r.created_at LIMIT 4`)).rows;
    for (const row of rows) await signalMentionFacetsJevJobV1({ data: { run_id: row.id } }).catch(() => console.warn('[mention-facets-jev] page unavailable'));
  };
  const start = () => { if (!active) active = tick().catch(() => console.warn('[mention-facets-jev] drainer unavailable')).finally(() => { active = undefined; }); };
  const timer = setInterval(start, 30_000); timer.unref?.(); start();
  return { async close() { clearInterval(timer); if (active) await active; } };
}
