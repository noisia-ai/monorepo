// Acceptance first; pure source/SQL checks, no database or local process.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {SURVEY_SCALAR_BEFORE_SQL_V1,SURVEY_SCALAR_BEFORE_RAW_SHA_V1,SURVEY_SCALAR_BEFORE_TEMPLATE_SHA_V1,
 SURVEY_SCALAR_BEFORE_PRODUCT_SHA_V1,surveyScalarShaV1,assertSurveyScalarWireSourceV1} from './signal-listening-survey-wire-scalars.test-support';
import {buildSurveyWireScalarCandidateV1,sanitizeSurveyScalarPlanV1,summarizeSurveyScalarAbbaV1,
 SURVEY_SCALAR_SEQUENCE_V1,type SurveyScalarSampleV1} from './signal-listening-survey-wire-scalars.oracle';

test('Survey scalar experiment pins independent Git353 and preserves every unknown SQL byte',async()=>{
 const before=SURVEY_SCALAR_BEFORE_SQL_V1;
 assert.equal(surveyScalarShaV1(before),SURVEY_SCALAR_BEFORE_RAW_SHA_V1);
 assert.equal(surveyScalarShaV1(before.replace(/\s+/gu,' ').trim()),SURVEY_SCALAR_BEFORE_TEMPLATE_SHA_V1);
 assert.equal(surveyScalarShaV1(await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8')),SURVEY_SCALAR_BEFORE_PRODUCT_SHA_V1,'experiment must not activate the production reader');
 assert.notEqual(buildSurveyWireScalarCandidateV1(before),before);
 for(const unknown of [' '+before,before+'\n',before.replace('llm-processing','client-derived-metrics'),'SELECT 1'])assert.equal(buildSurveyWireScalarCandidateV1(unknown),unknown,'unknown templates retain exact legacy bytes, with no rejection');
});
test('Survey scalar experiment derives representatives only after unchanged sent and human predicates',()=>{
 const before=SURVEY_SCALAR_BEFORE_SQL_V1,after=buildSurveyWireScalarCandidateV1(before);
 const tail='\n   , root_metadata AS MATERIALIZED(';
 assert.equal(after.slice(after.indexOf(tail)),before.slice(before.indexOf(tail)),'root weights, full prefix, state encoding and NULL sentinels remain literal');
 assert.match(after,/pending_native AS MATERIALIZED/u);assert.match(after,/FROM pending_native p\s+ORDER BY/u);
 assert.match(after,/COALESCE\(array_agg\(DISTINCT root_id ORDER BY root_id\),ARRAY\[\]::uuid\[\]\) roots/u);
 assert.match(after,/HAVING count\(\*\)>0/u);assert.doesNotMatch(after,/FROM signal_listening_questions|\bLIMIT 256\b/u);
 assert.equal((after.match(/signal_listening_wire_population_roots_v1\(/gu)??[]).length,2);
 assert.match(after,/LEFT JOIN question_scalars s/u,'missing/nullable joins may not drop pending rows');
 assert.match(after,/IS NOT DISTINCT FROM p\.question_digest COLLATE "C"/u);
 assert.match(after,/WHERE p\.candidate AND p\.scope_state='included' AND p\.answer IS NULL/u);
 assert.ok(after.indexOf('NOT signal_listening_human_decision_exists_v1')<after.indexOf('question_roots AS MATERIALIZED'));
 assert.equal((after.match(/octet_length\(p\.wire::text\)/gu)??[]).length,1,'one statement-local expression per exact representative pair');
});
test('Survey scalar experiment proves full and bounded0337 question wire lineage without changing native source',async()=>{
 const proof=await assertSurveyScalarWireSourceV1();assert.equal(proof.migration_sha256,'5af216411e8924fa757b3ecae5ae574cb8737ca754f7c06a27eec455396980eb');
 assert.equal(proof.prosrc_sha256,surveyScalarShaV1(proof.body));assert.ok(proof.body.includes('IF roots IS NULL THEN'));
 assert.equal((proof.body.match(/q\.question_key,q\.question_digest,q\.wire,/gu)??[]).length,2);
});
test('Survey scalar experiment redacts synthetic plan expressions and rejects unbounded or nonfinite plans',()=>{
 const raw=[{Plan:{'Node Type':'Function Scan','Actual Total Time':3,'Actual Rows':4096,'Actual Loops':1,
  'Function Call':"native('PRIVATE_SYNTHETIC_BIND')",Output:['PRIVATE_SYNTHETIC_BODY'],Plans:[{'Node Type':'Result','Actual Total Time':1}]},'Planning Time':.2,'Execution Time':3.5}];
 const safe=sanitizeSurveyScalarPlanV1(raw);const text=JSON.stringify(safe);assert.doesNotMatch(text,/PRIVATE_SYNTHETIC/u);assert.match(text,/redacted_sha256/u);assert.match(text,/Execution Time/u);
 assert.throws(()=>sanitizeSurveyScalarPlanV1([{Plan:{'Actual Total Time':Number.NaN}}]));
 let deep:unknown={};for(let i=0;i<130;i++)deep={Plans:[deep]};assert.throws(()=>sanitizeSurveyScalarPlanV1(deep));
});
test('Survey scalar experiment reports balanced client and backend elapsed ratios without a gain or H1 gate',()=>{
 const samples=SURVEY_SCALAR_SEQUENCE_V1.map((arm,index):SurveyScalarSampleV1=>({arm,index,client_wall_ms:arm==='old'?20:18,server_execution_ms:arm==='old'?10:9,server_planning_ms:.1,rows:3,rows_sha256:'f'.repeat(64),snapshot_sha256:'a'.repeat(64),plan:{}}));
 const r=summarizeSurveyScalarAbbaV1(samples);assert.equal(r.client_wall_ratio,.9);assert.equal(r.server_execution_ratio,.9);assert.equal(r.cpu,'UNKNOWN');assert.equal(r.gain_claim,false);assert.equal(r.capacity_claim,false);assert.equal(r.materiality_gate,false);
 assert.throws(()=>summarizeSurveyScalarAbbaV1(samples.slice(1)));
 assert.throws(()=>summarizeSurveyScalarAbbaV1(samples.map((v,i)=>i===0?{...v,server_execution_ms:Number.POSITIVE_INFINITY}:v)));
});
