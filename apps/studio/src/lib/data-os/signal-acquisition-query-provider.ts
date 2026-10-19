import type { QueryComposerProviderV1 } from "@noisia/query-engine";

import type { SignalAcquisitionQueryComposerPlatformConfigurationV1 } from
  "@/lib/data-os/signal-acquisition-query-composer";

const ANTHROPIC_API_ROOT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicMessage = {
  content?: Array<{ type?: string;text?: string }>;
  error?: { message?: string };
};

export function loadSignalAcquisitionQueryComposerPlatformConfigurationV1(
  env:Record<string,string|undefined>=process.env
):SignalAcquisitionQueryComposerPlatformConfigurationV1{
  return{
    provider:"anthropic",
    model:env.NOISIA_SIGNAL_ACQUISITION_QUERY_MODEL?.trim()
      ||env.ANTHROPIC_MODEL_DEFAULT?.trim()||"claude-sonnet-4-6",
    pricing_version:env.NOISIA_SIGNAL_ACQUISITION_QUERY_PRICING_VERSION?.trim()
      ||"anthropic-public-2026-08-12",
    max_input_tokens_per_call:positiveInteger(
      env.NOISIA_SIGNAL_ACQUISITION_QUERY_MAX_INPUT_TOKENS,20_000
    ),
    max_output_tokens_per_call:positiveInteger(
      env.NOISIA_SIGNAL_ACQUISITION_QUERY_MAX_OUTPUT_TOKENS,5_000
    ),
    input_usd_per_million_tokens:
      env.NOISIA_SIGNAL_ACQUISITION_QUERY_INPUT_USD_PER_MILLION?.trim()||"3",
    output_usd_per_million_tokens:
      env.NOISIA_SIGNAL_ACQUISITION_QUERY_OUTPUT_USD_PER_MILLION?.trim()||"15"
  };
}

export function createAnthropicSignalAcquisitionQueryProviderV1(args:{
  configuration:SignalAcquisitionQueryComposerPlatformConfigurationV1;
  apiKey:string;
  timeoutMs?:number;
}):QueryComposerProviderV1{
  const apiKey=args.apiKey.trim();
  if(!apiKey)throw new Error("query_generation_provider_authority_unavailable");
  return{
    async generate(request){
      const approximateInputTokens=Math.ceil(request.prompt.length/4);
      if(approximateInputTokens>args.configuration.max_input_tokens_per_call){
        throw new Error("query_generation_input_limit_exceeded");
      }
      const response=await fetch(ANTHROPIC_API_ROOT,{
        method:"POST",
        signal:AbortSignal.timeout(args.timeoutMs??150_000),
        headers:{
          "x-api-key":apiKey,
          "anthropic-version":ANTHROPIC_VERSION,
          "content-type":"application/json"
        },
        body:JSON.stringify({
          model:request.model,
          max_tokens:args.configuration.max_output_tokens_per_call,
          temperature:request.temperature,
          messages:[{role:"user",content:request.prompt}]
        })
      });
      const payload=await response.json().catch(()=>({})) as AnthropicMessage;
      if(!response.ok){
        throw new Error(payload.error?.message||`query_generation_provider_failed:${response.status}`);
      }
      const text=(payload.content??[]).filter((item)=>item.type==="text")
        .map((item)=>item.text??"").join("\n").trim();
      if(!text)throw new Error("query_generation_provider_empty_response");
      return{text};
    }
  };
}

function positiveInteger(value:string|undefined,fallback:number){
  const parsed=Number(value);
  return Number.isSafeInteger(parsed)&&parsed>0?parsed:fallback;
}
