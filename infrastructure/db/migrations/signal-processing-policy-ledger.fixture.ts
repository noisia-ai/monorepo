import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import type {Pool,PoolClient,QueryConfig} from 'pg';
import {ensureSignalBrandContextPreparationV1,quoteSignalBrandContextPreparationV1,advanceSignalBrandContextPreparationsV1,
 type SignalBrandContextPreparationRuntimeV1} from '../signal-brand-context-preparation';
import {prepareSignalSemanticContextProposalInputV1,processSignalSemanticContextProposalRunV1,SignalSemanticContextProviderCallError} from '../signal-semantic-context-proposal';
import {loadSignalWorkspaceTopicPrototypesV1} from '../signal-workspace-topic-prototypes-management';
import {requestSignalWorkspaceCorpusPreparationStoreV1} from '../signal-workspace-corpus-preparation-management';
import {claimSignalWorkspaceCorpusPreparationRunV1} from '../signal-workspace-corpus-preparation';
import {signalWorkspaceCorpusPreparationJobV1} from '../../../services/workers/src/workers/signal-workspace-corpus-preparation';
import * as embeddings from '../signal-workspace-embeddings';
import * as interpretation from '../signal-workspace-engine-interpretation';
import {failSignalWorkspaceEngineV1,type SignalWorkspaceEngineSnapshotV1} from '../signal-workspace-engine';
import {BRAND_CONTEXT_SYNTHETIC_INTAKE_V1,BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1,
 createBrandContextSyntheticSemanticProviderV1,createBrandContextSyntheticVoyageProviderV1,
 executeBrandContextSyntheticPrototypeRunV1} from './signal-brand-context.synthetic.fixture';
import type {BrandContextSyntheticSaveBindingsV1} from './signal-brand-context.integration.assertions';
import {syntheticClientWorkspaceFixtureV1} from './signal-client-workspace-entry.synthetic.fixture';
import type {ProcessingPolicyFixtureTransactionV1} from './signal-processing-policy.fixture';

const sha=(text:string)=>`sha256:${createHash('sha256').update(text).digest('hex')}`;
type Exposure={confirmed_micro_usd:string;reserved_micro_usd:string;ambiguous_micro_usd:string;total_micro_usd:string};
type Entry={ledger:'semantic'|'voyage'|'interpretation';state:string;reserved:string;settled:string|null;observed:string|null};

/** Real ledger transitions with invented responses. The observing query wrapper
 * never changes a result; its extra negative branches roll back to the exact
 * reserved call before the existing fixture continues. No historic customer row
 * is read, cloned, updated or used as an authority. */
