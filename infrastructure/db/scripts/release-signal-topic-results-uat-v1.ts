/** Focused UAT delivery: reviewed 0115 + 0122 and one historical result, never a provider run.
 * preflight/capture/verify are DB-read-only. apply owns one atomic DDL/ledger/import transaction. */
import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, statfs, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userInfo } from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { parse } from "dotenv";
import pg from "pg";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";
import { importSignalTopicEvaluationV2HistoricalResult,
  validateSignalTopicEvaluationV2HistoricalResultArtifact } from "../signal-topic-evaluation-v2-result-import";

const ROOT=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
export const TOPIC_RESULTS_GATE="69B.5I-E-LAB-2V";
export const TOPIC_RESULTS_TARGET="sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
export const TOPIC_RESULTS_ARTIFACT="sha256:b801de32bb3ba0e87a854eb45b4324c56cda31713d7da36ad252af2b0bdcf75e";
export const TOPIC_RESULTS_IDEMPOTENCY="uat-topic-result-import-b801de32-v1";
const CONTAINER="noisia-topic-evaluation-0114-local-tools";
const TOOL_IMAGE_ID="sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f";
const DOCKER="/Applications/Docker.app/Contents/Resources/bin/docker";
const MAX_AGE=60*60*1000;
export const TOPIC_RESULTS_MIGRATIONS=[
  {ordinal:112,file:"0112_signal_topic_evaluation_full_evidence_control_plane.sql",checksum:"sha256:51f6fbff712ec1737b41da9997bda86b068abb81f4edafc9a338af590c462ab5"},
  {ordinal:113,file:"0113_signal_topic_evaluation_full_evidence_execution_authority.sql",checksum:"sha256:8bb7f5be275d33d4f284f72a9e882314f488466ccdd3adee3ade2acb195f0f71"},
  {ordinal:115,file:"0115_signal_topic_evaluation_v2_candidate_review.sql",checksum:"sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946"},
  {ordinal:122,file:"0122_signal_topic_evaluation_v2_historical_result_import.sql",checksum:"sha256:460843ae14aab222080e2ae51fcd1295f39586679887da44af49ba50766597a9"}
] as const;
type Mode="preflight"|"capture"|"apply"|"verify";
type Target={host:string;port:number;user:string;password:string;database:string};
type Ledger={ordinal:number;migration_name:string;checksum_sha256:string;disposition:string};
type State={ledger:Ledger[];schema:{editor:number;imports:number;lab:number};frozen_digest:string;
  protected_digest:string;snapshot_matches:number;evaluation:{runs:number;candidates:number;turns:number;
    retrievals:number;links:number;ranks:number;authorities:number;calls:number;reserved:string;settled:string;
    outbox:number;unsafe:number;imports:number;refinements:number;imported_inert:boolean}};
type Receipt={mode:Mode;gate:string;target:string;artifact:string;recorded_at:string;state:State;
  reused_verified_dump?:boolean;
  preflight_sha256?:string;restore_sha256?:string;dump?:{sha256:string;bytes:number;toc_entries:number;full_stream_verified:boolean}};
const digest=(value:string|Buffer)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const snapshotValues=(a:ReturnType<typeof validateSignalTopicEvaluationV2HistoricalResultArtifact>)=>[
  a.snapshot.snapshot_digest,a.snapshot.rights_digest,a.snapshot.semantic_context_authority_digest,
  a.snapshot.artifact_binding_digest,a.snapshot.membership_binding_digest];
function ensure(value:unknown,code:string):asserts value {if(!value)throw new Error(`topic_results_release_${code}`);}

