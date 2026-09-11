import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import type {Pool} from 'pg';
import {signalSemanticContextProposalDigestV1 as digest} from '@noisia/query-engine';
import {brandContextSnapshotFixtureV1} from './signal-brand-context.test-helpers';
import {resolveSignalBrandContextAuthorityV1} from './signal-brand-context-authority';
import {reconcileSignalBrandContextSourceV1} from './signal-brand-context-source-reconciliation';
import {prepareSignalSemanticContextProposalInputV1,processSignalSemanticContextProposalRunV1,
  type SignalSemanticContextQueryable,type SignalSemanticContextProposalRuntimeConfigurationV1} from './signal-semantic-context-proposal';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const workspace={id:id(1),organizationId:id(2),subject:{type:'brand' as const,id:id(3)},timezone:'America/Mexico_City'};
const configuration:SignalSemanticContextProposalRuntimeConfigurationV1={available:true,provider:'anthropic',model:'claude-sonnet-4-6',
 model_version:'claude-sonnet-4-6',pricing_version:'synthetic-v1',max_input_tokens:20000,max_output_tokens:64000,model_max_output_tokens:64000,
 input_usd_per_million_tokens:'3',output_usd_per_million_tokens:'15',platform_hard_cap_micro_usd:1000000n};
const saved={contract_version:'brand-context-source-reconciliation-v1' as const,reconciliation_id:id(8),workspace_id:workspace.id,
 generation_id:id(5),generation_key:'semantic-context-v1',state:'awaiting_authorization' as const,replayed:false};
const args={workspace_id:workspace.id,actor_user_id:id(4),idempotency_key:'source-reconcile-one',expected_generation_id:id(5),configuration};
const sql=readFileSync(new URL('./migrations/0159_signal_brand_context_source_reconciliation.sql',import.meta.url),'utf8');
const body=(name:string)=>sql.split(`FUNCTION ${name}(`)[1]?.split('$$;')[0]??'';

function context(){
 const {snapshot,digest:brandHash}=brandContextSnapshotFixtureV1(workspace.organizationId);
 const queries:Array<{sql:string;values:unknown[]}>=[];
 const queryable:SignalSemanticContextQueryable={async query<Row extends Record<string,unknown>>(statement:string,values:unknown[]=[]){
  queries.push({sql:statement,values}); let rows:unknown[]=[];
  if(statement.includes('AS name,brand.description'))rows=[snapshot];
  else if(statement.includes('FROM brand_os_profiles profile'))rows=[{id:id(6),version:1,digest:brandHash,countries:['MX'],
    display_name:snapshot.name,aliases:[],industry:null,industry_sub:null,description:null,metadata:{snapshot_hash:brandHash}}];
  else if(statement.includes("SELECT id,metadata->>'snapshot_hash'"))rows=[{id:id(6),hash:brandHash}];
  return{rows:rows as Row[],rowCount:rows.length};}};
 return{queryable,queries};
}
async function reconciliationFixture(options:{replay?:boolean;failure?:string;drift?:boolean;safe?:boolean;sourceCurrent?:boolean;published?:boolean}={}){
 const ctx=context();const authority=await resolveSignalBrandContextAuthorityV1({queryable:ctx.queryable,workspace});ctx.queries.length=0;
 const head={id:id(5),generation_key:'semantic-context-v1',generation_version:1,status:options.published?'published':'draft',
   brand_os_profile_id:authority.brandOsProfileId,brand_os_digest:authority.brandOsDigest,
   knowledge_digest:options.drift?digest('old knowledge'):authority.knowledgeDigest,locale_context_digest:authority.localeContextDigest};
 let released=0;let target:string|null=head.id;const rows:unknown[]=[];
 const query:SignalSemanticContextQueryable['query']=async <Row extends Record<string,unknown>>(statement:string,values:unknown[]=[])=>{
  const custom=(value:unknown[])=>{ctx.queries.push({sql:statement,values});return{rows:value as Row[],rowCount:value.length};};
  if(statement.includes('begin_signal_brand_context_source_reconciliation_v1')){
   if(options.failure){ctx.queries.push({sql:statement,values});throw new Error(options.failure);}
   return custom([{value:options.replay?{replayed:true,result:saved}:{replayed:false,reconciliation_id:id(8),workspace,head}}]);
  }
  if(statement.includes('signal_brand_context_processing_source_current_v1'))return custom([{current:options.sourceCurrent??!options.drift}]);
  if(statement.includes('signal_brand_context_source_successor_safe_v1'))return custom([{safe:options.safe??true}]);
  if(statement.includes('INSERT INTO analysis_artifacts'))return custom([{id:id(9)}]);
  if(statement.includes('INSERT INTO signal_governance_control_operations')){rows.push(values);return custom([{id:id(10+rows.length)}]);}
  if(statement.includes('SET generation_id=$2'))target=values[1] as string;
  if(statement.startsWith('INSERT INTO signal_semantic_context_generations'))return custom([]);
  if(statement.trim().match(/^(INSERT|UPDATE|DELETE)/u)&&!statement.includes('signal_brand_context_source_reconciliations')
    &&!statement.includes('signal_governance_control_operations'))throw new Error(`Unexpected mutation ${statement}`);
  return ctx.queryable.query<Row>(statement,values);
 };
 const database={async connect(){return{query,release(){released++;}};}} as unknown as Pick<Pool,'connect'>;
 return{database,queries:ctx.queries,get released(){return released;},get target(){return target;}};
}

