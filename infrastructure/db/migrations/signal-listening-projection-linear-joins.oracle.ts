import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PoolClient,QueryResult} from 'pg';
import type {ListeningInputProjectionRowV1} from '../signal-listening-input-projection';
import {hydrateListeningInputProjectionV1} from '../signal-listening-input-projection';
import {selectLabelingInputPrefixV1,type LabelingInputBoundsV1} from '../signal-labeling-input-bounds';
// Frozen a883 source, with its two literal interpolations expanded. This oracle
// never derives the previous SQL from the candidate or registers/runs a test.
export const projectionMetadataBeforeLinearJoinsV1="/* labeling_listening_input_metadata_v1 */ WITH candidates AS MATERIALIZED(\n   SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,octet_length(p.body)::bigint text_bytes,octet_length(p.wire::text)::bigint wire_bytes,\n    (octet_length(p.question_key)+octet_length(p.question_digest)+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,\n    octet_length(COALESCE(p.platform,''))::bigint platform_bytes\n   FROM signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing') p WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL\n  ), sent AS MATERIALIZED(\n   SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5 AND root_id=ANY($8::uuid[])\n  ), reservation_matches AS MATERIALIZED(\n   SELECT p.*,sent.root_id reserved_root_id FROM candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest\n  ), pending AS MATERIALIZED(\n   SELECT root_id,input_digest,question_key,question_digest,scope_basis,text_bytes,wire_bytes,question_metadata_bytes,platform_bytes,\n    row_number() OVER(PARTITION BY root_id ORDER BY question_key) n\n   FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest))\n   , root_metadata AS MATERIALIZED(\n    SELECT root_id,(4::bigint*(12*max(text_bytes)+2*sum(wire_bytes)+6*sum(question_metadata_bytes)+6*max(platform_bytes)+$7::bigint+2048)+8192)::text working_bytes\n    FROM pending WHERE n<=256 GROUP BY root_id ORDER BY root_id LIMIT $6\n   ), prefix AS MATERIALIZED(\n    SELECT root_id,working_bytes,sum(working_bytes::numeric) OVER(ORDER BY root_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cumulative_bytes\n    FROM root_metadata\n   ), fitting AS MATERIALIZED(SELECT root_id FROM prefix WHERE cumulative_bytes<=$9::numeric),\n   projections AS MATERIALIZED(\n    SELECT p.root_id,p.input_digest,array_agg(p.question_key ORDER BY p.question_key) question_keys,\n     jsonb_object_agg(p.question_key,p.question_digest) question_digests,\n     COALESCE(jsonb_object_agg(p.question_key,p.scope_basis) FILTER(WHERE p.scope_basis IS NOT NULL),'{}'::jsonb) scope_basis\n    FROM pending p JOIN fitting ON fitting.root_id=p.root_id WHERE p.n<=256 GROUP BY p.root_id,p.input_digest\n   )\n   SELECT prefix.root_id,prefix.working_bytes,CASE WHEN projections.root_id IS NOT NULL THEN\n    jsonb_build_object('input_digest',projections.input_digest,'question_keys',projections.question_keys,\n      'question_digests',projections.question_digests,'scope_basis',projections.scope_basis) END projection\n   FROM prefix LEFT JOIN projections ON projections.root_id=prefix.root_id ORDER BY prefix.root_id";
export const projectionBeforeRawSha256V1="98e48b429e436d984b3e3825bb280184aa199ef3dc18ff082931430a469983c5";
export const projectionBeforeNormalizedSha256V1='623ea62b8c7f51acab4551632bfd2518d58ed70cce110afce59914d175981bd3';
export const unchangedSourcePartsV1={
  "prefix": "c8a4da960c1fa89faae7830f62c61be8a0c1d8a76ba2b6cb3b9db2876ae15952",
  "suffix": "2b40b54fbf5c98ecd175ab854195b381e3aa5c101d3cf6ba848580e80e9d8de7",
  "helperOutsideSql": "4f23f040020672e72b3dc4105b56fd08f79bd237499412d7273c48a1302574fb"
};
export const projectionShaV1=(s:string)=>createHash('sha256').update(s).digest('hex');
export function projectionHelperPartsV1(source:string){
 const start=source.indexOf('async function inputProjectionMetadata('),end=source.indexOf('\nasync function inputs(',start);
 assert.ok(start>=0&&end>start);const helper=source.slice(start,end);
 const begin=helper.indexOf('c.query<ListeningInputProjectionRowV1>(`')+'c.query<ListeningInputProjectionRowV1>(`'.length;
 const finish=helper.indexOf('`,\n   [run.workspace_id',begin);assert.ok(begin>0&&finish>begin);
 const template=helper.slice(begin,finish),sql=template.replace('${unresolvedScope}',"p.candidate AND p.scope_state='included' AND p.answer IS NULL")
  .replace('${noHumanDecision}',"NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)");
 assert.ok(!sql.includes('${'),'unknown interpolation must be reviewed explicitly');
 return{prefix:source.slice(0,start),suffix:source.slice(end),helperOutsideSql:helper.slice(0,begin)+'<SQL>'+helper.slice(finish),sql};
}
export async function candidateProjectionMetadataSqlV1(){return projectionHelperPartsV1(await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8')).sql;}
export type ProjectionLinearJoinsOracleCountersV1={metadata:number;hydrated:number;sentinel:number};
export type ProjectionLinearJoinsOracleContextV1={params?:unknown[];previous?:ListeningInputProjectionRowV1[]};
export async function compareProjectionLinearJoinsOnClientV1(c:PoolClient,sql:string,params:unknown[]|undefined,result:QueryResult,
 context:ProjectionLinearJoinsOracleContextV1,counters:ProjectionLinearJoinsOracleCountersV1){
 if(sql.startsWith('/* labeling_listening_input_metadata_v1 */')&&params?.length===9){
  assert.deepEqual((await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0],{isolation:'repeatable read',readonly:'on'});
  const previous=(await c.query<ListeningInputProjectionRowV1>(projectionMetadataBeforeLinearJoinsV1,params)).rows;
  assert.deepEqual(result.rows,previous,'ordered root IDs, exact weights, NULL sentinels and complete projections equal frozen a883 in SAME RR/RO');
  context.params??=[...params];context.previous=[...(context.previous??[]),...previous];counters.metadata++;
  counters.sentinel+=result.rows.filter(r=>r.projection===null).length;
  return;
 }
 if(sql.startsWith('/* labeling_listening_input_body_v1 */')){
  assert.ok(context.params&&context.previous);assert.ok(params);
  const rows=context.previous,bounds:LabelingInputBoundsV1={max_rows:Number(context.params[5]),max_working_bytes:Number(context.params[8])};
  const selected=selectLabelingInputPrefixV1(rows,bounds);assert.deepEqual(params[2],selected,'body IDs follow the original canonical contiguous prefix across every metadata page');
  const oldBody=await c.query(sql,[params[0],params[1],selected]);assert.deepEqual(result.rows,oldBody.rows,'all source body fields equal the old selected prefix');
  // Feed the old complete projection to the unchanged hydrator on this SAME
  // connection. No function redefinition, copied authority, or second snapshot.
  const oldInputs=await hydrateListeningInputProjectionV1(c,{workspace_id:String(context.params[0]),map_id:String(context.params[2]),configuration_digest:'oracle'},rows,bounds);
  const currentInputs=await hydrateListeningInputProjectionV1(c,{workspace_id:String(context.params[0]),map_id:String(context.params[2]),configuration_digest:'oracle'},result.rows.map(body=>{
   const metadata=rows.find(r=>r.root_id===body.root_id);assert.ok(metadata);return metadata;
  }),bounds);
  assert.deepEqual(currentInputs,oldInputs,'hydrated prefix including Unicode/body/DTO date equals original metadata');
  const json=`SELECT to_jsonb(body) value FROM (${sql}) body`;
  const fullPrecision=(await c.query(json,params)).rows;
  const originalPrecision=(await c.query(json,[params[0],params[1],selected])).rows;
  assert.deepEqual(fullPrecision,originalPrecision,'native source timestamp microseconds and source fields preserved');
  counters.hydrated++;
 }
}

export type ProjectionPlanV1={Plans?:ProjectionPlanV1[];[key:string]:unknown};
const planFields=new Set(['Node Type','Join Type','Relation Name','Index Name','CTE Name','Subplan Name','Plan Rows','Plan Width','Startup Cost','Total Cost','Actual Rows','Actual Loops','Shared Hit Blocks','Shared Read Blocks','Temp Read Blocks','Temp Written Blocks','Sort Method','Sort Space Used','Sort Space Type','Hash Batches','Peak Memory Usage']);
export function sanitizeProjectionLinearPlanV1(node:ProjectionPlanV1):ProjectionPlanV1{
 const clean:ProjectionPlanV1={};for(const [key,value]of Object.entries(node)){
  if(planFields.has(key)&&['string','number','boolean'].includes(typeof value))clean[key]=value;
  else if(key==='Plans'&&Array.isArray(value))clean.Plans=value.map(sanitizeProjectionLinearPlanV1);
 }return clean;
}
function planNodes(plan:ProjectionPlanV1):ProjectionPlanV1[]{return[plan,...(plan.Plans??[]).flatMap(planNodes)];}
export function assertProjectionLinearPlanV1(plan:ProjectionPlanV1){
 const nodes=planNodes(plan),scans:Record<string,ProjectionPlanV1[]>={},barriers:Record<string,ProjectionPlanV1>={};
 for(const name of ['fitting','projections']){
  const found=nodes.filter(n=>n['Node Type']==='CTE Scan'&&n['CTE Name']===name);assert.equal(found.length,1,`exactly one ${name} focal scan`);
  assert.ok(found.every(n=>typeof n['Actual Loops']==='number'&&n['Actual Loops']>=0&&n['Actual Loops']<=1),`${name} is not rescanned per outer row`);scans[name]=found;
 }
 for(const name of ['fit_matches','projection_rows']){
  const found=nodes.filter(n=>n['Subplan Name']==='CTE '+name);assert.equal(found.length,1,`${name} materialization has an observed plan`);const node=found[0]!;
  assert.equal(node['Join Type'],'Full');assert.ok(['Hash Join','Merge Join'].includes(String(node['Node Type'])),'FULL barrier must use hash/merge');
  assert.ok(typeof node['Actual Loops']==='number'&&node['Actual Loops']>=0&&node['Actual Loops']<=1,`${name} executes at most once; zero is reported as zero`);barriers[name]=node;
 }
 return{scans,barriers};
}
export async function runProjectionLinearPair4096V1(c:PoolClient,params:unknown[]){
 assert.equal(params.length,9);assert.ok(Array.isArray(params[7])&&params[7].length===4096);
 const identity=async()=>(await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly,pg_backend_pid() pid,pg_current_snapshot()::text snapshot")).rows[0];
 const anchor=await identity();assert.equal(anchor.isolation,'repeatable read');assert.equal(anchor.readonly,'on');
 const after=await candidateProjectionMetadataSqlV1(),queries={before:projectionMetadataBeforeLinearJoinsV1,after};
 const timings:Array<{arm:string;wall_ms:number;rows:number;metadata_sha256:string}>=[];let reference:unknown;
 for(const arm of ['before','after','after','before'] as const){const start=process.hrtime.bigint(),rows=(await c.query(queries[arm],params)).rows,wall_ms=Number(process.hrtime.bigint()-start)/1e6;
  if(reference===undefined)reference=rows;else assert.deepEqual(rows,reference,'ABBA complete ordered metadata equal in SAME RR/RO');
  assert.deepEqual(await identity(),anchor);timings.push({arm,wall_ms,rows:rows.length,metadata_sha256:projectionShaV1(JSON.stringify(rows))});
 }
 const plans:Record<string,unknown>={};for(const arm of ['before','after'] as const){
  const result=await c.query('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+queries[arm],params),root=result.rows[0]['QUERY PLAN'][0];
  const sanitized=sanitizeProjectionLinearPlanV1(root.Plan);if(arm==='after')assertProjectionLinearPlanV1(sanitized);
  plans[arm]={planning_ms:root['Planning Time']??null,execution_ms:root['Execution Time']??null,plan:sanitized};assert.deepEqual(await identity(),anchor);
 }
 const rows=reference as ListeningInputProjectionRowV1[];
 return{contract:'r16-projection-linear-joins-pair4096-v1',before_raw_sha256:projectionBeforeRawSha256V1,after_raw_sha256:projectionShaV1(after),
  snapshot_sha256:projectionShaV1(String(anchor.snapshot)),selected_id_count:4096,output_count:rows.length,
  identity_weights_sha256:projectionShaV1(JSON.stringify(rows.map(r=>[r.root_id,r.working_bytes]))),timings,plans,equal:true,capacity_claim:false,gain_claim:false};
}
