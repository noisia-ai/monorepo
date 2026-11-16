import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('0325 changes only statement-local base-answer set joins; raw outputs, rights and H5 inputs stay exact',async()=>{
 const old=await readFile(new URL('./0321_signal_listening_bounded_custom_plan.sql',import.meta.url),'utf8');
 const next=await readFile(new URL('./0325_signal_listening_reader_slices.sql',import.meta.url),'utf8');
 const signature='CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1(';
 let body=next.slice(next.indexOf(signature));
 const slices=/\n -- base_answer_slice_begin[\s\S]*? -- base_answer_slice_end\n/g;
 assert.equal((body.match(slices)??[]).length,2);body=body.replace(slices,'\n');
 for(const [alias,key]of [['v','voice'],['p','promotion']]){
  const relation=`FULL JOIN (SELECT b.* FROM base_answers b WHERE b.question_digest=(SELECT q.question_digest FROM qs q WHERE q.question_key='${key}')) ${alias}`;
  assert.equal(body.split(relation).length-1,2);body=body.replaceAll(relation,`LEFT JOIN signal_listening_answers ${alias}`);
 }
 assert.equal(body,old.slice(old.indexOf(signature)),'all other fields, predicates, raw answer lookup, dispatch and authority remain literal');
 assert.equal((next.match(/base_answer_matches AS MATERIALIZED/g)??[]).length,2);
 assert.equal((next.match(/FROM items i FULL JOIN base_answer_slice a/g)??[]).length,2);
 assert.equal((next.match(/WHERE selected_root_id IS NOT NULL AND call_id IS NOT NULL/g)??[]).length,2);
 assert.ok(!/force_(?:generic|custom)_plan|SET\s+(?:LOCAL\s+)?work_mem|CREATE INDEX|SECURITY DEFINER/iu.test(next));
});

test('set-join identities are non-NULL and unique in the native schema',async()=>{
 const listening=await readFile(new URL('./0296_signal_listening_configuration.sql',import.meta.url),'utf8');
 const mass=await readFile(new URL('./0271_signal_mass_labeling.sql',import.meta.url),'utf8');
 const table=(name:string)=>listening.slice(listening.indexOf('CREATE TABLE '+name+'('),listening.indexOf('\n);',listening.indexOf('CREATE TABLE '+name+'('))+3);
 const answers=table('signal_listening_answers'),sent=table('signal_listening_call_questions'),questions=table('signal_listening_questions');
 assert.ok(answers.includes('PRIMARY KEY(workspace_id,root_id,input_digest,entity_context_digest,question_digest)'));
 for(const field of ['workspace_id uuid NOT NULL','root_id uuid NOT NULL','input_digest text NOT NULL','entity_context_digest text NOT NULL','question_digest text NOT NULL','call_id uuid NOT NULL'])assert.ok(answers.includes(field),field);
 assert.ok(sent.includes('PRIMARY KEY(run_id,root_id,question_digest)'));assert.ok(sent.includes('root_id uuid NOT NULL'));assert.ok(sent.includes('question_digest text NOT NULL'));
 assert.ok(questions.includes('PRIMARY KEY(configuration_id,question_key)'));assert.ok(questions.includes('question_digest text NOT NULL'));
 assert.ok(mass.includes('PRIMARY KEY(map_id,root_id)'));
});

test('pending barriers preserve projection/budgets and do not add status or context filters to reservation identity',async()=>{
 const {oldListeningMetadataSqlV1,oldListeningHydrateSqlV1}=await import('./signal-listening-reader-slices.oracle');
 const {createHash}=await import('node:crypto');
 const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
 const sent=[...source.matchAll(/sent AS MATERIALIZED\(([\s\S]*?)\n\s*\), reservation_matches/g)];assert.equal(sent.length,3,'legacy metadata, bounded projection and unbounded hydration all retain the sent-set barrier');
 for(const item of sent){assert.ok(item[1]!.includes('WHERE workspace_id=$1 AND run_id=$5'));assert.ok(item[1]!.includes('root_id=ANY('));assert.ok(!/status|input_digest|entity_context|configuration_id/u.test(item[1]!));}
 const matches=[...source.matchAll(/reservation_matches AS MATERIALIZED\(([\s\S]*?)\n\s*\), pending/g)];assert.equal(matches.length,3);
 for(const item of matches){assert.ok(item[1]!.includes('FROM candidates p FULL JOIN sent'));assert.ok(!/WHERE/u.test(item[1]!),'filter cannot be pushed below the full-set materialization barrier');}
 assert.equal(source.split('FROM reservation_matches p WHERE p.root_id IS NOT NULL AND p.reserved_root_id IS NULL').length-1,3);
 const meta=oldListeningMetadataSqlV1(),hydrate=oldListeningHydrateSqlV1(true);
 assert.ok(source.includes(meta.slice(meta.indexOf('   SELECT root_id,(4::bigint*'))),'metadata byte formula, question cutoff and output order stay exact');
 assert.ok(source.includes(hydrate.slice(hydrate.indexOf('  SELECT root_id,input_digest,body,'))),'hydration output and root/question order stay exact');
 const start=source.indexOf('async function pendingAndAvailable('),end=source.indexOf('\nexport async function requestSignalListeningV1',start);
 assert.equal(createHash('sha256').update(source.slice(start,end)).digest('hex'),'4e7dc457faa63e16942a71202cfc37c89ae2589d5bec3388d8d1f45dc71e6daa','finish count/availability is outside this change');
});

for(const divergent of [false,true])test('unbounded oracle '+(divergent?'rolls back divergent results':'compares on an owned read-only snapshot')+' before releasing its client (orchestration only)',async()=>{
 const {withListeningReaderSliceOracleV1}=await import('./signal-listening-reader-slices.oracle');
 const queries:string[]=[],counts={unbounded:0};let released=0,delegated=0;
 const client={query:async(sql:string)=>{
  queries.push(sql);
  if(sql.startsWith('SELECT to_regprocedure'))return{rows:[{present:null}]};
  if(sql.includes("current_setting('transaction_isolation')"))return{rows:[{isolation:'repeatable read',readonly:'on'}]};
  if(divergent&&sql.startsWith('WITH pending AS MATERIALIZED('))return{rows:[{unexpected:true}]};
  return{rows:[]};
 },release(){released++;}};
 const db={query:async()=>{delegated++;return{rows:[]};},connect:async()=>client}as unknown as Parameters<typeof withListeningReaderSliceOracleV1>[0];
 const wrapped=withListeningReaderSliceOracleV1(db,counts),query='/* labeling_listening_inputs_v1 */ WITH candidates AS MATERIALIZED(SELECT 1) SELECT * FROM candidates';
 const params=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','sha256:'+'0'.repeat(64),'00000000-0000-4000-8000-000000000004',3];
 if(divergent)await assert.rejects(wrapped.query(query,params),/reader fields/);else await wrapped.query(query,params);
 assert.equal(delegated,0,'the marked hydration SELECT must not bypass comparison through pool.query');assert.equal(released,1);
 assert.equal(counts.unbounded,divergent?0:1,'only a completed direct unbounded comparison increments this counter');
 const install=queries.findIndex(sql=>sql.startsWith('CREATE OR REPLACE FUNCTION pg_temp.')),begin=queries.indexOf('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.ok(install>=0&&install<begin,'the old temporary function is installed before READ ONLY begins');
 assert.ok(queries.includes(divergent?'ROLLBACK':'COMMIT'));assert.equal(queries.includes(divergent?'COMMIT':'ROLLBACK'),false);
});