export function topicResultsTarget(value:string):Target {
  const url=new URL(value),port=Number(url.port||5432);
  ensure(["postgres:","postgresql:"].includes(url.protocol)&&!url.hash
    &&[...url.searchParams].every(([key,value])=>key==="sslmode"&&value==="require")
    &&[...url.searchParams].length<=1,"target_routing_invalid");
  const target={host:url.hostname.toLowerCase(),port,user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:decodeURIComponent(url.pathname.slice(1))};
  ensure(target.host&&target.user&&target.password&&target.database&&!target.database.includes("/")
    &&Number.isInteger(port)&&port>0&&port<=65535&&!/[\r\n\0]/u.test(target.password),"target_invalid");
  ensure(digest(["postgresql:",target.host,String(port),target.database,target.user].join("|"))===TOPIC_RESULTS_TARGET,
    "target_not_uat");return target;
}
export function topicResultsPgConfig(target:Target):pg.ClientConfig {
  return{host:target.host,port:target.port,user:target.user,password:target.password,database:target.database,
    ssl:{rejectUnauthorized:false},application_name:"noisia-topic-results-lab2v",options:"-c search_path=public,extensions",
    connectionTimeoutMillis:30000};
}
export function topicResultsMigrationPlan(ledger:Ledger[],schema:State["schema"]) {
  ensure(schema.lab===0&&!ledger.some(r=>r.ordinal>=116&&r.ordinal<=121),"lab_schema_present");
  const missing:number[]=[];
  for(const migration of TOPIC_RESULTS_MIGRATIONS){const row=ledger.find(r=>r.ordinal===migration.ordinal);
    const present=migration.ordinal===115?schema.editor:migration.ordinal===122?schema.imports:null;
    ensure(!row||(row.migration_name===migration.file&&row.checksum_sha256===migration.checksum
      &&row.disposition==="applied"),"ledger_checksum_mismatch");
    if(migration.ordinal<=113)ensure(row,"prerequisite_missing");
    else if(!row){ensure(present===0,"partial_schema");missing.push(migration.ordinal);}
    else ensure(present===(migration.ordinal===115?3:2),"partial_schema");
  }return missing;
}
export function topicResultsValidateReceipt(receipt:Receipt,mode:Mode,now=Date.now()) {
  ensure(receipt.mode===mode&&receipt.gate===TOPIC_RESULTS_GATE&&receipt.target===TOPIC_RESULTS_TARGET
    &&receipt.artifact===TOPIC_RESULTS_ARTIFACT,"receipt_identity_mismatch");
  const age=now-Date.parse(receipt.recorded_at);
  ensure(Number.isFinite(age)&&age>=-60000&&age<=MAX_AGE,"receipt_stale");return receipt;
}
export function topicResultsDumpArgs(target:Target) {
  return["exec","-i",...Object.entries({PGHOST:target.host,PGPORT:String(target.port),PGUSER:target.user,
    PGDATABASE:target.database,PGSSLMODE:"require"}).flatMap(([k,v])=>["-e",`${k}=${v}`]),CONTAINER,
    "sh","-ceu","IFS= read -r PGPASSWORD; export PGPASSWORD; exec /usr/bin/pg_dump \"$@\"","sh",
    "--format=custom","--schema=public","--no-owner","--no-acl"];
}
async function privateRead(path:string,max=1024*1024){const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat();ensure(stat.isFile()&&stat.nlink===1&&(stat.mode&0o777)===0o600
    &&stat.uid===process.getuid?.()&&stat.size<=max,"private_file_invalid");return await handle.readFile();}
  finally{await handle.close();}}
async function digestFile(path:string){const hash=createHash("sha256");let bytes=0;
  for await(const chunk of createReadStream(path)){hash.update(chunk as Buffer);bytes+=(chunk as Buffer).length;}
  return{sha256:`sha256:${hash.digest("hex")}`,bytes};}
