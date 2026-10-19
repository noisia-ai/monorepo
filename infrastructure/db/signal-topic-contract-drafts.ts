import {randomUUID} from "node:crypto";
import {compileSignalTopicRuleSpecV1,parseSignalTopicRuleSpecV1,sanitizeSignalTopicEvidenceExcerptV2,
  signalTopicEvaluationDigestV2 as digest,type SignalTopicRuleSpecV1} from "@noisia/query-engine";
import type {SignalTopicEvaluationActorV2} from "./signal-topic-evaluation-v2";

export type SignalTopicContractDraftClient={query<T=Record<string,unknown>>(sql:string,values?:unknown[]):
  Promise<{rows:T[];rowCount:number|null}>};
type Context={workspace_id:string;actor:SignalTopicEvaluationActorV2};
type Source={candidate_id:string;run_id:string;snapshot_id:string;base_revision_id:string;
  editorial_revision_id:string|null;revision:number;version_digest:string;state_token:string;
  review_state:string;run_key:string;candidate_key:string;snapshot_digest:string;population_digest:string};
type DraftRow={id:string;workspace_id:string;run_id:string;candidate_id:string;snapshot_id:string;
  revision:number;predecessor_id:string|null;source_revision:number;source_version_digest:string;
  rule_spec:SignalTopicRuleSpecV1;spec_digest:string;draft_digest:string;created_at:string;
  actor_user_id:string;request_digest:string;run_key:string;candidate_key:string};
export type SignalTopicContractDraftV1={contract_version:"signal-topic-contract-draft-v1";
  draft_id:string;revision:number;draft_digest:string;predecessor_draft_id:string|null;
  rule_spec:SignalTopicRuleSpecV1;spec_digest:string;source:{run_key:string;candidate_key:string;
    revision:number;version_digest:string;snapshot_digest:string};created_at:string;is_stale:boolean;
  is_latest:boolean;idempotent_replay:boolean};
export type SignalTopicContractDraftTrialResultV1={contract_version:"signal-topic-contract-draft-trial-v1";
  draft_id:string;draft_revision:number;draft_digest:string;spec_digest:string;compiler_version:string;
  plan_hash:string;snapshot_digest:string;population_digest:string;considered_digest:string;
  population_kind:"frozen_snapshot_memberships";
  counts:{total:number;considered:number;not_tested:number;filter_excluded:number;unavailable:number;matched:number;abstained:number};
  max_memberships:number;example_limit:number;timeout_ms:number;
  examples:Array<{evidence_ref:string;outcome:"matched"|"abstained";excerpt:string;
    language:string|null;market:string|null;scope:string|null;month:string}>;
  topic_adoption:false;publication:false;serving:false};
export type SignalTopicContractDraftTrialV1=SignalTopicContractDraftTrialResultV1&{
  trial_id:string;created_at:string;is_stale:boolean;is_latest_draft:boolean;idempotent_replay:boolean;
  example_availability:{stored:number;available:number;unavailable:number}};
export class SignalTopicContractDraftError extends Error{
  constructor(public readonly code:string,public readonly status=409){super(code);}
}
type CandidateCAS={expected_candidate_revision:number;expected_candidate_state_token:string};
type DraftCAS={expected_draft_revision:number;expected_draft_digest:string|null};

