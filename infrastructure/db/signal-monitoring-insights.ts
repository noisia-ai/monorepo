import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {
 buildWorkspaceMonitoringInsightRequestV1,workspaceMonitoringInsightConfigurationV1,workspaceMonitoringMonthlyInsightsV1,
 parseWorkspaceMonitoringInsightReceiptV1,workspaceMonitoringInsightUsageFromRawV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalWorkspaceMonitoringInsightsViewV1,type SignalWorkspaceMonitoringInsightsQuoteV1,
 type WorkspaceMonitoringInsightPacketV1,type WorkspaceMonitoringInsightRequestV1,type SignalConversationSegmentV1,
} from '@noisia/query-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {admitSignalProcessingWithClientV1} from './signal-processing-policy';
import {buildMonitoringInsightSnapshotV1,readMonitoringInsightProofV1,monitoringInsightProofKeyV1,lockMonitoringInsightInputsV1,
 type MonitoringInsightSnapshotV1,type MonitoringInsightProofV1,type MonitoringInsightContextV1} from './signal-monitoring-insights-source';

type Database=Pick<Pool,'query'|'connect'>;
export type MonitoringInsightAccessV1={database:Database;workspace_id:string;actor_user_id:string;
 conversation_segment?:SignalConversationSegmentV1;locale?:'es-MX'|'en-US';runtime?:{enabled:boolean;provider_available:boolean}};
type Access=MonitoringInsightAccessV1&MonitoringInsightContextV1;
export class MonitoringInsightsError extends Error{
 constructor(readonly code:string,readonly status=409,readonly definitely_not_sent=false){super(code);this.name='MonitoringInsightsError';}
}
function fail(code:string,status=409):never{throw new MonitoringInsightsError(code,status);}
const sha=(value:Uint8Array)=>'sha256:'+createHash('sha256').update(value).digest('hex');
const iso=(value:string|Date)=>new Date(value).toISOString();
function access(args:MonitoringInsightAccessV1):Access{
 const conversation_segment=args.conversation_segment??'conversation',locale=args.locale??'es-MX';
 if(!['all','conversation','advertising','hashtags'].includes(conversation_segment)||!['es-MX','en-US'].includes(locale))fail('monitoring_insights_context_invalid',422);
 return{...args,conversation_segment,locale};
}
function runtime(args:MonitoringInsightAccessV1){return args.runtime??{
 enabled:process.env.NOISIA_MONITORING_INSIGHTS_ENABLED==='true',
 provider_available:Boolean(process.env.NOISIA_MONITORING_INSIGHTS_ANTHROPIC_API_KEY?.trim())};}
async function transaction<T>(database:Database,mode:'read'|'write',work:(client:PoolClient)=>Promise<T>):Promise<T>{
 let checkoutExpired=false;
 const checkout=database.connect().then(client=>{
  if(checkoutExpired){client.release(new Error('monitoring_insights_checkout_timeout'));throw Error('monitoring_insights_checkout_timeout');}
  return client;
 });
 let checkoutTimer:ReturnType<typeof setTimeout>|undefined;
 const client=await Promise.race([checkout,new Promise<never>((_,reject)=>{
  checkoutTimer=setTimeout(()=>{checkoutExpired=true;reject(Error('monitoring_insights_checkout_timeout'));},15000);
 })]).finally(()=>clearTimeout(checkoutTimer));
 let commitStarted=false,destroyed=false;
 const query=client.query.bind(client);
 // A server timeout cannot bound a lost TCP response. Destroy a timed-out socket
 // and leave its durable owner/key for read reconciliation, never replay SQL.
 const boundedQuery=async(text:string,values?:unknown[])=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=/^(COMMIT|ROLLBACK)/.test(text)?15000:90000;
  try{return await Promise.race([query(text,values),new Promise<never>((_,reject)=>{
   timer=setTimeout(()=>{
    destroyed=true;client.release(new Error('monitoring_insights_transport_timeout'));
    reject(Error('monitoring_insights_transport_timeout'));
   },deadline);
  })]);}finally{clearTimeout(timer);}
 };
 const bounded=new Proxy(client,{get(target,key){return key==='query'?boundedQuery:Reflect.get(target,key);}}) as PoolClient;
 try{
  await bounded.query(mode==='read'?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED');
  await bounded.query("SET LOCAL statement_timeout='75s'");
  await bounded.query("SET LOCAL lock_timeout='15s'");
  const result=await work(bounded);commitStarted=true;await bounded.query('COMMIT');return result;
 }catch(error){
  let rolledBack=false;
  if(!destroyed){try{await bounded.query('ROLLBACK');rolledBack=true;}catch{if(!destroyed){destroyed=true;client.release(new Error('monitoring_insights_rollback_unknown'));}}}
  // A failed COMMIT acknowledgement can never become a definitive HTTP rejection.
  if(commitStarted||!rolledBack)throw new Error('monitoring_insights_transaction_outcome_unknown');
  if(error instanceof MonitoringInsightsError)throw error;
  const message=error instanceof Error?error.message:'';
  if(/^(monitoring_insights_|processing_)[a-z_]+$/.test(message))throw new MonitoringInsightsError(message,409,true);
  throw error;
 }finally{if(!destroyed)client.release();}
}
type Policy={organization_id:string;policy_id:string|null;policy_digest:string|null;configuration:unknown;configuration_digest:string|null;
 max_execution_micro_usd:string|null;valid_until:string|null;budget_timezone:string;budget_date:string;day_end:string;current:boolean;
 actor_can_manage:boolean;actor_can_spend:boolean};
