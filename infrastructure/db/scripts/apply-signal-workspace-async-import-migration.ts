import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import pg from "pg";

const root=resolve(import.meta.dirname,"../../..");
const requireFromStudio=createRequire(resolve(root,"apps/studio/package.json"));
const { parse }=requireFromStudio("dotenv") as typeof import("dotenv");
const mode=process.argv[2];
const expectedProtected=process.argv[3] ?? null;
const workspaceName=process.env.NOISIA_IMPORT_RESTORE_WORKSPACE_NAME?.trim();
const sourceName=process.env.NOISIA_IMPORT_RESTORE_SOURCE_NAME?.trim();
const fileName=process.env.NOISIA_IMPORT_RESTORE_FILE_NAME?.trim();
const restoreAt=process.env.NOISIA_SIGNAL_ASYNC_IMPORT_RESTORE_POINT_AT;
const restoreHash=process.env.NOISIA_SIGNAL_ASYNC_IMPORT_RESTORE_POINT_HASH;
const target=process.env.NOISIA_REMOTE_DATABASE_TARGET;
const expected={
  direct:"sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  pooler:"sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  project:"sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32",
  migration77:"sha256:64b8302b598744807e6dba2aafd0d3e99f8e49192767cbcc82f70e02921f128c",
  migration78:"sha256:5496e56013711267fe009298ee4ba69b9a43f1cade4335a8d89a14af7c40b96e",
  migration79:"sha256:dbd1c0d32760666f7d81ea510e271cda2aaf31d29ec38c44250f7337cc242246",
  migration80:"sha256:b17b63a1f7c153338ea16758c1ed01b89fc8dd5c1f7cc1b66f291e8950413ed7",
  migration81:"sha256:d351a6e2958b88ad64afbb692b8f5c7cdfd55f1380c3c42babfee231759234de"
} as const;
const filename="0081_signal_workspace_import_recovery_integrity.sql";
const appName="noisia-backend-p0-workspace-import-recovery-migration";

