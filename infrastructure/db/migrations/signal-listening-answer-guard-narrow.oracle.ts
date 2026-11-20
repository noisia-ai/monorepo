import assert from 'node:assert/strict';
import {answerGuardBefore0334SqlV1,answerGuardBefore0334DeclareV1,answerGuardAfter0334DeclareV1,
 answerGuardBefore0334LookupV1,answerGuardAfter0334LookupV1,answerGuardAfter0334BodySha256V1,
 answerGuardBodyV1,answerGuardShaV1,answerGuardWitnessSqlV1} from './signal-listening-answer-guard.oracle';

// The OLD body comes exclusively from the frozen 0296 source and the registered
// 0334 delta. Neither an installed function nor the 0339 candidate defines it.
export const answerGuardBefore0339SqlV1=answerGuardBefore0334SqlV1
 .replace(answerGuardBefore0334DeclareV1,answerGuardAfter0334DeclareV1)
 .replace(answerGuardBefore0334LookupV1,answerGuardAfter0334LookupV1);
export const answerGuard0339DeclareV1='DECLARE result jsonb;looked_up record;\n';
export const answerGuard0339HeaderV1='-- Narrow the same fresh receipt lookup to the seventeen fields the guard reads.\n'
 +'-- Keep the seed and all four LEFT joins, including the run independent of call.\n'
 +'-- Four NULL CASE slots retain the original whole-row column permission masks.\n'
 +'-- Every BEFORE ROW check, right lookup and actor lock retains its original order.\n'
 +'-- No authority is cached; structural width does not prove a performance gain.\n';
export const answerGuard0339LookupV1=` SELECT answer_call.id call_id,answer_call.status call_status,
  answer_call.settled_micro_usd call_settled_micro_usd,answer_call.usage call_usage,
  answer_call.raw_sha256 call_raw_sha256,answer_call.raw_storage_verified_at call_raw_storage_verified_at,
  answer_call.raw_storage_verified_key call_raw_storage_verified_key,answer_call.raw_storage_key call_raw_storage_key,
  answer_call.results_applied call_results_applied,answer_call.results call_results,answer_call.request_digest call_request_digest,
  answer_run.entity_context_digest run_entity_context_digest,answer_run.workspace_id run_workspace_id,answer_run.actor_user_id run_actor_user_id,
  answer_question.question_digest question_digest,answer_question.definition->>'type' question_type,
  answer_question.wire->'criteria' question_criteria,
  CASE WHEN false THEN answer_call END permission_call,
  CASE WHEN false THEN answer_run END permission_run,
  CASE WHEN false THEN answer_owner END permission_owner,
  CASE WHEN false THEN answer_question END permission_question INTO looked_up
 FROM (VALUES(true)) AS seed(present)
 LEFT JOIN signal_labeling_calls answer_call ON answer_call.id=NEW.call_id
  AND answer_call.workspace_id=NEW.workspace_id AND answer_call.run_id=NEW.run_id
 LEFT JOIN signal_labeling_runs answer_run ON answer_run.id=NEW.run_id
 LEFT JOIN signal_listening_runs answer_owner ON answer_owner.run_id=answer_run.id AND answer_owner.workspace_id=NEW.workspace_id
 LEFT JOIN signal_listening_questions answer_question ON answer_question.configuration_id=answer_owner.configuration_id
  AND answer_question.question_key=NEW.question_key;
`;
// The only tail edits are these literal field references. JSON extraction moves
// only for the two safe -> / ->> accesses; casts and validation stay in the tail.
export const answerGuard0339AliasesV1=[
 ['call.id','looked_up.call_id'],['call.status','looked_up.call_status'],
 ['call.settled_micro_usd','looked_up.call_settled_micro_usd'],['call.usage','looked_up.call_usage'],
 ['call.raw_sha256','looked_up.call_raw_sha256'],['call.raw_storage_verified_at','looked_up.call_raw_storage_verified_at'],
 ['call.raw_storage_verified_key','looked_up.call_raw_storage_verified_key'],['call.raw_storage_key','looked_up.call_raw_storage_key'],
 ['call.results_applied','looked_up.call_results_applied'],['call.results','looked_up.call_results'],
 ['call.request_digest','looked_up.call_request_digest'],['r.entity_context_digest','looked_up.run_entity_context_digest'],
 ['r.workspace_id','looked_up.run_workspace_id'],['r.actor_user_id','looked_up.run_actor_user_id'],
 ['q.question_digest','looked_up.question_digest'],["q.definition->>'type'",'looked_up.question_type'],
 ["q.wire->'criteria'",'looked_up.question_criteria'],
] as const;
export const answerGuardAfter0339BodySha256V1='83a1d0366bee6339fb010140084bc42dfcabe7b63bb07dc8566272eb7659357f';
export const answerGuard0339WitnessSqlV1=answerGuardWitnessSqlV1.replace('p.prosrc\n FROM',
 'p.proretset,p.pronargs,p.pronargdefaults,pg_get_expr(p.proargdefaults,0) default_arguments,\n'
 +' p.prosupport::text support,p.proallargtypes::text all_arguments,p.proargmodes::text argument_modes,\n'
 +' p.proargnames::text argument_names,p.protrftypes::text transform_types,p.probin,p.prosqlbody::text sql_body,p.prosrc\n FROM');
export function answerGuard0339TailV1(tail:string,inverse=false){
 const replacements=answerGuard0339AliasesV1.map(([before,after])=>inverse?[after,before]as const:[before,after]as const)
  .sort((left,right)=>right[0].length-left[0].length);
 for(const [before,after]of replacements){assert.ok(tail.includes(before),'registered answer field is absent: '+before);tail=tail.replaceAll(before,after);}
 return tail;
}
function replaceOnce(source:string,before:string,after:string){
 const at=source.indexOf(before);assert.ok(at>=0&&source.lastIndexOf(before)===at,'registered narrow guard delta must occur once');
 return source.slice(0,at)+after+source.slice(at+before.length);
}
export function assertAnswerGuard0339SourceV1(migration:string){
 assert.ok(migration.startsWith(answerGuard0339HeaderV1),'0339 preamble must be literal');
 const sql=migration.slice(answerGuard0339HeaderV1.length),at=sql.indexOf(' result:=looked_up.call_results->0;');
 assert.ok(at>0,'0339 guard tail is absent');
 const tail=answerGuard0339TailV1(sql.slice(at),true);
 const restored=replaceOnce(replaceOnce(sql.slice(0,at),answerGuard0339DeclareV1,answerGuardAfter0334DeclareV1),
  answerGuard0339LookupV1,answerGuardAfter0334LookupV1)+tail;
 assert.equal(answerGuardShaV1(answerGuardBodyV1(answerGuardBefore0339SqlV1)),answerGuardAfter0334BodySha256V1);
 assert.equal(restored,answerGuardBefore0339SqlV1,'only declaration, explicit projection and the registered aliases may change');
 assert.equal(answerGuardShaV1(answerGuardBodyV1(sql)),answerGuardAfter0339BodySha256V1);
 return sql;
}
