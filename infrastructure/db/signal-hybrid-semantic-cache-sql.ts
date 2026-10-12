import {hybridJevMembershipIdentityV1,HYBRID_JEV_R10_THRESHOLD_V1} from '@noisia/query-engine';
const jev=hybridJevMembershipIdentityV1();
/** Provider question identity excludes the downstream numeric threshold. */
export const hybridCompatibleJevRunSqlV1=(alias:string)=>`EXISTS(SELECT 1 FROM signal_labeler_versions semantic
 WHERE semantic.id=${alias}.labeler_version_id AND semantic.provider='typesafe' AND semantic.model='jev-1.13.0'
 AND semantic.prompt_digest='${jev.prompt_digest}' AND semantic.schema_digest='${jev.schema_digest}')`;
export const hybridJevPositiveSqlV1=`(result#>>'{jev,probability}')::double precision>=${HYBRID_JEV_R10_THRESHOLD_V1}`;
