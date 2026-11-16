import {buildSignalListeningCompiledRequestV1,compileSignalListeningSnapshotV1,signalListeningQuestionDigestV1,
 validateSignalListeningConfigurationV1,SIGNAL_LISTENING_REQUEST_VERSION_V1,type SignalListeningConfigurationV1} from '../../../packages/query-engine/src/signal-listening-contracts.js';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '../../../packages/query-engine/src/signal-workspace-embeddings-v1.js';
import {r16ListeningWorkloadV2} from '../../r16/listening-workload.js';

export const batchSizes=[32,264,1024,4096]as const;
export const phases=['base','consumer','mixed']as const;
export type Arm='old'|'candidate';
export type Fixture={id:string;json:string|null;configuration_id:string;phase:string;ordinal:number;timing:boolean};
const precision='1234567890.1234567890123456789';

// The only DDL candidate is private to this session. No protocol helper is replaced.
// `fragments` is a statement-local canonical compiler result, NOT an authority seal.
export const candidateSql=`CREATE FUNCTION pg_temp.r16_shared_wire_json_v1(payload jsonb,fragments jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $shared$
DECLARE questions text; request_value jsonb; actual_keys text[];
BEGIN
 IF payload IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RETURN public.signal_labeling_json_v1(payload); END IF;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO actual_keys FROM jsonb_object_keys(payload) key;
 IF actual_keys IS DISTINCT FROM ARRAY['entity_context_digest','input_digest','question_digests','request','request_version','root_id','run_id','scope_basis']::text[]
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['entity_context_digest','input_digest','request_version','root_id','run_id']) k
   WHERE jsonb_typeof(payload->k) IS DISTINCT FROM 'string')
 THEN RETURN public.signal_labeling_json_v1(payload); END IF;
 request_value:=payload->'request';
 IF jsonb_typeof(request_value) IS DISTINCT FROM 'object' THEN RETURN public.signal_labeling_json_v1(payload); END IF;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO actual_keys FROM jsonb_object_keys(request_value) key;
 IF actual_keys IS DISTINCT FROM ARRAY['model','questions','state']::text[]
  OR request_value->'model' IS DISTINCT FROM to_jsonb('jev-1.13.0'::text)
  OR jsonb_typeof(request_value->'state') IS DISTINCT FROM 'string'
  OR jsonb_typeof(request_value->'questions') IS DISTINCT FROM 'object'
 THEN RETURN public.signal_labeling_json_v1(payload); END IF;
 -- Inspect the final JSONB object, AFTER duplicate-key collapse. An absent or
 -- mismatched compiler wire falls back to the complete original canonicalizer.
 IF EXISTS(SELECT 1 FROM jsonb_each(request_value->'questions') q
   WHERE fragments->q.key->'wire' IS DISTINCT FROM q.value
    OR jsonb_typeof(fragments->q.key->'canonical') IS DISTINCT FROM 'string')
 THEN RETURN public.signal_labeling_json_v1(payload); END IF;
 SELECT '{'||COALESCE(string_agg(to_jsonb(q.key)::text||':'||(fragments->q.key->>'canonical'),',' ORDER BY q.key COLLATE "C"),'')||'}'
  INTO questions FROM jsonb_each(request_value->'questions') q;
 -- These are JSONB values, never text extracted/reparsed by JavaScript. UUID
 -- spelling, escaping, SQL/JSON NULL, arbitrary numeric precision and maps keep
 -- the original public serializer's semantics. The final SHA hashes ALL bytes.
 RETURN '{"entity_context_digest":'||(payload->'entity_context_digest')::text
  ||',"input_digest":'||(payload->'input_digest')::text
  ||',"question_digests":'||public.signal_labeling_json_v1(payload->'question_digests')
  ||',"request":{"model":'||(request_value->'model')::text||',"questions":'||questions||',"state":'||(request_value->'state')::text||'}'
  ||',"request_version":'||(payload->'request_version')::text
  ||',"root_id":'||(payload->'root_id')::text||',"run_id":'||(payload->'run_id')::text
  ||',"scope_basis":'||public.signal_labeling_json_v1(payload->'scope_basis')||'}';
END
$shared$`;

