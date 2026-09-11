import {brandContextSnapshotFixtureV1} from './signal-brand-context.test-helpers';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool} from 'pg';
import {signalSemanticContextProposalDigestV1 as digest} from '@noisia/query-engine';
import {ensureSignalBrandContextPreparationV1, type SignalBrandContextPreparationEnsureArgsV1} from './signal-brand-context-preparation';
import {resolveSignalBrandContextAuthorityV1} from './signal-brand-context-authority';
import {signalSemanticContextProposalRuntimeConfigurationFromEnvV1, type SignalSemanticContextQueryable} from './signal-semantic-context-proposal';

const actor='10000000-0000-4000-8000-000000000001',workspaceId='10000000-0000-4000-8000-000000000002';
const parentId='10000000-0000-4000-8000-000000000003',parentKey='semantic-context-v3';
const runtime={semantic:signalSemanticContextProposalRuntimeConfigurationFromEnvV1({}),
  prototype:{available:false,max_run_cost_micro_usd:20000},queue_configured:false,worker_alive:false,recovery_alive:false};
const workspace={id:workspaceId,organizationId:actor,subject:{type:'brand' as const,id:actor},timezone:'America/Mexico_City'};
type Run={status:string;provider_call_state:string;provider_call_count:number;provider_response_digest:string|null;
  provider_response_private:unknown;settled_micro_usd:string|null};
type Generation={id:string;generation_key:string;generation_version:number;status:string;source_digest:string;
  proposal_provider_lineage:unknown;draft_digest:string;pack_digest:null;supersedes_generation_id?:string;supersession_reason?:string};
type Operation={id:string;workspace_id:string;actor_user_id:string;action:string;idempotency_key:string;request_digest:string;
  brand_context_preparation:Record<string,unknown>|null;status:string;result:Record<string,unknown>|null};

