import {createHash} from 'node:crypto';
import {compileSignalListeningSnapshotV1,createSignalListeningShapeCompilerV1,readSignalListeningSnapshotV1,
 type FacetInput,type SignalListeningInputV1,type SignalListeningCalibrationShapeV1} from '@noisia/query-engine';
import type {LabelingRunV1,LabelingCallProposalV1,LabelingCallV1} from './signal-labeling-runs';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu,hash=/^sha256:[0-9a-f]{64}$/u;
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
function plainJson(value:unknown,seen=new Set<object>()):boolean{
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(typeof value!=='object'||seen.has(value))return false;
 if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
 seen.add(value);const valid=Object.values(value).every(v=>plainJson(v,seen));seen.delete(value);return valid;
}
function canonical(v:unknown):unknown{return Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const fingerprint=(p:LabelingCallProposalV1<FacetInput>)=>createHash('sha256').update(JSON.stringify({custom_id:p.custom_id,request_digest:p.request_digest,
 request:p.request,inputs:p.inputs,reserved_micro_usd:p.reserved_micro_usd,retry_depth:p.retry_depth??0})).digest('hex');
type PacketRow<Input extends FacetInput>={proposal:LabelingCallProposalV1<Input>;fingerprint:string;shape:SignalListeningCalibrationShapeV1;request_bytes:number;
 value:{custom_id:string;request_digest:string;inputs:Input[];question_keys:string[];reserved_micro_usd:number;retry_depth:0}};
/** Logical working-set quote, not a V8 heap/RSS claim. It counts every input
 * occurrence (including aliases) and never materializes a serialized payload.
 * P/C below bound UTF-16 JSON units for proposals/configuration. A unit can
 * occupy two string bytes and three UTF-8 transmission bytes. Node slots use
 * an explicit conservative 64-byte logical slot charge; this is not heap size.
 *
 * P: 2 canonical comparison trees + 2 parsed RETURNING trees + plan/shape/
 * dictionary nodes; four simultaneous JSON strings and two UTF-8 buffers.
 * C: validated clone + compiled wires/identity + descriptors, digest canonical
 * clone/strings/buffer. No sharing credit is taken for the common dictionary.
 * Per row: both 64-column RETURNING metadata sets, measured32 UUID/source
 * profile metadata, eight row/selection/ID arrays and SHA256 strings. These
 * cover DB-owned temporaries IN ADDITION to worker proposal/call/response
 * custody; both survive until this method's ACK/error, with no authority cache.
 */
export function nativeListeningAdmissionWorkspaceBoundV1(run:Pick<LabelingRunV1,'identity'>,
 proposals:ReadonlyArray<LabelingCallProposalV1<FacetInput>>):number{
 const ancestors=new Set<object>();
 const count=(value:unknown):{units:number;nodes:number}=>{
  if(value===null||typeof value==='boolean')return{units:5,nodes:1};
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('labeling_admission_workspace_invalid');return{units:25,nodes:1};}
  if(typeof value==='string')return{units:2+6*value.length,nodes:1}; // all code units escaped is an upper bound
  if(!value||typeof value!=='object'||ancestors.has(value)
   ||!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
   throw Error('labeling_admission_workspace_invalid');
  ancestors.add(value);let units=2,nodes=1;
  for(const key in value){if(!Object.hasOwn(value,key))continue;
   const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor))throw Error('labeling_admission_workspace_invalid');
   const child=count(descriptor.value);units+=child.units+1+(Array.isArray(value)?0:3+6*key.length);nodes+=child.nodes+1;
  }
  ancestors.delete(value);if(!Number.isSafeInteger(units)||!Number.isSafeInteger(nodes))throw Error('labeling_admission_workspace_invalid');return{units,nodes};
 };
 if(!Array.isArray(proposals)||proposals.length>1024)throw Error('labeling_admission_workspace_invalid');
 const p=count(proposals),c=count(run.identity.params.configuration),n=proposals.length;
 const jsonAndWire=(4*2+2*3)*p.units+(4*2+2*3)*c.units;
 const treesAndSlots=6*64*p.nodes+6*64*c.nodes;
 const returningMetadata=2*64*(64+2*128); // schema columns, slot + bounded non-payload scalar representation
 const measuredProfile=32*(64+2*38)+24*(64+2*128); // 32 UUIDs plus scope/digests/range fields
 const rowArraysAndHashes=8*8+4*(64+2*64);
 const bytes=jsonAndWire+treesAndSlots+n*(returningMetadata+measuredProfile+rowArraysAndHashes);
 if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('labeling_admission_workspace_invalid');return bytes;
}
/** Operation-local data projection only. It never contains authority or a
 * reusable native validation decision. The store retains the real proposals. */
