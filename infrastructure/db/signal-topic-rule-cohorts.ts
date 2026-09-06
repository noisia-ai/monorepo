import {randomUUID} from "node:crypto";
import {compileSignalTopicRuleCohortV1,aggregateSignalTopicRuleCohortMasksV1,
  signalTopicEvaluationDigestV2 as digest,sanitizeSignalTopicEvidenceExcerptV2,
  type SignalTopicRuleSpecV1,type SignalTopicRuleCohortAggregateV1,type SignalTopicRuleCohortMaskBucketV1} from "@noisia/query-engine";
import {signalTopicRuleDraftInternal as shared,SignalTopicContractDraftError,
  type SignalTopicContractDraftClient} from "./signal-topic-contract-drafts";
import type {SignalTopicEvaluationActorV2} from "./signal-topic-evaluation-v2";
import {insertSignalTaxonomyDraftCoreV1} from "./signal-taxonomy-profile";

type Context={workspace_id:string;actor:SignalTopicEvaluationActorV2;run_key:string};
export type SignalTopicRuleCohortSelectionV1={candidate_key:string;draft_id:string;
  expected_candidate_revision:number;expected_candidate_state_token:string;expected_draft_revision:number;expected_draft_digest:string};
type Binding={candidate_id:string;candidate_key:string;candidate_revision:number;candidate_version_digest:string;
  candidate_state_token:string;draft_id:string;draft_revision:number;draft_digest:string;spec_digest:string;rule_spec:SignalTopicRuleSpecV1};
type Snapshot={run_id:string;snapshot_id:string;snapshot_digest:string;population_digest:string;rights_digest:string;
  semantic_context_authority_digest:string;artifact_binding_digest:string};
type Envelope=Snapshot&{workspace_id:string;run_key:string;cohort_revision:number;predecessor_digest:string|null;rules:Binding[]};
type Row={id:string;workspace_id:string;run_id:string;snapshot_id:string;cohort_revision:number;cohort_digest:string;
  binding:Envelope;profile_id:string;profile_version:number;profile_binding_digest:string;actor_user_id:string;
  request_digest:string;created_at:string};
type CAS={expected_cohort_revision:number;expected_cohort_digest:string|null};
export type SignalTopicRuleCohortStoreV1={contract_version:"signal-topic-rule-cohort-store-v1";cohort_id:string;
  cohort_revision:number;cohort_digest:string;profile_id:string;profile_version:number;binding:Envelope;
  created_at:string;is_stale:boolean;stale_reasons:string[];is_latest:boolean;idempotent_replay:boolean};
type Example={evidence_ref:string;outcome:"abstained"|"single_match"|"multiple_match";matched_candidate_keys:string[];
  excerpt:string;language:string|null;market:string|null;scope:string|null;month:string};
export type SignalTopicRuleCohortTrialResultV1=SignalTopicRuleCohortAggregateV1&{
  contract_version:"signal-topic-rule-cohort-trial-v1";cohort_id:string;cohort_revision:number;cohort_digest:string;
  profile_id:string;profile_version:number;compiler_version:string;plan_hash:string;
  rule_plans:Array<{candidate_key:string;spec_digest:string;plan_hash:string;compiler_version:string}>;
  snapshot_digest:string;population_digest:string;considered_digest:string;population_kind:"frozen_snapshot_memberships";
  max_memberships:number;example_limit:number;timeout_ms:number;examples:Example[];topic_adoption:false;publication:false;serving:false};
export type SignalTopicRuleCohortTrialV1=SignalTopicRuleCohortTrialResultV1&{trial_id:string;created_at:string;
  is_stale:boolean;stale_reasons:string[];is_latest_cohort:boolean;idempotent_replay:boolean;
  example_availability:{stored:number;available:number;unavailable:number}};
export type SignalTopicRuleCohortSourceV1={candidate_key:string;title:string;description:string;inclusion:string[];exclusion:string[];
  revision:number;state_token:string;review_state:"pending"|"rejected";
  draft:null|{draft_id:string;revision:number;draft_digest:string;spec_digest:string;is_stale:boolean};
  eligibility:"eligible"|"missing_draft"|"stale_draft"|"rejected"};
