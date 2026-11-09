import {loadSignalSemanticResolutionGovernedContextV1} from "./signal-semantic-resolution";
import type {Pool, PoolClient} from "pg";
import {signalWorkspaceEmbeddingDigestV1 as digest} from "@noisia/query-engine";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {loadSignalWorkspaceMassLabelingSeedsV1} from "./signal-workspace-mass-labeling-profile";
import {SignalLabelingError} from "./signal-labeling-runs";
import {mapCurrent} from "./signal-mass-labeling";

export type MassLabelingStudyInterestV1={key:string;name:string;definition:string;active:boolean};
export type MassLabelingStudyPolicyV1={contract_version:"mass-labeling-study-policy-v1";
  workspace_id:string;revision:number;category:string;lexicon_terms:string[];
  candidate_language:"en"|"original";interest_threshold:number;interests:MassLabelingStudyInterestV1[];
  lexicon_provenance:"brand_os"|"editorial"|"analyst";source_digest:string|null;
  display_names:Record<string,{en:string;es:string}>};
type Database=Pick<Pool,"connect">;
type Access={database:Database;workspace_id:string;actor_user_id:string};
type Writable=Pick<MassLabelingStudyPolicyV1,"category"|"lexicon_terms"|"candidate_language"|"interest_threshold"|"interests"> & {
  display_names?:MassLabelingStudyPolicyV1["display_names"]};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const key=/^[a-z][a-z0-9_]{0,63}$/u;
