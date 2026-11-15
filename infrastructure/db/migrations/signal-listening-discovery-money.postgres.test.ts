import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assertDiscoveryRuntimeLeaseV1} from './signal-listening-discovery-runtime.assertions';
import {getSignalListeningDiscoveryPublicationRecoveryV1,releaseSignalListeningDiscoveryRoundV1} from '../signal-listening-discovery-runtime';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,buildListeningDiscoveryEvidenceV1,listeningDiscoveryPopulationDigestV1,buildListeningDiscoveryEditorialRequestV1,type ListeningDiscoveryRootV1} from '@noisia/query-engine';
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
test('discovery reviews use native admissions, durable receipts and one shared ledger',{skip:process.env.NOISIA_R16_LISTENING_DISCOVERY_MONEY_PG!=='true',timeout:600000},async()=>{
 for(const mode of ['happy','unknown','human','race','zero','publication_stale'] as const)await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
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
   // The eager oracle is restricted to this three-root synthetic fixture.
   // Native reads must retain exact evidence and request bytes after streaming.
   const nativeSource=await readSignalListeningDiscoveryRootsV1({...access,generation_id:confirmed.id,limit:1024});
   const eagerRoots:ListeningDiscoveryRootV1[]=nativeSource.roots.map(r=>({root_id:r.root_id,input_sha256:r.proof.source_text_sha256 as string,
    in_category:r.proof.in_category as boolean,vector:r.vector!,evaluations:(r.proof.evaluations as Array<{question_key:string;probability:number}>)
     .map(e=>({topic_key:e.question_key,probability:e.probability}))}));
   for(const root of nativeSource.roots){
    assert.equal(sha(root.proof_json),root.proof_digest,'native canonical proof bytes retain their sealed hash without JS decimal conversion');
    assert.deepEqual(JSON.parse(root.proof_json),root.proof);
    if(root.vector_json!==null){assert.equal(sha(root.vector_json),root.proof.embedding_sha256);assert.deepEqual(JSON.parse(root.vector_json),root.vector);}
   }
   const eagerEvidence=buildListeningDiscoveryEvidenceV1({workspace_id:ctx.workspace_id,vector_space_digest:confirmed.embedding_config_digest,
    map_digest:cfg.configuration_digest,round:1,expected_root_count:3,expected_population_digest:listeningDiscoveryPopulationDigestV1(eagerRoots),
    roots:eagerRoots,topic_keys:cfg.configuration.questions.filter(q=>q.topic_source).map(q=>q.key)});
   const eagerIds=new Set(eagerEvidence.topics.flatMap(t=>[...t.accepted_examples,...t.rejected_examples]));
   const eagerRequest=buildListeningDiscoveryEditorialRequestV1({configuration:cfg.configuration,evidence:eagerEvidence,orphan_groups:[],
    excerpts:nativeSource.roots.filter(r=>eagerIds.has(r.root_id)).map(r=>({root_id:r.root_id,text:r.text,source_text_sha256:r.proof.source_text_sha256 as string}))});
   const reviewQuote=await quoteSignalListeningDiscoveryRoundV1({...access,generation_id:confirmed.id,ordinal:1,orphan_groups:[]});
   assert.equal(reviewQuote.request_digest,eagerRequest.request_digest,'native streaming quote preserves the eager request identity');
   await assert.rejects(quoteSignalListeningDiscoveryRoundV1({...access,actor_user_id:randomUUID(),generation_id:confirmed.id,ordinal:1,orphan_groups:[]}),/forbidden|unavailable/);
   await assert.rejects(quoteSignalListeningDiscoveryRoundV1({...access,workspace_id:randomUUID(),generation_id:confirmed.id,ordinal:1,orphan_groups:[]}),/forbidden|unavailable/);
   const existingExposure=Number((await db.query('SELECT total_micro_usd::text FROM signal_processing_org_exposure_v1($1,current_date,$2)',[oldPolicy.organization_id,oldPolicy.budget_timezone])).rows[0].total_micro_usd);
   const policy=(await db.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
    SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,COALESCE($2::bigint,daily_cap_micro_usd),created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING *`,[oldPolicy.id,mode==='race'?existingExposure+reviewQuote.reservation_micro_usd:null])).rows[0];
   await db.query(`INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1`,[oldPolicy.id,policy.id]);
   await db.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $1,'listening_discovery_review','provider','anthropic','claude-sonnet-4-6',configuration,signal_labeling_digest_v1(configuration),10000000,false FROM(SELECT signal_listening_discovery_review_configuration_v1() configuration)x`,[policy.id]);
   await db.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed) SELECT $1,'corpus_embeddings','provider','voyage','voyage-4-large',$2::jsonb,signal_labeling_digest_v1($2::jsonb),1000000,false WHERE NOT EXISTS(SELECT 1 FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='corpus_embeddings')`,[policy.id,JSON.stringify(profile)]);
   await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[oldPolicy.id]);await db.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policy.id]);
   await assert.rejects(startSignalListeningDiscoveryExecutionV1({...access,generation_id:confirmed.id,classification_run_id:started.run_id,cap_micro_usd:10000001,idempotency_key:randomUUID()}),/policy_cap_exceeded/);
   const execution=await startSignalListeningDiscoveryExecutionV1({...access,generation_id:confirmed.id,classification_run_id:started.run_id,cap_micro_usd:4000000,idempotency_key:randomUUID()});
   assert.equal(Number((await db.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[execution.id])).rows[0].n),18,'parent counts the already-paid JEV run');
   const round=await enqueueSignalListeningDiscoveryRoundV1({...access,execution_id:execution.id,generation_id:confirmed.id,orphan_groups:[],provider_available:true});
   assert.equal(round.request_body,eagerRequest.request_body,'native streaming enqueue preserves every eager request byte');
   if(mode==='zero'){
    const packet=JSON.parse(JSON.parse(round.request_body).messages[0].content);assert.ok(packet.topics.every((t:{approved:number;centroid_status:string})=>t.approved===0&&t.centroid_status==='no_confirmed_members'),'Sonnet sees the absence of confirmed members before any paid review');
    const changed=await saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,provenance:'agent',source_digest:sha('empty-source-redefinition'),configuration:{...cfg.configuration,questions:cfg.configuration.questions.map((q,i)=>q.type==='noul'&&q.topic_source==='discovered'&&i===2?{...q,positive:q.positive+' Refined contrast.'}:q)}});
    const seeded=await seedSignalListeningDiscoveryV1({...access,configuration_id:changed.id,map_id:ctx.map_id,round:1,source_generation_id:confirmed.id,seeds:changed.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>({question_key:q.key,source_topic_keys:[q.key]}))});
    const topics=await readSignalListeningDiscoveryTopicsV1({...access,generation_id:seeded.id});assert.ok(topics.length>0);assert.ok(topics.every(t=>t.member_count===0&&t.centroid===null&&t.centroid_status==='no_confirmed_members'&&t.lineage.no_confirmed_members===true));
    const candidates=(await db.query("SELECT question_key FROM signal_listening_population_roots_v1($1,$2,$3,$4,ARRAY[$5::uuid],'llm-processing') WHERE candidate AND definition->>'topic_source'='discovered'",[ctx.workspace_id,changed.id,ctx.map_id,seeded.entity_context_digest,inputs[0]!.root_id])).rows;assert.equal(candidates.length,0,'no source vector means no candidate, not a negative answer');
    const current=await refreshSignalListeningDiscoveryV1({...access,configuration_id:changed.id,map_id:ctx.map_id,round:1,source_generation_id:seeded.id});assert.equal(current.counts.pending_topics,0,'unasked inactive topics are not processing failures');
    const noCandidateSource=await readSignalListeningDiscoveryRootsV1({...access,generation_id:current.id,limit:1024});
    assert.ok(noCandidateSource.roots.every(r=>(r.proof.evaluations as unknown[]).length===0),'the confirmed zero-source generation has no invented candidate votes');
    const noCandidateQuote=await quoteSignalListeningDiscoveryRoundV1({...access,generation_id:current.id,ordinal:1,orphan_groups:[]});
    assert.ok(noCandidateQuote.request_digest,'an empty candidate set still permits the next governed review quote');
    const noCandidateRoots:ListeningDiscoveryRootV1[]=noCandidateSource.roots.map(r=>({root_id:r.root_id,input_sha256:r.proof.source_text_sha256 as string,
     in_category:r.proof.in_category as boolean,vector:r.vector!,evaluations:[]}));
    const noCandidateEvidence=buildListeningDiscoveryEvidenceV1({workspace_id:ctx.workspace_id,vector_space_digest:current.embedding_config_digest,
     map_digest:changed.configuration_digest,round:1,expected_root_count:3,expected_population_digest:listeningDiscoveryPopulationDigestV1(noCandidateRoots),
     roots:noCandidateRoots,topic_keys:changed.configuration.questions.filter(q=>q.topic_source).map(q=>q.key)});
    const noCandidateRequest=buildListeningDiscoveryEditorialRequestV1({configuration:changed.configuration,evidence:noCandidateEvidence,orphan_groups:[],excerpts:[]});
    assert.equal(noCandidateQuote.request_digest,noCandidateRequest.request_digest);
    const noCandidatePacket=JSON.parse(JSON.parse(noCandidateRequest.request_body).messages[0].content);
    assert.equal(noCandidatePacket.population.orphan_roots,3);
    assert.ok(noCandidatePacket.topics.every((t:{asked:number;approved:number;acceptance_rate:number|null;accepted:unknown[];rejected:unknown[]})=>
     t.asked===0&&t.approved===0&&t.acceptance_rate===null&&t.accepted.length===0&&t.rejected.length===0));
    assert.equal((await db.query('SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id=$1',[round.id])).rows[0].n,0,'quoting a no-candidate generation does not reserve or send a provider call');
    const subset=await snapshotSignalListeningDiscoveryOrphansV1({...access,generation_id:current.id});assert.equal(subset.root_count,3,'all eligible roots remain in the orphan denominator');
    await assert.rejects(seedSignalListeningDiscoveryV1({...access,configuration_id:changed.id,map_id:ctx.map_id,round:2,source_generation_id:confirmed.id,seeds:changed.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>({question_key:q.key,source_topic_keys:['missing_source']}))}),/members_incomplete/);
    await assert.rejects(seedSignalListeningDiscoveryV1({...access,configuration_id:changed.id,map_id:ctx.map_id,round:2,source_generation_id:randomUUID(),seeds:[]}),/source_invalid/);
    assert.equal((await db.query('SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id=$1',[round.id])).rows[0].n,0);return;
   }
   assert.ok(!(await pendingSignalListeningDiscoveryRoundsV1({database:db})).some(r=>r.round_id===round.id),'disabled by default does not drain new work');
   assert.ok((await pendingSignalListeningDiscoveryRoundsV1({database:db,enabled:true})).some(r=>r.round_id===round.id));
   let lease=await claimSignalListeningDiscoveryRoundV1({database:db,round_id:round.id});assert.ok(lease);assert.equal(lease.recovery_only,false);
   if(mode==='happy')lease=await assertDiscoveryRuntimeLeaseV1(access,lease);
   if(mode==='race'){
    // A genuine pending corpus-embedding owner in another workspace, same org.
    const brand=randomUUID(),prep=randomUUID();await db.query("INSERT INTO brands(id,organization_id,slug,name,status) VALUES($1,$2,$3,'Synthetic money sibling','active')",[brand,policy.organization_id,'money-'+brand]);
    const ws=(await db.query('SELECT id FROM signal_workspaces WHERE brand_id=$1',[brand])).rows[0].id;
    const revision=(await db.query('SELECT input_revision::text FROM signal_corpus_preparation_input_state WHERE workspace_id=$1',[ws])).rows[0].input_revision;
    const text='Synthetic budget-race corpus sibling with an uncached exact text.',asset=sha(text),chunks=prepareWorkspaceCorpusTextChunksV1(text,asset);
    await db.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,status,phase,input_revision,completed_at,worker_job_id) VALUES($1,$2,$3,'completed','complete',$4,clock_timestamp(),$1::uuid::text)`,[prep,ws,ctx.actor_user_id,revision]);
    await db.query(`INSERT INTO signal_corpus_text_assets(workspace_id,text_sha256,chunk_policy_version,full_text,chunks,prepared_at) VALUES($1,$2,'corpus-text-chunks-v1',$3,$4::jsonb,clock_timestamp())`,[ws,asset,text,JSON.stringify(chunks)]);
    await db.query(`INSERT INTO signal_corpus_preparation_items(workspace_id,run_id,root_id,asset_sha256,disposition,root_metadata,provenance,semantic_eligible,fingerprint) VALUES($1,$2,$3,$4,'eligible','{}','[]',true,$4)`,[ws,prep,randomUUID(),asset]);
    const quoted=await quoteSignalWorkspaceEmbeddingsStoreV1({database:db,workspace_id:ws,actor_user_id:ctx.actor_user_id,profile});
    const admitted=await requestSignalWorkspaceEmbeddingsStoreV1({database:db,workspace_id:ws,actor_user_id:ctx.actor_user_id,profile,preparation_run_id:prep,quote_digest:quoted.quote_digest,idempotency_key:randomUUID(),hard_cap_micro_usd:1000,provider_available:true});
    const siblingLease=await claimSignalWorkspaceEmbeddingRunV1({database:db,run_id:admitted.run_id,worker_job_id:(await db.query('SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1',[admitted.run_id])).rows[0].worker_job_id});assert.ok(siblingLease);
    const batch=await readSignalWorkspaceEmbeddingBatchV1({database:db,lease:siblingLease});assert.ok(batch.inputs.length>0);assert.ok(batch.reserved_micro_usd>0);
    const race=await Promise.allSettled([reserveSignalListeningDiscoveryCallV1({database:db,provider_available:true,lease}),reserveSignalWorkspaceEmbeddingCallV1({database:db,lease:siblingLease,batch})]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1,'one of two real independent producer transactions reserves');
    const rejected=race.find(r=>r.status==='rejected');assert.ok(rejected&&rejected.status==='rejected');assert.match(String(rejected.reason),/processing_daily_cap_exhausted/,'the losing native owner fails on the shared daily cap, not scope');
    console.log('# discovery money race: one native review/corpus reservation, one processing_daily_cap_exhausted; two real producer transactions');
    const exposure=Number((await db.query('SELECT total_micro_usd::text FROM signal_processing_org_exposure_v1($1,current_date,$2)',[policy.organization_id,policy.budget_timezone])).rows[0].total_micro_usd);assert.ok(exposure<=Number(policy.daily_cap_micro_usd));
    return;
   }
   const review=await reserveSignalListeningDiscoveryCallV1({database:db,provider_available:true,lease});
   if(mode==='happy'){
    await db.query("UPDATE signal_listening_discovery_rounds SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[round.id]);
    lease=await claimSignalListeningDiscoveryRoundV1({database:db,round_id:round.id});assert.ok(lease);
    assert.equal((await reserveSignalListeningDiscoveryCallV1({database:db,provider_available:true,lease})).id,review.id,'an expired unsent lease recovers its existing reservation');
   }
   await assert.rejects(db.query(`INSERT INTO engine_cost_events SELECT(jsonb_populate_record(NULL::engine_cost_events,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'attempt_token',gen_random_uuid()))).* FROM engine_cost_events c WHERE c.id=$1`,[review.id]),/signal_listening_discovery_one_call|uq_workspace_interpretation_key/,'a second ledger reservation cannot create a second physical call for the round');
   const before=Number((await db.query('SELECT total_micro_usd FROM signal_processing_org_exposure_v1($1,current_date,$2)',[policy.organization_id,policy.budget_timezone])).rows[0].total_micro_usd);
   assert.ok(before>=Number(review.reserved_micro_usd)+18,'global ledger includes review reserve plus JEV');
   await assert.rejects(db.query("UPDATE engine_cost_events SET reserved_micro_usd=1 WHERE id=$1",[review.id]),/binding_invalid|immutable/);
   await db.query('DELETE FROM signal_workspace_features WHERE workspace_id=$1 AND feature=\'mass_labeling\'',[ctx.workspace_id]);
   await assert.rejects(markSignalListeningDiscoveryCallSentV1({database:db,provider_available:true,lease,call_id:review.id,attempt_token:review.attempt_token}),/authority_invalid/);
   await db.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2)",[ctx.workspace_id,ctx.actor_user_id]);
   assert.equal(await markSignalListeningDiscoveryCallSentV1({database:db,provider_available:true,lease,call_id:review.id,attempt_token:review.attempt_token}),true);
   assert.equal(await markSignalListeningDiscoveryCallSentV1({database:db,provider_available:true,lease,call_id:review.id,attempt_token:review.attempt_token}),false,'CAS never grants another physical send');
   const themes=[{key:'everyday',name:'Everyday',original_language:'en',original_name:'Everyday',en_name:'Everyday',es_name:'Cotidiano'}];
   const output={contract_version:'listening-discovery-editorial-output-v1',retained_topic_keys:[],themes,topics:cfg.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>{
    assert.equal(q.type,'noul');if(q.type!=='noul')throw Error('fixture');return{key:q.key,source_topic_keys:[q.key],orphan_group_keys:[],question:q.text,positive:q.positive,negative:q.negative,domain:'category',theme_key:'everyday',
     original_language:'en',original:{name:q.key,definition:q.positive},en:{name:q.key,definition:q.positive},es:{name:q.key,definition:q.positive}};})};
   const providerBody=JSON.stringify({model:'claude-sonnet-4-6',usage:{input_tokens:100,output_tokens:20},stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}]});
   const reviewRaw=JSON.stringify({body:providerBody,http_status:200,provider_request_id:'synthetic-request'});
   const reviewStorage={reference:(a:{workspace_id:string;round_id:string;name:string})=>({storage_key:`workspace-engine/${a.workspace_id}/${a.round_id}/${a.name}`}),store:async(a:{workspace_id:string;round_id:string;call_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{
    const path=join(files,'review-'+a.raw_sha256.slice(7));await writeFile(path,a.raw_text);const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
    assert.equal(await readFile(path,'utf8'),a.raw_text);return{storage_key:`workspace-engine/${a.workspace_id}/${a.round_id}/${a.name}`,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};
   },load:async(a:{storage_key:string})=>{const name=a.storage_key.split('/').at(-1)!.slice(0,-5);return readFile(join(files,name),'utf8');}};
   if(mode==='happy'){
    const faultStore={...reviewStorage,store:async(a:Parameters<typeof reviewStorage.store>[0])=>{await reviewStorage.store(a);throw Error('synthetic storage ACK lost');}};
    await assert.rejects(persistSignalListeningDiscoveryRawV1({database:db,call_id:review.id,attempt_token:review.attempt_token,raw_text:reviewRaw,raw_store:faultStore}),/storage ACK lost/);
    const intent=await loadSignalListeningDiscoveryRawIntentV1({database:db,call_id:review.id,attempt_token:review.attempt_token});assert.ok(intent);assert.equal(intent.raw_text,reviewRaw);assert.equal(intent.verification_status,'planned');
    assert.equal((await settleSignalListeningDiscoveryCallV1({database:db,call_id:review.id,attempt_token:review.attempt_token})).unresolved,true,'planned upload is not a verified billable receipt');
    await db.query("UPDATE signal_listening_discovery_rounds SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[round.id]);
    lease=await claimSignalListeningDiscoveryRoundV1({database:db,round_id:round.id});assert.ok(lease);assert.equal(lease.recovery_only,true,'the known raw intent recovers without another physical request');
    assert.equal(await markSignalListeningDiscoveryCallSentV1({database:db,provider_available:true,lease,call_id:review.id,attempt_token:review.attempt_token}),false);
   }
   await db.query("DELETE FROM signal_workspace_features WHERE workspace_id=$1 AND feature='mass_labeling'",[ctx.workspace_id]);
   await persistSignalListeningDiscoveryRawV1({database:db,call_id:review.id,attempt_token:review.attempt_token,raw_text:reviewRaw,raw_store:reviewStorage});
   assert.equal((await persistSignalListeningDiscoveryRawV1({database:db,call_id:review.id,attempt_token:review.attempt_token,raw_text:reviewRaw,raw_store:reviewStorage})).replayed,true,'lost raw ACK reuses exact bytes');
   if(mode==='happy'){
    assert.equal(await releaseSignalListeningDiscoveryRoundV1({database:db,lease}),true);
    assert.ok((await pendingSignalListeningDiscoveryRoundsV1({database:db,enabled:true,limit:1})).some(r=>r.round_id===round.id),
     'pending raw custody remains schedulable after feature revocation');
   }
   const paid=await settleSignalListeningDiscoveryCallV1({database:db,call_id:review.id,attempt_token:review.attempt_token});assert.equal(paid.cost_micro_usd,600);
   assert.equal((await settleSignalListeningDiscoveryCallV1({database:db,call_id:review.id,attempt_token:review.attempt_token})).replayed,true,'lost settlement ACK never recharges');
   assert.equal(Number((await db.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[execution.id])).rows[0].n),618);
   if(mode==='happy'){
    assert.ok(!(await pendingSignalListeningDiscoveryRoundsV1({database:db,enabled:false})).some(r=>r.round_id===round.id),
     'disabled analysis does not repeatedly poll an already settled review');
    assert.ok(!(await pendingSignalListeningDiscoveryRoundsV1({database:db,enabled:true,limit:1})).some(r=>r.round_id===round.id),
     'a settled review without current authority cannot monopolize the analysis queue');
   }
   await assert.rejects(applySignalListeningDiscoveryReviewV1({...access,round_id:round.id}),/not_enabled/,'revocation after send preserves money but forbids publication');
   await db.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2)",[ctx.workspace_id,ctx.actor_user_id]);
   if(mode==='happy')assert.ok((await pendingSignalListeningDiscoveryRoundsV1({database:db,enabled:true,limit:1})).some(r=>r.round_id===round.id),
    'reactivating the feature restores eligibility without altering its settled receipt');
   assert.equal(await getSignalListeningServingSnapshotV1(access),null,'ready centroid generation is not a serving publication');
   await assert.rejects(activateSignalListeningServingSnapshotV1({...access,round_id:round.id}),/snapshot_invalid|violates/);
   if(mode==='human'){
    const human=await saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,provenance:'human',configuration:{...cfg.configuration,questions:cfg.configuration.questions.map(q=>q.topic_source==='discovered'&&q.type==='noul'?{...q,positive:q.positive+' Human correction.'}:q)}});
    const stale=await applySignalListeningDiscoveryReviewV1({...access,round_id:round.id});assert.equal(stale.status,'stale');
    assert.equal((await db.query("SELECT id FROM signal_listening_configurations WHERE workspace_id=$1 AND state='published' ORDER BY revision DESC LIMIT 1",[ctx.workspace_id])).rows[0].id,human.id);
    assert.equal((await db.query('SELECT settled_micro_usd::text FROM engine_cost_events WHERE id=$1',[review.id])).rows[0].settled_micro_usd,'600','human CAS preserves the provider charge');return;
   }
   const applied=await applySignalListeningDiscoveryReviewV1({...access,round_id:round.id});assert.equal(applied.status,'classifying');
   const child=await prepareSignalListeningDiscoveryChildV1({...access,round_id:round.id,provider_available:true});assert.ok(child.listening_run_id);
   const childRun=await store.claim(child.listening_run_id!);assert.ok(childRun);assert.equal((await store.inputs(childRun)).length,0,'presentation edits preserve semantic JEV cache');
   assert.equal(await store.finish(childRun),'completed');await store.release(childRun);
   const complete=await completeSignalListeningDiscoveryRoundV1({...access,round_id:round.id});assert.equal(complete.status,'completed');
   assert.deepEqual(await getSignalListeningDiscoveryPublicationRecoveryV1({database:db,round_id:round.id}),
    {round_id:round.id,workspace_id:access.workspace_id,actor_user_id:access.actor_user_id});
   assert.ok((await pendingSignalListeningDiscoveryRoundsV1({database:db,enabled:false})).some(r=>r.round_id===round.id),
    'lost completion ACK still schedules publication with provider disabled');
   assert.equal(await claimSignalListeningDiscoveryRoundV1({database:db,round_id:round.id}),null,'publication recovery never reacquires a terminal processing lease');
   if(mode==='publication_stale'){
    const current=(await db.query('SELECT revision,configuration FROM signal_listening_configurations WHERE workspace_id=$1 AND id=$2',
     [access.workspace_id,applied.configuration_id])).rows[0];
    const human=await saveSignalListeningConfigurationV1({...access,expected_revision:current.revision,provenance:'human',configuration:current.configuration});
    assert.equal(await getSignalListeningDiscoveryPublicationRecoveryV1({database:db,round_id:round.id}),null,
     'a human revision makes an unpublished historical completion ineligible');
    // Arrange a retired prior owner without changing its immutable completed
    // round or any paid receipt; the new owner still uses native admission.
    await db.query("UPDATE signal_listening_discovery_executions SET status='stale',error_code='listening_discovery_human_configuration_changed' WHERE id=$1",[execution.id]);
    const seed=await bootstrapSignalListeningDiscoveryV1({...access,configuration_id:human.id,map_id:ctx.map_id,bindings:proposed.bindings});
    const fresh=await requestSignalListeningV1({...access,configuration_id:human.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
    const freshRun=await store.claim(fresh.run_id);assert.ok(freshRun);assert.equal((await store.inputs(freshRun)).length,0);
    assert.equal(await store.finish(freshRun),'completed');await store.release(freshRun);
    const generation=await refreshSignalListeningDiscoveryV1({...access,configuration_id:human.id,map_id:ctx.map_id,round:1,source_generation_id:seed.id});
    const parent=await startSignalListeningDiscoveryExecutionV1({...access,generation_id:generation.id,classification_run_id:fresh.run_id,cap_micro_usd:4000000,idempotency_key:randomUUID()});
    const queued=await enqueueSignalListeningDiscoveryRoundV1({...access,execution_id:parent.id,generation_id:generation.id,orphan_groups:[],provider_available:true});
    assert.deepEqual((await pendingSignalListeningDiscoveryRoundsV1({database:db,enabled:true,limit:1})).map(row=>row.round_id),[queued.id],
     'pagination skips an older immutable stale completion instead of starving the next valid owner');
    assert.equal((await db.query('SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id=$1',[queued.id])).rows[0].n,0);return;
   }
   const snapshot=await activateSignalListeningServingSnapshotV1({...access,round_id:round.id});assert.ok(snapshot.id);
   assert.equal(await getSignalListeningDiscoveryPublicationRecoveryV1({database:db,round_id:round.id}),null);
   const served=await getSignalListeningServingSnapshotV1(access);assert.equal(served?.classification_run_id,child.listening_run_id);assert.equal(served?.configuration_id,applied.configuration_id);
   assert.equal((await db.query("SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id=$1",[round.id])).rows[0].n,1);
   const next=await enqueueSignalListeningDiscoveryRoundV1({...access,execution_id:execution.id,generation_id:complete.output_generation_id!,orphan_groups:[],provider_available:true});
   const secondLease=await claimSignalListeningDiscoveryRoundV1({database:db,round_id:next.id});assert.ok(secondLease);
   const second=await reserveSignalListeningDiscoveryCallV1({database:db,provider_available:true,lease:secondLease});
   assert.equal(await markSignalListeningDiscoveryCallSentV1({database:db,provider_available:true,lease:secondLease,call_id:second.id,attempt_token:second.attempt_token}),true);
   if(mode==='happy'){
    const updated={...output,themes:themes.map(t=>({...t,name:t.name+' Updated',en_name:t.en_name+' Updated'}))};
    const raw=JSON.stringify({body:JSON.stringify({model:'claude-sonnet-4-6',usage:{input_tokens:100,output_tokens:20},stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(updated)}]}),http_status:200});
    await persistSignalListeningDiscoveryRawV1({database:db,call_id:second.id,attempt_token:second.attempt_token,raw_text:raw,raw_store:reviewStorage});
    await settleSignalListeningDiscoveryCallV1({database:db,call_id:second.id,attempt_token:second.attempt_token});
    const revised=await applySignalListeningDiscoveryReviewV1({...access,round_id:next.id});assert.equal(revised.status,'classifying');
    const retained=await getSignalListeningServingSnapshotV1(access);assert.equal(retained?.id,snapshot.id);assert.equal(retained?.configuration_id,applied.configuration_id);assert.equal(retained?.configuration_is_latest,false,'published Brand OS revision never mixes with the prior completed report');
    const child2=await prepareSignalListeningDiscoveryChildV1({...access,round_id:next.id,provider_available:true});assert.ok(child2.listening_run_id);
    const run2=await store.claim(child2.listening_run_id!);assert.ok(run2);assert.equal((await store.inputs(run2)).length,0);assert.equal(await store.finish(run2),'completed');await store.release(run2);
    await completeSignalListeningDiscoveryRoundV1({...access,round_id:next.id});const activated=await activateSignalListeningServingSnapshotV1({...access,round_id:next.id});
    const current=await getSignalListeningServingSnapshotV1(access);assert.equal(current?.id,activated.id);assert.notEqual(current?.id,snapshot.id);assert.equal(current?.configuration_id,revised.configuration_id);assert.equal(current?.classification_run_id,child2.listening_run_id);assert.equal(current?.configuration_is_latest,true);
    await db.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[ctx.workspace_id]);assert.equal(await getSignalListeningServingSnapshotV1(access),null,'source revocation closes serving even for a previously completed version');
    await assert.rejects(quoteSignalListeningDiscoveryRoundV1({...access,generation_id:confirmed.id,ordinal:1,orphan_groups:[]}),/mass_labeling_map_stale/,'a revoked source closes the streaming evidence reader on its exact stale-map guard');return;
   }
   const unknownRaw=JSON.stringify({http_status:429,body:JSON.stringify({error:{type:'rate_limit_error'},usage:{input_tokens:0,output_tokens:0}})});
   await persistSignalListeningDiscoveryRawV1({database:db,call_id:second.id,attempt_token:second.attempt_token,raw_text:unknownRaw,raw_store:reviewStorage});
   assert.equal((await settleSignalListeningDiscoveryCallV1({database:db,call_id:second.id,attempt_token:second.attempt_token})).unresolved,true);
   assert.equal((await db.query('SELECT call_state,settled_micro_usd FROM engine_cost_events WHERE id=$1',[second.id])).rows[0].call_state,'outcome_unknown');
   assert.equal((await db.query('SELECT settled_micro_usd FROM engine_cost_events WHERE id=$1',[second.id])).rows[0].settled_micro_usd,null,'429 with usage zero is not free settlement');
   await assert.rejects(db.query("UPDATE engine_cost_events SET call_state='reserved' WHERE id=$1",[second.id]),/transition_invalid/);
   await assert.rejects(startSignalListeningDiscoveryExecutionV1({...access,generation_id:complete.output_generation_id!,classification_run_id:child.listening_run_id!,cap_micro_usd:4000000,idempotency_key:randomUUID()}),/one_execution|duplicate/,'a new key cannot bypass an unresolved parent');
   assert.equal(Number((await db.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[execution.id])).rows[0].n),618+Number(second.reserved_micro_usd),'unknown keeps its full parent exposure');
   assert.ok(!(await pendingSignalListeningDiscoveryRoundsV1({database:db})).some(r=>r.round_id===next.id),'a verified 429 remains parked instead of polling or resending');
   const global=(await db.query('SELECT ambiguous_micro_usd::text FROM signal_processing_org_exposure_v1($1,current_date,$2)',[policy.organization_id,policy.budget_timezone])).rows[0];assert.ok(Number(global.ambiguous_micro_usd)>=Number(second.reserved_micro_usd));
   await assert.rejects(db.query("UPDATE signal_listening_discovery_rounds SET ordinal=4 WHERE id=$1",[next.id]),/immutable/);
   assert.equal((await db.query('SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id=$1',[next.id])).rows[0].n,1);
   assert.equal((await db.query("SELECT count(*)::int n FROM signal_workspace_embedding_calls WHERE workspace_id=$1",[ctx.workspace_id])).rows[0].n,embeddingCallsBefore,'no fresh Voyage is needed for means or presentation-only changes');
   assert.deepEqual((await db.query('SELECT to_jsonb(m) map,(SELECT jsonb_agg(to_jsonb(t) ORDER BY topic_key) FROM signal_mass_labeling_topics t WHERE t.map_id=m.id) topics FROM signal_mass_labeling_maps m WHERE m.id=$1',[ctx.map_id])).rows[0],original);
  }finally{await rm(files,{recursive:true,force:true});}
 }});
});
