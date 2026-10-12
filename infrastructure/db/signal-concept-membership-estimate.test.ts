import test from "node:test";
import assert from "node:assert/strict";
import {estimateMembershipWorkV1, selectMembershipInputsV1, type MembershipRunV1} from "./signal-concept-memberships";
import {membershipLabelerIdentityV1, labelerDigestV1, type ConceptForJudgeV1} from "@noisia/query-engine";
const concept:ConceptForJudgeV1={concept_key:"service",label:"Service",definition:"Service experience",scope:"primary_brand",
  inclusion:[],exclusion:[],positive_examples:[],negative_examples:[],definition_digest:`sha256:${"a".repeat(64)}`};
const args={workspace_id:"workspace",concepts:[concept,{...concept,concept_key:"travel"}],context:{entities:[]},
  labeler_digest:labelerDigestV1(membershipLabelerIdentityV1()),sample:null,preview:false};
test("a completed catalog has zero marginal cost; one edited concept quotes only its pending pairs",async()=>{
  let population={roots:0,characters:"0",pairs:"0"};
  const c={async query(){return{rows:[population]};}};
  const done=await estimateMembershipWorkV1(c as never,args);
  assert.deepEqual(done,{roots:0,estimated_requests:0,estimated_micro_usd:0});
  population={roots:8,characters:"2800",pairs:"8"};
  const edited=await estimateMembershipWorkV1(c as never,args);
  population={...population,pairs:"16"};
  const both=await estimateMembershipWorkV1(c as never,args);
  assert.equal(edited.roots,8);assert.equal(edited.estimated_requests,1);
  assert.equal(both.estimated_micro_usd-edited.estimated_micro_usd,8*160*5,
    "changing one definition must not quote outputs for an already-current concept");
});
test("estimate and dispatch share scope, human/cache and uncertain-call fences; preview evaluates its sample again",async()=>{
  const queries:Array<{sql:string;params:unknown[]}>=[];
  const c={async query(sql:string,params:unknown[]){queries.push({sql,params});return{rows:[{roots:0,characters:"0",pairs:"0"}]};}};
  await estimateMembershipWorkV1(c as never,{...args,sample:["sample"],preview:true});
  const run={workspace_id:args.workspace_id,cursor_root_id:null,labeler_digest:args.labeler_digest,
    membership_snapshot:{concepts:args.concepts,sample_root_ids:["sample"],preview:true}} as MembershipRunV1;
  await selectMembershipInputsV1(c as never,run);
  assert.equal(queries[0]!.sql.split(" SELECT count(*)::int roots")[0],queries[1]!.sql.split(" SELECT f.root_id,f.input_digest")[0]);
  assert.deepEqual(queries[0]!.params,queries[1]!.params);
  assert.equal(queries[0]!.params[4],true);
  const sql=queries[0]!.sql;
  assert.match(sql,/current.source='human' OR current.labeler_digest=\$6/);
  assert.match(sql,/current.verdict IN\('belongs','not_belongs','insufficient','refused'\)/);
  assert.match(sql,/current.verdict='error' AND current.error_code IN\('membership_item_schema_invalid','membership_evidence_invalid'\)/);
  assert.doesNotMatch(sql,/current.verdict<>'pending'/);
  for (const retryable of ['definitely_not_sent','retry_requires_authority','provider_errored','expired','result_missing','membership_json_invalid']) {
    assert.ok(!sql.includes(`'${retryable}'`), `${retryable} must stay pending`);
  }
  assert.match(sql,/uncertain.status IN\('submitting','unknown'\)/);
  assert.match(sql,/c.scope='all_conversations' OR EXISTS/);
  assert.doesNotMatch(sql,/LIMIT 200/);
});