function compilationSql(arm:Arm){
 if(arm==='old')return '';
 return `, used_keys AS MATERIALIZED(
 SELECT DISTINCT i.configuration_id,q.key FROM input_rows i CROSS JOIN LATERAL jsonb_object_keys(
  CASE WHEN jsonb_typeof(i.payload#>'{request,questions}')='object' THEN i.payload#>'{request,questions}' ELSE '{}'::jsonb END) q(key)
 ), wires AS MATERIALIZED(
 SELECT u.configuration_id,u.key,c.wires->u.key wire FROM used_keys u
 JOIN pg_temp.r16_shared_wire_configurations c ON c.configuration_id=u.configuration_id WHERE c.wires ? u.key
 ), fragments AS MATERIALIZED(
 SELECT configuration_id,jsonb_object_agg(key,jsonb_build_object('wire',wire,'canonical',public.signal_labeling_json_v1(wire))) value
 FROM wires GROUP BY configuration_id
 )`;
}
function serializationSql(arm:Arm){
 return arm==='old'
  ? 'SELECT i.case_id,public.signal_labeling_json_v1(i.payload) canonical FROM input_rows i'
  : "SELECT i.case_id,pg_temp.r16_shared_wire_json_v1(i.payload,COALESCE(f.value,'{}'::jsonb)) canonical FROM input_rows i LEFT JOIN fragments f USING(configuration_id)";
}
/** Compilation is deliberately INSIDE every timed candidate statement. Both
 * arms read the same table Vars, produce one canonical value, hash every full
 * preimage, and consume its byte length and hash through the identical SELECT. */
export function batchSql(arm:Arm):string{
 return `WITH input_rows AS MATERIALIZED(
 SELECT case_id,payload,configuration_id FROM pg_temp.r16_shared_wire_cases
 WHERE timing AND (phase=$1 OR $1='mixed') ORDER BY ordinal,case_id LIMIT $2
 )${compilationSql(arm)}, serialized AS MATERIALIZED(${serializationSql(arm)}),
 consumed AS MATERIALIZED(SELECT case_id,octet_length(canonical) bytes,
  CASE WHEN canonical IS NULL THEN NULL ELSE 'sha256:'||encode(sha256(convert_to(canonical,'UTF8')),'hex') END digest FROM serialized)
 SELECT count(*)::int rows,sum(bytes)::text bytes,
  encode(sha256(convert_to(string_agg(COALESCE(digest,'<SQLNULL>'),'|' ORDER BY case_id COLLATE "C"),'UTF8')),'hex') digest FROM consumed`;
}
export function correctnessSql(arm:Arm):string{
 return `WITH input_rows AS MATERIALIZED(SELECT case_id,payload,configuration_id FROM pg_temp.r16_shared_wire_cases WHERE case_id=$1)
 ${compilationSql(arm)}, serialized AS MATERIALIZED(${serializationSql(arm)})
 SELECT encode(convert_to(canonical,'UTF8'),'hex') bytes,
  CASE WHEN canonical IS NULL THEN NULL ELSE 'sha256:'||encode(sha256(convert_to(canonical,'UTF8')),'hex') END digest
 FROM serialized`;
}

function configuration(unicode=false):SignalListeningConfigurationV1{
 const c=r16ListeningWorkloadV2('defined_consumer_second_pass').configuration;
 // Store the same canonical configuration the snapshot consumes. Its validator
 // trims boundaries; Unicode/quotes/control characters inside values survive.
 return unicode?validateSignalListeningConfigurationV1({...c,instructions:c.instructions+' Unicode: é é 😀 "quoted" \\ newline\n tab\t \u2028\u2029 inside \n',questions:c.questions.map(q=>({...q,text:q.text+' "á" 😀\n'}))}):c;
}
const compilers=new Map<boolean,ReturnType<typeof compileSignalListeningSnapshotV1>>();
/** The current production request compiler and the benchmark's actual base2 /
 * consumer2 configuration. There is no 16-question invented workload here. */