export function topicResultsAcceptTocInputError(tocList:boolean,code:unknown,exitCode:number|null){
  return tocList&&code==="EPIPE"&&exitCode===0;
}
export function topicResultsValidateDumpReuse(value:{expected:string;actual:string;regular:boolean;mode:number;
  nlink:number;uid:number;currentUid:number;mtimeMs:number;preflightAt:string}){
  ensure(/^sha256:[0-9a-f]{64}$/u.test(value.expected)&&value.expected===value.actual,"reused_dump_digest_mismatch");
  ensure(value.regular&&(value.mode&0o777)===0o600&&value.nlink===1&&value.uid===value.currentUid
    &&Number.isFinite(Date.parse(value.preflightAt))&&value.mtimeMs>=Date.parse(value.preflightAt),"reused_dump_custody_invalid");
}
async function reusableDump(path:string,expected:string,preflightAt:string){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat(),hash=createHash("sha256");
    ensure(stat.isFile()&&(stat.mode&0o777)===0o600&&stat.nlink===1&&stat.uid===process.getuid?.(),"reused_dump_custody_invalid");
    for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk as Buffer);
    topicResultsValidateDumpReuse({expected,actual:`sha256:${hash.digest("hex")}`,regular:stat.isFile(),mode:stat.mode,
      nlink:stat.nlink,uid:stat.uid,currentUid:process.getuid?.()??-1,mtimeMs:stat.mtimeMs,preflightAt});
  }finally{await handle.close();}
}
async function docker(args:string[],input?:string|ReturnType<typeof createReadStream>,destination?:string,tocList=false){
  ensure(!tocList||(!destination&&JSON.stringify(args)===JSON.stringify(
    ["exec","-i",CONTAINER,"/usr/bin/pg_restore","--list"])),"toc_opt_in_invalid");
  const child=spawn(DOCKER,["--host",`unix://${userInfo().homedir}/.docker/run/docker.sock`,...args],
    {env:{PATH:"/usr/bin:/bin:/usr/sbin:/sbin",LANG:"C",LC_ALL:"C"},stdio:["pipe","pipe","pipe"]});
  child.stderr.resume();let output="";let oversized=false;let exitCode:number|null=null;let inputError:unknown;
  const exit=new Promise<void>((resolveExit,reject)=>{child.once("error",()=>reject(new Error("topic_results_release_tool_failed")));
    child.once("close",code=>{exitCode=code;code===0&&!oversized?resolveExit():reject(new Error("topic_results_release_tool_failed"));});});
  const incoming=pipeline(typeof input==="object"?input:Readable.from([input??""]),child.stdin).catch(error=>{
    inputError=error;if(!tocList||(error as NodeJS.ErrnoException).code!=="EPIPE")throw error;
    // Only TOC is allowed to stop consuming early; acceptance still waits for actual exit 0.
  });
  const outgoing=destination?pipeline(child.stdout,createWriteStream(destination,{mode:0o600,flags:"wx"})):
    new Promise<void>(resolveOutput=>{child.stdout.on("data",chunk=>{if(output.length<4*1024*1024)output+=String(chunk);
      else oversized=true;});child.stdout.on("end",resolveOutput);});
  try{await Promise.all([exit,incoming,outgoing]);ensure(!inputError||topicResultsAcceptTocInputError(tocList,
    (inputError as NodeJS.ErrnoException).code,exitCode),"tool_failed");return output;
  }catch{child.kill("SIGTERM");throw new Error("topic_results_release_tool_failed");}
}
async function archiveCheck(path:string){const toc=await docker(["exec","-i",CONTAINER,"/usr/bin/pg_restore","--list"],createReadStream(path),undefined,true);
  const entries=toc.split("\n").filter(line=>/^\d+;/u.test(line)).length;ensure(entries>=3000,"archive_toc_incomplete");
  await docker(["exec","-i",CONTAINER,"/usr/bin/pg_restore","--file=/dev/null","--no-owner","--no-acl"],createReadStream(path));
  return{...(await digestFile(path)),toc_entries:entries,full_stream_verified:true};}

