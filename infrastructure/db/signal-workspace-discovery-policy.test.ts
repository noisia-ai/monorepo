import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { discoveryStrictCapV1, loadSignalDiscoveryPolicyV1 } from "./signal-workspace-discovery-policy";
test("MFP null means no strict maximum and cannot remove or raise a server maximum",()=>{
 assert.equal(discoveryStrictCapV1(undefined,null),null);assert.equal(discoveryStrictCapV1(null,null),null);
 assert.equal(discoveryStrictCapV1(null,100),100);assert.equal(discoveryStrictCapV1(undefined,100),100);
 assert.equal(discoveryStrictCapV1(50,100),50);assert.equal(discoveryStrictCapV1(50,null),50);
 for(const value of [0,-1,101,NaN,Infinity,1.5])assert.throws(()=>discoveryStrictCapV1(value,100));
});
test("MFP reads the current server action/configuration and preserves nullable daily and run maxima",async()=>{
 for(const cap of [null,"100"]){
 const db={query:async(sql:string)=>{
  assert.match(sql,/policy.status='active'/u);assert.match(sql,/action.action='topic_interpretation'/u);
  assert.match(sql,/action.configuration=\$3::jsonb/u);
  return {rows:[{id:"policy",cap,daily:cap,budget_timezone:"UTC"}]};
 }} as unknown as Pool;
 const result=await loadSignalDiscoveryPolicyV1(db,"workspace");
 assert.equal(result.available,true);assert.equal(result.maximum_cap_micro_usd,cap===null?null:100);
 assert.equal(result.daily_cap_micro_usd,cap===null?null:100);
 }
 const missing={query:async()=>({rows:[]})} as unknown as Pool;
 assert.equal((await loadSignalDiscoveryPolicyV1(missing,"workspace")).available,false);
});

test("discovery catalog bootstrap needs live client authority, active action and the explicit MFP entry",async()=>{
 const {ensureSignalTopicCatalogStoreV1}=await import("./signal-topic-catalog");
 const previous=process.env.NOISIA_MENTION_FACETS_ENABLED;process.env.NOISIA_MENTION_FACETS_ENABLED="true";
 const authority={workspace_status:"active",brand_status:"active",actor_status:"active",user_type:"client",primary_role:"client_admin",
  same_organization:true,brand_access_level:"admin",organization_status:"active",brand_same_organization:true};
 const clientFor=(overrides:Record<string,unknown>={},policy=true)=>({query:async(sql:string)=>{
  if(sql.includes("actor.primary_role"))return {rows:[{...authority,...overrides}]};
  if(sql.includes("action.action='topic_interpretation'"))return{rows:policy?[{id:"policy",cap:null,daily:null,budget_timezone:"UTC"}]:[]};
  if(sql.includes("SELECT id::text,taxonomy_id::text,version,status"))return{rows:[{id:"existing-profile"}]};
  if(sql.includes("pg_advisory_xact_lock"))return{rows:[]};
  throw new Error("unexpected bootstrap query");
 }}) as unknown as import("pg").PoolClient;
 try{
  const args={workspace_id:"workspace",actor_user_id:"actor",processing_mode:"workspace-discovery-v1" as const};
  assert.deepEqual(await ensureSignalTopicCatalogStoreV1({...args,client:clientFor()}),{taxonomy_profile_id:"existing-profile",created:false});
  for(const overrides of [{brand_access_level:null},{actor_status:"suspended"},{same_organization:false},{primary_role:"client_viewer"}])
   await assert.rejects(ensureSignalTopicCatalogStoreV1({...args,client:clientFor(overrides)}),/topic_processing_permissions_required/);
  await assert.rejects(ensureSignalTopicCatalogStoreV1({...args,client:clientFor({},false)}),/topic_processing_permissions_required/);
  await assert.rejects(ensureSignalTopicCatalogStoreV1({...args,processing_mode:undefined,client:clientFor()}),/topic_processing_permissions_required/);
  process.env.NOISIA_MENTION_FACETS_ENABLED="false";
  await assert.rejects(ensureSignalTopicCatalogStoreV1({...args,client:clientFor()}),/topic_processing_permissions_required/);
 }finally{if(previous===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=previous;}
});
