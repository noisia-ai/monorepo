import {createHash} from 'node:crypto';
import type {StudyRuntimeReceiptV1} from '../workers/signal-study-runtime';

const endpoint='https://api.anthropic.com/v1/messages';
export const STUDY_SONNET_RESPONSE_BYTES_V1=1_047_552;
export class StudySonnetProviderErrorV1 extends Error{
 constructor(readonly code:string,readonly outcome:'definitely_not_sent'|'outcome_unknown'){super(code);}
}
/** Exact canonical request, one HTTP attempt. The caller supplies only the
 * dedicated Study credential; no SDK or global credential fallback exists. */
export function createAnthropicStudyProviderV1(options:{apiKey:string;fetch?:typeof fetch;timeout_ms?:number}){
 const key=options.apiKey.trim(),transport=options.fetch??fetch,timeout=options.timeout_ms??240000;
 const invalid=()=>new StudySonnetProviderErrorV1('study_provider_request_invalid','definitely_not_sent');
 const assertReady=(request_body:string)=>{
  if(!key||/[\r\n]/u.test(key))throw new StudySonnetProviderErrorV1('study_provider_key_missing','definitely_not_sent');
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>240000||typeof request_body!=='string'
   ||!request_body.length||Buffer.byteLength(request_body)>512*1024)throw invalid();
  let body:{model?:unknown;max_tokens?:unknown;stream?:unknown;messages?:unknown};
  try{body=JSON.parse(request_body);}catch{throw invalid();}
  // The native editorial compiler omits stream. Preserve its exact bytes and
  // digest instead of adding a field to satisfy another consumer's transport.
  if(!body||body.model!=='claude-sonnet-4-6'||body.max_tokens!==32768
   ||body.stream!==undefined&&body.stream!==false||!Array.isArray(body.messages)||!body.messages.length)throw invalid();
 };
 return{assertReady,async generate(request_body:string,signal:AbortSignal):Promise<StudyRuntimeReceiptV1>{
  assertReady(request_body);signal.throwIfAborted();
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
  const chunks:Buffer[]=[];let size=0,status:number|null=null,request_id:string|null=null;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const receipt=(complete:boolean):StudyRuntimeReceiptV1=>{const bytes=Buffer.concat(chunks,size);return{
   body_base64:bytes.toString('base64'),body_bytes:bytes.length,sha256:'sha256:'+createHash('sha256').update(bytes).digest('hex'),
   complete,http_status:status,provider_request_id:request_id};};
  let onAbort:()=>void=()=>{};
  const canceled=new Promise<never>((_,reject)=>{onAbort=()=>reject(Error('study_provider_aborted'));combined.addEventListener('abort',onAbort,{once:true});});
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await Promise.race([canceled,(async()=>{
   const response=await transport(endpoint,{method:'POST',body:request_body,redirect:'error',signal:combined,
    headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'}});
   status=response.status;const id=response.headers.get('request-id');request_id=id&&id.length<=200?id:null;
   if(combined.aborted){void response.body?.cancel().catch(()=>undefined);return receipt(false);}
   if(!response.body)return receipt(true);reader=response.body.getReader();
   for(;;){const part=await reader.read();if(combined.aborted)return receipt(false);if(part.done)return receipt(true);
    const remaining=STUDY_SONNET_RESPONSE_BYTES_V1-size,keep=Math.min(part.value.length,remaining);
    if(keep){chunks.push(Buffer.from(part.value.subarray(0,keep)));size+=keep;}
    if(part.value.length>remaining){controller.abort();return receipt(false);}
   }
  })()]);}catch{
   if(status!==null)return receipt(false);
   throw new StudySonnetProviderErrorV1('study_provider_transport_unknown','outcome_unknown');
  }finally{clearTimeout(timer);combined.removeEventListener('abort',onAbort);void reader?.cancel().catch(()=>undefined);}
 }};
}
