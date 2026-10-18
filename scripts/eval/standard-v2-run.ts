/** Paid private driver: own idempotency key, persisted receipts and no workspace selection. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {configureStandardV2Calendar} from './standard-v2-calendar';
import {loadMfpEvalIdentity} from './fixture-identity';
import {requestConceptMembershipsV1} from '../../infrastructure/db/signal-concept-memberships';
import {createConceptMembershipRuntimeStoreV1,runConceptMembershipTickV1} from '../../services/workers/src/workers/signal-concept-membership-batch';
import {createAnthropicMessageBatchesClient,AnthropicBatchTransportError,anthropicBatchErrorReceipt} from '../../services/workers/src/providers/anthropic-message-batches';
const directory='.data/dev-corpus/voyage-real/standard-v2-r11';
void main(async()=>{
 if(!process.argv.includes('--real')||process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED!=='true')throw new Error('mfp_standard_v2_provider_disabled');
 const identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 const baseline=JSON.parse(await readFile(`${directory}/baseline.json`,'utf8'));
 const acceptance=JSON.parse(await readFile(`${directory}/acceptance.json`,'utf8'));assert.equal(acceptance.passed,true);
 const installation=JSON.parse(await readFile(`${directory}/v4-data-installed.json`,'utf8'));
 assert.equal(installation.input_sha256,'83079a6f3c1c8bf1a93009dd8a6ae9b42b80d42bc780a996ce203d57e8b937c4');
 const latestAuditBalance=14_600_000,reserveR10=4_000_000,provisionalMargin=latestAuditBalance-reserveR10;
 let creditRejected=false;
 try{
  const args={database:pool,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,idempotency_key:'mfp-standard-v2-r11',provider_available:true,evaluation_judge_version:2 as const,evaluation_root_ids:baseline.roots.map((r:any)=>r.root_id),full_recalculation:true};
  const receipt=await requestConceptMembershipsV1(args);
  const selected=(await pool.query(`SELECT jsonb_agg(w ORDER BY workspace_id,kind) selectors FROM signal_workspace_labelers w`)).rows[0].selectors;
  assert.deepEqual(selected,baseline.before.selectors);
  const ledger=async()=> (await pool.query(`SELECT coalesce(sum(settled_micro_usd),0)::bigint::text settled_micro_usd,
   coalesce(sum(reserved_micro_usd) FILTER(WHERE status IN('reserved','submitting','submitted','unknown')),0)::bigint::text held_micro_usd,
   count(*)::int calls,count(*) FILTER(WHERE status='unknown')::int unknown,
   count(*) FILTER(WHERE status='settled')::int settled FROM signal_labeling_calls WHERE run_id=$1`,[receipt.run_id])).rows[0];
  const transport=createAnthropicMessageBatchesClient({apiKey:process.env.ANTHROPIC_API_KEY??''});
  const provider={...transport,create:async(requests:Parameters<typeof transport.create>[0])=>{
   const own=await ledger();
   const exposure=Number(own.settled_micro_usd)+Number(own.held_micro_usd);
   if(creditRejected||exposure>provisionalMargin)throw new AnthropicBatchTransportError('mfp_standard_v2_credit_guard','not_submitted');
   console.log(JSON.stringify({stage:'standard_v2_batch_preflight',requests:requests.length,own_exposure_micro_usd:exposure,provisional_margin_micro_usd:provisionalMargin,estimated_balance_not_current:true,reserve_r10_micro_usd:reserveR10}));
   try{return await transport.create(requests);}catch(error){if(error instanceof AnthropicBatchTransportError){const raw=anthropicBatchErrorReceipt(error)?.raw_body??'';if(/credit[_ ]balance|insufficient[_ ]credit/i.test(raw))creditRejected=true;}throw error;}
  },results:async function*(batch:Parameters<typeof transport.results>[0]){
   for await(const item of transport.results(batch)){if(/credit[_ ]balance|insufficient[_ ]credit/i.test(item.rawText))creditRejected=true;yield item;}
  }};
  const started=(await pool.query('SELECT created_at::text FROM signal_labeling_runs WHERE id=$1',[receipt.run_id])).rows[0].created_at;
  await writeFile(`${directory}/run-manifest.json`,JSON.stringify({...receipt,baseline_run_id:baseline.run.id,baseline_labeler_digest:baseline.run.labeler_digest,started_at:started,
   latest_audited_balance_micro_usd:latestAuditBalance,reserve_r10_micro_usd:reserveR10,balance_status:'last_audited_estimate_external_consumption_unknown',cap_micro_usd:null,definitions_sha256:installation.input_sha256},null,2)+'\n',{mode:0o600});
  await configureStandardV2Calendar(pool,identity.workspace_id,receipt.run_id);
  console.log(JSON.stringify({stage:'standard_v2_requested',...receipt,reserve_r10_micro_usd:reserveR10}));
  for(;;){
   const row=(await pool.query('SELECT status,error_code FROM signal_labeling_runs WHERE id=$1',[receipt.run_id])).rows[0];
   const cost=await ledger();console.log(JSON.stringify({stage:'standard_v2_progress',...row,...cost}));
   if(row.status==='completed')break;
   if(row.status==='failed'||cost.unknown||creditRejected||Number(cost.settled_micro_usd)>provisionalMargin)throw new Error('mfp_standard_v2_stopped');
   await runConceptMembershipTickV1({run_id:receipt.run_id,store:createConceptMembershipRuntimeStoreV1(pool),provider});
   if(creditRejected)throw new Error('mfp_standard_v2_credit_insufficient');
   await delay(30000);
  }
  assert.deepEqual((await pool.query(`SELECT jsonb_agg(w ORDER BY workspace_id,kind) selectors FROM signal_workspace_labelers w`)).rows[0].selectors,baseline.before.selectors);
  await configureStandardV2Calendar(pool,identity.workspace_id,receipt.run_id,true);
  console.log(JSON.stringify({stage:'standard_v2_completed',...await ledger(),default_unchanged:true}));
 }finally{await pool.end();}
});
