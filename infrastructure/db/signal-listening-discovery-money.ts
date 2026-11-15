import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {LISTENING_DISCOVERY_POLICY_V1,listeningDiscoveryPolicyDigestV1,listeningDiscoveryPopulationDigestV1,
 buildListeningDiscoveryEvidenceV1,buildListeningDiscoveryEditorialRequestV1,applyListeningDiscoveryEditorialOutputV1,
 decideListeningDiscoveryStopV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type ListeningDiscoveryRootV1,type ListeningDiscoveryOrphanGroupV1} from '@noisia/query-engine';
import {authorizeSignalListeningV1,listeningTransactionV1,loadSignalListeningConfigurationWithClientV1,
 saveSignalListeningConfigurationV1,listeningFailV1,type SignalListeningAccessV1} from './signal-listening-configuration';
import {getSignalListeningDiscoveryGenerationV1,readSignalListeningDiscoveryRootsV1,refreshSignalListeningDiscoveryV1,
 type ListeningDiscoveryGenerationV1} from './signal-listening-discovery';
import {admitSignalProcessingWithClientV1} from './signal-processing-policy';
import {mapCurrent} from './signal-mass-labeling';
import {prepareSignalListeningV1,type SignalListeningPreparationV1} from './signal-listening-preparation';

function fail(code:string,status=409):never{return listeningFailV1(code,status);}
const sha=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
const number=(v:unknown)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0)fail('listening_discovery_count_invalid',503);return n;};
export type ListeningDiscoveryExecutionV1={id:string;workspace_id:string;organization_id:string;actor_user_id:string;map_id:string;
 initial_configuration_id:string;initial_generation_id:string;initial_classification_run_id:string;initial_preparation_id:string|null;
 policy_version_id:string;root_census_digest:string;root_count:number;cap_micro_usd:string;status:'active'|'completed'|'failed'|'stale'|'outcome_unknown'};
export type ListeningDiscoveryRoundV1={id:string;workspace_id:string;execution_id:string;ordinal:number;input_generation_id:string;configuration_id:string;
 request_body:string;request_digest:string;request_sha256:string;source_digest:string;population_digest:string;reservation_micro_usd:string;
 admission_id:string;status:'queued'|'reviewing'|'reviewed'|'classifying'|'completed'|'failed'|'stale'|'outcome_unknown';execution_token:string|null;
 output_configuration_id:string|null;classification_preparation_id:string|null;classification_run_id:string|null;output_generation_id:string|null;
 planned_child_cap_micro_usd:string|null;stop_decision:{stop:boolean;reason:string}|null};
export type ListeningDiscoveryLeaseV1={round_id:string;workspace_id:string;execution_token:string;request_body:string;recovery_only:boolean};
export type ListeningDiscoveryCallV1={id:string;workspace_id:string;listening_round_id:string;attempt_token:string;request_digest:string;
 call_state:'reserved'|'in_flight'|'response_persisted'|'settled'|'outcome_unknown'|'definitely_not_sent';reserved_micro_usd:string;
 settled_micro_usd:string|null;response_sha256:string|null;response_storage_key:string|null;metadata:Record<string,unknown>};
/** Storage must durably write and read back the exact wrapper, including all provider bytes. */
export type ListeningDiscoveryRawStoreV1={reference(a:{workspace_id:string;round_id:string;call_id:string;name:string;raw_sha256:string;size_bytes:number}):{storage_key:string};store(a:{workspace_id:string;round_id:string;call_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number}):Promise<{storage_key:string;sha256:string;size_bytes:number;verified:true}>;
 load(a:{storage_key:string;sha256:string;size_bytes:number}):Promise<string>};
