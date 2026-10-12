import assert from 'node:assert/strict';
import test from 'node:test';
import {overrideConceptMembershipsV1} from './signal-concept-memberships';
process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED='true';
const workspace='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002';
function harness(allowed=true){
 const calls:Array<{sql:string;params:unknown[]}> = [];
 const client={release(){},async query(sql:string,params:unknown[]=[]){
  calls.push({sql,params});
  if(sql.includes('workspace.status workspace_status'))return{rows:[{workspace_status:'active',brand_status:'active',actor_status:'active',user_type:'noisia_internal',primary_role:allowed?'founder':'unknown',organization_status:'active',brand_same_organization:true}]};
  if(sql.includes('signal_workspace_features'))return{rows:[{enabled:true}]};
  if(sql.includes('membership-override-targets'))return{rows:[{count:1}]};
  if(sql.includes('INSERT INTO signal_concept_membership_overrides'))return{rows:[],rowCount:1};
  return{rows:[]};
 }};return{calls,database:{connect:async()=>client} as never};
}
for(const decided_via of ['human_ui','agent_assisted'] as const)test(`preserves explicit ${decided_via} through atomic correction`,async()=>{
 const h=harness();assert.deepEqual(await overrideConceptMembershipsV1({database:h.database,workspace_id:workspace,actor_user_id:actor,
  overrides:[{root_id:actor,concept_key:'example',verdict:'belongs',decided_via}]}),{updated:1});
 const insert=h.calls.find(c=>c.sql.includes('INSERT INTO'))!;
 assert.match(insert.sql,/root_fingerprint,decided_via/);assert.equal(JSON.parse(String(insert.params[1]))[0].decided_via,decided_via);
 assert.equal(h.calls.at(-1)?.sql,'COMMIT');
});
test('missing origin rejects before authority or writes; revoked access cannot record either origin',async()=>{
 const h=harness();await assert.rejects(overrideConceptMembershipsV1({database:h.database,workspace_id:workspace,actor_user_id:actor,
  overrides:[{root_id:actor,concept_key:'example',verdict:'belongs'}] as never}),/membership_overrides_invalid/);
 assert.equal(h.calls.length,0);
 const denied=harness(false);await assert.rejects(overrideConceptMembershipsV1({database:denied.database,workspace_id:workspace,actor_user_id:actor,
  overrides:[{root_id:actor,concept_key:'example',verdict:'belongs',decided_via:'agent_assisted'}]}),/membership_forbidden/);
 assert.equal(denied.calls.some(c=>c.sql.includes('INSERT INTO')),false);assert.equal(denied.calls.at(-1)?.sql,'ROLLBACK');
});
