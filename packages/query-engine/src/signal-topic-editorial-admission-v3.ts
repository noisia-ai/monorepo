import {
  signalTopicEditorialDigestV1 as digest,
  type SignalTopicEditorialBrandContextV1,
} from './signal-topic-consolidation-editorial-v1';
import {
  SIGNAL_TOPIC_EDITORIAL_CONFIGURATION_V2,
  validateSignalTopicEditorialScreeningPlanV2,
  type SignalTopicEditorialScreeningPlanV2,
  type SignalTopicEditorialGroupRequestV2,
} from './signal-topic-consolidation-editorial-v2';

/** A compact admission identity. The exact V2 requests remain immutable, but
 * are sent to PostgreSQL as separate rows rather than repeated inside plan. */
export type SignalTopicEditorialAdmissionHeaderV3 = {
  contract_version:'signal-topic-editorial-admission-header-v3';
  identity:SignalTopicEditorialScreeningPlanV2['identity'];
  configuration:typeof SIGNAL_TOPIC_EDITORIAL_CONFIGURATION_V2;
  source_context:SignalTopicEditorialBrandContextV1;
  expected_group_count:number;
  source_plan_digest:string;
  requests:Array<{
    batch_index:number;group_key:string;group_digest:string;request_digest:string;custom_id:string;
  }>;
  admission_digest:string;
};

export function buildSignalTopicEditorialAdmissionHeaderV3(
  plan:SignalTopicEditorialScreeningPlanV2,
):SignalTopicEditorialAdmissionHeaderV3 {
  validateSignalTopicEditorialScreeningPlanV2(plan);
  const first=plan.requests[0];
  if(!first||first.configuration.contract_version!==SIGNAL_TOPIC_EDITORIAL_CONFIGURATION_V2.contract_version)
    throw new Error('topic_editorial_v3_plan_invalid');
  const core={
    contract_version:'signal-topic-editorial-admission-header-v3' as const,
    identity:plan.identity,
    configuration:SIGNAL_TOPIC_EDITORIAL_CONFIGURATION_V2,
    source_context:first.source_context,
    expected_group_count:plan.expected_group_count,
    source_plan_digest:plan.plan_digest,
    requests:plan.requests.map((request,batch_index)=>({batch_index,
      group_key:request.receipt.group_key,group_digest:request.receipt.group_digest,
      request_digest:request.request_digest,custom_id:request.provider_request.custom_id})),
  };
  return {...core,admission_digest:digest(core)};
}

/** Application-level transport batches only. The database transaction must
 * validate and insert every row before it commits admission or permits send. */
export function* signalTopicEditorialAdmissionChunksV3(
  plan:SignalTopicEditorialScreeningPlanV2,header:SignalTopicEditorialAdmissionHeaderV3,chunkSize=32,
):Generator<Array<{batch_index:number;request:SignalTopicEditorialGroupRequestV2}>> {
  if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>256)
    throw new Error('topic_editorial_v3_chunk_size_invalid');
  validateSignalTopicEditorialScreeningPlanV2(plan);
  const {admission_digest,...core}=header;
  if(digest(core)!==admission_digest||header.source_plan_digest!==plan.plan_digest
    ||header.expected_group_count!==plan.requests.length
    ||header.requests.some((item,index)=>item.batch_index!==index
      ||item.request_digest!==plan.requests[index]?.request_digest
      ||item.group_key!==plan.requests[index]?.receipt.group_key))
    throw new Error('topic_editorial_v3_header_mismatch');
  for(let start=0;start<plan.requests.length;start+=chunkSize){
    yield plan.requests.slice(start,start+chunkSize).map((request,offset)=>({batch_index:start+offset,request}));
  }
}