if (!(["preflight","apply","verify"] as const).includes(mode as "preflight")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (target!=="noisia-staging" || !workspaceName || !sourceName || !fileName) {
  throw new Error("Only the approved noisia-staging import incident is allowed.");
}
if (!restoreAt || !restoreHash?.match(/^sha256:[0-9a-f]{64}$/u)) {
  throw new Error("A verified post-incident restore artifact is required.");
}
const restoreAgeHours=(Date.now()-Date.parse(restoreAt))/3_600_000;
if (!Number.isFinite(restoreAgeHours) || restoreAgeHours<0 || restoreAgeHours>24) {
  throw new Error("The restore artifact is not fresh enough.");
}
if (mode==="apply" && (process.env.NOISIA_SIGNAL_ASYNC_IMPORT_MIGRATION_APPROVED!=="true"
    || process.env.NOISIA_SIGNAL_ASYNC_IMPORT_NO_APPS_CONFIRMED!=="true")) {
  throw new Error("Apply requires migration and no-app acknowledgements.");
}

const env=parse(await readFile(resolve(root,"apps/studio/.env.local"),"utf8"));
const poolerUrl=env.DATABASE_URL?.trim();
if (!poolerUrl || env.DATABASE_SSL!=="true") throw new Error("Canonical staging connection is unavailable.");
const directUrl=deriveDirect(poolerUrl);
if (fingerprint(poolerUrl)!==expected.pooler || fingerprint(directUrl)!==expected.direct
    || projectHash(poolerUrl,"pooler")!==expected.project
    || projectHash(directUrl,"direct")!==expected.project) {
  throw new Error("Direct/pooler target identity mismatch.");
}
const migration=await readFile(resolve(root,"infrastructure/db/migrations",filename),"utf8");
if (sha256(migration)!==expected.migration81) throw new Error("0081 checksum mismatch.");

const direct=new pg.Client({ connectionString: directUrl,ssl:{ rejectUnauthorized:false },application_name:appName });
await direct.connect();
try {
  await configure(direct);
  const before=await inspect(direct);
  const peerBefore=await inspectPeer(poolerUrl);
  assertSame(before,peerBefore);
  const activity=await inspectActivity(direct);
  if (before.state==="partial") throw new Error("0081 partial state is blocked.");
  if (before.incident.failed_batches!==1) {
    throw new Error("The staging incident scope is not unique or isolated.");
  }
  if (mode==="preflight") {
    emit({ mode,state:before.state,writes_performed:false,before,activity });
  } else if (mode==="verify") {
    if (before.state!=="complete" || before.incident.incomplete_included!==0) {
      throw new Error("0081 recovery integrity is not complete.");
    }
    emit({ mode,state:before.state,writes_performed:false,before,activity });
  } else if (before.state==="complete") {
    if (before.incident.incomplete_included!==0) throw new Error("Existing 0081 state is unsafe.");
    emit({ mode,state:"complete",action:"verified_existing",writes_performed:false,before,activity });
  } else {
    if (expectedProtected!==before.protected_state_hash) throw new Error("Protected-state compare-and-swap failed.");
    await direct.query("SELECT pg_advisory_lock(hashtextextended($1,0))",["noisia:backend-p0:0081"]);
    try {
      await direct.query("BEGIN");
      await direct.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["noisia:backend-p0:0081"]);
      const locked=await inspect(direct);
      if (locked.state!=="absent" || locked.protected_state_hash!==expectedProtected
          || locked.incident.failed_batches!==1) {
        throw new Error("Locked migration precondition drifted.");
      }
      await direct.query(migration);
      const sentinels=await inspectSentinels(direct);
      if (sentinels.object_count!==11 || sentinels.ledger_count!==0) {
        throw new Error("0081 sentinels failed before ledger registration.");
      }
      if (await protectedState(direct)!==expectedProtected) {
        throw new Error("0081 changed protected authority.");
      }
      const incident=await inspectIncident(direct);
      if (incident.incomplete_included!==0 || incident.failed_batches!==1
          || incident.completed_replacements!==0 || incident.outbox_rows!==1
          || incident.failed_provenance<=0) {
        throw new Error("0081 import incident postcondition failed.");
      }
      await direct.query(`
        INSERT INTO signal_workspace_data_plane_migration_ledger(
          migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
        ) VALUES($1,81,$2,'applied','signal-workspace-import-recovery-integrity-v1',$3)
      `,[filename,expected.migration81,expected.direct]);
      await direct.query("COMMIT");
    } catch (error) {
      await direct.query("ROLLBACK").catch(()=>undefined);throw error;
    } finally {
      await direct.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",["noisia:backend-p0:0081"]);
    }
    const after=await inspect(direct);
    const peerAfter=await inspectPeer(poolerUrl);
    assertSame(after,peerAfter);
    if (after.state!=="complete" || after.protected_state_hash!==before.protected_state_hash
        || after.incident.incomplete_included!==0) throw new Error("0081 post-apply verification failed.");
    emit({ mode,state:after.state,action:"applied",writes_performed:true,before,after,activity });
  }
} finally { await direct.end(); }

async function inspect(client: pg.Client) {
  const database=await client.query<{ value:string }>("SELECT current_database() AS value");
  const sentinels=await inspectSentinels(client);
  const ledger=await client.query<{ ordinal:number;checksum_sha256:string }>(`
    SELECT ordinal,checksum_sha256 FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal BETWEEN 59 AND 81 ORDER BY ordinal
  `);
  const prior77=ledger.rows.find((row)=>row.ordinal===77);
  const prior78=ledger.rows.find((row)=>row.ordinal===78);
  const prior79=ledger.rows.find((row)=>row.ordinal===79);
  const prior80=ledger.rows.find((row)=>row.ordinal===80);
  if (prior77?.checksum_sha256!==expected.migration77 || prior78?.checksum_sha256!==expected.migration78) {
    throw new Error("0077/0078 ledger prerequisites are invalid.");
  }
  if (prior79?.checksum_sha256!==expected.migration79) {
    throw new Error("0079 ledger prerequisite is invalid.");
  }
  if (prior80?.checksum_sha256!==expected.migration80) {
    throw new Error("0080 ledger prerequisite is invalid.");
  }
  const objectComplete=sentinels.object_count===11;
  const ledgerComplete=sentinels.ledger_count===1;
  const state=!objectComplete && sentinels.object_count===0 && sentinels.ledger_count===0
    ? "absent" : objectComplete && ledgerComplete ? "complete" : "partial";
  return {
    database_hash:sha256(database.rows[0]!.value),state,
    sentinel_count:sentinels.object_count,ledger_count:sentinels.ledger_count,
    ledger_digest:sha256(stable(ledger.rows)),protected_state_hash:await protectedState(client),
    incident:await inspectIncident(client)
  };
}

