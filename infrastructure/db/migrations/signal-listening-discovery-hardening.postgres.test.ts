import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assertDiscoveryRuntimeLeaseV1} from './signal-listening-discovery-runtime.assertions';
import {getSignalListeningDiscoveryPublicationRecoveryV1} from '../signal-listening-discovery-runtime';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1} from '@noisia/query-engine';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {proposeSignalListeningDiscoveryBootstrapV1,bootstrapSignalListeningDiscoveryV1,refreshSignalListeningDiscoveryV1,
 snapshotSignalListeningDiscoveryOrphansV1,readSignalListeningDiscoveryOrphanSubsetV1,readSignalListeningDiscoveryRootsV1,
 seedSignalListeningDiscoveryV1,readSignalListeningDiscoveryTopicsV1,setSignalListeningDiscoveryManualV1,signalListeningDiscoveryAliasV1} from '../signal-listening-discovery';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import {prepareWorkspaceCorpusTextChunksV1,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile} from '@noisia/query-engine';
import {quoteSignalWorkspaceEmbeddingsStoreV1,requestSignalWorkspaceEmbeddingsStoreV1} from '../signal-workspace-embeddings-management';
import {claimSignalWorkspaceEmbeddingRunV1,readSignalWorkspaceEmbeddingBatchV1,reserveSignalWorkspaceEmbeddingCallV1} from '../signal-workspace-embeddings';
const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
import {quoteSignalListeningDiscoveryRoundV1,startSignalListeningDiscoveryExecutionV1,enqueueSignalListeningDiscoveryRoundV1,claimSignalListeningDiscoveryRoundV1,reserveSignalListeningDiscoveryCallV1,markSignalListeningDiscoveryCallSentV1,persistSignalListeningDiscoveryRawV1,loadSignalListeningDiscoveryRawIntentV1,pendingSignalListeningDiscoveryRoundsV1,settleSignalListeningDiscoveryCallV1,applySignalListeningDiscoveryReviewV1,prepareSignalListeningDiscoveryChildV1,completeSignalListeningDiscoveryRoundV1,activateSignalListeningServingSnapshotV1,getSignalListeningServingSnapshotV1} from '../signal-listening-discovery-money';
const enabled=process.env.NOISIA_R16_DISCOVERY_HARDENING_PG==='true';
for(const mode of ['incomplete','utf8','nul','overcap','revoked','concurrent_revoked','concurrent_human','write_rollback','child_policy_race','child_failed','child_unknown','child_recovery'] as string[])test('discovery hardening '+mode,{skip:!enabled,timeout:600000},async()=>{await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
  const db=ctx.database,access={database:db,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  for(const table of ['signal_listening_discovery_generations','signal_listening_discovery_topics','signal_listening_discovery_roots','signal_listening_discovery_members','signal_listening_discovery_subsets','signal_listening_discovery_subset_roots','signal_listening_discovery_manual'])
   assert.ok((await db.query('SELECT to_regclass($1) table',[table])).rows[0].table,table+' must exist on migrated PostgreSQL');
  await db.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const embeddingCallsBefore=(await db.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n;
  const original=(await db.query('SELECT to_jsonb(m) map,(SELECT jsonb_agg(to_jsonb(t) ORDER BY topic_key) FROM signal_mass_labeling_topics t WHERE t.map_id=m.id) topics FROM signal_mass_labeling_maps m WHERE m.id=$1',[ctx.map_id])).rows[0];
  const alias=signalListeningDiscoveryAliasV1(ctx.map_id,'long_external_key_'+ 'x'.repeat(95));assert.match(alias,/^mfp_[a-f0-9]{60}$/);assert.equal(alias.length,64);
  assert.equal(alias,signalListeningDiscoveryAliasV1(ctx.map_id,'long_external_key_'+ 'x'.repeat(95)));
  assert.notEqual(signalListeningDiscoveryAliasV1(ctx.map_id,'voice'),'voice');
  const base=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
  const proposed=await proposeSignalListeningDiscoveryBootstrapV1({...access,configuration_id:base.id,map_id:ctx.map_id});
  let cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:base.revision,provenance:'agent',source_digest:proposed.source_digest,configuration:proposed.configuration});
  const initial=await bootstrapSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,bindings:proposed.bindings});
  assert.equal(initial.kind,'legacy_seed');assert.equal(initial.counts.roots,3);assert.equal(initial.counts.cached_vectors,3);
  assert.equal((await db.query("SELECT count(*)::int n FROM signal_listening_discovery_topics WHERE generation_id=$1 AND kind='legacy_seed' AND source_map_id=$2",[initial.id,ctx.map_id])).rows[0].n,proposed.bindings.length);
  await assert.rejects(readSignalListeningDiscoveryRootsV1({...access,workspace_id:randomUUID(),generation_id:initial.id}),/forbidden|unavailable/);
  const files=await mkdtemp(join(tmpdir(),'r16-discovery-'));
  try{
   const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
    store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{
     const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
     const actual=await readFile(path,'utf8');assert.equal(sha(actual),a.raw_sha256);assert.equal(Buffer.byteLength(actual),a.size_bytes);
     return {storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};
    },load:async(a:{sha256:string})=>readFile(join(files,a.sha256.slice(7)),'utf8')};
   const store=createSignalListeningStoreV1({database:db,rawPages,page_size:200,storeRaw:async()=>{throw Error('individual raw forbidden');}});
   const started=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   const run=await store.claim(started.run_id);assert.ok(run);const inputs=await store.inputs(run);assert.equal(inputs.length,3);
   const rows=inputs.map(i=>{const request=buildSignalListeningJevRequestV1(i,cfg.configuration),requestDigest=signalListeningRequestDigestV1(run,i,request);
    return {custom_id:'listening_'+requestDigest.slice(7,67),request_digest:requestDigest,request:request as unknown as Record<string,unknown>,inputs:[i],reserved_micro_usd:1000};});
   const calls=await store.reserve(run,rows);await store.markSubmitting(run,calls);
   const outcomes=calls.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,cfg.configuration),orphan=mode==='zero'||input.root_id===inputs[2]!.root_id;
    const response={model:cfg.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:key==='promotion'?.1:orphan?.1:.9}:
     {type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
    return {call,raw:JSON.stringify({body:JSON.stringify(response),http_status:200,latency_ms:100}),result:mapSignalListeningJevResponseV1(input,run.context,cfg.configuration,response)};});
   await store.persistRawPage(run,outcomes);await store.settlePage(run,outcomes.map(o=>({call:o.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6})));
   await store.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]})));assert.equal(await store.finish(run),'completed');await store.release(run);
   const confirmed=await refreshSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,round:1,source_generation_id:initial.id});
   assert.equal(confirmed.kind,'confirmed_members');assert.equal(confirmed.counts.category_roots,3);assert.equal(confirmed.counts.pending_base,0);assert.equal(confirmed.counts.pending_topics,0);
   // Synthetic policy successor is explicit. The migration enables no provider.
   const oldPolicy=(await db.query("SELECT p.* FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'",[ctx.workspace_id])).rows[0];
   const reviewQuote=await quoteSignalListeningDiscoveryRoundV1({...access,generation_id:confirmed.id,ordinal:1,orphan_groups:[]});
   const existingExposure=Number((await db.query('SELECT total_micro_usd::text FROM signal_processing_org_exposure_v1($1,current_date,$2)',[oldPolicy.organization_id,oldPolicy.budget_timezone])).rows[0].total_micro_usd);
   const policy=(await db.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
    SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,COALESCE($2::bigint,daily_cap_micro_usd),created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING *`,[oldPolicy.id,mode==='race'?existingExposure+reviewQuote.reservation_micro_usd:null])).rows[0];
   await db.query(`INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1`,[oldPolicy.id,policy.id]);
   await db.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $1,'listening_discovery_review','provider','anthropic','claude-sonnet-4-6',configuration,signal_labeling_digest_v1(configuration),10000000,false FROM(SELECT signal_listening_discovery_review_configuration_v1() configuration)x`,[policy.id]);
   await db.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed) SELECT $1,'corpus_embeddings','provider','voyage','voyage-4-large',$2::jsonb,signal_labeling_digest_v1($2::jsonb),1000000,false WHERE NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='corpus_embeddings')`,[policy.id,JSON.stringify(profile)]);
   await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[oldPolicy.id]);await db.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policy.id]);
   await assert.rejects(startSignalListeningDiscoveryExecutionV1({...access,generation_id:confirmed.id,classification_run_id:started.run_id,cap_micro_usd:10000001,idempotency_key:randomUUID()}),/policy_cap_exceeded/);
   const execution=await startSignalListeningDiscoveryExecutionV1({...access,generation_id:confirmed.id,classification_run_id:started.run_id,cap_micro_usd:mode==='overcap'?reviewQuote.reservation_micro_usd+19:4000000,idempotency_key:randomUUID()});
   assert.equal(Number((await db.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[execution.id])).rows[0].n),18,'parent counts the already-paid JEV run');
   const round=await enqueueSignalListeningDiscoveryRoundV1({...access,execution_id:execution.id,generation_id:confirmed.id,orphan_groups:[],provider_available:true});
   const lease=await claimSignalListeningDiscoveryRoundV1({database:db,round_id:round.id});assert.ok(lease);
   const review=await reserveSignalListeningDiscoveryCallV1({database:db,lease,provider_available:true});assert.equal(await markSignalListeningDiscoveryCallSentV1({database:db,lease,call_id:review.id,attempt_token:review.attempt_token,provider_available:true}),true);
   const themes=[{key:'everyday',name:'Everyday',original_language:'en',original_name:'Everyday',en_name:'Everyday',es_name:'Cotidiano'}];
   const output={contract_version:'listening-discovery-editorial-output-v1',retained_topic_keys:[],themes,topics:cfg.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>{
    assert.equal(q.type,'noul');if(q.type!=='noul')throw Error('fixture');return{key:q.key,source_topic_keys:[q.key],orphan_group_keys:[],question:q.text,positive:mode.startsWith('child_')?q.positive+' More precise distinction.':q.positive,negative:q.negative,domain:'category',theme_key:'everyday',
     original_language:'en',original:{name:q.key,definition:q.positive},en:{name:q.key,definition:q.positive},es:{name:q.key,definition:q.positive}};})};
   const providerBody=JSON.stringify({model:'claude-sonnet-4-6',usage:{input_tokens:mode==='overcap'?400000:100,output_tokens:mode==='overcap'?64000:20},stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}]});
   const reviewRaw=JSON.stringify({body:providerBody,http_status:200,provider_request_id:'synthetic-request'});
   const reviewStorage={reference:(a:{workspace_id:string;round_id:string;name:string})=>({storage_key:`workspace-engine/${a.workspace_id}/${a.round_id}/${a.name}`}),store:async(a:{workspace_id:string;round_id:string;call_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{
    const path=join(files,'review-'+a.raw_sha256.slice(7));await writeFile(path,a.raw_text);const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
    assert.equal(await readFile(path,'utf8'),a.raw_text);return{storage_key:`workspace-engine/${a.workspace_id}/${a.round_id}/${a.name}`,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};
   },load:async(a:{storage_key:string})=>{const name=a.storage_key.split('/').at(-1)!.slice(0,-5);return readFile(join(files,name),'utf8');}};
   const before=async()=> (await db.query(`SELECT(SELECT count(*) FROM signal_listening_configurations WHERE workspace_id=$1)::int configurations,(SELECT count(*) FROM signal_listening_discovery_generations WHERE workspace_id=$1)::int generations,(SELECT count(*) FROM signal_listening_answers WHERE workspace_id=$1)::int labels`,[ctx.workspace_id])).rows[0];
   if(mode==='incomplete'){
    for(const bytes of [Buffer.from('café 😀'),Buffer.from([0,65,0,0xc3,0xa9]),Buffer.from([0xef,0xbb,0xbf,65]),Buffer.from([0xc3]),Buffer.alloc(0),Buffer.alloc(1_047_552)]){
     let body='',utf8_valid=true;try{body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{utf8_valid=false;}
     const value={contract_version:'listening-discovery-transport-v1',body,body_base64:bytes.toString('base64'),body_bytes:bytes.length,utf8_valid,complete:false,http_status:200,provider_request_id:null};
     const raw=JSON.stringify(value);assert.ok(Buffer.byteLength(raw)<8*1024*1024);const proof=(await db.query('SELECT signal_listening_discovery_transport_v1($1) value',[raw])).rows[0].value;assert.equal(proof.utf8_valid,utf8_valid);assert.equal(proof.complete,false);
     await assert.rejects(db.query('SELECT signal_listening_discovery_transport_v1($1)',[JSON.stringify({...value,body_bytes:bytes.length+1})]),/transport_invalid/);
     await assert.rejects(db.query('SELECT signal_listening_discovery_transport_v1($1)',[JSON.stringify({...value,body_base64:value.body_base64+'\n'})]),/transport_invalid/);
     if(bytes.length<100)await assert.rejects(db.query('SELECT signal_listening_discovery_transport_v1($1)',[JSON.stringify({...value,body:'incorrect'})]),/transport_invalid/);
    }
   }
   if(mode==='incomplete'||mode==='utf8'||mode==='nul'){
    const bytes=mode==='utf8'?Buffer.concat([Buffer.from(providerBody),Buffer.from([255])]):mode==='nul'?Buffer.concat([Buffer.from(providerBody),Buffer.from([0])]):Buffer.from(providerBody);
    const wrapper=JSON.stringify({contract_version:'listening-discovery-transport-v1',body:mode==='utf8'?'':bytes.toString('utf8'),body_base64:bytes.toString('base64'),body_bytes:bytes.length,utf8_valid:mode!=='utf8',complete:mode==='utf8',http_status:200,provider_request_id:'synthetic-hardening'});
    await persistSignalListeningDiscoveryRawV1({database:db,call_id:review.id,attempt_token:review.attempt_token,raw_text:wrapper,raw_store:reviewStorage});
    assert.equal((await db.query('SELECT verification_status FROM signal_listening_discovery_raw_receipts WHERE call_id=$1',[review.id])).rows[0].verification_status,'verified');
    assert.equal((await db.query('SELECT call_state FROM engine_cost_events WHERE id=$1',[review.id])).rows[0].call_state,'outcome_unknown','partial or non-UTF8 bytes are durable unknown exposure');
    assert.equal((await settleSignalListeningDiscoveryCallV1({database:db,call_id:review.id,attempt_token:review.attempt_token})).unresolved,true);
    await assert.rejects(db.query("UPDATE engine_cost_events SET call_state='response_persisted',metadata=metadata||'{\"response_complete\":true}'::jsonb WHERE id=$1",[review.id]),/transport|incomplete/);
    assert.equal((await db.query('SELECT settled_micro_usd FROM engine_cost_events WHERE id=$1',[review.id])).rows[0].settled_micro_usd,null);return;
   }
   await persistSignalListeningDiscoveryRawV1({database:db,call_id:review.id,attempt_token:review.attempt_token,raw_text:reviewRaw,raw_store:reviewStorage});
   const paid=await settleSignalListeningDiscoveryCallV1({database:db,call_id:review.id,attempt_token:review.attempt_token});assert.ok(paid.cost_micro_usd!>0);
   if(mode==='concurrent_revoked'||mode==='concurrent_human'){
    const census=await before();let fired=false;
    const database={query:db.query.bind(db),connect:async()=>{const c=await db.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{
     if(!fired&&sql.includes("pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'")){fired=true;
      if(mode==='concurrent_revoked')await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[policy.id]);
      else await saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,provenance:'human',configuration:{...cfg.configuration,instructions:cfg.configuration.instructions+' Human revision wins.'}});
     }
     return(target.query as(...a:unknown[])=>Promise<unknown>)(sql,...values);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof db;
    if(mode==='concurrent_revoked')await assert.rejects(applySignalListeningDiscoveryReviewV1({...access,database,round_id:round.id}),/policy/);
    else assert.equal((await applySignalListeningDiscoveryReviewV1({...access,database,round_id:round.id})).status,'stale');
    assert.equal(fired,true);assert.deepEqual(await before(),{...census,configurations:census.configurations+(mode==='concurrent_human'?1:0)},'a committed revocation or human CAS precedes every agent write');return;
   }
   if(mode==='write_rollback'){
    const census=await before();let fired=false;const database={query:db.query.bind(db),connect:async()=>{const c=await db.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{const value=await(target.query as(...a:unknown[])=>Promise<unknown>)(sql,...values);if(!fired&&sql.includes('INSERT INTO signal_listening_discovery_generations(')){fired=true;throw Error('synthetic seed write rollback');}return value;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof db;
    await assert.rejects(applySignalListeningDiscoveryReviewV1({...access,database,round_id:round.id}),/seed write rollback/);assert.equal(fired,true);assert.deepEqual(await before(),census,'configuration and generation share one physical commit');return;
   }
   if(mode==='overcap'||mode==='revoked'){
    if(mode==='revoked')await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[policy.id]);
    const census=await before();await assert.rejects(applySignalListeningDiscoveryReviewV1({...access,round_id:round.id}),/cap|policy|active/);assert.deepEqual(await before(),census,'denial must precede all config/seed/label writes');
    assert.equal((await db.query('SELECT settled_micro_usd::text FROM engine_cost_events WHERE id=$1',[review.id])).rows[0].settled_micro_usd,String(paid.cost_micro_usd));return;
   }
   const applied=await applySignalListeningDiscoveryReviewV1({...access,round_id:round.id});assert.equal(applied.status,'classifying');
   if(mode==='child_policy_race'){
    let preflight=false,changed=false;const database={query:db.query.bind(db),connect:async()=>{const c=await db.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{
     const value=await(target.query as(...a:unknown[])=>Promise<unknown>)(sql,...values);
     if(sql.startsWith('SELECT max_execution_micro_usd::text FROM signal_processing_policy_actions'))preflight=true;
     if(sql==='COMMIT'&&preflight&&!changed){changed=true;const d=await db.connect();try{await d.query('BEGIN');
      const next=(await d.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id) SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING id`,[policy.id])).rows[0].id;
      await d.query('INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1',[policy.id,next]);
      await d.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[policy.id]);await d.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[next]);await d.query('COMMIT');
     }catch(e){await d.query('ROLLBACK');throw e;}finally{d.release();}}
     return value;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof db;
    await assert.rejects(prepareSignalListeningDiscoveryChildV1({...access,database,round_id:round.id,provider_available:true}),/child_authority_changed/);assert.equal(changed,true);
    assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_preparations WHERE idempotency_key=$1',['listening-discovery-child:'+round.id])).rows[0].n,0,'a policy replacement in the await gap creates no child');return;
   }
   await assert.rejects(prepareSignalListeningDiscoveryChildV1({...access,round_id:round.id,provider_available:false}),/provider_unavailable/);assert.equal((await db.query("SELECT count(*)::int n FROM signal_listening_preparations WHERE idempotency_key=$1",['listening-discovery-child:'+round.id])).rows[0].n,0);
   const prep=await prepareSignalListeningDiscoveryChildV1({...access,round_id:round.id,provider_available:true});assert.ok(prep.listening_run_id);assert.equal((await db.query('SELECT classification_preparation_id FROM signal_listening_discovery_rounds WHERE id=$1',[round.id])).rows[0].classification_preparation_id,prep.id);
   const child=await store.claim(prep.listening_run_id!);assert.ok(child);const pending=await store.inputs(child);assert.equal(pending.length,3);
   const current=(await db.query('SELECT configuration FROM signal_listening_configurations WHERE id=$1',[applied.configuration_id])).rows[0].configuration;
   const nextProposals=pending.map(i=>{const request=buildSignalListeningJevRequestV1(i,current),request_digest=signalListeningRequestDigestV1(child,i,request);return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[i],reserved_micro_usd:1000};});
   if(mode==='child_failed'){
    await db.query("UPDATE signal_labeling_runs SET status='failed',error_code='synthetic_technical_failure',lease_token=NULL,lease_until=NULL WHERE id=$1",[child.id]);
    const observed=await prepareSignalListeningDiscoveryChildV1({...access,round_id:round.id,provider_available:true});assert.equal(observed.status,'failed');
    const state=(await db.query('SELECT r.status round_status,p.status parent_status FROM signal_listening_discovery_rounds r JOIN signal_listening_discovery_executions p ON p.id=r.execution_id WHERE r.id=$1',[round.id])).rows[0];assert.equal(state.round_status,'failed');assert.equal(state.parent_status,'failed');return;
   }
   const nextCalls=await store.reserve(child,nextProposals);await store.markSubmitting(child,nextCalls);
   const childOutcomes=nextCalls.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,current),response={model:current.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:.9}:{type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};return{call,raw:JSON.stringify({body:JSON.stringify(response),http_status:200,latency_ms:100}),result:mapSignalListeningJevResponseV1(input,child.context,current,response)};});
   if(mode==='child_recovery')await store.persistRawPage(child,childOutcomes);
   if(mode==='child_unknown'||mode==='child_recovery')await db.query("UPDATE signal_labeling_calls SET status='unknown' WHERE run_id=$1",[child.id]);
   await db.query("UPDATE signal_labeling_runs SET status='failed',error_code=$2,lease_token=NULL,lease_until=NULL WHERE id=$1",[child.id,'labeling_outcome_unknown']);
   const observed=await prepareSignalListeningDiscoveryChildV1({...access,round_id:round.id,provider_available:true});assert.equal(observed.status,'failed');
   const state=(await db.query('SELECT r.status round_status,p.status parent_status FROM signal_listening_discovery_rounds r JOIN signal_listening_discovery_executions p ON p.id=r.execution_id WHERE r.id=$1',[round.id])).rows[0];
   assert.equal(state.round_status,mode==='child_failed'?'failed':'outcome_unknown');assert.equal(state.parent_status,state.round_status);assert.equal((await db.query('SELECT signal_listening_discovery_child_recovery_eligible_v1($1) eligible',[round.id])).rows[0].eligible,mode==='child_recovery');
   if(mode==='child_recovery'){
    const resumed=await store.claim(child.id);assert.ok(resumed);await store.calls(resumed);
    await store.settlePage(resumed,childOutcomes.map(o=>({call:o.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6})));
    await store.apply(resumed,childOutcomes.map(o=>({call:o.call,results:[o.result]})));assert.equal(await store.finish(resumed),'completed');await store.release(resumed);
    const resolved=await prepareSignalListeningDiscoveryChildV1({...access,round_id:round.id,provider_available:true});assert.equal(resolved.status,'completed');
    assert.equal((await db.query('SELECT status FROM signal_listening_discovery_rounds WHERE id=$1',[round.id])).rows[0].status,'classifying');
    assert.equal((await completeSignalListeningDiscoveryRoundV1({...access,round_id:round.id})).status,'completed');
   }
   assert.equal((await db.query('SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id=$1',[round.id])).rows[0].n,1,'child recovery never repeats the paid review');
  }finally{await rm(files,{recursive:true,force:true});}
 }});});
