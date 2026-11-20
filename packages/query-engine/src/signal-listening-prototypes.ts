import {createHash} from 'node:crypto';
import {validateSignalListeningConfigurationV1,signalListeningQuestionDigestV1,type SignalListeningConfigurationV1} from './signal-listening-contracts';
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
export type SignalListeningPrototypePlanV1={contract_version:'listening-prototype-v1';workspace_id:string;configuration_id:string;
 configuration_digest:string;embedding_profile:typeof SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1;
 topics:Array<{question_key:string;input_digests:string[]}>;
 inputs:Array<{question_key:string;input_digest:string;text_sha256:string}>;texts:Record<string,string>;plan_digest:string};
export function buildSignalListeningPrototypePlanV1(args:{workspace_id:string;configuration_id:string;configuration:SignalListeningConfigurationV1}):SignalListeningPrototypePlanV1{
 const c=validateSignalListeningConfigurationV1(args.configuration),defined=c.questions.filter(q=>q.topic_source==='defined'&&q.type==='noul');
 const inputs=(defined.length>8?defined:[]).map(q=>({question_key:q.key,input_digest:signalListeningQuestionDigestV1(c,q),
  text_sha256:'sha256:'+createHash('sha256').update(q.type==='noul'?q.positive:'').digest('hex')}));
 const texts=Object.fromEntries(inputs.map(i=>[i.text_sha256,(defined.find(q=>q.key===i.question_key) as Extract<typeof defined[number],{type:'noul'}>).positive]));
 const value={contract_version:'listening-prototype-v1' as const,workspace_id:args.workspace_id,configuration_id:args.configuration_id,
  configuration_digest:digest(c),embedding_profile:{...SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1},
  topics:inputs.map(i=>({question_key:i.question_key,input_digests:[i.input_digest]})),inputs,texts};
 return {...value,plan_digest:digest(value)};
}