async function inspectSentinels(client: pg.Client) {
  const result=await client.query<{ object_count:number;ledger_count:number }>(`
    SELECT (
      (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='import_batches' AND column_name='storage_source_import_batch_id'))::int
      +(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='import_batches' AND column_name='storage_content_hash'))::int
      +(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='import_batches' AND column_name='processing_metrics'))::int
      +(to_regprocedure('record_signal_workspace_import_provenance_set_v1(uuid,uuid[],text[])') IS NOT NULL)::int
      +(to_regprocedure('materialize_signal_workspace_import_source_intent_v1(uuid)') IS NOT NULL)::int
      +(to_regprocedure('create_signal_workspace_import_storage_recovery_v1(uuid,uuid,text,text,text)') IS NOT NULL)::int
      +(to_regprocedure('seal_signal_workspace_import_storage_hash_v1(uuid,text,text,bigint)') IS NOT NULL)::int
      +(to_regprocedure('record_signal_workspace_import_metrics_v1(uuid,text,jsonb)') IS NOT NULL)::int
      +(EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='uq_import_batches_active_storage_recovery'))::int
      +(EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('complete_signal_workspace_import_v1(uuid,text,text,integer,integer,integer,integer,bigint)')
        AND pg_get_functiondef(oid) LIKE '%storage_content_hash%'))::int
      +(EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('sync_signal_mention_governance()')
        AND pg_get_functiondef(oid) LIKE '%ingestion_phase%'))::int
    )::int AS object_count,
    (SELECT count(*)::int FROM signal_workspace_data_plane_migration_ledger
      WHERE ordinal=81 AND migration_name=$1 AND checksum_sha256=$2 AND disposition='applied') AS ledger_count
  `,[filename,expected.migration81]);
  return result.rows[0]!;
}