/** The caller owns BEGIN/COMMIT. SAVEPOINT verifies a real outer transaction and contains errors. */
export async function createSignalTopicContractDraftV1(args:Context&CandidateCAS&DraftCAS&{
  client:SignalTopicContractDraftClient;run_key:string;candidate_key:string;idempotency_key:string;rule_spec:unknown
}):Promise<SignalTopicContractDraftV1>{
  validateInput(args);const rule_spec=parseSignalTopicRuleSpecV1(args.rule_spec);
  const request={run_key:args.run_key,candidate_key:args.candidate_key,
    expected_candidate_revision:args.expected_candidate_revision,
    expected_candidate_state_token:args.expected_candidate_state_token,
    expected_draft_revision:args.expected_draft_revision,expected_draft_digest:args.expected_draft_digest,rule_spec};
  const requestDigest=digest(request);
  return transaction(args.client,async()=>{
    await authorize(args.client,args);await lockKey(args.client,args.workspace_id,args.idempotency_key);
    const existing=(await args.client.query<DraftRow>(`SELECT draft.*,run.run_key,candidate.candidate_key
      FROM signal_topic_contract_draft_versions draft
      JOIN signal_topic_evaluation_v2_runs run ON run.id=draft.run_id
      JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=draft.candidate_id
      WHERE draft.workspace_id=$1::uuid AND draft.idempotency_key=$2`,[args.workspace_id,args.idempotency_key])).rows[0];
    if(existing){
      replay(existing,args.actor.id,requestDigest);
      const source=await sourceFor(args.client,{...args,run_key:existing.run_key,candidate_key:existing.candidate_key});
      return project(existing,source,await latestRevision(args.client,source.candidate_id),true);
    }
    const source=await sourceFor(args.client,args,true);assertCandidateCAS(source,args);
    const prior=(await args.client.query<DraftRow>(`SELECT * FROM signal_topic_contract_draft_versions
      WHERE candidate_id=$1::uuid ORDER BY revision DESC LIMIT 1`,[source.candidate_id])).rows[0];
    if(args.expected_draft_revision!==(prior?.revision??0)||args.expected_draft_digest!==(prior?.draft_digest??null)){
      throw new SignalTopicContractDraftError("topic_rule_draft_stale");
    }
    const spec_digest=digest(rule_spec),revision=(prior?.revision??0)+1;
    const draft_digest=digest({workspace_id:args.workspace_id,run_id:source.run_id,candidate_id:source.candidate_id,
      snapshot_id:source.snapshot_id,source_revision:source.revision,source_version_digest:source.version_digest,
      revision,predecessor_digest:prior?.draft_digest??null,spec_digest});
    const row=(await args.client.query<DraftRow>(`INSERT INTO signal_topic_contract_draft_versions(
      id,workspace_id,run_id,candidate_id,snapshot_id,base_revision_id,editorial_revision_id,
      source_revision,source_version_digest,source_state_token,revision,predecessor_id,predecessor_digest,
      rule_spec,spec_digest,draft_digest,actor_user_id,idempotency_key,request,request_digest)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,$12::uuid,
        $13,$14::jsonb,$15,$16,$17::uuid,$18,$19::jsonb,$20) RETURNING *,created_at::text`,
    [randomUUID(),args.workspace_id,source.run_id,source.candidate_id,source.snapshot_id,
      source.base_revision_id,source.editorial_revision_id,source.revision,source.version_digest,source.state_token,
      revision,prior?.id??null,prior?.draft_digest??null,JSON.stringify(rule_spec),spec_digest,draft_digest,
      args.actor.id,args.idempotency_key,JSON.stringify(request),requestDigest])).rows[0]!;
    return project(row,source,revision,false);
  });
}

export async function loadSignalTopicContractDraftV1(args:Context&{queryable:SignalTopicContractDraftClient;
  run_key:string;candidate_key:string}):Promise<SignalTopicContractDraftV1|null>{
  await authorize(args.queryable,args);const source=await sourceFor(args.queryable,args);
  const row=(await args.queryable.query<DraftRow>(`SELECT *,created_at::text FROM signal_topic_contract_draft_versions
    WHERE candidate_id=$1::uuid AND workspace_id=$2::uuid ORDER BY revision DESC LIMIT 1`,
  [source.candidate_id,args.workspace_id])).rows[0];
  return row?project(row,source,row.revision,false):null;
}

/** Latest draft only: an untested new version never inherits an older version's trial.
 * Call alongside the draft reader in one read-only repeatable-read transaction for a coherent GET. */
