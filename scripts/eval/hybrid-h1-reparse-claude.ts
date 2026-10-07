/** One-time H1 derived-decision repair from settled Claude raw receipts. No provider calls. */
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { loadMfpEvalIdentity } from "./fixture-identity";
import { verifyMfpEvalRights } from "./rights-check";
import { anthropicUsageV1, llmCostMicroUsdV1, llmPriceV1,
  parseAnthropicResponseV1, parseHybridClaudeAnswerV1,
  type MembershipInputV1 } from "../../packages/query-engine/src/index";
import { reconcileHybridClaudeParseV1, type HybridDecisionInputV1 } from "../../infrastructure/db/index";
import { createWorkspaceEngineStorageV1 } from "../../services/workers/src/workers/signal-workspace-engine-storage";
import { readSignalLabelingReceiptV1 } from "../../services/workers/src/workers/signal-labeling-receipt-storage";

type RepairCall={id:string;run_id:string;raw_storage_key:string;raw_sha256:string;
  raw_size_bytes:string;settled_micro_usd:string;usage:unknown;
  inputs:MembershipInputV1[];results:Array<Omit<HybridDecisionInputV1,"text">>};
const fail=(code:string):never=>{throw new Error(code);};

void main(async()=>{
  if(!process.argv.includes("--real")||!process.argv.includes("--execute")||
    process.env.NOISIA_MFP_HYBRID_REPARSE_EXECUTE!=="true") fail("mfp_hybrid_reparse_disabled");
  const identity=await loadMfpEvalIdentity();
  const pool=await openDatabase();
  try{
    const quarantines=(await pool.query<{id:string}>(`SELECT id FROM signal_labeling_runs
      WHERE workspace_id=$1 AND kind='membership' AND error_code='labeling_outcome_unknown'
        AND membership_snapshot->>'hybrid_stage'='jev'`,[identity.workspace_id])).rows.map((row:{id:string})=>row.id);
    if(quarantines.length!==2) fail("mfp_hybrid_quarantine_count_changed");
    await verifyMfpEvalRights(undefined,pool,quarantines);
    const run=(await pool.query<{id:string;route_digest:string;status:string;error_code:string|null}>(`
      SELECT id,membership_snapshot->>'route_digest' route_digest,status,error_code
      FROM signal_labeling_runs WHERE workspace_id=$1 AND idempotency_key=$2 AND kind='membership'
        AND membership_snapshot->>'hybrid_stage'='claude'`,
      [identity.workspace_id,"mfp-hybrid-h1-r4-claude"])).rows[0];
    if(!run||run.status!=="completed"||run.error_code||!run.route_digest)
      fail("mfp_hybrid_claude_run_not_terminal");
    const route=(await pool.query<{route_digest:string}>(
      "SELECT route_digest FROM signal_hybrid_membership_routes WHERE workspace_id=$1",
      [identity.workspace_id])).rows[0];
    if(route?.route_digest!==run.route_digest) fail("mfp_hybrid_route_changed");
    const calls=(await pool.query<RepairCall>(`SELECT call.id,call.run_id,call.raw_storage_key,
      call.raw_sha256,call.raw_size_bytes::text,call.settled_micro_usd::text,call.usage,
      call.inputs,call.results FROM signal_labeling_calls call WHERE call.run_id=$1
        AND call.workspace_id=$2 AND call.provider='anthropic' AND call.model='claude-sonnet-5-5'
        AND call.status='settled' AND call.results_applied
        AND call.results->0->'claude'->>'verdict'='error'
      ORDER BY call.created_at,call.id`,[run.id,identity.workspace_id])).rows;
    const storage=createWorkspaceEngineStorageV1();
    await storage.assertReady?.();
    let reparsed=0,notLengthFailure=0,stillInvalid=0;
    const verdicts:Record<string,number>={};
    for(const call of calls){
      const size=Number(call.raw_size_bytes),micro=Number(call.settled_micro_usd);
      if(!Number.isSafeInteger(size)||size<0||!Number.isSafeInteger(micro)||micro<0||
        !call.raw_storage_key||!call.raw_sha256||call.inputs.length!==1||call.results.length!==1)
        fail("mfp_hybrid_reparse_receipt_invalid");
      const rawText=await readSignalLabelingReceiptV1({storage,workspace_id:identity.workspace_id,
        run_id:run.id,storage_key:call.raw_storage_key,raw_sha256:call.raw_sha256,size_bytes:size});
      const raw=JSON.parse(rawText) as {body:string;http_status:number};
      if(raw.http_status!==200) fail("mfp_hybrid_reparse_http_invalid");
      const message=JSON.parse(raw.body),usage=anthropicUsageV1(message);
      if(llmCostMicroUsdV1(usage,llmPriceV1("anthropic","claude-sonnet-5-5","sync"))!==micro)
        fail("mfp_hybrid_reparse_cost_changed");
      const parsed=parseAnthropicResponseV1(message);
      if(parsed.status!=="ok") {notLengthFailure++;continue;}
      let value:unknown;
      try{value=JSON.parse(parsed.text!);}catch{stillInvalid++;continue;}
      if(!value||typeof value!=="object"||!("rationale" in value)||
        typeof value.rationale!=="string"||value.rationale.trim().length<=300){
        notLengthFailure++;continue;
      }
      const input=call.inputs[0]!,old=call.results[0]!;
      const claude=parseHybridClaudeAnswerV1(input,parsed.text!);
      if(!["belongs","not_belongs","insufficient"].includes(claude.verdict)){
        stillInvalid++;continue;
      }
      const corrected:HybridDecisionInputV1={...old,text:input.text,claude};
      const result=await reconcileHybridClaudeParseV1({database:pool,
        workspace_id:identity.workspace_id,route_digest:run.route_digest,run_id:run.id,
        call_id:call.id,raw_sha256:call.raw_sha256,usage,settled_micro_usd:micro,corrected});
      reparsed++;
      verdicts[result.verdict]=(verdicts[result.verdict]??0)+1;
    }
    console.log(JSON.stringify({stage:"mfp_hybrid_claude_raw_reparse",examined:calls.length,
      reparsed,not_length_failure:notLengthFailure,still_invalid:stillInvalid,
      verdicts,provider_calls:0}));
  }finally{await pool.end();}
});