// Stateful transaction double for the public DB store. Only generation/artifact,
// operation and event writes are supported; touching paid rows is an error.
// Real SQL-trigger execution remains the separately controlled PG integration.
async function fixture(options:{run?:Partial<Run>|null;status?:string;outbox?:string;reservation?:string;reviewable?:boolean}={}){
  let sourceAvailable=true,authorized=true,failPreparation=false,loseCommitAck=false,connections=0,locked=false;
  const queries:string[]=[];
  const authority:SignalSemanticContextQueryable={async query<T>(sql:string){let rows:unknown[]=[];
    if(sql.includes('FROM brand_os_profiles'))rows=sourceAvailable?[{id:actor,version:1,digest:brandContextSnapshotFixtureV1(actor).digest,countries:['MX']}]:[];
    else if(sql.includes('AS name,brand.description'))rows=[brandContextSnapshotFixtureV1(actor).snapshot];
    else if(sql.includes('FROM brand_knowledge_sources'))rows=[{id:actor,source_kind:'brand_brief',file_hash:null,content_digest:'sha256:'+'b'.repeat(64)}];
    else if(!sql.includes('FROM signal_acquisition_plans')&&!sql.includes('FROM knowledge_chunks')&&!sql.includes("brand_context_preparation->>'primary_locale'"))
      throw new Error('Unexpected authority query');
    return{rows:rows as T[],rowCount:rows.length};}};
  const live=await resolveSignalBrandContextAuthorityV1({queryable:authority,workspace});
  let state={generations:[{id:parentId,generation_key:parentKey,generation_version:3,status:options.status??'draft',
      source_digest:live.sourceAuthorityDigest,proposal_provider_lineage:{immutable:'prior-paid-lineage'},draft_digest:digest('parent'),pack_digest:null}] as Generation[],
    operations:[] as Operation[],artifacts:[] as unknown[],events:[] as unknown[],
    paid:{run:options.run===null?null:{status:'failed',provider_call_state:'settled',provider_call_count:1,
      provider_response_digest:digest('paid-response'),provider_response_private:{unchanged:'paid raw bytes'},settled_micro_usd:'17',...options.run} as Run,
      outbox:options.outbox??'completed',reservation:{status:options.reservation??'settled',amount:'17'},
      reviewable:options.reviewable??false,admission:{original:true,expired:true},costs:[{provider:'anthropic',amount:'17'}],
      results:{private:'prior paid result'}}};
  let snapshot:typeof state|null=null,counter=10;
  const client={release(){},async query<T extends Record<string,unknown>>(sql:string,values:unknown[]=[]){queries.push(sql);let rows:unknown[]=[];
    if(sql==='BEGIN'){assert.equal(snapshot,null);snapshot=structuredClone(state);locked=false;}
    else if(sql==='COMMIT'){snapshot=null;locked=false;if(loseCommitAck){loseCommitAck=false;throw new Error('lost commit acknowledgement');}}
    else if(sql==='ROLLBACK'){if(snapshot)state=snapshot;snapshot=null;locked=false;}
    else if(sql.includes('actor.status actor_status'))rows=authorized&&values[0]===workspaceId?[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin'}]:[];
    else if(sql.includes("u.user_type='noisia_internal'"))rows=[{organization_id:actor,brand_id:actor,timezone:workspace.timezone,internal:true}];
    else if(sql.includes('pg_advisory_xact_lock')){assert.deepEqual(values,[`signal-semantic-context:${workspaceId}`]);locked=true;}
    else if(sql==='SELECT clock_timestamp() now')rows=[{now:new Date('2026-09-11T01:00:00Z')}];
    else if(sql.startsWith('SELECT * FROM signal_governance_control_operations')){
      assert.equal(locked,true);rows=state.operations.filter(op=>op.workspace_id===values[0]&&op.idempotency_key===values[1]);
    }else if(sql.startsWith('SELECT gen.*,artifact.')){
      assert.equal(locked,true);assert.match(sql,/FOR UPDATE OF gen/u);assert.deepEqual(values,[workspaceId]);rows=state.generations.slice(-1);
    }else if(sql.startsWith('SELECT run.status,')){
      assert.equal(locked,true);assert.match(sql,/FOR UPDATE OF run/u);assert.deepEqual(values,[workspaceId,parentId]);
      assert.match(sql,/successor\.supersedes_element_id=element\.id/u);
      assert.match(sql,/outbox\.status IN \('pending','failed','dispatching','dispatched'\)/u);
      assert.match(sql,/reservation\.status='reserved'/u);
      rows=state.paid.run?[{...state.paid.run,reviewable_elements:state.paid.reviewable,
        executable_outbox:['pending','failed','dispatching','dispatched'].includes(state.paid.outbox),reserved_budget:state.paid.reservation.status==='reserved'}]:[];
    }else if(sql.startsWith('SELECT run.id,run.created_by_user_id')){
      rows=state.paid.run?[{id:'prior-run',created_by_user_id:actor,safe_unspent:false,configuration_digest:digest('prior-config')}]:[];
    }else if(sql.startsWith('INSERT INTO signal_governance_control_operations')){
      assert.equal(locked,true);
      if(values[2]==='prepare-brand-context'&&failPreparation)throw new Error('preparation insertion rejected');
      const op:Operation={id:`operation-${++counter}`,workspace_id:String(values[0]),actor_user_id:String(values[1]),action:String(values[2]),
        request_digest:String(values[3]),idempotency_key:String(values[4]),brand_context_preparation:values[5]?JSON.parse(String(values[5])):null,
        status:'in_progress',result:null};state.operations.push(op);rows=[op];
    }else if(sql.startsWith('UPDATE signal_governance_control_operations SET status=')){
      const op=state.operations.find(value=>value.id===values[0])!;assert.equal(op.status,'in_progress');
      op.status='completed';op.result=JSON.parse(String(values[1]));return{rows:[] as T[],rowCount:1};
    }else if(sql.startsWith('INSERT INTO analysis_artifacts')){
      assert.equal(locked,true);state.artifacts.push(structuredClone(values));rows=[{id:`artifact-${++counter}`}];
    }else if(sql.startsWith('INSERT INTO signal_semantic_context_generations')){
      assert.equal(locked,true);assert.equal(values[4],parentId);assert.equal(values[5],'terminal_provider_run');
      assert.equal(state.generations.length,1,'one child at most');
      assert.ok(!sql.includes('provider_response')&&!sql.includes('admission'),'child contains no inherited result or permission');
      const gen:Generation={id:`child-${++counter}`,generation_key:String(values[2]),generation_version:Number(values[3]),status:'draft',
        source_digest:live.sourceAuthorityDigest,supersedes_generation_id:String(values[4]),supersession_reason:String(values[5]),
        proposal_provider_lineage:values[20]?JSON.parse(String(values[20])):null,draft_digest:String(values[22]),pack_digest:null};
      state.generations.push(gen);rows=[gen];
    }else if(sql.startsWith('INSERT INTO signal_semantic_context_events'))state.events.push(structuredClone(values));
    else if(sql.includes('FROM brand_os_profiles')||sql.includes('AS name,brand.description')||sql.includes('FROM brand_knowledge_sources')||sql.includes('FROM signal_acquisition_plans')
      ||sql.includes('FROM knowledge_chunks')||sql.includes("brand_context_preparation->>'primary_locale'"))return authority.query<T>(sql,values);
    else throw new Error(`Unexpected statement: ${sql.slice(0,90)}`);
    return{rows:rows as T[],rowCount:rows.length};}};
  const database={query:client.query,async connect(){connections++;return client;}} as unknown as Pool;
  const args:SignalBrandContextPreparationEnsureArgsV1={database,workspace_id:workspaceId,actor_user_id:actor,runtime,
    idempotency_key:'terminal-recovery-1',reconciliation_reason:'terminal_provider_run',expected_generation_key:parentKey};
  return{args,queries,get state(){return structuredClone(state);},get connections(){return connections;},
    noSource(){sourceAvailable=false;},deny(){authorized=false;},failPreparation(){failPreparation=true;},loseCommitAck(){loseCommitAck=true;}};
}
const code=(expected:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===expected;

test('terminal recovery creates exactly one empty successor and an awaiting receipt, preserving paid state',async()=>{
  const f=await fixture(),before=f.state;
  const result=await ensureSignalBrandContextPreparationV1(f.args);
  assert.equal(result.state,'awaiting_authorization');assert.equal(result.replayed,false);
  assert.equal(result.generation_key,'semantic-context-v4');assert.equal(result.semantic_run_id,null);assert.equal(result.prototype_run_id,null);
  assert.equal(result.active_elements,0);assert.equal(result.exceptions,0);
  assert.deepEqual(f.state.paid,before.paid);assert.deepEqual(f.state.generations[0],before.generations[0]);
  assert.equal(f.state.generations.length,2);assert.equal(f.state.artifacts.length,1);assert.equal(f.state.events.length,1);
  const prep=f.state.operations.find(op=>op.action==='prepare-brand-context')!;
  assert.equal(prep.brand_context_preparation?.admission,null);assert.equal(prep.brand_context_preparation?.reconciliation_reason,'terminal_provider_run');
  assert.equal(prep.brand_context_preparation?.expected_generation_key,parentKey);
  assert.equal(prep.request_digest,digest({contract_version:'signal-product-operation-v1',workspace_id:workspaceId,action:'prepare-brand-context',
    input:{primary_locale:null,admission:null,reconciliation_reason:'terminal_provider_run',expected_generation_key:parentKey}}));
  assert.equal(f.state.generations[1]!.draft_digest,digest({contract_version:'signal-semantic-context-pack-v1',
    generation_key:'semantic-context-v4',source_authority_digest:f.state.generations[1]!.source_digest,elements:[]}));
  await assert.rejects(ensureSignalBrandContextPreparationV1({...f.args,idempotency_key:'terminal-recovery-new-key'}),code('brand_context_generation_changed'));
  assert.equal(f.state.generations.length,2);assert.deepEqual(f.state.paid,before.paid);
});
test('lost commit ACK replays before current source; key binds actor, reason and expected generation',async()=>{
  const f=await fixture();f.loseCommitAck();
  await assert.rejects(ensureSignalBrandContextPreparationV1(f.args),/lost commit acknowledgement/u);
  const after=f.state;f.noSource();
  const replay=await ensureSignalBrandContextPreparationV1(f.args);assert.equal(replay.replayed,true);assert.equal(replay.state,'awaiting_authorization');
  assert.deepEqual(f.state,after);
  for(const patch of [{expected_generation_key:'semantic-context-v2'},
    {reconciliation_reason:undefined,expected_generation_key:undefined},{actor_user_id:'10000000-0000-4000-8000-000000000099'}])
    await assert.rejects(ensureSignalBrandContextPreparationV1({...f.args,...patch}),code('brand_context_idempotency_conflict'));
  f.deny();await assert.rejects(ensureSignalBrandContextPreparationV1(f.args),code('brand_context_forbidden'));
  assert.deepEqual(f.state,after);
});
test('child and receipts roll back together if preparation cannot be completed',async()=>{
  const f=await fixture(),before=f.state;f.failPreparation();
  await assert.rejects(ensureSignalBrandContextPreparationV1(f.args),/preparation insertion rejected/u);
  assert.deepEqual(f.state,before);assert.equal(f.queries.at(-1),'ROLLBACK');
});
test('normal preparation retains its prior request digest and does not supersede a terminal run',async()=>{
  const f=await fixture();const {reconciliation_reason,expected_generation_key,...normal}=f.args;
  const result=await ensureSignalBrandContextPreparationV1(normal);
  assert.equal(result.generation_key,parentKey);assert.equal(result.state,'awaiting_authorization');assert.equal(f.state.generations.length,1);
  assert.equal(f.state.operations[0]!.request_digest,digest({contract_version:'signal-product-operation-v1',workspace_id:workspaceId,
    action:'prepare-brand-context',input:{primary_locale:null,admission:null}}));
  assert.equal(reconciliation_reason,'terminal_provider_run');assert.equal(expected_generation_key,parentKey);
});
for(const run of [
  {status:'stale',provider_call_state:'not_started',provider_call_count:0,provider_response_digest:null,provider_response_private:null,settled_micro_usd:null},
  {status:'stale',provider_call_state:'settled'},
  {status:'dead_letter',provider_call_state:'not_started',provider_call_count:0,provider_response_digest:null,provider_response_private:null,settled_micro_usd:null}
])test(`existing terminal policy allows ${run.status}/${run.provider_call_state} without transferring money`,async()=>{
  const f=await fixture({run}),before=f.state.paid;const result=await ensureSignalBrandContextPreparationV1(f.args);
  assert.equal(result.state,'awaiting_authorization');assert.deepEqual(f.state.paid,before);
});
const invalid:Array<[string,Parameters<typeof fixture>[0],string]>=[
  ['missing run',{run:null},'semantic_context_terminal_run_not_eligible'],
  ['published',{status:'published'},'semantic_context_terminal_run_not_eligible'],
  ['completed',{run:{status:'completed'}},'semantic_context_terminal_run_not_eligible'],
  ['failed without response',{run:{provider_response_digest:null}},'semantic_context_terminal_run_not_eligible'],
  ['two calls',{run:{provider_call_count:2}},'semantic_context_terminal_run_not_eligible'],
  ['retryable no-send',{run:{provider_call_state:'not_started',provider_call_count:0,provider_response_digest:null}},'semantic_context_terminal_run_retry_required'],
  ['unknown status',{run:{status:'outcome_unknown'}},'semantic_context_terminal_run_not_eligible'],
  ['reviewable leaf',{reviewable:true},'semantic_context_generation_review_required'],
  ['reserved budget',{reservation:'reserved'},'semantic_context_proposal_run_active'],
  ...['pending','failed','dispatching','dispatched'].map(outbox=>[`outbox ${outbox}`,{outbox},'semantic_context_proposal_run_active'] as [string,Parameters<typeof fixture>[0],string]),
  ...['queued','processing','validating'].map(status=>[`run ${status}`,{run:{status}},'semantic_context_proposal_run_active'] as [string,Parameters<typeof fixture>[0],string]),
  ...['in_flight','response_persisted','outcome_unknown'].map(provider_call_state=>[`call ${provider_call_state}`,{run:{provider_call_state}},'semantic_context_provider_outcome_ambiguous'] as [string,Parameters<typeof fixture>[0],string])
];
for(const [name,options,expected]of invalid)test(`terminal recovery rejects ${name} without writes`,async()=>{
  const f=await fixture(options),before=f.state;
  await assert.rejects(ensureSignalBrandContextPreparationV1(f.args),code(expected));assert.deepEqual(f.state,before);
  assert.equal(f.queries.filter(sql=>/^\s*(INSERT|UPDATE|DELETE)/u.test(sql)).length,0);
});
test('terminal recovery requires exact scoped CAS and refuses admission or malformed reasons',async()=>{
  const patches:Array<[Partial<SignalBrandContextPreparationEnsureArgsV1>,string]>=[
    [{expected_generation_key:undefined},'brand_context_reconciliation_invalid'],
    [{expected_generation_key:'../wrong'},'brand_context_reconciliation_invalid'],
    [{expected_generation_key:'semantic-context-v2'},'brand_context_generation_changed'],
    [{reconciliation_reason:undefined},'brand_context_reconciliation_invalid'],
    [{reconciliation_reason:'wrong' as never},'brand_context_reconciliation_invalid'],
    [{admission:{quote_digest:digest('forged'),confirmation:'prepare_brand_context_within_shown_cap'}},'brand_context_terminal_admission_forbidden'],
    [{workspace_id:'10000000-0000-4000-8000-000000000099'},'brand_context_forbidden']
  ];
  for(const [patch,expected]of patches){const f=await fixture(),before=f.state;
    await assert.rejects(ensureSignalBrandContextPreparationV1({...f.args,...patch}),code(expected));assert.deepEqual(f.state,before);
  }
});
