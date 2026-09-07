import {loadSignalTopicRuleSuggestionV1,loadSignalTopicRuleSuggestionEvidenceV1,loadSignalTopicRuleSuggestionPriorDraftV1,
  saveSignalTopicRuleSuggestionDraftV1,loadSignalTopicContractDraftV1,loadSignalTopicContractDraftLatestTrialV1,
  loadSignalTopicEvaluationV2CandidateDetail,type SignalTopicRuleSuggestionReceiptV1} from "@noisia/db";
import type {ResolvedSignalWorkspace,SignalWorkspaceUser} from "./signal-workspace";
import {withTopicRuleTransaction} from "./signal-topic-rule-draft-product";
import {topicRuleSuggestionPageSchema,topicRuleSuggestionBridgeSchema,type TopicRuleSuggestionCommand} from "./signal-topic-rule-suggestion-management";
import {topicRuleExecutionCapability} from "./signal-topic-rule-execution-product";
type Context={workspace:ResolvedSignalWorkspace;actor:SignalWorkspaceUser};
function actor(value:SignalWorkspaceUser){if(value.userType!=="noisia_internal")
  throw Object.assign(new Error("topic_rule_suggestion_forbidden"),{code:"topic_rule_suggestion_forbidden"});
  return{id:value.id,user_type:"noisia_internal"as const};}
function receiptProjection(receipt:SignalTopicRuleSuggestionReceiptV1|null){if(!receipt)return null;
  const a=receipt.adaptation;return{receipt_id:receipt.receipt_id,origin:receipt.origin,status:a.status,
    explanation:a.suggestion.explanation,rule_spec:a.rule_spec,run_key:a.run_key,candidate_key:a.candidate_key,
    expected_candidate_revision:a.expected_candidate_revision,expected_candidate_state_token:a.expected_candidate_state_token,
    expected_draft_revision:a.expected_draft_revision,expected_draft_digest:a.expected_draft_digest,
    is_stale:receipt.is_stale,stale_reasons:receipt.stale_reasons,current_draft:receipt.current_draft,draft_changed:receipt.draft_changed,
    evidence:receipt.evidence,latest_link:receipt.latest_link,created_at:receipt.created_at};}
export async function loadTopicRuleSuggestionProduct(args:Context&{runKey:string;candidateKey:string;receiptId?:string;includeCitations?:boolean}){
  const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  const generation=await topicRuleExecutionCapability({workspace:args.workspace.id,run:args.runKey,candidate:args.candidateKey});
  return withTopicRuleTransaction(pool,true,async client=>{
    const context={queryable:client,workspace_id:args.workspace.id,actor:authorized,run_key:args.runKey,candidate_key:args.candidateKey};
    const detail=await loadSignalTopicEvaluationV2CandidateDetail(context);
    const draft=await loadSignalTopicContractDraftV1(context),trial=await loadSignalTopicContractDraftLatestTrialV1(context);
    const receipt=await loadSignalTopicRuleSuggestionV1({...context,receipt_id:args.receiptId});
    if(args.receiptId&&!receipt)throw Object.assign(new Error("topic_rule_suggestion_not_found"),{code:"topic_rule_suggestion_not_found"});
    const receiptContext=receipt?{...context,receipt_id:receipt.receipt_id}:null;
    const prior=receiptContext?await loadSignalTopicRuleSuggestionPriorDraftV1(receiptContext):null;
    const evidence=receiptContext&&args.includeCitations?await loadSignalTopicRuleSuggestionEvidenceV1(receiptContext):null;
    const {title,description,revision,state_token,review_state}=detail.candidate;
    // DTO validation belongs inside the read transaction. No contexts, source IDs or historical naming citations leave it.
    return topicRuleSuggestionPageSchema.parse({contract_version:"signal-topic-rule-suggestion-management-v1",
      page:{contract_version:"signal-topic-rule-draft-management-v1",run_key:args.runKey,candidate_key:args.candidateKey,
        candidate:{title,description,revision,state_token,review_state},draft,trial},receipt:receiptProjection(receipt),
      citations:evidence?{receipt_id:evidence.receipt_id,items:evidence.citations,availability:evidence.availability}:null,
      prior_drafts:prior?[{draft_id:prior.draft_id,revision:prior.revision}]:[],
      generation});
  });
}
export async function saveTopicRuleSuggestionProduct(args:Context&{request:TopicRuleSuggestionCommand;idempotencyKey:string}){
  const authorized=actor(args.actor),{pool}=await import("@/lib/db");
  return withTopicRuleTransaction(pool,false,async client=>topicRuleSuggestionBridgeSchema.parse(
    await saveSignalTopicRuleSuggestionDraftV1({client,workspace_id:args.workspace.id,actor:authorized,
      idempotency_key:args.idempotencyKey,...args.request})));
}
