import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {resolve} from "node:path";

import pg from "pg";

const root=resolve(import.meta.dirname,"../../..");
const requireFromStudio=createRequire(resolve(root,"apps/studio/package.json"));
const {parse}=requireFromStudio("dotenv") as typeof import("dotenv");
const mode=process.argv[2];
const expectedProtected=process.argv[3]??null;
const restoreAt=process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_RESTORE_POINT_AT;
const restoreHash=process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_RESTORE_POINT_HASH;
const target=process.env.NOISIA_REMOTE_DATABASE_TARGET;
const localRehearsal=target==="local"
  &&process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_LOCAL_REHEARSAL==="true";
const filename="0082_signal_semantic_review_resolution_scale.sql";
const appName="noisia-semantic-review-scale-migration";
const expected={
  direct:"sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  pooler:"sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  project:"sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32",
  prior:new Map<number,string>([
    [77,"sha256:64b8302b598744807e6dba2aafd0d3e99f8e49192767cbcc82f70e02921f128c"],
    [78,"sha256:5496e56013711267fe009298ee4ba69b9a43f1cade4335a8d89a14af7c40b96e"],
    [79,"sha256:dbd1c0d32760666f7d81ea510e271cda2aaf31d29ec38c44250f7337cc242246"],
    [80,"sha256:b17b63a1f7c153338ea16758c1ed01b89fc8dd5c1f7cc1b66f291e8950413ed7"],
    [81,"sha256:d351a6e2958b88ad64afbb692b8f5c7cdfd55f1380c3c42babfee231759234de"]
  ]),
  migration82:"sha256:f000bfffe4378c36dad444aaf18235e9ce7ba50cff83c87803f519096b024c25"
} as const;

if(!(["preflight","apply","verify"] as const).includes(mode as "preflight")){
  throw new Error("Mode must be preflight, apply or verify.");
}
if(target!=="noisia-staging"&&!localRehearsal)throw new Error("Only noisia-staging or an explicit local rehearsal is authorized.");
if(!localRehearsal&&(!restoreAt||!restoreHash?.match(/^sha256:[0-9a-f]{64}$/u))){
  throw new Error("A newly verified restore point is required.");
}
const restoreAgeHours=localRehearsal?0:(Date.now()-Date.parse(restoreAt!))/3_600_000;
if(!localRehearsal&&(!Number.isFinite(restoreAgeHours)||restoreAgeHours<0||restoreAgeHours>24)){
  throw new Error("The restore point must be verified and less than 24 hours old.");
}
if(mode==="apply"&&(process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_MIGRATION_APPROVED!=="true"
    ||process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_NO_APPS_CONFIRMED!=="true")){
  throw new Error("Apply requires the migration and zero-app acknowledgements.");
}

const env=parse(await readFile(resolve(root,"apps/studio/.env.local"),"utf8"));
const poolerUrl=localRehearsal?process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_DATABASE_URL?.trim():env.DATABASE_URL?.trim();
if(!poolerUrl||(!localRehearsal&&env.DATABASE_SSL!=="true"))throw new Error("Canonical database configuration is unavailable.");
const directUrl=localRehearsal?poolerUrl:deriveDirect(poolerUrl);
if(!localRehearsal&&(fingerprint(poolerUrl)!==expected.pooler||fingerprint(directUrl)!==expected.direct
    ||projectHash(poolerUrl,"pooler")!==expected.project||projectHash(directUrl,"direct")!==expected.project)){
  throw new Error("Direct/pooler target identity mismatch.");
}
const migration=await readFile(resolve(root,"infrastructure/db/migrations",filename),"utf8");
if(sha256(migration)!==expected.migration82)throw new Error("0082 checksum mismatch.");

