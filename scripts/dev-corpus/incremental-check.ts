/** Opt-in remote PG contract check; reuses the real fit, rolls back all DDL/data, sends no provider requests. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import type {SignalWorkspaceEngineDatabaseV1} from "../../infrastructure/db/signal-workspace-engine";
type Pool=SignalWorkspaceEngineDatabaseV1 & {end():Promise<void>};
import {main,openDatabase} from "./guard.mjs";
import {beginSignalWorkspaceIncrementalEngineV1,readSignalWorkspaceIncrementalRootsV1} from "../../infrastructure/db/signal-workspace-engine-incremental";
import {claimSignalWorkspaceEngineV1,loadSignalWorkspaceEnginePreflightV1} from "../../infrastructure/db/signal-workspace-engine";
import {admitSignalProcessingWithClientV1} from "../../infrastructure/db/signal-processing-policy";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "../../infrastructure/db/signal-workspace-capabilities";

await main(async()=>{
 if(!process.argv.includes("--rollback-check"))throw Error("mfp_rollback_check_required");
 const identity=JSON.parse(await readFile(process.env.NOISIA_MFP_IDENTITY_FILE??".data/dev-corpus/identity.json","utf8")) as {
  workspace_id:string;brand_id:string;internal_user_id:string};
 const pool:Pool=await openDatabase(),raw=await pool.connect();
 const priorFlag=process.env.NOISIA_MENTION_FACETS_ENABLED;
 let phase="preflight",transaction=false,serial=0,tamper=false;const stack:string[]=[];
 const report=(next:string)=>{phase=next;console.log(JSON.stringify({phase}));};
 const query=async(sql:string,values?:unknown[])=>{
  if(sql.startsWith("BEGIN")){const name=`mfp_incremental_${++serial}`;stack.push(name);return raw.query(`SAVEPOINT ${name}`);}
  if(sql==="COMMIT")return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==="ROLLBACK"){const name=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${name}`);return raw.query(`RELEASE SAVEPOINT ${name}`);}
  if(tamper&&sql.startsWith("INSERT INTO signal_topic_catalog_executions(")){
   const altered=[...values!],snapshot=JSON.parse(String(altered[14]));
   snapshot.numeric_descriptor.discovery.residual_root_ids=[randomUUID()];altered[14]=JSON.stringify(snapshot);
   return raw.query(sql,altered);
  }
  return raw.query(sql,values);
 };
 const database=Object.assign(Object.create(pool),{query,connect:async()=>Object.assign(Object.create(raw),{query,release(){}})}) as Pool;
 const census=async()=>(await raw.query(`SELECT
  (SELECT count(*)::int FROM signal_topic_catalog_executions WHERE workspace_id=$1) executions,
  (SELECT count(*)::int FROM engine_cost_events WHERE workspace_id=$1) calls,
  (SELECT COALESCE(sum(settled_micro_usd),0)::text FROM engine_cost_events WHERE workspace_id=$1) settled,
  (SELECT count(*)::int FROM signal_processing_admissions WHERE workspace_id=$1) admissions,
  (SELECT count(*)::int FROM signal_processing_policy_versions WHERE organization_id=(SELECT organization_id FROM signal_workspaces WHERE id=$1)) policies`,[identity.workspace_id])).rows[0];
 const deny=async(run:()=>Promise<unknown>,pattern:RegExp)=>{
  await raw.query("SAVEPOINT rejection");try{await assert.rejects(run,pattern);}
  finally{await raw.query("ROLLBACK TO SAVEPOINT rejection");await raw.query("RELEASE SAVEPOINT rejection");}
 };
 try{
  const baseline=await census();
  assert.equal((await raw.query(`SELECT count(*)::int n FROM signal_topic_catalog_executions WHERE workspace_id=$1 AND status IN('queued','running')`,[identity.workspace_id])).rows[0].n,0,"mfp_active_execution");
  await raw.query("BEGIN ISOLATION LEVEL READ COMMITTED");transaction=true;
  await raw.query("SET LOCAL statement_timeout='90s'");
  process.env.NOISIA_MENTION_FACETS_ENABLED="true";
  report("forward_ddl_rollback");
  for(const [file,probe] of [
   ["0237_signal_discovery_incremental.sql","SELECT position('residual_root_ids' IN pg_get_functiondef('guard_signal_workspace_engine_v1()'::regprocedure))>0 present"],
   ["0238_signal_discovery_incremental_editorial.sql","SELECT to_regprocedure('signal_workspace_incremental_editorial_actor_v1(uuid,uuid,uuid)') IS NOT NULL present"]
  ])if(!(await raw.query(probe!)).rows[0].present)await raw.query(await readFile(new URL(`../../infrastructure/db/migrations/${file}`,import.meta.url),"utf8"));
  const scope=(await raw.query<{organization_id:string;brand_id:string}>("SELECT organization_id,brand_id FROM signal_workspaces WHERE id=$1",[identity.workspace_id])).rows[0]!;
  assert.equal(scope.brand_id,identity.brand_id);
  const parent=(await raw.query<{id:string;config:Record<string,unknown>;roots:number;chunks:number}>(`SELECT id,input_snapshot->'engine_config' config,
   denominator::int roots,expected_chunks::int chunks FROM signal_topic_catalog_executions WHERE workspace_id=$1 AND input_contract='workspace-topic-engine-v1'
   AND input_snapshot ? 'discovery_population' AND NOT input_snapshot ? 'numeric_descriptor' AND status='ready'
   AND result_summary ? 'fit_checkpoint' ORDER BY created_at DESC LIMIT 1`,[identity.workspace_id])).rows[0];
  assert.ok(parent,"mfp_real_parent_required");
  const actor=randomUUID();
  await raw.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
   VALUES($1,$2,'Synthetic incremental rollback client','client','client_admin',$3,'active')`,[actor,`${actor}@fixture.example.test`,scope.organization_id]);
  await raw.query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1,$2,'admin')",[actor,identity.brand_id]);
  const access={database,workspace_id:identity.workspace_id,actor_user_id:actor};
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:database,...access});assert.equal(caps.can_request_processing,true);assert.equal(caps.can_execute_topics,false);
  const current=(await raw.query<{id:string;budget_timezone:string;created_by_user_id:string}>("SELECT id,budget_timezone,created_by_user_id FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'",[scope.organization_id])).rows[0]!;
  assert.ok(current,"mfp_active_policy_required");
  let totalRoots=0,totalChunks=0;
  for(const scenario of [{until:"infinity",cap:null,daily:null},{until:"2030-01-02T03:04:05.000Z",cap:2_000_000,daily:20_000_000}] as const){
   await raw.query("SAVEPOINT scenario");report(scenario.cap===null?"unlimited_numeric_admission":"explicit_finite_policy");
   const policy=randomUUID();
   await raw.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
    SELECT $1,$2,max(version)+1,'draft',clock_timestamp()-interval '1 second',$3::timestamptz,$4,$6::bigint,$5 FROM signal_processing_policy_versions WHERE organization_id=$2`,
    [policy,scope.organization_id,scenario.until,current.budget_timezone,current.created_by_user_id,scenario.daily]);
   await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    SELECT $1,action,kind,provider,model,configuration,configuration_digest,CASE WHEN action='topic_interpretation' THEN $3::bigint ELSE max_execution_micro_usd END,automatic_allowed
    FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action<>'topic_fit_incremental'`,[policy,current.id,scenario.cap]);
   await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    VALUES($1,'topic_fit_incremental','free','{}',signal_semantic_context_digest_json_v2('{}'),0,true)`,[policy]);
   await raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[current.id]);
   await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[policy]);
   report("preflight_numeric");const preflight=await loadSignalWorkspaceEnginePreflightV1(access);assert.ok(preflight.embedding_run_id);
   const request:Parameters<typeof beginSignalWorkspaceIncrementalEngineV1>[0]={...access,embedding_run_id:preflight.embedding_run_id,idempotency_key:randomUUID(),engine_config:parent.config,
    expected_context_digest:preflight.expected_context_digest,expected_catalog_digest:preflight.expected_catalog_digest,
    parent_execution_id:parent.id,close_requested:true};
   report("tampered_residual");tamper=true;try{await assert.rejects(beginSignalWorkspaceIncrementalEngineV1({...request,idempotency_key:randomUUID()}),/discovery residual is stale/);}
   finally{tamper=false;}
   report("begin_numeric");const started=await beginSignalWorkspaceIncrementalEngineV1(request);
   report("replay_numeric");assert.deepEqual(await beginSignalWorkspaceIncrementalEngineV1(request),{...started,replayed:true});
   const readPolicy=async()=>(await raw.query("SELECT workspace_incremental_editorial_policy_v1($1) value",[started.execution_id])).rows[0].value;
   report("editorial_policy");const editorial=await readPolicy();assert.equal(editorial.daily_cap_micro_usd,scenario.daily);assert.equal(editorial.maximum_cap_micro_usd,scenario.cap);
   assert.equal(editorial.valid_until,scenario.until==="infinity"?"9999-12-31T23:59:59.999Z":scenario.until);
   assert.equal((await raw.query("SELECT valid_until::text value FROM signal_processing_policy_versions WHERE id=$1",[policy])).rows[0].value==="infinity",scenario.until==="infinity");
   const money={queryable:raw,workspace_id:identity.workspace_id,actor_user_id:actor,action:"topic_interpretation" as const,
    target_id:randomUUID(),idempotency_key:randomUUID(),request_digest:`sha256:${"a".repeat(64)}`,execution_cap_micro_usd:null};
   if(scenario.cap!==null)await deny(()=>admitSignalProcessingWithClientV1(raw,money),/cap/);
   else await admitSignalProcessingWithClientV1(raw,money);
   await raw.query("SAVEPOINT revoked_policy");await raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[policy]);
   assert.equal(await readPolicy(),null);
   await deny(()=>admitSignalProcessingWithClientV1(raw,{...money,target_id:randomUUID(),idempotency_key:randomUUID()}),/policy/);
   await raw.query("ROLLBACK TO SAVEPOINT revoked_policy");await raw.query("RELEASE SAVEPOINT revoked_policy");
   await raw.query("SAVEPOINT revoked_actor");await raw.query("UPDATE users SET status='inactive' WHERE id=$1",[actor]);
   assert.equal((await raw.query("SELECT signal_workspace_incremental_editorial_actor_v1($1,$2,$3) allowed",[identity.workspace_id,actor,started.execution_id])).rows[0].allowed,false);
   await deny(()=>beginSignalWorkspaceIncrementalEngineV1(request),/forbidden/);
   await raw.query("ROLLBACK TO SAVEPOINT revoked_actor");await raw.query("RELEASE SAVEPOINT revoked_actor");
   report("claim_numeric");const lease=await claimSignalWorkspaceEngineV1({database,execution_id:started.execution_id,worker_job_id:`mfp-rollback-${started.execution_id}`});assert.ok(lease);
   let cursor:string|null=null;totalRoots=0;totalChunks=0;
   for(;;){const page=await readSignalWorkspaceIncrementalRootsV1({database,lease,after_root_id:cursor,limit:200});
    totalRoots+=page.items.length;totalChunks+=page.items.reduce((sum,row)=>sum+row.expected_chunks,0);cursor=page.next_cursor;if(page.done)break;}
   assert.equal(totalRoots,lease.snapshot.expected_roots);assert.equal(totalChunks,lease.snapshot.expected_chunks);
   if(process.argv.includes("--editorial-check")){
    const {checkMfpIncrementalEditorialV1}=await import("./incremental-editorial-check");
    await checkMfpIncrementalEditorialV1({database,query,lease,report,cap:scenario.cap,policy_id:policy});
   }
   await raw.query("SET CONSTRAINTS ALL IMMEDIATE");
   await raw.query("ROLLBACK TO SAVEPOINT scenario");await raw.query("RELEASE SAVEPOINT scenario");
  }
  report("rollback");await raw.query("ROLLBACK");transaction=false;assert.deepEqual(await census(),baseline);
  console.log(JSON.stringify({stage:"mfp_incremental_pg",status:"passed",rollback:true,reused_real_parent:true,selected_roots:totalRoots,
   selected_chunks:totalChunks,residual_tamper_rejected:true,finite_expiry_preserved:true,infinity_transport_only:true,revocation_enforced:true,provider_calls:0,cost_micro_usd:0}));
 }catch(error){const diagnostic=(value:unknown):Record<string,unknown>=>{
   if(!value||typeof value!=="object")return{};
   const e=value as {name?:string;code?:string;message?:string;stack?:string;actual?:unknown};
   const message=e.message??"";
   return{name:e.name,code:e.code,
    ...( /^(?:workspace_|processing_|mfp_)[a-z_]+$/.test(message)||/^Engine [a-zA-Z .]+\.$/.test(message)?{message}:{}),
    frame:e.stack?.split("\n").find(line=>line.trim().startsWith("at "))?.replace(/\([^)]*\//,"("),
    ...(e.actual instanceof Error?{actual:diagnostic(e.actual)}:{})};
  };console.error(JSON.stringify({stage:"mfp_incremental_pg",status:"failed",phase,...diagnostic(error)}));throw error;}
 finally{if(transaction)await raw.query("ROLLBACK");if(priorFlag===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=priorFlag;raw.release();await pool.end();}
});