async function inspect(client:pg.Client,artifact:ReturnType<typeof validateSignalTopicEvaluationV2HistoricalResultArtifact>):Promise<State>{
  const ledger=(await client.query<Ledger>(`SELECT ordinal,migration_name,checksum_sha256,disposition
    FROM signal_workspace_data_plane_migration_ledger WHERE ordinal>=112 ORDER BY ordinal`)).rows;
  const schema=(await client.query<State["schema"]>(`SELECT
    (SELECT count(*)::int FROM pg_class WHERE relkind='r' AND relname IN('signal_topic_evaluation_v2_candidate_review_operations',
      'signal_topic_evaluation_v2_candidate_editorial_revisions','signal_topic_evaluation_v2_candidate_review_events')) editor,
    (SELECT count(*)::int FROM pg_class WHERE relkind='r' AND relname IN('signal_topic_evaluation_v2_result_import_receipts',
      'signal_topic_evaluation_v2_archived_refinements')) imports,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='noisia_topic_evaluation_lab' OR c.relname LIKE 'signal_topic_evaluation_v2_candidate_refinement_%') lab`)).rows[0]!;
  topicResultsMigrationPlan(ledger,schema);
  const frozen=(await client.query<{frozen_digest:string;snapshot_matches:number}>(`SELECT
    signal_semantic_context_digest_v1(jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM signal_topic_evaluation_v2_snapshots s),
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY snapshot_id,cluster_key) FROM signal_topic_evaluation_v2_clusters c),
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY snapshot_id,assignment_index) FROM signal_topic_evaluation_v2_cluster_memberships m))::text) frozen_digest,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_snapshots s WHERE state='frozen'
      AND snapshot_digest=$1 AND rights_digest=$2 AND semantic_context_authority_digest=$3
      AND artifact_binding_digest=$4 AND membership_binding_digest=$5
      AND signal_topic_evaluation_v2_semantic_authority_digest_v1(semantic_context_generation_id)=$3
      AND (SELECT 'sha256:'||encode(digest(convert_to(string_agg(assignment_index::text||'|'||
        assignment_label::text||'|'||source_record_key||'|'||canonical_binding_digest,E'\\n' ORDER BY assignment_index),
        'UTF8'),'sha256'),'hex') FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=s.id)=$5
      AND (SELECT count(*) FROM signal_topic_evaluation_v2_clusters WHERE snapshot_id=s.id)=116
      AND (SELECT count(*) FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=s.id)=21195
      AND (SELECT count(*) FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=s.id AND assignment_label>=0)=11186
      AND (SELECT count(*) FROM signal_topic_evaluation_v2_cluster_memberships WHERE snapshot_id=s.id AND assignment_label=-1)=10009
      AND EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets p JOIN signal_semantic_context_generations g
        ON g.id=s.semantic_context_generation_id WHERE p.artifact_id=s.packet_artifact_id
          AND p.workspace_id=s.workspace_id AND p.packet_digest=s.packet_digest AND p.rights_digest=s.rights_digest
          AND p.packet_file_digest=s.source_packet_file_digest AND p.source_manifest_digest=s.packet_source_manifest_digest
          AND g.workspace_id=s.workspace_id AND g.status='draft'
          AND NOT EXISTS(SELECT 1 FROM signal_topic_discovery_review_packets newer
            WHERE newer.workspace_id=p.workspace_id AND newer.registered_at>p.registered_at)
          AND NOT EXISTS(SELECT 1 FROM signal_semantic_context_generations newer
            WHERE newer.workspace_id=g.workspace_id AND newer.supersedes_generation_id=g.id))
      AND EXISTS(SELECT 1 FROM users WHERE id=s.created_by_user_id AND user_type='noisia_internal'
        AND status='active' AND signal_data_governance_actor_is_valid(s.workspace_id,id))) snapshot_matches`,
    snapshotValues(artifact))).rows[0]!;
  ensure(frozen.snapshot_matches===1,"snapshot_mismatch");
  const protectedState=(await client.query<{value:string}>(`SELECT signal_semantic_context_digest_v1(jsonb_build_array(
    (SELECT count(*) FROM signal_workspaces),(SELECT count(*) FROM mentions),
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM signal_workspace_population_pointers p),
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM signal_governed_view_bindings b),
    (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM signal_semantic_context_generations g))::text) value`)).rows[0]!.value;
  const outbox=(await client.query<{exists:boolean}>("SELECT to_regclass('public.signal_topic_evaluation_v2_execution_outbox') IS NOT NULL exists")).rows[0]!.exists;
  const evaluation=(await client.query<State["evaluation"]>(`SELECT
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_runs) runs,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns) turns,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals) retrievals,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence) links,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings) ranks,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations) authorities,
    (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs) calls,
    (SELECT COALESCE(sum(reserved_micro_usd),0)::text FROM signal_topic_evaluation_v2_runs) reserved,
    (SELECT COALESCE(sum(settled_micro_usd),0)::text FROM signal_topic_evaluation_v2_runs) settled,
    ${outbox?"(SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_outbox)":"0"} outbox,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates WHERE adopted OR published OR serving OR status<>'pending') unsafe,
    ${schema.imports===2?"(SELECT count(*)::int FROM signal_topic_evaluation_v2_result_import_receipts)":"0"} imports,
    ${schema.imports===2?"(SELECT count(*)::int FROM signal_topic_evaluation_v2_archived_refinements)":"0"} refinements,
    ${schema.imports===2?`COALESCE((SELECT bool_and(origin='imported_result' AND status='completed'
      AND NOT provider_execution_enabled AND execution_authorization_id IS NULL AND provider_call_count=0
      AND reserved_micro_usd=0 AND settled_micro_usd=0 AND output_digest=$1) FROM signal_topic_evaluation_v2_runs),true)`:"true"} imported_inert`,
    schema.imports===2?[artifact.source_run.output_digest]:[])).rows[0]!;
  ensure(evaluation.authorities===0&&evaluation.calls===0&&evaluation.reserved==="0"&&evaluation.settled==="0"
    &&evaluation.outbox===0&&evaluation.unsafe===0&&evaluation.imported_inert,"evaluation_not_inert");
  return{ledger,schema,...frozen,protected_digest:protectedState,evaluation};
}
function assertCompleted(state:State){ensure(topicResultsMigrationPlan(state.ledger,state.schema).length===0,"migration_incomplete");
  const e=state.evaluation;ensure(e.runs===1&&e.candidates===10&&e.turns===12&&e.retrievals===11
    &&e.links===30&&e.ranks===10&&e.imports===1&&e.refinements===1,"import_cohort_incomplete");}
