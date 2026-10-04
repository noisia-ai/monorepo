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