async function policy(client:PoolClient,args:Access):Promise<Policy>{
 const capabilities=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id});
 if(!capabilities.can_view)fail('monitoring_insights_forbidden',403);
 const row=(await client.query<Policy>(`SELECT w.organization_id,p.id policy_id,p.policy_digest,a.configuration,a.configuration_digest,
  a.max_execution_micro_usd::text,p.valid_until::text,COALESCE(p.budget_timezone,w.timezone) budget_timezone,
  (clock_timestamp() AT TIME ZONE COALESCE(p.budget_timezone,w.timezone))::date::text budget_date,
  (((clock_timestamp() AT TIME ZONE COALESCE(p.budget_timezone,w.timezone))::date+1)::timestamp AT TIME ZONE COALESCE(p.budget_timezone,w.timezone))::text day_end,
  COALESCE(p.status='active' AND p.valid_from<=clock_timestamp() AND p.valid_until>clock_timestamp(),false) current,
  (u.status='active' AND u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','analyst')) actor_can_manage,
  signal_processing_actor_v1(w.id,u.id) actor_can_spend
  FROM signal_workspaces w JOIN users u ON u.id=$2
  LEFT JOIN LATERAL(SELECT * FROM signal_processing_policy_versions WHERE organization_id=w.organization_id
   ORDER BY (status='active') DESC,version DESC LIMIT 1) p ON true
  LEFT JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id AND a.action='monitoring_insights'
  WHERE w.id=$1`,[args.workspace_id,args.actor_user_id])).rows[0];
 if(!row)fail('monitoring_insights_workspace_unavailable',404);return row;
}
async function financialLock(client:PoolClient,args:Access){
 const scope=(await client.query<{organization_id:string}>(`SELECT organization_id FROM signal_workspaces WHERE id=$1`,[args.workspace_id])).rows[0];
 if(!scope)fail('monitoring_insights_workspace_unavailable',404);
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::uuid::text,0))",[scope.organization_id]);
 const current=await policy(client,args);
 await client.query('SELECT signal_processing_lock_v1($1,$2::date)',[current.organization_id,current.budget_date]);
 await client.query('SELECT signal_processing_lock_actor_v1($1,$2)',[args.workspace_id,args.actor_user_id]);
 return current;
}
type Run={id:string;workspace_id:string;actor_user_id:string;admission_id:string;packet:WorkspaceMonitoringInsightPacketV1;
 packet_digest:string;scope_digest:string;source_proof:MonitoringInsightProofV1;source_not_after:string|null;
 configuration:ReturnType<typeof workspaceMonitoringInsightConfigurationV1>;request_body:string;request_digest:string;request_intent_digest:string;
 reservation_micro_usd:string;budget_cap_micro_usd:string;execution_token:string|null;execution_expires_at:string|null;
 status:'queued'|'running'|'completed'|'failed'|'outcome_unknown';result:unknown|null;error_code:string|null;updated_at:string;created_at:string};
export type MonitoringInsightLeaseV1={run_id:string;workspace_id:string;execution_token:string;packet:WorkspaceMonitoringInsightPacketV1;request:WorkspaceMonitoringInsightRequestV1};
export type MonitoringInsightCallV1={id:string;attempt_token:string;state:'reserved'|'in_flight'|'response_persisted'|'settled'|'outcome_unknown'|'definitely_not_sent';
 response_body:Buffer|null;response_http_status:number|null;response_complete:boolean|null};
