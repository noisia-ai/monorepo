import { createHash } from "node:crypto";

import {
  QUERY_COMPOSER_CORE_CONTRACT_VERSION,
  QUERY_COMPOSER_GENERATION_LINEAGE_CONTRACT_VERSION,
  QUERY_ENGINE_PIPELINE_VERSION,
  buildQueryComposerPrompt,
  composeQueryDraftWithProviderV1,
  formatMicroUsd,
  parseUsdToMicroUsd,
  queryComposerAcquisitionBriefDigestV1,
  queryComposerCoreInputDigestV1,
  queryComposerDigestV1,
  signalStrategicCostUpperBoundMicroUsdV1,
  validateQueryComposerAcquisitionBriefV1,
  type ComposedQuery,
  type QueryComposerCoreInput,
  type QueryComposerProviderV1,
  type SignalAcquisitionQueryGenerationPreflightV1
} from "@noisia/query-engine";

import {
  createSignalAcquisitionQueryVersionFromEngineV1,
  loadSignalAcquisitionLiveAuthorityV1,
  loadSignalAcquisitionPlanV1,
  SignalAcquisitionPlanError
} from "@/lib/data-os/signal-acquisition-plan";
import { loadSignalAcquisitionKnowledgeContextV1 } from "@/lib/data-os/signal-acquisition-brief";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";
import type { ResolvedSignalWorkspace,SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

export type SignalAcquisitionQueryComposerPlatformConfigurationV1 = {
  provider: string;
  model: string;
  pricing_version: string;
  max_input_tokens_per_call: number;
  max_output_tokens_per_call: number;
  input_usd_per_million_tokens: string;
  output_usd_per_million_tokens: string;
};

type ComposerPlanRow = {
  id:string;plan_version:number;draft_revision:number;draft_digest:string;
  brand_os_profile_id:string;brand_os_profile_version:number;brand_os_digest:string;
  identity_catalog_digest:string;acquisition_brief:unknown;acquisition_brief_digest:string|null;
  brand_name:string;brand_display_name:string;brand_slug:string;brand_industry:string|null;
  brand_industry_sub:string|null;brand_description:string|null;brand_countries:string[];
  brand_seed_handles:string[];profile_metadata:Record<string,unknown>;
};
type ComposerSlotRow = {
  id:string;slot_key:string;scope:"primary_brand"|"competitor"|"category"|"reference";
  entity_id:string;label:string;entity_revision_digest:string;
  latest_query_version:number|null;
  latest_query_origin_kind:string|null;
  latest_query_fallback_used:boolean|null;
};
type ComposerContext = {
  plan:ComposerPlanRow;
  sourceKey:string;
  slots:ComposerSlotRow[];
  input:QueryComposerCoreInput;
  contextDigest:string;
  planDigest:string;
  blockers:string[];
};
type GenerationSuccess = {
  plan_version:number;draft_revision:number;source_key:string;
  query_drafts:Array<{slot_key:string;scope:string;query_version:number;origin:"engine-generated";
    state:"generated"|"generated_with_fallback";fallback:{used:boolean;reason:string|null}}>;
  plan_promoted:false;provider_calls:number;
};
type GenerationFailure = {
  contract_version:"signal-acquisition-query-generation-failure-v1";
  error_code:"query_generation_failed";
};
type GenerationOperation = Awaited<ReturnType<typeof beginSignalProductOperationV1<
  GenerationSuccess|GenerationFailure
>>>;

export async function loadSignalAcquisitionQueryGenerationPreflightV1(args:{
  queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;
  sourceKey:string;
  hardCapUsd:string;
  configuration:SignalAcquisitionQueryComposerPlatformConfigurationV1;
}):Promise<SignalAcquisitionQueryGenerationPreflightV1>{
  const configuration=validatePlatformConfiguration(args.configuration);
  const hardCapMicroUsd=parseUsdToMicroUsd(args.hardCapUsd);
  const estimatedMicroUsd=signalStrategicCostUpperBoundMicroUsdV1({
    input_tokens:configuration.max_input_tokens_per_call*2,
    output_tokens:configuration.max_output_tokens_per_call*2,
    input_usd_per_million_tokens:configuration.input_usd_per_million_tokens,
    output_usd_per_million_tokens:configuration.output_usd_per_million_tokens
  });
  const context=await loadComposerContext(args);
  const blockers=[...context.blockers];
  if(estimatedMicroUsd>hardCapMicroUsd)blockers.push("hard_cap_insufficient");
  const requiredSlots=context.slots.map((slot)=>({
    slot_key:slot.slot_key,scope:slot.scope as "primary_brand"|"competitor"|"category",
    label:slot.label,state:slot.latest_query_version===null?"not_generated" as const
      :slot.latest_query_origin_kind==="engine-generated"&&slot.latest_query_fallback_used===true
        ?"generated_with_fallback" as const:"generated" as const
  }));
  return{
    contract_version:"signal-acquisition-query-generation-preflight-v1",
    readiness:blockers.length===0?"ready":"blocked",
    blockers:[...new Set(blockers)].sort(),
    plan_version:context.plan.plan_version,
    plan_digest:context.planDigest,
    context_digest:context.contextDigest,
    required_slots:requiredSlots,
    slot_count:requiredSlots.length,
    maximum_provider_calls:2,
    provider:{key:configuration.provider,model:configuration.model,
      pricing_version:configuration.pricing_version},
    budget:{estimated_max_cost_usd:formatMicroUsd(estimatedMicroUsd),
      hard_cap_usd:formatMicroUsd(hardCapMicroUsd),within_hard_cap:estimatedMicroUsd<=hardCapMicroUsd},
    writes_performed:false,provider_calls:0
  };
}

/**
 * Synchronous application boundary for fixtures and deterministic providers. A future real
 * provider transport must use a queue adapter that prepares outside the write transaction,
 * then rechecks the same plan/context CAS before calling this persistence path.
 */
export async function generateSignalAcquisitionQueryDraftsV1(args:{
  queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;
  sourceKey:string;
  hardCapUsd:string;
  configuration:SignalAcquisitionQueryComposerPlatformConfigurationV1;
  idempotencyKey:string;
  provider:QueryComposerProviderV1;
  now?:()=>Date;
}){
  const preflight=await loadSignalAcquisitionQueryGenerationPreflightV1(args);
  assertGenerationPreflightReady(preflight);
  const operation=await reserveSignalAcquisitionQueryGenerationV1(args,preflight);
  const replay=replayGenerationOperation(operation);
  if(replay)return replay;
  const prepared=await prepareSignalAcquisitionQueryDraftsV1(args);
  return persistPreparedSignalAcquisitionQueryDraftsV1({...args,prepared,rootOperation:operation});
}

/**
 * Product boundary for real provider transport. All provider work happens before the
 * short serializable write transaction; the persistence phase rechecks plan and context
 * CAS under the canonical workspace lock.
 */
export async function generateSignalAcquisitionQueryDraftsProductV1(args:{
  workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;
  sourceKey:string;
  hardCapUsd:string;
  configuration:SignalAcquisitionQueryComposerPlatformConfigurationV1;
  idempotencyKey:string;
  provider:QueryComposerProviderV1;
  now?:()=>Date;
}){
  const {pool}=await import("@/lib/db");
  const {withSignalAcquisitionTransactionV1}=await import("@/lib/data-os/signal-acquisition-plan");
  const preflight=await loadSignalAcquisitionQueryGenerationPreflightV1({...args,queryable:pool});
  assertGenerationPreflightReady(preflight);
  const operation=await withSignalAcquisitionTransactionV1((queryable)=>(
    reserveSignalAcquisitionQueryGenerationV1({...args,queryable},preflight)
  ));
  const replay=replayGenerationOperation(operation);
  if(replay)return replay;
  try{
    const prepared=await prepareSignalAcquisitionQueryDraftsV1({...args,queryable:pool});
    return await withSignalAcquisitionTransactionV1((queryable)=>
      persistPreparedSignalAcquisitionQueryDraftsV1({...args,queryable,prepared,
        rootOperation:operation}));
  }catch(error){
    await withSignalAcquisitionTransactionV1((queryable)=>
      completeSignalProductOperationV1({queryable,workspaceId:args.workspace.id,
        key:operation.key,result:{contract_version:"signal-acquisition-query-generation-failure-v1",
          error_code:"query_generation_failed"} satisfies GenerationFailure})).catch(()=>undefined);
    throw error;
  }
}

export async function loadSignalAcquisitionQueryGenerationPreflightProductV1(args:{
  workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;
  sourceKey:string;
  hardCapUsd:string;
  configuration:SignalAcquisitionQueryComposerPlatformConfigurationV1;
}){
  const {pool}=await import("@/lib/db");
  return loadSignalAcquisitionQueryGenerationPreflightV1({...args,queryable:pool});
}

export async function loadSignalAcquisitionQueryDraftDetailProductV1(args:{
  workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;
  slotKey:string;
  queryVersion:number;
}){
  const {pool}=await import("@/lib/db");
  return loadSignalAcquisitionQueryDraftDetailV1({...args,queryable:pool});
}

async function prepareSignalAcquisitionQueryDraftsV1(args:{
  queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;
  sourceKey:string;
  hardCapUsd:string;
  configuration:SignalAcquisitionQueryComposerPlatformConfigurationV1;
  provider:QueryComposerProviderV1;
}){
  const preflight=await loadSignalAcquisitionQueryGenerationPreflightV1(args);
  assertGenerationPreflightReady(preflight);
  const before=await loadComposerContext(args);
  if(before.blockers.length||before.planDigest!==preflight.plan_digest
      ||before.contextDigest!==preflight.context_digest){
    throw new SignalAcquisitionPlanError("query_generation_preflight_drift",409);
  }
  const providerCounter={calls:0};
  const composed=await composeQueryDraftWithProviderV1({
    input:before.input,model:args.configuration.model,provider:{
      async generate(request){
        providerCounter.calls+=1;
        if(providerCounter.calls>2)throw new Error("Query Composer provider call limit exceeded.");
        return args.provider.generate(request);
      }
    }
  });
  return{preflight,before,composed,providerCalls:providerCounter.calls};
}

async function persistPreparedSignalAcquisitionQueryDraftsV1(args:{
  queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;
  actor:SignalWorkspaceUser;
  sourceKey:string;
  hardCapUsd:string;
  configuration:SignalAcquisitionQueryComposerPlatformConfigurationV1;
  idempotencyKey:string;
  now?:()=>Date;
  prepared:Awaited<ReturnType<typeof prepareSignalAcquisitionQueryDraftsV1>>;
  rootOperation:GenerationOperation;
}){
  const {before,composed,providerCalls}=args.prepared;
  const rootOperation=args.rootOperation;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
    `signal-acquisition-plan:${args.workspace.id}`
  ]);
  const after=await loadComposerContext(args);
  if(after.blockers.length||after.plan.id!==before.plan.id
      ||after.plan.draft_revision!==before.plan.draft_revision
      ||after.plan.draft_digest!==before.plan.draft_digest
      ||after.contextDigest!==before.contextDigest){
    throw new SignalAcquisitionPlanError("query_generation_post_provider_drift",409);
  }
  const proposals=mapComposedQueries(after,composed);
  const generatedAt=(args.now?.()??new Date()).toISOString();
  const promptTemplateDigest=queryComposerDigestV1({
    core_contract:QUERY_COMPOSER_CORE_CONTRACT_VERSION,
    pipeline_version:QUERY_ENGINE_PIPELINE_VERSION,
    rendered_prompt:buildQueryComposerPrompt(after.input)
  });
  const constructionPlanDigest=queryComposerDigestV1(
    composed.query_components.generation_contract?.construction_plan??null
  );
  const acquisitionProvider=after.input.brief.provider_key;
  const acquisitionProviderSchema=after.input.brief.provider_schema_version;
  if(acquisitionProvider!=="sentione"||acquisitionProviderSchema!=="sentione-csv-47-v1"){
    throw new SignalAcquisitionPlanError("query_generation_provider_contract_drift",409);
  }
  const queryDrafts=[] as Array<{slot_key:string;scope:string;query_version:number;
    origin:"engine-generated";state:"generated"|"generated_with_fallback";
    fallback:{used:boolean;reason:string|null}}>;
  for(const proposal of proposals){
    const reports={
      structural:composed.query_components.generation_contract?.queries[proposal.queryIdentity]??null,
      semantic:composed.query_components.generation_contract?.semantic_queries[proposal.queryIdentity]??null
    };
    const fallback=proposal.fallbackReason!==null;
    const result=await createSignalAcquisitionQueryVersionFromEngineV1({
      queryable:args.queryable,workspace:args.workspace,actor:args.actor,
      idempotencyKey:`engine-query-${sha256(`${args.idempotencyKey}\u001f${proposal.slot.slot_key}`)}`,
      slotKey:proposal.slot.slot_key,input:{source_key:args.sourceKey,
        provider:acquisitionProvider,
        provider_syntax_version:after.input.brief.provider_syntax_version,
        provider_schema_version:acquisitionProviderSchema,
        query_text:proposal.queryText,
        structured_terms:proposal.structuredTerms,cadence:"manual",
        default_period:after.input.brief.default_capture_period?{
          ...after.input.brief.default_capture_period,timezone:after.input.brief.timezone
        }:null},
      lineage:{contract_version:QUERY_COMPOSER_GENERATION_LINEAGE_CONTRACT_VERSION,
        model:args.configuration.model,pipeline_version:QUERY_ENGINE_PIPELINE_VERSION,
        prompt_template_digest:promptTemplateDigest,context_digest:after.contextDigest,
        construction_plan_digest:constructionPlanDigest,
        validation_report_digest:queryComposerDigestV1(reports),fallback_used:fallback,
        fallback_reason:proposal.fallbackReason,
        optional_study_context:after.input.brief.optional_study_context,generated_at:generatedAt}
    });
    queryDrafts.push({slot_key:proposal.slot.slot_key,scope:proposal.slot.scope,
      query_version:result.query_version,origin:"engine-generated",
      state:fallback?"generated_with_fallback":"generated",fallback:{used:fallback,
        reason:proposal.fallbackReason}});
  }
  const finalContext=await loadComposerContext(args);
  const response={plan_version:finalContext.plan.plan_version,
    draft_revision:finalContext.plan.draft_revision,source_key:args.sourceKey,
    query_drafts:queryDrafts,plan_promoted:false as const,provider_calls:providerCalls};
  await completeSignalProductOperationV1({queryable:args.queryable,workspaceId:args.workspace.id,
    key:rootOperation.key,result:response});
  return response;
}

