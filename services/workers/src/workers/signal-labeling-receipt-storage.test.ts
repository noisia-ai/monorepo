import assert from "node:assert/strict";
import { test } from "node:test";
import {createHash} from "node:crypto";
import { readSignalLabelingReceiptV1 } from "./signal-labeling-receipt-storage";
import { createWorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

test("receipt loader reads the immutable scoped object reference", async () => {
  let request: unknown;
  const body = JSON.stringify({ latency_ms: 42 });
  const sha=`sha256:${createHash("sha256").update(body).digest("hex")}`;
  const storage: WorkspaceEngineStorageV1 = {
    async put() { throw new Error("unexpected_upload"); },
    async get(args: any) {
      request = { workspace_id: args.workspace_id, execution_id: args.execution_id, stored: args.stored };
      const { writeFile } = await import("node:fs/promises");
      await writeFile(args.destination, body, { flag: "wx", mode: 0o600 });
    },
  };
  const result = await readSignalLabelingReceiptV1({ storage, workspace_id: "workspace", run_id: "run",
    storage_key: "private/receipt.parts.json", raw_sha256: sha, size_bytes: body.length });
  assert.equal(result, body);
  assert.deepEqual(request, { workspace_id: "workspace", execution_id: "run",
    stored: { storage_key: "private/receipt.parts.json", sha256: sha,
      size_bytes: body.length, media_type: "application/json" } });
});

test("missing or corrupt receipt fails before replay can retry indefinitely",async()=>{
  const body="receipt",sha=`sha256:${createHash("sha256").update(body).digest("hex")}`;
  for(const failure of ["missing","corrupt","wrong_size"]){
    const storage:WorkspaceEngineStorageV1={async put(){throw new Error("unexpected_upload");},
      async get(args:any){
        if(failure==="missing")throw new Error("workspace_engine_storage_verification_failed");
        const {writeFile}=await import("node:fs/promises");
        await writeFile(args.destination,failure==="corrupt"?"bad body":body,{flag:"wx",mode:0o600});
      }};
    await assert.rejects(readSignalLabelingReceiptV1({storage,workspace_id:"workspace",run_id:"run",
      storage_key:"private/receipt.parts.json",raw_sha256:sha,size_bytes:failure==="wrong_size"?body.length+1:body.length}),
    /workspace_engine_storage_verification_failed|labeling_raw_receipt_invalid/u);
  }
});

test("storage distinguishes a missing object from a retryable 5xx",async()=>{
  const sha=`sha256:${"0".repeat(64)}`;
  for(const status of [404,503]){
    const storage=createWorkspaceEngineStorageV1({url:"https://storage.example",service_role_key:"test",bucket:"private",
      fetch:async(url)=>String(url).includes("/bucket/")
        ?new Response(JSON.stringify({id:"private",public:false}),{status:200})
        :new Response("",{status})});
    await assert.rejects(storage.get({workspace_id:"11111111-1111-1111-1111-111111111111",
      execution_id:"22222222-2222-2222-2222-222222222222",
      stored:{storage_key:`workspace-engine/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/receipt.${sha.slice(7)}.parts.json`,
        sha256:sha,size_bytes:1,media_type:"application/json"},destination:"/unused"}),
      status===404?/workspace_engine_storage_object_missing/u:/workspace_engine_storage_unavailable/u);
  }
});
