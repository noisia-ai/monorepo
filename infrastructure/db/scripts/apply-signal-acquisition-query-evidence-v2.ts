import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import pg from "pg";

const root=resolve(import.meta.dirname,"../../..");
const requireFromStudio=createRequire(resolve(root,"apps/studio/package.json"));
const {parse}=requireFromStudio("dotenv") as typeof import("dotenv");
const mode=process.argv[2];
const expectedProtectedState=process.argv[3]??null;
const target=process.env.NOISIA_REMOTE_DATABASE_TARGET;
const local=target==="local"&&process.env.NOISIA_SIGNAL_QUERY_EVIDENCE_LOCAL_REHEARSAL==="true";
const restoreAt=process.env.NOISIA_SIGNAL_QUERY_EVIDENCE_RESTORE_POINT_AT;
const restoreHash=process.env.NOISIA_SIGNAL_QUERY_EVIDENCE_RESTORE_POINT_HASH;
const approved=process.env.NOISIA_SIGNAL_QUERY_EVIDENCE_APPLY_APPROVED==="true";
const noApps=process.env.NOISIA_SIGNAL_QUERY_EVIDENCE_NO_APPS_CONFIRMED==="true";
const appName="noisia-signal-acquisition-query-evidence-v2";
const lockKey="noisia:signal-acquisition-query-evidence:v2";
const migration={
  ordinal:88,filename:"0088_signal_acquisition_query_evidence_v2.sql",
  checksum:"sha256:11f28c563f64f8f17d5961d9bd0b9779d48663a4529b4b2025a4f53235f9dfb4"
} as const;
const prerequisites=[
  [84,"0084_signal_acquisition_plan_control_plane.sql","sha256:d959f17e1af5378d798bc1ca089bc6802bf6c3e8455a6054a98aeec3359fd26b"],
  [85,"0085_signal_workspace_query_composer.sql","sha256:f36a32c1562147c0c94e7e00927d04902f4c4c3df446a5b28ea8ea3ff7b419d4"],
  [86,"0086_signal_acquisition_query_review.sql","sha256:8fda9ce4e45c8464be9cad10ab2a2df0859a6e3d7d03a731d977a3d088dac2b1"],
  [87,"0087_signal_classification_authority.sql","sha256:fd62b7dd637e62475dcce0eedbbdfc021906b2a1d72a742f74a28e5851ab48d3"]
] as const;
const expected={
  direct:"sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  pooler:"sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  project:"sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32"
} as const;

if(!["preflight","apply","verify"].includes(mode??""))throw new Error("Mode must be preflight, apply or verify.");
if(target!=="noisia-staging"&&!local)throw new Error("Only noisia-staging or explicit local rehearsal is authorized.");
if(mode==="apply"&&!local){
  if(!approved||!noApps)throw new Error("Apply requires explicit migration and zero-app acknowledgements.");
  if(!restoreAt||!restoreHash?.match(/^sha256:[0-9a-f]{64}$/u))throw new Error("Apply requires a fresh verified restore point.");
  const age=(Date.now()-Date.parse(restoreAt))/3_600_000;
  if(!Number.isFinite(age)||age<0||age>24)throw new Error("Restore point must be less than 24 hours old.");
}

const env=parse(await readFile(resolve(root,"apps/studio/.env.local"),"utf8"));
const poolerUrl=local?process.env.NOISIA_SIGNAL_QUERY_EVIDENCE_DATABASE_URL?.trim():env.DATABASE_URL?.trim();
if(!poolerUrl||(!local&&env.DATABASE_SSL!=="true"))throw new Error("Canonical database configuration is unavailable.");
const directUrl=local?poolerUrl:deriveDirect(poolerUrl);
if(!local&&(fingerprint(poolerUrl)!==expected.pooler||fingerprint(directUrl)!==expected.direct
    ||projectHash(poolerUrl,"pooler")!==expected.project||projectHash(directUrl,"direct")!==expected.project)){
  throw new Error("Direct/pooler target identity mismatch.");
}
const sql=await readFile(resolve(root,"infrastructure/db/migrations",migration.filename),"utf8");
if(sha256(sql)!==migration.checksum)throw new Error("0088 checksum mismatch.");

