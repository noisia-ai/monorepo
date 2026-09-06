import { createSignalTopicContractDraftV1,loadSignalTopicContractDraftV1,
  loadSignalTopicContractDraftLatestTrialV1,loadSignalTopicEvaluationV2CandidateDetail,
  runSignalTopicContractDraftTrialV1,type SignalTopicContractDraftClient } from "@noisia/db";
import type { ResolvedSignalWorkspace,SignalWorkspaceUser } from "./signal-workspace";
import { topicRuleDraftPageSchema,topicRuleDraftSchema,topicRuleTrialSchema,
  type TopicRuleDraftSave,type TopicRuleDraftTrialRequest } from "./signal-topic-rule-draft-management";

type Context={workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser};
function fail(code:string,status=409):never{throw Object.assign(new Error(code),{code,status});}
function actor(value:SignalWorkspaceUser){if(value.userType!=="noisia_internal")fail("topic_rule_draft_forbidden",403);
  return{id:value.id,user_type:"noisia_internal"as const};}
type Pool={connect():Promise<SignalTopicContractDraftClient&{release():void}>};
/** The core owns SAVEPOINTs only; this is the one outer transaction, including DTO validation. */
export async function withTopicRuleTransaction<T>(pool:Pool,readOnly:boolean,
  run:(client:SignalTopicContractDraftClient)=>Promise<T>){
  const client=await pool.connect();try{
    await client.query(readOnly?"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY":"BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result=await run(client);
    if(!readOnly)await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
export function assertTopicRuleRouteBinding(draft:{draft_id:string;source:{run_key:string;candidate_key:string}}|null,
  request:{draft_id:string;run_key:string;candidate_key:string}){
  if(!draft||draft.draft_id!==request.draft_id||draft.source.run_key!==request.run_key
    ||draft.source.candidate_key!==request.candidate_key)fail("topic_rule_scope_mismatch",422);
}
export async function loadTopicRuleDraftProduct(args:Context&{runKey:string;candidateKey:string}){
  const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  return withTopicRuleTransaction(pool,true,async(client)=>{
    const context={queryable:client,workspace_id:args.workspace.id,actor:authorized,
      run_key:args.runKey,candidate_key:args.candidateKey};
    const detail=await loadSignalTopicEvaluationV2CandidateDetail(context);
    const draft=await loadSignalTopicContractDraftV1(context);
    const trial=await loadSignalTopicContractDraftLatestTrialV1(context);
    const {title,description,revision,state_token,review_state}=detail.candidate;
    return topicRuleDraftPageSchema.parse({contract_version:"signal-topic-rule-draft-management-v1",
      run_key:args.runKey,candidate_key:args.candidateKey,candidate:{title,description,revision,state_token,review_state},draft,trial});
  });
}
export async function saveTopicRuleDraftProduct(args:Context&{request:TopicRuleDraftSave;idempotencyKey:string}){
  const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  return withTopicRuleTransaction(pool,false,async(client)=>{
    const replay=(await client.query("SELECT 1 FROM signal_topic_contract_draft_versions WHERE workspace_id=$1::uuid AND idempotency_key=$2",
      [args.workspace.id,args.idempotencyKey])).rows.length>0;
    if(!replay){
      const detail=await loadSignalTopicEvaluationV2CandidateDetail({queryable:client,workspace_id:args.workspace.id,
        actor:authorized,run_key:args.request.run_key,candidate_key:args.request.candidate_key});
      // New rule identity is saved wording; replays retain original request identity and core actor/digest checks.
      if(detail.candidate.revision!==args.request.expected_candidate_revision
        ||detail.candidate.state_token!==args.request.expected_candidate_state_token)fail("topic_rule_candidate_stale");
      if(args.request.rule_spec.label!==detail.candidate.title||args.request.rule_spec.definition!==detail.candidate.description)
        fail("topic_rule_request_invalid",422);
    }
    return topicRuleDraftSchema.parse(await createSignalTopicContractDraftV1({client,workspace_id:args.workspace.id,
      actor:authorized,idempotency_key:args.idempotencyKey,...args.request}));
  });
}
export async function testTopicRuleDraftProduct(args:Context&{request:TopicRuleDraftTrialRequest;idempotencyKey:string}){
  const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  return withTopicRuleTransaction(pool,false,async(client)=>{
    // Bind even a replay of an older draft to this exact route. Core rejects non-latest new trials.
    const bound=(await client.query<{draft_id:string;run_key:string;candidate_key:string}>(`SELECT draft.id::text draft_id,
      run.run_key,candidate.candidate_key FROM signal_topic_contract_draft_versions draft
      JOIN signal_topic_evaluation_v2_runs run ON run.id=draft.run_id AND run.workspace_id=draft.workspace_id
      JOIN signal_topic_evaluation_v2_candidates candidate ON candidate.id=draft.candidate_id
        AND candidate.run_id=draft.run_id AND candidate.workspace_id=draft.workspace_id
      WHERE draft.workspace_id=$1::uuid AND draft.id=$2::uuid AND run.run_key=$3 AND candidate.candidate_key=$4`,
    [args.workspace.id,args.request.draft_id,args.request.run_key,args.request.candidate_key])).rows[0];
    const draft=bound?{draft_id:bound.draft_id,source:{run_key:bound.run_key,candidate_key:bound.candidate_key}}:null;
    assertTopicRuleRouteBinding(draft,args.request);
    return topicRuleTrialSchema.parse(await runSignalTopicContractDraftTrialV1({client,workspace_id:args.workspace.id,
      actor:authorized,idempotency_key:args.idempotencyKey,...args.request}));
  });
}