const sha=/^sha256:[a-f0-9]{64}$/u;
function fail(code:string,status=409):never{throw new SignalLabelingError(code,status);}
function text(value:unknown,max:number){return typeof value==="string"&&value.trim().length>0&&value.length<=max;}
function validate(value:Writable){
  if(!text(value.category,160)||!Array.isArray(value.lexicon_terms)||value.lexicon_terms.length>256
    ||value.lexicon_terms.some(term=>!text(term,200))
    ||!["en","original"].includes(value.candidate_language)
    ||!Number.isFinite(value.interest_threshold)||value.interest_threshold<0||value.interest_threshold>1
    ||!Array.isArray(value.interests)||value.interests.length>32
    ||value.interests.some(i=>!i||!key.test(i.key)||!text(i.name,160)||!text(i.definition,1200)||typeof i.active!=="boolean")
    ||new Set(value.interests.map(i=>i.key)).size!==value.interests.length)
    fail("study_policy_invalid",422);
  const names=value.display_names??{};
  if(typeof names!=="object"||Array.isArray(names)||names===null||Object.keys(names).length>200
    ||Object.entries(names).some(([k,n])=>!key.test(k)||!n||!text(n.en,160)||!text(n.es,160)))
    fail("study_policy_invalid",422);
}
async function transaction<T>(database:Database,work:(client:PoolClient)=>Promise<T>){
  const client=await database.connect();
  try{await client.query("BEGIN");await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const result=await work(client);await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
async function authorize(client:Pick<PoolClient,"query">,workspace:string,actor:string,edit:boolean,processing=false){
  if(!uuid.test(workspace)||!uuid.test(actor))fail("study_policy_scope_invalid",422);
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:workspace,
    actor_user_id:actor,lock_authority:edit});
  if((edit?!caps.can_edit_topics:!caps.can_view)||processing&&!caps.can_request_processing)fail("study_policy_forbidden",403);
  return caps;
}
/** The caller supplies authorization. Workers use this inside their admission transaction. */
export async function loadMassLabelingStudyPolicyWithClientV1(client:Pick<PoolClient,"query">,workspace_id:string):Promise<MassLabelingStudyPolicyV1>{
  const stored=(await client.query<MassLabelingStudyPolicyV1>(`SELECT workspace_id,revision,category,lexicon_terms,
    candidate_language,interest_threshold,interests,lexicon_provenance,source_digest,display_names
    FROM signal_mass_labeling_study_policies WHERE workspace_id=$1 ORDER BY revision DESC LIMIT 1`,[workspace_id])).rows[0];
  if(stored)return {...stored,contract_version:"mass-labeling-study-policy-v1"};
  const {seeds,context_digest}=await loadSignalWorkspaceMassLabelingSeedsV1({queryable:client,workspace_id});
  const governed=await loadSignalSemanticResolutionGovernedContextV1(client,workspace_id);
  const categories=[...new Set(governed.identities.filter(i=>i.scope==="category").map(i=>i.entity_label.trim()).filter(Boolean))];
  return {contract_version:"mass-labeling-study-policy-v1",workspace_id,revision:0,
    category:categories.length===1?categories[0]!:"",
    lexicon_terms:[...new Set(seeds.flatMap(s=>s.names))],candidate_language:"en",interest_threshold:.85,
    interests:[],lexicon_provenance:"brand_os",source_digest:context_digest,display_names:{}};
}
export async function getMassLabelingStudyPolicyV1(args:Access){
  return transaction(args.database,async client=>{
    const caps=await authorize(client,args.workspace_id,args.actor_user_id,false);
    const policy=await loadMassLabelingStudyPolicyWithClientV1(client,args.workspace_id);
    const rows=(await client.query<{topic_key:string;name:string;en:string;es:string}>(`SELECT topic->>'topic_key' topic_key,
      COALESCE(topic#>>'{localization,original,name}',topic->>'name') name,
      COALESCE(local.localization#>>'{en,name}',topic#>>'{localization,en,name}',topic->>'name') en,
      COALESCE(local.localization#>>'{es,name}',topic#>>'{localization,es,name}',topic->>'name') es
      FROM signal_mass_labeling_selections selected JOIN signal_mass_labeling_maps map
        ON map.workspace_id=selected.workspace_id AND map.id=selected.map_id
      CROSS JOIN LATERAL jsonb_array_elements(map.catalog) topic
      LEFT JOIN signal_mass_labeling_localizations local ON local.workspace_id=map.workspace_id
        AND local.map_id=map.id AND local.topic_key=topic->>'topic_key'
      WHERE selected.workspace_id=$1 ORDER BY topic->>'topic_key'`,[args.workspace_id])).rows;
    return {...policy,can_edit:caps.can_edit_topics,topics:rows};
  });
}
export async function updateMassLabelingStudyPolicyV1(args:Access&Writable&{expected_revision:number}){
  validate(args);
  return transaction(args.database,async client=>{
    await authorize(client,args.workspace_id,args.actor_user_id,true);
    return savePolicy(client,args,"analyst",null);
  });
}
/** An editorial result is proposed once per Brand OS digest. A later analyst edit wins. */
export async function proposeMassLabelingStudyLexiconV1(args:Access&{expected_revision:number;category:string;lexicon_terms:string[];source_digest:string}){
  if(!sha.test(args.source_digest))fail("study_policy_source_invalid",422);
  return transaction(args.database,async client=>{
    await authorize(client,args.workspace_id,args.actor_user_id,true);
    const current=await loadMassLabelingStudyPolicyWithClientV1(client,args.workspace_id);
    if(current.lexicon_provenance==="analyst"||current.lexicon_provenance==="editorial")return current;
    const proposed={...current,...args,category:current.category||args.category};validate(proposed);
    return savePolicy(client,proposed,"editorial",args.source_digest);
  });
}
async function savePolicy(client:PoolClient,args:Access&Writable&{expected_revision:number},provenance:"editorial"|"analyst",source:string|null){
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mass-study-policy:'||$1,0))",[args.workspace_id]);
  const current=await loadMassLabelingStudyPolicyWithClientV1(client,args.workspace_id);
  if(!Number.isSafeInteger(args.expected_revision)||current.revision!==args.expected_revision)fail("study_policy_conflict");
  const display=args.display_names??current.display_names;
  const keys=[...args.interests.map(i=>i.key),...Object.keys(display)];
  const topics=(await client.query<{topic_key:string}>(`SELECT DISTINCT topic.topic_key FROM signal_mass_labeling_topics topic
    WHERE workspace_id=$1 AND topic_key=ANY($2::text[])`,[args.workspace_id,keys])).rows.map(t=>t.topic_key);
  if(args.interests.some(i=>topics.includes(i.key))||Object.keys(display).some(k=>!topics.includes(k)))fail("study_policy_topic_conflict",422);
  const terms=[...new Set(args.lexicon_terms.map(t=>t.trim()))];
  const unchangedTerms=digest([...terms].sort())===digest([...current.lexicon_terms].sort());
  const resolvedProvenance=provenance==="analyst"&&unchangedTerms?current.lexicon_provenance:provenance;
  const resolvedSource=provenance==="analyst"&&unchangedTerms?current.source_digest:source;
  const policy:MassLabelingStudyPolicyV1={contract_version:"mass-labeling-study-policy-v1",workspace_id:args.workspace_id,
    revision:current.revision+1,category:args.category.trim(),lexicon_terms:terms,
    candidate_language:args.candidate_language,interest_threshold:args.interest_threshold,
    interests:args.interests.map(i=>({key:i.key,name:i.name.trim(),definition:i.definition.trim(),active:i.active})),
    lexicon_provenance:resolvedProvenance,source_digest:resolvedSource,display_names:display};
  await client.query(`INSERT INTO signal_mass_labeling_study_policies(workspace_id,revision,category,lexicon_terms,
    candidate_language,interest_threshold,interests,lexicon_provenance,source_digest,display_names,created_by_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11)`,[policy.workspace_id,policy.revision,policy.category,
    policy.lexicon_terms,policy.candidate_language,policy.interest_threshold,JSON.stringify(policy.interests),
    policy.lexicon_provenance,policy.source_digest,JSON.stringify(display),args.actor_user_id]);
  return policy;
}
export const massLabelingStudyInterestDigestV1=(interest:{name:string;definition:string})=>digest({name:interest.name,definition:interest.definition});
export type MassLabelingInterestReceiptV2={root_id:string;input_digest:string;probability:number;
  request_digest:string;response_digest:string;usage:{input_tokens:number;output_tokens:number}};