export type ListeningDiscoveryOrphanManifestV1=ListeningDiscoveryOrphanGroupV1&{root_ids:string[]};
async function policyLock(c:PoolClient,workspace:string){
 const p=(await c.query<{id:string;organization_id:string;budget_timezone:string;configuration:unknown;max_execution_micro_usd:string|null}>(`SELECT p.id,p.organization_id,p.budget_timezone,a.configuration,a.max_execution_micro_usd::text
 FROM signal_workspaces w JOIN signal_processing_policy_versions p ON p.organization_id=w.organization_id AND p.status='active' AND p.valid_from<=clock_timestamp() AND p.valid_until>clock_timestamp()
 JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id AND a.action='listening_discovery_review' WHERE w.id=$1 AND a.configuration=signal_listening_discovery_review_configuration_v1()`,[workspace])).rows[0];
 if(!p)return fail('listening_discovery_policy_unavailable');
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[p.organization_id]);
 await c.query('SELECT signal_processing_lock_v1($1,(clock_timestamp() AT TIME ZONE $2)::date)',[p.organization_id,p.budget_timezone]);return p;
}
async function moneyLock(c:PoolClient,roundId:string){
 const a=(await c.query<{organization_id:string;budget_date:string}>(`SELECT a.organization_id,a.budget_date::text FROM signal_listening_discovery_rounds r JOIN signal_processing_admissions a ON a.id=r.admission_id WHERE r.id=$1`,[roundId])).rows[0];
 if(!a)return fail('listening_discovery_round_unavailable');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[a.organization_id]);await c.query('SELECT signal_processing_lock_v1($1,$2::date)',[a.organization_id,a.budget_date]);
}
async function lockedLease(c:PoolClient,lease:ListeningDiscoveryLeaseV1){
 const r=(await c.query<ListeningDiscoveryRoundV1>(`SELECT * FROM signal_listening_discovery_rounds WHERE id=$1 AND workspace_id=$2 AND execution_token=$3 AND execution_expires_at>clock_timestamp() FOR UPDATE`,[lease.round_id,lease.workspace_id,lease.execution_token])).rows[0];
 if(!r)return fail('listening_discovery_lease_lost');return r;
}
async function owner(c:PoolClient,args:SignalListeningAccessV1,id:string){
 const p=(await c.query<ListeningDiscoveryExecutionV1>('SELECT * FROM signal_listening_discovery_executions WHERE id=$1 AND workspace_id=$2 AND actor_user_id=$3',[id,args.workspace_id,args.actor_user_id])).rows[0];
 if(!p)return fail('listening_discovery_execution_unavailable');return p;
}
export async function startSignalListeningDiscoveryExecutionV1(args:SignalListeningAccessV1&{generation_id:string;classification_run_id:string;preparation_id?:string;cap_micro_usd:number;idempotency_key:string}){
 if(!Number.isSafeInteger(args.cap_micro_usd)||args.cap_micro_usd<=0||!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))fail('listening_discovery_request_invalid',422);
 return listeningTransactionV1(args.database,async c=>{
  const policy=await policyLock(c,args.workspace_id);await authorizeSignalListeningV1(c,args,'process');if(policy.max_execution_micro_usd!==null&&args.cap_micro_usd>number(policy.max_execution_micro_usd))fail('listening_discovery_policy_cap_exceeded');
  const g=(await c.query<ListeningDiscoveryGenerationV1>("SELECT * FROM signal_listening_discovery_generations WHERE id=$1 AND workspace_id=$2 AND status='ready'",[args.generation_id,args.workspace_id])).rows[0];
  if(!g)fail('listening_discovery_generation_unavailable');await mapCurrent(c,args.workspace_id,g.map_id);
  const cfg=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,g.configuration_id);if(!cfg)fail('listening_discovery_configuration_unavailable');
  const preparation_id=(await c.query<{id:string}>('SELECT id FROM signal_listening_preparations WHERE workspace_id=$1 AND listening_run_id=$2',[args.workspace_id,args.classification_run_id])).rows[0]?.id??null;if(args.preparation_id&&args.preparation_id!==preparation_id)fail('listening_discovery_preparation_invalid');
  const request_digest=digest({contract_version:'listening-discovery-execution-v1',generation_id:g.id,classification_run_id:args.classification_run_id,preparation_id,cap_micro_usd:args.cap_micro_usd});
  const old=(await c.query<ListeningDiscoveryExecutionV1&{request_digest:string}>('SELECT * FROM signal_listening_discovery_executions WHERE workspace_id=$1 AND actor_user_id=$2 AND idempotency_key=$3',[args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
  if(old){if(old.request_digest!==request_digest)fail('listening_discovery_idempotency_conflict');return old;}
  const row=(await c.query<ListeningDiscoveryExecutionV1>(`INSERT INTO signal_listening_discovery_executions(workspace_id,organization_id,actor_user_id,map_id,initial_configuration_id,initial_generation_id,
   initial_preparation_id,initial_classification_run_id,policy_version_id,configuration,configuration_digest,policy,policy_digest,root_census_digest,root_count,cap_micro_usd,idempotency_key,request_digest)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,signal_listening_discovery_census_v1($6),$14,$15,$16,$17) RETURNING *`,
   [args.workspace_id,policy.organization_id,args.actor_user_id,g.map_id,cfg.id,g.id,preparation_id,args.classification_run_id,policy.id,JSON.stringify(cfg.configuration),cfg.configuration_digest,
    JSON.stringify(LISTENING_DISCOVERY_POLICY_V1),listeningDiscoveryPolicyDigestV1(LISTENING_DISCOVERY_POLICY_V1),g.counts.roots,args.cap_micro_usd,args.idempotency_key,request_digest])).rows[0]!;
  await c.query('INSERT INTO signal_listening_discovery_children(execution_id,workspace_id,run_id,preparation_id) VALUES($1,$2,$3,$4)',[row.id,row.workspace_id,args.classification_run_id,preparation_id]);
  if(number((await c.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[row.id])).rows[0].n)>args.cap_micro_usd)fail('listening_discovery_parent_cap_exhausted');return row;
 });
}
async function nativeRequest(args:SignalListeningAccessV1&{generation_id:string;ordinal:number;orphan_groups:ListeningDiscoveryOrphanManifestV1[]}){
 const g=await getSignalListeningDiscoveryGenerationV1(args);if(!g)fail('listening_discovery_generation_unavailable');
 const cfg=await listeningTransactionV1(args.database,c=>loadSignalListeningConfigurationWithClientV1(c,args.workspace_id,g.configuration_id));if(!cfg)fail('listening_discovery_configuration_unavailable');
 const roots:ListeningDiscoveryRootV1[]=[],texts=new Map<string,{root_id:string;text:string;source_text_sha256:string}>();let cursor:string|undefined;
 for(;;){const page=await readSignalListeningDiscoveryRootsV1({...args,after_root_id:cursor,limit:1024});
  for(const r of page.roots){const p=r.proof as {source_text_sha256:string;in_category:boolean|null;evaluations:Array<{question_key:string;probability:number|null}>};
   if(!r.vector||p.in_category===null||p.evaluations.some(e=>e.probability===null))fail('listening_discovery_classification_incomplete');
   roots.push({root_id:r.root_id,input_sha256:p.source_text_sha256,in_category:p.in_category,vector:r.vector,evaluations:p.evaluations.map(e=>({topic_key:e.question_key,probability:e.probability!}))});
   texts.set(r.root_id,{root_id:r.root_id,text:r.text,source_text_sha256:p.source_text_sha256});
  }if(page.roots.length<1024)break;cursor=page.next_root_id!;
 }
 const evidence=buildListeningDiscoveryEvidenceV1({workspace_id:args.workspace_id,vector_space_digest:g.embedding_config_digest,map_digest:cfg.configuration_digest,round:args.ordinal,
  expected_population_digest:listeningDiscoveryPopulationDigestV1(roots),expected_root_count:g.counts.roots!,topic_keys:cfg.configuration.questions.filter(q=>q.topic_source).map(q=>q.key),roots,policy:LISTENING_DISCOVERY_POLICY_V1});
 const orphanIds=new Set(evidence.orphan_root_ids),usedIds=new Set<string>();
 for(const group of args.orphan_groups){if(group.root_ids.length!==group.root_count||new Set(group.root_ids).size!==group.root_ids.length||group.root_ids.some(id=>!orphanIds.has(id)||usedIds.has(id))||group.representative_root_ids.some(id=>!group.root_ids.includes(id)))fail('listening_discovery_orphan_manifest_invalid');for(const id of group.root_ids)usedIds.add(id);}
 const used=new Set(evidence.topics.flatMap(t=>[...t.accepted_examples,...t.rejected_examples]).concat(args.orphan_groups.flatMap(g=>g.representative_root_ids)));
 const groups=args.orphan_groups.map(({root_ids:_,...g})=>g);
 const request=buildListeningDiscoveryEditorialRequestV1({configuration:cfg.configuration,evidence,orphan_groups:groups,excerpts:[...used].map(id=>texts.get(id)!)});
 return{request,g,cfg};
}
export async function quoteSignalListeningDiscoveryRoundV1(args:SignalListeningAccessV1&{generation_id:string;ordinal:number;orphan_groups:ListeningDiscoveryOrphanManifestV1[]}){
 const {request,g}=await nativeRequest(args);const input_token_upper_bound=Buffer.byteLength(request.request_body)+4096;if(input_token_upper_bound+64000>1000000)fail('listening_discovery_context_bound_exceeded',422);return{contract_version:'listening-discovery-review-quote-v1' as const,generation_id:g.id,source_digest:g.snapshot_digest,request_digest:request.request_digest,input_token_upper_bound,maximum_output_tokens:64000,reservation_micro_usd:input_token_upper_bound*6+64000*15};
}
export async function enqueueSignalListeningDiscoveryRoundV1(args:SignalListeningAccessV1&{execution_id:string;generation_id:string;orphan_groups:ListeningDiscoveryOrphanManifestV1[];provider_available:boolean}){
 if(!args.provider_available)fail('listening_discovery_provider_unavailable',503);
 const current=await listeningTransactionV1(args.database,async c=>{await authorizeSignalListeningV1(c,args,'process');const p=await owner(c,args,args.execution_id);
  const last=(await c.query<ListeningDiscoveryRoundV1>('SELECT * FROM signal_listening_discovery_rounds WHERE execution_id=$1 ORDER BY ordinal DESC LIMIT 1',[p.id])).rows[0];return{p,last};});
 if(current.last&&current.last.status!=='completed'){if(current.last.input_generation_id!==args.generation_id)fail('listening_discovery_round_active');return current.last;}
 const ordinal=(current.last?.ordinal??0)+1;if(ordinal>3)fail('listening_discovery_max_rounds');
 const built=await nativeRequest({...args,ordinal});
 return listeningTransactionV1(args.database,async c=>{
  const policy=await policyLock(c,args.workspace_id);await authorizeSignalListeningV1(c,args,'process');const p=await owner(c,args,args.execution_id);
  if(p.policy_version_id!==policy.id)fail('listening_discovery_policy_changed');await mapCurrent(c,args.workspace_id,p.map_id);
  const id=randomUUID(),reservation=(Buffer.byteLength(built.request.request_body)+4096)*6+64000*15;
  const row=(await c.query<ListeningDiscoveryRoundV1>(`INSERT INTO signal_listening_discovery_rounds(id,workspace_id,execution_id,ordinal,input_generation_id,configuration_id,configuration,configuration_digest,
   request_body,request_digest,request_sha256,source_digest,population_digest,quote,reservation_micro_usd)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,signal_listening_discovery_census_v1($5),$13::jsonb,$14) RETURNING *`,
   [id,args.workspace_id,p.id,ordinal,built.g.id,built.cfg.id,JSON.stringify(built.cfg.configuration),built.cfg.configuration_digest,built.request.request_body,built.request.request_digest,sha(built.request.request_body),built.g.snapshot_digest,
    JSON.stringify({contract_version:'listening-discovery-review-quote-v1',input_token_upper_bound:Buffer.byteLength(built.request.request_body)+4096,maximum_output_tokens:64000,reservation_micro_usd:reservation,pricing:policy.configuration,orphan_groups:args.orphan_groups}),reservation])).rows[0]!;
  const admitted=await admitSignalProcessingWithClientV1(c,{...args,action:'listening_discovery_review',target_id:id,idempotency_key:'listening-round:'+id,request_digest:row.request_digest,execution_cap_micro_usd:String(reservation),automatic:false});
  await c.query('UPDATE signal_listening_discovery_rounds SET admission_id=$2 WHERE id=$1',[id,admitted.receipt.id]);return{...row,admission_id:admitted.receipt.id};
 });
}
export async function claimSignalListeningDiscoveryRoundV1(args:{database:SignalListeningAccessV1['database'];round_id:string}):Promise<ListeningDiscoveryLeaseV1|null>{
 return listeningTransactionV1(args.database,async c=>{
  await moneyLock(c,args.round_id);
  const r=(await c.query<ListeningDiscoveryRoundV1>(`SELECT * FROM signal_listening_discovery_rounds WHERE id=$1 AND status IN('queued','reviewing','outcome_unknown','reviewed','classifying')
   AND(execution_token IS NULL OR execution_expires_at<=clock_timestamp()) FOR UPDATE SKIP LOCKED`,[args.round_id])).rows[0];if(!r)return null;
  const call=(await c.query<ListeningDiscoveryCallV1>('SELECT * FROM engine_cost_events WHERE listening_round_id=$1',[r.id])).rows[0];
  const raw=(await c.query<{verification_status:string}>('SELECT verification_status FROM signal_listening_discovery_raw_receipts WHERE call_id=$1',[call?.id??null])).rows[0];
  if(call&&['in_flight','outcome_unknown'].includes(call.call_state)&&raw?.verification_status!=='planned'){
   if(call.call_state==='in_flight')await c.query("UPDATE engine_cost_events SET call_state='outcome_unknown',metadata=metadata||'{\"error_code\":\"listening_discovery_lease_expired_after_send\"}'::jsonb WHERE id=$1",[call.id]);
   await c.query("UPDATE signal_listening_discovery_rounds SET status='outcome_unknown',execution_token=NULL,execution_expires_at=NULL,error_code='listening_discovery_lease_expired_after_send' WHERE id=$1",[r.id]);return null;
  }
  const token=randomUUID();await c.query(`UPDATE signal_listening_discovery_rounds SET status=CASE WHEN status='queued' THEN 'reviewing' ELSE status END,
   execution_token=$2,execution_expires_at=clock_timestamp()+interval '300 seconds' WHERE id=$1`,[r.id,token]);
  return{round_id:r.id,workspace_id:r.workspace_id,execution_token:token,request_body:r.request_body,recovery_only:!!call&&call.call_state!=='reserved'};
 });
}
export async function reserveSignalListeningDiscoveryCallV1(args:{database:SignalListeningAccessV1['database'];lease:ListeningDiscoveryLeaseV1;provider_available:boolean}){
 return listeningTransactionV1(args.database,async c=>{
  const scope=(await c.query<{execution_id:string}>('SELECT execution_id FROM signal_listening_discovery_rounds WHERE id=$1',[args.lease.round_id])).rows[0];if(!scope)fail('listening_discovery_round_unavailable');
  const p=(await c.query<ListeningDiscoveryExecutionV1>('SELECT * FROM signal_listening_discovery_executions WHERE id=$1',[scope.execution_id])).rows[0]!;
  const old=(await c.query<ListeningDiscoveryCallV1>('SELECT * FROM engine_cost_events WHERE listening_round_id=$1',[args.lease.round_id])).rows[0];
  if(old){await moneyLock(c,args.lease.round_id);const r=await lockedLease(c,args.lease);if(old.call_state==='reserved')await c.query("UPDATE engine_cost_events SET metadata=jsonb_set(metadata,'{lease_token}',to_jsonb($2::text)) WHERE id=$1",[old.id,r.execution_token]);return old;}
  if(!args.provider_available)fail('listening_discovery_provider_unavailable',503);
  await policyLock(c,p.workspace_id);const r=await lockedLease(c,args.lease);
  return(await c.query<ListeningDiscoveryCallV1>(`INSERT INTO engine_cost_events(workspace_contract,workspace_id,listening_round_id,actor_user_id,provider,model,operation,idempotency_key,request_digest,request_seal,call_configuration,call_state,
   attempt_token,reserved_micro_usd,budget_date,budget_timezone,budget_daily_cap_micro_usd,metadata)
   SELECT 'listening-discovery-round-v1',r.workspace_id,r.id,p.actor_user_id,'anthropic','claude-sonnet-4-6','listening-discovery-review','listening-round:'||r.id::text,
   r.request_digest,r.request_sha256,signal_listening_discovery_review_configuration_v1(),'reserved',gen_random_uuid(),r.reservation_micro_usd,a.budget_date,a.budget_timezone,policy.daily_cap_micro_usd,jsonb_build_object('lease_token',r.execution_token)
   FROM signal_listening_discovery_rounds r JOIN signal_listening_discovery_executions p ON p.id=r.execution_id JOIN signal_processing_admissions a ON a.id=r.admission_id JOIN signal_processing_policy_versions policy ON policy.id=a.policy_version_id WHERE r.id=$1 RETURNING *`,[r.id])).rows[0]!;
 });
}
export async function markSignalListeningDiscoveryCallSentV1(args:{database:SignalListeningAccessV1['database'];lease:ListeningDiscoveryLeaseV1;call_id:string;attempt_token:string;provider_available:boolean}){
 if(!args.provider_available)fail('listening_discovery_provider_unavailable',503);
 return listeningTransactionV1(args.database,async c=>{await moneyLock(c,args.lease.round_id);await lockedLease(c,args.lease);
  return(await c.query(`UPDATE engine_cost_events SET call_state='in_flight',sent_at=clock_timestamp() WHERE id=$1 AND listening_round_id=$2 AND workspace_id=$3 AND attempt_token=$4 AND call_state='reserved' RETURNING id`,[args.call_id,args.lease.round_id,args.lease.workspace_id,args.attempt_token])).rows.length===1;});
}
export async function persistSignalListeningDiscoveryRawV1(args:{database:SignalListeningAccessV1['database'];call_id:string;attempt_token:string;raw_text:string;raw_store:ListeningDiscoveryRawStoreV1}){
 const call=(await args.database.query<ListeningDiscoveryCallV1>("SELECT * FROM engine_cost_events WHERE id=$1 AND attempt_token=$2 AND workspace_contract='listening-discovery-round-v1'",[args.call_id,args.attempt_token])).rows[0];if(!call)fail('listening_discovery_call_unavailable');
 const bytes=Buffer.from(args.raw_text,'utf8');if(bytes.length>8388608||bytes.toString('utf8')!==args.raw_text)fail('listening_discovery_raw_invalid',422);
 let wrapper:{body:string;http_status:number;provider_request_id?:string|null};try{wrapper=JSON.parse(args.raw_text);}catch{return fail('listening_discovery_raw_invalid',422);}
 if(typeof wrapper.body!=='string'||!Number.isInteger(wrapper.http_status)||wrapper.http_status<100||wrapper.http_status>599||wrapper.provider_request_id!=null&&(typeof wrapper.provider_request_id!=='string'||wrapper.provider_request_id.length>200))fail('listening_discovery_raw_invalid',422);
 const hash=sha(args.raw_text),input={workspace_id:call.workspace_id,round_id:call.listening_round_id,call_id:call.id,name:'review-'+hash.slice(7)+'.json',raw_text:args.raw_text,raw_sha256:hash,size_bytes:bytes.length};
 const reference=args.raw_store.reference(input);if(!reference.storage_key.startsWith('workspace-engine/'+call.workspace_id+'/'+call.listening_round_id+'/'))fail('listening_discovery_storage_invalid');
 const planned=await listeningTransactionV1(args.database,async c=>{await moneyLock(c,call.listening_round_id);
  const old=(await c.query<{raw_text:string;raw_sha256:string;storage_key:string;verification_status:string}>('SELECT * FROM signal_listening_discovery_raw_receipts WHERE call_id=$1',[call.id])).rows[0];
  if(old){if(old.raw_text!==args.raw_text||old.raw_sha256!==hash||old.storage_key!==reference.storage_key)fail('listening_discovery_receipt_conflict');return old.verification_status;}
  await c.query(`INSERT INTO signal_listening_discovery_raw_receipts(call_id,workspace_id,round_id,attempt_token,request_digest,raw_text,raw_sha256,size_bytes,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[call.id,call.workspace_id,call.listening_round_id,call.attempt_token,call.request_digest,args.raw_text,hash,bytes.length,reference.storage_key]);return 'planned';
 });
 if(planned==='verified'){
  const raw=await args.raw_store.load({storage_key:reference.storage_key,sha256:hash,size_bytes:bytes.length});if(raw!==args.raw_text||sha(raw)!==hash)fail('listening_discovery_storage_checksum_invalid');return{call_id:call.id,replayed:true};
 }
 const stored=await args.raw_store.store(input);
 if(!stored.verified||stored.sha256!==hash||stored.size_bytes!==bytes.length||stored.storage_key!==reference.storage_key)fail('listening_discovery_storage_invalid');
 const actual=await args.raw_store.load(stored);if(actual!==args.raw_text||sha(actual)!==hash)fail('listening_discovery_storage_checksum_invalid');
 return listeningTransactionV1(args.database,async c=>{await moneyLock(c,call.listening_round_id);
  const intent=(await c.query<{verification_status:string}>('SELECT verification_status FROM signal_listening_discovery_raw_receipts WHERE call_id=$1 FOR UPDATE',[call.id])).rows[0];
  if(intent?.verification_status==='verified')return{call_id:call.id,replayed:true};
  await c.query("UPDATE signal_listening_discovery_raw_receipts SET verification_status='verified',verified_at=clock_timestamp() WHERE call_id=$1",[call.id]);
  await c.query(`UPDATE engine_cost_events SET call_state=$3,response_storage_key=$4,response_sha256=$5,response_size_bytes=$6,response_http_status=$7,provider_request_id=$8,response_received_at=clock_timestamp()
   WHERE id=$1 AND attempt_token=$2`,[call.id,call.attempt_token,wrapper.http_status===200?'response_persisted':'outcome_unknown',stored.storage_key,hash,bytes.length,wrapper.http_status,wrapper.provider_request_id??null]);
  if(wrapper.http_status!==200){await c.query("UPDATE signal_listening_discovery_rounds SET status='outcome_unknown',error_code='listening_discovery_transport_unknown',execution_token=NULL,execution_expires_at=NULL WHERE id=$1",[call.listening_round_id]);await c.query("UPDATE signal_listening_discovery_executions SET status='outcome_unknown',error_code='listening_discovery_transport_unknown' WHERE id=(SELECT execution_id FROM signal_listening_discovery_rounds WHERE id=$1)",[call.listening_round_id]);}
  return{call_id:call.id,replayed:false};});
}
/** Only measured usage from the immutable raw wrapper settles money. Zero-usage HTTP errors remain unknown. */
export async function settleSignalListeningDiscoveryCallV1(args:{database:SignalListeningAccessV1['database'];call_id:string;attempt_token:string}){
 return listeningTransactionV1(args.database,async c=>{
  const call=(await c.query<ListeningDiscoveryCallV1>("SELECT * FROM engine_cost_events WHERE id=$1 AND attempt_token=$2 AND workspace_contract='listening-discovery-round-v1'",[args.call_id,args.attempt_token])).rows[0];if(!call)fail('listening_discovery_call_unavailable');
  await moneyLock(c,call.listening_round_id);const current=(await c.query<ListeningDiscoveryCallV1>('SELECT * FROM engine_cost_events WHERE id=$1 AND attempt_token=$2 FOR UPDATE',[call.id,call.attempt_token])).rows[0];if(!current)fail('listening_discovery_call_unavailable');Object.assign(call,current);if(call.call_state==='settled')return{cost_micro_usd:number(call.settled_micro_usd),replayed:true};
  const raw=(await c.query<{raw_text:string}>('SELECT raw_text FROM signal_listening_discovery_raw_receipts WHERE call_id=$1',[call.id])).rows[0];
  if(!raw||call.call_state!=='response_persisted')return{unresolved:true as const};
  let body:{model:string;usage:Record<string,unknown>};try{body=JSON.parse((JSON.parse(raw.raw_text) as {body:string}).body);}catch{await c.query("UPDATE engine_cost_events SET call_state='outcome_unknown',metadata=metadata||'{\"error_code\":\"listening_discovery_usage_invalid\"}'::jsonb WHERE id=$1",[call.id]);return{unresolved:true as const};}
  const u=body.usage as {input_tokens:number;output_tokens:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number;cache_creation?:{ephemeral_5m_input_tokens?:number;ephemeral_1h_input_tokens?:number}};
  const tokens=[u?.input_tokens,u?.output_tokens,u?.cache_read_input_tokens??0,u?.cache_creation_input_tokens??0,u?.cache_creation?.ephemeral_5m_input_tokens??0,u?.cache_creation?.ephemeral_1h_input_tokens??0];
  if(!/^claude-sonnet-4-6(?:-[0-9]{8})?$/u.test(body.model??'')||tokens.some(n=>!Number.isSafeInteger(n)||n<0)||(u.cache_creation_input_tokens??0)!==(u.cache_creation?.ephemeral_5m_input_tokens??0)+(u.cache_creation?.ephemeral_1h_input_tokens??0)){
   await c.query("UPDATE engine_cost_events SET call_state='outcome_unknown',metadata=metadata||'{\"error_code\":\"listening_discovery_usage_invalid\"}'::jsonb WHERE id=$1",[call.id]);return{unresolved:true as const};}
  const cost=Math.ceil(tokens[0]!*3+tokens[1]!*15+tokens[2]!*.3+tokens[4]!*3.75+tokens[5]!*6);
  await c.query(`UPDATE engine_cost_events SET call_state='settled',input_tokens=$3,output_tokens=$4,total_tokens=$5,settled_micro_usd=$6,settled_at=clock_timestamp(),metadata=metadata||jsonb_build_object('usage',$7::jsonb) WHERE id=$1 AND attempt_token=$2`,[call.id,call.attempt_token,tokens[0],tokens[1],tokens.slice(0,4).reduce((a,b)=>a!+b!,0),cost,JSON.stringify(u)]);
  await c.query(`UPDATE signal_listening_discovery_rounds SET status='reviewed' WHERE id=$1`,[call.listening_round_id]);
  await c.query("UPDATE signal_listening_discovery_executions p SET status='active',error_code=NULL WHERE p.id=(SELECT execution_id FROM signal_listening_discovery_rounds WHERE id=$1) AND p.status='outcome_unknown' AND NOT EXISTS(SELECT 1 FROM signal_listening_discovery_rounds r JOIN engine_cost_events c ON c.listening_round_id=r.id WHERE r.execution_id=p.id AND c.call_state='outcome_unknown')",[call.listening_round_id]);
  await c.query(`UPDATE signal_listening_discovery_executions p SET status='failed',error_code='listening_discovery_observed_over_cap' FROM signal_listening_discovery_rounds r WHERE r.id=$1 AND p.id=r.execution_id AND signal_listening_discovery_exposure_v1(p.id)>p.cap_micro_usd`,[call.listening_round_id]);
  return{cost_micro_usd:cost,replayed:false};
 });
}
export async function failSignalListeningDiscoveryCallV1(args:{database:SignalListeningAccessV1['database'];lease:ListeningDiscoveryLeaseV1;call_id:string;attempt_token:string;outcome:'definitely_not_sent'|'outcome_unknown';error_code:string}){
 if(!/^listening_discovery_[a-z_]{1,100}$/u.test(args.error_code))fail('listening_discovery_error_invalid',422);
 return listeningTransactionV1(args.database,async c=>{await moneyLock(c,args.lease.round_id);await lockedLease(c,args.lease);
  const call=(await c.query<ListeningDiscoveryCallV1>('SELECT * FROM engine_cost_events WHERE id=$1 AND listening_round_id=$2 AND attempt_token=$3 FOR UPDATE',[args.call_id,args.lease.round_id,args.attempt_token])).rows[0];if(!call)fail('listening_discovery_call_unavailable');
  if(['settled','response_persisted','definitely_not_sent'].includes(call.call_state))return call;
  const state=args.outcome==='definitely_not_sent'&&call.call_state==='reserved'?'definitely_not_sent':'outcome_unknown';
  await c.query("UPDATE engine_cost_events SET call_state=$2,metadata=metadata||jsonb_build_object('error_code',$3::text) WHERE id=$1",[call.id,state,args.error_code]);
  await c.query("UPDATE signal_listening_discovery_rounds SET status=$2,error_code=$3,execution_token=NULL,execution_expires_at=NULL WHERE id=$1",[args.lease.round_id,state==='definitely_not_sent'?'failed':'outcome_unknown',args.error_code]);
  await c.query("UPDATE signal_listening_discovery_executions SET status=$2,error_code=$3 WHERE id=(SELECT execution_id FROM signal_listening_discovery_rounds WHERE id=$1)",[args.lease.round_id,state==='definitely_not_sent'?'failed':'outcome_unknown',args.error_code]);
  return{...call,call_state:state};
 });
}
async function loadRound(args:SignalListeningAccessV1&{round_id:string}){
 return listeningTransactionV1(args.database,async c=>{await authorizeSignalListeningV1(c,args,'process');
  const r=(await c.query<ListeningDiscoveryRoundV1&{quote:{orphan_groups?:ListeningDiscoveryOrphanManifestV1[]}}>('SELECT * FROM signal_listening_discovery_rounds WHERE id=$1 AND workspace_id=$2',[args.round_id,args.workspace_id])).rows[0];if(!r)fail('listening_discovery_round_unavailable');
  const p=await owner(c,args,r.execution_id);return{r,p};});
}
export async function applySignalListeningDiscoveryReviewV1(args:SignalListeningAccessV1&{round_id:string}){
 const {r,p}=await loadRound(args);if(r.status==='completed')return{status:'completed' as const,round_id:r.id,configuration_id:r.output_configuration_id,generation_id:r.output_generation_id};
 const raw=await listeningTransactionV1(args.database,async c=>{
  const row=(await c.query<{raw_text:string;raw_sha256:string}>(`SELECT raw.raw_text,raw.raw_sha256 FROM engine_cost_events c JOIN signal_listening_discovery_raw_receipts raw ON raw.call_id=c.id WHERE c.listening_round_id=$1 AND c.call_state='settled'`,[r.id])).rows[0];if(!row)fail('listening_discovery_paid_receipt_required');return row;});
 const source=digest({contract_version:'listening-discovery-output-source-v1',round_id:r.id,request_digest:r.request_digest,raw_sha256:raw.raw_sha256});
 const latest=await listeningTransactionV1(args.database,c=>loadSignalListeningConfigurationWithClientV1(c,args.workspace_id));
 if(!latest)fail('listening_discovery_configuration_unavailable');
 // A lost save ACK is recognized by its immutable source seal. A later human
 // revision is never overwritten merely because the provider has been paid.
 if(latest.id!==r.configuration_id&&latest.source_digest!==source){
  await listeningTransactionV1(args.database,c=>c.query("UPDATE signal_listening_discovery_rounds SET status='stale',error_code='listening_discovery_human_configuration_changed',execution_token=NULL,execution_expires_at=NULL WHERE id=$1",[r.id]));
  await listeningTransactionV1(args.database,c=>c.query("UPDATE signal_listening_discovery_executions SET status='stale',error_code='listening_discovery_human_configuration_changed' WHERE id=$1",[p.id]));
  return{status:'stale' as const,round_id:r.id};
 }
 const native=await nativeRequest({...args,generation_id:r.input_generation_id,ordinal:r.ordinal,orphan_groups:r.quote.orphan_groups??[]});
 if(native.request.request_body!==r.request_body||native.request.request_digest!==r.request_digest)fail('listening_discovery_request_binding_changed');
 let output:unknown;try{const b=JSON.parse((JSON.parse(raw.raw_text) as {body:string}).body) as {stop_reason:string;content:Array<{type:string;text?:string}>};
  if(b.stop_reason!=='end_turn'||!Array.isArray(b.content)||b.content.some(x=>x.type!=='text'||typeof x.text!=='string'))throw Error('response');output=JSON.parse(b.content.map(x=>x.text).join(''));
 }catch{await listeningTransactionV1(args.database,c=>c.query("UPDATE signal_listening_discovery_rounds SET status='failed',error_code='listening_discovery_response_invalid' WHERE id=$1",[r.id]));await listeningTransactionV1(args.database,c=>c.query("UPDATE signal_listening_discovery_executions SET status='failed',error_code='listening_discovery_response_invalid' WHERE id=$1",[p.id]));return{status:'failed' as const,round_id:r.id};}
 let configuration:ReturnType<typeof applyListeningDiscoveryEditorialOutputV1>;try{configuration=applyListeningDiscoveryEditorialOutputV1(native.request,output);}catch{await listeningTransactionV1(args.database,c=>c.query("UPDATE signal_listening_discovery_rounds SET status='failed',error_code='listening_discovery_response_invalid',execution_token=NULL,execution_expires_at=NULL WHERE id=$1",[r.id]));await listeningTransactionV1(args.database,c=>c.query("UPDATE signal_listening_discovery_executions SET status='failed',error_code='listening_discovery_response_invalid' WHERE id=$1",[p.id]));return{status:'failed' as const,round_id:r.id};}
 const saved=latest.source_digest===source?latest:digest(configuration)===native.cfg.configuration_digest?native.cfg:await saveSignalListeningConfigurationV1({...args,expected_revision:native.cfg.revision,configuration,provenance:'agent',source_digest:source});
 // Seed generation is separate from a publication and carries previous-question
 // or orphan lineage. It never manufactures a JEV approval for a changed topic.
 const out=output as {topics:Array<{key:string;source_topic_keys:string[];orphan_group_keys:string[]}>};
 const {seedSignalListeningDiscoveryV1,snapshotSignalListeningDiscoveryOrphansV1}=await import('./signal-listening-discovery');
 let generation:ListeningDiscoveryGenerationV1;
 if(saved.id===r.configuration_id)generation=native.g;
 else{
  const existing=(await args.database.query<ListeningDiscoveryGenerationV1>("SELECT * FROM signal_listening_discovery_generations WHERE workspace_id=$1 AND configuration_id=$2 AND source_generation_id=$3 AND status='ready' AND kind='source_seed' ORDER BY created_at DESC LIMIT 1",[args.workspace_id,saved.id,native.g.id])).rows[0];
  if(existing)generation=existing;else{
   const subset=await snapshotSignalListeningDiscoveryOrphansV1({...args,generation_id:native.g.id});
   generation=await seedSignalListeningDiscoveryV1({...args,configuration_id:saved.id,map_id:p.map_id,round:r.ordinal,source_generation_id:native.g.id,
    seeds:saved.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>{const topic=out.topics.find(t=>t.key===q.key);
     const ids=[...new Set((topic?.orphan_group_keys??[]).flatMap(key=>r.quote.orphan_groups?.find(g=>g.group_key===key)?.root_ids??[]))];
     return{question_key:q.key,source_topic_keys:topic?.source_topic_keys??[q.key],...(ids.length?{orphan_subset_id:subset.id,orphan_root_ids:ids}:{})};})});
  }
 }
 await listeningTransactionV1(args.database,async c=>{
  await policyLock(c,args.workspace_id);await authorizeSignalListeningV1(c,args,'process');
  if((await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id))?.id!==saved.id)fail('listening_discovery_human_configuration_changed');
  const exposure=number((await c.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[p.id])).rows[0].n),remaining=number(p.cap_micro_usd)-exposure;
  if(remaining<=0)fail('listening_discovery_parent_cap_exhausted');
  await c.query("UPDATE signal_listening_discovery_rounds SET output_configuration_id=$2,output_digest=$3,status='classifying',planned_child_cap_micro_usd=$4,execution_token=NULL,execution_expires_at=NULL WHERE id=$1",[r.id,saved.id,saved.configuration_digest,remaining]);
 });
 return{status:'classifying' as const,round_id:r.id,configuration_id:saved.id,generation_id:generation.id};
}
export async function prepareSignalListeningDiscoveryChildV1(args:SignalListeningAccessV1&{round_id:string;provider_available:boolean;prototype_provider_available?:boolean}):Promise<SignalListeningPreparationV1>{
 const {r,p}=await loadRound(args);if(r.status!=='classifying'||!r.output_configuration_id||!r.planned_child_cap_micro_usd)fail('listening_discovery_child_not_ready');
 const cap=await listeningTransactionV1(args.database,async c=>{await policyLock(c,args.workspace_id);await authorizeSignalListeningV1(c,args,'process');
  const action=(await c.query<{max_execution_micro_usd:string|null}>("SELECT max_execution_micro_usd::text FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='mass_labeling_jev'",[p.policy_version_id])).rows[0];if(!action)fail('listening_discovery_child_policy_missing');return Math.min(number(r.planned_child_cap_micro_usd),action.max_execution_micro_usd===null?Number.MAX_SAFE_INTEGER:number(action.max_execution_micro_usd));});
 const result=await prepareSignalListeningV1({...args,configuration_id:r.output_configuration_id,map_id:p.map_id,idempotency_key:'listening-discovery-child:'+r.id,cap_micro_usd:cap});
 const prepared=(await args.database.query<SignalListeningPreparationV1>('SELECT * FROM signal_listening_preparations WHERE id=$1 AND workspace_id=$2',[result.preparation_id,args.workspace_id])).rows[0];if(!prepared)fail('listening_discovery_child_not_ready');
 await listeningTransactionV1(args.database,async c=>{await policyLock(c,args.workspace_id);
  await c.query('UPDATE signal_listening_discovery_rounds SET classification_preparation_id=$2,classification_run_id=$3 WHERE id=$1',[r.id,prepared.id,prepared.listening_run_id]);
  if(prepared.listening_run_id)await c.query('INSERT INTO signal_listening_discovery_children(execution_id,workspace_id,run_id,preparation_id,round_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id) DO NOTHING',[p.id,args.workspace_id,prepared.listening_run_id,prepared.id,r.id]);
 });return prepared;
}
export async function completeSignalListeningDiscoveryRoundV1(args:SignalListeningAccessV1&{round_id:string}){
 const {r,p}=await loadRound(args);if(r.status==='completed')return r;
 if(r.status!=='classifying'||!r.output_configuration_id||!r.classification_run_id)fail('listening_discovery_classification_incomplete');
 const run=(await args.database.query<{status:string}>('SELECT status FROM signal_labeling_runs WHERE workspace_id=$1 AND id=$2',[args.workspace_id,r.classification_run_id])).rows[0];if(run?.status!=='completed')fail('listening_discovery_classification_incomplete');
 const source=(await args.database.query<ListeningDiscoveryGenerationV1>("SELECT * FROM signal_listening_discovery_generations WHERE workspace_id=$1 AND configuration_id=$2 AND status='ready' ORDER BY created_at DESC,id DESC LIMIT 1",[args.workspace_id,r.output_configuration_id])).rows[0];if(!source)fail('listening_discovery_generation_unavailable');
 const generation=source.kind==='confirmed_members'?source:await refreshSignalListeningDiscoveryV1({...args,configuration_id:r.output_configuration_id,map_id:p.map_id,round:r.ordinal,source_generation_id:source.id});
 const current=await nativeRequest({...args,generation_id:generation.id,ordinal:r.ordinal,orphan_groups:[]});
 let stop:{stop:boolean;reason:string};
 if(r.output_configuration_id===r.configuration_id)stop={stop:true,reason:'map_unchanged'};
 else if(r.ordinal===1)stop=decideListeningDiscoveryStopV1({current:current.request.evidence,previous:null});
 else{
  const previous=(await args.database.query<{output_generation_id:string}>('SELECT output_generation_id FROM signal_listening_discovery_rounds WHERE execution_id=$1 AND ordinal=$2 AND status=\'completed\'',[p.id,r.ordinal-1])).rows[0];if(!previous)fail('listening_discovery_previous_round_missing');
  const prior=await nativeRequest({...args,generation_id:previous.output_generation_id,ordinal:r.ordinal-1,orphan_groups:[]});
  stop=decideListeningDiscoveryStopV1({current:current.request.evidence,previous:prior.request.evidence});
 }
 return listeningTransactionV1(args.database,async c=>{await policyLock(c,args.workspace_id);await authorizeSignalListeningV1(c,args,'process');
  const existing=(await c.query<ListeningDiscoveryRoundV1>('SELECT * FROM signal_listening_discovery_rounds WHERE id=$1 FOR UPDATE',[r.id])).rows[0];if(existing?.status==='completed')return existing;
  const row=(await c.query<ListeningDiscoveryRoundV1>("UPDATE signal_listening_discovery_rounds SET status='completed',output_generation_id=$2,stop_decision=$3::jsonb,execution_token=NULL,execution_expires_at=NULL WHERE id=$1 RETURNING *",[r.id,generation.id,JSON.stringify(stop)])).rows[0]!;
  if(stop.stop)await c.query("UPDATE signal_listening_discovery_executions SET status='completed' WHERE id=$1",[p.id]);return row;});
}
export async function activateSignalListeningServingSnapshotV1(args:SignalListeningAccessV1&{round_id:string}){
 return listeningTransactionV1(args.database,async c=>{const policy=await policyLock(c,args.workspace_id);await authorizeSignalListeningV1(c,args,'process');
  const r=(await c.query<ListeningDiscoveryRoundV1>('SELECT * FROM signal_listening_discovery_rounds WHERE id=$1 AND workspace_id=$2',[args.round_id,args.workspace_id])).rows[0];if(!r)fail('listening_discovery_round_unavailable');const p=await owner(c,args,r.execution_id);if(p.policy_version_id!==policy.id)fail('listening_discovery_policy_changed');
  await mapCurrent(c,args.workspace_id,p.map_id);const old=(await c.query<{id:string}>('SELECT id FROM signal_listening_serving_snapshots WHERE round_id=$1',[r.id])).rows[0];if(old)return old;
  const binding={workspace_id:args.workspace_id,execution_id:p.id,round_id:r.id,map_id:p.map_id,configuration_id:r.output_configuration_id,generation_id:r.output_generation_id,classification_run_id:r.classification_run_id};
  return(await c.query<{id:string}>(`INSERT INTO signal_listening_serving_snapshots(workspace_id,execution_id,round_id,map_id,configuration_id,generation_id,classification_run_id,snapshot_digest,activated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[args.workspace_id,p.id,r.id,p.map_id,r.output_configuration_id,r.output_generation_id,r.classification_run_id,digest(binding),args.actor_user_id])).rows[0]!;});
}
/** Serving consumes one explicit binding, never an independently latest map/run/generation. */
export async function getSignalListeningServingSnapshotV1(args:SignalListeningAccessV1){
 return listeningTransactionV1(args.database,async c=>{await authorizeSignalListeningV1(c,args);
  const row=(await c.query<{id:string;configuration_id:string;configuration_revision:number;configuration_is_latest:boolean;generation_id:string;classification_run_id:string;map_id:string;snapshot_digest:string;source_current:boolean}>(`SELECT s.id,s.configuration_id,cfg.revision configuration_revision,
   cfg.revision=(SELECT max(revision) FROM signal_listening_configurations WHERE workspace_id=s.workspace_id AND state='published') configuration_is_latest,
   s.generation_id,s.classification_run_id,s.map_id,s.snapshot_digest,signal_listening_discovery_source_current_v1(s.generation_id) source_current
   FROM signal_listening_serving_snapshots s JOIN signal_listening_configurations cfg ON cfg.id=s.configuration_id AND cfg.workspace_id=s.workspace_id
   WHERE s.workspace_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 1`,[args.workspace_id])).rows[0];
  if(!row?.source_current)return null;
  try{await mapCurrent(c,args.workspace_id,row.map_id);}catch(error){if(error instanceof Error&&/^mass_labeling_(map_stale|context_changed)$/u.test(error.message))return null;throw error;}
  const {source_current:_,...binding}=row;return binding;
 });
}
/** Only already admitted owners are drained. This function creates no authority. */
export async function pendingSignalListeningDiscoveryRoundsV1(args:{database:SignalListeningAccessV1['database'];limit?:number}){
 const limit=args.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('listening_discovery_limit_invalid',422);
 return(await args.database.query<{round_id:string;workspace_id:string;actor_user_id:string;status:string}>(`SELECT r.id round_id,r.workspace_id,p.actor_user_id,r.status
 FROM signal_listening_discovery_rounds r JOIN signal_listening_discovery_executions p ON p.id=r.execution_id
 WHERE(r.status IN('queued','reviewing','reviewed','classifying') OR r.status='outcome_unknown' AND EXISTS(SELECT 1 FROM engine_cost_events c WHERE c.listening_round_id=r.id AND (c.call_state IN('response_persisted','settled') OR EXISTS(SELECT 1 FROM signal_listening_discovery_raw_receipts raw WHERE raw.call_id=c.id AND raw.verification_status='planned'))))
 AND(r.execution_token IS NULL OR r.execution_expires_at<=clock_timestamp()) ORDER BY r.created_at,r.id LIMIT $1`,[limit])).rows;
}

/** A durable planned wrapper recovers storage/attach ACK loss without a provider. */
export async function loadSignalListeningDiscoveryRawIntentV1(args:{database:SignalListeningAccessV1['database'];call_id:string;attempt_token:string}){
 return(await args.database.query<{raw_text:string;raw_sha256:string;size_bytes:string;storage_key:string;verification_status:'planned'|'verified'}>(`SELECT raw.raw_text,raw.raw_sha256,raw.size_bytes::text,raw.storage_key,raw.verification_status FROM signal_listening_discovery_raw_receipts raw JOIN engine_cost_events c ON c.id=raw.call_id AND c.workspace_id=raw.workspace_id AND c.listening_round_id=raw.round_id AND c.request_digest=raw.request_digest WHERE c.id=$1 AND c.attempt_token=$2 AND c.workspace_contract='listening-discovery-round-v1'`,[args.call_id,args.attempt_token])).rows[0]??null;
}