export type NativeListeningAdmissionPacketV1<Input extends FacetInput>={run_id:string;workspace_id:string;configuration_digest:string;model:string;
 questions:Record<string,unknown>;rows:PacketRow<Input>[]};

/** Unsupported shapes/ambiguous common values use the unchanged legacy path. */
export function planNativeListeningAdmissionPacketV1<Input extends FacetInput>(run:LabelingRunV1,
 proposals:ReadonlyArray<LabelingCallProposalV1<Input>>,limit:number):NativeListeningAdmissionPacketV1<Input>|null{
 try{
  if(run.kind!=='mass_labeling'||run.identity.provider!=='typesafe'||run.identity.model!=='jev-1.13.0'
   ||run.identity.params.request_version!=='listening-jev-v1'||!Number.isSafeInteger(limit)||limit<1||limit>1024
   ||!Array.isArray(proposals)||proposals.length<1||proposals.length>limit)return null;
  const snapshot=compileSignalListeningSnapshotV1(run.identity.params.configuration),state=readSignalListeningSnapshotV1(snapshot),shapes=createSignalListeningShapeCompilerV1(snapshot);
  if(state.configuration_digest!==run.identity.params.configuration_digest)return null;
  const questions:Record<string,unknown>=Object.create(null),wireBytes=new Map<string,string>(),ids=new Set<string>(),roots=new Set<string>();
  const rows:PacketRow<Input>[]=[];let map:string|undefined;
  for(const proposal of proposals){
   if(!proposal||!plainJson(proposal.request)||!plainJson(proposal.inputs)||!Array.isArray(proposal.inputs)||proposal.inputs.length!==1
    ||proposal.retry_depth!==undefined&&proposal.retry_depth!==0||!Number.isSafeInteger(proposal.reserved_micro_usd)||proposal.reserved_micro_usd<1
    ||!hash.test(proposal.request_digest)||proposal.custom_id!=='listening_'+proposal.request_digest.slice(7,67)||ids.has(proposal.custom_id))return null;
   const input=proposal.inputs[0] as unknown as SignalListeningInputV1,request=proposal.request;
   if(!input||!uuid.test(input.root_id)||roots.has(input.root_id)||!hash.test(input.input_digest)||typeof input.text!=='string'||!input.text.trim()
    ||!uuid.test(input.map_id)||input.configuration_digest!==state.configuration_digest||!object(input.question_digests)||!object(input.scope_basis)
    ||!Array.isArray(input.question_keys)||input.question_keys.length<1||input.question_keys.length>256
    ||new Set(input.question_keys).size!==input.question_keys.length||input.question_keys.some(k=>typeof k!=='string')
    ||Object.keys(request).sort().join(',')!=='model,questions,state'||request.model!==run.identity.model||request.state!==input.text||!object(request.questions)
    ||!equal(Object.keys(request.questions).sort(),[...input.question_keys].sort())
    ||!equal(Object.keys(input.question_digests).sort(),[...input.question_keys].sort())
    ||Object.values(input.question_digests).some(d=>typeof d!=='string'||!hash.test(d))
    ||Object.keys(input.scope_basis).some(k=>!input.question_keys.includes(k))||Object.values(input.scope_basis).some(v=>typeof v!=='string'))return null;
   map??=input.map_id;if(map!==input.map_id)return null;
   for(const key of input.question_keys){const value=request.questions[key],bytes=JSON.stringify(value);
    if(wireBytes.has(key)&&wireBytes.get(key)!==bytes)return null;
    wireBytes.set(key,bytes);questions[key]=value;
   }
   ids.add(proposal.custom_id);roots.add(input.root_id);
   rows.push({proposal,fingerprint:fingerprint(proposal),shape:shapes.shape(input),request_bytes:Buffer.byteLength(JSON.stringify(request)),
    value:{custom_id:proposal.custom_id,request_digest:proposal.request_digest,inputs:proposal.inputs,question_keys:[...input.question_keys],reserved_micro_usd:proposal.reserved_micro_usd,retry_depth:0}});
  }
  return{run_id:run.id,workspace_id:run.workspace_id,configuration_digest:state.configuration_digest,model:run.identity.model,questions,rows};
 }catch{return null;}
}