test('free reconcile replays the historical receipt before source/configuration reads',async()=>{
 const f=await reconciliationFixture({replay:true});
 assert.deepEqual(await reconcileSignalBrandContextSourceV1({...args,database:f.database,configuration:{...configuration,available:false}}),{...saved,replayed:true});
 assert.equal(f.released,1);assert.equal(f.queries.length,3);assert.match(f.queries[1]!.sql,/begin_signal/u);
 assert.equal(f.queries[2]!.sql,'COMMIT');
});
for(const failure of ['brand_context_generation_changed','brand_context_reconciliation_idempotency_conflict','brand_context_reconciliation_forbidden'])
 test(`reconcile rolls back ${failure} without source or paid writes`,async()=>{
  const f=await reconciliationFixture({failure});await assert.rejects(reconcileSignalBrandContextSourceV1({...args,database:f.database}),
    e=>e instanceof Error&&'code' in e&&e.code===failure);
  assert.equal(f.queries.at(-1)!.sql,'ROLLBACK');assert.equal(f.released,1);
  assert.ok(f.queries.every(q=>!/^\s*(INSERT|UPDATE|DELETE)/u.test(q.sql)));
 });
test('matching source is idempotent and a published generation remains the current generation',async()=>{
 const f=await reconciliationFixture({published:true});const result=await reconcileSignalBrandContextSourceV1({...args,database:f.database});
 assert.equal(result.generation_id,id(5));assert.equal(result.state,'current');
 assert.ok(f.queries.some(q=>q.sql.includes('source_current_v1')));
 assert.ok(!f.queries.some(q=>q.sql.includes('INSERT INTO signal_semantic_context_generations')));
 assert.ok(!f.queries.some(q=>q.sql.includes('INSERT INTO signal_governance_control_operations')));
});
test('matching digest fields cannot hide an invalid artifact/locale/full SQL authority',async()=>{
 const f=await reconciliationFixture({sourceCurrent:false});await assert.rejects(reconcileSignalBrandContextSourceV1({...args,database:f.database}),
  e=>e instanceof Error&&'code' in e&&e.code==='brand_context_source_stale');
 assert.equal(f.queries.at(-1)!.sql,'ROLLBACK');assert.ok(!f.queries.some(q=>q.sql.startsWith('INSERT')));
});
test('in-flight or uncertain predecessor returns awaiting settlement without a child or authorization',async()=>{
 const f=await reconciliationFixture({drift:true,safe:false});const result=await reconcileSignalBrandContextSourceV1({...args,database:f.database});
 assert.equal(result.state,'awaiting_settlement');assert.equal(result.generation_id,id(5));
 assert.ok(!f.queries.some(q=>q.sql.startsWith('INSERT')));
});
test('terminal source drift creates an empty child with fresh authority and a null-admission preparation atomically',async()=>{
 const f=await reconciliationFixture({drift:true});const result=await reconcileSignalBrandContextSourceV1({...args,database:f.database});
 assert.equal(result.state,'awaiting_authorization');assert.notEqual(result.generation_id,id(5));assert.equal(result.generation_id,f.target);
 const inserts=f.queries.filter(q=>q.sql.startsWith('INSERT INTO signal_semantic_context_generations'));
 assert.equal(inserts.length,1);assert.equal(inserts[0]!.values[5],id(5));assert.equal(inserts[0]!.values[6],'knowledge_drift');
 const prepare=f.queries.find(q=>q.sql.includes('INSERT INTO signal_governance_control_operations')&&q.values[2]==='prepare-brand-context');
 assert.ok(prepare);assert.equal(JSON.parse(prepare.values[5] as string).admission,null);
 assert.equal(JSON.parse(prepare.values[5] as string).source_reconciliation_id,id(8));
 assert.ok(!f.queries.some(q=>/^\s*(INSERT|UPDATE|DELETE)[^]*?(signal_processing_admissions|proposal_runs|budget_reservations|proposal_outbox|element_versions)/u.test(q.sql)));
 assert.equal(f.queries.at(-1)!.sql,'COMMIT');
});

