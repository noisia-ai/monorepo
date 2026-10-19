import { createHash } from "node:crypto";
import { signalTopicEvaluationDigestV2, signalTopicEvaluationOutputSchemaV2, SIGNAL_TOPIC_EVALUATION_V2_OUTPUT,
  type SignalTopicEvaluationOutputV2 } from "@noisia/query-engine";
import { SignalTopicEvaluationV2Error, type SignalTopicEvaluationActorV2 } from "./signal-topic-evaluation-v2";

export const SIGNAL_TOPIC_EVALUATION_V2_RESULT_IMPORT_CONTRACT =
  "signal-topic-evaluation-v2-historical-result-import-v1" as const;
type Digest = string;
type CandidatePayload = SignalTopicEvaluationOutputV2["candidates"][number];
type Evidence = { member_ref:string; evidence_ref:Digest };
export type SignalTopicEvaluationV2HistoricalResultArtifact = {
  contract_version:typeof SIGNAL_TOPIC_EVALUATION_V2_RESULT_IMPORT_CONTRACT;
  snapshot:{snapshot_digest:Digest;rights_digest:Digest;semantic_context_authority_digest:Digest;
    artifact_binding_digest:Digest;membership_binding_digest:Digest};
  source_run:{id:string;run_key:string;flight_card:Record<string,unknown>;flight_card_digest:Digest;
    provider_call_count:number;reserved_micro_usd:string;settled_micro_usd:string;model_turn_count:number;
    tool_call_count:number;total_input_tokens:number;total_output_tokens:number;total_tool_result_bytes:number;
    output_digest:Digest;created_at:string;completed_at:string};
  model_turns:{turn_index:number;turn_kind:"tool"|"final";input_digest:Digest;output_digest:Digest;
    input_tokens:number;output_tokens:number;created_at:string}[];
  retrievals:{id:string;retrieval_index:number;operation:string;tool_input_digest:Digest;result_digest:Digest;
    result_bytes:number;created_at:string}[];
  retrieval_evidence:(Evidence&{retrieval_id:string})[];
  candidates:{id:string;candidate_key:string;candidate_digest:Digest;source_cluster_keys:string[];created_at:string}[];
  candidate_revisions:{id:string;candidate_id:string;payload:CandidatePayload;payload_digest:Digest;created_at:string}[];
  candidate_evidence:{candidate_id:string;retrieval_id:string;evidence_ref:Digest;explanation_digest:Digest}[];
  rankings:{candidate_id:string;rank:number;ranking_reason:string;ranking_digest:Digest;created_at:string}[];
  refinement:{candidate_id:string;source_session_id:string;source_session_digest:Digest;source_proposal_id:string;
    source_proposal_digest:Digest;source_revision:number;source_version_digest:Digest;
    source_brand_os_authority_digest:Digest;session_created_at:string;session_expires_at:string;created_at:string;
    display_name:string;description:string;rationale:string;evidence_refs:Digest[];related_candidate_keys:string[];
    recommendation:"none"|"consider_merge"|"consider_split";evidence:Evidence[]};
};

type ImportClient = {query<T = Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{
  rows:T[];rowCount:number|null}>};
export type SignalTopicEvaluationV2HistoricalResultImport = {
  run_id:string;run_key:string;import_receipt_id:string;artifact_digest:string;replayed:boolean
};
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const DIGEST=/^sha256:[a-f0-9]{64}$/u;
const KEY=/^[a-z0-9][a-z0-9._:-]{0,179}$/u;
const IMPORT_CARD={contract_version:"signal-topic-evaluation-full-evidence-v2",
  execution_enabled:false,provider_calls_allowed:0,no_retry:true,action_time_confirmation_required:true,
  preserve_complete_candidate_pool:true,top_view_limit:10,max_model_turns:12,max_tool_calls:24,
  max_tool_result_bytes:32768,max_total_tool_result_bytes:262144,max_total_input_tokens:450000,
  max_total_output_tokens:50000,hard_cap_micro_usd:1,origin:"imported_result",
  topic_adoption:false,publication:false,serving:false};

