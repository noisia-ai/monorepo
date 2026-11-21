import type {JevPackedRawV3} from '../providers/jev-deferred-raw';

/** R contains ONLY exact owned UTF8 backing payloads. All23 fixed64-byte
 * logical slots are prepaid in owner ledger: packet object+4 fields(5), two
 * typed-array views and two exact ArrayBuffer owners(4), row object+6 fields(7),
 * quarantine object+2 fields(3), two array references(2), scalar flags(2).
 * No pooled slab, UTF16 source alias, Response, Headers or mutable metadata
 * object remains after P→R. For factory-decoded UTF8, B_actual+S<=W<=P. */
export function jevDeferredRetainedBytesV3(value:JevPackedRawV3):number{
  return value.body.byteLength+value.shell.byteLength;
}
/** Allocation-free lexical overquote, NOT validation. No JSON object exists
 * before RAW durability. On legal JSON every container/property/key/string
 * token is counted, array element refs are <= commas+array opens. Duplicate
 * keys and commas in objects only overcharge. Primitive values occupy the
 * enclosing property's logical slot or the array's eight-byte value slot.
 * String payload uses the full source's UTF16 units, an upper bound after JSON
 * escapes are decoded. Invalid text retains its RAW and follows the unchanged
 * post-durability validator, including any partial parser allocations. */
export function jevResponseTreeStorageV3(text:string):number{
  let quoted=false,escaped=false,containers=0,properties=0,strings=0,arraySlots=0,numbers=0;
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    if(quoted){if(escaped)escaped=false;else if(c===92)escaped=true;else if(c===34)quoted=false;continue;}
    if(c===34){quoted=true;strings++;}
    else if(c===123)containers++;
    else if(c===91){containers++;arraySlots++;}
    else if(c===58)properties++;
    else if(c===44)arraySlots++;
    else if(c===45||c>=48&&c<=57){
      // Conservatively charge a full logical scalar box even for Smi values;
      // no assertion about V8 allocation or Number() parsing is needed.
      numbers++;
      while(i+1<text.length){const n=text.charCodeAt(i+1);if(n>=48&&n<=57||n===101||n===69||n===43||n===45||n===46)i++;else break;}
    }
  }
  // An unfinished/invalid escape cannot underprice a subsequently valid tree:
  // JSON.parse throws at/before that token; the preceding lexical tree remains
  // bounded. The extra root slot covers a root primitive/invalid partial root.
  return 64*(1+containers+properties+strings+numbers)+8*arraySlots+2*text.length;
}
const encodedMember=(raw:number)=>4*Math.ceil(raw/3)+2048;
/** Hold the SUM of codec representations, even when sequentially nonoverlap:
 * 20E = base64(2), JSONL line(2), lines+joined page(4), file buffer(1),
 * upload Uint8Array(1), Fetch BufferSource copy(1), readback chunks+join(2),
 * decoded page(2), page parser bytes(1), line slice(2), parsed base64(2). Nine W = RAW UTF8/hash bytes(1), physical-wrapper parsed string payload(2),
 * full wrapper(2), stringify(body) scratch(2), packed body+shell UTF16 decode(2). All E metadata is precharged.
 * 3T = full parsed body, cloned full answers, copied usage (full-tree upper).
 * Four SQL serializations (settle, replay-check, results, answers) each own UTF16 JSON(2J), PG UTF8 writer+coalesce
 * copies(2J) and send buffer(1J), summed across all four queries until ACK.
 * J covers canonical JSON <=6*source UTF8 bytes (including 1e20 expansion),
 * <=256 question lineage objects at <=1024 bytes each and fixed wrappers16KiB.
 * Additional fanout10 logical slots/question plus 64KiB conservatively cover
 * result/settled/observation arrays, members, query rows and fixed row wrappers.
 * This inventory inherits the existing pg/storage transport buffer policy;
 * it does not assert a total native Postgres/RSS cap or a new transport bound. */
function flushBytes(bodyBytes:number,tree:number,raw:number,questions:number,metadata=1024*questions+16384):number{
  const E=encodedMember(raw),J=6*bodyBytes+metadata;
  const bytes=20*E+9*raw+3*tree+20*J+10*64*questions+65536;
  if(!Number.isSafeInteger(bytes)||bytes<1)throw Error('jev_phase_geometry_invalid');return bytes;
}
export function jevLegacyPhaseFlushBytesV3(body:string,raw:number,questions:number):number{
  return flushBytes(Buffer.byteLength(body),jevResponseTreeStorageV3(body),raw,questions);
}
export function jevLegacyPhaseMaximumFlushBytesV3(bodyBound:number,rawBound:number,questions:number):number{
  // Every counted token consumes >=1 source byte. The deliberately loose
  // independent maxima avoid assuming balanced/valid JSON before RAW exists.
  const tree=64*(1+4*bodyBound)+8*bodyBound+2*bodyBound;
  return flushBytes(bodyBound,tree,rawBound,questions);
}

/** Listening results retain input question_digests even when this attempt asks
 * only a subset. Price the larger actual lineage cardinality, never just the
 * answers present in the HTTP request. This is not generic response inference. */
export function jevPhaseQuestionSlotsV3(call:{request:unknown;inputs:readonly unknown[]}):number{
 const request=call.request as {questions:Record<string,unknown>};let count=Object.keys(request.questions).length;
 for(const input of call.inputs){
  if(!input||typeof input!=='object')continue;
  const descriptor=Object.getOwnPropertyDescriptor(input,'question_digests');
  if(descriptor&&'value'in descriptor&&descriptor.value&&typeof descriptor.value==='object')count=Math.max(count,Object.keys(descriptor.value).length);
 }
 if(!Number.isSafeInteger(count)||count<1||count>256)throw Error('jev_phase_lineage_contract_invalid');return count;
}

/** Closed first-party RECEIVED rows only. Four payload lanes/call, five query
 * frames: answers/failures partition calls. UUID36/hash71/key<=64 ASCII.
 * Includes delimiter/call; body subtrees remain charged at 6B in EVERY lane.
 * 279 settle (including cache overrides/cost16/invalid-code20), 383+141Q
 * replay/result error lineage, 373Q answer fanout, 136 failure row. Terminal
 * technical codes are not covered; their original Legacy helper is unchanged.
 * No claim about total PG native buffers, RSS or GC follows from this model. */
export function jevListeningSqlMetadataBytesV3(questions:number):number{
 if(!Number.isSafeInteger(questions)||questions<1||questions>256)throw Error('jev_phase_lineage_contract_invalid');
 return Math.max(279,383+141*questions,373*questions,136);
}
export function jevListeningPhaseFlushBytesV3(body:string,raw:number,questions:number):number{
 return flushBytes(Buffer.byteLength(body),jevResponseTreeStorageV3(body),raw,questions,jevListeningSqlMetadataBytesV3(questions));
}
