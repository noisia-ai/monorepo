import { z } from "zod";
import { topicCohortRunKeySchema,topicCohortSafeErrors } from "./signal-topic-rule-cohort-management";

const querySchema=z.object({limit:z.number().int().min(1).max(20),cursor:z.string().min(1).max(2048).nullable(),
  selected_candidate_keys:z.array(z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,179}$/u)).max(15)
    .refine(values=>new Set(values).size===values.length)}).strict();
export function parseTopicCohortQuery(url:string,runKey:string){
  topicCohortRunKeySchema.parse(runKey);const params=new URL(url).searchParams;
  for(const key of params.keys())if(!["limit","cursor","selected_candidate_key"].includes(key))throw new Error("invalid_query");
  if(params.getAll("limit").length>1||params.getAll("cursor").length>1
    ||(params.has("limit")&&!/^[1-9][0-9]?$/u.test(params.get("limit")!)))throw new Error("invalid_query");
  return querySchema.parse({limit:params.has("limit")?Number(params.get("limit")):20,cursor:params.get("cursor"),
    selected_candidate_keys:params.getAll("selected_candidate_key")});
}
export function topicCohortResponse(value:unknown,status=200){return Response.json(value,{status,
  headers:{"Cache-Control":"private, no-store"}});}
export function topicCohortError(error:unknown){
  const raw=error&&typeof error==="object"&&"code" in error?error.code:undefined;
  const mapped=raw==="57014"?"topic_rule_cohort_trial_timeout":raw==="42P01"||raw==="42883"?"topic_rule_cohort_schema_unavailable"
    :raw==="40001"?"topic_rule_cohort_stale":raw==="topic_rule_draft_forbidden"?"topic_rule_cohort_forbidden"
    :raw==="topic_rule_candidate_not_found"||raw==="topic_evaluation_v2_candidate_not_found"?"topic_rule_cohort_run_not_found":raw;
  const code=topicCohortSafeErrors.find(item=>item===mapped)??"topic_rule_cohort_operation_failed";
  const status=code==="topic_rule_cohort_forbidden"?403:code.endsWith("_not_found")?404
    :code.endsWith("_invalid")||code.endsWith("_mismatch")||code.endsWith("_duplicate")?422
    :code==="topic_rule_cohort_schema_unavailable"?503:code==="topic_rule_cohort_operation_failed"?500:409;
  return topicCohortResponse({error:code},status);
}
