// Private, test-only candidate. No migration, provider call, authority cache, or product SQL substitution.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import type {SignalListeningInputV1} from '@noisia/query-engine';
import {hydrateListeningInputProjectionV1,type ListeningInputProjectionRowV1} from '../signal-listening-input-projection';
import {projectionHelperPartsV1,projectionShaV1,projectionSurveyMetadataBeforeLinearV1,
 sanitizeProjectionLinearPlanV1,assertProjectionSurveyLinearPlanV1,type ProjectionPlanV1} from './signal-listening-projection-linear-joins.oracle';
const Q8='52f0c342b256b1cbefd1fe1ee32d5832842a78be';
const sourceSha='97a7d61e77268524ba1f9d1557f54ffa0ba2dc9b154ab256ac683b81aa86a469';
const q8SqlSha='739613a2fceb44f3c00aa9b8b114efe3fd81a6bd76975841cc725773a2419e24';
const source1ddSqlSha='275ecac70aae04661a936a7c152c59a530ddb831ac1fb3ace81197d005f64758';
const candidateSqlSha='2556ffe0b03b891a1277ae35483369a4e0f26782b49eadfaeaf49bdba4a3ed07';
// Literal experimental fixture SQL. Key/digest use raw text octets, NOT JSON serialization.
const candidateSql=`/* labeling_listening_input_metadata_v1 */ WITH question_population AS MATERIALIZED(
   SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,p.body_octets,p.wire,p.platform_octets
   FROM signal_listening_wire_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$8::uuid[],'llm-processing') p WHERE p.candidate AND p.scope_state='included' AND p.answer IS NULL
  ), question_values AS MATERIALIZED(
   SELECT DISTINCT ON (question_key) question_key,question_digest,wire
   FROM question_population ORDER BY question_key
  ), question_bytes AS MATERIALIZED(
   SELECT question_key,octet_length(wire::text)::bigint wire_bytes,
    octet_length(question_key)+octet_length(question_digest) question_identity_bytes
   FROM question_values
  ), candidates AS MATERIALIZED(
   SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,p.body_octets::bigint text_bytes,q.wire_bytes,
    (q.question_identity_bytes+octet_length(COALESCE(p.scope_basis,'')))::bigint question_metadata_bytes,
    p.platform_octets::bigint platform_bytes
   FROM question_population p JOIN question_bytes q ON q.question_key=p.question_key  ), sent AS MATERIALIZED(
   SELECT root_id,question_digest FROM signal_listening_call_questions WHERE workspace_id=$1 AND run_id=$5 AND root_id=ANY($8::uuid[])
  ), reservation_matches AS MATERIALIZED(
   SELECT p.*,sent.root_id reserved_root_id FROM candidates p FULL JOIN sent ON sent.root_id=p.root_id AND sent.question_digest=p.question_digest
  ), pending AS MATERIALIZED(
   SELECT root_id,input_digest,question_key,question_digest,scope_basis,text_bytes,wire_bytes,question_metadata_bytes,platform_bytes,
    row_number() OVER(PARTITION BY root_id ORDER BY question_key) n
   FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL AND NOT signal_listening_human_decision_exists_v1($1::uuid,$2::uuid,$3::uuid,p.root_id,p.input_digest,$4::text,p.question_digest))
   , root_metadata AS MATERIALIZED(
    SELECT root_id,(4::bigint*(12*max(text_bytes)+2*sum(wire_bytes)+6*sum(question_metadata_bytes)+6*max(platform_bytes)+$7::bigint+2048)+8192)::text working_bytes
    FROM pending WHERE n<=256 GROUP BY root_id ORDER BY root_id LIMIT $6
   ) , survey_prefix AS MATERIALIZED(
    SELECT root_id,working_bytes,sum(working_bytes::numeric) OVER(ORDER BY root_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cumulative_bytes FROM root_metadata
   ),survey_fitting AS MATERIALIZED(SELECT root_id FROM survey_prefix WHERE cumulative_bytes<=$9::numeric),survey_fit_matches AS MATERIALIZED(
    SELECT p.root_id,p.input_digest,p.question_key,p.question_digest,p.scope_basis,p.n,fitting.root_id fitting_root_id
    FROM pending p FULL JOIN survey_fitting fitting ON fitting.root_id=p.root_id
   ),survey_projection AS MATERIALIZED(
    SELECT p.root_id,p.input_digest,array_agg(p.question_key ORDER BY p.question_key) question_keys,
     jsonb_object_agg(p.question_key,p.question_digest) question_digests,
     COALESCE(jsonb_object_agg(p.question_key,p.scope_basis) FILTER(WHERE p.scope_basis IS NOT NULL),'{}'::jsonb) scope_basis
    FROM survey_fit_matches p WHERE p.root_id IS NOT NULL AND p.fitting_root_id IS NOT NULL AND p.n<=256 GROUP BY p.root_id,p.input_digest
   ),survey_projection_rows AS MATERIALIZED(
    SELECT prefix.root_id,prefix.working_bytes,prefix.cumulative_bytes,projection.root_id projection_root_id,
     projection.input_digest,projection.question_keys,projection.question_digests,projection.scope_basis
    FROM survey_prefix prefix FULL JOIN survey_projection projection ON projection.root_id=prefix.root_id
   ),survey_state_bytes AS MATERIALIZED(
    SELECT metadata.root_id,metadata.working_bytes,metadata.projection_root_id,metadata.input_digest,
     metadata.question_keys,metadata.question_digests,metadata.scope_basis,
     CASE WHEN metadata.cumulative_bytes<=$9::numeric THEN octet_length(to_json(item.text)::text)::text END state_json_bytes
    FROM survey_projection_rows metadata JOIN signal_mass_labeling_items item ON item.root_id=metadata.root_id AND item.workspace_id=$1 AND item.map_id=$3
    WHERE metadata.root_id IS NOT NULL)
    SELECT root_id,working_bytes,state_json_bytes,CASE WHEN projection_root_id IS NOT NULL THEN
     jsonb_build_object('input_digest',input_digest,'question_keys',question_keys,
     'question_digests',question_digests,'scope_basis',scope_basis) END projection
    FROM survey_state_bytes ORDER BY root_id`;