async function readOnly(client:pg.Client,artifact:Parameters<typeof inspect>[1]){await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try{return await inspect(client,artifact);}finally{await client.query("ROLLBACK");}}

export async function releaseSignalTopicResultsUatV1(env:NodeJS.ProcessEnv,mode:Mode){
  ensure(["preflight","capture","apply","verify"].includes(mode),"mode_invalid");
  ensure(env.NOISIA_TOPIC_RESULTS_GATE===TOPIC_RESULTS_GATE,"gate_missing");
  const current=await readFile(resolve(ROOT,"docs/product/PROMPT_LOOPING/CURRENT_PROMPT.md"),"utf8");
  ensure(current.split("\n")[0]?.includes(`# CURRENT — ${TOPIC_RESULTS_GATE} —`),"gate_not_current");
  const label=env.NOISIA_TOPIC_RESULTS_RELEASE_LABEL??"";ensure(/^[a-z0-9][a-z0-9-]{7,79}$/u.test(label),"release_label_invalid");
  const dir=resolve(ROOT,".data/signal-topic-evaluation/lab-2v-release",label);await mkdir(dir,{recursive:true,mode:0o700});
  const artifact=validateSignalTopicEvaluationV2HistoricalResultArtifact(JSON.parse((await privateRead(resolve(ROOT,
    `.data/signal-topic-evaluation/lab-2u/historical-result-${TOPIC_RESULTS_ARTIFACT.slice(7)}.json`),262144)).toString("utf8")));
  ensure(signalTopicEvaluationDigestV2(artifact)===TOPIC_RESULTS_ARTIFACT,"artifact_checksum_mismatch");
  const migrations=new Map<number,string>();for(const entry of TOPIC_RESULTS_MIGRATIONS.filter(m=>m.ordinal>=115)){
    const sql=await readFile(resolve(ROOT,"infrastructure/db/migrations",entry.file),"utf8");
    ensure(digest(sql)===entry.checksum,"migration_checksum_mismatch");migrations.set(entry.ordinal,sql);}
  const target=topicResultsTarget(parse(await readFile(resolve(ROOT,"apps/studio/.env.local"),"utf8")).DATABASE_URL??"");
  const client=new pg.Client(topicResultsPgConfig(target));await client.connect();
  const receipt=async(name:"preflight"|"capture")=>{const bytes=await privateRead(resolve(dir,`${name}.json`));
    ensure(digest(bytes)===env[`NOISIA_TOPIC_RESULTS_${name==="capture"?"RESTORE":"PREFLIGHT"}_SHA256`],"receipt_hash_mismatch");
    return{value:topicResultsValidateReceipt(JSON.parse(bytes.toString("utf8")),name),hash:digest(bytes)};};
  const emit=async(value:Receipt)=>{const bytes=Buffer.from(`${JSON.stringify(value,null,2)}\n`);
    await writeFile(resolve(dir,`${mode}.json`),bytes,{mode:0o600,flag:"wx"});return{mode,receipt_sha256:digest(bytes),
      receipt_file:resolve(dir,`${mode}.json`),counts:value.state.evaluation,provider_calls_added:0};};
  const envelope=(state:State):Receipt=>({mode,gate:TOPIC_RESULTS_GATE,target:TOPIC_RESULTS_TARGET,
    artifact:TOPIC_RESULTS_ARTIFACT,recorded_at:new Date().toISOString(),state});
  try{await client.query("SET statement_timeout='15min'");await client.query("SET lock_timeout='30s'");
    if(mode==="preflight"){const state=await readOnly(client,artifact);
      ensure(state.evaluation.runs===0&&state.evaluation.candidates===0&&state.evaluation.imports===0,"preflight_not_empty");
      return await emit(envelope(state));}
    const preflight=await receipt("preflight");
    if(mode==="capture"){
      ensure(signalTopicEvaluationDigestV2(await readOnly(client,artifact))===signalTopicEvaluationDigestV2(preflight.value.state),"state_drift");
      const inspection=JSON.parse(await docker(["inspect",CONTAINER,"--format",
        '{{json .}}'])) as {Name:string;Image:string;Config:{Image:string};State:{Running:boolean}};
      ensure(inspection.Name===`/${CONTAINER}`&&inspection.Config.Image==="pgvector/pgvector:pg17"
        &&inspection.Image===TOOL_IMAGE_ID&&inspection.State.Running,"backup_tool_unhealthy");
      const dump=resolve(dir,"before-topic-results.public.dump"),reuse=env.NOISIA_TOPIC_RESULTS_REUSE_VERIFIED_DUMP_SHA256;
      if(reuse!==undefined)await reusableDump(dump,reuse,preflight.value.recorded_at);
      else{const size=Number((await client.query<{bytes:string}>(`SELECT sum(pg_total_relation_size(c.oid))::text bytes
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`)).rows[0]!.bytes);
        const disk=await statfs(dir);ensure(disk.bavail*disk.bsize>Math.max(size,512*1024*1024),"backup_disk_space_low");
        await docker(topicResultsDumpArgs(target),`${target.password}\n`,dump);}
      const verified=await archiveCheck(dump),state=await readOnly(client,artifact);
      ensure(reuse===undefined||verified.sha256===reuse,"reused_dump_digest_mismatch");
      topicResultsValidateReceipt(preflight.value,"preflight");
      ensure(signalTopicEvaluationDigestV2(state)===signalTopicEvaluationDigestV2(preflight.value.state),"state_drift");
      return await emit({...envelope(state),preflight_sha256:preflight.hash,dump:verified,reused_verified_dump:reuse!==undefined});}
    if(mode==="verify"){const state=await readOnly(client,artifact);assertCompleted(state);
      ensure(state.frozen_digest===preflight.value.state.frozen_digest&&state.protected_digest===preflight.value.state.protected_digest,"protected_state_drift");
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try{
      const row=(await client.query<{id:string}>(`SELECT id::text FROM signal_topic_evaluation_v2_result_import_receipts
        WHERE artifact_digest=$1 AND idempotency_key=$2`,[TOPIC_RESULTS_ARTIFACT,TOPIC_RESULTS_IDEMPOTENCY])).rows[0];
      ensure(row,"exact_import_missing");await client.query("SELECT signal_topic_evaluation_v2_assert_result_import_v1($1::uuid)",[row.id]);
      }finally{await client.query("ROLLBACK");}
      return await emit({...envelope(state),preflight_sha256:preflight.hash});}
    const restore=await receipt("capture");ensure(restore.value.preflight_sha256===preflight.hash
      &&restore.value.dump?.full_stream_verified,"restore_receipt_mismatch");
    const archive=await archiveCheck(resolve(dir,"before-topic-results.public.dump"));
    ensure(signalTopicEvaluationDigestV2(archive)===signalTopicEvaluationDigestV2(restore.value.dump),"restore_archive_changed");
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");let committing=false;
    try{await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["noisia:topic-results:lab2v"]);
      topicResultsValidateReceipt(preflight.value,"preflight");topicResultsValidateReceipt(restore.value,"capture");
      const before=await inspect(client,artifact);
      ensure(signalTopicEvaluationDigestV2(before)===signalTopicEvaluationDigestV2(preflight.value.state),"state_drift");
      for(const ordinal of topicResultsMigrationPlan(before.ledger,before.schema)){const entry=TOPIC_RESULTS_MIGRATIONS.find(m=>m.ordinal===ordinal)!;
        await client.query(migrations.get(ordinal)!);await client.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
          migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint)
          VALUES($1,$2,$3,'applied','topic-results-uat-v1',$4)`,[entry.file,ordinal,entry.checksum,TOPIC_RESULTS_TARGET]);}
      const authority=(await client.query<{workspace_id:string;actor_id:string}>(`SELECT workspace_id::text,
        created_by_user_id::text actor_id FROM signal_topic_evaluation_v2_snapshots WHERE snapshot_digest=$1
          AND rights_digest=$2 AND semantic_context_authority_digest=$3 AND artifact_binding_digest=$4 AND membership_binding_digest=$5`,
        snapshotValues(artifact))).rows[0];ensure(authority,"snapshot_mismatch");
      await importSignalTopicEvaluationV2HistoricalResult({client,workspace_id:authority.workspace_id,
        actor:{id:authority.actor_id,user_type:"noisia_internal"},idempotency_key:TOPIC_RESULTS_IDEMPOTENCY,
        expected_artifact_digest:TOPIC_RESULTS_ARTIFACT,artifact});
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");const after=await inspect(client,artifact);assertCompleted(after);
      ensure(before.frozen_digest===after.frozen_digest&&before.protected_digest===after.protected_digest,"protected_state_drift");
      committing=true;await client.query("COMMIT");
      return await emit({...envelope(after),preflight_sha256:preflight.hash,restore_sha256:restore.hash});
    }catch(error){await client.query("ROLLBACK").catch(()=>undefined);
      if(committing)throw new Error("topic_results_release_commit_outcome_requires_verify");throw error;}
  }finally{await client.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  releaseSignalTopicResultsUatV1(process.env,process.argv[2] as Mode).then(result=>console.log(JSON.stringify(result)))
    .catch((error:unknown)=>{console.error(error instanceof Error&&/^topic_results_release_[a-z_]+$/u.test(error.message)
      ?error.message:"topic_results_release_failed_without_credential_details");process.exitCode=1;});
}
