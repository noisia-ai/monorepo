import type {LabelingCallV1} from '@noisia/db';
import type {SignalListeningInputV1} from '@noisia/query-engine';
import {createCalibratedJevRuntimeProviderV2} from '../providers/jev-streaming-runtime';
import {JevProviderErrorV1,type JevProviderV1} from '../providers/typesafe-jev';
import type {JevStreamingExecutionV2} from './signal-jev-streaming-window';
export const listeningHasRawV1=(call:LabelingCallV1<SignalListeningInputV1>)=>call.has_raw===true||Boolean(call.raw_storage_key||call.raw_page_id||call.raw_body);
/** A page is an authenticated codec unit: even one member requires its full
 * manifest/hash/member validation. Budget that artifact, not only chosen lines. */
export function selectSignalListeningRecoveryV1(calls:LabelingCallV1<SignalListeningInputV1>[],execution:JevStreamingExecutionV2){
 const first=calls.find(call=>!call.results_applied&&listeningHasRawV1(call));if(!first)return null;
 const group=first.raw_page_id?calls.filter(call=>!call.results_applied&&call.raw_page_id===first.raw_page_id):[first];
 const bytes=Number(first.raw_page_size_bytes??first.raw_size_bytes??Buffer.byteLength(first.raw_body??''));
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>32*1024*1024)throw Error('labeling_raw_receipt_invalid');
 // Eight copies cover UTF16, JSON/base64 decoding, hashing and member extraction.
 // Reserve request/input objects separately; never load an unbounded page set.
 let working=bytes*8;const selected:typeof calls=[];
 for(const call of group){
  const metadataBytes=(Number(call.request_size_bytes??Buffer.byteLength(JSON.stringify(call.request)))+Number(call.input_size_bytes??Buffer.byteLength(JSON.stringify(call.inputs))))*4+4096;
  if(!Number.isSafeInteger(metadataBytes)||metadataBytes<4096)throw Error('labeling_raw_receipt_invalid');
  if(working+metadataBytes>execution.max_buffered_bytes)break;
  selected.push(call);working+=metadataBytes;if(selected.length>=execution.window_size)break;
 }
 if(!selected.length)throw Error('listening_recovery_memory_budget_exceeded');
 return{calls:selected,working_bytes:working,page_bytes:bytes,execution:{...execution,max_in_flight:1,max_flushes:1,
  window_size:selected.length,flush_size:Math.min(selected.length,execution.flush_size)}};
}
/** This provider cannot evaluate. It observes only usage already verified and
 * settled by the shared receipt pipeline; it never creates a quota admission. */
export function createSignalListeningRecoveryProviderV1(args:{execution:JevStreamingExecutionV2;external?:JevProviderV1;
 factory?:typeof createCalibratedJevRuntimeProviderV2;env?:NodeJS.ProcessEnv}):JevProviderV1{
 const clients=new Map<string,JevProviderV1>();
 return{max_concurrency:1,max_response_bytes:16384,
  async evaluate(){throw new JevProviderErrorV1('listening_recovery_only','definitely_not_sent');},
  async observeUsage(raw,tokens){
   if(args.external){await args.external.observeUsage?.(raw,tokens);return;}
   if(!raw.rate_calibration&&!raw.rate_reservation)return;
   const receipt=raw.rate_calibration;
   if(!receipt||!/^sha256:[0-9a-f]{64}$/.test(receipt.labeler_digest)||!Number.isSafeInteger(receipt.input_bytes)||receipt.input_bytes<1
    ||!Number.isSafeInteger(tokens)||tokens<1)throw Error('listening_recovery_rate_receipt_invalid');
   const id=receipt.labeler_digest;
   if(!clients.has(id))clients.set(id,(args.factory??createCalibratedJevRuntimeProviderV2)({labeler_digest:id,execution:args.execution,
    env:{...(args.env??process.env),NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({[id]:{kind:'measured',
     source:'Verified settled recovery usage; observation only, evaluation disabled',fixed_input_tokens:0,
     input_tokens_per_utf8_byte:tokens/receipt.input_bytes,max_request_bytes:receipt.input_bytes}})}}));
   await clients.get(id)!.observeUsage?.(raw,tokens);
  },
  async close(){await Promise.all([...clients.values()].map(client=>client.close?.()));},
 };
}