export async function loadSignalTopicContractDraftLatestTrialV1(args:Context&{queryable:SignalTopicContractDraftClient;
  run_key:string;candidate_key:string}):Promise<SignalTopicContractDraftTrialV1|null>{
  await authorize(args.queryable,args);const source=await sourceFor(args.queryable,args);
  const draft=(await args.queryable.query<DraftRow>(`SELECT *,created_at::text FROM signal_topic_contract_draft_versions
    WHERE candidate_id=$1::uuid AND workspace_id=$2::uuid AND run_id=$3::uuid AND snapshot_id=$4::uuid
    ORDER BY revision DESC LIMIT 1`,[source.candidate_id,args.workspace_id,source.run_id,source.snapshot_id])).rows[0];
  if(!draft)return null;
  const receipt=(await args.queryable.query<{id:string;result:SignalTopicContractDraftTrialResultV1;created_at:string}>(
    `SELECT id::text,result,created_at::text FROM signal_topic_contract_draft_trial_receipts
      WHERE workspace_id=$1::uuid AND draft_id=$2::uuid ORDER BY created_at DESC,id DESC LIMIT 1`,
    [args.workspace_id,draft.id])).rows[0];
  if(!receipt)return null;
  return{...receipt.result,...await projectCurrentExamples(args.queryable,draft,receipt.result),
    trial_id:receipt.id,created_at:new Date(receipt.created_at).toISOString(),
    is_stale:source.revision!==draft.source_revision||source.version_digest!==draft.source_version_digest||source.review_state!=="pending",
    is_latest_draft:true,idempotent_replay:false};
}

