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
// Exact reviewed linear-graph conditional, including BOTH legacy/survey branches.
// The actual candidate SQL is extracted below; frozen a883 remains independent.
export const projectionSurveyConditionalShaV1='286feb6391f173c80a079d3edfa339e5d981e4939fd437879f78f0c9cae2fe52';
// Independent exact Source1dd survey SQL, frozen before the linear graph.
export const projectionSurveyMetadataBeforeLinearV1="/* labeling_listening_input_metadata_v1 */ WITH candidates AS MATERIALIZED(\n   SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,p.body_octets::bigint text_bytes,octet_length(p.wire::text)::bigint wire_bytes,\n    (octet_length(p.question_key)+octet_length(p.question_digest)+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,\n    p.platform_octets::bigint platform_bytes\n   FROM signal_listening_wire_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing') p WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL\n  ), sent AS MATERIALIZED(\n   SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5 AND root_id=ANY($8::uuid[])\n  ), reservation_matches AS MATERIALIZED(\n   SELECT p.*,sent.root_id reserved_root_id FROM candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest\n  ), pending AS MATERIALIZED(\n   SELECT root_id,input_digest,question_key,question_digest,scope_basis,text_bytes,wire_bytes,question_metadata_bytes,platform_bytes,\n    row_number() OVER(PARTITION BY root_id ORDER BY question_key) n\n   FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest))\n   , root_metadata AS MATERIALIZED(\n    SELECT root_id,(4::bigint*(12*max(text_bytes)+2*sum(wire_bytes)+6*sum(question_metadata_bytes)+6*max(platform_bytes)+$7::bigint+2048)+8192)::text working_bytes\n    FROM pending WHERE n<=256 GROUP BY root_id ORDER BY root_id LIMIT $6\n   ) , survey_prefix AS MATERIALIZED(\n    SELECT root_id,working_bytes,sum(working_bytes::numeric) OVER(ORDER BY root_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cumulative_bytes FROM root_metadata\n   ),survey_fitting AS MATERIALIZED(SELECT root_id FROM survey_prefix WHERE cumulative_bytes<=$9::numeric),survey_projection AS MATERIALIZED(\n    SELECT pending.root_id,input_digest,array_agg(question_key ORDER BY question_key) question_keys,\n     jsonb_object_agg(question_key,question_digest) question_digests,\n     COALESCE(jsonb_object_agg(question_key,scope_basis) FILTER(WHERE scope_basis IS NOT NULL),'{}'::jsonb) scope_basis\n    FROM pending JOIN survey_fitting fitting ON fitting.root_id=pending.root_id WHERE n<=256 GROUP BY pending.root_id,input_digest),survey_state_bytes AS MATERIALIZED(\n    SELECT metadata.root_id,CASE WHEN fitting.root_id IS NOT NULL THEN octet_length(to_json(item.text)::text)::text END state_json_bytes\n    FROM root_metadata metadata JOIN signal_mass_labeling_items item ON item.root_id=metadata.root_id AND item.workspace_id=$1 AND item.map_id=$3\n    LEFT JOIN survey_fitting fitting ON fitting.root_id=metadata.root_id)\n    SELECT metadata.root_id,metadata.working_bytes,encoded.state_json_bytes,CASE WHEN projection.root_id IS NOT NULL THEN\n     jsonb_build_object('input_digest',projection.input_digest,'question_keys',projection.question_keys,\n     'question_digests',projection.question_digests,'scope_basis',projection.scope_basis) END projection\n    FROM root_metadata metadata LEFT JOIN survey_projection projection ON projection.root_id=metadata.root_id\n    JOIN survey_state_bytes encoded ON encoded.root_id=metadata.root_id ORDER BY metadata.root_id";
export const projectionSurveyBeforeLinearRawShaV1='275ecac70aae04661a936a7c152c59a530ddb831ac1fb3ace81197d005f64758';
export const projectionSurveyConditionalBeforeLinearShaV1='4c14b89470b35063ebaae014a5562d470076cb6552292f581a82a7c89a861d0b';
export function projectionHelperPartsV1(source:string,selection:'legacy'|'survey'='legacy'){
 const start=source.indexOf('async function inputProjectionMetadata('),end=source.indexOf('\nasync function inputs(',start);
 assert.ok(start>=0&&end>start);const helper=source.slice(start,end);
 const markers=[...helper.matchAll(/c\.query<ListeningInputProjectionRowV1(?:&\{state_json_bytes\?:string\})?>\(`/gu)];
 assert.equal(markers.length,1,'one exact legacy/survey projection query marker is required');const marker=markers[0]!;
 const begin=marker.index!+marker[0].length;
 const finish=helper.indexOf('`,\n   [run.workspace_id',begin);assert.ok(finish>begin,'projection SQL must end at its actual bind list');
 const template=helper.slice(begin,finish),surveyStart='${selection.survey?`';let sql=template;
 const at=template.indexOf(surveyStart);
 if(at>=0){
  assert.ok(marker[0].includes('&{state_json_bytes?:string}'),'survey template must use its exact reviewed row type');
  assert.equal(template.split(surveyStart).length,2,'one explicit survey selection is required');
  const stop=template.indexOf('`}',at);assert.ok(stop>at);
  const conditional=template.slice(at,stop+2);assert.equal(projectionShaV1(conditional),projectionSurveyConditionalShaV1,'both reviewed projection branches must remain byte-exact');
  const branches=conditional.slice(surveyStart.length,-2).split('`:`');assert.equal(branches.length,2);
  sql=template.replace(conditional,branches[selection==='survey'?0:1]!);
 }else{
  assert.equal(selection,'legacy','historical source has no survey SQL branch');
  assert.equal(marker[0],'c.query<ListeningInputProjectionRowV1>(`','historical row type must remain exact');
 }
 for(const [needle,value]of [['${unresolvedScope}',"p.candidate AND p.scope_state='included' AND p.answer IS NULL"],
  ['${noHumanDecision}',"NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest)"]]as const){
  assert.equal(sql.split(needle).length,2,'one exact known interpolation is required');sql=sql.replace(needle,value);
 }
 assert.ok(!sql.includes('${'),'unknown interpolation must be reviewed explicitly');
 return{prefix:source.slice(0,start),suffix:source.slice(end),helperOutsideSql:helper.slice(0,begin)+'<SQL>'+helper.slice(finish),sql};
}
export async function candidateProjectionMetadataSqlV1(selection:'legacy'|'survey'='legacy'){
 return projectionHelperPartsV1(await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),selection).sql;
}
/** Survey adds one byte-count column. Its original metadata is compared to
 * the independent frozen-a883 result; the extra value is recomputed from the
 * owned fixture's source text in this same RR/RO, never from candidate rows. */
export async function compareProjectionSurveyOnClientV1(c:PoolClient,params:unknown[],previous:ListeningInputProjectionRowV1[]){
 const identity=async()=>(await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly,pg_backend_pid() pid,pg_current_snapshot()::text snapshot")).rows[0];
 const anchor=await identity();assert.equal(anchor.isolation,'repeatable read');assert.equal(anchor.readonly,'on');
 const rows=(await c.query<ListeningInputProjectionRowV1&{state_json_bytes:string|null}>(await candidateProjectionMetadataSqlV1('survey'),params)).rows;
 assert.equal(projectionShaV1(projectionSurveyMetadataBeforeLinearV1),projectionSurveyBeforeLinearRawShaV1);
 const beforeLinear=(await c.query(projectionSurveyMetadataBeforeLinearV1,params)).rows;
 assert.deepEqual(rows,beforeLinear,'complete actual survey rows equal independent Source1dd including exact state bytes and NULL sentinels');
 assert.deepEqual(await identity(),anchor,'old/new survey SQL uses the same actual RR/RO client');
 assert.deepEqual(rows.map(({state_json_bytes,...row})=>row),previous,'actual survey metadata equals independent frozen a883 roots/weights/projection/order/null sentinels');
 const source=(await c.query<{root_id:string;state_json_bytes:string}>(`SELECT root_id,octet_length(to_json(text)::text)::text state_json_bytes
  FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 AND root_id=ANY($3::uuid[])`,[params[0],params[2],previous.map(row=>row.root_id)])).rows;
 const bytes=new Map(source.map(row=>[row.root_id,row.state_json_bytes]));
 for(const row of rows){
  if(row.projection===null)assert.equal(row.state_json_bytes,null,'an oversize sentinel never gains encoded state');
  else{assert.ok(bytes.has(row.root_id));assert.equal(row.state_json_bytes,bytes.get(row.root_id),'fresh PG JSON state octets equal the independent owned source text');}
 }
 assert.deepEqual(await identity(),anchor,'survey and its old/source oracles share one RR/RO snapshot');
}
export type ProjectionLinearJoinsOracleCountersV1={metadata:number;hydrated:number;sentinel:number};
export type ProjectionLinearJoinsOracleContextV1={params?:unknown[];previous?:ListeningInputProjectionRowV1[]};
export async function compareProjectionLinearJoinsOnClientV1(c:PoolClient,sql:string,params:unknown[]|undefined,result:QueryResult,
 context:ProjectionLinearJoinsOracleContextV1,counters:ProjectionLinearJoinsOracleCountersV1){
 if(sql.startsWith('/* labeling_listening_input_metadata_v1 */')&&params?.length===9){
  assert.deepEqual((await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly")).rows[0],{isolation:'repeatable read',readonly:'on'});
  const previous=(await c.query<ListeningInputProjectionRowV1>(projectionMetadataBeforeLinearJoinsV1,params)).rows;
  assert.deepEqual(result.rows,previous,'ordered root IDs, exact weights, NULL sentinels and complete projections equal frozen a883 in SAME RR/RO');
  await compareProjectionSurveyOnClientV1(c,params,previous);
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
/** These four materialized scans must execute once, not once per root.
 * Indexed item probes may execute per OUTPUT row, including repeated digest
 * identities; their work is proportional to the preserved output bag. */
export function assertProjectionSurveyLinearPlanV1(plan:ProjectionPlanV1){
 const nodes=planNodes(plan),scans:Record<string,ProjectionPlanV1[]>={},barriers:Record<string,ProjectionPlanV1>={};
 for(const name of ['survey_fitting','survey_projection','survey_projection_rows','survey_state_bytes']){
  const found=nodes.filter(node=>node['Node Type']==='CTE Scan'&&node['CTE Name']===name);
  assert.equal(found.length,1,`exactly one ${name} focal scan`);
  assert.ok(found.every(node=>typeof node['Actual Loops']==='number'&&node['Actual Loops']>=0&&node['Actual Loops']<=1),`${name} is not rescanned per outer row`);scans[name]=found;
 }
 for(const name of ['survey_fit_matches','survey_projection_rows']){
  const found=nodes.filter(node=>node['Subplan Name']==='CTE '+name);assert.equal(found.length,1,`${name} has an actual materialization plan`);const node=found[0]!;
  assert.equal(node['Join Type'],'Full');assert.ok(['Hash Join','Merge Join'].includes(String(node['Node Type'])),'FULL survey barrier must use hash/merge');
  assert.ok(typeof node['Actual Loops']==='number'&&node['Actual Loops']>=0&&node['Actual Loops']<=1,`${name} executes at most once`);barriers[name]=node;
 }
 for(const node of nodes.filter(node=>node['Node Type']==='CTE Scan'&&['pending','survey_prefix','survey_fit_matches'].includes(String(node['CTE Name']))))
  assert.ok(typeof node['Actual Loops']==='number'&&node['Actual Loops']>=0&&node['Actual Loops']<=1,'upstream materialized survey sets are never rescanned per root');
 return{scans,barriers};
}
export async function runProjectionSurveyLinearPair4096V1(c:PoolClient,params:unknown[]){
 assert.equal(params.length,9);assert.ok(Array.isArray(params[7])&&params[7].length===4096);
 assert.equal(projectionShaV1(projectionSurveyMetadataBeforeLinearV1),projectionSurveyBeforeLinearRawShaV1,'BEFORE is the independent literal Source1dd query');
 const identity=async()=>(await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly,pg_backend_pid() pid,pg_current_snapshot()::text snapshot")).rows[0];
 const anchor=await identity();assert.equal(anchor.isolation,'repeatable read');assert.equal(anchor.readonly,'on');
 const after=await candidateProjectionMetadataSqlV1('survey'),queries={before:projectionSurveyMetadataBeforeLinearV1,after};
 const timings:Array<{arm:string;wall_ms:number;rows:number;metadata_sha256:string}>=[];
 let reference:Array<ListeningInputProjectionRowV1&{state_json_bytes:string|null}>|undefined;
 for(const arm of ['before','after','after','before']as const){
  const start=process.hrtime.bigint(),rows=(await c.query<ListeningInputProjectionRowV1&{state_json_bytes:string|null}>(queries[arm],params)).rows,wall_ms=Number(process.hrtime.bigint()-start)/1e6;
  if(reference===undefined)reference=rows;else assert.deepEqual(rows,reference,'survey ABBA complete ordered metadata equals exact frozen Source1dd in SAME RR/RO');
  assert.deepEqual(await identity(),anchor);timings.push({arm,wall_ms,rows:rows.length,metadata_sha256:projectionShaV1(JSON.stringify(rows))});
 }
 const plans:Record<string,unknown>={};for(const arm of ['before','after']as const){
  const result=await c.query('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+queries[arm],params),root=result.rows[0]['QUERY PLAN'][0];
  const sanitized=sanitizeProjectionLinearPlanV1(root.Plan);if(arm==='after')assertProjectionSurveyLinearPlanV1(sanitized);
  plans[arm]={planning_ms:root['Planning Time']??null,execution_ms:root['Execution Time']??null,plan:sanitized};assert.deepEqual(await identity(),anchor);
 }
 assert.ok(reference);assert.equal(reference.length,4096);
 return{contract:'r16-survey-linear-graph-pair4096-v1',before_raw_sha256:projectionSurveyBeforeLinearRawShaV1,after_raw_sha256:projectionShaV1(after),
  snapshot_sha256:projectionShaV1(String(anchor.snapshot)),selected_id_count:4096,output_count:reference.length,
  complete_metadata_sha256:projectionShaV1(JSON.stringify(reference)),timings,plans,equal:true,capacity_claim:false,gain_claim:false};
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
 await compareProjectionSurveyOnClientV1(c,params,rows);assert.deepEqual(await identity(),anchor);
 const survey_pair=await runProjectionSurveyLinearPair4096V1(c,params);assert.deepEqual(await identity(),anchor);
 return{survey_pair,contract:'r16-projection-linear-joins-pair4096-v1',before_raw_sha256:projectionBeforeRawSha256V1,after_raw_sha256:projectionShaV1(after),
  snapshot_sha256:projectionShaV1(String(anchor.snapshot)),selected_id_count:4096,output_count:rows.length,
  identity_weights_sha256:projectionShaV1(JSON.stringify(rows.map(r=>[r.root_id,r.working_bytes]))),timings,plans,equal:true,capacity_claim:false,gain_claim:false};
}
