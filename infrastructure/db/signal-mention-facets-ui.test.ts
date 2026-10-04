import assert from "node:assert/strict";
import test from "node:test";
import {overrideMentionFacetsBatchV1,type LabelingDatabaseV1} from "./signal-mention-facets";
const first="10000000-0000-4000-8000-000000000001",second="10000000-0000-4000-8000-000000000002";
function harness(allowed=true){
  const calls:Array<{sql:string;params:unknown[]}> = [];
  const client={release(){},async query(sql:string,params:unknown[]=[]){calls.push({sql,params});
    if(sql.includes("workspace.status workspace_status"))return {rows:[{workspace_status:"active",brand_status:"active",actor_status:"active",
      user_type:"noisia_internal",primary_role:allowed?"founder":"unknown",organization_status:"active",brand_same_organization:true}]};
    if(sql.includes("AS brand_name"))return {rows:[{workspace_id:first,brand_id:first,brand_name:"Example",brand_slug:"example"}]};
    if(sql.includes("'primary_brand'::text AS scope"))return {rows:[{scope:"primary_brand",entity_id:first,entity_label:"Example",aliases:[],disambiguation:null}]};
    if(sql.includes("SELECT current.root_id,COALESCE"))return {rows:[{root_id:first,facets:null},{root_id:second,facets:null}]};
    return {rows:[]};
  }};return {calls,database:{connect:async()=>client,query:client.query} as unknown as LabelingDatabaseV1};
}
test("a page of human corrections writes together and leaves absent dimensions abstained",async()=>{
  const h=harness();const result=await overrideMentionFacetsBatchV1({database:h.database,workspace_id:first,actor_user_id:second,
    overrides:[first,second].map(root_id=>({root_id,dimension:"voice",value:{value:"individual",confidence:"high",abstained:false}}))});
  assert.equal(result.updated,2);
  assert.equal(h.calls.filter(c=>c.sql==="BEGIN").length,1);
  const inserts=h.calls.filter(c=>c.sql.includes("INSERT INTO signal_mention_facet_overrides"));assert.equal(inserts.length,1);
  assert.deepEqual(JSON.parse(String(inserts[0]!.params[1])).map((p:{dimension:string})=>p.dimension),["voice","voice"]);
  assert.ok(h.calls.some(c=>c.sql==="COMMIT"));
});
test("unrelated correction stores coherent entities and reason for each root",async()=>{
  const h=harness();await overrideMentionFacetsBatchV1({database:h.database,workspace_id:first,actor_user_id:second,
    overrides:[{root_id:first,dimension:"entities",value:{value:[],confidence:"high",abstained:false}},
      {root_id:first,dimension:"unrelated_reason",value:"off_topic"}]});
  const patches=JSON.parse(String(h.calls.find(c=>c.sql.includes("INSERT INTO signal_mention_facet_overrides"))!.params[1]));
  assert.equal(patches.find((p:{dimension:string})=>p.dimension==="entities").value.abstained,false);
  assert.equal(patches.find((p:{dimension:string})=>p.dimension==="unrelated_reason").value,"off_topic");
});
test("revoked authority rejects the whole page before source reads and writes",async()=>{
  const h=harness(false);await assert.rejects(overrideMentionFacetsBatchV1({database:h.database,workspace_id:first,actor_user_id:second,
    overrides:[{root_id:first,dimension:"voice",value:{value:"individual",confidence:"high",abstained:false}}]}),/facets_forbidden/);
  assert.ok(h.calls.some(c=>c.sql==="ROLLBACK"));assert.ok(!h.calls.some(c=>c.sql.includes("INSERT INTO")));
});
test("an invalid entity prevents all corrections in the batch",async()=>{
  const h=harness();await assert.rejects(overrideMentionFacetsBatchV1({database:h.database,workspace_id:first,actor_user_id:second,
    overrides:[{root_id:first,dimension:"voice",value:{value:"media",confidence:"high",abstained:false}},
      {root_id:second,dimension:"entities",value:{value:[{entity_id:"missing",kind:"competitor",salience:"secondary"}],confidence:"high",abstained:false}}]}),/unknown_entity_id/);
  assert.ok(!h.calls.some(c=>c.sql.includes("INSERT INTO")));assert.ok(h.calls.some(c=>c.sql==="ROLLBACK"));
});
