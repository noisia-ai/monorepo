import {brandContextSnapshotFixtureV1} from './signal-brand-context.test-helpers';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pool} from 'pg';
import {ensureSignalBrandContextPreparationV1,loadSignalBrandContextPreparationV1,
  type SignalBrandContextPreparationV1} from './signal-brand-context-preparation';
import {resolveSignalBrandContextAuthorityV1} from './signal-brand-context-authority';
import {signalSemanticContextProposalRuntimeConfigurationFromEnvV1,
  type SignalSemanticContextQueryable} from './signal-semantic-context-proposal';
import {signalSemanticContextProposalDigestV1 as digest} from '@noisia/query-engine';

test('latest preparation follows acceptance under the workspace lock when transaction now is shared',async()=>{
  const actor='10000000-0000-4000-8000-000000000001',workspaceId='10000000-0000-4000-8000-000000000002';
  const generationId='10000000-0000-4000-8000-000000000003';
  const workspace={id:workspaceId,organizationId:actor,subject:{type:'brand' as const,id:actor},timezone:'America/Mexico_City'};
  const runtime={semantic:signalSemanticContextProposalRuntimeConfigurationFromEnvV1({}),
    prototype:{available:false,max_run_cost_micro_usd:20000},queue_configured:false,worker_alive:false,recovery_alive:false};
  const authority:SignalSemanticContextQueryable={async query<T>(sql:string){let rows:unknown[]=[];
    if(sql.includes('FROM brand_os_profiles'))rows=[{id:actor,version:1,digest:brandContextSnapshotFixtureV1(actor).digest,countries:['MX']}];
    else if(sql.includes('AS name,brand.description'))rows=[brandContextSnapshotFixtureV1(actor).snapshot];
    else if(sql.includes('signal_semantic_context_digest_v1(')&&sql.includes('WITH sources AS'))rows=[{knowledge_digest:digest({
      sources:[{id:actor,kind:'brand_brief',digest:'sha256:'+'b'.repeat(64)}],chunks:[]})}];
    return{rows:rows as T[],rowCount:rows.length};}};
  const live=await resolveSignalBrandContextAuthorityV1({queryable:authority,workspace});
  type Op={id:string;workspace_id:string;actor_user_id:string;idempotency_key:string;request_digest:string;
    action:string;status:string;created_at:number;result:SignalBrandContextPreparationV1|null;brand_context_preparation:unknown};
  const operations:Op[]=[];
  // UUID ordering deliberately opposes acceptance. The fake models PostgreSQL's
  // stable transaction now() and advancing statement clock; it does not seed a
  // ready result or replace either public preparation/reader implementation.
  const ids=['ffffffff-ffff-4fff-8fff-ffffffffffff','00000000-0000-4000-8000-000000000000'];
  let clock=1,locked=false,runWrites=0;
  const client={release(){},async query<T extends Record<string,unknown>>(sql:string,values:unknown[]=[]){let rows:unknown[]=[];
    if(sql.includes('pg_advisory_xact_lock'))locked=true;
    else if(sql==='SELECT clock_timestamp() now')rows=[{now:new Date('2026-09-11T01:00:00Z')}];
    else if(sql.includes('actor.status actor_status'))rows=[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:'noisia_admin'}];
    else if(sql.includes("u.user_type='noisia_internal'"))rows=[{organization_id:actor,brand_id:actor,timezone:workspace.timezone,internal:true}];
    else if(sql.startsWith('SELECT gen.*,artifact.'))rows=[{id:generationId,generation_key:'semantic-context-v1',generation_version:1,
      status:'draft',source_digest:live.sourceAuthorityDigest}];
    else if(sql.startsWith('INSERT INTO signal_governance_control_operations')){
      assert.equal(locked,true,'acceptance must be recorded after the workspace lock');
      const operation:Op={id:ids[operations.length]!,workspace_id:String(values[0]),actor_user_id:String(values[1]),action:String(values[2]),
        request_digest:String(values[3]),idempotency_key:String(values[4]),brand_context_preparation:JSON.parse(String(values[5])),
        status:'in_progress',result:null,created_at:/created_at[^]*VALUES[^]*clock_timestamp\(\)/u.test(sql)?++clock:1};
      operations.push(operation);rows=[operation];
    }else if(sql.startsWith('UPDATE signal_governance_control_operations SET status=')){
      const op=operations.find(row=>row.id===values[0])!;op.status='completed';op.result=JSON.parse(String(values[1]));
      return{rows:[] as T[],rowCount:1};
    }else if(sql.startsWith('SELECT * FROM signal_governance_control_operations')){
      rows=sql.includes('idempotency_key=')?operations.filter(row=>row.idempotency_key===values.at(-1)):
        [...operations].sort((a,b)=>b.created_at-a.created_at||b.id.localeCompare(a.id)).slice(0,1);
    }else if(sql.includes('SELECT gen.status generation_status'))rows=[{generation_status:'draft',has_successor:false,
      semantic_run_id:null,semantic_status:null,error_code:null,prototype_run_id:null,prototype_status:null,prototype_error:null,
      active_elements:0,exceptions:0,admission_current:false}];
    else if(/^\s*INSERT INTO signal_(?:semantic_context_proposal_runs|workspace_embedding_runs)/u.test(sql))runWrites++;
    else return authority.query<T>(sql,values);
    return{rows:rows as T[],rowCount:rows.length};}};
  const database={query:client.query,connect:async()=>client} as unknown as Pool;
  const scope={database,workspace_id:workspaceId,actor_user_id:actor};
  const first=await ensureSignalBrandContextPreparationV1({...scope,runtime,idempotency_key:'first-preparation'});
  const second=await ensureSignalBrandContextPreparationV1({...scope,runtime,idempotency_key:'second-preparation'});
  assert.notEqual(first.operation_id,second.operation_id);
  const view=await loadSignalBrandContextPreparationV1({...scope,idempotency_key:'first-preparation'});
  assert.equal(view.current?.operation_id,second.operation_id);
  assert.equal(view.request?.operation_id,first.operation_id,'historic receipt remains addressable independently');
  assert.equal(view.current?.state,'awaiting_authorization');
  const count=operations.length;
  const replay=await ensureSignalBrandContextPreparationV1({...scope,runtime,idempotency_key:'first-preparation'});
  assert.equal(replay.replayed,true);assert.equal(replay.operation_id,first.operation_id);
  assert.equal(operations.length,count);assert.equal(runWrites,0);
});