async function reserveSignalAcquisitionQueryGenerationV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  sourceKey:string;hardCapUsd:string;configuration:SignalAcquisitionQueryComposerPlatformConfigurationV1;
  idempotencyKey:string;
},preflight:SignalAcquisitionQueryGenerationPreflightV1):Promise<GenerationOperation>{
  const operation=await beginSignalProductOperationV1<GenerationSuccess|GenerationFailure>({
    ...args,action:"generate-acquisition-queries",input:{
      source_key:args.sourceKey,hard_cap_usd:preflight.budget.hard_cap_usd,
      model:preflight.provider.model,pricing_version:preflight.provider.pricing_version,
      configuration_digest:queryComposerDigestV1(args.configuration)
    }
  });
  if(!operation.created&&operation.replay===null){
    throw new SignalAcquisitionPlanError("query_generation_in_progress",409);
  }
  return operation;
}

function replayGenerationOperation(operation:GenerationOperation):GenerationSuccess|null{
  if(!operation.replay)return null;
  if("contract_version" in operation.replay){
    throw new SignalAcquisitionPlanError(operation.replay.error_code,409);
  }
  return operation.replay;
}

function assertGenerationPreflightReady(preflight:SignalAcquisitionQueryGenerationPreflightV1){
  if(preflight.readiness!=="ready"){
    throw new SignalAcquisitionPlanError(`query_generation_blocked:${preflight.blockers.join(",")}`,409);
  }
}