const client=new pg.Client({connectionString:directUrl,ssl:local?false:{rejectUnauthorized:false},application_name:appName});
await client.connect();
try{
  await configure(client);
  const before=await inspect(client);
  const peer=local?before:await inspectPeer(poolerUrl);
  assertPeer(before,peer);
  const activity=await inspectActivity(client,false);
  if(before.state==="partial")throw new Error("0088 partial or divergent state is blocked.");
  if(mode==="preflight")emit({mode,writes_performed:false,before,activity});
  else if(mode==="verify"){
    if(before.state!=="complete")throw new Error("0088 is not complete.");
    emit({mode,writes_performed:false,before,activity});
  }else if(before.state==="complete"){
    emit({mode,action:"verified_existing",writes_performed:false,before,activity});
  }else{
    if(expectedProtectedState!==before.protected_state_hash)throw new Error("Protected-state compare-and-swap failed.");
    assertNoRunnableWork(before.runnable_work);
    await inspectActivity(client,true);
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[lockKey]);
    try{
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try{
        await client.query("SET LOCAL statement_timeout='10min'");
        await client.query("SET LOCAL lock_timeout='30s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout='15min'");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${lockKey}:88`]);
        const locked=await inspect(client);
        if(locked.state!=="absent"||locked.protected_state_hash!==expectedProtectedState){
          throw new Error("Locked 0088 precondition or protected-state CAS failed.");
        }
        assertNoRunnableWork(locked.runnable_work);
        await client.query(sql);
        const sentinels=await inspectSentinels(client);
        if(sentinels.present!==sentinels.expected)throw new Error("0088 sentinels failed before ledger registration.");
        if(await protectedState(client)!==expectedProtectedState)throw new Error("0088 changed protected logical state.");
        await client.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
          migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
        )VALUES($1,88,$2,'applied','signal-query-evidence-v2-runner-v1',$3)`,[
          migration.filename,migration.checksum,local?fingerprint(directUrl):expected.direct]);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    }finally{await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[lockKey]);}
    const after=await inspect(client);
    const peerAfter=local?after:await inspectPeer(poolerUrl);
    assertPeer(after,peerAfter);
    if(after.state!=="complete"||after.protected_state_hash!==before.protected_state_hash){
      throw new Error("0088 post-apply verification failed.");
    }
    assertNoRunnableWork(after.runnable_work);
    emit({mode,action:"applied",writes_performed:true,before,after,activity});
  }
}finally{await client.end();}

async function configure(value:pg.Client){
  await value.query("SET statement_timeout='10min'");
  await value.query("SET lock_timeout='30s'");
  await value.query("SET idle_in_transaction_session_timeout='15min'");
}

async function inspect(value:pg.Client){
  await assertPrerequisites(value);
  const sentinels=await inspectSentinels(value);
  const ledger=await value.query<{count:number}>(`SELECT count(*)::int count
    FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal=88 AND migration_name=$1 AND checksum_sha256=$2 AND disposition='applied'`,[
    migration.filename,migration.checksum]);
  const anyLedger=await value.query<{count:number}>(`SELECT count(*)::int count
    FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=88`);
  const newColumns=await value.query<{count:number}>(`SELECT count(*)::int count FROM information_schema.columns
    WHERE table_schema='public' AND ((table_name='import_batches' AND column_name IN(
      'acquisition_query_evidence_class','acquisition_query_evidence_reason',
      'acquisition_query_evidence_actor_user_id','acquisition_query_evidence_attested_at',
      'provider_execution_reference_hash','provider_execution_adapter_key',
      'provider_execution_verified_at','acquisition_import_seal_digest'))
      OR(table_name='signal_mention_attributions' AND column_name IN(
      'acquisition_query_evidence_class','acquisition_query_version_id',
      'acquisition_query_evidence_actor_user_id')))`);
  const correctLedger=ledger.rows[0]!.count,allLedger=anyLedger.rows[0]!.count;
  const state=newColumns.rows[0]!.count===0&&allLedger===0?"absent"
    :sentinels.present===sentinels.expected&&correctLedger===1&&allLedger===1?"complete":"partial";
  const protectedDomains=await protectedData(value);
  return {state,ledger_count:allLedger,sentinels,
    protected_state_hash:sha256(stable(protectedDomains)),
    protected_counts:Object.fromEntries(Object.entries(protectedDomains).map(([key,item])=>[key,item.row_count])),
    runnable_work:await runnableWork(value)};
}