type Metadata=ListeningInputProjectionRowV1&{state_json_bytes:string|null};
type ProbeArgs={sql:string;params:unknown[];actual:Metadata[];
 scope:{workspace_id:string;map_id:string;configuration_digest:string};expectedInputs:SignalListeningInputV1[]};
const nodes=(n:ProjectionPlanV1):ProjectionPlanV1[]=>[n,...(n.Plans??[]).flatMap(nodes)];
export async function runSurveyQuestionBytesExperimentV1(c:PoolClient,args:ProbeArgs){
 const {params}=args;assert.equal(params.length,9);assert.ok(Array.isArray(params[7])&&params[7].length===4096);
 const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
 assert.equal(projectionShaV1(source),sourceSha,'experiment accepts only original Q8 product source');
 const q8Sql=projectionHelperPartsV1(source,'survey').sql;
 assert.equal(projectionShaV1(q8Sql),q8SqlSha);assert.equal(args.sql,q8Sql,'actual Survey API remains Q8');
 assert.equal(projectionShaV1(projectionSurveyMetadataBeforeLinearV1),source1ddSqlSha,'original independent Source1dd literal stays unchanged');
 assert.equal(projectionShaV1(candidateSql),candidateSqlSha);
 const identity=async()=>(await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly,pg_backend_pid() pid,pg_current_snapshot()::text snapshot")).rows[0];
 const anchor=await identity();assert.equal(anchor.isolation,'repeatable read');assert.equal(anchor.readonly,'on');
 const sameSnapshot=async()=>assert.deepEqual(await identity(),anchor);
 const query=async(sql:string,bindings=params)=>{const rows=(await c.query<Metadata>(sql,bindings)).rows;await sameSnapshot();return rows;};
 // The unchanged test already compared args.actual with Source1dd on this client.
 // Repeat literally for this separately labelled receipt; never proxy or relabel its original pair.
 const original=await query(projectionSurveyMetadataBeforeLinearV1);assert.deepEqual(args.actual,original);
 const timings:Array<{arm:'Q8'|'candidate';wall_ms:number;rows:number;metadata_sha256:string}>=[];
 for(const arm of ['Q8','candidate','candidate','Q8']as const){
  const start=process.hrtime.bigint(),rows=(await c.query<Metadata>(arm==='Q8'?q8Sql:candidateSql,params)).rows;
  const wall_ms=Number(process.hrtime.bigint()-start)/1e6;
  assert.deepEqual(rows,args.actual,'all ordered metadata fields, weights, NULLs, and exact state bytes equal actual Q8');
  assert.equal(rows.length,4096);await sameSnapshot();
  timings.push({arm,wall_ms,rows:rows.length,metadata_sha256:projectionShaV1(JSON.stringify(rows))});
 }
 // Exercise non-fitting sentinels and the end of the global4096 prefix without changing fixtures.
 const total=args.actual.reduce((sum,row)=>sum+BigInt(row.working_bytes),0n);
 const prefixChecks:Array<{budget:string;rows:number;fitting:number;metadata_sha256:string}>=[];
 for(const budget of [...new Set(['1',(total-1n).toString(),total.toString()])]){
  const bindings=[...params];bindings[8]=budget;
  const before=await query(q8Sql,bindings),after=await query(candidateSql,bindings);
  assert.deepEqual(after,before,'contiguous prefix and NULL sentinels are exact');assert.equal(after.length,4096);
  prefixChecks.push({budget,rows:after.length,fitting:after.filter(row=>row.projection!==null).length,metadata_sha256:projectionShaV1(JSON.stringify(after))});
 }
 const experimental=await query(candidateSql);let unicodeInputs=0,nullFields=0;
 // Preserve body-hydration bounds and compare COMPLETE strict DTOs in the same snapshot.
 // target is the original client, so these experimental reads do not alter test counters.
 for(let offset=0;offset<args.actual.length;offset+=1024){
  const bounds={max_rows:1024,max_working_bytes:Number(params[8])};
  const before=await hydrateListeningInputProjectionV1(c,args.scope,args.actual.slice(offset,offset+1024),bounds);
  const after=await hydrateListeningInputProjectionV1(c,args.scope,experimental.slice(offset,offset+1024),bounds);
  assert.deepEqual(after,before);assert.deepEqual(after,args.expectedInputs.slice(offset,offset+1024));
  unicodeInputs+=after.filter(input=>/[^\u0000-\u007f]/u.test(input.text)).length;
  nullFields+=after.reduce((sum,input)=>sum+Object.values(input).filter(value=>value===null).length,0);
  await sameSnapshot();
 }
 const plans:Record<string,{sql_sha256:string;planning_ms:number|null;execution_ms:number|null;plan_sha256:string;plan:ProjectionPlanV1}>={};
 for(const [arm,sql]of [['Q8',q8Sql],['candidate',candidateSql]]as const){
  const root=(await c.query<{['QUERY PLAN']:Array<{Plan:ProjectionPlanV1;'Planning Time'?:number;'Execution Time'?:number}>}>(
   'EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+sql,params)).rows[0]!['QUERY PLAN'][0]!;
  const plan=sanitizeProjectionLinearPlanV1(root.Plan);assertProjectionSurveyLinearPlanV1(plan);
  plans[arm]={sql_sha256:projectionShaV1(sql),planning_ms:root['Planning Time']??null,execution_ms:root['Execution Time']??null,plan_sha256:projectionShaV1(JSON.stringify(plan)),plan};
  await sameSnapshot();
 }
 const candidateNodes=nodes(plans.candidate!.plan);
 const questionCounts=candidateNodes.filter(n=>['CTE question_population','CTE question_values','CTE question_bytes'].includes(String(n['Subplan Name'])))
  .map(n=>({cte:n['Subplan Name'],actual_rows:n['Actual Rows'],actual_loops:n['Actual Loops']}));
 const q8Mean=(timings[0]!.wall_ms+timings[3]!.wall_ms)/2,candidateMean=(timings[1]!.wall_ms+timings[2]!.wall_ms)/2;
 return{contract:'r16-survey-question-bytes-Q8-test-only-ABBA-v1',experimental:true,product_adopted:false,
  source_Q8:Q8,source_Q8_sha256:sourceSha,Q8_sql_sha256:q8SqlSha,original_Source1dd_sql_sha256:source1ddSqlSha,candidate_sql_sha256:candidateSqlSha,
  helper_sha256:projectionShaV1(await readFile(new URL('./signal-listening-survey-question-bytes.experimental.test-support.ts',import.meta.url),'utf8')),
  snapshot_sha256:projectionShaV1(String(anchor.snapshot)),selected_id_count:4096,output_count:args.actual.length,
  metadata_sha256:projectionShaV1(JSON.stringify(args.actual)),timings,prefixChecks,plans,questionCounts,
  buffer_scope:'per node; parent counters may include descendants; never sum nodes or categories',
  observed:{Q8_mean_ms:q8Mean,candidate_mean_ms:candidateMean,candidate_over_Q8:q8Mean>0?candidateMean/q8Mean:null,
   unicode_input_count:unicodeInputs,null_DTO_fields:nullFields,question_counts:[...new Set(args.actual.map(row=>row.projection?.question_keys.length??0))]},
  equal:true,capacity_claim:false,gain_claim:false,promotion_decision:'Root review after measurement'};
}

/** Reuse the original256/Unicode fixture and its already-open RR/RO client.
 * No timings or capacity inference from these small semantic edge checks. */
export async function compareSurveyQuestionBytesEdgeV1(c:PoolClient,params:unknown[],scope:ProbeArgs['scope'],expectedInputs:SignalListeningInputV1[]){
 const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');assert.equal(projectionShaV1(source),sourceSha);
 const q8Sql=projectionHelperPartsV1(source,'survey').sql;assert.equal(projectionShaV1(q8Sql),q8SqlSha);
 assert.equal(projectionShaV1(candidateSql),candidateSqlSha);assert.equal(projectionShaV1(projectionSurveyMetadataBeforeLinearV1),source1ddSqlSha);
 const identity=async()=>(await c.query("SELECT current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') readonly,pg_backend_pid() pid,pg_current_snapshot()::text snapshot")).rows[0];
 const anchor=await identity();assert.equal(anchor.isolation,'repeatable read');assert.equal(anchor.readonly,'on');
 const before=(await c.query<Metadata>(q8Sql,params)).rows,after=(await c.query<Metadata>(candidateSql,params)).rows;
 assert.deepEqual(before,(await c.query<Metadata>(projectionSurveyMetadataBeforeLinearV1,params)).rows);
 assert.deepEqual(after,before,'all256 metadata fields, row multiplicity, weight strings, ordering, NULLs and sentinels equal Q8 and original1dd');
 for(const row of after){assert.match(row.working_bytes,/^\d+$/u);assert.ok(BigInt(row.working_bytes)>0n);if(row.projection)assert.equal(row.projection.question_keys.length,256);}
 const bounds={max_rows:Number(params[5]),max_working_bytes:Number(params[8])};
 const beforeInputs=await hydrateListeningInputProjectionV1(c,scope,before,bounds),afterInputs=await hydrateListeningInputProjectionV1(c,scope,after,bounds);
 assert.deepEqual(afterInputs,beforeInputs,'complete strict256/Unicode DTOs remain exact in the same snapshot');
 const selected=new Set(afterInputs.map(input=>input.root_id));assert.deepEqual(afterInputs,expectedInputs.filter(input=>selected.has(input.root_id)));
 assert.ok(expectedInputs.some(input=>/[^\u0000-\u007f]/u.test(input.text)),'existing independent256 fixture really contains Unicode');
 assert.deepEqual(await identity(),anchor);
 return{contract:'r16-survey-question-bytes-Q8-test-only-256-edge-v1',experimental:true,product_adopted:false,
  Q8_sql_sha256:q8SqlSha,original_Source1dd_sql_sha256:source1ddSqlSha,candidate_sql_sha256:candidateSqlSha,
  metadata_sha256:projectionShaV1(JSON.stringify(after)),budget:String(params[8]),rows:after.length,
  fitting:afterInputs.length,null_sentinels:after.filter(row=>row.projection===null&&row.state_json_bytes===null).length,
  equal:true,gain_claim:false};
}