async function inspectIncident(client: pg.Client) {
  const has79=(await client.query<{ present:boolean }>(
    "SELECT to_regclass('signal_workspace_import_outbox') IS NOT NULL AS present"
  )).rows[0]?.present===true;
  const completedReplacements=has79
    ? `(SELECT count(*)::int FROM import_batches replacement JOIN target
        ON replacement.supersedes_import_batch_id=target.batch_id WHERE replacement.status='completed')`
    : "0::int";
  const result=await client.query<{
    failed_batches:number;failed_provenance:number;incomplete_included:number;
    incomplete_semantic_eligible:number;completed_replacements:number;outbox_rows:number;
    other_workspace_exposed:number;
  }>(`
    WITH target AS (
      SELECT workspace.id AS workspace_id,source.id AS source_id,batch.id AS batch_id
      FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
      JOIN data_sources source ON source.workspace_id=workspace.id AND source.name=$2
      JOIN import_batches batch ON batch.workspace_id=workspace.id AND batch.data_source_id=source.id
        AND batch.source_file_name=$3 AND batch.status='failed'
      WHERE workspace.status='active' AND brand.status='active'
        AND (brand.name=$1 OR brand.display_name=$1)
    ), incomplete AS (
      SELECT DISTINCT membership.workspace_id,membership.mention_id,target.batch_id
      FROM target JOIN signal_mention_import_memberships membership ON membership.import_batch_id=target.batch_id
    ) SELECT
      (SELECT count(*)::int FROM target) AS failed_batches,
      (SELECT count(*)::int FROM incomplete) AS failed_provenance,
      (SELECT count(*)::int FROM signal_population_memberships population JOIN incomplete
        ON incomplete.workspace_id=population.workspace_id AND incomplete.mention_id=population.mention_id
        WHERE population.membership_status='included' AND population.removed_at IS NULL
          AND NOT EXISTS(
            SELECT 1 FROM signal_mention_import_memberships accepted
            JOIN import_batches accepted_batch ON accepted_batch.id=accepted.import_batch_id
              AND accepted_batch.status='completed'
            WHERE accepted.workspace_id=population.workspace_id
              AND accepted.mention_id=population.mention_id
          )) AS incomplete_included,
      (SELECT count(*)::int FROM signal_mention_attributions semantic JOIN incomplete
        ON incomplete.workspace_id=semantic.workspace_id AND incomplete.mention_id=semantic.mention_id
        WHERE semantic.is_current AND semantic.attribution_basis='mention_semantic'
          AND semantic.review_status='approved' AND semantic.eligibility_status='eligible'
          AND NOT EXISTS(
            SELECT 1 FROM signal_mention_import_memberships accepted
            JOIN import_batches accepted_batch ON accepted_batch.id=accepted.import_batch_id
              AND accepted_batch.status='completed'
            WHERE accepted.workspace_id=semantic.workspace_id
              AND accepted.mention_id=semantic.mention_id
          )) AS incomplete_semantic_eligible,
      ${completedReplacements} AS completed_replacements,
      ${has79 ? `(SELECT count(*)::int FROM signal_workspace_import_outbox outbox JOIN target ON target.batch_id=outbox.import_batch_id)` : "0::int"} AS outbox_rows,
      (SELECT count(*)::int FROM signal_population_memberships population
        JOIN signal_mention_import_memberships membership ON membership.workspace_id=population.workspace_id
          AND membership.mention_id=population.mention_id
        JOIN import_batches batch ON batch.id=membership.import_batch_id AND batch.status<>'completed'
        WHERE population.membership_status='included' AND population.removed_at IS NULL
          AND NOT EXISTS(
            SELECT 1 FROM signal_mention_import_memberships accepted
            JOIN import_batches accepted_batch ON accepted_batch.id=accepted.import_batch_id
              AND accepted_batch.status='completed'
            WHERE accepted.workspace_id=population.workspace_id
              AND accepted.mention_id=population.mention_id
          )
          AND NOT EXISTS(SELECT 1 FROM target WHERE target.workspace_id=population.workspace_id)) AS other_workspace_exposed
  `,[workspaceName,sourceName,fileName]);
  return result.rows[0]!;
}

async function protectedState(client: pg.Client) {
  const projections=[
    ["pointers",`SELECT to_jsonb(row_value) AS value FROM signal_workspace_population_pointers row_value`],
    ["definitions",`SELECT to_jsonb(row_value)-'membership_digest'-'updated_at' AS value FROM signal_population_definitions row_value`],
    ["review",`SELECT to_jsonb(row_value) AS value FROM signal_mention_attribution_review_events row_value`],
    ["assertions",`SELECT to_jsonb(row_value) AS value FROM signal_mention_attributions row_value`],
    ["bindings",`SELECT to_jsonb(row_value) AS value FROM signal_governed_view_bindings row_value`],
    ["binding_events",`SELECT to_jsonb(row_value) AS value FROM signal_governed_view_binding_events row_value`],
    ["quality",`SELECT to_jsonb(row_value) AS value FROM signal_quality_policies row_value`],
    ["retention",`SELECT to_jsonb(row_value) AS value FROM signal_retention_policies row_value`],
    ["licensing",`SELECT to_jsonb(row_value) AS value FROM signal_licensing_policies row_value`],
    ["provenance_bindings",`SELECT to_jsonb(row_value) AS value FROM signal_provenance_policy_bindings row_value`],
    ["failed_batch_core",`SELECT jsonb_build_object('id',batch.id,'workspace',batch.workspace_id,'source',batch.data_source_id,
      'status',batch.status,'file',batch.source_file_name,'records',batch.record_count,'included',batch.included_count,
      'excluded',batch.excluded_count,'duplicates',batch.duplicate_count) AS value FROM import_batches batch WHERE batch.status='failed'`],
    ["failed_provenance",`SELECT to_jsonb(row_value)-'ingestion_disposition' AS value FROM signal_mention_import_memberships row_value
      JOIN import_batches batch ON batch.id=row_value.import_batch_id WHERE batch.status='failed'`]
  ] as const;
  const domains:Record<string,{ row_count:number;digest:string }>={};
  for (const [name,projection] of projections) {
    const result=await client.query<{ row_count:number;digest:string }>(`
      SELECT count(*)::int AS row_count,'sha256:'||encode(sha256(COALESCE(string_agg(row_hash,'' ORDER BY row_hash),'')::bytea),'hex') AS digest
      FROM(SELECT sha256(convert_to(value::text,'UTF8')) AS row_hash FROM(${projection}) projected) hashed
    `);
    domains[name]=result.rows[0]!;
  }
  return sha256(stable(domains));
}