export async function importMassLabelingInterestsV2(args:Access&{map_id:string;interests:Array<{
  interest_key:string;name:string;definition:string;results:MassLabelingInterestReceiptV2[]}>}){
  if(!uuid.test(args.map_id)||args.interests.length>32||args.interests.some(i=>i.results.length>2000||new Set(i.results.map(r=>r.root_id)).size!==i.results.length))fail("study_interest_batch_invalid",422);
  return transaction(args.database,async client=>{
    await authorize(client,args.workspace_id,args.actor_user_id,true,true);
    await mapCurrent(client,args.workspace_id,args.map_id);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mass-study-interests:'||$1,0))",[args.map_id]);
    const policy=await loadMassLabelingStudyPolicyWithClientV1(client,args.workspace_id);
    let count=0;
    for(const interest of args.interests){
      const configured=policy.interests.find(i=>i.key===interest.interest_key);
      if(!configured||configured.name!==interest.name||configured.definition!==interest.definition)fail("study_interest_definition_changed");
      const definition_digest=massLabelingStudyInterestDigestV1(interest);
      for(const receipt of interest.results){
        if(!uuid.test(receipt.root_id)||![receipt.input_digest,receipt.request_digest,receipt.response_digest].every(s=>sha.test(s))
          ||!Number.isFinite(receipt.probability)||receipt.probability<0||receipt.probability>1||!receipt.usage
          ||![receipt.usage.input_tokens,receipt.usage.output_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)
          ||["workspace_id","map_id","interest_key","definition_digest","created_by_user_id"].some(k=>Object.hasOwn(receipt,k)))
          fail("study_interest_receipt_invalid",422);
      }
      const rows=interest.results.map(r=>({root_id:r.root_id,input_digest:r.input_digest,probability:r.probability,
        request_digest:r.request_digest,response_digest:r.response_digest,usage:{input_tokens:r.usage.input_tokens,output_tokens:r.usage.output_tokens}}));
      const cte=`WITH incoming AS(SELECT * FROM jsonb_to_recordset($5::jsonb)
        r(root_id uuid,input_digest text,probability double precision,request_digest text,response_digest text,usage jsonb))`;
      const values=[args.workspace_id,args.map_id,interest.interest_key,definition_digest,JSON.stringify(rows),args.actor_user_id];
      const invalid=await client.query(`WITH incoming AS(SELECT * FROM jsonb_to_recordset($3::jsonb) r(root_id uuid,input_digest text))
        SELECT 1 FROM incoming r LEFT JOIN signal_mass_labeling_items i
        ON i.workspace_id=$1 AND i.map_id=$2 AND i.root_id=r.root_id WHERE i.input_digest IS DISTINCT FROM r.input_digest LIMIT 1`,[args.workspace_id,args.map_id,JSON.stringify(rows)]);
      if(invalid.rowCount)fail("study_interest_input_changed");
      const conflict=await client.query(`${cte} SELECT 1 FROM incoming r JOIN signal_mass_labeling_study_interest_results s
        ON s.workspace_id=$1 AND s.map_id=$2 AND s.interest_key=$3 AND s.definition_digest=$4 AND s.root_id=r.root_id
        WHERE ROW(s.input_digest,s.probability,s.request_digest,s.response_digest,s.usage)
          IS DISTINCT FROM ROW(r.input_digest,r.probability,r.request_digest,r.response_digest,r.usage) LIMIT 1`,values.slice(0,5));
      if(conflict.rowCount)fail("study_interest_receipt_conflict");
      await client.query(`${cte} INSERT INTO signal_mass_labeling_study_interest_results(workspace_id,map_id,interest_key,
        definition_digest,root_id,input_digest,probability,request_digest,response_digest,usage,created_by_user_id)
        SELECT $1,$2,$3,$4,root_id,input_digest,probability,request_digest,response_digest,usage,$6 FROM incoming
        ON CONFLICT DO NOTHING`,values);
      count+=rows.length;
    }
    return {interest_results:count};
  });
}