type Call=MonitoringInsightCallV1&{run_id:string;workspace_id:string;settled_micro_usd:string|null;usage:unknown;provider_request_id:string|null};
const caches=new WeakMap<object,Map<string,MonitoringInsightSnapshotV1>>();
function cache(database:Database){let entries=caches.get(database);if(!entries){entries=new Map();caches.set(database,entries);}return entries;}
function requestScope(args:Access,current:Policy,proof:MonitoringInsightProofV1){return digest({contract_version:'workspace-monitoring-insights-access-v1',
 workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,conversation_segment:args.conversation_segment,locale:args.locale,
 policy_id:current.policy_id,policy_digest:current.policy_digest,budget_date:current.budget_date,
 configuration:workspaceMonitoringInsightConfigurationV1(args.workspace_id),source:monitoringInsightProofKeyV1(proof)});}
function currentSnapshot(snapshot:MonitoringInsightSnapshotV1,proof:MonitoringInsightProofV1){return monitoringInsightProofKeyV1(snapshot.proof)===monitoringInsightProofKeyV1(proof)
 &&(!snapshot.not_after||Date.parse(snapshot.not_after)>Date.parse(proof.observed_at));}
function allowed(args:Access,current:Policy,proof:MonitoringInsightProofV1){
 const flags=runtime(args);
 if(!flags.enabled||!proof.enabled)return 'monitoring_insights_disabled';
 if(!current.actor_can_manage||!current.actor_can_spend)return 'monitoring_insights_forbidden';
 if(!flags.provider_available)return 'monitoring_insights_provider_unavailable';
 if(!current.current||!current.policy_id||digest(current.configuration)!==digest(workspaceMonitoringInsightConfigurationV1(args.workspace_id)))return 'monitoring_insights_policy_required';
 if(current.max_execution_micro_usd===null||BigInt(current.max_execution_micro_usd)<2000000n)return 'monitoring_insights_budget_limit';
 return null;
}
function emptyMonthly(args:Access){return{...workspaceMonitoringMonthlyInsightsV1(null),scope_segment:args.conversation_segment,editorial_locale:args.locale};}
async function latestRun(client:PoolClient,args:Access){return(await client.query<Run>(`SELECT * FROM signal_monitoring_insight_runs
 WHERE workspace_id=$1 AND packet->>'scope_segment'=$2 AND packet->>'locale'=$3 ORDER BY created_at DESC,id DESC LIMIT 1`,
 [args.workspace_id,args.conversation_segment,args.locale])).rows[0]??null;}
