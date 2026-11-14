import {JevProviderErrorV1,type JevRequestV1} from '../providers/typesafe-jev';
export const SIGNAL_LISTENING_CONTEXT_TOKENS_V1=65536;
export const SIGNAL_LISTENING_QUESTION_CONTEXT_TOKENS_V1=32768;
export const SIGNAL_LISTENING_HTTP_BODY_BYTES_V1=32*1024*1024;
const fail=(code:string):never=>{throw new JevProviderErrorV1(code,'definitely_not_sent');};

/** Official transport limits are independent of token estimates. A byte count is
 * never reported as tokenization or permission to enable long context. */
export function assertSignalListeningRequestTransportV1(request:JevRequestV1):number{
  const stack:Array<{value:unknown;depth:number}>=[{value:request,depth:1}],seen=new WeakSet<object>();
  while(stack.length){const item=stack.pop()!;
    if(item.depth>64)fail('listening_request_nesting_exceeded');
    if(typeof item.value==='string'&&Buffer.from(item.value,'utf8').toString('utf8')!==item.value)fail('listening_request_utf8_invalid');
    if(item.value&&typeof item.value==='object'){
      if(seen.has(item.value))fail('listening_request_structure_invalid');seen.add(item.value);
      for(const value of Object.values(item.value))stack.push({value,depth:item.depth+1});
    }else if(['undefined','function','symbol','bigint'].includes(typeof item.value)
      ||typeof item.value==='number'&&!Number.isFinite(item.value))fail('listening_request_structure_invalid');
  }
  const bytes=Buffer.byteLength(JSON.stringify(request));
  if(bytes>SIGNAL_LISTENING_HTTP_BODY_BYTES_V1)fail('listening_request_body_exceeded');
  return bytes;
}
/** Budget a complete choice probability map for every configured question. The
 * allowance includes finite JSON numbers, escaped keys and formatting slack.
 * Larger schemas fail before a physical send rather than discarding paid bytes. */
export function signalListeningResponseBoundV1(request:JevRequestV1):number{
  let bytes=4096;
  for(const [key,question]of Object.entries(request.questions)){
    bytes+=Buffer.byteLength(JSON.stringify(key))+200;
    if(question.type==='choice'){
      const options=Object.keys(question.criteria);
      bytes+=Math.max(0,...options.map(key=>Buffer.byteLength(JSON.stringify(key))));
      bytes+=options.reduce((total,key)=>total+Buffer.byteLength(JSON.stringify(key))+32,0);
    }else bytes+=64;
  }
  const bound=Math.max(16384,bytes*2);
  if(bound>2*1024*1024)fail('listening_response_schema_exceeded');
  return bound;
}
/** This is a measured estimate with a margin, not an exact tokenizer. The
 * provider still enforces its native default context and no danger-zone header. */
export function assertSignalListeningMeasuredContextV1(request:JevRequestV1,input_tokens_per_byte:number){
  if(!Number.isFinite(input_tokens_per_byte)||input_tokens_per_byte<=0)fail('listening_calibration_invalid');
  const total=Math.ceil(Buffer.byteLength(JSON.stringify(request))*input_tokens_per_byte);
  if(total>SIGNAL_LISTENING_CONTEXT_TOKENS_V1)fail('listening_request_context_estimate_exceeded');
  for(const [key,question]of Object.entries(request.questions)){
    const single={model:request.model,state:request.state,questions:{[key]:question}};
    if(Math.ceil(Buffer.byteLength(JSON.stringify(single))*input_tokens_per_byte)>SIGNAL_LISTENING_QUESTION_CONTEXT_TOKENS_V1)
      fail('listening_question_context_estimate_exceeded');
  }
  return total;
}