export const NATIVE_LISTENING_COVERED_PROFILES_SQL_V1=`/* labeling_native_covered_profiles_v1 */
 SELECT DISTINCT ON(profile#>>'{scope,shape_digest}') profile FROM signal_listening_calibrations
 WHERE workspace_id=$1 AND profile#>>'{scope,configuration_digest}'=$2 AND profile#>>'{scope,model}'=$3
  AND profile#>>'{scope,shape_digest}'=ANY($4::text[]) AND source_run_id=$5::uuid
 ORDER BY profile#>>'{scope,shape_digest}',created_at DESC,id DESC`;

export function nativeListeningAdmissionCoveredV1<Input extends FacetInput>(plan:NativeListeningAdmissionPacketV1<Input>,profiles:unknown[]):boolean{
 return plan.rows.every(row=>profiles.some(value=>{
  if(!object(value)||!object(value.scope)||value.status!=='measured'||value.sample_count!==32||!Array.isArray(value.source_call_ids)
   ||value.source_call_ids.length!==32||new Set(value.source_call_ids).size!==32||value.source_call_ids.some(id=>typeof id!=='string'||!uuid.test(id))
   ||value.source_run_id!==plan.run_id||typeof value.source_digest!=='string'||!hash.test(value.source_digest)
   ||typeof value.scope_digest!=='string'||!hash.test(value.scope_digest)||typeof value.max_input_tokens_per_byte!=='number'
   ||!Number.isFinite(value.max_input_tokens_per_byte)||value.max_input_tokens_per_byte<=0
   ||typeof value.request_min_bytes!=='number'||typeof value.request_max_bytes!=='number'
   ||!Number.isSafeInteger(value.request_min_bytes)||!Number.isSafeInteger(value.request_max_bytes))return false;
  const scope=value.scope;
  return scope.workspace_id===plan.workspace_id&&scope.configuration_digest===plan.configuration_digest&&scope.model===plan.model
   &&scope.compiler_version==='listening-jev-v1'&&scope.shape_digest===row.shape.shape_digest&&scope.phase===row.shape.phase
   &&Number(value.request_min_bytes)>0&&Number(value.request_min_bytes)<=row.request_bytes&&Number(value.request_max_bytes)>=row.request_bytes;
 }));
}

export function validateNativeListeningAdmissionSelectionV1<Input extends FacetInput>(plan:NativeListeningAdmissionPacketV1<Input>,selected:ReadonlyArray<LabelingCallProposalV1<Input>>):void{
 if(!Array.isArray(selected)||selected.length>plan.rows.length||selected.some((p,i)=>p!==plan.rows[i]!.proposal||fingerprint(p)!==plan.rows[i]!.fingerprint))
  throw Error('labeling_admission_selection_invalid');
}
export function nativeListeningAdmissionPacketBodyV1<Input extends FacetInput>(plan:NativeListeningAdmissionPacketV1<Input>,selected:ReadonlyArray<LabelingCallProposalV1<Input>>):string{
 validateNativeListeningAdmissionSelectionV1(plan,selected);
 return JSON.stringify({model:plan.model,questions:plan.questions,rows:plan.rows.slice(0,selected.length).map(row=>row.value)});
}