async function assertPrerequisites(value:pg.Client){
  const rows=await value.query<{ordinal:number;migration_name:string;checksum_sha256:string;disposition:string}>(`
    SELECT ordinal,migration_name,checksum_sha256,disposition
    FROM signal_workspace_data_plane_migration_ledger WHERE ordinal BETWEEN 84 AND 87 ORDER BY ordinal`);
  if(rows.rowCount!==4||prerequisites.some(([ordinal,name,checksum],index)=>{
    const row=rows.rows[index];return row?.ordinal!==ordinal||row.migration_name!==name
      ||row.checksum_sha256!==checksum||row.disposition!=="applied";
  }))throw new Error("0084-0087 ledger prerequisite is invalid.");
}

async function inspectSentinels(value:pg.Client){
  const result=await value.query<{present:number}>(`SELECT(
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND table_name='import_batches' AND column_name IN(
       'acquisition_query_evidence_class','acquisition_query_evidence_reason',
       'acquisition_query_evidence_actor_user_id','acquisition_query_evidence_attested_at',
       'provider_execution_reference_hash','provider_execution_adapter_key',
       'provider_execution_verified_at','acquisition_import_seal_digest'))+
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND table_name='signal_mention_attributions' AND column_name IN(
       'acquisition_query_evidence_class','acquisition_query_version_id',
       'acquisition_query_evidence_actor_user_id'))+
    (to_regclass('idx_import_batches_query_evidence') IS NOT NULL)::int+
    (to_regprocedure('validate_signal_source_intent_query_evidence_v2()') IS NOT NULL)::int+
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='validate_signal_source_intent_query_evidence_v2'
      AND NOT tgisinternal)::int+
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='import_batches_acquisition_shape'
      AND pg_get_constraintdef(oid) LIKE '%signal-acquisition-import-v2%')::int+
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_mention_attribution_query_evidence_shape'
      AND pg_get_constraintdef(oid) LIKE '%sealed_acquisition_slot_v2%')::int+
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_mention_attribution_query_evidence_fk')::int+
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='record_signal_workspace_import_provenance_v1'
      AND pg_get_functiondef(oid) LIKE '%signal-acquisition-import-v2%')::int+
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='materialize_signal_workspace_import_source_intent_v1'
      AND pg_get_functiondef(oid) LIKE '%sealed_acquisition_slot_v2%')::int+
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='create_signal_workspace_import_storage_recovery_v1'
      AND pg_get_functiondef(oid) LIKE '%acquisition_query_evidence_class%')::int+
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='enforce_signal_acquisition_recovery_seal_v1'
      AND pg_get_functiondef(oid) LIKE '%acquisition_import_seal_digest%')::int
  )::int present`);
  return {present:result.rows[0]!.present,expected:21};
}

async function protectedState(value:pg.Client){return sha256(stable(await protectedData(value)));}
async function protectedData(value:pg.Client){
  const domains=[
    ["brands",`SELECT to_jsonb(row_value) value FROM brands row_value`],
    ["workspaces",`SELECT to_jsonb(row_value) value FROM signal_workspaces row_value`],
    ["imports",`SELECT to_jsonb(row_value)-ARRAY['acquisition_query_evidence_class',
      'acquisition_query_evidence_reason','acquisition_query_evidence_actor_user_id',
      'acquisition_query_evidence_attested_at','provider_execution_reference_hash',
      'provider_execution_adapter_key','provider_execution_verified_at','acquisition_import_seal_digest'] value
      FROM import_batches row_value`],
    ["mentions",`SELECT to_jsonb(row_value)-ARRAY['text_raw','text_clean','text_snippet','title','url','raw_metadata'] value FROM mentions row_value`],
    ["attributions",`SELECT to_jsonb(row_value)-ARRAY['acquisition_query_evidence_class',
      'acquisition_query_version_id','acquisition_query_evidence_actor_user_id'] value FROM signal_mention_attributions row_value`],
    ["import_memberships",`SELECT to_jsonb(row_value) value FROM signal_mention_import_memberships row_value`],
    ["plans",`SELECT to_jsonb(row_value) value FROM signal_acquisition_plans row_value`],
    ["slots",`SELECT to_jsonb(row_value) value FROM signal_acquisition_slots row_value`],
    ["queries",`SELECT to_jsonb(row_value) value FROM signal_acquisition_query_versions row_value`],
    ["provider_observations",`SELECT to_jsonb(row_value) value FROM signal_provider_mention_observations row_value`],
    ["population_pointers",`SELECT to_jsonb(row_value) value FROM signal_workspace_population_pointers row_value`],
    ["governed_bindings",`SELECT to_jsonb(row_value) value FROM signal_governed_view_bindings row_value`]
  ] as const;
  const output:Record<string,{row_count:number;digest:string}>={};
  for(const [name,projection] of domains){
    const row=await value.query<{row_count:number;digest:string}>(`SELECT count(*)::int row_count,
      'sha256:'||encode(sha256(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),'')::bytea),'hex') digest
      FROM(SELECT sha256(convert_to(value::text,'UTF8')) row_hash FROM(${projection}) rows) hashed`);
    output[name]=row.rows[0]!;
  }
  return output;
}

