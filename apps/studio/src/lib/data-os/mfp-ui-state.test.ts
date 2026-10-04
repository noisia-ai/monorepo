import assert from "node:assert/strict";
import test from "node:test";
import {executeMfpIntent,mfpContextRecovery,mfpIntent,mfpSelectionTransition} from "./mfp-ui-state";
import type {MfpRun} from "./mfp-ui";

test("an ambiguous preview A is recovered with its original snapshot after the editor changes to B",async()=>{
  const editor={label:"A",definition:"Definition A",inclusion:["A only"]};
  const intent=mfpIntent({concept:editor},"POST","preview-a");
  const sent:string[]=[];
  const transport:typeof fetch=async(_url,init)=>{
    sent.push(String(init?.body));
    if(sent.length===1)throw Error("connection lost after acceptance");
    return new Response(JSON.stringify({run_id:"run-a"}),{status:200});
  };
  await assert.rejects(executeMfpIntent("/preview",intent,transport));
  editor.label="B";editor.definition="Definition B";editor.inclusion.push("B too");
  const recovered=await executeMfpIntent("/preview",intent,transport);
  assert.equal(recovered.result.run_id,"run-a");assert.equal(sent[0],sent[1]);
  assert.deepEqual(recovered.submitted.concept,{label:"A",definition:"Definition A",inclusion:["A only"]});
  assert.notEqual(JSON.stringify(recovered.submitted.concept),JSON.stringify(editor),"the stale-preview notice must remain visible");
});

test("a waiting request can request a successor without confirming a changed context",()=>{
  const run={id:"run-b",status:"queued",waiting_full_confirmation:true} as MfpRun;
  const request=mfpContextRecovery(run);assert.deepEqual(request,{full_recalculation:true});
  const successor=mfpIntent(request!,"POST","new-context-c");
  assert.equal(successor.body.confirm_run_id,undefined);assert.equal(successor.body.entity_context_digest,undefined);
  assert.equal(successor.body.idempotency_key,"new-context-c");
  assert.equal(mfpContextRecovery({...run,status:"running"}),null);
  assert.equal(mfpContextRecovery({...run,waiting_full_confirmation:false}),null);
});

test("direct-root navigation clears corrections from another root or the first page",()=>{
  const page="/workspace/facets?view=mentions&limit=30";
  const rootA=page+"&root_id=a",rootB=page+"&root_id=b";
  for(const initial of [page,rootA]) {
    let state=mfpSelectionTransition({query:initial,ids:[]},initial,["a"]);
    state=mfpSelectionTransition(state,rootB);
    assert.deepEqual(state.ids,[],"hidden root A must not remain a correction target");
    state=mfpSelectionTransition(state,rootB,["b"]);
    assert.deepEqual(state.ids,["b"]);
    assert.deepEqual(mfpSelectionTransition(state,initial).ids,[],"returning must not restore an obsolete selection");
  }
});
