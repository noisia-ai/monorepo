import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,buildSignalListeningJevRequestV1,
 signalListeningQuestionDigestV1,SIGNAL_LISTENING_REQUEST_VERSION_V1}
 from '../../../packages/query-engine/src/signal-listening-contracts.js';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '../../../packages/query-engine/src/signal-workspace-embeddings-v1.js';

// Experimental only: public protocol functions are never replaced.
export const candidateSql = `CREATE FUNCTION pg_temp.r16_json_flat_v1(value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $flat$
WITH RECURSIVE nodes(v,path,prefix) AS (
 SELECT value, ARRAY[]::bigint[], ''::text
 UNION ALL
 SELECT c.item, n.path || ARRAY[c.pos],
   CASE WHEN c.pos>1 THEN ',' ELSE '' END || c.edge
 FROM nodes n CROSS JOIN LATERAL (
   SELECT e.item, row_number() OVER (ORDER BY e.key COLLATE "C") AS pos,
     to_jsonb(e.key)::text || ':' AS edge
   FROM jsonb_each(CASE WHEN jsonb_typeof(n.v)='object' THEN n.v ELSE '{}'::jsonb END) e(key,item)
   UNION ALL
   SELECT e.item,e.pos,''::text
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.v)='array' THEN n.v ELSE '[]'::jsonb END)
     WITH ORDINALITY e(item,pos)
 ) c
), tokens AS (
 SELECT path || ARRAY[0::bigint] AS token_path, prefix || CASE jsonb_typeof(v)
   WHEN 'object' THEN '{' WHEN 'array' THEN '[' ELSE v::text END AS token FROM nodes
 UNION ALL
 SELECT path || ARRAY[9223372036854775807::bigint],
   CASE jsonb_typeof(v) WHEN 'object' THEN '}' ELSE ']' END
 FROM nodes WHERE jsonb_typeof(v) IN ('object','array')
)
SELECT string_agg(token,'' ORDER BY token_path) FROM tokens
$flat$`;

export function fixtures():Array<{id:string;json:string|null;deep:boolean}>{
 const result = [
  {id:'sql-null',json:null}, {id:'json-null',json:'null'},
  {id:'scalar-string',json:'"a\\b"'}, {id:'scalar-true',json:'true'}, {id:'scalar-false',json:'false'}, {id:'scalar-zero',json:'0'},
  {id:'empty-object',json:'{}'}, {id:'empty-array',json:'[]'},
  {id:'numeric-precision',json:'12345678901234567890.123456789012345678901'},
  {id:'numeric-exponent',json:'[-0,1e-12,1.2300,1e30]'},
  {id:'unicode-escapes',json:JSON.stringify({'é':'\\\n\t"','z':[], '😀':{},'a':'\u0001','é':null})},
  {id:'nested',json:'{"z":[null,true,false,{},[],{"b":2,"a":1}],"a":"x"}'},
  {id:'input-preimage',json:JSON.stringify({contract_version:'signal-listening-input-v1',root_id:'00000000-0000-4000-8000-000000000001',source_fingerprint:'synthetic',text:'cerveza sintética'})},
  {id:'base-request-preimage',json:JSON.stringify(listeningPreimage(0,'base'))},
  {id:'scope-preimage',json:'{"voice":"00000000-0000-4000-8000-000000000001","promotion":null}'},
 ];
 for(let i=0;i<32;i++)result.push({id:`warmup-large-${i}`,json:JSON.stringify(listeningPreimage(i))});
 return [...result.map(x=>({...x,deep:false})),... [64,256,1024].map(depth=>({id:`deep-${depth}`,json:'['.repeat(depth)+'0'+']'.repeat(depth),deep:true}))];
}
export function timedSql(arm:'old'|'candidate',single:boolean):string{
 const fn=arm==='old'?'public.signal_labeling_json_v1':'pg_temp.r16_json_flat_v1';
 // MATERIALIZED ensures exactly one function result per row; both arms consume it identically.
 return `WITH serialized AS MATERIALIZED (SELECT ${fn}(payload) AS value FROM pg_temp.r16_canonical_cases WHERE NOT deep ${single?'AND case_id=$1':''}) SELECT count(*)::int AS rows, sum(octet_length(value))::text AS bytes, encode(sha256(convert_to(string_agg(coalesce(value,'<SQLNULL>'),'|' ORDER BY value COLLATE "C"),'UTF8')),'hex') AS digest FROM serialized`;
}

/** Actual request compiler and version; synthetic input/context only. */
export function listeningPreimage(i:number,phase:'base'|'consumer'='consumer'){
 const base=signalListeningBaseTemplateV1({category:'cerveza',lexicon_terms:['cerveza','cerveja']});
 const config=validateSignalListeningConfigurationV1({...base,questions:[...base.questions,
  ...Array.from({length:16},(_,q)=>({key:`topic_${q}`,type:'noul' as const,text:`¿Se menciona el tema sintético ${q}?`,
   positive:`Tema sintético ${q}`,negative:'Otros temas',scope:'consumer_category' as const,origin:'brand_os' as const,human_locked:false}))]});
 const selected=config.questions.filter(q=>phase==='base'?q.scope==='all':q.scope==='consumer_category');
 const root_id=`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
 const input={root_id,input_digest:'sha256:'+'1'.repeat(64),text:`Texto sintético ${i} de cerveza. `.repeat(256),
  question_keys:selected.map(q=>q.key),question_digests:Object.fromEntries(selected.map(q=>[q.key,signalListeningQuestionDigestV1(config,q)])),
  scope_basis:Object.fromEntries(selected.filter(q=>q.scope==='consumer_category').map(q=>[q.key,digest({voice:'00000000-0000-4000-8000-000000000100',promotion:'00000000-0000-4000-8000-000000000101'})]))};
 const request=buildSignalListeningJevRequestV1(input,config);
 return {request_version:SIGNAL_LISTENING_REQUEST_VERSION_V1,run_id:'00000000-0000-4000-8000-000000000200',
  root_id,input_digest:input.input_digest,entity_context_digest:'sha256:'+'2'.repeat(64),question_digests:input.question_digests,
  scope_basis:input.scope_basis,request};
}
