const ENDPOINT='https://api.anthropic.com/v1/messages';
export const LISTENING_DISCOVERY_RESPONSE_BYTES_V1=1_047_552;
export type ListeningDiscoveryProviderReceiptV1={bytes:Buffer;http_status:number;provider_request_id:string|null;complete:boolean};
export type ListeningDiscoveryProviderV1={
  assertReady(request_body:string):void;
  generate(request_body:string):Promise<ListeningDiscoveryProviderReceiptV1>;
};
export class ListeningDiscoveryProviderErrorV1 extends Error{
  constructor(readonly code:string,readonly outcome:'definitely_not_sent'|'outcome_unknown'){
    super(code);this.name='ListeningDiscoveryProviderError';
  }
}
/** Exact single HTTP request. Response bytes stay opaque until durable custody. */
export function createAnthropicListeningDiscoveryProviderV1(options:{apiKey:string;fetch?:typeof fetch;timeoutMs?:number}):ListeningDiscoveryProviderV1{
  const apiKey=options.apiKey.trim(),timeoutMs=options.timeoutMs??240_000,transport=options.fetch??fetch;
  const invalid=()=>new ListeningDiscoveryProviderErrorV1('listening_discovery_provider_request_invalid','definitely_not_sent');
  const assertReady=(request_body:string)=>{
    if(!apiKey||/[\r\n]/u.test(apiKey))throw new ListeningDiscoveryProviderErrorV1('listening_discovery_provider_key_missing','definitely_not_sent');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>240_000||typeof request_body!=='string'
      ||!request_body.length||Buffer.byteLength(request_body)>2*1024*1024)throw invalid();
    let body:{model?:unknown;stream?:unknown;max_tokens?:unknown};try{body=JSON.parse(request_body);}catch{throw invalid();}
    if(!body||body.model!=='claude-sonnet-4-6'||body.stream!==false||!Number.isSafeInteger(body.max_tokens)
      ||Number(body.max_tokens)<1||Number(body.max_tokens)>64000)throw invalid();
  };
  return{assertReady,async generate(request_body){
    assertReady(request_body);
    const controller=new AbortController(),chunks:Buffer[]=[];let length=0,http_status:number|null=null,provider_request_id:string|null=null;
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>;
    const receipt=(complete:boolean):ListeningDiscoveryProviderReceiptV1=>({bytes:Buffer.concat(chunks,length),http_status:http_status!,provider_request_id,complete});
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('deadline'));},timeoutMs);});
    try{return await Promise.race([deadline,(async()=>{
      const response=await transport(ENDPOINT,{method:'POST',body:request_body,redirect:'error',signal:controller.signal,
        headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','content-type':'application/json'}});
      // Even a late header response carries its original HTTP status. It grants
      // no retry or permission to interpret an incomplete response as usage.
      http_status=response.status;const id=response.headers.get('request-id');provider_request_id=id&&id.length<=200?id:null;
      if(controller.signal.aborted){void response.body?.cancel().catch(()=>undefined);return receipt(false);}
      if(!response.body)return receipt(true);
      reader=response.body.getReader();
      for(;;){const part=await reader.read();if(controller.signal.aborted)return receipt(false);if(part.done)return receipt(true);
        const value=part.value,remaining=LISTENING_DISCOVERY_RESPONSE_BYTES_V1-length,keep=Math.min(value.byteLength,remaining);
        if(keep){chunks.push(Buffer.from(value.subarray(0,keep)));length+=keep;}
        if(value.byteLength>remaining){controller.abort();return receipt(false);}
      }
    })()]);}catch{
      if(http_status!==null)return receipt(false);
      throw new ListeningDiscoveryProviderErrorV1('listening_discovery_provider_transport_unknown','outcome_unknown');
    }finally{clearTimeout(timer!);void reader?.cancel().catch(()=>undefined);}
  }};
}

export type ListeningDiscoveryTransportWrapperV1={contract_version:'listening-discovery-transport-v1';body:string;body_base64:string;
  body_bytes:number;utf8_valid:boolean;complete:boolean;http_status:number;provider_request_id:string|null};
/** Base64 seals every retained physical byte, including invalid UTF-8 prefixes. */
export function encodeListeningDiscoveryTransportV1(receipt:ListeningDiscoveryProviderReceiptV1):string{
  if(!receipt||!Buffer.isBuffer(receipt.bytes)||receipt.bytes.length>LISTENING_DISCOVERY_RESPONSE_BYTES_V1
    ||!Number.isInteger(receipt.http_status)||receipt.http_status<100||receipt.http_status>599||typeof receipt.complete!=='boolean'
    ||receipt.provider_request_id!==null&&(typeof receipt.provider_request_id!=='string'||receipt.provider_request_id.length>200))
    throw Error('listening_discovery_provider_receipt_invalid');
  let body='',utf8_valid=false;
  try{body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(receipt.bytes);utf8_valid=true;}catch{/* Exact bytes remain in base64. */}
  const wrapper:ListeningDiscoveryTransportWrapperV1={contract_version:'listening-discovery-transport-v1',body,
    body_base64:receipt.bytes.toString('base64'),body_bytes:receipt.bytes.length,utf8_valid,
    complete:receipt.complete&&utf8_valid,http_status:receipt.http_status,provider_request_id:receipt.provider_request_id};
  const raw=JSON.stringify(wrapper);if(Buffer.byteLength(raw)>8*1024*1024)throw Error('listening_discovery_raw_bound_invalid');return raw;
}
export function decodeListeningDiscoveryTransportV1(raw:string):ListeningDiscoveryTransportWrapperV1{
  if(typeof raw!=='string'||Buffer.byteLength(raw)>8*1024*1024)throw Error('listening_discovery_raw_invalid');
  let value:ListeningDiscoveryTransportWrapperV1;try{value=JSON.parse(raw);}catch{throw Error('listening_discovery_raw_invalid');}
  if(!value||typeof value.body_base64!=='string')throw Error('listening_discovery_raw_invalid');
  const bytes=Buffer.from(value.body_base64,'base64');
  const expected=JSON.parse(encodeListeningDiscoveryTransportV1({bytes,http_status:value.http_status,
    provider_request_id:value.provider_request_id,complete:value.complete})) as ListeningDiscoveryTransportWrapperV1;
  if(bytes.toString('base64')!==value.body_base64||Object.keys(value).sort().join(',')!==Object.keys(expected).sort().join(',')
    ||(Object.keys(expected)as Array<keyof ListeningDiscoveryTransportWrapperV1>).some(key=>value[key]!==expected[key]))
    throw Error('listening_discovery_raw_invalid');
  return value;
}
