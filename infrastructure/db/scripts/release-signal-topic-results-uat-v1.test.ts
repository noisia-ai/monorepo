import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { releaseSignalTopicResultsUatV1, TOPIC_RESULTS_ARTIFACT, TOPIC_RESULTS_GATE,
  TOPIC_RESULTS_IDEMPOTENCY, TOPIC_RESULTS_MIGRATIONS, TOPIC_RESULTS_TARGET,
  topicResultsDumpArgs, topicResultsMigrationPlan, topicResultsPgConfig, topicResultsTarget,
  topicResultsValidateReceipt,topicResultsAcceptTocInputError,topicResultsValidateDumpReuse } from "./release-signal-topic-results-uat-v1";

const ledger=TOPIC_RESULTS_MIGRATIONS.map(m=>({ordinal:m.ordinal,migration_name:m.file,
  checksum_sha256:m.checksum,disposition:"applied"}));
const baseSchema={editor:0,imports:0,lab:0};
const now=Date.parse("2026-09-06T21:00:00.000Z");
const receipt={mode:"preflight" as const,gate:TOPIC_RESULTS_GATE,target:TOPIC_RESULTS_TARGET,
  artifact:TOPIC_RESULTS_ARTIFACT,recorded_at:new Date(now).toISOString(),state:{} as
    Parameters<typeof topicResultsValidateReceipt>[0]["state"]};

test("runner is inert on import and rejects missing gate before reading credentials or connecting",async()=>{
  await assert.rejects(releaseSignalTopicResultsUatV1({},"preflight"),/topic_results_release_gate_missing/u);
  await assert.rejects(releaseSignalTopicResultsUatV1({},"other" as "preflight"),/topic_results_release_mode_invalid/u);
});

test("fixed UAT routing rejects foreign, local, query override and missing-password targets",()=>{
  for(const url of ["postgresql://user:secret@127.0.0.1/db","postgresql://user:secret@foreign.invalid/db",
    "postgresql://user:secret@host.invalid/db?host=prod.invalid","postgresql://user:secret@host.invalid/db?options=x",
    "postgresql://user:secret@host.invalid/db?sslmode=disable","postgresql://user:secret@host.invalid/db#fragment",
    "postgresql://user@host.invalid/db","postgresql://user:secret@host.invalid/db?sslmode=require&sslmode=require"]){
    assert.throws(()=>topicResultsTarget(url));
  }
});

test("PostgreSQL gets explicit components, not caller URL or environment routing",()=>{
  const target={host:"configured-host",port:6543,user:"configured-user",password:"unit-secret",database:"configured-db"};
  const value=topicResultsPgConfig(target);
  assert.equal(value.host,target.host);assert.equal(value.port,target.port);assert.equal(value.database,target.database);
  assert.equal(value.user,target.user);assert.equal(value.password,target.password);
  assert.equal(value.connectionString,undefined);assert.equal(value.options,"-c search_path=public,extensions");
  assert(!value.options?.includes("$user"));
  assert.deepEqual(value.ssl,{rejectUnauthorized:false});
});

test("migration plan adds only reviewed absent 0115 and 0122 and is idempotent",()=>{
  assert.deepEqual(topicResultsMigrationPlan(ledger.slice(0,2),baseSchema),[115,122]);
  assert.deepEqual(topicResultsMigrationPlan(ledger.slice(0,3),{...baseSchema,editor:3}),[122]);
  assert.deepEqual(topicResultsMigrationPlan(ledger,{editor:3,imports:2,lab:0}),[]);
  assert.equal(TOPIC_RESULTS_IDEMPOTENCY,"uat-topic-result-import-b801de32-v1");
  assert(!TOPIC_RESULTS_MIGRATIONS.some(m=>Number(m.ordinal)===114));
});

test("missing prerequisites, wrong checksums, partial objects and Lab schema are rejected",()=>{
  assert.throws(()=>topicResultsMigrationPlan(ledger.slice(1,2),baseSchema),/prerequisite_missing/u);
  assert.throws(()=>topicResultsMigrationPlan([{...ledger[0]!,checksum_sha256:"sha256:wrong"},ledger[1]!],baseSchema),/checksum_mismatch/u);
  assert.throws(()=>topicResultsMigrationPlan(ledger.slice(0,2),{editor:1,imports:0,lab:0}),/partial_schema/u);
  assert.throws(()=>topicResultsMigrationPlan(ledger,{editor:3,imports:1,lab:0}),/partial_schema/u);
  assert.throws(()=>topicResultsMigrationPlan(ledger,{editor:3,imports:2,lab:1}),/lab_schema/u);
  assert.throws(()=>topicResultsMigrationPlan([...ledger,{...ledger[0]!,ordinal:117}],{editor:3,imports:2,lab:0}),/lab_schema/u);
});

