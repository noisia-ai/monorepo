import { createHash } from "node:crypto";

import {
  QUERY_COMPOSER_BRIEF_CONTRACT_VERSION,
  validateQueryComposerAcquisitionBriefV1,
  type QueryComposerAcquisitionBriefV1
} from "@noisia/query-engine";

import {
  loadSignalAcquisitionKnowledgeContextV1,
  loadSignalAcquisitionKnowledgeSelectionV1
} from "@/lib/data-os/signal-acquisition-brief";
import {
  SignalAcquisitionPlanError,
  loadSignalAcquisitionLiveAuthorityV1,
  sealSignalAcquisitionBriefV1,
  withSignalAcquisitionTransactionV1
} from "@/lib/data-os/signal-acquisition-plan";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import type { ResolvedSignalWorkspace,SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

const PROVIDER_CONTRACT={
  key:"sentione",syntax_version:"sentione-query-v1",schema_version:"sentione-csv-47-v1"
} as const;

const LANGUAGE_CATALOG=[
  {key:"es-MX",label:"Español (México)"},{key:"en-US",label:"English (United States)"},
  {key:"en-GB",label:"English (United Kingdom)"},{key:"es-ES",label:"Español (España)"},
  {key:"pt-BR",label:"Português (Brasil)"},{key:"fr-FR",label:"Français (France)"},
  {key:"de-DE",label:"Deutsch (Deutschland)"},{key:"it-IT",label:"Italiano (Italia)"}
] as const;
const LANGUAGE_KEYS=new Set<string>(LANGUAGE_CATALOG.map((item)=>item.key));

type DraftRow={
  plan_version:number;draft_revision:number;draft_digest:string;
  brand_os_profile_version:number;brand_os_digest:string;identity_catalog_digest:string;
  acquisition_brief:QueryComposerAcquisitionBriefV1|null;acquisition_brief_digest:string|null;
};
type BrandRow={name:string;description:string|null;countries:string[]};

export type SignalAcquisitionBriefOperatorInputV1={
  revision_token:string;
  objective:string;
  purpose:string;
  market_country:string|null;
  countries:string[];
  languages:string[];
  default_capture_period:{start:string;end:string}|null;
  target_window_months:number|null;
  construction_mode:"exploratory"|"detection";
  include_knowledge_context:boolean;
};

export async function loadSignalAcquisitionBriefContextV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
}){
  assertAuthority(args.workspace,args.actor);
  const draft=await loadDraft(args.queryable,args.workspace.id);
  if(!draft)throw new SignalAcquisitionPlanError("acquisition_draft_required",409);
  const live=await loadSignalAcquisitionLiveAuthorityV1(args.queryable,args.workspace);
  const brand=await loadBrand(args.queryable,args.workspace);
  const knowledgeSelection=await loadSignalAcquisitionKnowledgeSelectionV1({
    queryable:args.queryable,workspace:args.workspace,include:true
  });
  const current=validateCurrentBrief(draft.acquisition_brief);
  const currentKnowledge=current?await loadSignalAcquisitionKnowledgeContextV1({
    queryable:args.queryable,workspace:args.workspace,references:current.knowledge_context_refs
  }):null;
  const stale=Boolean(current)&&(
    current!.brand_os_profile_version!==live.profile.version
    ||current!.brand_os_digest!==live.profile.digest
    ||current!.identity_catalog_digest!==live.catalogDigest
    ||current!.timezone!==args.workspace.timezone
    ||current!.provider_key!==PROVIDER_CONTRACT.key
    ||current!.provider_syntax_version!==PROVIDER_CONTRACT.syntax_version
    ||current!.provider_schema_version!==PROVIDER_CONTRACT.schema_version
    ||currentKnowledge?.missing===true
    ||currentKnowledge?.digest!==current!.knowledge_context_digest
  );
  const defaults=operatorDefaults(brand,current);
  return{
    contract_version:"signal-acquisition-brief-management-v1" as const,
    status:!current?"missing" as const:stale?"stale" as const:"sealed" as const,
    revision_token:encodeRevisionToken(args.workspace.id,draft),
    values:defaults,
    options:{
      countries:brand.countries.map((code)=>({code})),
      languages:LANGUAGE_CATALOG,
      construction_modes:["exploratory","detection"] as const
    },
    knowledge_context:{
      available:knowledgeSelection.available_count>0,
      source_count:knowledgeSelection.available_count,
      included:current?current.knowledge_context_refs.length>0:knowledgeSelection.available_count>0
    },
    timezone:args.workspace.timezone,
    blockers:stale?["acquisition_brief_drift"]:[]
  };
}

