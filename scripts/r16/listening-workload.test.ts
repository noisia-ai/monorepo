import assert from 'node:assert/strict';
import test from 'node:test';
import {validateSignalListeningConfigurationV1,signalWorkspaceEmbeddingDigestV1 as digest} from '../../packages/query-engine/src/index';
import {R16_LISTENING_PREREGISTRATION_V1 as registration,r16ListeningWorkloadV1} from './listening-workload';
import {reconcileR16ListeningResolvedRootsV1} from './run-listening-benchmark';
test('preregistered R16 workloads bind generic Listening identity and consumer second pass, without legacy T&B',()=>{
 const a=r16ListeningWorkloadV1('defined_consumer_second_pass'),b=r16ListeningWorkloadV1('discovered_four');
 for(const w of[a,b]){assert.deepEqual(validateSignalListeningConfigurationV1(w.configuration),w.configuration);assert.equal(w.configuration_digest,digest(w.configuration));
 assert.equal(w.preregistration_digest,digest(registration));assert.equal(w.configuration.model,'jev-1.13.0');
 assert.ok(w.configuration.questions.filter(q=>q.origin==='brand_os').every(q=>q.scope==='consumer_category'&&q.type==='noul'&&q.topic_source==='defined'&&q.human_locked));
 assert.ok(!w.question_keys.includes('trigger_barrier'));}
 assert.equal(a.question_keys.length,4);assert.equal(b.question_keys.length,8);
 assert.equal(b.configuration.questions.filter(q=>'topic_source'in q&&q.topic_source==='discovered').length,4);
 assert.equal(registration.root_count,32768);assert.equal(registration.faults.length,8);
 assert.equal(registration.target_distinct_resolved_roots_per_second,1000);assert.equal(registration.minimum_sustained_ms,20000);
});
test('native resolved census is DISTINCT roots, never two-pass HTTP calls; no missing/foreign/duplicate/interpolated root',()=>{
 const expected=new Set(['root-a','root-b']),previous=new Set(['root-a']);
 assert.deepEqual(reconcileR16ListeningResolvedRootsV1(expected,previous,['root-a','root-b']),['root-b']);
 for(const rows of[['root-a','root-a'],['root-b'],['root-a','foreign']])
  assert.throws(()=>reconcileR16ListeningResolvedRootsV1(expected,previous,rows),/census_invalid/);
 assert.deepEqual(reconcileR16ListeningResolvedRootsV1(expected,previous,['root-a']),[]);
});

test('all fixed sustained windows and cold wall throughput remain mandatory despite plentiful two-pass HTTP',async()=>{
 const {summarizeR16ListeningCapacityV1:summary}=await import('./listening-workload');
 const commits=Array.from({length:25},(_,i)=>({at_ms:i*1000+500,roots:i===0?2768:1250}));
 const okay=summary({wall_elapsed_ms:25000,resolved_roots:32768,commits,latency_ms:[100,300,500]});
 assert.ok(Object.values(okay.gates).every(Boolean));assert.equal(okay.windows.length,20);
 const slow=summary({wall_elapsed_ms:40000,resolved_roots:32768,commits,latency_ms:[300]});assert.equal(slow.gates.wall_throughput,false);
 const gap=summary({wall_elapsed_ms:25000,resolved_roots:32768,commits:commits.filter(c=>c.at_ms!==8500),latency_ms:[300]});
 assert.equal(gap.gates.every_sustained_window,false);assert.equal(gap.minimum_window_roots_per_second,0);
 assert.equal(summary({wall_elapsed_ms:20000,resolved_roots:32768,commits,latency_ms:[501]}).gates.observed_http_latency,false);
});
