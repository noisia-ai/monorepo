/** Paid, guarded private driver. Run each arm once; re-entry reuses its run and call keys. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {requestConceptMembershipsV1} from '../../infrastructure/db/signal-concept-memberships';
import {createConceptMembershipRuntimeStoreV1,runConceptMembershipTickV1} from '../../services/workers/src/workers/signal-concept-membership-batch';
import {createAnthropicMessageBatchesClient,AnthropicBatchTransportError,anthropicBatchErrorReceipt} from '../../services/workers/src/providers/anthropic-message-batches';
import {currentStageBalanceV3} from './standard-v3-balance';
const directory='.data/dev-corpus/voyage-real/standard-v3-r12';
void main(async()=>{
 const effort=process.argv.find(a=>a.startsWith('--effort='))?.slice(9);
 if(!process.argv.includes('--real')||(effort!=='low'&&effort!=='medium')||process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED!=='true')throw new Error('mfp_v3_provider_arguments_invalid');
 const balancePath=process.argv.find(a=>a.startsWith('--balance-receipt='))?.slice(18);if(!balancePath)throw new Error('mfp_v3_current_balance_required');
 const balance=JSON.parse(await readFile(balancePath,'utf8'));
 const reserve=balance.reserved_for_other_lanes_micro_usd??0;
 const acceptance=JSON.parse(await readFile(`${directory}/acceptance.json`,'utf8')),installed=JSON.parse(await readFile(`${directory}/v5-data-installed.json`,'utf8'));
 assert.equal(acceptance.passed,true);assert.equal(acceptance.definitions_sha256,installed.input_sha256);
 const available=currentStageBalanceV3(balance,acceptance.estimates[effort]);
 const baseline=JSON.parse(await readFile('.data/dev-corpus/voyage-real/standard-v2-r11/baseline.json','utf8'));
 assert.equal(baseline.root_input_sha256,acceptance.root_input_sha256);
 const identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 let creditRejected=false;
 try{
  const receipt=await requestConceptMembershipsV1({database:pool,workspace_id:identity.workspace_id,actor_user_id:identity.internal_user_id,idempotency_key:`mfp-standard-v3-r12-${effort}`,provider_available:true,evaluation_judge_version:3,evaluation_effort:effort,evaluation_root_ids:baseline.roots.map((r:any)=>r.root_id)});
  const ledger=async()=>(await pool.query(`SELECT coalesce(sum(settled_micro_usd),0)::bigint::text settled_micro_usd,
   coalesce(sum(reserved_micro_usd) FILTER(WHERE status IN('reserved','submitting','submitted','unknown')),0)::bigint::text held_micro_usd,
   count(*)::int calls,count(*) FILTER(WHERE status='unknown')::int unknown FROM signal_labeling_calls WHERE run_id=$1`,[receipt.run_id])).rows[0];
  const transport=createAnthropicMessageBatchesClient({apiKey:process.env.ANTHROPIC_API_KEY??''});
  const provider={...transport,create:async(requests:Parameters<typeof transport.create>[0])=>{
   const cost=await ledger();if(creditRejected||Number(cost.settled_micro_usd)+Number(cost.held_micro_usd)>available)throw new AnthropicBatchTransportError('mfp_v3_credit_guard','not_submitted');
   try{return await transport.create(requests);}catch(error){if(error instanceof AnthropicBatchTransportError&&/credit[_ ]balance|insufficient[_ ]credit/i.test(anthropicBatchErrorReceipt(error)?.raw_body??''))creditRejected=true;throw error;}
  },results:async function*(batch:Parameters<typeof transport.results>[0]){for await(const item of transport.results(batch)){if(/credit[_ ]balance|insufficient[_ ]credit/i.test(item.rawText))creditRejected=true;yield item;}}};
  const manifest={...receipt,effort,root_input_sha256:baseline.root_input_sha256,definitions_sha256:installed.input_sha256,balance_observed_at:balance.observed_at,balance_available_micro_usd:balance.available_micro_usd,reserved_for_other_lanes_micro_usd:reserve,budget_kind:'orientative',default_changed:false};
  await writeFile(`${directory}/run-${effort}.json`,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  for(;;){
   const run=(await pool.query('SELECT status,error_code FROM signal_labeling_runs WHERE id=$1',[receipt.run_id])).rows[0],cost=await ledger();
   console.log(JSON.stringify({stage:'standard_v3_progress',effort,...run,...cost}));
   if(run.status==='completed')break;
   if(run.status==='failed'||cost.unknown||creditRejected)throw new Error('mfp_v3_stopped_reconcile_same_run');
   await runConceptMembershipTickV1({run_id:receipt.run_id,store:createConceptMembershipRuntimeStoreV1(pool),provider});
   if(creditRejected)throw new Error('mfp_v3_credit_insufficient');await delay(30000);
  }
  assert.deepEqual((await pool.query('SELECT coalesce(jsonb_agg(w ORDER BY kind),\'[]\') selectors FROM signal_workspace_labelers w WHERE workspace_id=$1',[identity.workspace_id])).rows[0].selectors,acceptance.before.selectors);
  assert.equal((await pool.query('SELECT count(*)::int n FROM signal_concept_memberships WHERE run_id=$1',[receipt.run_id])).rows[0].n,0);
  console.log(JSON.stringify({stage:'standard_v3_completed',effort,...await ledger(),default_unchanged:true}));
 }finally{await pool.end();}
});
