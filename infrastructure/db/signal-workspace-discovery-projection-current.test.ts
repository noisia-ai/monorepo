import assert from "node:assert/strict";
import test from "node:test";
import {canonicalEntityContextV1,entityContextDigestV1} from "@noisia/query-engine";
import {signalDiscoveryProjectionContextCurrentV1} from "./signal-workspace-discovery-projection-current";

function fixture(mode:"legacy"|"same"|"narrative"|"alias"|"outside"|"removed"){
 const previous=canonicalEntityContextV1({entities:[{entity_id:"brand",kind:"primary_brand",name:"Example",aliases:["Example"],disambiguation:null}]});
 const query=async(sql:string)=>{
  if(sql.includes("SELECT input_snapshot->'discovery_population'"))return{rows:mode==="legacy"?[]:[{root_ids:["selected"]}]};
  if(sql.includes("AS brand_name"))return{rows:[{workspace_id:"workspace",brand_id:"brand",brand_name:"Example"}]};
  if(sql.includes("SELECT 'primary_brand'::text AS scope"))return{rows:[{scope:"primary_brand",entity_id:"brand",entity_label:"Example",
   aliases:mode==="removed"?[]:mode==="same"||mode==="narrative"?["Example"]:["Example","New Alias"],disambiguation:null}]};
  if(sql.includes("SELECT 'brand_objective' AS kind"))return{rows:mode==="narrative"?[{kind:"brand_brief",title:"Changed narrative",content:"Different objectives"}]:[]};
  if(sql.includes("SELECT context,digest,version_no"))return{rows:[{context:previous,digest:entityContextDigestV1(previous),version_no:1}]};
  if(sql.includes("SELECT root_id,title,full_text,facets"))return{rows:[{root_id:mode==="outside"?"outside":"selected",title:null,
   full_text:"A New Alias discussion",facets:{entities:{value:[{entity_id:"brand"}]}}}]};
  throw new Error("Unexpected query");
 };
 return {query} as never;
}
test("lazy CE fence blocks only affected sealed roots; narrative and outside-sample changes preserve projection",async()=>{
 for(const mode of ["legacy","same","narrative","outside"] as const)
  assert.equal(await signalDiscoveryProjectionContextCurrentV1(fixture(mode),"workspace","engine"),true,mode);
 assert.equal(await signalDiscoveryProjectionContextCurrentV1(fixture("alias"),"workspace","engine"),false);
});