test('SQL authorization is exact, locked, actor-bound, CAS-bound, private and commit-complete',()=>{
 const access=body('signal_brand_context_source_editor_v1');
 for(const expected of ["u.user_type='client'","u.primary_role='client_admin'","a.access_level IN('comment','admin')",
  "a.revoked_at IS NULL","o.status='active'","b.organization_id=w.organization_id"])assert.ok(access.includes(expected));
 const begin=body('begin_signal_brand_context_source_reconciliation_v1');
 assert.match(begin,/READ|read committed/u);assert.match(begin,/FOR SHARE OF u,scope,b,o/u);assert.match(begin,/FOR SHARE OF a/u);
 assert.ok(begin.indexOf("IF prior.id IS NOT NULL")<begin.indexOf('head.id IS DISTINCT FROM expected_generation'));
 for(const expected of ['request_digest<>request_hash',"'actor_user_id',target_actor","'expected_generation_id',expected_generation"])
  assert.ok(begin.includes(expected));
 assert.match(sql,/DEFERRABLE INITIALLY DEFERRED/u);assert.match(sql,/REVOKE ALL ON signal_brand_context_source_reconciliations/u);
 assert.match(sql,/REVOKE ALL ON FUNCTION/u);assert.doesNotMatch(sql,/SECURITY DEFINER|GRANT /u);
});
test('source guards cover reserve/send only; no paid result persistence or settlement is blocked',()=>{
 const guard=body('signal_brand_context_source_send_guard_v1');
 assert.match(guard,/OLD.provider_call_state='not_started' AND NEW.provider_call_state='in_flight'/u);
 assert.match(guard,/OLD.status='reserved' AND NEW.status='in_flight'/u);
 assert.match(guard,/NEW.status<>'reserved'/u);assert.match(guard,/signal_brand_context_processing_source_current_v1/u);
 assert.doesNotMatch(guard,/response_persisted|settled|UPDATE signal_|INSERT INTO/u);
  const safe=body('signal_brand_context_source_successor_safe_v1');
  for(const expected of ["r.provider_call_state NOT IN('not_started','settled')",'r.lease_token IS NOT NULL',"b.status NOT IN('released','settled')",
  "q.status NOT IN('completed','dead_letter')",'r.provider_call_count<>0',"r.status='failed' AND r.appended_operation_id IS NULL",
  'r.validated_output_digest IS NULL',"run.status NOT IN('completed','failed','canceled','stale')",'run.execution_token IS NOT NULL',
  "call.status NOT IN('settled','definitely_not_sent')",'receipt.generation_id=target_generation'])assert.ok(safe.includes(expected));
 const complete=body('complete_signal_brand_context_source_reconciliation_v1');
 assert.match(complete,/EXISTS\(SELECT 1 FROM signal_semantic_context_element_versions/u);
 assert.match(complete,/op.brand_context_preparation->'admission'='null'::jsonb/u);
});

async function processorFixture(mode:'precheck'|'sql-trigger'|'paid'|'lease-race'|'prepared-drift'){
 const ctx=context();const authority=await resolveSignalBrandContextAuthorityV1({queryable:ctx.queryable,workspace});
 const generation={id:id(5),generation_key:'semantic-context-v1',status:'draft',brand_os_profile_id:authority.brandOsProfileId,
  brand_os_digest:authority.brandOsDigest,knowledge_digest:authority.knowledgeDigest,locale_context_digest:authority.localeContextDigest,
  primary_locale:authority.primaryLocale,locale_variants:authority.localeVariants,markets:authority.markets,timezone:authority.timezone};
 const genQuery:SignalSemanticContextQueryable={async query<Row extends Record<string,unknown>>(statement:string,values:unknown[]=[]){
  if(statement.includes('FROM signal_semantic_context_generations'))return{rows:[generation] as unknown as Row[],rowCount:1};
  return ctx.queryable.query<Row>(statement,values);
 }};
 const prepared=await prepareSignalSemanticContextProposalInputV1({queryable:genQuery,workspace:{id:workspace.id,
  organization_id:workspace.organizationId,brand_id:workspace.subject.id},generation_key:generation.generation_key});
 ctx.queries.length=0;
 let run={id:id(7),workspace_id:workspace.id,generation_id:id(5),context_input_digest:mode==='prepared-drift'?digest('stale prepared input'):prepared.input_digest,
  max_output_tokens:prepared.capacity.output_token_budget,brand_os_digest:authority.brandOsDigest,knowledge_digest:authority.knowledgeDigest,
  locale_context_digest:authority.localeContextDigest,status:'queued',provider_call_state:mode==='paid'?'response_persisted':'not_started',
  processing_admission_id:id(12),brand_context_preparation_operation_id:null,provider_call_count:mode==='paid'?1:0,
  provider_response_private:mode==='paid'?'PAID_RESPONSE':null,attempt_count:0,lease_token:null as string|null,lease_expires_at:null};
 let connections=0,releases=0,calls=0,reservation='reserved',outbox='dispatched';
 const query:SignalSemanticContextQueryable['query']=async <Row extends Record<string,unknown>>(statement:string,values:unknown[]=[])=>{
  ctx.queries.push({sql:statement,values});let rows:unknown[]=[];
  if(statement.includes('gen_random_uuid()::text token'))rows=[{token:id(13)}];
  else if(statement.includes('FROM signal_semantic_context_proposal_runs run')){
   if(mode==='paid'&&connections===2)throw new Error('reached-paid-finish');
   if(mode==='lease-race'&&connections===3)run={...run,provider_call_state:'in_flight',provider_call_count:1};
   rows=[run];
  }else if(statement.includes('FROM signal_workspaces workspace'))rows=[{id:workspace.id,organization_id:workspace.organizationId,
    brand_id:workspace.subject.id,generation_key:generation.generation_key}];
  else if(statement.includes('source_current_v1'))rows=[{stale:mode!=='sql-trigger'}];
  else if(statement.includes("provider_call_state='in_flight',provider_call_count=1")){
   if(mode==='sql-trigger')throw Object.assign(new Error('brand_context_source_stale'),{code:'23514'});
   throw new Error('unexpected provider start');
  }else if(statement.includes('SET status=CASE'))run={...run,lease_token:id(13),status:'processing'};
  else if(statement.includes("proposal_runs SET status='stale'"))run={...run,status:'stale'};
  else if(statement.includes("budget_reservations SET status='released'"))reservation='released';
  else if(statement.includes("proposal_outbox SET status='completed'"))outbox='completed';
  else if(statement.includes('FROM signal_semantic_context_generations'))rows=[generation];
  else if(statement.trim().match(/^(SELECT|WITH)/u))return genQuery.query<Row>(statement,values);
  return{rows:rows as Row[],rowCount:1};
 };
 const pool={async connect(){connections++;return{query,release(){releases++;}};}} as unknown as Pick<Pool,'connect'>;
 return{queries:ctx.queries,async process(){return processSignalSemanticContextProposalRunV1({pool,run_id:id(7),provider:{async generate(){calls++;throw new Error('no transport permitted');}}});},
  state(){return{calls,reservation,outbox,status:run.status,releases,connections};}};
}
for(const mode of ['precheck','sql-trigger'] as const)test(`source changed after prepared commit: ${mode} closes stale before transport`,async()=>{
 const f=await processorFixture(mode);assert.equal((await f.process()).status,'stale');
 assert.deepEqual(f.state(),{calls:0,reservation:'released',outbox:'completed',status:'stale',releases:3,connections:3});
 const statements=f.queries.map(q=>q.sql);const fence=statements.findIndex(q=>q.includes('source_current_v1'));
 assert.ok(statements.slice(0,fence).includes('COMMIT'));assert.ok(statements.slice(fence).includes('ROLLBACK'));
});
test('paid response recovery never checks new-send authority or releases a paid reservation',async()=>{
 const f=await processorFixture('paid');await assert.rejects(f.process(),/reached-paid-finish/u);
 assert.equal(f.state().calls,0);assert.equal(f.state().reservation,'reserved');
 assert.ok(!f.queries.some(q=>q.sql.includes('source_current_v1')));
});
test('DNC cleanup cannot release a reservation after ownership or send state changed',async()=>{
 const f=await processorFixture('lease-race');await assert.rejects(f.process(),e=>e instanceof Error&&'code'in e&&e.code==='semantic_context_proposal_lease_lost');
 assert.equal(f.state().calls,0);assert.equal(f.state().reservation,'reserved');assert.equal(f.state().outbox,'dispatched');
});


test('only edited global KB invalidates its old upload hash; corpus hashes and no-op edits stay intact',()=>{
 const invalidate=body('invalidate_signal_brand_context_knowledge_hash_v1');
 assert.match(invalidate,/NEW.study_corpus_id IS NULL/u);
 assert.match(invalidate,/ROW\(NEW.raw_text,NEW.extracted_payload,NEW.source_kind\)[^]*IS DISTINCT FROM ROW\(OLD.raw_text,OLD.extracted_payload,OLD.source_kind\)/u);
 assert.match(invalidate,/NEW.file_hash:=NULL/u);assert.doesNotMatch(invalidate,/UPDATE |INSERT |DELETE /u);
 assert.match(sql,/BEFORE UPDATE OF raw_text,extracted_payload,source_kind\s+ON brand_knowledge_sources/u);
});
test('after edited KB invalidates its file hash, live authority uses new content rather than the old upload identity',async()=>{
 const ctx=context();const oldFileHash=digest('original upload'),newContentHash=digest('edited KB payload');
 let fileHash:string|null=oldFileHash;
 const queryable:SignalSemanticContextQueryable={async query<Row extends Record<string,unknown>>(statement:string,values:unknown[]=[]){
   if(statement.includes('source.updated_at'))return{rows:[{id:id(20),source_kind:'brand_brief',
     file_hash:fileHash,content_digest:newContentHash}] as unknown as Row[],rowCount:1};
   return ctx.queryable.query<Row>(statement,values);
 }};
 const before=await resolveSignalBrandContextAuthorityV1({queryable,workspace});
 fileHash=null; // The exact SQL trigger above supplies the post-edit database row.
 const after=await resolveSignalBrandContextAuthorityV1({queryable,workspace});
 assert.notEqual(after.knowledgeDigest,before.knowledgeDigest);assert.notEqual(after.sourceAuthorityDigest,before.sourceAuthorityDigest);
 assert.equal(after.knowledgeDigest,digest({sources:[{id:id(20),kind:'brand_brief',digest:newContentHash}],chunks:[]}));
 const currentSql=readFileSync(new URL('./migrations/0156_signal_brand_context_composed_admission.sql',import.meta.url),'utf8');
 assert.match(currentSql,/CASE WHEN COALESCE\(source.file_hash,''\)~[^]*ELSE\s*'sha256:'\|\|encode\(digest\(COALESCE\(source.raw_text/u);
 assert.match(currentSql,/RETURN current_knowledge=generation.knowledge_digest/u);
});

test('drift found during prepared validation also releases its transaction client',async()=>{
 const f=await processorFixture('prepared-drift');assert.equal((await f.process()).status,'stale');
 assert.deepEqual(f.state(),{calls:0,reservation:'released',outbox:'completed',status:'stale',releases:1,connections:1});
});
