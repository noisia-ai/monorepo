import { z } from "zod";
import { topicRuleSuggestionCommandSchema,topicRuleSuggestionSafeErrors } from "./signal-topic-rule-suggestion-management";
import { topicRuleResponse } from "./signal-topic-rule-draft-api";
const querySchema=z.object({run_key:z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,199}$/u),receipt_id:z.string().uuid().optional(),
  include_citations:z.literal("true").optional()}).strict();
export function parseTopicRuleSuggestionQuery(url:string){const params=new URL(url).searchParams;
  if(new Set(params.keys()).size!==[...params].length)throw new Error("duplicate_query");
  return querySchema.parse(Object.fromEntries(params));}
export function parseTopicRuleSuggestionCommand(value:unknown){return topicRuleSuggestionCommandSchema.parse(value);}
export function topicRuleSuggestionError(error:unknown){
  const raw=error&&typeof error==="object"&&"code"in error?error.code:undefined;
  const mapped=raw==="42P01"||raw==="42883"?"topic_rule_suggestion_schema_unavailable"
    :raw==="40001"||raw==="topic_rule_candidate_stale"||raw==="topic_rule_draft_source_stale"?"topic_rule_suggestion_source_stale"
    :raw==="topic_rule_draft_stale"?"topic_rule_suggestion_draft_stale"
    :raw==="topic_rule_draft_forbidden"||raw==="topic_evaluation_v2_forbidden"?"topic_rule_suggestion_forbidden"
    :raw==="topic_evaluation_v2_candidate_not_found"||raw==="topic_rule_candidate_not_found"?"topic_rule_suggestion_not_found":raw;
  const code=topicRuleSuggestionSafeErrors.find(item=>item===mapped)??"topic_rule_suggestion_operation_failed";
  const status=code.endsWith("forbidden")?403:code.endsWith("not_found")?404
    :code.endsWith("request_invalid")||code.endsWith("scope_mismatch")||code.endsWith("restore_invalid")?422
    :code.endsWith("schema_unavailable")||code.endsWith("execution_not_enabled")?503:code.endsWith("operation_failed")?500:409;
  return topicRuleResponse({error:code},status);
}
