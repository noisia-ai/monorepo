import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { loadAdoptionCandidate } from "./signal-topic-catalog";
const revision="10000000-0000-4000-8000-000000000001";
const digest=`sha256:${"a".repeat(64)}`;
function fixture(options: { missing?:boolean; stale?:boolean }={}) {
 const queries:string[]=[];
 const pool={async query(sql:string,params:unknown[]) {
  queries.push(sql);
  if(sql.includes("SELECT consolidation_run_id"))return {rows:options.missing?[]:[{consolidation_run_id:revision}]};
  if(sql.includes("pg_advisory_xact_lock"))return {rows:[]};
  assert.match(sql,/revision.status='validated' AND run.status='validated'/u);
  assert.match(sql,/newer.revision>revision.revision/u);
  assert.match(sql,/concept.workspace_id=\$1::uuid/u);
  assert.deepEqual(params,[revision,revision,"discovered"]);
  return {rows:[{label:"Repair journey",definition:"Documents a repair experience.",revision_digest:options.stale?`sha256:${"b".repeat(64)}`:digest}]};
 }} as unknown as Pool;
 return {pool,workspace_id:revision,actor_user_id:revision,input:{run_key:`workspace-discovery:${revision}`,candidate_key:"discovered",expected_revision_digest:digest,scope:"primary_brand" as const},queries};
}
test("discovery adoption copies complete editorial label/definition and provenance without inherited memberships",async()=>{
 const f=fixture(); const candidate=await loadAdoptionCandidate(f);
 assert.equal(candidate.origin,"workspace_discovery"); assert.equal(candidate.title,"Repair journey");
 assert.equal(candidate.description,"Documents a repair experience."); assert.equal(candidate.candidate_digest,digest);
 assert.deepEqual(candidate.positive_examples,[]); assert.equal(candidate.scope,"primary_brand");
 assert.equal(f.queries.length,3);
});
test("discovery adoption rejects cross-workspace/missing candidates and revision drift",async()=>{
 await assert.rejects(loadAdoptionCandidate(fixture({missing:true})),/topic_candidate_not_found/u);
 await assert.rejects(loadAdoptionCandidate(fixture({stale:true})),/topic_candidate_revision_stale/u);
 const f=fixture(); await assert.rejects(loadAdoptionCandidate({...f,input:{...f.input,expected_revision_digest:undefined}}),/topic_candidate_request_invalid/u);
 assert.equal(f.queries.length,0);
});