async function runnableWork(value:pg.Client){
  const row=await value.query<Record<string,number>>(`SELECT
    (SELECT count(*)::int FROM signal_semantic_resolution_runs WHERE status IN('queued','running')) semantic_resolution_runs,
    (SELECT count(*)::int FROM signal_strategic_run_controls WHERE status IN('queued','running')) strategic_runs,
    (SELECT count(*)::int FROM signal_workspace_import_outbox outbox JOIN import_batches batch
      ON batch.id=outbox.import_batch_id WHERE batch.status='queued' AND(
      outbox.status IN('pending','failed') AND outbox.available_at<=now()
      OR outbox.status='dispatching' AND outbox.lease_expires_at<now())) import_outbox,
    (SELECT count(*)::int FROM signal_refresh_runs WHERE status IN('queued','running')) refresh_runs`);
  return row.rows[0]!;
}
function assertNoRunnableWork(value:Record<string,number>){
  if(Object.values(value).some((count)=>count!==0))throw new Error("Runnable work exists; migration is blocked.");
}
async function inspectActivity(value:pg.Client,enforce:boolean){
  const row=await value.query<{incompatible:number;writers:number;named_apps:number}>(`SELECT
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND state IS DISTINCT FROM 'idle' AND application_name<>$1)::int incompatible,
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND state IS DISTINCT FROM 'idle' AND query!~*'^\\s*(select|show|set|begin|commit|rollback)')::int writers,
    count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
      AND COALESCE(application_name,'')~*'(studio|worker|bullmq|next)')::int named_apps
    FROM pg_stat_activity WHERE datname=current_database()`,[appName]);
  const result=row.rows[0]!;
  if(enforce&&(result.incompatible||result.writers||result.named_apps))throw new Error("Incompatible staging activity detected.");
  return result;
}
async function inspectPeer(url:string){
  const peer=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false},application_name:`${appName}-peer`});
  await peer.connect();try{await configure(peer);return await inspect(peer);}finally{await peer.end();}
}
function assertPeer(left:Awaited<ReturnType<typeof inspect>>,right:Awaited<ReturnType<typeof inspect>>){
  if(left.state!==right.state||left.ledger_count!==right.ledger_count
      ||left.protected_state_hash!==right.protected_state_hash)throw new Error("Direct/pooler state mismatch.");
}
function deriveDirect(value:string){
  const parsed=new URL(value);const ref=/^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];
  if(!ref)throw new Error("Canonical connection is not the audited pooler shape.");
  parsed.hostname=`db.${ref}.supabase.co`;parsed.port="5432";parsed.username="postgres";return parsed.toString();
}
function fingerprint(value:string){const parsed=new URL(value);return sha256([
  parsed.protocol,parsed.hostname.toLowerCase(),parsed.port||"5432",parsed.pathname.replace(/^\//u,""),parsed.username].join("|"));}
function projectHash(value:string,kind:"direct"|"pooler"){
  const parsed=new URL(value);const ref=kind==="direct"
    ?/^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname)?.[1]
    :/^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username))?.[1];
  if(!ref)throw new Error("Project identity unavailable.");return sha256(ref);
}
function sha256(value:string){return `sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stable(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.entries(value as Record<string,unknown>)
    .sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function emit(value:Record<string,unknown>){
  const age=restoreAt?(Date.now()-Date.parse(restoreAt))/3_600_000:null;
  process.stdout.write(`${JSON.stringify({contract_version:"signal-acquisition-query-evidence-v2-migration-runner-v1",
    target:local?"local-rehearsal":"noisia-staging",
    direct_fingerprint:local?fingerprint(directUrl):expected.direct,
    pooler_fingerprint:local?fingerprint(poolerUrl!):expected.pooler,
    project_ref_hash:local?null:expected.project,migration,
    restore_point:restoreAt&&restoreHash?{reference_hash:restoreHash,at:restoreAt,age_hours:Number(age!.toFixed(2))}:null,
    ...value},null,2)}\n`);
}