test("receipt binds exact gate, artifact, target, mode and a one-hour action window",()=>{
  assert.equal(topicResultsValidateReceipt(receipt,"preflight",now),receipt);
  for(const change of [{gate:"old-gate"},{target:"foreign"},{artifact:"other"},{mode:"capture" as const},
    {recorded_at:new Date(now-3600001).toISOString()},{recorded_at:new Date(now+60001).toISOString()},
    {recorded_at:"invalid"}])assert.throws(()=>topicResultsValidateReceipt({...receipt,...change},"preflight",now));
});

test("fixed official backup invocation contains no password in argv and never creates a restore database",()=>{
  const password="NOT-A-REAL-SECRET";
  const args=topicResultsDumpArgs({host:"configured-host",port:5432,user:"configured-user",database:"configured-db",password});
  assert(!args.join(" ").includes(password));assert(args.includes("noisia-topic-evaluation-0114-local-tools"));
  assert(args.some(value=>value.includes("IFS= read -r PGPASSWORD")));
  assert(args.some(value=>value.includes("exec /usr/bin/pg_dump")));
  assert(args.includes("--format=custom"));assert(args.includes("--schema=public"));
  assert(!args.includes("--create"));assert(!args.includes("--clean"));
});

test("only explicit TOC EPIPE with actual child exit zero is recoverable",()=>{
  assert.equal(topicResultsAcceptTocInputError(true,"EPIPE",0),true);
  for(const args of [[false,"EPIPE",0],[true,"EPIPE",1],[true,"EPIPE",null],
    [true,"ERR_STREAM_PREMATURE_CLOSE",0],[true,"ENOENT",0],[true,undefined,0]] as const){
    assert.equal(topicResultsAcceptTocInputError(args[0],args[1],args[2]),false);
  }
});

test("backup reuse requires exact opt-in digest, private custody and post-preflight mtime",()=>{
  const value={expected:`sha256:${"a".repeat(64)}`,actual:`sha256:${"a".repeat(64)}`,regular:true,
    mode:0o600,nlink:1,uid:501,currentUid:501,mtimeMs:now,preflightAt:new Date(now).toISOString()};
  assert.doesNotThrow(()=>topicResultsValidateDumpReuse(value));
  for(const change of [{expected:""},{expected:`sha256:${"b".repeat(64)}`},{actual:"wrong"},
    {regular:false},{mode:0o644},{nlink:2},{uid:502},{mtimeMs:now-1},{preflightAt:"invalid"}]){
    assert.throws(()=>topicResultsValidateDumpReuse({...value,...change}));
  }
});

test("reviewed migration bytes are exactly the pinned release checksums",async()=>{
  for(const migration of TOPIC_RESULTS_MIGRATIONS){
    const bytes=await readFile(new URL(`../migrations/${migration.file}`,import.meta.url));
    assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`,migration.checksum);
  }
});

test("apply forces constraints and invariant checks before commit and contains no provider/deployment path",async()=>{
  const source=await readFile(new URL("./release-signal-topic-results-uat-v1.ts",import.meta.url),"utf8");
  assert.match(source,/BEGIN ISOLATION LEVEL SERIALIZABLE/u);
  const constraints=source.indexOf('await client.query("SET CONSTRAINTS ALL IMMEDIATE")');
  const commit=source.indexOf('await client.query("COMMIT")');
  assert(constraints>0&&commit>constraints);
  assert(source.slice(constraints,commit).includes("protected_state_drift"));
  assert.match(source,/ROLLBACK/u);assert.match(source,/commit_outcome_requires_verify/u);
  assert.match(source,/\/usr\/bin\/pg_restore","--file=\/dev\/null/u);
  assert.doesNotMatch(source,/ANTHROPIC_API_KEY|generateText|createAnthropic|railway up|git push|DROP DATABASE|DROP SCHEMA|session_replication_role/u);
});