/** Two ordinary DML commands retain the installed BEFORE ROW and independent
 * E statement guards. Packet data is reconstituted; no authorization marker. */
export const NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1=`/* labeling_native_covered_insert_v1 */
 WITH packet AS MATERIALIZED(SELECT $6::jsonb payload)
 INSERT INTO signal_labeling_calls(run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,reserved_micro_usd,retry_depth,budget_date,budget_timezone)
 SELECT $1,$2,$3,$4,$5,x.custom_id,x.request_digest,
  jsonb_build_object('model',packet.payload->'model','state',x.inputs->0->'text','questions',
   (SELECT jsonb_object_agg(keys.key,packet.payload->'questions'->keys.key) FROM jsonb_array_elements_text(x.question_keys) keys(key))),
  x.inputs,x.reserved_micro_usd,x.retry_depth,$7::date,$8
 FROM packet CROSS JOIN LATERAL jsonb_to_recordset(packet.payload->'rows') x(custom_id text,request_digest text,inputs jsonb,question_keys jsonb,reserved_micro_usd bigint,retry_depth integer)
 ON CONFLICT(custom_id) DO NOTHING RETURNING *`;
export const NATIVE_LISTENING_ADMISSION_MARK_SQL_V1=`/* labeling_native_covered_mark_v1 */
 UPDATE signal_labeling_calls SET status='submitting',updated_at=now()
 WHERE run_id=$1 AND workspace_id=$2 AND id=ANY($3::uuid[]) AND status='reserved' RETURNING *`;

export function validateNativeListeningAdmissionRowsV1<Input extends FacetInput>(run:LabelingRunV1,selected:ReadonlyArray<LabelingCallProposalV1<Input>>,
 rows:ReadonlyArray<LabelingCallV1<Input>>,status:'reserved'|'submitting'):LabelingCallV1<Input>[] {
 if(rows.length!==selected.length||new Set(rows.map(r=>r.id)).size!==rows.length||new Set(rows.map(r=>r.custom_id)).size!==rows.length)
  throw Error('labeling_admission_return_invalid');
 const ordered=selected.map(proposal=>{
  const row=rows.find(r=>r.custom_id===proposal.custom_id) as (LabelingCallV1<Input>&Record<string,unknown>)|undefined;
  const nullFields=['request_storage_key','raw_body','raw_sha256','raw_storage_key','raw_size_bytes','raw_storage_verified_at','raw_storage_verified_key',
   'provider_batch_id','usage','results','settled_micro_usd','stop_reason','refusal_category'];
  if(!row||nullFields.some(key=>!Object.hasOwn(row,key)||row[key]!==null)||!Object.hasOwn(row,'terminal_exposure_micro_usd')
   ||!uuid.test(row.id)||row.run_id!==run.id||row.workspace_id!==run.workspace_id||row.provider!==run.identity.provider||row.model!==run.identity.model||row.transport!=='sync'
   ||row.status!==status||row.request_digest!==proposal.request_digest||Number(row.reserved_micro_usd)!==proposal.reserved_micro_usd||row.retry_depth!==(proposal.retry_depth??0)
   ||!equal(row.request,proposal.request)||!equal(row.inputs,proposal.inputs)||row.raw_body||row.raw_sha256||row.raw_storage_key||row.raw_size_bytes!==null&&row.raw_size_bytes!==undefined
   ||row.raw_page_id||row.has_raw||row.provider_batch_id||row.results_applied!==false||row.raw_storage_verified_at||row.raw_storage_verified_key
   ||row.usage||row.results||row.settled_micro_usd!==null&&row.settled_micro_usd!==undefined
   ||row.terminal_exposure_micro_usd!==0&&row.terminal_exposure_micro_usd!=='0')throw Error('labeling_admission_return_invalid');
  return row;
 });
 return ordered;
}