const direct=new pg.Client({connectionString:directUrl,ssl:localRehearsal?false:{rejectUnauthorized:false},application_name:appName});
await direct.connect();
try{
  await configure(direct);
  const before=await inspect(direct);
  const peer=await inspectPeer(poolerUrl);
  assertSame(before,peer);
  const activity=await inspectActivity(direct);
  if(before.state==="partial")throw new Error("0082 partial state is blocked.");
  if(mode==="preflight")emit({mode,state:before.state,writes_performed:false,before,activity});
  else if(mode==="verify"){
    if(before.state!=="complete")throw new Error("0082 is not complete.");
    emit({mode,state:before.state,writes_performed:false,before,activity});
  }else if(before.state==="complete"){
    emit({mode,state:"complete",action:"verified_existing",writes_performed:false,before,activity});
  }else{
    if(expectedProtected!==before.protected_state_hash)throw new Error("Protected-state compare-and-swap failed.");
    await direct.query("SELECT pg_advisory_lock(hashtextextended($1,0))",["noisia:semantic-review-scale:0082"]);
    try{
      await direct.query("BEGIN");
      await direct.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["noisia:semantic-review-scale:0082"]);
      const locked=await inspect(direct);
      if(locked.state!=="absent"||locked.protected_state_hash!==expectedProtected){
        throw new Error("Locked 0082 precondition drifted.");
      }
      await direct.query(migration);
      const sentinels=await inspectSentinels(direct);
      if(!sentinels.complete||sentinels.ledger_count!==0)throw new Error(
        `0082 sentinels failed before ledger: ${sentinels.missing.join(",")}`
      );
      if(await protectedState(direct)!==expectedProtected)throw new Error("0082 changed protected authority.");
      const auto=await inspectAutomaticState(direct);
      if(auto.resolution_runs!==before.automatic.resolution_runs||auto.child_batches!==0
          ||auto.child_outbox!==0||auto.run_events!==0||auto.item_attempts!==0){
        throw new Error("0082 created provider execution state automatically.");
      }
      await direct.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
        migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
      ) VALUES($1,82,$2,'applied','signal-semantic-review-scale-v1',$3)`,[
        filename,expected.migration82,localRehearsal?fingerprint(directUrl):expected.direct
      ]);
      await direct.query("COMMIT");
    }catch(error){await direct.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally{await direct.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",["noisia:semantic-review-scale:0082"]);}
    const after=await inspect(direct);
    const peerAfter=await inspectPeer(poolerUrl);
    assertSame(after,peerAfter);
    if(after.state!=="complete"||after.protected_state_hash!==before.protected_state_hash){
      throw new Error("0082 post-apply verification failed.");
    }
    emit({mode,state:after.state,action:"applied",writes_performed:true,before,after,activity});
  }
}finally{await direct.end();}

async function inspect(client:pg.Client){
  const database=await client.query<{value:string}>("SELECT current_database() AS value");
  const ledger=await client.query<{ordinal:number;checksum_sha256:string}>(`
    SELECT ordinal,checksum_sha256 FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal BETWEEN 59 AND 82 ORDER BY ordinal
  `);
  for(const [ordinal,checksum] of expected.prior){
    if(ledger.rows.find((row)=>row.ordinal===ordinal)?.checksum_sha256!==checksum){
      throw new Error(`00${ordinal} ledger prerequisite is invalid.`);
    }
  }
  const sentinels=await inspectSentinels(client);
  const state=!sentinels.complete&&sentinels.present_count===0&&sentinels.ledger_count===0
    ?"absent":sentinels.complete&&sentinels.ledger_count===1?"complete":"partial";
  return {database_hash:sha256(database.rows[0]!.value),state,
    sentinel_count:sentinels.present_count,sentinel_expected:sentinels.expected_count,
    ledger_count:sentinels.ledger_count,ledger_digest:sha256(stable(ledger.rows)),
    protected_state_hash:await protectedState(client),automatic:await inspectAutomaticState(client)};
}

async function inspectSentinels(client:pg.Client){
  const result=await client.query<{checks:Record<string,boolean>;ledger_count:number}>(`
    SELECT jsonb_build_object(
      'projection_state',to_regclass('signal_semantic_review_projection_state') IS NOT NULL,
      'projection_items',to_regclass('signal_semantic_review_projection_items') IS NOT NULL,
      'projection_aggregates',to_regclass('signal_semantic_review_projection_aggregates') IS NOT NULL,
      'projection_dirty',to_regclass('signal_semantic_review_projection_dirty_roots') IS NOT NULL,
      'projection_outbox',to_regclass('signal_semantic_review_projection_outbox') IS NOT NULL,
      'child_batches',to_regclass('signal_semantic_resolution_child_batches') IS NOT NULL,
      'child_outbox',to_regclass('signal_semantic_resolution_child_outbox') IS NOT NULL,
      'item_attempts',to_regclass('signal_semantic_resolution_item_attempts') IS NOT NULL,
      'run_events',to_regclass('signal_semantic_resolution_run_events') IS NOT NULL,
      'projection_page_index',to_regclass('idx_signal_semantic_review_projection_page') IS NOT NULL,
      'projection_resolution_index',to_regclass('idx_signal_semantic_review_projection_resolution') IS NOT NULL,
      'child_recovery_index',to_regclass('idx_signal_semantic_resolution_child_outbox_recovery') IS NOT NULL,
      'run_snapshot_column',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='signal_semantic_resolution_runs' AND column_name='projection_snapshot_digest'),
      'run_hard_cap_column',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='signal_semantic_resolution_runs' AND column_name='hard_cap_micro_usd'),
      'run_children_column',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='signal_semantic_resolution_runs' AND column_name='child_batch_count'),
      'item_child_column',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='signal_semantic_resolution_run_items' AND column_name='child_batch_id'),
      'queue_projection',to_regprocedure('queue_signal_semantic_review_projection_refresh_v1(uuid,uuid,text,boolean)') IS NOT NULL,
      'begin_projection',to_regprocedure('begin_signal_semantic_review_projection_v1(uuid,uuid)') IS NOT NULL,
      'complete_projection',to_regprocedure('complete_signal_semantic_review_projection_v1(uuid,bigint,text,text,uuid)') IS NOT NULL,
      'claim_projection',to_regprocedure('claim_signal_semantic_review_projection_v1(integer,integer)') IS NOT NULL,
      'fail_projection',to_regprocedure('fail_signal_semantic_review_projection_v1(uuid,uuid,text,integer)') IS NOT NULL,
      'refresh_authority',to_regprocedure('refresh_signal_semantic_review_resolution_authority_v1(uuid,bigint,boolean)') IS NOT NULL,
      'claim_dispatch',to_regprocedure('claim_signal_semantic_resolution_child_dispatch_v1(integer,integer,integer)') IS NOT NULL,
      'claim_execution',to_regprocedure('claim_signal_semantic_resolution_child_execution_v1(uuid,uuid,integer)') IS NOT NULL,
      'heartbeat_execution',to_regprocedure('heartbeat_signal_semantic_resolution_child_v1(uuid,uuid,text,integer)') IS NOT NULL,
      'reserve_budget',to_regprocedure('reserve_signal_semantic_resolution_child_budget_v1(uuid,uuid)') IS NOT NULL,
      'settle_budget',to_regprocedure('settle_signal_semantic_resolution_child_budget_v1(uuid,uuid,bigint,bigint,bigint)') IS NOT NULL,
      'complete_child',to_regprocedure('complete_signal_semantic_resolution_child_v1(uuid,uuid,uuid)') IS NOT NULL,
      'fail_child',to_regprocedure('fail_signal_semantic_resolution_child_v1(uuid,uuid,uuid,text)') IS NOT NULL,
      'retry_child',to_regprocedure('retry_signal_semantic_resolution_child_execution_v1(uuid,uuid,text)') IS NOT NULL,
      'resume_child',to_regprocedure('resume_signal_semantic_resolution_child_v1(uuid,uuid,uuid,uuid,text)') IS NOT NULL,
      'cancel_run',to_regprocedure('request_cancel_signal_semantic_resolution_run_v1(uuid,uuid,uuid,text)') IS NOT NULL,
      'history_attempt_trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_signal_semantic_resolution_item_attempts_append_only' AND NOT tgisinternal),
      'history_event_trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_signal_semantic_resolution_run_events_append_only' AND NOT tgisinternal),
      'import_invalidation_trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_semantic_review_projection_import' AND NOT tgisinternal),
      'merge_invalidation_trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_semantic_review_projection_canonical_merge' AND NOT tgisinternal)
    ) AS checks,
    (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger
      WHERE ordinal=82 AND migration_name=$1 AND checksum_sha256=$2 AND disposition='applied') ledger_count
  `,[filename,expected.migration82]);
  const checks=result.rows[0]!.checks;
  const values=Object.values(checks);
  return {complete:values.every(Boolean),present_count:values.filter(Boolean).length,
    expected_count:values.length,ledger_count:result.rows[0]!.ledger_count,
    missing:Object.entries(checks).filter(([,present])=>!present).map(([name])=>name)};
}

async function inspectAutomaticState(client:pg.Client){
  const has82=(await client.query<{present:boolean}>("SELECT to_regclass('signal_semantic_resolution_child_batches') IS NOT NULL AS present")).rows[0]?.present;
  const result=await client.query<{resolution_runs:number;child_batches:number;child_outbox:number;run_events:number;item_attempts:number}>(`
    SELECT (SELECT count(*)::int FROM signal_semantic_resolution_runs) resolution_runs,
      ${has82?"(SELECT count(*)::int FROM signal_semantic_resolution_child_batches)":"0::int"} child_batches,
      ${has82?"(SELECT count(*)::int FROM signal_semantic_resolution_child_outbox)":"0::int"} child_outbox,
      ${has82?"(SELECT count(*)::int FROM signal_semantic_resolution_run_events)":"0::int"} run_events,
      ${has82?"(SELECT count(*)::int FROM signal_semantic_resolution_item_attempts)":"0::int"} item_attempts
  `);
  return result.rows[0]!;
}

async function protectedState(client:pg.Client){
  const projections=[
    ["pointers",`SELECT to_jsonb(row_value) AS value FROM signal_workspace_population_pointers row_value`],
    ["definitions",`SELECT to_jsonb(row_value)-'membership_digest'-'updated_at' AS value FROM signal_population_definitions row_value`],
    ["memberships",`SELECT to_jsonb(row_value) AS value FROM signal_population_memberships row_value`],
    ["bindings",`SELECT to_jsonb(row_value) AS value FROM signal_governed_view_bindings row_value`],
    ["assertions",`SELECT to_jsonb(row_value) AS value FROM signal_mention_attributions row_value`],
    ["review",`SELECT to_jsonb(row_value) AS value FROM signal_mention_attribution_review_events row_value`],
    ["quality",`SELECT to_jsonb(row_value) AS value FROM signal_quality_policies row_value`],
    ["retention",`SELECT to_jsonb(row_value) AS value FROM signal_retention_policies row_value`],
    ["licensing",`SELECT to_jsonb(row_value) AS value FROM signal_licensing_policies row_value`],
    ["licensing_usages",`SELECT to_jsonb(row_value) AS value FROM signal_licensing_policy_usages row_value`],
    ["provenance_bindings",`SELECT to_jsonb(row_value) AS value FROM signal_provenance_policy_bindings row_value`],
    ["imports",`SELECT jsonb_build_object('id',id,'workspace',workspace_id,'source',data_source_id,
      'status',status,'record_count',record_count,'included',included_count,'excluded',excluded_count,
      'duplicates',duplicate_count,'content_hash',COALESCE(storage_content_hash,source_file_hash)) AS value FROM import_batches`],
    ["mentions",`SELECT jsonb_build_object('id',id,'workspace',workspace_id,'canonical',canonical_mention_id,
      'inclusion',inclusion_status,'quality',quality_score,'flags',quality_flags,'published',published_at) AS value FROM mentions`],
    ["resolution_runs",`SELECT jsonb_build_object('id',id,'workspace',workspace_id,'status',status,
      'model',model_version,'queue_digest',queue_digest,'total',total_items,'completed',completed_items,
      'failed',failed_items,'cost',actual_cost_usd) AS value FROM signal_semantic_resolution_runs`]
  ] as const;
  const domains:Record<string,{row_count:number;digest:string}>={};
  for(const [name,projection] of projections){
    const result=await client.query<{row_count:number;digest:string}>(`
      SELECT count(*)::int row_count,'sha256:'||encode(sha256(COALESCE(
        string_agg(row_hash,'' ORDER BY row_hash),'')::bytea),'hex') digest
      FROM(SELECT sha256(convert_to(value::text,'UTF8')) row_hash FROM(${projection}) projected) hashed
    `);
    domains[name]=result.rows[0]!;
  }
  return sha256(stable(domains));
}

async function inspectActivity(client:pg.Client){
  const result=await client.query<{incompatible:number;writers:number;named_apps:number}>(`
    SELECT count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND state IS DISTINCT FROM 'idle' AND application_name<>$1)::int incompatible,
      count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND state IS DISTINCT FROM 'idle' AND query!~*'^\\s*(select|show|set|begin|commit|rollback)')::int writers,
      count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND COALESCE(application_name,'')~*'(studio|worker|bullmq)')::int named_apps
    FROM pg_stat_activity WHERE datname=current_database()
  `,[appName]);
  const row=result.rows[0]!;
  if(row.incompatible||row.writers||row.named_apps)throw new Error("Incompatible staging activity detected.");
  return row;
}

async function inspectPeer(url:string){
  const peer=new pg.Client({connectionString:url,ssl:localRehearsal?false:{rejectUnauthorized:false},application_name:`${appName}-peer`});
  await peer.connect();try{await configure(peer);return await inspect(peer);}finally{await peer.end();}
}
async function configure(client:pg.Client){
  await client.query("SET statement_timeout='5min'");await client.query("SET lock_timeout='15s'");
}
function assertSame(left:Awaited<ReturnType<typeof inspect>>,right:Awaited<ReturnType<typeof inspect>>){
  if(left.database_hash!==right.database_hash||left.state!==right.state
      ||left.ledger_digest!==right.ledger_digest||left.protected_state_hash!==right.protected_state_hash
      ||stable(left.automatic)!==stable(right.automatic))throw new Error("Direct/pooler state mismatch.");
}
function deriveDirect(value:string){const parsed=new URL(value);const ref=/^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];if(!ref)throw new Error("Pooler shape invalid.");parsed.hostname=`db.${ref}.supabase.co`;parsed.port="5432";parsed.username="postgres";return parsed.toString();}
function fingerprint(value:string){const parsed=new URL(value);return sha256([parsed.protocol,parsed.hostname.toLowerCase(),parsed.port||"5432",parsed.pathname.replace(/^\//u,""),parsed.username].join("|"));}
function projectHash(value:string,kind:"direct"|"pooler"){const parsed=new URL(value);const ref=kind==="direct"?/^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname)?.[1]:/^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username))?.[1];if(!ref)throw new Error("Project identity unavailable.");return sha256(ref);}
function sha256(value:string){return `sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stable(value:unknown):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;return JSON.stringify(value);}
function emit(value:Record<string,unknown>){process.stdout.write(`${JSON.stringify({
  contract_version:"signal-semantic-review-scale-migration-runner-v1",target:localRehearsal?"local":"noisia-staging",
  direct_fingerprint:localRehearsal?fingerprint(directUrl):expected.direct,
  pooler_fingerprint:localRehearsal?fingerprint(poolerUrl!):expected.pooler,
  project_ref_hash:localRehearsal?"local":expected.project,
  restore_point:localRehearsal?{kind:"disposable_local"}:{captured_at:restoreAt,reference_hash:restoreHash,age_hours:Number(restoreAgeHours.toFixed(2))},
  migration:{ordinal:82,filename,checksum:expected.migration82},provider_calls:0,jobs_enqueued:0,...value
},null,2)}\n`);}