async function inspectActivity(client: pg.Client) {
  const result=await client.query<{ incompatible:number;writers:number;named_apps:number }>(`
    SELECT count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND state IS DISTINCT FROM 'idle' AND application_name<>$1)::int AS incompatible,
      count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND state IS DISTINCT FROM 'idle' AND query!~*'^\\s*(select|show|set|begin|commit|rollback)')::int AS writers,
      count(*) FILTER(WHERE pid<>pg_backend_pid() AND backend_type='client backend'
        AND COALESCE(application_name,'')~*'(studio|worker|bullmq)')::int AS named_apps
    FROM pg_stat_activity WHERE datname=current_database()
  `,[appName]);
  const row=result.rows[0]!;
  if (row.incompatible || row.writers || row.named_apps) throw new Error("Incompatible staging activity detected.");
  return row;
}

async function inspectPeer(url:string) {
  const peer=new pg.Client({ connectionString:url,ssl:{ rejectUnauthorized:false },application_name:`${appName}-peer` });
  await peer.connect();try{await configure(peer);return await inspect(peer);}finally{await peer.end();}
}
async function configure(client:pg.Client){await client.query("SET statement_timeout='180s'");await client.query("SET lock_timeout='15s'");}
function assertSame(left:Awaited<ReturnType<typeof inspect>>,right:Awaited<ReturnType<typeof inspect>>){
  if (left.database_hash!==right.database_hash || left.state!==right.state
      || left.ledger_digest!==right.ledger_digest || left.protected_state_hash!==right.protected_state_hash
      || stable(left.incident)!==stable(right.incident)) throw new Error("Direct/pooler state mismatch.");
}
function deriveDirect(value:string){const parsed=new URL(value);const ref=/^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];if(!ref)throw new Error("Pooler shape invalid.");parsed.hostname=`db.${ref}.supabase.co`;parsed.port="5432";parsed.username="postgres";return parsed.toString();}
function fingerprint(value:string){const parsed=new URL(value);return sha256([parsed.protocol,parsed.hostname.toLowerCase(),parsed.port||"5432",parsed.pathname.replace(/^\//u,""),parsed.username].join("|"));}
function projectHash(value:string,kind:"direct"|"pooler"){const parsed=new URL(value);const ref=kind==="direct"?/^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname)?.[1]:/^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username))?.[1];if(!ref)throw new Error("Project identity unavailable.");return sha256(ref);}
function sha256(value:string){return `sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stable(value:unknown):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;return JSON.stringify(value);}
function emit(value:Record<string,unknown>){process.stdout.write(`${JSON.stringify({
  contract_version:"signal-workspace-import-recovery-migration-runner-v1",target:"noisia-staging",
  direct_fingerprint:expected.direct,pooler_fingerprint:expected.pooler,project_ref_hash:expected.project,
  restore_point:{ captured_at:restoreAt,reference_hash:restoreHash,age_hours:Number(restoreAgeHours.toFixed(2)) },
  migration:{ ordinal:81,filename,checksum:expected.migration81 },
  incident_identity_hash:sha256(stable({ workspaceName,sourceName,fileName })),...value
},null,2)}\n`);}