export async function runSignalTopicContractDraftTrialV1(args:Context&CandidateCAS&{
  client:SignalTopicContractDraftClient;draft_id:string;expected_draft_revision:number;
  expected_draft_digest:string;idempotency_key:string;max_memberships?:number;example_limit?:number;timeout_ms?:number
}):Promise<SignalTopicContractDraftTrialV1>{
  validateInput(args);const max_memberships=args.max_memberships??25000,example_limit=args.example_limit??10,
    timeout_ms=args.timeout_ms??15000;
  for(const [value,min,max] of [[max_memberships,1,50000],[example_limit,0,10],[timeout_ms,1,15000]] as const){
    if(!Number.isSafeInteger(value)||value<min||value>max)throw new SignalTopicContractDraftError("topic_rule_trial_limits_invalid",422);
  }
  const request={draft_id:args.draft_id,expected_draft_revision:args.expected_draft_revision,
    expected_draft_digest:args.expected_draft_digest,expected_candidate_revision:args.expected_candidate_revision,
    expected_candidate_state_token:args.expected_candidate_state_token,max_memberships,example_limit,timeout_ms};
  const requestDigest=digest(request);
  return transaction(args.client,async()=>{
    await authorize(args.client,args);await lockKey(args.client,args.workspace_id,args.idempotency_key);
    const prior=(await args.client.query<{id:string;actor_user_id:string;request_digest:string;
      result:SignalTopicContractDraftTrialResultV1;created_at:string}>(`SELECT *,created_at::text
      FROM signal_topic_contract_draft_trial_receipts WHERE workspace_id=$1::uuid AND idempotency_key=$2`,
    [args.workspace_id,args.idempotency_key])).rows[0];
    if(prior)replay(prior,args.actor.id,requestDigest);
    const draft=(await args.client.query<DraftRow>(`SELECT draft.*,run.run_key,candidate.candidate_key
      FROM signal_topic_contract_draft_versions draft
      JOIN signal_topic_evaluation_v2_runs run ON run.id=draft.run_id AND run.workspace_id=draft.workspace_id
      JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=draft.candidate_id
        AND candidate.run_id=draft.run_id AND candidate.workspace_id=draft.workspace_id
      WHERE draft.id=$1::uuid AND draft.workspace_id=$2::uuid`,[args.draft_id,args.workspace_id])).rows[0];
    if(!draft)throw new SignalTopicContractDraftError("topic_rule_draft_not_found",404);
    const source=await sourceFor(args.client,{...args,run_key:draft.run_key,candidate_key:draft.candidate_key},true);
    const latest=await latestRevision(args.client,source.candidate_id);
    const stale=source.revision!==draft.source_revision||source.version_digest!==draft.source_version_digest||source.review_state!=="pending";
    if(prior)return{...prior.result,...await projectCurrentExamples(args.client,draft,prior.result),
      trial_id:prior.id,created_at:new Date(prior.created_at).toISOString(),
      is_stale:stale,is_latest_draft:latest===draft.revision,idempotent_replay:true};
    assertCandidateCAS(source,args);
    if(stale)throw new SignalTopicContractDraftError("topic_rule_draft_source_stale");
    if(draft.revision!==args.expected_draft_revision||draft.draft_digest!==args.expected_draft_digest||draft.revision!==latest){
      throw new SignalTopicContractDraftError("topic_rule_draft_stale");
    }
    const compiled=compileSignalTopicRuleSpecV1(draft.rule_spec,{placeholderOffset:3});
    if(compiled.spec_digest!==draft.spec_digest)throw new SignalTopicContractDraftError("topic_rule_draft_digest_invalid");
    const before=(await args.client.query<{value:string}>("SELECT current_setting('statement_timeout') value")).rows[0]!.value;
    await args.client.query("SELECT set_config('statement_timeout',$1,true)",[`${timeout_ms}ms`]);
    const measured=(await args.client.query<{counts:SignalTopicContractDraftTrialResultV1["counts"];
      considered_digest:string;examples:Array<{member_ref:string;source_record_digest:string;outcome:"matched"|"abstained";
        text_clean:string;language:string|null;market:string|null;scope:string|null;published_month:string}>}>(
      trialSql(compiled.filter_predicate,compiled.lexical_predicate,compiled.values.length+4),
      [args.workspace_id,source.snapshot_id,max_memberships,...compiled.values,example_limit])).rows[0]!;
    await args.client.query("SELECT set_config('statement_timeout',$1,true)",[before]);
    const result:SignalTopicContractDraftTrialResultV1={contract_version:"signal-topic-contract-draft-trial-v1",
      draft_id:draft.id,draft_revision:draft.revision,draft_digest:draft.draft_digest,spec_digest:draft.spec_digest,
      compiler_version:compiled.compiler_version,plan_hash:compiled.plan_hash,snapshot_digest:source.snapshot_digest,
      population_digest:source.population_digest,considered_digest:measured.considered_digest,
      population_kind:"frozen_snapshot_memberships",counts:measured.counts,max_memberships,example_limit,timeout_ms,
      examples:measured.examples.map((row)=>({evidence_ref:digest({snapshot:source.snapshot_digest,
        member_ref:row.member_ref,source:row.source_record_digest}),outcome:row.outcome,
        excerpt:sanitizeSignalTopicEvidenceExcerptV2(row.text_clean),language:row.language,market:row.market,
        scope:row.scope,month:row.published_month})),topic_adoption:false,publication:false,serving:false};
    const receipt=(await args.client.query<{id:string;created_at:string}>(`INSERT INTO signal_topic_contract_draft_trial_receipts(
      id,workspace_id,draft_id,actor_user_id,idempotency_key,request,request_digest,result,result_digest)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,$7,$8::jsonb,$9) RETURNING id::text,created_at::text`,
    [randomUUID(),args.workspace_id,draft.id,args.actor.id,args.idempotency_key,JSON.stringify(request),requestDigest,
      JSON.stringify(result),digest(result)])).rows[0]!;
    return{...result,trial_id:receipt.id,created_at:new Date(receipt.created_at).toISOString(),
      is_stale:false,is_latest_draft:true,idempotent_replay:false,
      example_availability:{stored:result.examples.length,available:result.examples.length,unavailable:0}};
  });
}

