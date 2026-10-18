import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from '@noisia/query-engine';
import { signalSemanticContextProposalRuntimeConfigurationFromEnvV1 } from './signal-semantic-context-proposal';

/** Explicit completion of an existing policy only. Missing configuration grants nothing.
 * Neither the program estimate nor a historical default becomes a strict maximum. */
export function signalClassicPolicyCompletionConfigurationV1(env:Record<string,string|undefined>){
  const semantic=signalSemanticContextProposalRuntimeConfigurationFromEnvV1(env);
  const creatorUserId=env.NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID?.trim()??'';
  const raw=env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD;
  const prototypeCap=raw===undefined?null:/^[1-9][0-9]{0,14}$/u.test(raw)?raw:undefined;
  const available=semantic.available&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(creatorUserId)&&prototypeCap!==undefined;
  return {available,creatorUserId,semanticCap:semantic.platform_hard_cap_micro_usd?.toString()??null,
    prototypeCap:prototypeCap??null,prototypeConfiguration:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
    semanticConfiguration:{provider:semantic.provider,model:semantic.model,model_version:semantic.model_version,
      pricing_version:semantic.pricing_version,max_input_tokens:semantic.max_input_tokens,max_output_tokens:semantic.max_output_tokens,
      input_usd_per_million_tokens:semantic.input_usd_per_million_tokens,output_usd_per_million_tokens:semantic.output_usd_per_million_tokens}};
}
