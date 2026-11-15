import {createHash} from 'node:crypto';

export const LABELING_RAW_PAGE_MAX_MEMBERS_V1=4096;
export const LABELING_RAW_PAGE_MAX_BYTES_V1=32*1024*1024;
const MAX_RAW_BYTES=8*1024*1024;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const digest=/^sha256:[0-9a-f]{64}$/u;
const hash=(bytes:string|Uint8Array)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const invalid=():never=>{throw new Error('labeling_raw_page_invalid');};
export type LabelingRawPageMemberV1={call_id:string;request_digest:string;raw_sha256:string;
  raw_size_bytes:number;byte_offset:number;byte_length:number};
export type LabelingRawPageV1={page_id:string;name:string;raw_text:string;raw_sha256:string;
  size_bytes:number;members:LabelingRawPageMemberV1[]};
export type LabelingRawPageReferenceV1={workspace_id:string;run_id:string;page_id:string;
  storage_key:string;sha256:string;size_bytes:number};
export type LabelingRawPageStorageV1={
  /** A pure, deterministic reference permits a durable intent before any upload. */
  reference(args:Omit<LabelingRawPageReferenceV1,'storage_key'|'sha256'>&{name:string;raw_sha256:string}):{storage_key:string};
  /** Must authenticate a complete byte-for-byte readback before returning verified. */
  store(args:Omit<LabelingRawPageReferenceV1,'storage_key'|'sha256'>&{name:string;raw_text:string;raw_sha256:string}):
    Promise<{storage_key:string;sha256:string;size_bytes:number;verified:true}>;
  /** May reconstruct an incomplete manifest only from the exact, hash-verified part. */
  load(args:LabelingRawPageReferenceV1):Promise<string>;
};

/** JSONL encloses exact provider-wrapper bytes in base64; it never parses or
 * reserializes the provider body. Every line carries its complete tenant lineage. */
export function buildLabelingRawPageV1(args:{workspace_id:string;run_id:string;
  receipts:Array<{call_id:string;request_digest:string;raw:string}>}):LabelingRawPageV1{
  if(!uuid.test(args.workspace_id)||!uuid.test(args.run_id)||!args.receipts.length
    ||args.receipts.length>LABELING_RAW_PAGE_MAX_MEMBERS_V1)return invalid();
  const seen=new Set<string>(),members:LabelingRawPageMemberV1[]=[],lines:string[]=[];
  let offset=0;
  for(const r of [...args.receipts].sort((a,b)=>a.call_id.localeCompare(b.call_id))){
    if(!uuid.test(r.call_id)||!digest.test(r.request_digest)||typeof r.raw!=='string'||seen.has(r.call_id))return invalid();
    seen.add(r.call_id);const bytes=Buffer.from(r.raw,'utf8');
    if(!bytes.length||bytes.length>MAX_RAW_BYTES)return invalid();
    const line=JSON.stringify({contract_version:'signal-labeling-raw-page-member-v1',workspace_id:args.workspace_id,
      run_id:args.run_id,call_id:r.call_id,request_digest:r.request_digest,raw_base64:bytes.toString('base64')});
    const length=Buffer.byteLength(line);
    members.push({call_id:r.call_id,request_digest:r.request_digest,raw_sha256:hash(bytes),raw_size_bytes:bytes.length,
      byte_offset:offset,byte_length:length});
    offset+=length+1;if(offset>LABELING_RAW_PAGE_MAX_BYTES_V1)return invalid();lines.push(line+'\n');
  }
  const raw_text=lines.join(''),raw_sha256=hash(raw_text),hex=raw_sha256.slice(7);
  // The full SHA, not the shortened UUID, is the integrity and idempotency fence.
  const id=hex.slice(0,12)+'5'+hex.slice(13,16)+'a'+hex.slice(17,32);
  const page_id=[id.slice(0,8),id.slice(8,12),id.slice(12,16),id.slice(16,20),id.slice(20)].join('-');
  return {page_id,name:`page-${hex}.jsonl`,raw_text,raw_sha256,size_bytes:offset,members};
}

export function parseLabelingRawPageV1(args:{workspace_id:string;run_id:string;raw_text:string;
  raw_sha256:string;size_bytes:number;members:LabelingRawPageMemberV1[]}):Map<string,string>{
  try{
    if(!uuid.test(args.workspace_id)||!uuid.test(args.run_id)||!digest.test(args.raw_sha256)
      ||!Number.isSafeInteger(args.size_bytes)||args.size_bytes<1||args.size_bytes>LABELING_RAW_PAGE_MAX_BYTES_V1
      ||Buffer.byteLength(args.raw_text)!==args.size_bytes||hash(args.raw_text)!==args.raw_sha256
      ||!args.raw_text.endsWith('\n')||!args.members.length||args.members.length>LABELING_RAW_PAGE_MAX_MEMBERS_V1)return invalid();
    const bytes=Buffer.from(args.raw_text),result=new Map<string,string>();
    let offset=0;
    for(const member of args.members){
      if(!uuid.test(member.call_id)||!digest.test(member.request_digest)||!digest.test(member.raw_sha256)
        ||!Number.isSafeInteger(member.byte_offset)||member.byte_offset!==offset
        ||!Number.isSafeInteger(member.byte_length)||member.byte_length<1||result.has(member.call_id)
        ||!Number.isSafeInteger(member.raw_size_bytes)||member.raw_size_bytes<1||member.raw_size_bytes>MAX_RAW_BYTES
        ||offset+member.byte_length>=bytes.length||bytes[offset+member.byte_length]!==10)return invalid();
      const row=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,offset+member.byte_length)));
      if(!row||Array.isArray(row)||Object.keys(row).length!==6
        ||row.contract_version!=='signal-labeling-raw-page-member-v1'||row.workspace_id!==args.workspace_id
        ||row.run_id!==args.run_id||row.call_id!==member.call_id||row.request_digest!==member.request_digest
        ||typeof row.raw_base64!=='string')return invalid();
      const raw=Buffer.from(row.raw_base64,'base64');
      if(raw.toString('base64')!==row.raw_base64||raw.length!==member.raw_size_bytes||hash(raw)!==member.raw_sha256)return invalid();
      const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
      if(!Buffer.from(text).equals(raw))return invalid();
      result.set(member.call_id,text);offset+=member.byte_length+1;
    }
    if(offset!==bytes.length)return invalid();
    return result;
  }catch{return invalid();}
}
