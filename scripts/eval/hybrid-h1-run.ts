/** Private remote MFP runner. Both paid stages use signal_labeling_calls through the shared store. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
// @ts-expect-error guarded private runner JavaScript
import { main, openDatabase } from "../dev-corpus/guard.mjs";
import { loadMfpEvalIdentity } from "./fixture-identity";
import { verifyMfpEvalRights } from "./rights-check";
import { validateGold, validateSelection, type Gold, type Selection } from "./contract";
import { measureHybridH1V1, type HybridMeasuredRootV1 } from "./hybrid-h1-measure";
import { conceptForJudgeSchemaV1, decideHybridMembershipV1,
  type ConceptForJudgeV1, type HybridClaudeDecisionV1, type HybridJevDecisionV1 } from "../../packages/query-engine/src/index";
import { configureHybridMembershipRouteV1, requestHybridMembershipStageV1,
  type HybridStageResultV1, type HybridMembershipStageV1 } from "../../infrastructure/db/index";
import { inspectFacetContextChangeV1 } from "../../infrastructure/db/signal-mention-facets";
import { loadSignalTopicCatalogStoreV1 } from "../../infrastructure/db/signal-topic-catalog";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "../../infrastructure/db/signal-workspace-capabilities";
import { signalWorkspaceFeatureEnabledV1 } from "../../infrastructure/db/signal-workspace-features";
import { createHybridMembershipRuntimeStoreV1,
  runHybridMembershipTickV1 } from "../../services/workers/src/workers/signal-hybrid-membership";
import { createWorkspaceEngineStorageV1 } from "../../services/workers/src/workers/signal-workspace-engine-storage";

const directory=".data/dev-corpus/voyage-real/hybrid-h1-r4";
const fail=(code:string):never=>{throw new Error(code);};
type RootRow={root_id:string;input_digest:string;text:string;status:string;relevance:string;
  facets:Record<string,any>;requires_context_review:boolean;entity_context_digest:string};
type StageCall={status:string;results:HybridStageResultV1[]|null;settled_micro_usd:string|null};

void main(async()=>{
  if (!process.argv.includes("--real") || process.env.NOISIA_MFP_HYBRID_ENABLED!=="true" ||
      process.env.NOISIA_MFP_HYBRID_LEDGER_READY!=="true" || process.env.NOISIA_JEV_PROVIDER_ENABLED!=="true" ||
      process.env.NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED!=="true") fail("mfp_hybrid_disabled");
  const jevPrice=Number(process.env.NOISIA_JEV_INPUT_USD_PER_MTOK);
  if (!Number.isFinite(jevPrice)||jevPrice<=0) fail("mfp_hybrid_jev_price_required");
  const capArg=process.argv.find(arg=>arg.startsWith("--strict-cap-micro-usd="));
  const strictCap=capArg?Number(capArg.slice("--strict-cap-micro-usd=".length)):null;
  if (strictCap!==null&&(!Number.isSafeInteger(strictCap)||strictCap<0)) fail("mfp_hybrid_cap_invalid");
  await verifyMfpEvalRights();
  const identity=await loadMfpEvalIdentity();
  const selection=JSON.parse(await readFile(".data/dev-corpus/voyage-real/gold-selection.json","utf8")) as Selection;
  validateSelection(selection);
  const gold=(await readFile(".data/dev-corpus/voyage-real/gold.jsonl","utf8")).trim().split("\n").map(line=>JSON.parse(line)) as Gold[];
  validateGold(gold,selection);
  const pool=await openDatabase();
  try {
    const access={database:pool,workspace_id:identity.workspace_id,actor_user_id:identity.actor_user_id};
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:pool,workspace_id:identity.workspace_id,
      actor_user_id:identity.actor_user_id});
    if (!caps.can_request_processing || !await signalWorkspaceFeatureEnabledV1({queryable:pool,
      workspace_id:identity.workspace_id,feature:"mention_facets"}) ||
      !await signalWorkspaceFeatureEnabledV1({queryable:pool,workspace_id:identity.workspace_id,
        feature:"concept_membership"})) fail("mfp_hybrid_authority_or_opt_in_missing");
    const context=await inspectFacetContextChangeV1(pool,identity.workspace_id);
    if (context.changed) fail("mfp_hybrid_entity_context_stale");
    const catalog=await loadSignalTopicCatalogStoreV1({queryable:pool,workspace_id:identity.workspace_id});
    const concepts=selection.concepts.map(({concept_key})=>catalog.topics.find(topic=>topic.term_key===concept_key));
    if (concepts.some(concept=>!concept||concept.scope!=="all_conversations"))
      fail("mfp_hybrid_eval_concepts_changed");
    const frozen:ConceptForJudgeV1[]=concepts.map(concept=>conceptForJudgeSchemaV1.parse({
      concept_key:concept!.term_key,label:concept!.label,scope:concept!.scope,
      definition:concept!.definition,inclusion:concept!.inclusion,exclusion:concept!.exclusion,
      positive_examples:concept!.positive_examples,negative_examples:concept!.negative_examples,
      definition_digest:concept!.definition_digest}));
    const facetsLabeler=(await pool.query<{id:string}>(`SELECT version.id
      FROM signal_labeler_versions version JOIN signal_mention_facet_labels label
        ON label.labeler_digest=version.labeler_digest
      JOIN signal_mention_facets_current_v1 current ON current.workspace_id=label.workspace_id
        AND current.root_id=label.root_id AND current.input_digest=label.input_digest
        AND NOT current.requires_context_review AND current.entity_context_digest=label.entity_context_digest
      WHERE label.workspace_id=$1 AND version.kind='facets' AND version.provider='typesafe'
        AND version.model='jev-1.13.0' AND version.status<>'retired'
        AND label.status IN('labeled','abstained')
      GROUP BY version.id HAVING count(DISTINCT label.root_id)=1086
      ORDER BY version.id LIMIT 1`,[identity.workspace_id])).rows[0];
    if (!facetsLabeler) fail("mfp_hybrid_complete_jev_facets_missing");
    const rows:RootRow[]=(await pool.query(`WITH jev_labels AS MATERIALIZED (
      SELECT DISTINCT ON(label.root_id) label.root_id,label.input_digest,label.facets,label.relevance,label.status,
        label.entity_context_digest
      FROM signal_mention_facet_labels label JOIN signal_labeler_versions version ON version.labeler_digest=label.labeler_digest
      WHERE label.workspace_id=$1 AND version.id=$2
      ORDER BY label.root_id,label.created_at DESC)
      SELECT f.root_id,f.input_digest,f.full_text text,f.requires_context_review,
        jev.facets,jev.relevance,jev.status,jev.entity_context_digest
      FROM signal_mention_facets_current_v1 f JOIN jev_labels jev ON jev.root_id=f.root_id AND jev.input_digest=f.input_digest
      JOIN signal_membership_evidence_rights_v1 rights ON rights.workspace_id=f.workspace_id AND rights.root_id=f.root_id
        AND rights.metrics AND rights.evidence
      WHERE f.workspace_id=$1 ORDER BY f.root_id`,[identity.workspace_id,facetsLabeler.id])).rows;
    if (rows.length!==1086||rows.some(row=>row.requires_context_review||row.entity_context_digest!==context.digest))
      fail("mfp_hybrid_full_corpus_or_context_missing");
    const policy=(await pool.query(`SELECT action,provider,model FROM signal_processing_policy_actions action
      JOIN signal_processing_policy_versions policy ON policy.id=action.policy_version_id
      WHERE policy.organization_id=$1 AND policy.status='active' AND policy.valid_from<=now()
        AND policy.valid_until>now() AND action.action IN('concept_membership_jev','concept_membership_claude')`,
      [identity.organization_id])).rows as Array<{action:string;provider:string;model:string}>;
    if (!policy.some(row=>row.action==="concept_membership_jev"&&row.provider==="typesafe"&&row.model==="jev-1.13.0")||
      !policy.some(row=>row.action==="concept_membership_claude"&&row.provider==="anthropic"&&row.model==="claude-sonnet-5-5"))
      fail("mfp_hybrid_two_provider_policy_missing");
    await createWorkspaceEngineStorageV1().assertReady?.();
    const route=await configureHybridMembershipRouteV1({...access,route:"hybrid_h1",provider_available:true});
    const route_digest:string=route.route_digest??fail("mfp_hybrid_route_missing");
    const selected=(await pool.query<{jev_facets_labeler_version_id:string}>(
      "SELECT jev_facets_labeler_version_id FROM signal_hybrid_membership_routes WHERE workspace_id=$1",
      [identity.workspace_id])).rows[0];
    if (!selected || selected.jev_facets_labeler_version_id!==facetsLabeler.id)
      fail("mfp_hybrid_facets_labeler_changed");
    const facetCost=(await pool.query<{micro:string;unknown:number}>(`SELECT
      COALESCE(sum(call.settled_micro_usd) FILTER(WHERE call.status='settled'),0)::text micro,
      count(*) FILTER(WHERE call.status IN('reserved','submitting','submitted','unknown')
        OR call.raw_storage_key IS NOT NULL AND NOT call.results_applied)::int unknown
      FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id
      WHERE run.workspace_id=$1 AND run.kind='facets' AND run.labeler_version_id=$2`,
      [identity.workspace_id,selected.jev_facets_labeler_version_id])).rows[0]!;
    if (facetCost.unknown) fail("mfp_hybrid_facet_billing_unsettled");
    const totalFacet=Number(facetCost.micro);
    if (strictCap!==null&&totalFacet>strictCap) fail("mfp_hybrid_strict_cap_exhausted");
    const runStage=async(stage:HybridMembershipStageV1,priorCost:number)=>{
      await verifyMfpEvalRights(undefined,pool);
      const cap=strictCap===null?null:strictCap-totalFacet-priorCost;
      if (cap!==null&&cap<0) fail("mfp_hybrid_strict_cap_exhausted");
      const receipt=await requestHybridMembershipStageV1({...access,stage,route_digest,
        idempotency_key:`mfp-hybrid-h1-r4-${stage}`,provider_available:true,cap_micro_usd:cap});
      const store=createHybridMembershipRuntimeStoreV1(stage,pool);
      for (let tick=0;tick<10000;tick++) {
        if (tick%25===0) await verifyMfpEvalRights(receipt.run_id,pool);
        const status=await runHybridMembershipTickV1({run_id:receipt.run_id,stage,store,jevPrice});
        if (status==="completed") return receipt.run_id;
        if (typeof status==="object"&&(status.status==="outcome_unknown"||status.status==="not_claimed"))
          fail(`mfp_hybrid_${stage}_requires_reconciliation`);
        if (status==="failed") fail(`mfp_hybrid_${stage}_failed`);
      }
      return fail(`mfp_hybrid_${stage}_tick_limit`);
    };
    const jevRun=await runStage("jev",0);
    const stageCalls=async(runId:string):Promise<StageCall[]>=>{
      const calls:StageCall[]=(await pool.query("SELECT status,results,settled_micro_usd::text FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at,id",
        [runId])).rows;
      if (calls.some(call=>call.status!=="settled"||!call.results)) fail("mfp_hybrid_stage_ledger_incomplete");
      return calls;
    };
    const jevCalls=await stageCalls(jevRun),jevMicro=jevCalls.reduce((sum,call)=>sum+Number(call.settled_micro_usd),0);
    const claudeRun=await runStage("claude",jevMicro);
    const claudeCalls=await stageCalls(claudeRun),claudeMicro=claudeCalls.reduce((sum,call)=>sum+Number(call.settled_micro_usd),0);
    const jev=new Map<string,HybridStageResultV1>(),claude=new Map<string,HybridStageResultV1>();
    const key=(result:HybridStageResultV1)=>`${result.root_id}:${result.concept_key}`;
    for (const call of jevCalls) for (const result of call.results??[]) jev.set(key(result),result);
    for (const call of claudeCalls) for (const result of call.results??[]) claude.set(key(result),result);
    const output:HybridMeasuredRootV1[]=rows.map(row=>{
      const facets=row.facets;
      const gate_passed=row.status==="labeled"&&row.relevance==="relevant"&&
        facets?.spam_or_bot?.abstained===false&&facets.spam_or_bot.value===false&&
        facets?.entities?.abstained===false&&facets.entities.value.length>0;
      const decisions:HybridMeasuredRootV1["decisions"]={};
      if (gate_passed) for (const concept of frozen) {
        const j=jev.get(`${row.root_id}:${concept.concept_key}`),c=claude.get(`${row.root_id}:${concept.concept_key}`);
        if (!j||j.definition_digest!==concept.definition_digest) return fail("mfp_hybrid_pair_missing");
        decisions[concept.concept_key]=decideHybridMembershipV1(row.text,j.jev,c?.claude??null);
      }
      return {root_id:row.root_id,input_digest:row.input_digest,text:row.text,gate_passed,decisions};
    });
    const ledger={facets_settled_usd:totalFacet/1e6,jev_settled_usd:jevMicro/1e6,
      claude_settled_usd:claudeMicro/1e6,unknown_calls:0};
    const report=measureHybridH1V1(gold,output,frozen.map(concept=>concept.concept_key),ledger);
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(`${directory}/roots.jsonl`,output.map(row=>JSON.stringify(row)).join("\n")+"\n",{flag:"wx",mode:0o600});
    await writeFile(`${directory}/ledger.json`,JSON.stringify({run_ids:[jevRun,claudeRun],...ledger}),{flag:"wx",mode:0o600});
    await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
    console.log(JSON.stringify({stage:"hybrid_complete",roots:output.length,
      observed_usd_per_1000:report.cost.observed_usd_per_1000,
      review_required:report.full_corpus.review_required,unknown_calls:0}));
  } finally {await pool.end();}
});