async function view(client:PoolClient,args:Access):Promise<SignalWorkspaceMonitoringInsightsViewV1>{
 const current=await policy(client,args),proof=await readMonitoringInsightProofV1(client,args.workspace_id),scope=requestScope(args,current,proof);
 const row=await latestRun(client,args);
 const snapshot=cache(args.database).get(scope)??(row?{packet:row.packet,proof:row.source_proof,not_after:row.source_not_after}:null);
 const usable=snapshot&&currentSnapshot(snapshot,proof)?snapshot:null;
 const monthly=usable?.packet?workspaceMonitoringMonthlyInsightsV1(usable.packet,row?.status==='completed'?row.result as never:null):emptyMonthly(args);
 // Expired/revoked processing authority does not erase licensed paid copy; source
 // authority/freshness above still determines whether any stored packet can serve.
 const active=(await client.query<{status:string}>(`SELECT status FROM signal_monitoring_insight_runs WHERE workspace_id=$1
  AND status IN('queued','running','outcome_unknown') ORDER BY created_at DESC LIMIT 1`,[args.workspace_id])).rows[0];
 const blocked=active?active.status==='outcome_unknown'?'monitoring_insights_outcome_unknown':'monitoring_insights_active':allowed(args,current,proof);
 const amount=row?(await client.query<{reserved:string;settled:string}>(`SELECT COALESCE(sum(reserved_micro_usd) FILTER(WHERE state NOT IN('settled','definitely_not_sent')),0)::text reserved,
  COALESCE(sum(settled_micro_usd),0)::text settled FROM signal_monitoring_insight_calls WHERE run_id=$1`,[row.id])).rows[0]:null;
 return{contract_version:'signal-workspace-monitoring-insights-view-v1',workspace_id:args.workspace_id,request_scope:scope,
  observed_at:iso(proof.observed_at),monthly_insights:monthly,authorization:{can_request:blocked===null,
   provider_available:runtime(args).enabled&&runtime(args).provider_available,blocked_reason:blocked,max_budget_micro_usd:2000000},
  run:row?{id:row.id,status:row.status,reserved_micro_usd:Number(amount?.reserved??0),settled_micro_usd:Number(amount?.settled??0),
   error_code:row.error_code,updated_at:iso(row.updated_at)}:null};
}
export async function loadWorkspaceMonitoringInsightsV1(args:MonitoringInsightAccessV1){return transaction(args.database,'read',client=>view(client,access(args)));}
function quoteFor(args:Access,current:Policy,snapshot:MonitoringInsightSnapshotV1,cap:number){
 if(!Number.isSafeInteger(cap)||cap<1||cap>2000000)fail('monitoring_insights_budget_invalid',422);
 if(allowed(args,current,snapshot.proof))fail(allowed(args,current,snapshot.proof)!);
 if(!snapshot.packet)fail('monitoring_insights_candidates_unavailable');
 const request=buildWorkspaceMonitoringInsightRequestV1(snapshot.packet,workspaceMonitoringInsightConfigurationV1(args.workspace_id));
 if(request.reserved_micro_usd>cap)fail('monitoring_insights_budget_below_quote',422);
 const instant=Date.parse(snapshot.proof.observed_at),slot=Math.floor(instant/300000)*300000;
 const expires=Math.min(slot+300000,Date.parse(current.valid_until!),Date.parse(current.day_end),snapshot.not_after?Date.parse(snapshot.not_after):Infinity);
 if(expires<=Date.now())fail('monitoring_insights_quote_expired');
 const scope=requestScope(args,current,snapshot.proof),expires_at=new Date(expires).toISOString();
 const seal={workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,scope,packet_digest:request.packet_digest,
  request_digest:request.request_digest,policy_id:current.policy_id,policy_digest:current.policy_digest,
  source:monitoringInsightProofKeyV1(snapshot.proof),expires_at,budget_cap_micro_usd:cap};
 return{request,quote:{contract_version:'signal-workspace-monitoring-insights-quote-v1' as const,workspace_id:args.workspace_id,
  request_scope:scope,quote_digest:digest(seal),packet_digest:request.packet_digest,scope_digest:request.scope_digest,
  expires_at,reserved_micro_usd:request.reserved_micro_usd,budget_cap_micro_usd:cap,
  monthly_insights:workspaceMonitoringMonthlyInsightsV1(snapshot.packet)}};
}
export async function quoteWorkspaceMonitoringInsightsV1(input:MonitoringInsightAccessV1&{budget_cap_micro_usd:number}):Promise<SignalWorkspaceMonitoringInsightsQuoteV1>{
 const args=access(input);return transaction(args.database,'read',async client=>{
  const current=await policy(client,args),proof=await readMonitoringInsightProofV1(client,args.workspace_id),scope=requestScope(args,current,proof);
  const blocked=allowed(args,current,proof);if(blocked)fail(blocked);
  let snapshot=cache(args.database).get(scope);
  if(!snapshot||!currentSnapshot(snapshot,proof))snapshot=await buildMonitoringInsightSnapshotV1(client,args,'preview');
  cache(args.database).set(scope,snapshot);if(cache(args.database).size>32)cache(args.database).delete(cache(args.database).keys().next().value!);
  return quoteFor(args,current,{...snapshot,proof},input.budget_cap_micro_usd).quote;
 });
}
export async function requestWorkspaceMonitoringInsightsV1(input:MonitoringInsightAccessV1&{idempotency_key:string;quote_digest:string;budget_cap_micro_usd:number}){
 const args=access(input);
 if(!/^[A-Za-z0-9._:-]{8,200}$/.test(input.idempotency_key)||!/^sha256:[a-f0-9]{64}$/.test(input.quote_digest))fail('monitoring_insights_request_invalid',422);
 const intent=digest({quote_digest:input.quote_digest,budget_cap_micro_usd:input.budget_cap_micro_usd,segment:args.conversation_segment,locale:args.locale});
 return transaction(args.database,'write',async client=>{
  const current=await financialLock(client,args);
  const prior=(await client.query<Run>('SELECT * FROM signal_monitoring_insight_runs WHERE workspace_id=$1 AND actor_user_id=$2 AND idempotency_key=$3',
   [args.workspace_id,args.actor_user_id,input.idempotency_key])).rows[0];
  if(prior){if(prior.request_intent_digest!==intent)fail('monitoring_insights_idempotency_conflict');return{run_id:prior.id,replayed:true};}
  await lockMonitoringInsightInputsV1(client,args.workspace_id);
  const proof=await readMonitoringInsightProofV1(client,args.workspace_id),scope=requestScope(args,current,proof);
  let snapshot=cache(args.database).get(scope);
  if(!snapshot||!currentSnapshot(snapshot,proof))snapshot=await buildMonitoringInsightSnapshotV1(client,args,'dispatch');
  const {request,quote}=quoteFor(args,current,{...snapshot,proof},input.budget_cap_micro_usd);
  if(quote.quote_digest!==input.quote_digest)fail('monitoring_insights_quote_changed');
  const existing=(await client.query<{id:string}>(`SELECT r.id FROM signal_monitoring_insight_calls c JOIN signal_monitoring_insight_runs r ON r.id=c.run_id
   WHERE c.workspace_id=$1 AND c.packet_digest=$2 AND c.state<>'definitely_not_sent' LIMIT 1`,[args.workspace_id,request.packet_digest])).rows[0];
  if(existing)return{run_id:existing.id,replayed:true};
  if((await client.query(`SELECT 1 FROM signal_monitoring_insight_runs WHERE workspace_id=$1 AND status IN('queued','running','outcome_unknown') LIMIT 1`,[args.workspace_id])).rows.length)fail('monitoring_insights_active');
  const id=randomUUID();const admission=await admitSignalProcessingWithClientV1(client,{workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
   action:'monitoring_insights',target_id:id,idempotency_key:input.idempotency_key,request_digest:intent,execution_cap_micro_usd:String(input.budget_cap_micro_usd)});
  await client.query(`INSERT INTO signal_monitoring_insight_runs(id,workspace_id,actor_user_id,admission_id,idempotency_key,request_intent_digest,
   packet,packet_digest,scope_digest,source_proof,source_not_after,input_revision,configuration,request_body,request_digest,budget_cap_micro_usd,reservation_micro_usd,input_token_upper_bound)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
  [id,args.workspace_id,args.actor_user_id,admission.receipt.id,input.idempotency_key,intent,JSON.stringify(snapshot.packet),request.packet_digest,request.scope_digest,
   JSON.stringify(proof),snapshot.not_after,proof.input_revision,JSON.stringify(request.configuration),request.request_body,request.request_digest,input.budget_cap_micro_usd,
   request.reserved_micro_usd,request.input_token_upper_bound]);
  cache(args.database).set(scope,{...snapshot,proof});return{run_id:id,replayed:false};
 });
}

function requestFromRun(row:Run):WorkspaceMonitoringInsightRequestV1{
 const request=buildWorkspaceMonitoringInsightRequestV1(row.packet,row.configuration);
 if(request.packet_digest!==row.packet_digest||request.request_digest!==row.request_digest||request.request_body!==row.request_body)
  fail('monitoring_insights_seal_invalid');
 return request;
}
async function lockedLease(client:PoolClient,lease:MonitoringInsightLeaseV1){
 const row=(await client.query<Run>(`SELECT * FROM signal_monitoring_insight_runs WHERE id=$1 AND workspace_id=$2
  AND status='running' AND execution_token=$3 AND execution_expires_at>clock_timestamp() FOR UPDATE`,
 [lease.run_id,lease.workspace_id,lease.execution_token])).rows[0];
 if(!row||row.request_digest!==lease.request.request_digest||digest(row.packet)!==digest(lease.packet))fail('monitoring_insights_lease_lost');
 requestFromRun(row);return row;
}
export async function listMonitoringInsightRunsV1(args:{database:Database;limit?:number;enabled?:boolean}):Promise<string[]>{
 const limit=Math.max(1,Math.min(25,args.limit??10));
 const rows=await args.database.query<{id:string}>(`SELECT r.id FROM signal_monitoring_insight_runs r
 LEFT JOIN signal_monitoring_insight_calls c ON c.run_id=r.id
 WHERE (r.status IN('queued','running') AND (r.execution_expires_at IS NULL OR r.execution_expires_at<=clock_timestamp())
   AND ($2 OR c.state IN('response_persisted','settled','in_flight','outcome_unknown')))
 OR (r.status IN('failed','outcome_unknown') AND c.state IN('response_persisted','settled')
   AND r.error_code IS DISTINCT FROM 'monitoring_insights_response_invalid')
 ORDER BY r.available_at,r.id LIMIT $1`,[limit,args.enabled===true]);
 return rows.rows.map(row=>row.id);
}
export async function claimMonitoringInsightRunV1(args:{database:Database;run_id:string}):Promise<MonitoringInsightLeaseV1|null>{
 return transaction(args.database,'write',async client=>{
  // Expiry is not proof that HTTP was unsent. Serialize on the original money
  // day before the owner row, then quarantine an abandoned physical attempt.
  const money=(await client.query<{organization_id:string;budget_date:string}>(`SELECT a.organization_id,a.budget_date::text
   FROM signal_monitoring_insight_runs r JOIN signal_processing_admissions a ON a.id=r.admission_id WHERE r.id=$1`,[args.run_id])).rows[0];
  if(!money)return null;
  await client.query('SELECT signal_processing_lock_v1($1,$2::date)',[money.organization_id,money.budget_date]);
  const row=(await client.query<Run>(`SELECT r.* FROM signal_monitoring_insight_runs r WHERE r.id=$1
   AND ((r.status IN('queued','running') AND (r.execution_expires_at IS NULL OR r.execution_expires_at<=clock_timestamp()))
    OR (r.status IN('failed','outcome_unknown') AND r.error_code IS DISTINCT FROM 'monitoring_insights_response_invalid'
     AND EXISTS(SELECT 1 FROM signal_monitoring_insight_calls c WHERE c.run_id=r.id AND c.state IN('response_persisted','settled'))))
   FOR UPDATE OF r SKIP LOCKED`,[args.run_id])).rows[0];
  if(!row)return null;
  const call=(await client.query<Call>('SELECT * FROM signal_monitoring_insight_calls WHERE run_id=$1 FOR UPDATE',[row.id])).rows[0];
  if(call&&['in_flight','outcome_unknown'].includes(call.state)){
   if(call.state==='in_flight')await client.query(`UPDATE signal_monitoring_insight_calls SET state='outcome_unknown',
    error_code='monitoring_insights_lease_expired_after_send',updated_at=clock_timestamp() WHERE id=$1 AND attempt_token=$2 AND state='in_flight'`,[call.id,call.attempt_token]);
   await client.query(`UPDATE signal_monitoring_insight_runs SET status='outcome_unknown',execution_token=NULL,
    execution_expires_at=NULL,error_code='monitoring_insights_lease_expired_after_send',updated_at=clock_timestamp() WHERE id=$1`,[row.id]);
   return null;
  }
  const request=requestFromRun(row),token=randomUUID();
  await client.query(`UPDATE signal_monitoring_insight_runs SET status='running',execution_token=$2,
   execution_expires_at=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp(),error_code=NULL WHERE id=$1`,[row.id,token]);
  return{run_id:row.id,workspace_id:row.workspace_id,execution_token:token,packet:row.packet,request};
 });
}
export async function reserveMonitoringInsightCallV1(args:{database:Database;lease:MonitoringInsightLeaseV1}):Promise<MonitoringInsightCallV1>{
 return transaction(args.database,'write',async client=>{
  // Recovery of an existing receipt does not create or renew spending authority.
  const existing=(await client.query<Call>('SELECT * FROM signal_monitoring_insight_calls WHERE run_id=$1 AND workspace_id=$2',
   [args.lease.run_id,args.lease.workspace_id])).rows[0];
  if(existing){await lockedLease(client,args.lease);return existing;}
  const owner=(await client.query<Run>('SELECT * FROM signal_monitoring_insight_runs WHERE id=$1 AND workspace_id=$2',[args.lease.run_id,args.lease.workspace_id])).rows[0];
  if(!owner)fail('monitoring_insights_lease_lost');
  const context=access({database:args.database,workspace_id:owner.workspace_id,actor_user_id:owner.actor_user_id,
   conversation_segment:owner.packet.scope_segment,locale:owner.packet.locale});
  await financialLock(client,context);await lockMonitoringInsightInputsV1(client,owner.workspace_id);
  const proof=await readMonitoringInsightProofV1(client,owner.workspace_id);
  if(!currentSnapshot({packet:owner.packet,proof:owner.source_proof,not_after:owner.source_not_after},proof))throw new MonitoringInsightsError('monitoring_insights_source_changed',409,true);
  const row=await lockedLease(client,args.lease);
  const prior=(await client.query<Call>('SELECT * FROM signal_monitoring_insight_calls WHERE run_id=$1',[row.id])).rows[0];
  if(prior)return prior;
  return(await client.query<Call>(`INSERT INTO signal_monitoring_insight_calls(workspace_id,run_id,organization_id,packet_digest,
   request_digest,budget_date,budget_timezone,reserved_micro_usd)
   SELECT r.workspace_id,r.id,a.organization_id,r.packet_digest,r.request_digest,a.budget_date,a.budget_timezone,r.reservation_micro_usd
   FROM signal_monitoring_insight_runs r JOIN signal_processing_admissions a ON a.id=r.admission_id WHERE r.id=$1 RETURNING *`,[row.id])).rows[0]!;
 });
}
export async function markMonitoringInsightCallSentV1(args:{database:Database;lease:MonitoringInsightLeaseV1;call_id:string;attempt_token:string}):Promise<boolean>{
 return transaction(args.database,'write',async client=>{
  const owner=(await client.query<Run>('SELECT * FROM signal_monitoring_insight_runs WHERE id=$1 AND workspace_id=$2',[args.lease.run_id,args.lease.workspace_id])).rows[0];
  if(!owner)fail('monitoring_insights_lease_lost');
  const context=access({database:args.database,workspace_id:owner.workspace_id,actor_user_id:owner.actor_user_id,
   conversation_segment:owner.packet.scope_segment,locale:owner.packet.locale});
  await financialLock(client,context);await lockMonitoringInsightInputsV1(client,owner.workspace_id);
  await lockedLease(client,args.lease);
  const pending=(await client.query<{state:string}>(`SELECT state FROM signal_monitoring_insight_calls WHERE id=$1
   AND run_id=$2 AND workspace_id=$3 AND attempt_token=$4`,[args.call_id,args.lease.run_id,args.lease.workspace_id,args.attempt_token])).rows[0];
  // A second observer of an already-sent call never acquires a definitive-unsent
  // failure merely because its source changed after the first sender's CAS.
  if(pending?.state!=='reserved')return false;
  const proof=await readMonitoringInsightProofV1(client,owner.workspace_id);
  if(!currentSnapshot({packet:owner.packet,proof:owner.source_proof,not_after:owner.source_not_after},proof))throw new MonitoringInsightsError('monitoring_insights_source_changed',409,true);
  return(await client.query(`UPDATE signal_monitoring_insight_calls SET state='in_flight',sent_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE id=$1 AND run_id=$2 AND workspace_id=$3 AND attempt_token=$4 AND state='reserved' RETURNING id`,
  [args.call_id,args.lease.run_id,args.lease.workspace_id,args.attempt_token])).rows.length===1;
 });
}
async function lockCallMoney(client:PoolClient,callId:string){
 const scope=(await client.query<{organization_id:string;budget_date:string}>(
  'SELECT organization_id,budget_date::text FROM signal_monitoring_insight_calls WHERE id=$1',[callId])).rows[0];
 if(!scope)fail('monitoring_insights_call_scope_invalid');
 await client.query('SELECT signal_processing_lock_v1($1,$2::date)',[scope.organization_id,scope.budget_date]);
}
export async function persistMonitoringInsightRawV1(args:{database:Database;call_id:string;attempt_token:string;
 receipt:{bytes:Uint8Array;http_status:number;provider_request_id:string|null;complete:boolean}}){
 const bytes=Buffer.from(args.receipt.bytes);
 if(bytes.length>2097152||!Number.isInteger(args.receipt.http_status)||args.receipt.http_status<100||args.receipt.http_status>599
  ||args.receipt.provider_request_id!==null&&args.receipt.provider_request_id.length>200)fail('monitoring_insights_receipt_invalid',422);
 return transaction(args.database,'write',async client=>{
  await lockCallMoney(client,args.call_id);
  const row=(await client.query<Call>('SELECT * FROM signal_monitoring_insight_calls WHERE id=$1 AND attempt_token=$2',[args.call_id,args.attempt_token])).rows[0];
  if(!row)fail('monitoring_insights_call_scope_invalid');
  if(row.response_body){
   if(!row.response_body.equals(bytes)||row.response_http_status!==args.receipt.http_status||row.response_complete!==args.receipt.complete||row.provider_request_id!==args.receipt.provider_request_id)
    fail('monitoring_insights_receipt_conflict');
   return{call_id:row.id,replayed:true};
  }
  if(!['in_flight','outcome_unknown'].includes(row.state))fail('monitoring_insights_call_transition_invalid');
  await client.query(`UPDATE signal_monitoring_insight_calls SET response_body=$3,response_sha256=$4,response_http_status=$5,
   response_complete=$6,provider_request_id=$7,state=$8,updated_at=clock_timestamp() WHERE id=$1 AND attempt_token=$2`,
  [row.id,args.attempt_token,bytes,sha(bytes),args.receipt.http_status,args.receipt.complete,args.receipt.provider_request_id,
   args.receipt.complete&&args.receipt.http_status===200?'response_persisted':'outcome_unknown']);
  return{call_id:row.id,replayed:false};
 });
}
export async function settleMonitoringInsightCallV1(args:{database:Database;call_id:string;attempt_token:string}){
 const result=await transaction(args.database,'write',async client=>{
  await lockCallMoney(client,args.call_id);
  const row=(await client.query<Call>('SELECT * FROM signal_monitoring_insight_calls WHERE id=$1 AND attempt_token=$2',[args.call_id,args.attempt_token])).rows[0];
  if(!row)fail('monitoring_insights_call_scope_invalid');
  if(row.state==='settled')return{usage:row.usage,cost_micro_usd:Number(row.settled_micro_usd)};
  if(!row.response_body||!row.response_complete||row.response_http_status!==200)return null;
  let measured:ReturnType<typeof workspaceMonitoringInsightUsageFromRawV1>;
  try{measured=workspaceMonitoringInsightUsageFromRawV1(row.response_body.toString('utf8'));}
  catch{
   await client.query(`UPDATE signal_monitoring_insight_calls SET state='outcome_unknown',error_code='monitoring_insights_usage_invalid',updated_at=clock_timestamp()
    WHERE id=$1 AND state='response_persisted'`,[row.id]);return null;
  }
  const updated=await client.query(`UPDATE signal_monitoring_insight_calls SET state='settled',usage=$3,settled_micro_usd=$4,
   settled_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND attempt_token=$2 AND state='response_persisted' RETURNING id`,
  [row.id,args.attempt_token,JSON.stringify(measured.value.usage),measured.cost_micro_usd]);
  if(updated.rows.length!==1)fail('monitoring_insights_usage_unresolved');
  return{usage:measured.usage,cost_micro_usd:measured.cost_micro_usd};
 });
 if(!result)fail('monitoring_insights_usage_unresolved');return result;
}
export async function completeMonitoringInsightRunV1(args:{database:Database;lease:MonitoringInsightLeaseV1;call_id:string}):Promise<{run_id:string;status:'completed'}>{
 return transaction(args.database,'write',async client=>{
  const row=await lockedLease(client,args.lease);
  const call=(await client.query<Call>(`SELECT * FROM signal_monitoring_insight_calls WHERE id=$1 AND run_id=$2
   AND workspace_id=$3 AND state='settled'`,[args.call_id,row.id,row.workspace_id])).rows[0];
  if(!call?.response_body)fail('monitoring_insights_receipt_required');
  let parsed:ReturnType<typeof parseWorkspaceMonitoringInsightReceiptV1>;
  try{parsed=parseWorkspaceMonitoringInsightReceiptV1(requestFromRun(row),call.response_body.toString('utf8'));}
  catch{throw new MonitoringInsightsError('monitoring_insights_response_invalid');}
  await client.query(`UPDATE signal_monitoring_insight_runs SET status='completed',result=$2,result_call_id=$3,
   execution_token=NULL,execution_expires_at=NULL,error_code=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,
  [row.id,JSON.stringify(parsed.editorial),call.id]);
  return{run_id:row.id,status:'completed'};
 });
}
export async function failMonitoringInsightRunV1(args:{database:Database;lease:MonitoringInsightLeaseV1;call_id?:string;attempt_token?:string;
 outcome:'definitely_not_sent'|'outcome_unknown'|'local_failure';error_code:string}){
 if(!/^monitoring_insights_[a-z_]{1,100}$/.test(args.error_code))fail('monitoring_insights_error_invalid',422);
 return transaction(args.database,'write',async client=>{
  // Monetary updates lock the original day even after authority expires. A paid
  // receipt is evidence, never a new permission to reserve/send.
  const money=(await client.query<{organization_id:string;budget_date:string}>(`SELECT a.organization_id,a.budget_date::text
   FROM signal_monitoring_insight_runs r JOIN signal_processing_admissions a ON a.id=r.admission_id WHERE r.id=$1`,[args.lease.run_id])).rows[0];
  if(!money)fail('monitoring_insights_lease_lost');
  await client.query('SELECT signal_processing_lock_v1($1,$2::date)',[money.organization_id,money.budget_date]);
  const row=await lockedLease(client,args.lease);
  const call=(await client.query<Call>('SELECT * FROM signal_monitoring_insight_calls WHERE run_id=$1 FOR UPDATE',[row.id])).rows[0];
  if(args.call_id&&(!call||call.id!==args.call_id||call.attempt_token!==args.attempt_token))fail('monitoring_insights_call_scope_invalid');
  if(call&&!['settled','definitely_not_sent','response_persisted'].includes(call.state)){
   const state=args.outcome==='definitely_not_sent'&&!call.response_body?'definitely_not_sent':call.state==='reserved'&&args.outcome==='local_failure'?'definitely_not_sent':'outcome_unknown';
   await client.query('UPDATE signal_monitoring_insight_calls SET state=$2,error_code=$3,updated_at=clock_timestamp() WHERE id=$1',[call.id,state,args.error_code]);
   call.state=state;
  }
  const unknown=call?.state==='outcome_unknown'||call?.state==='in_flight';
  await client.query(`UPDATE signal_monitoring_insight_runs SET status=$2,error_code=$3,execution_token=NULL,
   execution_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,[row.id,unknown?'outcome_unknown':'failed',args.error_code]);
  return{run_id:row.id,status:unknown?'outcome_unknown' as const:'failed' as const};
 });
}
