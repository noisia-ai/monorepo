import {invertSignalListeningServingTailV1,assertServingTailOriginalSqlV1} from './signal-listening-serving-tail.oracle';
import {invertSignalListeningSurveyReaderV1,assertSurveyReaderNegativeFixturesV1} from './signal-listening-survey-source-chain.test-support';
import {invertWirePopulationMetadataV1} from './signal-listening-wire-population.oracle';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertCompactProjectionSourceV1,invertCompactListeningRunsV1,compactBaselineListeningShaV1,compactShaV1,compactReaderCallV1,extractCompactExecuteReaderSqlV1,compactFullStreamSourceV1,compactFullStreamSourceShaV1,compactFullStreamProsrcShaV1} from './signal-listening-compact-population.oracle';
import {assertCompiler21006NegativeFixturesV1,invertSignalListeningCompiler21006V1} from './signal-listening-compiler-source-chain.test-support';
test('compact projection exact inverses retain0333 authority and0316 H5; unrelated SQL is rejected',async()=>{
 const raw=await readFile(new URL('./0333_signal_listening_bounded_mentions.sql',import.meta.url),'utf8'),effective=await readFile(new URL('./0316_signal_listening_human_revision_plan.sql',import.meta.url),'utf8'),next=await readFile(new URL('./0335_signal_listening_compact_population.sql',import.meta.url),'utf8');
 const parts=assertCompactProjectionSourceV1(raw,effective,next);
 const stream=await readFile(new URL('./0338_signal_listening_compact_full_stream.sql',import.meta.url),'utf8');
 const full=compactFullStreamSourceV1(next,stream);assert.equal(compactShaV1(stream),compactFullStreamSourceShaV1);assert.equal(compactShaV1(full.body),compactFullStreamProsrcShaV1);
 assert.equal(full.nextRaw.split('$bounded$')[1],full.oldRaw.split('$bounded$')[1]);
 for(const changed of [full.oldRaw.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'),stream.replace('NOT MATERIALIZED','MATERIALIZED'),stream.replace('NOT MATERIALIZED','NOT MATERIALIZED /* altered */'),stream.replace('selected_items AS NOT MATERIALIZED','selected_items AS MATERIALIZED').replace('selected_items AS MATERIALIZED(\n  SELECT item.*','selected_items AS NOT MATERIALIZED(\n  SELECT item.*'),stream+'SELECT 1;\n'])assert.throws(()=>compactFullStreamSourceV1(next,changed));
 assert.equal((parts.raw.match(/flat_input_begin/g)||[]).length,2);
 assert.ok(!parts.raw.includes('body text'));
 assert.ok(!parts.raw.includes('q.definition'));
 assert.doesNotMatch(parts.raw,/\bq\.wire\b/);
 assert.ok(parts.effective.includes('population AS MATERIALIZED(SELECT * FROM signal_listening_compact_population_roots_v1('));
 assert.ok(parts.wrapper.includes('signal_listening_population_v1(NULL::uuid'));
 assert.ok(parts.raw.includes("USING ERRCODE='42501'"));
 for(const changed of[next.replace("m.inclusion_status='included'","m.inclusion_status='excluded'"),next.replace('e.revision<=revision.n','e.revision<revision.n'),next+'SELECT 1;\n'])assert.throws(()=>assertCompactProjectionSourceV1(raw,effective,changed));
 assert.equal((parts.raw.match(/SELECT i\.\* FROM signal_mass_labeling_items i/g)||[]).length,3,'retain all original item column ACL checks');
 assert.equal((parts.raw.match(/SELECT question\.\*,/g)||[]).length,2,'question wildcard retains column ACL contract');
 assert.equal((parts.raw.match(/listening_input_digest,m\.published_at,m\.platform,c\.category_pattern/g)||[]).length,2,'platform column access remains required even though not returned');
 assert.ok(parts.acl.includes("privilege_type<>'EXECUTE'"));
 assert.ok(parts.acl.includes('listening_compact_destination_unexpected'));
 assert.ok(parts.acl.includes('listening_compact_owner_mismatch'));
 assert.ok(!/GRANT SELECT|ALTER ROLE|CREATE ROLE/.test(parts.acl));
});
test('compact readers reverse exactly to T before the retained CE38 and historical suffix identities',async()=>{
 const current=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),beforeSurvey=invertSignalListeningSurveyReaderV1(current),source=invertSignalListeningCompiler21006V1(invertWirePopulationMetadataV1(beforeSurvey));assertSurveyReaderNegativeFixturesV1(current);assertCompiler21006NegativeFixturesV1(beforeSurvey);
 assert.equal(compactShaV1(invertCompactListeningRunsV1(source)),compactBaselineListeningShaV1);
 const unrelatedNeedle=' const limit=options.page_size??200;';assert.equal(current.split(unrelatedNeedle).length-1,1);
 const unrelated=current.replace(unrelatedNeedle,' const limit=options.page_size??201;');
 assert.notEqual(compactShaV1(invertCompactListeningRunsV1(invertSignalListeningCompiler21006V1(invertWirePopulationMetadataV1(invertSignalListeningSurveyReaderV1(unrelated))))),compactBaselineListeningShaV1,
  'unrelated runtime edits survive every registered inverse and still fail the frozen complete-source hash');
 for(const changed of[source.replace(compactReaderCallV1,'signal_listening_population_v1($1,$2,$3,$4)'),source.replace('sum(body_chars+wire_chars+512)','sum(body_chars+wire_chars+511)'),source+compactReaderCallV1,source+'\n'])assert.throws(()=>assert.equal(compactShaV1(invertCompactListeningRunsV1(changed)),compactBaselineListeningShaV1));
});

test('quote and metrics retain their full T source after only the registered compact projection deltas',async()=>{
 const quote=await readFile(new URL('../signal-listening-preparation.ts',import.meta.url),'utf8');
 const call="signal_listening_compact_population_v1($1,$2,$3,$4)";
 assert.equal(quote.split(call).length,2);assert.equal(quote.split('p.body_chars+p.wire_chars+512').length,2);
 const oldQuote=quote.replace(call,'signal_listening_population_v1($1,$2,$3,$4)').replace('p.body_chars+p.wire_chars+512','length(p.body)+length(p.wire::text)+512');
 assert.equal(compactShaV1(oldQuote),'3d24c7182a06150275108cdd98440d475747d560278be23c09b711ac58ef2fc5','quote guard order, own predicate, TX, rounding and quote digest remain exact');
 const metrics=await readFile(new URL('../signal-listening-serving.ts',import.meta.url),'utf8');
 assert.equal(metrics.split('FROM signal_listening_effective_compact_population_roots_v1(').length,2);
 const originalBatch=invertSignalListeningServingTailV1(metrics);
 const frozen=await readFile(new URL('./signal-listening-question-metrics-before-tail.fixture.sql',import.meta.url),'utf8');assertServingTailOriginalSqlV1(frozen);
 const actualSql=extractCompactExecuteReaderSqlV1(await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),quote,metrics).metrics;
 assert.equal(invertSignalListeningServingTailV1(actualSql)+'\n',frozen,'closed inverse restores the complete frozen batchN query');
 for(const mutation of [metrics.replace("COALESCE(n.count,0)","COALESCE(n.count,1)"),metrics.replace('t.root_id IS NOT NULL','t.root_id IS NULL')])assert.throws(()=>invertSignalListeningServingTailV1(mutation));
 const unrelated=metrics.replace("fail('listening_filters_invalid',422)","fail('listening_filters_invalid',403)");assert.notEqual(compactShaV1(invertSignalListeningServingTailV1(unrelated)),compactShaV1(originalBatch),'an unrelated guard edit survives the inverse and cannot match the historical whole-source SHA');
 const oldMetrics=originalBatch.replace('FROM signal_listening_effective_compact_population_roots_v1(','FROM signal_listening_effective_population_roots_v2(').replace('SELECT root_id,question_key,has_topic_source,',"SELECT root_id,question_key,(definition ? 'topic_source') has_topic_source,").replace("COALESCE(domain,'category')","COALESCE(definition->>'domain','category')");
 assert.equal(compactShaV1(oldMetrics),'78b5db1ee2b31f4e8dc138b53925ec3c7b68b49fa1c47511c2c68d669b54f042','all count/trend/cross/choice/probability/order/error precedence stays literal');
});

test('compact EXECUTE composition keeps three historical runtime gates and wrapper-only reader routing',async()=>{
 const next=await readFile(new URL('./0335_signal_listening_compact_population.sql',import.meta.url),'utf8');
 const raw=next.split('-- compact_raw_begin\n')[1]!.split('-- compact_raw_end\n')[0]!,effective=next.split('-- compact_effective_begin\n')[1]!.split('-- compact_effective_end\n')[0]!,wrapper=next.split('-- compact_wrapper_begin\n')[1]!.split('-- compact_wrapper_end\n')[0]!;
 assert.ok(raw.includes("pg_catalog.has_function_privilege(current_user,'public.signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::pg_catalog.regprocedure,'EXECUTE') IS DISTINCT FROM true"));assert.ok(raw.includes("USING ERRCODE='42501'"));
 assert.ok(effective.includes("pg_catalog.has_function_privilege(current_user,'public.signal_listening_effective_population_roots_v2(uuid,uuid,uuid,text,uuid[],text)'"));assert.ok(effective.includes('signal_listening_human_revision_v1(CASE WHEN(SELECT allowed FROM execute_gate) THEN cid END)'));assert.ok(effective.includes('signal_listening_compact_population_roots_v1(CASE WHEN(SELECT allowed FROM execute_gate) THEN w END'));
 assert.ok(!effective.includes('signal_listening_population_v1('));assert.ok(!raw.includes('signal_listening_population_v1('),'metrics cannot acquire the unrelated wrapper permission');
 assert.ok(wrapper.includes("purpose text DEFAULT 'llm-processing'"));assert.ok(wrapper.includes("pg_catalog.has_function_privilege(current_user,'public.signal_listening_population_v1(uuid,uuid,uuid,text,text)'"));assert.ok(wrapper.includes('ELSE(SELECT denied.root_id FROM public.signal_listening_population_v1(NULL::uuid'));
 const fixture=await readFile(new URL('./signal-listening-compact-population.synthetic.fixture.ts',import.meta.url),'utf8'),entry=await readFile(new URL('./signal-listening-question-metrics-batch.postgres.test.ts',import.meta.url),'utf8');assert.ok(fixture.includes('if(options.execute_authority){await assertCompactFullReplacementV1(access.database);await assertCompactExecuteCompositionV1(access.database,base);}'));assert.equal(entry.split('execute_authority:true').length,2,'real-role case is invoked once under the existing Native gate');
});

test('Native execute oracle extracts the actual quote, stats, pending and metrics SQL without PG',async()=>{
 const [runs,preparation,serving]=await Promise.all(['signal-listening-runs.ts','signal-listening-preparation.ts','signal-listening-serving.ts'].map(file=>readFile(new URL('../'+file,import.meta.url),'utf8')));
 const sql=extractCompactExecuteReaderSqlV1(runs!,preparation!,serving!);assert.deepEqual(Object.keys(sql).sort(),['metrics','pending','quote','stats']);
 for(const statement of Object.values(sql)){assert.ok(statement.length>100);assert.ok(!statement.includes('${'),'the real parser must fully bind every source interpolation');}
 assert.ok(preparation!.includes(sql.quote));assert.ok(runs!.includes(sql.stats));assert.ok(serving!.includes(sql.metrics),'extract complete native query bodies, not reconstructed approximations');
 assert.ok(sql.quote.includes("FROM signal_listening_compact_population_v1($1,$2,$3,$4) p WHERE p.scope_state<>'excluded' AND p.answer IS NULL"));assert.ok(!sql.quote.includes('p.candidate'));assert.ok(!sql.quote.includes('signal_listening_human_decision_exists_v1'));
 assert.ok(sql.stats.includes("WHERE candidate AND scope_state<>'excluded' AND answer IS NULL"));assert.ok(sql.stats.includes('NOT signal_listening_human_decision_exists_v1('));
 assert.ok(sql.pending.includes("p.candidate AND p.scope_state='included' AND p.answer IS NULL"));assert.ok(sql.pending.includes('NOT signal_listening_human_decision_exists_v1('));assert.ok(sql.pending.includes('signal_listening_call_questions sent'));
 assert.ok(sql.metrics.startsWith('WITH requested AS MATERIALIZED('));assert.ok(sql.metrics.includes('FROM signal_listening_effective_compact_population_roots_v1('));assert.ok(!sql.metrics.includes('signal_listening_compact_population_v1('),'metrics must not acquire the wrapper gate');
 const oracle=await readFile(new URL('./signal-listening-compact-population.oracle.ts',import.meta.url),'utf8');assert.equal(oracle.split('const {pending,quote,stats,metrics}=extractCompactExecuteReaderSqlV1(runs!,preparation!,serving!);').length,2,'Native invokes the same parser exercised here');
 for(const [name,changed]of [['missing unanswered declaration',runs!.replace('const unansweredScope=','const missingScope=')],['duplicate unanswered declaration',runs!+runs!.slice(runs!.indexOf('const unansweredScope='),runs!.indexOf('// FULL joins'))]]as const)assert.throws(()=>extractCompactExecuteReaderSqlV1(changed,preparation!,serving!),name);
});