/** A portable result, not a provider request. Unknown keys (including raw text fields) fail closed. */
export function validateSignalTopicEvaluationV2HistoricalResultArtifact(value:unknown)
  :SignalTopicEvaluationV2HistoricalResultArtifact {
  requireValue(Buffer.byteLength(JSON.stringify(value)??"", "utf8")<=512*1024,"artifact_too_large");
  const a=object(value,"contract_version snapshot source_run model_turns retrievals retrieval_evidence candidates candidate_revisions candidate_evidence rankings refinement");
  requireValue(a.contract_version===SIGNAL_TOPIC_EVALUATION_V2_RESULT_IMPORT_CONTRACT);
  const snapshot=object(a.snapshot,"snapshot_digest rights_digest semantic_context_authority_digest artifact_binding_digest membership_binding_digest");
  Object.values(snapshot).forEach(digest);
  const run=object(a.source_run,"id run_key flight_card flight_card_digest provider_call_count reserved_micro_usd settled_micro_usd model_turn_count tool_call_count total_input_tokens total_output_tokens total_tool_result_bytes output_digest created_at completed_at");
  uuid(run.id);requireValue(typeof run.run_key==="string"&&/^[a-z0-9][a-z0-9._:-]{7,199}$/u.test(run.run_key));
  digest(run.flight_card_digest);digest(run.output_digest);
  requireValue(run.flight_card!==null&&typeof run.flight_card==="object"&&!Array.isArray(run.flight_card));
  requireValue(signalTopicEvaluationDigestV2(run.flight_card)===run.flight_card_digest);
  integer(run.provider_call_count,1,12);integer(run.model_turn_count,12,12);integer(run.tool_call_count,11,11);
  integer(run.total_input_tokens,0,450000);integer(run.total_output_tokens,0,50000);
  integer(run.total_tool_result_bytes,1,262144);
  for(const k of ["reserved_micro_usd","settled_micro_usd"]){
    requireValue(typeof run[k]==="string"&&/^(0|[1-9][0-9]{0,7})$/u.test(run[k] as string));
    requireValue(BigInt(run[k] as string)<=20000000n);
  }
  requireValue(BigInt(run.settled_micro_usd as string)<=BigInt(run.reserved_micro_usd as string));
  timestamp(run.created_at);timestamp(run.completed_at);
  requireValue(Date.parse(run.created_at as string)<=Date.parse(run.completed_at as string));
  const turns=array(a.model_turns,12,12).map(v=>{
    const r=object(v,"turn_index turn_kind input_digest output_digest input_tokens output_tokens created_at");
    integer(r.turn_index,0,11);requireValue(r.turn_kind==="tool"||r.turn_kind==="final");
    digest(r.input_digest);digest(r.output_digest);integer(r.input_tokens,0,450000);integer(r.output_tokens,0,50000);
    timestamp(r.created_at);return r;
  });
  sequential(turns,"turn_index",0);requireValue(turns.filter(t=>t.turn_kind==="final").length===1);
  requireValue(turns.find(t=>t.turn_index===11)?.turn_kind==="final"
    &&turns.find(t=>t.turn_kind==="final")?.output_digest===run.output_digest);
  requireValue(sum(turns,"input_tokens")===run.total_input_tokens&&sum(turns,"output_tokens")===run.total_output_tokens);
  const retrievals=array(a.retrievals,11,11).map(v=>{
    const r=object(v,"id retrieval_index operation tool_input_digest result_digest result_bytes created_at");
    uuid(r.id);integer(r.retrieval_index,0,10);digest(r.tool_input_digest);digest(r.result_digest);
    integer(r.result_bytes,1,32768);timestamp(r.created_at);
    requireValue(["evaluation_brief","cluster_catalog","cluster_profile","representative_mentions","search_cluster","compare_clusters","brand_os_context"].includes(String(r.operation)));
    return r;
  });
  sequential(retrievals,"retrieval_index",0);unique(retrievals.map(r=>r.id));
  requireValue(retrievals.filter(r=>r.operation==="evaluation_brief").length===1
    &&retrievals.find(r=>r.retrieval_index===0)?.operation==="evaluation_brief");
  requireValue(sum(retrievals,"result_bytes")===run.total_tool_result_bytes);
  const retrieved=array(a.retrieval_evidence,1,480).map(v=>{
    const r=object(v,"retrieval_id member_ref evidence_ref");uuid(r.retrieval_id);text(r.member_ref,1,180);digest(r.evidence_ref);
    requireValue(retrievals.some(x=>x.id===r.retrieval_id
      &&["representative_mentions","search_cluster"].includes(String(x.operation))));return r;
  });
  unique(retrieved.map(r=>`${r.retrieval_id}|${r.evidence_ref}`));
  const candidates=array(a.candidates,10,10).map(v=>{
    const r=object(v,"id candidate_key candidate_digest source_cluster_keys created_at");
    uuid(r.id);key(r.candidate_key);digest(r.candidate_digest);timestamp(r.created_at);
    strings(r.source_cluster_keys,1,12,key);return r;
  });
  unique(candidates.map(r=>r.id));unique(candidates.map(r=>r.candidate_key));
  const revisions=array(a.candidate_revisions,10,10).map(v=>{
    const r=object(v,"id candidate_id payload payload_digest created_at");uuid(r.id);uuid(r.candidate_id);
    digest(r.payload_digest);timestamp(r.created_at);
    const c=candidates.find(c=>c.id===r.candidate_id);requireValue(Boolean(c));
    const p=object(r.payload,"candidate_key title description inclusion exclusion explanation source_cluster_keys evidence_refs status");
    requireValue(p.candidate_key===c!.candidate_key&&p.status==="pending"
      &&signalTopicEvaluationDigestV2(p)===r.payload_digest&&r.payload_digest===c!.candidate_digest
      &&JSON.stringify(p.source_cluster_keys)===JSON.stringify(c!.source_cluster_keys));return r;
  });
  unique(revisions.map(r=>r.id));unique(revisions.map(r=>r.candidate_id));
  const links=array(a.candidate_evidence,30,30).map(v=>{
    const r=object(v,"candidate_id retrieval_id evidence_ref explanation_digest");
    uuid(r.candidate_id);uuid(r.retrieval_id);digest(r.evidence_ref);digest(r.explanation_digest);
    const p=revisions.find(x=>x.candidate_id===r.candidate_id)?.payload as Record<string,unknown>|undefined;
    requireValue(Boolean(p)&&Array.isArray(p!.evidence_refs)&&p!.evidence_refs.includes(r.evidence_ref)
      &&signalTopicEvaluationDigestV2(p!.explanation)===r.explanation_digest
      &&retrieved.some(x=>x.retrieval_id===r.retrieval_id&&x.evidence_ref===r.evidence_ref));return r;
  });
  unique(links.map(r=>`${r.candidate_id}|${r.evidence_ref}`));
  for(const r of revisions)requireValue(links.filter(x=>x.candidate_id===r.candidate_id).length
    ===((r.payload as Record<string,unknown>).evidence_refs as unknown[]).length);
  const rankings=array(a.rankings,10,10).map(v=>{
    const r=object(v,"candidate_id rank ranking_reason ranking_digest created_at");uuid(r.candidate_id);
    integer(r.rank,1,10);text(r.ranking_reason,1,600);digest(r.ranking_digest);timestamp(r.created_at);
    const c=candidates.find(c=>c.id===r.candidate_id);requireValue(Boolean(c));
    requireValue(signalTopicEvaluationDigestV2({rank:r.rank,candidate_key:c!.candidate_key,
      ranking_reason:r.ranking_reason})===r.ranking_digest);return r;
  });
  sequential(rankings,"rank",1);unique(rankings.map(r=>r.candidate_id));
  const output={contract_version:SIGNAL_TOPIC_EVALUATION_V2_OUTPUT,candidates:revisions.map(r=>r.payload),ranking:rankings.map(r=>({rank:r.rank,
    candidate_key:candidates.find(c=>c.id===r.candidate_id)!.candidate_key,ranking_reason:r.ranking_reason}))};
  // The exporter retains original candidate insertion order (including microseconds), not the
  // editor's title/key order. Reconstruct the entire model output, not merely its individual rows.
  requireValue(signalTopicEvaluationOutputSchemaV2.safeParse(output).success);
  requireValue(signalTopicEvaluationDigestV2(output)===run.output_digest,"output_digest_invalid");
  const f=object(a.refinement,"candidate_id source_session_id source_session_digest source_proposal_id source_proposal_digest source_revision source_version_digest source_brand_os_authority_digest session_created_at session_expires_at created_at display_name description rationale evidence_refs related_candidate_keys recommendation evidence");
  uuid(f.candidate_id);uuid(f.source_session_id);uuid(f.source_proposal_id);
  for(const k of ["source_session_digest","source_proposal_digest","source_version_digest","source_brand_os_authority_digest"])digest(f[k]);
  integer(f.source_revision,1,1); // This bounded cut imports original pending candidates, not editorial history.
  requireValue(revisions.some(r=>r.candidate_id===f.candidate_id&&r.payload_digest===f.source_version_digest));
  requireValue(f.source_brand_os_authority_digest===snapshot.semantic_context_authority_digest);
  timestamp(f.session_created_at);timestamp(f.session_expires_at);timestamp(f.created_at);
  requireValue(Date.parse(f.session_expires_at as string)-Date.parse(f.session_created_at as string)===900000
    &&Date.parse(f.created_at as string)>=Date.parse(f.session_created_at as string)
    &&Date.parse(f.created_at as string)<=Date.parse(f.session_expires_at as string));
  text(f.display_name,1,160);text(f.description,1,1500);text(f.rationale,1,1200);
  strings(f.evidence_refs,1,48,digest);strings(f.related_candidate_keys,0,8,key);
  requireValue(["none","consider_merge","consider_split"].includes(String(f.recommendation)));
  requireValue(f.recommendation!=="consider_merge"||(f.related_candidate_keys as unknown[]).length>0);
  for(const related of f.related_candidate_keys as string[])requireValue(candidates.some(c=>c.candidate_key===related&&c.id!==f.candidate_id));
  const evidence=array(f.evidence,1,48).map(v=>{
    const r=object(v,"member_ref evidence_ref");text(r.member_ref,1,180);digest(r.evidence_ref);return r;
  });
  unique(evidence.map(r=>r.evidence_ref));
  requireValue(evidence.length===(f.evidence_refs as unknown[]).length
    &&evidence.every(e=>(f.evidence_refs as unknown[]).includes(e.evidence_ref)));
  requireValue(signalTopicEvaluationDigestV2({contract_version:"signal-topic-candidate-refinement-v1",
    session_id:f.source_session_id,session_digest:f.source_session_digest,display_name:f.display_name,
    description:f.description,evidence_refs:f.evidence_refs,related_candidate_keys:f.related_candidate_keys,
    recommendation:f.recommendation,rationale:f.rationale})===f.source_proposal_digest,"proposal_digest_invalid");
  return value as SignalTopicEvaluationV2HistoricalResultArtifact;
}