// Exact ECMAScript \s set, after NFKC, rather than locale-dependent PostgreSQL whitespace.
// Kept exported only as a deterministic SQL fragment for the supplied-client parity proof.
export const SIGNAL_TOPIC_DRAFT_NORMALIZED_TEXT_SQL=String.raw`btrim(regexp_replace(normalize(mention.text_clean,NFKC),
  U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'))`;
/** Recheck only persisted example bindings. Historical measurements and receipts never change. */
async function projectCurrentExamples<T extends {evidence_ref:string}>(client:SignalTopicContractDraftClient,
  draft:{workspace_id:string;snapshot_id:string},result:{snapshot_digest:string;examples:T[]}){
  const refs=result.examples.map((example)=>example.evidence_ref);
  if(refs.length>10)throw new SignalTopicContractDraftError("topic_rule_trial_examples_invalid");
  const rows=refs.length?(await client.query<{evidence_ref:string;available:boolean}>(`WITH requested_examples AS MATERIALIZED(
    SELECT membership.*,signal_semantic_context_digest_json_v2(jsonb_build_object('snapshot',$3::text,
      'member_ref',membership.member_ref,'source',membership.source_record_digest)) evidence_ref
    FROM signal_topic_evaluation_v2_cluster_memberships membership
    WHERE membership.workspace_id=$1::uuid AND membership.snapshot_id=$2::uuid), selected AS MATERIALIZED(
    SELECT * FROM requested_examples WHERE evidence_ref=ANY($4::text[]))
    SELECT selected.evidence_ref,${sourceAvailabilitySql("selected")} available
    FROM selected LEFT JOIN mentions mention ON mention.id=selected.mention_id
    LEFT JOIN data_sources source ON source.id=mention.data_source_id`,
  [draft.workspace_id,draft.snapshot_id,result.snapshot_digest,refs])).rows:[];
  const available=new Set(rows.filter((row)=>row.available).map((row)=>row.evidence_ref));
  const examples=result.examples.filter((example)=>available.has(example.evidence_ref));
  return{examples,example_availability:{stored:refs.length,available:examples.length,unavailable:refs.length-examples.length}};
}
function sourceAvailabilitySql(membership:"selected"){return `COALESCE(mention.workspace_id=$1::uuid
      AND mention.id=mention.canonical_mention_id AND mention.inclusion_status='included'
      AND source.workspace_id=$1::uuid AND source.status='active' AND mention.text_hash=${membership}.canonical_text_hash
      AND 'sha256:'||encode(digest(convert_to(${SIGNAL_TOPIC_DRAFT_NORMALIZED_TEXT_SQL},'UTF8'),'sha256'),'hex')
        =${membership}.source_content_hash,false)`;}
function trialSql(filters:string,lexical:string,exampleParameter:number){return `WITH population AS MATERIALIZED(
    SELECT membership.* FROM signal_topic_evaluation_v2_cluster_memberships membership
    WHERE membership.workspace_id=$1::uuid AND membership.snapshot_id=$2::uuid), selected AS MATERIALIZED(
    SELECT * FROM population ORDER BY assignment_index,member_ref LIMIT $3), verified AS MATERIALIZED(
    SELECT selected.*,mention.text_clean,${sourceAvailabilitySql("selected")} available
    FROM selected LEFT JOIN mentions mention ON mention.id=selected.mention_id
    LEFT JOIN data_sources source ON source.id=mention.data_source_id), eligible AS MATERIALIZED(
    SELECT member_ref,source_record_digest,assignment_index,language,market,scope,published_month,available,
      CASE WHEN available THEN text_clean ELSE NULL END text_clean FROM verified), classified AS MATERIALIZED(
    SELECT eligible.*,CASE WHEN NOT available THEN 'unavailable'
      WHEN NOT COALESCE((${filters}),false) THEN 'filter_excluded'
      WHEN COALESCE((${lexical}),false) THEN 'matched' ELSE 'abstained' END outcome FROM eligible)
  SELECT jsonb_build_object('total',(SELECT count(*) FROM population),'considered',count(*),
    'not_tested',(SELECT count(*) FROM population)-count(*),
    'unavailable',count(*) FILTER(WHERE outcome='unavailable'),
    'filter_excluded',count(*) FILTER(WHERE outcome='filter_excluded'),
    'matched',count(*) FILTER(WHERE outcome='matched'),'abstained',count(*) FILTER(WHERE outcome='abstained')) counts,
    'sha256:'||encode(digest(convert_to(COALESCE(string_agg(member_ref||'|'||source_record_digest||'|'||outcome,
      E'\\n' ORDER BY assignment_index,member_ref),''),'UTF8'),'sha256'),'hex') considered_digest,
    COALESCE((SELECT jsonb_agg(to_jsonb(example)) FROM(SELECT member_ref,source_record_digest,outcome,
      text_clean,language,market,scope,published_month FROM classified WHERE outcome IN('matched','abstained')
      ORDER BY CASE outcome WHEN 'matched' THEN 0 ELSE 1 END,assignment_index,member_ref
      LIMIT $${exampleParameter}) example),'[]'::jsonb) examples
  FROM classified`;}

