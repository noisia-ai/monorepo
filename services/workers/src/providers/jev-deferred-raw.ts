import type {JevRawResponseV1} from './typesafe-jev';

/** A serialized metadata snapshot and an immutable string value. It retains no
 * Response, Headers, physical object or nested reservation/calibration aliases.
 * This is a representation refactor under the UNCHANGED legacy allowance;
 * neither this witness nor the exact byte counter certifies a smaller P/R/F. */
export type JevDeferredRawV1=Readonly<{body:string;shell:string;bytes:number}>;
/** First-party decoded UTF8 only. Exact unpooled backing stores: no small
 * Buffer slice can retain an unpriced8KiB slab. The row/container/view/backing
 * headers are prepaid in the phase owner ledger, not hidden in R payload. */
export type JevPackedRawV3=Readonly<{packed:true;body:Uint8Array;shell:Uint8Array;bytes:number}>;
export type JevDeferredPacketV3=JevDeferredRawV1|JevPackedRawV3;
function exactUtf8(text:string):Uint8Array{
 const bytes=Buffer.byteLength(text),storage=new Uint8Array(bytes),encoded=new TextEncoder().encodeInto(text,storage);
 if(encoded.read!==text.length||encoded.written!==bytes)throw Error('jev_deferred_utf8_encoding_invalid');return storage;
}
export function packJevDeferredRawV3(value:JevDeferredRawV1):JevPackedRawV3{
 // Native TextDecoder(fatal) and its certified synthetic counterpart cannot
 // produce lone surrogates. Never normalize a generic arbitrary UTF16 receipt.
 for(let i=0;i<value.body.length;i++){
  const c=value.body.charCodeAt(i);
  if(c>=0xd800&&c<=0xdbff){const next=value.body.charCodeAt(i+1);if(next<0xdc00||next>0xdfff||!Number.isFinite(next))throw Error('jev_phase_utf8_contract_invalid');i++;}
  else if(c>=0xdc00&&c<=0xdfff)throw Error('jev_phase_utf8_contract_invalid');
 }
 const body=exactUtf8(value.body),shell=exactUtf8(value.shell);
 if(body.byteLength+shell.byteLength>value.bytes)throw Error('jev_phase_packed_bound_invalid');
 return Object.freeze({packed:true,body,shell,bytes:value.bytes});
}

const owners=new WeakMap<object,WeakSet<object>>();
/** Only audited first-party factories call this. A wrapper/spread must obtain
 * its own witness; serialized fields never transfer the owner's identity.
 * This is a memory protocol, not authorization or proof that fetch occurred. */
export function createJevDeferredRawWitnessV1(owner:object):(raw:JevRawResponseV1)=>JevRawResponseV1{
  if(owners.has(owner))throw Error('jev_deferred_owner_repeated');
  const responses=new WeakSet<object>();owners.set(owner,responses);
  return raw=>{responses.add(raw);return raw;};
}
/** Exact UTF8 byte length of JSON.stringify(string), without allocating that
 * escaped string. Includes quotes; lone surrogates use well-formed JSON's six
 * ASCII bytes, paired surrogates encode as one four-byte Unicode scalar. */
export function jevJsonStringUtf8BytesV1(text:string):number{
  let bytes=2;
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    if(c===0x22||c===0x5c||c===0x08||c===0x09||c===0x0a||c===0x0c||c===0x0d)bytes+=2;
    else if(c<0x20)bytes+=6;
    else if(c<0x80)bytes++;
    else if(c<0x800)bytes+=2;
    else if(c>=0xd800&&c<=0xdbff){
      const next=text.charCodeAt(i+1);
      if(next>=0xdc00&&next<=0xdfff){bytes+=4;i++;}else bytes+=6;
    }else bytes+=c>=0xdc00&&c<=0xdfff?6:3;
  }
  return bytes;
}
/** Called at the original JSON.stringify handoff, never by the factory before
 * its wrapper has added calibration metadata. Body is the factory's first own
 * data property. Seal all other observable fields now, including nested extras,
 * key ordering, number serialization and metadata toJSON/getter semantics. */
export function captureJevDeferredRawV1(owner:object,raw:JevRawResponseV1):JevDeferredRawV1|null{
  const witnessed=owners.get(owner);if(!witnessed?.has(raw))return null;
  const body=Object.getOwnPropertyDescriptor(raw,'body');
  const prototype=Object.getPrototypeOf(raw);
  if((prototype!==Object.prototype&&prototype!==null)||'toJSON'in raw
    ||Object.keys(raw)[0]!=='body'||!body||!('value'in body)||typeof body.value!=='string')return null;
  // A string has no observable JSON serialization hook. Substituting only that
  // root property leaves every metadata traversal at its original handoff.
  const shell=JSON.stringify(raw,function(this:unknown,key,value:unknown){return this===raw&&key==='body'?'':value;});
  if(!shell.startsWith('{"body":""'))throw Error('jev_deferred_shell_invalid');
  witnessed.delete(raw);
  return Object.freeze({body:body.value as string,shell,bytes:Buffer.byteLength(shell)-2+jevJsonStringUtf8BytesV1(body.value as string)});
}
/** The caller already owns the row's legacy codec/copy allowance (or, in a
 * future closed profile, an explicit flush workspace) before invoking this. */
export function materializeJevDeferredRawV1(value:JevDeferredPacketV3):string{
  if('packed'in value){
    // ignoreBOM preserves a leading FEFF already present in the decoded body;
    // decoding it twice must never silently strip a second original BOM.
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    const body=decoder.decode(value.body),shell=decoder.decode(value.shell);
    return shell.slice(0,8)+JSON.stringify(body)+shell.slice(10);
  }
  return value.shell.slice(0,8)+JSON.stringify(value.body)+value.shell.slice(10);
}