/** Caller owns BEGIN/COMMIT (or ROLLBACK). A savepoint makes a rejected artifact atomic without
 * committing the surrounding release/proof transaction. No provider or runtime environment is read. */
export async function importSignalTopicEvaluationV2HistoricalResult(args:{client:ImportClient;
  workspace_id:string;actor:SignalTopicEvaluationActorV2;idempotency_key:string;
  expected_artifact_digest:string;artifact:unknown}):Promise<SignalTopicEvaluationV2HistoricalResultImport>{
  if(args.actor.user_type!=="noisia_internal")throw new SignalTopicEvaluationV2Error("topic_result_import_forbidden",403);
  uuid(args.workspace_id);uuid(args.actor.id);
  requireValue(/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key));digest(args.expected_artifact_digest);
  const artifact=validateSignalTopicEvaluationV2HistoricalResultArtifact(args.artifact);
  const artifactDigest=signalTopicEvaluationDigestV2(artifact);
  requireValue(artifactDigest===args.expected_artifact_digest,"artifact_digest_mismatch");
  const receiptId=importId(args.workspace_id,`${artifactDigest}\n${args.idempotency_key}`);
  const id=(kind:string,source:string)=>importId(receiptId,`${kind}\n${source}`);
  const runId=id("run",artifact.source_run.id),runKey=`topic-v2-import-${runId.replaceAll("-","")}`;
  await args.client.query("SAVEPOINT topic_result_import_v1");
  try{
    const authorized=(await args.client.query<{allowed:boolean}>(`SELECT EXISTS(SELECT 1 FROM users
      WHERE id=$2::uuid AND user_type='noisia_internal' AND status='active'
        AND signal_data_governance_actor_is_valid($1::uuid,$2::uuid)) allowed`,
      [args.workspace_id,args.actor.id])).rows[0]?.allowed;
    if(!authorized)throw new SignalTopicEvaluationV2Error("topic_result_import_forbidden",403);
    await args.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`topic-result-import:${args.workspace_id}:${args.idempotency_key}`]);
    const prior=(await args.client.query<{id:string;run_id:string;artifact_digest:string;actor_user_id:string}>(
      `SELECT id::text,run_id::text,artifact_digest,actor_user_id::text
       FROM signal_topic_evaluation_v2_result_import_receipts WHERE workspace_id=$1::uuid
         AND (idempotency_key=$2 OR artifact_digest=$3)
       ORDER BY (idempotency_key=$2) DESC,created_at LIMIT 1`,
      [args.workspace_id,args.idempotency_key,artifactDigest])).rows[0];
    if(prior){
      requireValue(prior.artifact_digest===artifactDigest&&prior.actor_user_id===args.actor.id,"idempotency_conflict");
      await args.client.query("SELECT signal_topic_evaluation_v2_assert_result_import_v1($1::uuid)",[prior.id]);
      await args.client.query("RELEASE SAVEPOINT topic_result_import_v1");
      return{run_id:prior.run_id,run_key:`topic-v2-import-${prior.run_id.replaceAll("-","")}`,
        import_receipt_id:prior.id,artifact_digest:artifactDigest,replayed:true};
    }
    const snapshot=(await args.client.query<{id:string}>(`SELECT id::text
      FROM signal_topic_evaluation_v2_snapshots WHERE workspace_id=$1::uuid AND snapshot_digest=$2
        AND rights_digest=$3 AND semantic_context_authority_digest=$4
        AND artifact_binding_digest=$5 AND membership_binding_digest=$6 AND state='frozen' FOR SHARE`,
      [args.workspace_id,artifact.snapshot.snapshot_digest,artifact.snapshot.rights_digest,
        artifact.snapshot.semantic_context_authority_digest,artifact.snapshot.artifact_binding_digest,
        artifact.snapshot.membership_binding_digest])).rows[0];
    requireValue(Boolean(snapshot),"snapshot_mismatch");
    await args.client.query(`INSERT INTO signal_topic_evaluation_v2_result_import_receipts(
      id,workspace_id,run_id,snapshot_id,actor_user_id,idempotency_key,artifact_digest,artifact)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::jsonb)`,
      [receiptId,args.workspace_id,runId,snapshot!.id,args.actor.id,args.idempotency_key,artifactDigest,JSON.stringify(artifact)]);
    const source=artifact.source_run;
    await args.client.query(`INSERT INTO signal_topic_evaluation_v2_runs(id,workspace_id,snapshot_id,
      requested_by_user_id,idempotency_key,run_key,confirmation,flight_card,flight_card_digest,
      status,provider_execution_enabled,provider_call_count,model_turn_count,tool_call_count,
      total_input_tokens,total_output_tokens,total_tool_result_bytes,reserved_micro_usd,settled_micro_usd,
      output_digest,completed_at,origin,import_receipt_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,'RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION',
        $7::jsonb,$8,'completed',false,0,12,11,$9,$10,$11,0,0,$12,clock_timestamp(),'imported_result',$13::uuid)`,
      [runId,args.workspace_id,snapshot!.id,args.actor.id,`result-import:${receiptId}`,runKey,
        JSON.stringify(IMPORT_CARD),signalTopicEvaluationDigestV2(IMPORT_CARD),source.total_input_tokens,
        source.total_output_tokens,source.total_tool_result_bytes,source.output_digest,receiptId]);
    for(const r of artifact.retrievals)await args.client.query(`INSERT INTO signal_topic_evaluation_v2_retrievals(
      id,run_id,workspace_id,retrieval_index,operation,tool_input_digest,result_digest,result_bytes,created_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::timestamptz)`,[id("retrieval",r.id),runId,
      args.workspace_id,r.retrieval_index,r.operation,r.tool_input_digest,r.result_digest,r.result_bytes,r.created_at]);
    for(const r of artifact.retrieval_evidence)await args.client.query(`INSERT INTO signal_topic_evaluation_v2_retrieval_evidence(
      retrieval_id,snapshot_id,member_ref,evidence_ref) VALUES($1::uuid,$2::uuid,$3,$4)`,
      [id("retrieval",r.retrieval_id),snapshot!.id,r.member_ref,r.evidence_ref]);
    for(const t of artifact.model_turns)await args.client.query(`INSERT INTO signal_topic_evaluation_v2_model_turns(
      run_id,workspace_id,turn_index,turn_kind,input_digest,output_digest,input_tokens,output_tokens,created_at)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,[runId,args.workspace_id,t.turn_index,
      t.turn_kind,t.input_digest,t.output_digest,t.input_tokens,t.output_tokens,t.created_at]);
    for(const c of artifact.candidates)await args.client.query(`INSERT INTO signal_topic_evaluation_v2_candidates(
      id,run_id,workspace_id,candidate_key,candidate_digest,source_cluster_keys,created_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::text[],$7::timestamptz)`,[id("candidate",c.id),runId,
      args.workspace_id,c.candidate_key,c.candidate_digest,c.source_cluster_keys,c.created_at]);
    for(const r of artifact.candidate_revisions)await args.client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_revisions(
      id,candidate_id,run_id,workspace_id,revision,payload,payload_digest,created_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,1,$5::jsonb,$6,$7::timestamptz)`,[id("revision",r.id),
      id("candidate",r.candidate_id),runId,args.workspace_id,JSON.stringify(r.payload),r.payload_digest,r.created_at]);
    for(const e of artifact.candidate_evidence)await args.client.query(`INSERT INTO signal_topic_evaluation_v2_candidate_evidence(
      candidate_id,retrieval_id,evidence_ref,explanation_digest) VALUES($1::uuid,$2::uuid,$3,$4)`,
      [id("candidate",e.candidate_id),id("retrieval",e.retrieval_id),e.evidence_ref,e.explanation_digest]);
    for(const r of artifact.rankings)await args.client.query(`INSERT INTO signal_topic_evaluation_v2_rankings(
      run_id,candidate_id,rank,ranking_reason,ranking_digest,created_at) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz)`,
      [runId,id("candidate",r.candidate_id),r.rank,r.ranking_reason,r.ranking_digest,r.created_at]);
    const f=artifact.refinement;
    await args.client.query(`INSERT INTO signal_topic_evaluation_v2_archived_refinements(id,import_receipt_id,
      workspace_id,run_id,snapshot_id,candidate_id,source_revision,source_version_digest,source_proposal_digest,
      source_created_at,display_name,description,rationale,evidence_refs,related_candidate_keys,recommendation)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10::timestamptz,$11,$12,$13,$14::text[],$15::text[],$16)`,
      [id("refinement",f.source_proposal_id),receiptId,args.workspace_id,runId,snapshot!.id,id("candidate",f.candidate_id),
        f.source_revision,f.source_version_digest,f.source_proposal_digest,f.created_at,f.display_name,
        f.description,f.rationale,f.evidence_refs,f.related_candidate_keys,f.recommendation]);
    await args.client.query("SELECT signal_topic_evaluation_v2_assert_result_import_v1($1::uuid)",[receiptId]);
    await args.client.query("RELEASE SAVEPOINT topic_result_import_v1");
    return{run_id:runId,run_key:runKey,import_receipt_id:receiptId,artifact_digest:artifactDigest,replayed:false};
  }catch(error){
    await args.client.query("ROLLBACK TO SAVEPOINT topic_result_import_v1");
    await args.client.query("RELEASE SAVEPOINT topic_result_import_v1");
    throw error;
  }
}

