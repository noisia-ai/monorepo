import { parseSignalTopicRuleSpecV1 } from "@noisia/query-engine";
import { topicRuleDraftSaveSchema,topicRuleDraftTrialRequestSchema,topicRuleSafeErrors } from "./signal-topic-rule-draft-management";

export function parseTopicRuleDraftSave(value:unknown){const request=topicRuleDraftSaveSchema.parse(value);
  return{...request,rule_spec:parseSignalTopicRuleSpecV1(request.rule_spec)};}
export function parseTopicRuleDraftTrial(value:unknown){return topicRuleDraftTrialRequestSchema.parse(value);}
export function topicRuleIdempotencyKey(request:Request){const key=request.headers.get("Idempotency-Key")??"";
  return /^[A-Za-z0-9._:-]{8,200}$/u.test(key)?key:null;}
export function topicRuleResponse(value:unknown,status=200){return Response.json(value,{status,
  headers:{"Cache-Control":"private, no-store"}});}
export function topicRuleError(error:unknown){
  const raw=error&&typeof error==="object"&&"code" in error?error.code:undefined;
  const mapped=raw==="57014"?"topic_rule_trial_timeout":raw==="42P01"||raw==="42883"?"topic_rule_schema_unavailable"
    :raw==="40001"?"topic_rule_candidate_stale"
    :raw==="topic_evaluation_v2_candidate_not_found"?"topic_rule_candidate_not_found":raw;
  const code=topicRuleSafeErrors.find((item)=>item===mapped)??"topic_rule_operation_failed";
  const status=code==="topic_rule_draft_forbidden"?403:code.endsWith("_not_found")?404
    :code==="topic_rule_request_invalid"||code==="topic_rule_scope_mismatch"?422
    :code==="topic_rule_schema_unavailable"?503:code==="topic_rule_operation_failed"?500:409;
  // Never relay SQL diagnostics, arbitrary domain codes, details or exception messages.
  return topicRuleResponse({error:code},status);
}