export async function loadSignalAcquisitionQueryDraftDetailV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  slotKey:string;queryVersion:number;
}){
  await loadSignalAcquisitionPlanV1(args);
  const result=await args.queryable.query<{
    query_version:number;query_text_private:string;status:string;origin_kind:string;
    generation_fallback_used:boolean|null;generation_fallback_reason:string|null;
    generation_model:string|null;generation_pipeline_version:string|null;generated_at:string|null;
    structured_terms:{include:string[];exclude:string[];aliases:string[]};cadence:string;
    default_period_start:string|null;default_period_end:string|null;timezone:string;
    review_status:"pending"|"approved"|"rejected";reviewed_at:string|null;
  }>(`
    SELECT query.query_version,query.query_text_private,query.status,query.origin_kind,
      query.generation_fallback_used,query.generation_fallback_reason,query.generation_model,
      query.generation_pipeline_version,query.generated_at::text,query.structured_terms,
      query.cadence,query.default_period_start::text,query.default_period_end::text,query.timezone,
      COALESCE(review.decision,
        CASE WHEN query.status='current' THEN 'approved'
          WHEN carried.status='current' THEN COALESCE(carried_review.decision,'approved') END,
        'pending') AS review_status,
      COALESCE(review.decided_at,carried_review.decided_at)::text AS reviewed_at
    FROM signal_acquisition_query_versions query
    JOIN signal_acquisition_slots slot ON slot.id=query.slot_id AND slot.workspace_id=query.workspace_id
    LEFT JOIN LATERAL(
      SELECT decision,decided_at FROM signal_acquisition_query_review_events event
      WHERE event.workspace_id=query.workspace_id AND event.query_version_id=query.id
      ORDER BY event.event_sequence DESC LIMIT 1
    ) review ON true
    LEFT JOIN signal_acquisition_query_versions carried
      ON carried.id=query.carried_from_query_version_id
      AND carried.workspace_id=query.workspace_id
      AND carried.definition_hash=query.definition_hash
    LEFT JOIN LATERAL(
      SELECT decision,decided_at FROM signal_acquisition_query_review_events event
      WHERE event.workspace_id=carried.workspace_id AND event.query_version_id=carried.id
      ORDER BY event.event_sequence DESC LIMIT 1
    ) carried_review ON true
    WHERE query.workspace_id=$1::uuid AND slot.slot_key=$2 AND query.query_version=$3
    ORDER BY query.created_at DESC LIMIT 1
  `,[args.workspace.id,args.slotKey,args.queryVersion]);
  const row=result.rows[0];
  if(!row)throw new SignalAcquisitionPlanError("query_version_not_found",404);
  return{slot_key:args.slotKey,query_version:row.query_version,query_text:row.query_text_private,
    status:row.status,origin:row.origin_kind,
    generation_state:row.origin_kind==="engine-generated"
      ?row.generation_fallback_used?"generated_with_fallback":"generated":"generated",
    validation_summary:{fallback_used:row.generation_fallback_used===true,
      fallback_reason:row.generation_fallback_reason},
    lineage:{model:row.generation_model,pipeline_version:row.generation_pipeline_version,
      generated_at:row.generated_at},structured_terms:row.structured_terms,cadence:row.cadence,
    default_period:row.default_period_start&&row.default_period_end?{
      start:row.default_period_start,end:row.default_period_end,timezone:row.timezone
    }:null,review:{status:row.review_status,reviewed_at:row.reviewed_at}};
}