export async function sealSignalAcquisitionBriefFromOperatorV1(args:{
  queryable:SignalBrandPolicyQueryable;workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
  idempotencyKey:string;input:SignalAcquisitionBriefOperatorInputV1;
}){
  assertAuthority(args.workspace,args.actor);
  const expected=decodeRevisionToken(args.workspace.id,args.input.revision_token);
  const draft=await loadDraft(args.queryable,args.workspace.id);
  // The canonical writer owns CAS and checks the operation ledger before its
  // post-lock comparison. Do not reject here: an exact HTTP replay necessarily
  // carries the pre-mutation token and must reach the stored operation result.
  if(!draft)throw new SignalAcquisitionPlanError("acquisition_draft_required",409);
  const live=await loadSignalAcquisitionLiveAuthorityV1(args.queryable,args.workspace);
  const brand=await loadBrand(args.queryable,args.workspace);
  const knowledge=await loadSignalAcquisitionKnowledgeSelectionV1({queryable:args.queryable,
    workspace:args.workspace,include:args.input.include_knowledge_context});
  if(draft.brand_os_profile_version!==live.profile.version||draft.brand_os_digest!==live.profile.digest
      ||draft.identity_catalog_digest!==live.catalogDigest){
    throw new SignalAcquisitionPlanError("acquisition_plan_authority_drift",409);
  }
  const countries=unique(args.input.countries.map((value)=>value.toUpperCase()));
  const allowedCountries=new Set(brand.countries);
  if(!countries.length||countries.some((country)=>!allowedCountries.has(country))
      ||(args.input.market_country!==null&&!countries.includes(args.input.market_country.toUpperCase()))){
    throw new SignalAcquisitionPlanError("acquisition_brief_country_unavailable",422);
  }
  const languages=unique(args.input.languages);
  if(!languages.length||languages.some((language)=>!LANGUAGE_KEYS.has(language))){
    throw new SignalAcquisitionPlanError("acquisition_brief_language_unavailable",422);
  }
  const brief:QueryComposerAcquisitionBriefV1=validateQueryComposerAcquisitionBriefV1({
    contract_version:QUERY_COMPOSER_BRIEF_CONTRACT_VERSION,
    objective:args.input.objective,purpose:args.input.purpose,
    market:args.input.market_country?.toUpperCase()??null,countries,languages,
    timezone:args.workspace.timezone,default_capture_period:args.input.default_capture_period,
    target_window_months:args.input.target_window_months,construction_mode:args.input.construction_mode,
    brand_os_profile_version:live.profile.version,brand_os_digest:live.profile.digest,
    identity_catalog_digest:live.catalogDigest,knowledge_context_digest:knowledge.digest,
    knowledge_context_refs:knowledge.references,provider_key:PROVIDER_CONTRACT.key,
    provider_syntax_version:PROVIDER_CONTRACT.syntax_version,
    provider_schema_version:PROVIDER_CONTRACT.schema_version,optional_study_context:null
  });
  try{
    await sealSignalAcquisitionBriefV1({queryable:args.queryable,workspace:args.workspace,actor:args.actor,
      idempotencyKey:args.idempotencyKey,expectedDraftVersion:expected.version,
      expectedDraftRevision:expected.revision,expectedDraftDigest:expected.digest,brief});
  }catch(error){
    if(error instanceof Error&&error.message==="Idempotency-Key was reused with incompatible product input."){
      throw new SignalAcquisitionPlanError("idempotency_key_reused",409);
    }
    throw error;
  }
  return loadSignalAcquisitionBriefContextV1(args);
}

export async function loadSignalAcquisitionBriefContextProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;
}){
  const {pool}=await import("@/lib/db");
  return loadSignalAcquisitionBriefContextV1({queryable:pool,...args});
}