export function listeningPreimage(i:number,phase:'base'|'consumer'='consumer',unicode=false,subset=false){
 const c=configuration(unicode);let snapshot=compilers.get(unicode);
 if(!snapshot){snapshot=compileSignalListeningSnapshotV1(c);compilers.set(unicode,snapshot);}
 const selected=c.questions.filter(q=>phase==='base'?q.scope==='all':q.scope==='consumer_category').slice(0,subset?1:256);
 const root_id=`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
 const input={root_id,input_digest:'sha256:'+'1'.repeat(64),text:`Synthetic fixture consumer root ${i}: synthetic bicycle repairs. "Quote" \\ é é 😀\n`,
  question_keys:selected.map(q=>q.key),question_digests:Object.fromEntries(selected.map(q=>[q.key,signalListeningQuestionDigestV1(c,q)])),
  scope_basis:Object.fromEntries(selected.filter(q=>q.scope==='consumer_category').map(q=>[q.key,digest({voice:'00000000-0000-4000-8000-000000000100',promotion:'00000000-0000-4000-8000-000000000101'})]))};
 const request=buildSignalListeningCompiledRequestV1(input,snapshot);
 return {request_version:SIGNAL_LISTENING_REQUEST_VERSION_V1,run_id:'00000000-0000-4000-8000-000000000200',
  root_id,input_digest:input.input_digest,entity_context_digest:'sha256:'+'2'.repeat(64),question_digests:input.question_digests,scope_basis:input.scope_basis,request};
}
export function fixtureConfigurations(){
 const wires=(unicode:boolean)=>({...listeningPreimage(0,'base',unicode).request.questions,...listeningPreimage(0,'consumer',unicode).request.questions});
 const normal=wires(false),numeric=structuredClone(normal);
 // Native JSONB precision probe, NOT parsed by JavaScript or claimed as an
 // admitted Brand OS configuration. The public helper handles arbitrary wires.
 const key=Object.keys(numeric).sort()[0]!;
 const raw=JSON.stringify({...numeric,[key]:{...numeric[key],precision_probe:'PRECISION_SENTINEL'}}).replace('"PRECISION_SENTINEL"',precision);
 return [{id:'workload',json:JSON.stringify(normal),configuration_json:JSON.stringify(configuration(false))},
  {id:'unicode',json:JSON.stringify(wires(true)),configuration_json:JSON.stringify(configuration(true))},
  {id:'precision',json:raw,configuration_json:null}];
}
export function fixtures():Fixture[]{
 const base=listeningPreimage(0,'base'),consumer=listeningPreimage(1),raw=JSON.stringify(base);
 const out:Array<{id:string;json:string|null;configuration_id?:string}>=[
  {id:'base2',json:raw},{id:'consumer2',json:JSON.stringify(consumer)},
  {id:'heterogeneous-subset',json:JSON.stringify(listeningPreimage(2,'consumer',false,true))},
  {id:'unicode',json:JSON.stringify(listeningPreimage(3,'base',true)),configuration_id:'unicode'},
  {id:'sql-null',json:null},{id:'json-null',json:'null'},{id:'scalar',json:JSON.stringify('quoted " \\')},
  {id:'outside-array',json:'[null,true,false,{},[],12345678901234567890.123456789]'},
  {id:'outside-object',json:'{"z":1.2300,"a":[{},[],null,"é"]}'},
  {id:'missing-key',json:JSON.stringify(Object.fromEntries(Object.entries(base).filter(([k])=>k!=='scope_basis')))},
  {id:'extra-key',json:JSON.stringify({...base,unread:{high:'PRECISION_SENTINEL'}}).replace('"PRECISION_SENTINEL"',precision)},
  {id:'numeric-input-digest',json:raw.replace(JSON.stringify(base.input_digest),precision)},
  {id:'questions-null',json:JSON.stringify({...base,request:{...base.request,questions:null}})},
  {id:'request-null',json:JSON.stringify({...base,request:null})},
  {id:'null-maps',json:JSON.stringify({...base,question_digests:null,scope_basis:null})},
  {id:'precision-map',json:JSON.stringify({...base,question_digests:{precise:'PRECISION_SENTINEL'}}).replace('"PRECISION_SENTINEL"',precision)},
  {id:'wire-mismatch',json:JSON.stringify({...base,request:{...base.request,questions:{...base.request.questions,voice:{changed:'not compiler wire'}}}})},
  {id:'malformed-wire-array',json:JSON.stringify({...base,request:{...base.request,questions:{voice:[null,true,{}]}}})},
  {id:'request-extra-key',json:JSON.stringify({...base,request:{...base.request,extra:[null,{deep:true}]}})},
  {id:'no-configuration',json:raw,configuration_id:'absent'},
  {id:'empty-questions',json:JSON.stringify({...base,request:{...base.request,questions:{}}})},
  {id:'duplicate-keys',json:raw.replace('"request_version":','"root_id":"discarded duplicate","request_version":')},
  {id:'duplicate-question-keys',json:raw.replace('"questions":'+JSON.stringify(base.request.questions),
   '"questions":'+JSON.stringify(base.request.questions).replace('{','{"voice":null,'))},
  {id:'uppercase-root',json:JSON.stringify({...base,root_id:'ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF'})},
 ];
 const numeric=JSON.stringify({...consumer,request:{...consumer.request,questions:Object.fromEntries(Object.entries(consumer.request.questions).map(([k,v],i)=>[k,i===0?{...v,precision_probe:'PRECISION_SENTINEL'}:v]))}}).replace('"PRECISION_SENTINEL"',precision);
 out.push({id:'numeric-wire',json:numeric,configuration_id:'precision'});
 // Configuration-key ordering matches lexical sorting, so the first consumer
 // key is also the first key in the complete precision wire configuration.
 return out.map((x,ordinal)=>({...x,configuration_id:x.configuration_id??'workload',ordinal,phase:'correctness',timing:false}));
}
export function* timingFixtures():Generator<Fixture>{
 for(let i=0;i<4096;i++)for(const phase of ['base','consumer']as const)
  yield{id:`timing-${phase}-${i}`,json:JSON.stringify(listeningPreimage(i,phase)),configuration_id:'workload',phase,ordinal:i,timing:true};
}
