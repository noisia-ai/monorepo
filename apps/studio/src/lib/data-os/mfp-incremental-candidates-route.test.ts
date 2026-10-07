import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";

const workspaceId="11111111-1111-4111-8111-111111111111";
const payload={contract_version:"signal-incremental-discovery-candidates-v1",workspace_id:workspaceId,candidates:[]};
function fixture({deniedStatus,enabled=true,failFlag=false}:{deniedStatus?:number;enabled?:boolean;failFlag?:boolean}={}) {
  const calls:string[]=[];
  const denied=deniedStatus?Response.json({error:"not_found"},{status:deniedStatus}):null;
  const pool={};
  const dependencies:Record<string,unknown>={
    "../_lib":{
      loadSignalWorkspaceContextForTopics:async(id:string)=>{
        assert.equal(id,workspaceId);calls.push("access");
        return denied?{response:denied}:{session:{appUser:{id:"actor"}}};
      },
      topicResponse:(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}}),
      topicError:(_error:unknown,code:string)=>Response.json({error:code},{status:503})
    },
    "@/lib/db":{pool},
    "@noisia/db":{
      signalWorkspaceFeatureEnabledV1:async(args:unknown)=>{
        assert.deepEqual(args,{queryable:pool,workspace_id:workspaceId,feature:"mfp_discovery"});
        calls.push("flag");if(failFlag)throw Error("private database detail");return enabled;
      },
      loadSignalIncrementalDiscoveryCandidatesV1:async(args:unknown)=>{
        assert.deepEqual(args,{database:pool,workspace_id:workspaceId,actor_user_id:"actor"});
        calls.push("candidates");return {...payload,candidates:[{candidate_key:"real-candidate"}]};
      }
    }
  };
  const source=readFileSync(new URL("../../app/api/data-os/signal/[workspaceId]/topics/incremental-candidates/route.ts",import.meta.url),"utf8");
  const exports:Record<string,unknown>={};
  new Function("require","exports",ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(
    (name:string)=>{assert.ok(name in dependencies,`Unexpected dependency: ${name}`);return dependencies[name];},exports);
  const get=exports.GET as (request:Request,context:{params:Promise<{workspaceId:string}>})=>Promise<Response>;
  return {calls,denied,read:()=>get(new Request("https://noisia.invalid/candidates"),{params:Promise.resolve({workspaceId})})};
}

test("disabling optional discovery returns an empty valid catalog without revoking Topics or reading candidates",async()=>{
  const f=fixture({enabled:false}),response=await f.read();
  assert.equal(response.status,200);assert.equal(response.headers.get("Cache-Control"),"private, no-store");
  assert.deepEqual(await response.json(),payload);assert.deepEqual(f.calls,["access","flag"]);
});
test("real access failures retain their original response before reading flags or candidates",async()=>{
  for(const deniedStatus of [401,403,404]) {
    const f=fixture({deniedStatus,enabled:false});
    assert.equal(await f.read(),f.denied);assert.deepEqual(f.calls,["access"]);
  }
});
test("enabled discovery reads the workspace and actor scoped candidates",async()=>{
  const f=fixture(),response=await f.read();
  assert.equal(response.status,200);assert.deepEqual((await response.json()).candidates,[{candidate_key:"real-candidate"}]);
  assert.deepEqual(f.calls,["access","flag","candidates"]);
});
test("a failed flag lookup remains a technical error rather than empty success or loss of access",async()=>{
  const f=fixture({failFlag:true}),response=await f.read();
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:"topic_incremental_candidates_unavailable"});
  assert.deepEqual(f.calls,["access","flag"]);
});