export async function sealSignalAcquisitionBriefFromOperatorProductV1(args:{
  workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser;idempotencyKey:string;
  input:SignalAcquisitionBriefOperatorInputV1;
}){
  return withSignalAcquisitionTransactionV1((queryable)=>sealSignalAcquisitionBriefFromOperatorV1({
    queryable,...args
  }));
}

async function loadDraft(queryable:SignalBrandPolicyQueryable,workspaceId:string){
  const result=await queryable.query<DraftRow>(`
    SELECT plan_version,draft_revision,draft_digest,brand_os_profile_version,brand_os_digest,
      identity_catalog_digest,acquisition_brief,acquisition_brief_digest
    FROM signal_acquisition_plans WHERE workspace_id=$1::uuid AND status='draft'
    ORDER BY plan_version DESC LIMIT 1
  `,[workspaceId]);
  return result.rows[0]??null;
}

async function loadBrand(queryable:SignalBrandPolicyQueryable,workspace:ResolvedSignalWorkspace){
  const result=await queryable.query<BrandRow>(`
    SELECT COALESCE(display_name,name) name,description,COALESCE(countries,ARRAY[]::char(2)[])::text[] countries
    FROM brands WHERE id=$1::uuid AND organization_id=$2::uuid AND status='active'
  `,[workspace.subject.type==="brand"?workspace.subject.id:null,workspace.organizationId]);
  const row=result.rows[0];
  if(!row)throw new SignalAcquisitionPlanError("brand_os_profile_required",409);
  return{...row,countries:unique(row.countries.map((country)=>country.toUpperCase()))};
}

function operatorDefaults(brand:BrandRow,current:QueryComposerAcquisitionBriefV1|null){
  if(current)return{
    objective:current.objective,purpose:current.purpose,market_country:current.market,
    countries:current.countries,languages:current.languages,
    default_capture_period:current.default_capture_period,target_window_months:current.target_window_months,
    construction_mode:current.construction_mode,include_knowledge_context:current.knowledge_context_refs.length>0
  };
  const languages=unique(brand.countries.map(defaultLanguage).filter((value):value is string=>Boolean(value)));
  return{
    objective:`Acquire governed listening data for ${brand.name}`,
    purpose:"Prepare governed acquisition queries",
    market_country:brand.countries[0]??null,countries:brand.countries,languages,
    default_capture_period:null,target_window_months:12,construction_mode:"exploratory" as const,
    include_knowledge_context:true
  };
}

function defaultLanguage(country:string){
  return({MX:"es-MX",ES:"es-ES",US:"en-US",GB:"en-GB",BR:"pt-BR",
    FR:"fr-FR",DE:"de-DE",IT:"it-IT"} as Record<string,string>)[country]??null;
}
function validateCurrentBrief(value:unknown){
  try{return validateQueryComposerAcquisitionBriefV1(value);}catch{return null;}
}
function encodeRevisionToken(workspaceId:string,draft:DraftRow){
  return Buffer.from(JSON.stringify({contract:"signal-acquisition-brief-revision-v1",
    workspace:sha256(workspaceId),version:draft.plan_version,revision:draft.draft_revision,
    digest:draft.draft_digest}),"utf8").toString("base64url");
}
function decodeRevisionToken(workspaceId:string,value:string){
  try{
    const parsed=JSON.parse(Buffer.from(value,"base64url").toString("utf8")) as Record<string,unknown>;
    if(parsed.contract!=="signal-acquisition-brief-revision-v1"||parsed.workspace!==sha256(workspaceId)
        ||!Number.isSafeInteger(parsed.version)||!Number.isSafeInteger(parsed.revision)
        ||typeof parsed.digest!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(parsed.digest))throw new Error();
    return{version:parsed.version as number,revision:parsed.revision as number,digest:parsed.digest};
  }catch{throw new SignalAcquisitionPlanError("acquisition_brief_revision_token_invalid",422);}
}
function assertAuthority(workspace:ResolvedSignalWorkspace,actor:SignalWorkspaceUser){
  if(actor.userType!=="noisia_internal"||workspace.status!=="active"||workspace.subject.type!=="brand"){
    throw new SignalAcquisitionPlanError("acquisition_management_forbidden",403);
  }
}
function unique(values:string[]){return[...new Set(values.map((value)=>value.trim()).filter(Boolean))];}
function sha256(value:string){return`sha256:${createHash("sha256").update(value,"utf8").digest("hex")}`;}