export type SignalTopicRuleCohortSourcesV1={contract_version:"signal-topic-rule-cohort-sources-v1";run_key:string;
  snapshot_digest:string;total:number;limit:number;items:SignalTopicRuleCohortSourceV1[];next_cursor:string|null;
  selected:SignalTopicRuleCohortSourceV1[];missing_selected_candidate_keys:string[]};
function fail(code:string,status=409):never{throw new SignalTopicContractDraftError(`topic_rule_cohort_${code}`,status);}
const sha=(value:unknown)=>typeof value==="string"&&/^sha256:[0-9a-f]{64}$/u.test(value);
const uuid=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
function requestCAS(args:CAS&{idempotency_key:string}){
  if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)||!Number.isSafeInteger(args.expected_cohort_revision)
    ||args.expected_cohort_revision<0||(args.expected_cohort_revision===0?args.expected_cohort_digest!==null:!sha(args.expected_cohort_digest)))fail("request_invalid",422);
}
function selections(value:SignalTopicRuleCohortSelectionV1[]){
  if(!Array.isArray(value)||value.length<2||value.length>15)fail("selection_invalid",422);
  for(const item of value){if(!item||Object.keys(item).sort().join(",")!==["candidate_key","draft_id","expected_candidate_revision",
    "expected_candidate_state_token","expected_draft_revision","expected_draft_digest"].sort().join(",")
    ||!/^[a-z0-9][a-z0-9._:-]{0,179}$/u.test(item.candidate_key)||!uuid(item.draft_id)
    ||!Number.isSafeInteger(item.expected_candidate_revision)||item.expected_candidate_revision<1
    ||!Number.isSafeInteger(item.expected_draft_revision)||item.expected_draft_revision<1
    ||!sha(item.expected_candidate_state_token)||!sha(item.expected_draft_digest))fail("selection_invalid",422);}
  if(new Set(value.map(row=>row.candidate_key)).size!==value.length||new Set(value.map(row=>row.draft_id)).size!==value.length)fail("selection_duplicate",422);
  return[...value].sort((a,b)=>a.candidate_key<b.candidate_key?-1:1);
}
async function snapshot(client:SignalTopicContractDraftClient,args:Context):Promise<Snapshot>{
  const row=(await client.query<Snapshot>(`SELECT run.id::text run_id,s.id::text snapshot_id,s.snapshot_digest,
    s.membership_binding_digest population_digest,s.rights_digest,s.semantic_context_authority_digest,s.artifact_binding_digest
    FROM signal_topic_evaluation_v2_runs run JOIN signal_topic_evaluation_v2_snapshots s ON s.id=run.snapshot_id AND s.workspace_id=run.workspace_id
    WHERE run.workspace_id=$1::uuid AND run.run_key=$2 AND run.status='completed' AND s.state='frozen'`,[args.workspace_id,args.run_key])).rows[0];
  return row??fail("run_not_found",404);
}
type SourcesCursor={version:1;workspace_id:string;run_key:string;snapshot_digest:string;after_key:string};
function sourceCursor(value:string|null):SourcesCursor|null{
  if(value===null)return null;
  try{
    if(typeof value!=="string"||value.length>2048||!/^[A-Za-z0-9_-]+$/u.test(value))throw new Error();
    const decoded=Buffer.from(value,"base64url");if(decoded.toString("base64url")!==value)throw new Error();
    const payload=JSON.parse(decoded.toString("utf8")) as SourcesCursor;
    if(!payload||Object.keys(payload).sort().join(",")!=="after_key,run_key,snapshot_digest,version,workspace_id"
      ||payload.version!==1||!uuid(payload.workspace_id)||!sha(payload.snapshot_digest)
      ||typeof payload.run_key!=="string"||!/^[a-z0-9][a-z0-9._:-]{7,199}$/u.test(payload.run_key)
      ||typeof payload.after_key!=="string"||!/^[a-z0-9][a-z0-9._:-]{0,179}$/u.test(payload.after_key))throw new Error();
    return payload;
  }catch{fail("sources_cursor_invalid",422);}
}
const sourceSummarySql=`SELECT candidate.candidate_key,
  COALESCE(editorial.title,base.payload->>'title') title,COALESCE(editorial.description,base.payload->>'description') description,
  COALESCE(editorial.inclusion,base.payload->'inclusion') inclusion,COALESCE(editorial.exclusion,base.payload->'exclusion') exclusion,
  COALESCE(editorial.revision,1)::int revision,COALESCE(editorial.review_state,'pending') review_state,
  signal_topic_evaluation_v2_candidate_state_token_v1(candidate.id,COALESCE(editorial.revision,1),
    COALESCE(editorial.version_digest,base.payload_digest)) state_token,
  CASE WHEN draft.id IS NULL THEN NULL ELSE jsonb_build_object('draft_id',draft.id::text,'revision',draft.revision,
    'draft_digest',draft.draft_digest,'spec_digest',draft.spec_digest,'is_stale',
    draft.source_revision<>COALESCE(editorial.revision,1)
      OR draft.source_version_digest<>COALESCE(editorial.version_digest,base.payload_digest)
      OR COALESCE(editorial.review_state,'pending')<>'pending') END draft
  FROM signal_topic_evaluation_v2_candidates candidate
  JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
  LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions
    WHERE candidate_id=candidate.id AND workspace_id=$1::uuid AND run_id=$2::uuid ORDER BY revision DESC LIMIT 1) editorial ON true
  LEFT JOIN LATERAL(SELECT id,revision,draft_digest,spec_digest,source_revision,source_version_digest
    FROM signal_topic_contract_draft_versions WHERE candidate_id=candidate.id AND workspace_id=$1::uuid
      AND run_id=$2::uuid AND snapshot_id=$3::uuid ORDER BY revision DESC LIMIT 1) draft ON true
  WHERE candidate.workspace_id=$1::uuid AND candidate.run_id=$2::uuid
    AND candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
    AND ($4::text[] IS NULL OR candidate.candidate_key=ANY($4::text[]))
    AND ($5::text IS NULL OR candidate.candidate_key COLLATE "C">$5::text COLLATE "C")
  ORDER BY candidate.candidate_key COLLATE "C" LIMIT $6`;

