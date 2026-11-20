/** Durable provider-byte prefix; transport failure never becomes a zero-cost receipt. */
export const LISTENING_DISCOVERY_TRANSPORT_V1='listening-discovery-transport-v1' as const;
export const LISTENING_DISCOVERY_RESPONSE_PREFIX_BYTES_V1=1_047_552;
export const LISTENING_DISCOVERY_RAW_WRAPPER_BYTES_V1=8*1024*1024;
export type ListeningDiscoveryTransportReceiptV1={body:string;http_status:number;provider_request_id:string|null;complete:boolean;utf8_valid:boolean;body_bytes:number;versioned:boolean};
function invalid():never{throw Error('listening_discovery_transport_invalid');}
export function parseSignalListeningDiscoveryTransportV1(raw:string):ListeningDiscoveryTransportReceiptV1{
 if(Buffer.byteLength(raw)>LISTENING_DISCOVERY_RAW_WRAPPER_BYTES_V1||Buffer.from(raw).toString('utf8')!==raw)invalid();
 let value:Record<string,unknown>;try{value=JSON.parse(raw);}catch{return invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.body!=='string'||!Number.isInteger(value.http_status)||Number(value.http_status)<100||Number(value.http_status)>599
  ||value.provider_request_id!=null&&(typeof value.provider_request_id!=='string'||value.provider_request_id.length>200))invalid();
 if(value.contract_version===undefined){
  if(value.complete!==undefined&&typeof value.complete!=='boolean')invalid();
  return{body:value.body,http_status:Number(value.http_status),provider_request_id:value.provider_request_id as string??null,complete:value.complete!==false,utf8_valid:true,body_bytes:Buffer.byteLength(value.body),versioned:false};
 }
 if(value.contract_version!==LISTENING_DISCOVERY_TRANSPORT_V1||Object.keys(value).length!==8||['contract_version','body','body_base64','body_bytes','utf8_valid','complete','http_status','provider_request_id'].some(k=>!(k in value))
  ||typeof value.body_base64!=='string'||!Number.isSafeInteger(value.body_bytes)||Number(value.body_bytes)<0||Number(value.body_bytes)>LISTENING_DISCOVERY_RESPONSE_PREFIX_BYTES_V1
  ||typeof value.complete!=='boolean'||typeof value.utf8_valid!=='boolean')invalid();
 const bytes=Buffer.from(value.body_base64,'base64');if(bytes.length!==value.body_bytes||bytes.toString('base64')!==value.body_base64)invalid();
 let body='',utf8_valid=true;try{body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{utf8_valid=false;}
 if(value.utf8_valid!==utf8_valid||value.body!==body)invalid();
 return{body,http_status:Number(value.http_status),provider_request_id:value.provider_request_id as string|null,complete:value.complete,utf8_valid,body_bytes:bytes.length,versioned:true};
}