export async function seedProcessingPolicyMoneyHistoryV1(args:ProcessingPolicyFixtureTransactionV1&{
 organization_id:string;actor_user_id:string;runtime:SignalBrandContextPreparationRuntimeV1;
 free_preparation_actors:Array<{id:string;grant:'admin'|'comment'|'read'|null;allowed:boolean}>;
 withSaves:<T>(database:Pool,run:(saves:BrandContextSyntheticSaveBindingsV1)=>Promise<T>)=>Promise<T>;
}){
 const {organization_id,actor_user_id,runtime}=args,raw:PoolClient['query']=args.scoped.query.bind(args.scoped);
 const states=new Set<string>();let observing=false,engineNegativeDone=false,voyageNegativeDone=false,freePreparationScenarios=0;
 const freePreparationRecoveryScenarios:string[]=[];
 const isolated=async<T>(work:()=>Promise<T>)=>{await raw('BEGIN');try{return await work();}finally{await raw('ROLLBACK');}};
 const check=async():Promise<Exposure>=>{
  const entries=(await raw<Entry>(`SELECT 'semantic' ledger,CASE WHEN r.status='reserved' THEN
    CASE WHEN run.provider_call_state='not_started' THEN 'reserved' ELSE run.provider_call_state END ELSE r.status END state,
    r.reservation_micro_usd::text reserved,r.actual_micro_usd::text settled,NULL::text observed
   FROM signal_semantic_context_budget_reservations r JOIN signal_workspaces w ON w.id=r.workspace_id
   JOIN signal_semantic_context_proposal_runs run ON run.id=r.run_id WHERE w.organization_id=$1
    AND (r.reserved_at AT TIME ZONE 'America/Mexico_City')::date=(clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date
   UNION ALL SELECT 'voyage',c.status,c.reserved_micro_usd::text,c.settled_micro_usd::text,c.observed_micro_usd::text
   FROM signal_workspace_embedding_calls c JOIN signal_workspaces w ON w.id=c.workspace_id WHERE w.organization_id=$1
    AND (c.reserved_at AT TIME ZONE 'America/Mexico_City')::date=(clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date
   UNION ALL SELECT 'interpretation',c.call_state,c.reserved_micro_usd::text,c.settled_micro_usd::text,NULL::text
   FROM engine_cost_events c JOIN signal_workspaces w ON w.id=c.workspace_id WHERE w.organization_id=$1
    AND c.workspace_contract='workspace-engine-interpretation-v1'
    AND (c.created_at AT TIME ZONE 'America/Mexico_City')::date=(clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date`,[organization_id])).rows;
  const expected={confirmed_micro_usd:0n,reserved_micro_usd:0n,ambiguous_micro_usd:0n,total_micro_usd:0n};
  for(const entry of entries){states.add(`${entry.ledger}:${entry.state}`);
   if(['released','definitely_not_sent'].includes(entry.state))continue;
   const amount=entry.state==='settled'?BigInt(entry.settled!):
    entry.ledger==='voyage'&&BigInt(entry.observed??0)>BigInt(entry.reserved)?BigInt(entry.observed!):BigInt(entry.reserved);
   const category=entry.state==='settled'?'confirmed_micro_usd':entry.state==='outcome_unknown'?'ambiguous_micro_usd':'reserved_micro_usd';
   expected[category]+=amount;expected.total_micro_usd+=amount;
  }
  const actual=(await raw<Exposure>(`SELECT confirmed_micro_usd::text,reserved_micro_usd::text,ambiguous_micro_usd::text,total_micro_usd::text
   FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date,'America/Mexico_City')`,[organization_id])).rows[0]!;
  assert.deepEqual(actual,Object.fromEntries(Object.entries(expected).map(([key,value])=>[key,value.toString()])));
  return actual;
 };
 let database:Pool;
 const observedQuery=async(sql:string|QueryConfig,params?:unknown[])=>{
  const result=await raw(sql,params),text=typeof sql==='string'?sql:sql.text;
  if(!observing&&!freePreparationScenarios&&/^\s*INSERT INTO signal_corpus_preparation_input_state\(workspace_id,opted_in_at\)/iu.test(text)){
   const workspace_id=String(params?.[0]);
   if((await raw('SELECT 1 FROM import_batches WHERE workspace_id=$1 AND status=\'completed\' LIMIT 1',[workspace_id])).rows.length){
    observing=true;try{
     const before=await check();const admissions=(await raw('SELECT count(*)::int n FROM signal_processing_admissions')).rows[0]!.n;
     for(const actor of args.free_preparation_actors)await isolated(async()=>{
      const request={database,workspace_id,actor_user_id:actor.id,idempotency_key:randomUUID()};
      if(actor.allowed){
       const accepted=await requestSignalWorkspaceCorpusPreparationStoreV1(request);
       const replay=await requestSignalWorkspaceCorpusPreparationStoreV1(request);assert.equal(replay.replayed,true);assert.equal(replay.run_id,accepted.run_id);
       assert.equal((await raw('SELECT processing_admission_id FROM signal_corpus_preparation_runs WHERE id=$1',[accepted.run_id])).rows[0]!.processing_admission_id,null);
       await raw('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=(SELECT brand_id FROM signal_workspaces WHERE id=$2)',[actor.id,workspace_id]);
       await assert.rejects(()=>requestSignalWorkspaceCorpusPreparationStoreV1(request),{code:'corpus_preparation_forbidden'});
      }else await assert.rejects(()=>requestSignalWorkspaceCorpusPreparationStoreV1(request),{code:'corpus_preparation_forbidden'});
      assert.deepEqual(await check(),before);assert.equal((await raw('SELECT count(*)::int n FROM signal_processing_admissions')).rows[0]!.n,admissions);
      freePreparationScenarios++;
     });
     const [originalActor,nextActor]=args.free_preparation_actors.filter(actor=>actor.allowed);
     assert.ok(originalActor&&nextActor);
     const revoke=()=>raw('UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1 AND brand_id=(SELECT brand_id FROM signal_workspaces WHERE id=$2)',[originalActor.id,workspace_id]);
     const unchangedMoney=async()=>{assert.deepEqual(await check(),before);
      assert.equal((await raw('SELECT count(*)::int n FROM signal_processing_admissions')).rows[0]!.n,admissions);};
     await isolated(async()=>{
      const accepted=await requestSignalWorkspaceCorpusPreparationStoreV1({database,workspace_id,actor_user_id:originalActor.id,idempotency_key:randomUUID()});
      const prior=(await raw('SELECT worker_job_id,dispatch_generation FROM signal_corpus_preparation_runs WHERE id=$1',[accepted.run_id])).rows[0]!;
      const firstLease=await claimSignalWorkspaceCorpusPreparationRunV1({database,run_id:accepted.run_id,worker_job_id:prior.worker_job_id,lease_seconds:30});
      assert.ok(firstLease);
      // Let the real minimum lease expire. Do not change any timestamp or invoke
      // the global scheduler against unrelated retained workspaces.
      await raw('SELECT pg_sleep(30.05)');
      await isolated(async()=>{
       const reclaimed=await claimSignalWorkspaceCorpusPreparationRunV1({database,run_id:accepted.run_id,worker_job_id:prior.worker_job_id,lease_seconds:30});
       assert.ok(reclaimed);assert.notEqual(reclaimed.execution_token,firstLease.execution_token);
      });
      await isolated(async()=>{
       await revoke();
       for(const rotateToken of [true,false])await isolated(async()=>{
        // Both renewal forms must enforce the live actor even when status stays
        // running. The original lease expired naturally before this statement.
        await assert.rejects(()=>raw(`UPDATE signal_corpus_preparation_runs SET
         execution_token=CASE WHEN $2 THEN $3::uuid ELSE execution_token END,
         execution_expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1`,
         [accepted.run_id,rotateToken,randomUUID()]),{message:'corpus_preparation_forbidden'});
       });
       assert.equal(await claimSignalWorkspaceCorpusPreparationRunV1({database,run_id:accepted.run_id,worker_job_id:prior.worker_job_id}),null);
       assert.deepEqual((await raw('SELECT status,error_code,execution_token FROM signal_corpus_preparation_runs WHERE id=$1',[accepted.run_id])).rows[0],
        {status:'failed',error_code:'corpus_preparation_forbidden',execution_token:null});
       await unchangedMoney();
       freePreparationRecoveryScenarios.push('expired running lease cannot rotate or extend after actor revocation');
      });
      for(const revokeBeforeRequeue of [true,false])await isolated(async()=>{
       if(revokeBeforeRequeue)await revoke();
       // Exact existing reaper transition, restricted to this synthetic run.
       const requeued=await raw(`UPDATE signal_corpus_preparation_runs SET status='queued',dispatch_status='pending',
        dispatch_generation=dispatch_generation+1,worker_job_id='corpus-preparation-'||id::text||'-'||(dispatch_generation+1)::text,
        dispatch_token=NULL,dispatch_expires_at=NULL,execution_token=NULL,execution_expires_at=NULL,updated_at=clock_timestamp()
        WHERE status='running' AND execution_expires_at<clock_timestamp() AND id=$1 RETURNING worker_job_id,dispatch_generation`,[accepted.run_id]);
       assert.equal(requeued.rowCount,1);assert.notEqual(requeued.rows[0]!.worker_job_id,prior.worker_job_id);
       assert.equal(requeued.rows[0]!.dispatch_generation,prior.dispatch_generation+1);
       if(!revokeBeforeRequeue)await revoke();
       assert.equal(await claimSignalWorkspaceCorpusPreparationRunV1({database,run_id:accepted.run_id,worker_job_id:requeued.rows[0]!.worker_job_id}),null);
       const stopped=(await raw('SELECT status,error_code,execution_token,input_revision FROM signal_corpus_preparation_runs WHERE id=$1',[accepted.run_id])).rows[0]!;
       assert.deepEqual(stopped,{status:'failed',error_code:'corpus_preparation_forbidden',execution_token:null,input_revision:null});
       assert.equal((await raw('SELECT count(*)::int n FROM signal_corpus_preparation_items WHERE run_id=$1',[accepted.run_id])).rows[0]!.n,0);
       await unchangedMoney();
       freePreparationRecoveryScenarios.push(revokeBeforeRequeue?'revoked owner permits mechanical reaper cleanup':'revocation between requeue and claim stops all preparation');
      });
     });
     await isolated(async()=>{
      const request={database,workspace_id,actor_user_id:originalActor.id,idempotency_key:randomUUID()};
      const accepted=await requestSignalWorkspaceCorpusPreparationStoreV1(request);
      const job=(await raw('SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1',[accepted.run_id])).rows[0]!.worker_job_id;
      await signalWorkspaceCorpusPreparationJobV1({id:job,data:{run_id:accepted.run_id},updateProgress:async()=>{}},{database,page_size:3});
      const snapshot=async()=>(await raw("SELECT to_jsonb(run)-'request_keys'-'updated_at' value FROM signal_corpus_preparation_runs run WHERE id=$1",[accepted.run_id])).rows[0]!.value;
      const completed=await snapshot();assert.equal(completed.status,'completed');assert.equal(completed.counts.total_roots,3);
      assert.equal(completed.counts.processed_roots,3);assert.equal(completed.processing_admission_id,null);
      const runCount=(await raw('SELECT count(*)::int n FROM signal_corpus_preparation_runs WHERE workspace_id=$1',[workspace_id])).rows[0]!.n;
      await revoke();
      const newRequest={...request,actor_user_id:nextActor.id,idempotency_key:randomUUID()};
      assert.deepEqual(await requestSignalWorkspaceCorpusPreparationStoreV1(newRequest),{run_id:accepted.run_id,replayed:false});
      assert.deepEqual(await requestSignalWorkspaceCorpusPreparationStoreV1(newRequest),{run_id:accepted.run_id,replayed:true});
      assert.deepEqual(await snapshot(),completed,'completed reuse preserves the original actor, job, counts and receipt');
      assert.equal((await raw('SELECT count(*)::int n FROM signal_corpus_preparation_runs WHERE workspace_id=$1',[workspace_id])).rows[0]!.n,runCount);
      await assert.rejects(()=>requestSignalWorkspaceCorpusPreparationStoreV1({...request,actor_user_id:nextActor.id}),{code:'corpus_preparation_idempotency_conflict'});
      const foreign=(await raw<{id:string}>('SELECT id FROM users WHERE id=ANY($1::uuid[]) AND organization_id<>$2',
       [args.free_preparation_actors.map(actor=>actor.id),organization_id])).rows;
      assert.equal(foreign.length,1);
      await assert.rejects(()=>requestSignalWorkspaceCorpusPreparationStoreV1({...newRequest,actor_user_id:foreign[0]!.id,idempotency_key:randomUUID()}),{code:'corpus_preparation_forbidden'});
      await isolated(async()=>{await assert.rejects(()=>raw(`UPDATE signal_corpus_preparation_runs
       SET request_keys=request_keys||jsonb_build_object($2::text,$3::text) WHERE id=$1`,
       [accepted.run_id,randomUUID(),foreign[0]!.id]),{message:'corpus_preparation_forbidden'});});
      assert.deepEqual(await snapshot(),completed);await unchangedMoney();
      freePreparationRecoveryScenarios.push('a current new actor reuses completed preparation without requeue or old-key adoption');
     });
    }finally{observing=false;}
   }
  }
  if(!observing&&/^\s*(?:INSERT\s+INTO|UPDATE)\s+(?:signal_semantic_context_(?:budget_reservations|proposal_runs)|signal_workspace_embedding_calls|engine_cost_events)\b/iu.test(text)){
   observing=true;try{
    await check();
    if(!voyageNegativeDone&&/^\s*INSERT\s+INTO\s+signal_workspace_embedding_calls\b/iu.test(text)){
     const row=(await raw<{id:string;attempt_token:string;run_id:string;workspace_id:string;execution_token:string;profile:embeddings.SignalWorkspaceEmbeddingProfileV1;input_contract:'corpus'|'topic_prototypes'}>(`
      SELECT c.id,c.attempt_token,c.run_id,c.workspace_id,r.execution_token,r.profile,r.input_contract
      FROM signal_workspace_embedding_calls c JOIN signal_workspace_embedding_runs r ON r.id=c.run_id
      JOIN signal_workspaces w ON w.id=c.workspace_id WHERE w.organization_id=$1 AND c.status='reserved' ORDER BY c.reserved_at DESC,c.id LIMIT 1`,[organization_id])).rows[0];
     assert.ok(row);voyageNegativeDone=true;
     const lease:embeddings.SignalWorkspaceEmbeddingLeaseV1={run_id:row.run_id,workspace_id:row.workspace_id,execution_token:row.execution_token,
      profile:row.profile,input_contract:row.input_contract,cursor:null};
     const scope={database,lease,call_id:row.id,attempt_token:row.attempt_token};
     await isolated(async()=>{await embeddings.failSignalWorkspaceEmbeddingCallV1({...scope,outcome:'definitely_not_sent',error_code:'workspace_embedding_synthetic_not_sent'});await check();});
     await isolated(async()=>{await embeddings.markSignalWorkspaceEmbeddingCallSentV1(scope);await check();
      await embeddings.failSignalWorkspaceEmbeddingCallV1({...scope,outcome:'outcome_unknown',error_code:'workspace_embedding_synthetic_unknown'});await check();});
    }
    if(!engineNegativeDone&&/^\s*INSERT\s+INTO\s+engine_cost_events\b/iu.test(text)){
     const row=(await raw<{id:string;attempt_token:string;workspace_id:string;catalog_execution_id:string;request_digest:string;model:string;
      execution_token:string;input_digest:string;input_snapshot:SignalWorkspaceEngineSnapshotV1}>(`SELECT c.id,c.attempt_token,c.workspace_id,c.catalog_execution_id,
       c.request_digest,c.model,r.execution_token,r.input_digest,r.input_snapshot FROM engine_cost_events c
      JOIN signal_topic_catalog_executions r ON r.id=c.catalog_execution_id JOIN signal_workspaces w ON w.id=c.workspace_id
      WHERE w.organization_id=$1 AND c.call_state='reserved' ORDER BY c.created_at DESC,c.id LIMIT 1`,[organization_id])).rows[0];
     assert.ok(row);engineNegativeDone=true;
     const scope={database,call_id:row.id,attempt_token:row.attempt_token};
     await isolated(async()=>{await interpretation.failSignalWorkspaceEngineInterpretationV1({...scope,outcome:'definitely_not_sent',error_code:'workspace_engine_synthetic_not_sent'});await check();});
     await isolated(async()=>{
      assert.equal((await interpretation.markSignalWorkspaceEngineInterpretationSentV1({...scope,execution_token:row.execution_token})).send_authorized,true);await check();
      await interpretation.failSignalWorkspaceEngineInterpretationV1({...scope,outcome:'outcome_unknown',error_code:'workspace_engine_synthetic_unknown'});
      const unknown=await check();
      await failSignalWorkspaceEngineV1({database,lease:{execution_id:row.catalog_execution_id,workspace_id:row.workspace_id,
       execution_token:row.execution_token,input_digest:row.input_digest,snapshot:row.input_snapshot},error_code:'workspace_engine_interpretation_transport_unknown'});
      const sent=(await raw<{sent_at:string}>('SELECT sent_at::text FROM engine_cost_events WHERE id=$1',[row.id])).rows[0]!.sent_at;
      const proof='Explicit invented local terminal receipt; no provider console or transport.';
      const terminal={...scope,workspace_id:row.workspace_id,execution_id:row.catalog_execution_id,expected_request_digest:row.request_digest,
       verifier_user_id:actor_user_id,terminal:{source:'anthropic_console' as const,provider_request_id:`req_synthetic_${row.id.replaceAll('-','')}`,provider_model:row.model,
        started_at:new Date(sent).toISOString(),ended_at:new Date(sent).toISOString(),http_status:499 as const,reason:'client_disconnected' as const,
        usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0},
        evidence:{storage_key:`workspace-engine/${row.workspace_id}/${row.catalog_execution_id}/synthetic-terminal`,sha256:sha(proof),size_bytes:Buffer.byteLength(proof)}}};
      assert.equal((await interpretation.reconcileSignalWorkspaceEngineTerminalV1(terminal)).state,'terminal_confirmed');
      const confirmed=await check();assert.equal(confirmed.total_micro_usd,unknown.total_micro_usd,'terminal evidence does not duplicate or release its reservation');
      assert.equal(confirmed.confirmed_micro_usd,unknown.confirmed_micro_usd,'terminal evidence is not a settlement');
      await interpretation.reconcileSignalWorkspaceEngineTerminalV1(terminal);assert.deepEqual(await check(),confirmed);
     });
    }
   }finally{observing=false;}
  }
  return result;
 };
 const scoped=Object.assign(Object.create(args.scoped) as PoolClient,{query:observedQuery,release:()=>{}});
 database={query:observedQuery,connect:async()=>scoped} as unknown as Pool;
 await args.withSaves(database,async saves=>{
  const tx={database,scoped};
  const created=await saves.createBrand({...tx,organization_id,actor_user_id,intake:{...BRAND_CONTEXT_SYNTHETIC_INTAKE_V1,slug:`processing-policy-money-${randomUUID()}`}});
  for(const actor of args.free_preparation_actors)if(actor.grant)
   await raw('INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,$3)',[actor.id,created.brand_id,actor.grant]);
  await saves.saveKnowledge({...tx,...created,organization_id,actor_user_id,title:'Synthetic processing policy knowledge',raw_text:BRAND_CONTEXT_SYNTHETIC_ADDITIONAL_KB_V1,idempotency_key:randomUUID()});
  const scope={database,workspace_id:created.workspace_id,actor_user_id};
  const quote=quoteSignalBrandContextPreparationV1({actor_user_id,runtime});
  const prepared=await ensureSignalBrandContextPreparationV1({...scope,runtime,idempotency_key:randomUUID(),primary_locale:'es-MX',
   admission:{quote_digest:quote.quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}});
  const advance=()=>advanceSignalBrandContextPreparationsV1({database,runtime,limit:10});await advance();
  const run=(await raw<{id:string}>('SELECT id FROM signal_semantic_context_proposal_runs WHERE generation_id=$1',[prepared.generation_id])).rows[0];assert.ok(run);
  for(const definitelyNotSent of [true,false])await isolated(async()=>{
   await assert.rejects(()=>processSignalSemanticContextProposalRunV1({pool:database,run_id:run.id,provider:{generate:async()=>{
    await check();throw new SignalSemanticContextProviderCallError('synthetic provider failure',definitelyNotSent);}}}),
   error=>error instanceof SignalSemanticContextProviderCallError);await check();
   if(definitelyNotSent){
    // A failed no-send keeps its reservation for an ordinary retry. Only the
    // existing explicit unspent successor operation releases that reservation.
    const nextRuntime={...runtime,semantic:{...runtime.semantic,pricing_version:`${runtime.semantic.pricing_version}-unspent-successor`}};
    const nextQuote=quoteSignalBrandContextPreparationV1({actor_user_id,runtime:nextRuntime});
    const next=await ensureSignalBrandContextPreparationV1({...scope,runtime:nextRuntime,idempotency_key:randomUUID(),primary_locale:'es-MX',
     admission:{quote_digest:nextQuote.quote_digest,confirmation:'prepare_brand_context_within_shown_cap'}});
    assert.notEqual(next.generation_id,prepared.generation_id);await check();
   }
  });
  const input=await prepareSignalSemanticContextProposalInputV1({queryable:database,workspace:{id:scope.workspace_id,organization_id,brand_id:created.brand_id},generation_key:prepared.generation_key});
  const semantic=createBrandContextSyntheticSemanticProviderV1({input:input.input,prompt:input.prompt,model:runtime.semantic.model,revision:'initial'});
  assert.equal((await processSignalSemanticContextProposalRunV1({pool:database,run_id:run.id,provider:semantic.provider})).status,'completed');await advance();
  const prototypes=await loadSignalWorkspaceTopicPrototypesV1(scope);assert.ok(prototypes.active_run);
  const voyage=createBrandContextSyntheticVoyageProviderV1();await executeBrandContextSyntheticPrototypeRunV1({database,run_id:prototypes.active_run.id,provider:voyage.provider});await advance();
  await syntheticClientWorkspaceFixtureV1({database,scoped,query:(sql,params)=>scoped.query(sql,params),cleanup:async()=>{}},
   {identity:{...created,organization_id,actor_user_id}});
 });
 const totals=await check();
 for(const ledger of ['semantic','voyage','interpretation'])for(const state of ['reserved','in_flight','response_persisted','settled','outcome_unknown'])
  assert.ok(states.has(`${ledger}:${state}`),`synthetic real ledger missing ${ledger}:${state}`);
 for(const state of ['semantic:released','voyage:definitely_not_sent','interpretation:definitely_not_sent','interpretation:terminal_confirmed'])assert.ok(states.has(state),`synthetic real ledger missing ${state}`);
 assert.equal(freePreparationScenarios,args.free_preparation_actors.length);
 assert.equal(freePreparationRecoveryScenarios.length,4);
 return{states:[...states].sort(),confirmed_micro_usd:totals.confirmed_micro_usd,total_micro_usd:totals.total_micro_usd,
  free_preparation_scenarios:freePreparationScenarios,free_preparation_recovery_scenarios:freePreparationRecoveryScenarios};
}