function importId(namespace:string,value:string){
  const h=createHash("sha256").update(`${namespace}\n${value}`).digest("hex").slice(0,32);
  return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function requireValue(ok:unknown,suffix="artifact_invalid"):asserts ok{
  if(!ok)throw new SignalTopicEvaluationV2Error(`topic_result_import_${suffix}`,422);
}
function object(value:unknown,keys:string):Record<string,unknown>{
  requireValue(value!==null&&typeof value==="object"&&!Array.isArray(value));
  const result=value as Record<string,unknown>,expected=keys.split(" ");
  requireValue(Object.keys(result).length===expected.length&&expected.every(k=>Object.hasOwn(result,k)));return result;
}
function array(value:unknown,min:number,max:number):unknown[]{requireValue(Array.isArray(value)&&value.length>=min&&value.length<=max);return value;}
function integer(value:unknown,min:number,max:number){requireValue(Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max);}
function text(value:unknown,min:number,max:number){requireValue(typeof value==="string"&&value.trim().length>=min&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value));}
function uuid(value:unknown){requireValue(typeof value==="string"&&UUID.test(value));}
function digest(value:unknown){requireValue(typeof value==="string"&&DIGEST.test(value));}
function key(value:unknown){requireValue(typeof value==="string"&&KEY.test(value));}
function timestamp(value:unknown){requireValue(typeof value==="string"&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/u.test(value)&&Number.isFinite(Date.parse(value)));}
function unique(values:unknown[]){requireValue(new Set(values).size===values.length);}
function strings(value:unknown,min:number,max:number,validate:(v:unknown)=>void){const values=array(value,min,max);values.forEach(validate);unique(values);}
function sequential(rows:Record<string,unknown>[],field:string,start:number){unique(rows.map(r=>r[field]));requireValue(rows.every((r,i)=>r[field]===i+start));}
function sum(rows:Record<string,unknown>[],field:string){return rows.reduce((n,r)=>n+Number(r[field]),0);}