/** Exact-run management projection. Compose all management readers in the caller's RRRO
 * transaction. Keyset order is independent of mutable titles/draft eligibility. Selected rows
 * report current state separately; they never rewrite an operator's retained selection CAS. */
export async function loadSignalTopicRuleCohortSourcesV1(args:Context&{queryable:SignalTopicContractDraftClient;
  limit?:number;cursor?:string|null;selected_candidate_keys?:string[]}):Promise<SignalTopicRuleCohortSourcesV1>{
  const limit=args.limit??20,selectedKeys=args.selected_candidate_keys??[];
  if(!Number.isSafeInteger(limit)||limit<1||limit>20||typeof args.run_key!=="string"
    ||!/^[a-z0-9][a-z0-9._:-]{7,199}$/u.test(args.run_key)||!Array.isArray(selectedKeys)||selectedKeys.length>15
    ||selectedKeys.some(key=>typeof key!=="string"||!/^[a-z0-9][a-z0-9._:-]{0,179}$/u.test(key))
    ||new Set(selectedKeys).size!==selectedKeys.length)fail("sources_query_invalid",422);
  const cursor=sourceCursor(args.cursor??null);await shared.authorize(args.queryable,args);const snap=await snapshot(args.queryable,args);
  if(cursor&&(cursor.workspace_id!==args.workspace_id||cursor.run_key!==args.run_key||cursor.snapshot_digest!==snap.snapshot_digest))fail("sources_cursor_invalid",422);
  const total=(await args.queryable.query<{total:number}>(`SELECT count(*)::int total FROM signal_topic_evaluation_v2_candidates candidate
    WHERE candidate.workspace_id=$1::uuid AND candidate.run_id=$2::uuid
      AND candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving`,[args.workspace_id,snap.run_id])).rows[0]!.total;
  type SourceRow=Omit<SignalTopicRuleCohortSourceV1,"eligibility">;
  const projectSource=(row:SourceRow):SignalTopicRuleCohortSourceV1=>({...row,eligibility:row.review_state==="rejected"?"rejected":
    !row.draft?"missing_draft":row.draft.is_stale?"stale_draft":"eligible"});
  const rows=(await args.queryable.query<SourceRow>(sourceSummarySql,[args.workspace_id,snap.run_id,snap.snapshot_id,null,cursor?.after_key??null,limit+1])).rows;
  const items=rows.slice(0,limit).map(projectSource);
  const selectedRows=selectedKeys.length?(await args.queryable.query<SourceRow>(sourceSummarySql,
    [args.workspace_id,snap.run_id,snap.snapshot_id,selectedKeys,null,15])).rows:[];
  const selectedByKey=new Map(selectedRows.map(row=>[row.candidate_key,projectSource(row)]));
  return{contract_version:"signal-topic-rule-cohort-sources-v1",run_key:args.run_key,snapshot_digest:snap.snapshot_digest,total,limit,items,
    next_cursor:rows.length>limit?Buffer.from(JSON.stringify({version:1,workspace_id:args.workspace_id,run_key:args.run_key,
      snapshot_digest:snap.snapshot_digest,after_key:items.at(-1)!.candidate_key} satisfies SourcesCursor),"utf8").toString("base64url"):null,
    selected:selectedKeys.flatMap(key=>selectedByKey.has(key)?[selectedByKey.get(key)!]:[]),
    missing_selected_candidate_keys:selectedKeys.filter(key=>!selectedByKey.has(key))};
}
async function familyLock(client:SignalTopicContractDraftClient,args:Context){
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`signal-topic-cohort:${args.workspace_id}:${args.run_key}`]);
}
async function latest(client:SignalTopicContractDraftClient,args:Context){return(await client.query<Row>(`SELECT cohort.*,cohort.created_at::text
  FROM signal_topic_rule_cohort_versions cohort JOIN signal_topic_evaluation_v2_runs run ON run.id=cohort.run_id AND run.workspace_id=cohort.workspace_id
  WHERE cohort.workspace_id=$1::uuid AND run.run_key=$2 ORDER BY cohort.cohort_revision DESC LIMIT 1`,[args.workspace_id,args.run_key])).rows[0];}
