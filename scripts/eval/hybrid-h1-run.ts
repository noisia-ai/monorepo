/** Isolated private MFP experiment; no service deployment or incident-specific repair. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { loadMfpEvalIdentity } from "./fixture-identity";
import { verifyMfpEvalRights } from "./rights-check";
import { validateGold, validateSelection, type Gold, type Selection } from "./contract";
import { hybridUncertainExposureV1, measureHybridH1V1, type HybridMeasuredRootV1 } from "./hybrid-h1-measure";
import { hybridH1PopulationSqlV1 } from "./hybrid-h1-population";
import { decideHybridMembershipV1 } from "../../packages/query-engine/src/index";
import { configureHybridMembershipRouteV1, loadHybridMembershipRouteV1, requestHybridMembershipStageV1,
  type HybridStageResultV1, type HybridMembershipStageV1 } from "../../infrastructure/db/index";
import { createHybridMembershipRuntimeStoreV1, runHybridMembershipTickV1 }
  from "../../services/workers/src/workers/signal-hybrid-membership";
import { createWorkspaceEngineStorageV1 } from "../../services/workers/src/workers/signal-workspace-engine-storage";
import { readSignalLabelingReceiptV1 } from "../../services/workers/src/workers/signal-labeling-receipt-storage";

const directory=".data/dev-corpus/voyage-real/hybrid-h1-r5";
const fail=(code:string):never=>{throw new Error(code);};
type RootRow={root_id:string;input_digest:string;text:string;status:string;relevance:string;
  facets:Record<string,any>;requires_context_review:boolean};
void main(async()=>{
  const stage=process.argv.find(arg=>arg.startsWith("--stage="))?.slice(8);
  if(!process.argv.includes("--real")||!["jev","claude","report"].includes(stage??""))fail("hybrid_arguments");
  const key=process.argv.find(arg=>arg.startsWith("--run-key="))?.slice(10)??"audit-r5";
  if(!/^[a-z0-9-]{1,60}$/u.test(key))fail("hybrid_run_key_invalid");
  const identity=await loadMfpEvalIdentity(),pool=await openDatabase();
  const access={database:pool,workspace_id:identity.workspace_id,actor_user_id:identity.actor_user_id};
  try{
    let route=await loadHybridMembershipRouteV1(access);
    if(stage!=="report"){
      if(process.env.NOISIA_MFP_HYBRID_ENABLED!=="true"||process.env.NOISIA_MFP_HYBRID_LEDGER_READY!=="true"||
        (stage==="jev"?process.env.NOISIA_JEV_PROVIDER_ENABLED:process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED)!=="true")
        fail("mfp_hybrid_disabled");
      if(route.route==="standard"){
        await verifyMfpEvalRights();
        await configureHybridMembershipRouteV1({...access,route:"hybrid_h1",provider_available:true,expected_route_digest:null});
        route=await loadHybridMembershipRouteV1(access);
      }
      if(!route.route_digest)fail("hybrid_route_required");
      const capArg=process.argv.find(arg=>arg.startsWith("--strict-cap-micro-usd="));
      const cap=capArg?Number(capArg.slice(23)):null;
      if(cap!==null&&(!Number.isSafeInteger(cap)||cap<0))fail("hybrid_cap_invalid");
      const receipt=await requestHybridMembershipStageV1({...access,stage:stage as HybridMembershipStageV1,
        route_digest:route.route_digest,idempotency_key:`mfp-h1-${key}-${stage}`,provider_available:true,cap_micro_usd:cap});
      const store=createHybridMembershipRuntimeStoreV1(stage as HybridMembershipStageV1,pool);
      console.log(JSON.stringify({stage:"hybrid_started",provider_stage:stage,run_id:receipt.run_id}));
      for(;;){
        const row=(await pool.query("SELECT status,error_code,next_poll_at>now() wait FROM signal_labeling_runs WHERE id=$1",[receipt.run_id])).rows[0];
        if(row.status==="completed"){console.log(JSON.stringify({stage:"hybrid_stage_completed",provider_stage:stage}));return;}
        if(row.status==="failed")fail(`hybrid_stage_failed:${row.error_code}`);
        if(stage==="jev"||!row.wait)await runHybridMembershipTickV1({run_id:receipt.run_id,stage:stage as HybridMembershipStageV1,
          store,jevPrice:Number(process.env.NOISIA_JEV_INPUT_USD_PER_MTOK)});
        await delay(stage==="claude"?30000:100);
      }
    }
    if(!route.route_digest)fail("hybrid_report_route_required");
    const selection=JSON.parse(await readFile(".data/dev-corpus/voyage-real/gold-selection.json","utf8")) as Selection;
    validateSelection(selection);
    const gold=(await readFile(".data/dev-corpus/voyage-real/gold.jsonl","utf8")).trim().split("\n").map(line=>JSON.parse(line)) as Gold[];
    validateGold(gold,selection);
    const selected=(await pool.query("SELECT jev_facets_labeler_version_id FROM signal_hybrid_membership_routes WHERE workspace_id=$1",[identity.workspace_id])).rows[0];
    const rows:RootRow[]=(await pool.query(hybridH1PopulationSqlV1,[identity.workspace_id,selected.jev_facets_labeler_version_id])).rows;
    if(rows.length!==1086||rows.some(row=>row.requires_context_review))fail("hybrid_population_changed");
    const calls:Record<string,any>[]=(await pool.query(`SELECT call.id,run.id run_id,call.created_at,call.updated_at,call.transport,call.request,
      call.raw_sha256,call.raw_storage_key,call.raw_size_bytes,run.membership_snapshot->>'hybrid_stage' stage,call.inputs,call.results,
      call.status,call.reserved_micro_usd::text,call.settled_micro_usd::text,call.terminal_exposure_micro_usd::text,call.usage
      FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
      WHERE run.workspace_id=$1 AND run.membership_snapshot->>'route_digest'=$2 ORDER BY call.created_at,call.id`,
      [identity.workspace_id,route.route_digest])).rows;
    const overrides:Record<string,any>[]=(await pool.query(`SELECT current.root_id,current.concept_key,
      COALESCE(to_jsonb(correction)->>'decided_via','unknown') decided_via
      FROM signal_concept_memberships_current_v1 current
      JOIN signal_concept_membership_overrides correction ON correction.workspace_id=current.workspace_id
        AND correction.root_id=current.root_id AND correction.concept_key=current.concept_key
        AND correction.definition_digest=current.definition_digest AND correction.root_fingerprint=current.root_fingerprint
        AND correction.superseded_at IS NULL
      WHERE current.workspace_id=$1 AND current.source='human'`,[identity.workspace_id])).rows;
    const excluded=new Set<string>(overrides.map(row=>`${row.root_id}:${row.concept_key}`));
    const uncertain:Record<string,any>[]=(await pool.query(`SELECT DISTINCT current.root_id,current.concept_key,
      call.id,run.membership_snapshot->>'route_digest' route_digest,call.reserved_micro_usd::text,call.terminal_exposure_micro_usd::text,call.status
      FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
      CROSS JOIN LATERAL jsonb_array_elements(call.inputs) input
      CROSS JOIN LATERAL jsonb_array_elements(input->'evaluated_concepts') concept
      JOIN signal_concept_memberships_current_v1 current ON current.workspace_id=run.workspace_id
        AND current.root_id::text=input->>'root_id' AND current.root_fingerprint=input->>'root_fingerprint'
        AND current.entity_context_digest=input->>'entity_context_digest'
        AND current.effective_entities_digest=input->>'effective_entities_digest'
        AND current.concept_key=concept->>'concept_key' AND current.definition_digest=concept->>'definition_digest'
      WHERE run.workspace_id=$1 AND run.membership_snapshot->>'hybrid_stage'='jev'
        AND (call.status='unknown' OR call.terminal_exposure_micro_usd>0)`,[identity.workspace_id])).rows;
    const jev=new Map<string,HybridStageResultV1>(),claude=new Map<string,HybridStageResultV1>(),unresolved=new Set<string>(uncertain.map(row=>`${row.root_id}:${row.concept_key}`));
    for(const call of calls){
      if(call.status!=="settled")continue;
      for(const result of call.results??[]){
        const map=call.stage==="jev"?jev:claude,k=`${result.root_id}:${result.concept_key}`;
        if(map.has(k))fail("hybrid_duplicate_result");map.set(k,result);
      }
    }
    const output:HybridMeasuredRootV1[]=rows.map(row=>{
      const f=row.facets,gate=row.status==="labeled"&&row.relevance==="relevant"&&
        f?.spam_or_bot?.abstained===false&&f.spam_or_bot.value===false&&f?.entities?.abstained===false&&f.entities.value.length>0;
      const decisions:HybridMeasuredRootV1["decisions"]={},unknown:string[]=[],human:string[]=[];
      if(gate)for(const concept of selection.concepts){
        const k=`${row.root_id}:${concept.concept_key}`,j=jev.get(k),c=claude.get(k);
        if(excluded.has(k)){human.push(concept.concept_key);continue;}
        if(!j&&unresolved.has(k)){unknown.push(concept.concept_key);continue;}
        if(!j)fail("hybrid_pair_missing");
        decisions[concept.concept_key]=decideHybridMembershipV1(row.text,j!.jev,c?.claude??null);
      }
      return {root_id:row.root_id,input_digest:row.input_digest,text:row.text,gate_passed:gate,decisions,unresolved_concepts:unknown,excluded_override_concepts:human};
    });
    const billing:Record<string,any>[]=(await pool.query(`SELECT run.kind,version.provider,version.model,run.membership_snapshot->>'hybrid_stage' stage,
      run.membership_snapshot->>'route_digest' route_digest,
      count(call.id)::int calls,COALESCE(sum(call.settled_micro_usd),0)::text settled_micro_usd,
      COALESCE(sum(call.terminal_exposure_micro_usd),0)::text terminal_exposure_micro_usd,
      COALESCE(sum((call.usage->>'input_tokens')::bigint),0)::text input_tokens,
      COALESCE(sum((call.usage->>'output_tokens')::bigint),0)::text output_tokens,
      COALESCE(sum((call.usage->>'cache_read_input_tokens')::bigint),0)::text cache_read_input_tokens,
      COALESCE(sum((call.usage->>'cache_creation_input_tokens')::bigint),0)::text cache_creation_input_tokens,
      COALESCE(sum((call.usage#>>'{cache_creation,ephemeral_5m_input_tokens}')::bigint),0)::text cache_creation_5m_input_tokens,
      COALESCE(sum((call.usage#>>'{cache_creation,ephemeral_1h_input_tokens}')::bigint),0)::text cache_creation_1h_input_tokens
      FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
      JOIN signal_labeler_versions version ON version.id=run.labeler_version_id
      WHERE run.workspace_id=$1 GROUP BY run.kind,version.provider,version.model,
        run.membership_snapshot->>'hybrid_stage',run.membership_snapshot->>'route_digest'`,[identity.workspace_id])).rows;
    const cost=(kind:string,stage:string|null)=>billing.filter(row=>row.kind===kind&&row.stage===stage&&(kind==="facets"?row.provider==="typesafe":row.route_digest===route.route_digest))
      .reduce((sum,row)=>sum+Number(row.settled_micro_usd),0)/1e6;
    const excludedPairs=new Set(output.flatMap(row=>(row.excluded_override_concepts??[]).map(key=>`${row.root_id}:${key}`)));
    const currentUnknown=uncertain.filter(call=>call.route_digest===route.route_digest),historicUnknown=uncertain.filter(call=>call.route_digest!==route.route_digest);
    const storage=createWorkspaceEngineStorageV1(),models=new Map<string,number>();
    const modelSamples=[...calls.filter(call=>call.stage==="jev"&&call.status==="settled").slice(0,1),
      ...calls.filter(call=>call.stage==="claude"&&call.status==="settled")];
    for(const call of modelSamples){
      const raw=JSON.parse(await readSignalLabelingReceiptV1({storage,workspace_id:identity.workspace_id,run_id:call.run_id,
        storage_key:call.raw_storage_key,raw_sha256:call.raw_sha256,size_bytes:Number(call.raw_size_bytes)}));
      const model=call.stage==="jev"?JSON.parse(raw.body).model:raw.result.type==="succeeded"?raw.result.message.model:null;
      if(model)models.set(model,(models.get(model)??0)+1);
    }
    const window={actual_raw_models:Object.fromEntries(models),raw_model_samples:modelSamples.length,
      requested_models:[...new Set(calls.map(call=>call.request.model))],
      requested_efforts:[...new Set(calls.filter(call=>call.stage==="claude").map(call=>call.request.output_config?.effort))],
      system_cache_ttl:[...new Set(calls.filter(call=>call.stage==="claude").map(call=>call.request.system?.[0]?.cache_control?.ttl))],run_ids:[...new Set(calls.map(call=>call.run_id))],first_call_at:calls[0]?.created_at??null,
      last_call_at:calls.at(-1)?.updated_at??null,stages:["jev","claude"].map(stage=>{
        const sent=calls.filter(call=>call.stage===stage&&["submitted","settled"].includes(call.status));
        return {stage,uncertain_requests:calls.filter(call=>call.stage===stage&&call.status==="unknown").length,transport:[...new Set(sent.map(call=>call.transport))],requests:sent.length,
          roots_sent:new Set(sent.flatMap(call=>call.inputs.map((input:any)=>input.root_id))).size};
      })};
    const ledger={facets_settled_usd:cost("facets",null),jev_settled_usd:cost("membership","jev"),
      claude_settled_usd:cost("membership","claude"),unknown_calls:hybridUncertainExposureV1(currentUnknown as any).calls,
      uncertain_pair_calls:Object.fromEntries(uncertain.map(call=>[`${call.root_id}:${call.concept_key}`,call.id])),
      historical_unknown_calls:hybridUncertainExposureV1(historicUnknown as any).calls,
      historical_unknown_exposure_usd:hybridUncertainExposureV1(historicUnknown as any).exposure_usd,
      override_excluded_by_decided_via:Object.fromEntries(["human_ui","agent_assisted","unknown"].map(via=>
        [via,overrides.filter(row=>row.decided_via===via&&excludedPairs.has(`${row.root_id}:${row.concept_key}`)).length])),
      unknown_provider_usd_upper_bound:hybridUncertainExposureV1(currentUnknown as any).exposure_usd};
    const report=measureHybridH1V1(gold,output,selection.concepts.map(concept=>concept.concept_key),ledger);
    await mkdir(directory,{recursive:true,mode:0o700});
    for(const [name,value] of [["roots.jsonl",output.map(row=>JSON.stringify(row)).join("\n")+"\n"],
      ["ledger.json",JSON.stringify({route_digest:route.route_digest,window,billing,...ledger},null,2)+"\n"],
      ["report.json",JSON.stringify(report,null,2)+"\n"]])await writeFile(`${directory}/${name}`,value!,{mode:0o600});
    console.log(JSON.stringify({stage:"hybrid_reported",roots:rows.length,status:report.status,cost:report.cost}));
  }finally{await pool.end();}
});