async function authorize(client:SignalTopicContractDraftClient,args:Context){
  if(args.actor.user_type!=="noisia_internal")throw new SignalTopicContractDraftError("topic_rule_draft_forbidden",403);
  const valid=(await client.query<{authorized:boolean}>(`SELECT EXISTS(SELECT 1 FROM users actor
    WHERE actor.id=$2::uuid AND actor.user_type='noisia_internal' AND actor.status='active'
      AND signal_data_governance_actor_is_valid($1::uuid,actor.id)) authorized`,[args.workspace_id,args.actor.id])).rows[0]?.authorized;
  if(!valid)throw new SignalTopicContractDraftError("topic_rule_draft_forbidden",403);
}
async function sourceFor(client:SignalTopicContractDraftClient,args:Context&{run_key:string;candidate_key:string},lock=false){
  // Acquire the shared editor row lock first, then read its latest appended revision in a new
  // statement. A lateral projection made before waiting for that lock could otherwise be stale.
  if(lock)await client.query(`SELECT candidate.id FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id AND run.workspace_id=candidate.workspace_id
    WHERE candidate.workspace_id=$1::uuid AND run.run_key=$2 AND candidate.candidate_key=$3 FOR UPDATE OF candidate`,
  [args.workspace_id,args.run_key,args.candidate_key]);
  const row=(await client.query<Source>(`SELECT candidate.id::text candidate_id,run.id::text run_id,
    snapshot.id::text snapshot_id,snapshot.snapshot_digest,snapshot.membership_binding_digest population_digest,
    base.id::text base_revision_id,editorial.id::text editorial_revision_id,run.run_key,candidate.candidate_key,
    COALESCE(editorial.revision,1)::int revision,COALESCE(editorial.version_digest,base.payload_digest) version_digest,
    COALESCE(editorial.review_state,'pending') review_state,
    signal_topic_evaluation_v2_candidate_state_token_v1(candidate.id,COALESCE(editorial.revision,1),
      COALESCE(editorial.version_digest,base.payload_digest)) state_token
    FROM signal_topic_evaluation_v2_candidates candidate
    JOIN signal_topic_evaluation_v2_runs run ON run.id=candidate.run_id AND run.workspace_id=candidate.workspace_id
    JOIN signal_topic_evaluation_v2_snapshots snapshot ON snapshot.id=run.snapshot_id AND snapshot.workspace_id=run.workspace_id
    JOIN signal_topic_evaluation_v2_candidate_revisions base ON base.candidate_id=candidate.id AND base.revision=1
    LEFT JOIN LATERAL(SELECT * FROM signal_topic_evaluation_v2_candidate_editorial_revisions
      WHERE candidate_id=candidate.id ORDER BY revision DESC LIMIT 1) editorial ON true
    WHERE candidate.workspace_id=$1::uuid AND run.run_key=$2 AND candidate.candidate_key=$3
      AND candidate.status='pending' AND NOT candidate.adopted AND NOT candidate.published AND NOT candidate.serving
      AND run.status='completed' AND snapshot.state='frozen' LIMIT 1`,
  [args.workspace_id,args.run_key,args.candidate_key])).rows[0];
  if(!row)throw new SignalTopicContractDraftError("topic_rule_candidate_not_found",404);return row;
}
async function latestRevision(client:SignalTopicContractDraftClient,candidateId:string){
  return(await client.query<{revision:number}>(`SELECT COALESCE(max(revision),0)::int revision
    FROM signal_topic_contract_draft_versions WHERE candidate_id=$1::uuid`,[candidateId])).rows[0]!.revision;
}
function assertCandidateCAS(source:Source,args:CandidateCAS){
  if(source.revision!==args.expected_candidate_revision||source.state_token!==args.expected_candidate_state_token
    ||source.review_state!=="pending")throw new SignalTopicContractDraftError("topic_rule_candidate_stale");
}
function project(row:DraftRow,source:Source,latest:number,replayed:boolean):SignalTopicContractDraftV1{
  return{contract_version:"signal-topic-contract-draft-v1",draft_id:row.id,revision:row.revision,
    draft_digest:row.draft_digest,predecessor_draft_id:row.predecessor_id,rule_spec:row.rule_spec,spec_digest:row.spec_digest,
    source:{run_key:source.run_key,candidate_key:source.candidate_key,revision:row.source_revision,
      version_digest:row.source_version_digest,snapshot_digest:source.snapshot_digest},
    created_at:new Date(row.created_at).toISOString(),is_stale:row.source_revision!==source.revision
      ||row.source_version_digest!==source.version_digest||source.review_state!=="pending",
    is_latest:row.revision===latest,idempotent_replay:replayed};
}
function validateInput(args:CandidateCAS&DraftCAS&{idempotency_key:string}){
  if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)||!Number.isSafeInteger(args.expected_candidate_revision)
    ||args.expected_candidate_revision<1||!/^sha256:[0-9a-f]{64}$/u.test(args.expected_candidate_state_token)
    ||!Number.isSafeInteger(args.expected_draft_revision)||args.expected_draft_revision<0
    ||(args.expected_draft_revision===0?args.expected_draft_digest!==null:
      !/^sha256:[0-9a-f]{64}$/u.test(args.expected_draft_digest??""))){
    throw new SignalTopicContractDraftError("topic_rule_draft_request_invalid",422);
  }
}
function replay(row:{actor_user_id:string;request_digest:string},actor:string,requestDigest:string){
  if(row.actor_user_id!==actor||row.request_digest!==requestDigest)throw new SignalTopicContractDraftError("topic_rule_draft_idempotency_conflict");
}
async function lockKey(client:SignalTopicContractDraftClient,workspaceId:string,key:string){
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${workspaceId}:topic-rule-draft:${key}`]);
}
async function transaction<T>(client:SignalTopicContractDraftClient,body:()=>Promise<T>):Promise<T>{
  try{await client.query("SAVEPOINT topic_rule_draft_v1");}catch(error){
    if((error as{code?:string}).code==="25P01")throw new SignalTopicContractDraftError("topic_rule_draft_transaction_required",409);
    throw error;
  }
  try{const result=await body();await client.query("RELEASE SAVEPOINT topic_rule_draft_v1");return result;}
  catch(error){await client.query("ROLLBACK TO SAVEPOINT topic_rule_draft_v1");
    await client.query("RELEASE SAVEPOINT topic_rule_draft_v1");throw error;}
}

/** Internal DB composition only; intentionally not exported from the package barrel. */
export const signalTopicRuleDraftInternal={authorize,sourceFor,projectCurrentExamples,sourceAvailabilitySql,transaction};