async function resolveBinding(client:SignalTopicContractDraftClient,args:Context,selected:SignalTopicRuleCohortSelectionV1[],snap:Snapshot,lock:boolean){
  const rules:Binding[]=[];
  for(const item of selected){const source=await shared.sourceFor(client,{...args,candidate_key:item.candidate_key},lock);
    if(source.run_id!==snap.run_id||source.snapshot_id!==snap.snapshot_id||source.review_state!=="pending"
      ||source.revision!==item.expected_candidate_revision||source.state_token!==item.expected_candidate_state_token)fail("source_stale");
    const draft=(await client.query<{id:string;revision:number;draft_digest:string;spec_digest:string;rule_spec:SignalTopicRuleSpecV1;
      source_revision:number;source_version_digest:string}>(`SELECT id::text,revision,draft_digest,spec_digest,rule_spec,source_revision,source_version_digest
      FROM signal_topic_contract_draft_versions WHERE candidate_id=$1::uuid AND workspace_id=$2::uuid AND run_id=$3::uuid AND snapshot_id=$4::uuid
      ORDER BY revision DESC LIMIT 1`,[source.candidate_id,args.workspace_id,snap.run_id,snap.snapshot_id])).rows[0];
    if(!draft||draft.id!==item.draft_id||draft.revision!==item.expected_draft_revision||draft.draft_digest!==item.expected_draft_digest
      ||draft.source_revision!==source.revision||draft.source_version_digest!==source.version_digest)fail("draft_stale");
    if(digest(draft.rule_spec)!==draft.spec_digest)fail("draft_digest_invalid");
    rules.push({candidate_id:source.candidate_id,candidate_key:item.candidate_key,candidate_revision:source.revision,
      candidate_version_digest:source.version_digest,candidate_state_token:source.state_token,draft_id:draft.id,
      draft_revision:draft.revision,draft_digest:draft.draft_digest,spec_digest:draft.spec_digest,rule_spec:draft.rule_spec});
  }return rules;
}
async function status(client:SignalTopicContractDraftClient,args:Context,row:Row,lock=false){
  const reasons:string[]=[];const snap=await snapshot(client,args);
  if(Object.keys(snap).some(key=>snap[key as keyof Snapshot]!==row.binding[key as keyof Snapshot]))reasons.push("snapshot_changed");
  try{await resolveBinding(client,args,row.binding.rules.map(rule=>({candidate_key:rule.candidate_key,draft_id:rule.draft_id,
    expected_candidate_revision:rule.candidate_revision,expected_candidate_state_token:rule.candidate_state_token,
    expected_draft_revision:rule.draft_revision,expected_draft_digest:rule.draft_digest})),snap,lock);}
  catch(error){if(error instanceof SignalTopicContractDraftError&&["topic_rule_cohort_source_stale","topic_rule_cohort_draft_stale",
    "topic_rule_candidate_not_found"].includes(error.code))reasons.push("source_changed");else throw error;}
  const profile=(await client.query<{digest:string;draft:boolean}>(`SELECT signal_topic_rule_cohort_profile_digest_v1(profile.id) digest,
    (profile.status='draft' AND taxonomy.status='draft' AND rules.status='draft') draft FROM signal_taxonomy_profiles profile
    JOIN taxonomies taxonomy ON taxonomy.id=profile.taxonomy_id JOIN tagging_rule_sets rules ON rules.id=profile.rule_set_id
    WHERE profile.id=$1::uuid AND profile.workspace_id=$2::uuid`,[row.profile_id,args.workspace_id])).rows[0];
  if(!profile?.draft||profile.digest!==row.profile_binding_digest)reasons.push("profile_changed");
  return{is_stale:reasons.length>0,stale_reasons:reasons};
}
function project(row:Row,state:{is_stale:boolean;stale_reasons:string[]},is_latest:boolean,replayed:boolean):SignalTopicRuleCohortStoreV1{
  return{contract_version:"signal-topic-rule-cohort-store-v1",cohort_id:row.id,cohort_revision:row.cohort_revision,
    cohort_digest:row.cohort_digest,profile_id:row.profile_id,profile_version:row.profile_version,binding:row.binding,
    created_at:new Date(row.created_at).toISOString(),...state,is_latest,idempotent_replay:replayed};
}
export async function createSignalTopicRuleCohortV1(args:Context&CAS&{client:SignalTopicContractDraftClient;
  sources:SignalTopicRuleCohortSelectionV1[];idempotency_key:string}):Promise<SignalTopicRuleCohortStoreV1>{
  requestCAS(args);const selected=selections(args.sources),request={run_key:args.run_key,sources:selected,
    expected_cohort_revision:args.expected_cohort_revision,expected_cohort_digest:args.expected_cohort_digest};
  return shared.transaction(args.client,async()=>{
    await shared.authorize(args.client,args);await familyLock(args.client,args);
    const old=(await args.client.query<Row>(`SELECT *,created_at::text FROM signal_topic_rule_cohort_versions
      WHERE workspace_id=$1::uuid AND idempotency_key=$2`,[args.workspace_id,args.idempotency_key])).rows[0];
    if(old){if(old.actor_user_id!==args.actor.id||old.request_digest!==digest(request))fail("idempotency_conflict");
      return project(old,await status(args.client,args,old),(await latest(args.client,args))?.id===old.id,true);}
    const snap=await snapshot(args.client,args),rules=await resolveBinding(args.client,args,selected,snap,true);
    compileSignalTopicRuleCohortV1(rules.map(({candidate_key,rule_spec})=>({candidate_key,rule_spec})));
    const prior=await latest(args.client,args);
    if(args.expected_cohort_revision!==(prior?.cohort_revision??0)||args.expected_cohort_digest!==(prior?.cohort_digest??null))fail("stale");
    const binding:Envelope={...snap,workspace_id:args.workspace_id,run_key:args.run_key,
      cohort_revision:(prior?.cohort_revision??0)+1,predecessor_digest:prior?.cohort_digest??null,rules};
    const cohort_digest=digest(binding),metadata={contract_version:"signal-topic-rule-cohort-store-v1",cohort_digest,binding,
      origin:"operator_deterministic",provider_calls:0};
    const inserted=await insertSignalTaxonomyDraftCoreV1({client:args.client,workspace_id:args.workspace_id,kind:"topic",
      context_hash:cohort_digest,terms:rules.map(rule=>({term_key:rule.candidate_key,label:rule.rule_spec.label,
        definition:rule.rule_spec.definition,metadata:{source:rule,origin:"operator_deterministic"}})),
      rules:{contract_version:"signal-topic-rule-cohort-v1",rules:rules.map(({candidate_key,rule_spec})=>({candidate_key,rule_spec})),binding},
      rule_set_metadata:metadata,provider:"operator",model_version:"deterministic-simple-fts-v1",prompt_hash:cohort_digest,
      model_metadata:{...metadata,execution_kind:"deterministic",input_tokens:0,output_tokens:0,cost_micro_usd:0},
      profile_metadata:metadata,context_refs:[]});
    const profileDigest=(await args.client.query<{digest:string}>("SELECT signal_topic_rule_cohort_profile_digest_v1($1::uuid) digest",[inserted.profileId])).rows[0]!.digest;
    const row=(await args.client.query<Row>(`INSERT INTO signal_topic_rule_cohort_versions(id,workspace_id,run_id,snapshot_id,
      cohort_revision,predecessor_id,binding,cohort_digest,profile_id,profile_version,profile_binding_digest,actor_user_id,idempotency_key,request,request_digest)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::jsonb,$8,$9::uuid,$10,$11,$12::uuid,$13,$14::jsonb,$15)
      RETURNING *,created_at::text`,[randomUUID(),args.workspace_id,snap.run_id,snap.snapshot_id,binding.cohort_revision,
      prior?.id??null,JSON.stringify(binding),cohort_digest,inserted.profileId,inserted.version,profileDigest,args.actor.id,
      args.idempotency_key,JSON.stringify(request),digest(request)])).rows[0]!;
    return project(row,{is_stale:false,stale_reasons:[]},true,false);
  });
}
export async function loadSignalTopicRuleCohortV1(args:Context&{queryable:SignalTopicContractDraftClient}){
  await shared.authorize(args.queryable,args);await snapshot(args.queryable,args);const row=await latest(args.queryable,args);
  return row?project(row,await status(args.queryable,args,row),true,false):null;
}
type TrialRow={id:string;cohort_id:string;actor_user_id:string;request_digest:string;result:SignalTopicRuleCohortTrialResultV1;created_at:string};
async function trialProjection(client:SignalTopicContractDraftClient,args:Context,row:Row,receipt:TrialRow,replayed:boolean,isLatest:boolean){
  return{...receipt.result,...await shared.projectCurrentExamples(client,row,receipt.result),trial_id:receipt.id,
    created_at:new Date(receipt.created_at).toISOString(),...await status(client,args,row),is_latest_cohort:isLatest,
    idempotent_replay:replayed} satisfies SignalTopicRuleCohortTrialV1;
}
export async function loadSignalTopicRuleCohortLatestTrialV1(args:Context&{queryable:SignalTopicContractDraftClient}){
  await shared.authorize(args.queryable,args);await snapshot(args.queryable,args);const row=await latest(args.queryable,args);if(!row)return null;
  const receipt=(await args.queryable.query<TrialRow>(`SELECT receipt.*,receipt.created_at::text FROM signal_topic_rule_cohort_trial_receipts receipt
    WHERE receipt.workspace_id=$1::uuid AND receipt.cohort_id=$2::uuid ORDER BY receipt.created_at DESC,receipt.id DESC LIMIT 1`,[args.workspace_id,row.id])).rows[0];
  return receipt?trialProjection(args.queryable,args,row,receipt,false,true):null;
}
export async function runSignalTopicRuleCohortTrialV1(args:Context&CAS&{client:SignalTopicContractDraftClient;idempotency_key:string;
  max_memberships?:number;example_limit?:number;timeout_ms?:number}):Promise<SignalTopicRuleCohortTrialV1>{
  requestCAS(args);if(args.expected_cohort_revision<1)fail("request_invalid",422);
  const max_memberships=args.max_memberships??25000,example_limit=args.example_limit??10,timeout_ms=args.timeout_ms??15000;
  for(const [value,min,max] of [[max_memberships,1,50000],[example_limit,0,10],[timeout_ms,1,15000]] as const){
    if(!Number.isSafeInteger(value)||value<min||value>max)fail("limits_invalid",422);}
  const request={run_key:args.run_key,expected_cohort_revision:args.expected_cohort_revision,
    expected_cohort_digest:args.expected_cohort_digest,max_memberships,example_limit,timeout_ms};
  return shared.transaction(args.client,async()=>{
    await shared.authorize(args.client,args);await familyLock(args.client,args);
    const prior=(await args.client.query<TrialRow>(`SELECT *,created_at::text FROM signal_topic_rule_cohort_trial_receipts
      WHERE workspace_id=$1::uuid AND idempotency_key=$2`,[args.workspace_id,args.idempotency_key])).rows[0];
    const current=await latest(args.client,args);if(!current)fail("not_found",404);
    if(prior){if(prior.actor_user_id!==args.actor.id||prior.request_digest!==digest(request))fail("idempotency_conflict");
      const original=(await args.client.query<Row>(`SELECT *,created_at::text FROM signal_topic_rule_cohort_versions
        WHERE id=$1::uuid AND workspace_id=$2::uuid AND run_id=$3::uuid`,[prior.cohort_id,args.workspace_id,current!.run_id])).rows[0];
      if(!original)fail("not_found",404);return trialProjection(args.client,args,original!,prior,true,current!.id===original!.id);}
    const row=current!;if(row.cohort_revision!==args.expected_cohort_revision||row.cohort_digest!==args.expected_cohort_digest)fail("stale");
    if((await status(args.client,args,row,true)).is_stale)fail("source_stale");
    const compiled=compileSignalTopicRuleCohortV1(row.binding.rules.map(({candidate_key,rule_spec})=>({candidate_key,rule_spec})),
      {placeholderOffset:3,precomputedVector:true});
    const before=(await args.client.query<{value:string}>("SELECT current_setting('statement_timeout') value")).rows[0]!.value;
    await args.client.query("SELECT set_config('statement_timeout',$1,true)",[`${timeout_ms}ms`]);
    const measured=(await args.client.query<{total:number;histogram:SignalTopicRuleCohortMaskBucketV1[];considered_digest:string;
      examples:Array<{member_ref:string;source_record_digest:string;match_mask:number;text_clean:string;language:string|null;
        market:string|null;scope:string|null;published_month:string}>}>(jointSql(compiled.filter_mask_sql,compiled.match_mask_sql,compiled.values.length+4),
      [args.workspace_id,row.snapshot_id,max_memberships,...compiled.values,example_limit])).rows[0]!;
    await args.client.query("SELECT set_config('statement_timeout',$1,true)",[before]);
    const aggregate=aggregateSignalTopicRuleCohortMasksV1({candidate_keys:compiled.rules.map(rule=>rule.candidate_key),total:measured.total,histogram:measured.histogram});
    const result:SignalTopicRuleCohortTrialResultV1={contract_version:"signal-topic-rule-cohort-trial-v1",cohort_id:row.id,
      cohort_revision:row.cohort_revision,cohort_digest:row.cohort_digest,profile_id:row.profile_id,profile_version:row.profile_version,
      compiler_version:compiled.compiler_version,plan_hash:compiled.plan_hash,rule_plans:compiled.rules.map(rule=>({candidate_key:rule.candidate_key,
        spec_digest:rule.spec_digest,plan_hash:rule.plan_hash,compiler_version:rule.compiler_version})),...aggregate,
      snapshot_digest:row.binding.snapshot_digest,population_digest:row.binding.population_digest,considered_digest:measured.considered_digest,
      population_kind:"frozen_snapshot_memberships",max_memberships,example_limit,timeout_ms,
      examples:measured.examples.map(example=>{const matched_candidate_keys=compiled.rules.filter(rule=>(example.match_mask&rule.bit)!==0).map(rule=>rule.candidate_key);
        return{evidence_ref:digest({snapshot:row.binding.snapshot_digest,member_ref:example.member_ref,source:example.source_record_digest}),
          outcome:matched_candidate_keys.length===0?"abstained":matched_candidate_keys.length===1?"single_match":"multiple_match",
          matched_candidate_keys,excerpt:sanitizeSignalTopicEvidenceExcerptV2(example.text_clean),language:example.language,
          market:example.market,scope:example.scope,month:example.published_month};}),topic_adoption:false,publication:false,serving:false};
    const receipt=(await args.client.query<TrialRow>(`INSERT INTO signal_topic_rule_cohort_trial_receipts(
      id,workspace_id,cohort_id,actor_user_id,idempotency_key,request,request_digest,result,result_digest)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,$7,$8::jsonb,$9) RETURNING *,created_at::text`,
    [randomUUID(),args.workspace_id,row.id,args.actor.id,args.idempotency_key,JSON.stringify(request),digest(request),JSON.stringify(result),digest(result)])).rows[0]!;
    return{...result,trial_id:receipt.id,created_at:new Date(receipt.created_at).toISOString(),is_stale:false,stale_reasons:[],
      is_latest_cohort:true,idempotent_replay:false,example_availability:{stored:result.examples.length,available:result.examples.length,unavailable:0}};
  });
}
function jointSql(filters:string,matches:string,exampleParameter:number){return `WITH population AS MATERIALIZED(
  SELECT * FROM signal_topic_evaluation_v2_cluster_memberships WHERE workspace_id=$1::uuid AND snapshot_id=$2::uuid),
  selected AS MATERIALIZED(SELECT * FROM population ORDER BY assignment_index,member_ref LIMIT $3),
  verified AS MATERIALIZED(SELECT selected.*,mention.text_clean,${shared.sourceAvailabilitySql("selected")} available
    FROM selected LEFT JOIN mentions mention ON mention.id=selected.mention_id LEFT JOIN data_sources source ON source.id=mention.data_source_id),
  eligible AS MATERIALIZED(SELECT member_ref,source_record_digest,assignment_index,language,market,scope,published_month,available,
    CASE WHEN available THEN text_clean ELSE NULL END text_clean,
    to_tsvector('simple',CASE WHEN available THEN COALESCE(text_clean,'') ELSE '' END) search_vector FROM verified),
  masked AS MATERIALIZED(SELECT eligible.*,CASE WHEN available THEN (${filters}) ELSE 0 END filter_mask,
    CASE WHEN available THEN (${matches}) ELSE 0 END match_mask FROM eligible),
  diagnostic_categories AS (SELECT masked.*,CASE WHEN match_mask<>0 AND (match_mask&(match_mask-1))<>0 THEN 0
    WHEN match_mask=0 THEN 1 ELSE 2 END category FROM masked WHERE available AND filter_mask<>0),
  diagnostic_order AS (SELECT diagnostic_categories.*,row_number() OVER(PARTITION BY category ORDER BY assignment_index,member_ref) category_index
    FROM diagnostic_categories)
  SELECT (SELECT count(*)::int FROM population) total,
    COALESCE((SELECT jsonb_agg(to_jsonb(bucket)) FROM(SELECT available,filter_mask,match_mask,count(*)::int count FROM masked
      GROUP BY available,filter_mask,match_mask ORDER BY available,filter_mask,match_mask) bucket),'[]'::jsonb) histogram,
    'sha256:'||encode(digest(convert_to(COALESCE(string_agg(member_ref||'|'||source_record_digest||'|'||available::text||'|'||
      filter_mask::text||'|'||match_mask::text,E'\\n' ORDER BY assignment_index,member_ref),''),'UTF8'),'sha256'),'hex') considered_digest,
    COALESCE((SELECT jsonb_agg(to_jsonb(example)) FROM(SELECT member_ref,source_record_digest,match_mask,text_clean,language,market,scope,published_month
      FROM diagnostic_order ORDER BY category_index,category,assignment_index,member_ref LIMIT $${exampleParameter}) example),'[]'::jsonb) examples FROM masked`;}