async function loadComposerContext(args:{queryable:SignalBrandPolicyQueryable;
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;sourceKey:string}):Promise<ComposerContext>{
  await loadSignalAcquisitionPlanV1(args);
  const planResult=await args.queryable.query<ComposerPlanRow>(`
    SELECT plan.id::text,plan.plan_version,plan.draft_revision,plan.draft_digest,
      plan.brand_os_profile_id::text,plan.brand_os_profile_version,plan.brand_os_digest,
      plan.identity_catalog_digest,plan.acquisition_brief,plan.acquisition_brief_digest,
      brand.name AS brand_name,brand.display_name AS brand_display_name,brand.slug AS brand_slug,
      brand.industry AS brand_industry,brand.industry_sub AS brand_industry_sub,
      brand.description AS brand_description,COALESCE(brand.countries,ARRAY[]::char(2)[])::text[] AS brand_countries,
      COALESCE(brand.brand_seed_handles,ARRAY[]::text[]) AS brand_seed_handles,
      profile.metadata AS profile_metadata
    FROM signal_acquisition_plans plan
    JOIN signal_workspaces workspace ON workspace.id=plan.workspace_id AND workspace.status='active'
    JOIN brands brand ON brand.id=workspace.brand_id AND brand.organization_id=workspace.organization_id
      AND brand.status='active'
    JOIN brand_os_profiles profile ON profile.id=plan.brand_os_profile_id
      AND profile.brand_id=workspace.brand_id AND profile.organization_id=workspace.organization_id
      AND profile.version=plan.brand_os_profile_version
    WHERE plan.workspace_id=$1::uuid AND plan.status='draft'
  `,[args.workspace.id]);
  const plan=planResult.rows[0];
  if(!plan)throw new SignalAcquisitionPlanError("acquisition_draft_required",409);
  const slotResult=await args.queryable.query<ComposerSlotRow>(`
      SELECT DISTINCT ON(slot.slot_key) slot.id::text,slot.slot_key,slot.scope,
        slot.entity_id::text,slot.label,slot.entity_revision_digest,
        latest_query.query_version AS latest_query_version,
        latest_query.origin_kind AS latest_query_origin_kind,
        latest_query.generation_fallback_used AS latest_query_fallback_used
      FROM signal_acquisition_slots slot
      LEFT JOIN LATERAL (
        SELECT query.query_version,query.origin_kind,query.generation_fallback_used
        FROM signal_acquisition_query_versions query
        WHERE query.workspace_id=slot.workspace_id AND query.plan_id=slot.plan_id
          AND query.slot_id=slot.id
        ORDER BY query.query_version DESC LIMIT 1
      ) latest_query ON true
      WHERE slot.workspace_id=$1::uuid AND slot.plan_id=$2::uuid
      ORDER BY slot.slot_key,slot.slot_version DESC
  `,[args.workspace.id,plan.id]);
  const activeSlots=slotResult.rows.filter((slot)=>slot.scope!=="reference");
  const source=await args.queryable.query<{source_key:string}>(`
    SELECT source_key FROM data_sources WHERE workspace_id=$1::uuid AND source_key=$2
      AND status='active' AND source_contract_version='signal-data-source-connector-v1'
      AND provider='sentione'
  `,[args.workspace.id,args.sourceKey]);
  const live=await loadSignalAcquisitionLiveAuthorityV1(args.queryable,args.workspace);
  const blockers:string[]=[];
  if(!source.rows[0])blockers.push("connector_unavailable");
  const primary=activeSlots.filter((slot)=>slot.scope==="primary_brand"
    &&slot.entity_id===args.workspace.subject.id);
  if(primary.length!==1)blockers.push("primary_slot_required");
  const liveCategories=live.entities.filter((entity)=>entity.entity_type==="category");
  const categories=activeSlots.filter((slot)=>slot.scope==="category"
    &&liveCategories.some((entity)=>entity.id===slot.entity_id));
  if(liveCategories.length!==1||categories.length!==1)blockers.push("category_slot_required");
  const competitors=activeSlots.filter((slot)=>slot.scope==="competitor"
    &&live.competitors.some((competitor)=>competitor.id===slot.entity_id));
  if(competitors.length!==live.competitors.length)blockers.push("competitor_slot_drift");
  if(activeSlots.some((slot)=>slot.scope==="competitor"
      &&!live.competitors.some((competitor)=>competitor.id===slot.entity_id))){
    blockers.push("retired_competitor_slot_present");
  }
  let brief;
  try{brief=validateQueryComposerAcquisitionBriefV1(plan.acquisition_brief);}catch{
    blockers.push("acquisition_brief_required");
    brief=null;
  }
  if(brief&&(plan.acquisition_brief_digest!==queryComposerAcquisitionBriefDigestV1(brief)
          ||brief.brand_os_profile_version!==live.profile.version
          ||brief.brand_os_digest!==live.profile.digest
          ||brief.identity_catalog_digest!==live.catalogDigest)){
    blockers.push("acquisition_brief_drift");
  }
  if(brief&&(brief.provider_key!=="sentione"
      ||brief.provider_schema_version!=="sentione-csv-47-v1")){
    blockers.push("acquisition_provider_contract_unavailable");
  }
  const knowledge=brief?await loadSignalAcquisitionKnowledgeContextV1({
    queryable:args.queryable,workspace:args.workspace,references:brief.knowledge_context_refs
  }):{
    sources:[] as Array<{type:string;content:unknown}>,digest:null,missing:false
  };
  if(brief&&(knowledge.missing||knowledge.digest!==brief.knowledge_context_digest)){
    blockers.push("knowledge_context_drift");
  }
  const category=categories[0];
  const competitorEntities=competitors.map((slot)=>{
    const entity=live.competitors.find((candidate)=>candidate.id===slot.entity_id)!;
    return{key:slot.slot_key,name:entity.label,aliases:entity.aliases};
  });
  const fallbackBrief=brief??{
    contract_version:"signal-acquisition-brief-v1" as const,objective:"blocked",purpose:"blocked",
    market:null,countries:[],languages:[],timezone:args.workspace.timezone,
    default_capture_period:null,target_window_months:null,construction_mode:"exploratory" as const,
    brand_os_profile_version:plan.brand_os_profile_version,brand_os_digest:plan.brand_os_digest,
    identity_catalog_digest:plan.identity_catalog_digest,
    knowledge_context_digest:queryComposerDigestV1([]),knowledge_context_refs:[],
    provider_key:"sentione",provider_syntax_version:"sentione-query-v1",
    provider_schema_version:"sentione-csv-47-v1",optional_study_context:null
  };
  const categoryLive=category?liveCategories.find((entity)=>entity.id===category.entity_id):null;
  const input:QueryComposerCoreInput={contractVersion:QUERY_COMPOSER_CORE_CONTRACT_VERSION,
    brief:fallbackBrief,subject:{type:"brand",name:plan.brand_display_name||plan.brand_name,
        slug:plan.brand_slug,industry:categoryLive?.canonical_name??plan.brand_industry,
        industrySub:plan.brand_industry_sub,categoryAliases:categoryLive?.aliases??[],
        countries:plan.brand_countries,
      brandSeedHandles:plan.brand_seed_handles,description:plan.brand_description},
    methodology:{slug:"signal-acquisition",name:"Signal Acquisition",version:"1",
      manifest:{query_mode:fallbackBrief.construction_mode}},
    competitors:competitorEntities.map((entity)=>entity.name),competitorEntities,
    brandSeeds:[plan.brand_name,plan.brand_display_name,...plan.brand_seed_handles].filter(Boolean),
    knowledgeSources:knowledge.sources,memoryIndustry:[],memoryBrand:[]};
  const requiredSlots=[...primary,...(category?[category]:[]),...competitors]
    .sort((left,right)=>scopeOrder(left.scope)-scopeOrder(right.scope)||left.slot_key.localeCompare(right.slot_key));
  return{plan,sourceKey:args.sourceKey,slots:requiredSlots,input,
    contextDigest:queryComposerCoreInputDigestV1(input),planDigest:plan.draft_digest,
    blockers:[...new Set(blockers)].sort()};
}

