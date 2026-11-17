import assert from 'node:assert/strict';
import {provisionSyntheticListeningStudyPolicyV1} from './signal-listening-study-policy.synthetic.fixture';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {proposeSignalListeningDiscoveryBootstrapV1,bootstrapSignalListeningDiscoveryV1} from '../signal-listening-discovery';
import {prepareSignalListeningV1,continueSignalListeningPreparationV1} from '../signal-listening-preparation';
import {createBrandContextSyntheticVoyageProviderV1} from './signal-brand-context.synthetic.fixture';
import {signalWorkspaceEmbeddingsJobV1} from '../../../services/workers/src/workers/signal-workspace-embeddings';
import {createSignalListeningStoreV1} from '../signal-listening-runs';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import type {ListeningDiscoveryInitialIntentV1} from '../signal-listening-discovery-initial';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
const sha=(bytes:string|Buffer)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
export async function withInitialDiscoveryFixtureV1(fn:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>,options:{review_enabled?:boolean;prototypes?:boolean;population_count?:number}={}){
 return runMassLabelingAcceptanceFixtureV1('product',{population_count:options.population_count,beforeProcessing:async ctx=>{
  const files=await mkdtemp(join(tmpdir(),'r16-initial-discovery-'));
  try{await fn(await setup(ctx,files,options));}finally{await rm(files,{recursive:true,force:true});}
 }});
}
// A plain scoped native Pool is supplied by the committed-clone fixture.
async function setup(ctx:{database:Parameters<typeof prepareSignalListeningV1>[0]['database'];workspace_id:string;actor_user_id:string;map_id:string;run_id:string},files:string,options:{review_enabled?:boolean;prototypes?:boolean}){
 const db=ctx.database,access={database:db,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
 await db.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
 const template=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
 const base=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...template,questions:[...template.questions,...(options.prototypes?Array.from({length:9},(_,n)=>({key:'defined_'+n,type:'noul' as const,text:'Exact defined question '+n,positive:'Exact bicycle positive '+n,negative:'Other content',scope:'all' as const,origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const})):[])]})});
 const proposal=await proposeSignalListeningDiscoveryBootstrapV1({...access,configuration_id:base.id,map_id:ctx.map_id});
 const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:base.revision,provenance:'agent',source_digest:proposal.source_digest,
  configuration:localizeSyntheticListeningConfigurationV1(proposal.configuration)});
 const seed=await bootstrapSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,bindings:proposal.bindings});
 let policy=(await db.query('SELECT p.* FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status=\'active\'',[ctx.workspace_id])).rows[0];
 if(options.review_enabled!==false){
  const prior=policy;
  policy=(await db.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING *`,[prior.id])).rows[0];
  await db.query("INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,CASE WHEN action='mass_labeling_jev' THEN 10000000 ELSE max_execution_micro_usd END,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1",[prior.id,policy.id]);
  await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[prior.id]);await db.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policy.id]);
  policy=await provisionSyntheticListeningStudyPolicyV1(access,{prototype_cap_micro_usd:options.prototypes?100000:null});
 }
 async function request(options:Partial<Parameters<typeof prepareSignalListeningV1>[0]>={}){
  const result=await prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:4000000,provider_available:true,origin:'initial',auto_discovery:true,prototype_provider_available:true,...options});
  const intent=(await db.query<ListeningDiscoveryInitialIntentV1>('SELECT * FROM signal_listening_discovery_initial_intents WHERE preparation_id=$1',[result.preparation_id])).rows[0]??null;
  return{result,intent};
 }
 const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
  async store(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number}){
   const file=join(files,a.raw_sha256.slice(7));await writeFile(file,a.raw_text);const handle=await open(file,'r+');try{await handle.sync();}finally{await handle.close();}assert.equal(sha(await readFile(file)),a.raw_sha256);
   return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};},
  load:async(a:{sha256:string})=>readFile(join(files,a.sha256.slice(7)),'utf8')};
 const labeling=createSignalListeningStoreV1({database:db,rawPages,storeRaw:async()=>{throw Error('no individual or real provider calls');}});
 async function classify(run_id:string,configuration:SignalListeningConfigurationV1=cfg.configuration){
  const run=await labeling.claim(run_id);assert.ok(run,'the admitted initial run is claimable');
  try{
  const pending=await labeling.calls(run);
  for(const call of pending){
   if(!call.raw_body)throw Error('unknown_without_receipt_is_not_a_retry');
   const response=JSON.parse(JSON.parse(call.raw_body).body),result=mapSignalListeningJevResponseV1(call.inputs[0]!,run.context,configuration,response);
   if(call.status!=='settled')await labeling.settlePage(run,[{call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6}]);
   await labeling.apply(run,[{call,results:[result]}]);
  }
  if(pending.length){
   // Production drains a recovery-only window through finish, then refreshes
   // its stop reason before another invocation can admit fresh requests.
   const status=await labeling.finish(run),refreshed=await labeling.refresh(run);
   run.error_code=refreshed.error_code;
   assert.equal(refreshed.status,status);assert.ok(status==='running'||status==='completed');
   assert.equal(run.error_code,null,'only fully resolved recovery may admit new inputs');
  }
  for(;;){const inputs=await labeling.inputs(run);if(!inputs.length)break;
   const calls=await labeling.reserve(run,inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
    return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[input],reserved_micro_usd:6};}));await labeling.markSubmitting(run,calls);
   const pages=calls.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,configuration);
    const response={model:configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:key==='promotion'?.1:.9}:{type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
    return{call,raw:JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),result:mapSignalListeningJevResponseV1(input,run.context,configuration,response)};});
   await labeling.persistRawPage(run,pages);await labeling.settlePage(run,pages.map(p=>({call:p.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6})));await labeling.apply(run,pages.map(p=>({call:p.call,results:[p.result]})));
  }assert.equal(await labeling.finish(run),'completed');
  }finally{await labeling.release(run);}
 }
 async function unknown(run_id:string,durableRaw:boolean){
  const run=await labeling.claim(run_id);assert.ok(run,'initial unknown fault owns the native lease');const input=(await labeling.inputs(run))[0]!;
  const request=buildSignalListeningJevRequestV1(input,cfg.configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
  const calls=await labeling.reserve(run,[{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[input],reserved_micro_usd:6}]);await labeling.markSubmitting(run,calls);
  if(durableRaw){const response={model:cfg.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:key==='promotion'?.1:.9}:{type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
   await labeling.persistRawPage(run,[{call:calls[0]!,raw:JSON.stringify({http_status:200,body:JSON.stringify(response)})}]);
  }
  await labeling.markFailed(run,calls,true);await labeling.fail(run,'labeling_outcome_unknown',{preserve_reserved:true});await labeling.release(run);return calls[0]!;
 }
 async function prototypes(preparation_id:string){
  const flow=(await db.query('SELECT prototype_run_id FROM signal_listening_preparations WHERE id=$1',[preparation_id])).rows[0];assert.ok(flow.prototype_run_id,'normal preparation owns the prototype run');
  const job=(await db.query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1',[flow.prototype_run_id])).rows[0],voyage=createBrandContextSyntheticVoyageProviderV1();
  const result=await signalWorkspaceEmbeddingsJobV1({id:job.worker_job_id,data:{run_id:flow.prototype_run_id},updateProgress:async()=>{}},{database:db,provider:voyage.provider});assert.equal('status'in result&&result.status,'completed');
  return{calls:voyage.calls,result:await continueSignalListeningPreparationV1({...access,preparation_id,provider_available:true})};
 }
 return{...access,files,map_id:ctx.map_id,cfg,seed,bindings:proposal.bindings,policy,request,classify,unknown,prototypes};
}