function mapComposedQueries(context:ComposerContext,composed:ComposedQuery){
  const contract=composed.query_components.generation_contract;
  if(!contract)throw new SignalAcquisitionPlanError("query_generation_contract_missing",422);
  const byIdentity=new Map<string,string>([["brand",composed.query_text],
    ...(composed.industry_query_text?[["category",composed.industry_query_text] as [string,string]]:[]),
    ...(composed.competitor_queries??[]).map((query)=>[`competitor:${query.entity}`,query.query_text] as [string,string])]);
  const expected=new Set(context.slots.map((slot)=>slot.scope==="primary_brand"?"brand":
    slot.scope==="category"?"category":`competitor:${slot.slot_key}`));
  if(byIdentity.size!==expected.size||[...expected].some((identity)=>!byIdentity.has(identity))
      ||[...byIdentity.keys()].some((identity)=>!expected.has(identity))){
    throw new SignalAcquisitionPlanError("query_generation_slot_identity_mismatch",422);
  }
  const fallbackScopes=new Set(contract.fallback_scopes??[]);
  const globalFallback=composed.query_components.fallback_used===true&&fallbackScopes.size===0;
  return context.slots.map((slot)=>{
    const queryIdentity=slot.scope==="primary_brand"?"brand":slot.scope==="category"?"category":
      `competitor:${slot.slot_key}`;
    const queryText=byIdentity.get(queryIdentity)!;
    const anchors=slot.scope==="primary_brand"?contract.construction_plan.anchors.brand:
      slot.scope==="category"?contract.construction_plan.anchors.category:
        contract.construction_plan.anchors.competitor_entities.find((entry)=>entry.entity===slot.slot_key)?.terms??[];
    const fallback=globalFallback||fallbackScopes.has(queryIdentity);
    return{slot,queryIdentity,queryText,structuredTerms:{include:anchors,
      exclude:contract.construction_plan.noise_terms,aliases:anchors},
      fallbackReason:fallback?(composed.query_components.fallback_reason??`fallback:${queryIdentity}`):null};
  });
}

function validatePlatformConfiguration(value:SignalAcquisitionQueryComposerPlatformConfigurationV1){
  for(const [key,entry] of Object.entries({provider:value.provider,model:value.model,
    pricing_version:value.pricing_version,input_rate:value.input_usd_per_million_tokens,
    output_rate:value.output_usd_per_million_tokens})){
    if(typeof entry!=="string"||!entry.trim())throw new Error(`Query Composer ${key} is unavailable.`);
  }
  for(const [key,entry] of Object.entries({max_input:value.max_input_tokens_per_call,
    max_output:value.max_output_tokens_per_call})){
    if(!Number.isSafeInteger(entry)||entry<1)throw new Error(`Query Composer ${key} is invalid.`);
  }
  return value;
}

function scopeOrder(scope:ComposerSlotRow["scope"]){
  return scope==="primary_brand"?0:scope==="category"?1:scope==="competitor"?2:3;
}
function sha256(value:string){return `sha256:${createHash("sha256").update(value,"utf8").digest("hex")}`;}
