import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {withInitialDiscoveryFixtureV1} from './signal-listening-discovery-initial.synthetic.fixture';
import {withDiscoveryAdvanceFixtureV1} from './signal-listening-discovery-advance.synthetic.fixture';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
import {bootstrapSignalListeningDiscoveryV1,seedSignalListeningDiscoveryV1} from '../signal-listening-discovery';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {setSignalListeningDiscoveryManualV1} from '../signal-listening-discovery';
import * as human from '../signal-listening-human-edits';
import {installProcessingProjectionV1,processingProjectionReadV1,processingProjectionKernelV1,withProcessingProjectionSnapshotV1,
 processingProjectionReadOnlyTransactionV1,releaseProcessingProjectionClientV1,assertProcessingProjectionSourceV1,compareProcessingProjectionBudgetsV1,PROCESSING_PROJECTION_QUERY_ORDER_V1,assertProcessingProjectionMeasurementCountsV1,assertProcessingProjectionEffectiveAclV1,
 runProcessingProjection4096V1,writeProcessingProjectionEvidenceV1} from './signal-listening-processing-projection.fixture';
const enabled=process.env.NOISIA_R16_PROCESSING_PROJECTION_PG==='true';
// No provider, product function replacement, GUC authority or trigger disabling.
// Every product row is prepared by the existing native owned-lab fixtures/APIs.
test('processing projection preserves all native population fields bytes and budgets across full processing and census modes',{
 skip:!enabled,timeout:900000,
},async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','owned CI only');
 await withInitialDiscoveryFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:f.cfg.revision,provenance:'human',configuration:{...f.cfg.configuration,
   questions:[...f.cfg.configuration.questions.map(q=>q.topic_source==='discovered'?{...q,human_locked:true}:q),
    {key:'consumer_probe',type:'noul',text:'Is this synthetic category use?',positive:'Synthetic category use',negative:'Other content',scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined',localization:{original_language:'en',original:{name:'Synthetic use',definition:'Synthetic fixture topic'},en:{name:'Synthetic use',definition:'Synthetic fixture topic'},es:{name:'Uso sintético',definition:'Tema sintético de prueba'}}}]}});
  const seed=await bootstrapSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:f.map_id,bindings:f.bindings});
  assert.equal(seed.configuration_id,cfg.id);assert.equal(seed.status,'ready');
  const requested=await f.request({configuration_id:cfg.id});
  assert.equal(requested.intent?.seed_generation_id,seed.id,'new configuration has its genuine seed before initial admission');
  const prepared=requested.result.status==='waiting_prototypes'?(await f.prototypes(requested.result.preparation_id)).result:requested.result;
  assert.ok(prepared.run_id);
  const census=await loadR16ListeningNativeCensusV1({...access,configuration_id:cfg.id,map_id:f.map_id,run_id:prepared.run_id},3);
  assert.equal(census.root_ids.length,3);assert.deepEqual(await census.readResolvedRootIds(),[]);
  const c=await f.database.connect();
  try{
   await installProcessingProjectionV1(c);await processingProjectionKernelV1(c);
   const context=(await c.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
   const roots=(await c.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[f.workspace_id,f.map_id])).rows.map(r=>r.root_id as string);
   const scope=[f.workspace_id,cfg.id,f.map_id,context];
   await withProcessingProjectionSnapshotV1(c,async()=>{
    for(const mode of [null,'not_a_projection']){
     await c.query('SAVEPOINT invalid_projection');
     await assert.rejects(c.query("SELECT * FROM pg_temp.r16_projection_core($1,$2,$3,$4,$5,'llm-processing',$6) AS p(root_id uuid)",[...scope,roots,mode]),{code:'P0001',message:'listening_population_projection_invalid'});
     await c.query('ROLLBACK TO SAVEPOINT invalid_projection');await c.query('RELEASE SAVEPOINT invalid_projection');
    }
    await compareProcessingProjectionBudgetsV1(c,scope,prepared.run_id!,roots);
    const full=await processingProjectionReadV1(c,scope,null);assert.equal(full.rows,roots.length*cfg.configuration.questions.length);
    assert.equal((await processingProjectionReadV1(c,scope,roots)).sha256,full.sha256);
    assert.equal((await processingProjectionReadV1(c,scope,[])).rows,0);
    assert.equal((await processingProjectionReadV1(c,[randomUUID(),...scope.slice(1)],roots)).rows,0);
    assert.equal((await processingProjectionReadV1(c,scope,[randomUUID()])).rows,0);
    assert.equal((await processingProjectionReadV1(c,[scope[0],randomUUID(),...scope.slice(2)],roots)).rows,0);
    await processingProjectionReadV1(c,[...scope.slice(0,3),'sha256:'+'f'.repeat(64)],roots);
    await processingProjectionReadV1(c,scope,[...roots,roots[0]!,null]);
    await processingProjectionReadV1(c,scope,Array(4097).fill(roots[0]));
    const state=(await c.query("SELECT count(*) FILTER(WHERE definition->>'topic_source'='defined' AND candidate)::int defined FROM pg_temp.r16_projection_old($1,$2,$3,$4,$5,'llm-processing')",[...scope,[roots[0]]])).rows[0];
    assert.equal((await c.query("SELECT count(*)::int n FROM pg_temp.r16_projection_full($1,$2,$3,$4,$5,'llm-processing') WHERE question_key='consumer_probe' AND scope_state='awaiting_base'",[...scope,roots])).rows[0].n,3);
    assert.equal(state.defined,4,'nine native defined topics are genuinely top4 selected');
   });
   await f.classify(prepared.run_id!,cfg.configuration);
   assert.deepEqual(await census.readResolvedRootIds(),census.root_ids,'real RAW/settle/apply resolves the independent native census');
   await withProcessingProjectionSnapshotV1(c,async()=>{
    await processingProjectionReadV1(c,scope,null);await processingProjectionReadV1(c,scope,roots);
    assert.equal((await c.query("SELECT count(*)::int n FROM pg_temp.r16_projection_full($1,$2,$3,$4,$5,'llm-processing') WHERE question_key='consumer_probe' AND scope_state='included' AND scope_basis IS NOT NULL",[...scope,roots])).rows[0].n,3);
    await processingProjectionReadV1(c,[...scope.slice(0,3),'sha256:'+'e'.repeat(64)],roots);
    await compareProcessingProjectionBudgetsV1(c,scope,prepared.run_id!,roots);
   });
   const q=cfg.configuration.questions.find(q=>q.topic_source==='discovered');assert.ok(q);
   await setSignalListeningDiscoveryManualV1({...access,configuration_id:cfg.id,map_id:f.map_id,question_key:q.key,root_id:roots[0]!,belongs:true});
   await setSignalListeningDiscoveryManualV1({...access,configuration_id:cfg.id,map_id:f.map_id,question_key:q.key,root_id:roots[0]!,belongs:false});
   // Guarded direct SQL supplies timestamp ties; immutable history is never edited.
   await c.query(`INSERT INTO signal_listening_discovery_manual(workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,created_by_user_id,created_at)
    SELECT workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,x.belongs,created_by_user_id,'2100-01-01 00:00:00.123456+00'::timestamptz
    FROM (SELECT * FROM signal_listening_discovery_manual WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1) d CROSS JOIN(VALUES(true),(false))x(belongs)`,[f.workspace_id]);
   await withProcessingProjectionSnapshotV1(c,async()=>{
    await processingProjectionReadV1(c,scope,null);await processingProjectionReadV1(c,scope,roots);await processingProjectionReadV1(c,scope,roots,true);
    await processingProjectionReadV1(c,[scope[0],f.cfg.id,...scope.slice(2)],roots); // manual cfg is intentionally not a lookup predicate
    const row=(await c.query("SELECT answer,cache_call_id,candidate FROM pg_temp.r16_projection_full($1,$2,$3,$4,$5,'llm-processing') WHERE root_id=$6 AND question_key=$7",[...scope,roots,roots[0],q.key])).rows[0];
    const latest=(await c.query('SELECT belongs FROM signal_listening_discovery_manual WHERE workspace_id=$1 AND root_id=$2 AND question_key=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[f.workspace_id,roots[0],q.key])).rows[0];
    assert.equal(row.answer.noul,latest.belongs?1:0);assert.equal(row.cache_call_id,null);assert.equal(row.candidate,true);
   });
   await f.database.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);
   await withProcessingProjectionSnapshotV1(c,async()=>{
    assert.equal((await processingProjectionReadV1(c,scope,null)).rows,0);
    assert.equal((await processingProjectionReadV1(c,scope,roots)).rows,0);
   });
  }finally{releaseProcessingProjectionClientV1(c);}
 },{prototypes:true});
 await withDiscoveryAdvanceFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const source=f.cfg.configuration.questions.find(q=>q.topic_source==='discovered');assert.ok(source&&source.type==='noul');
  const extra=Array.from({length:5},(_,n)=>({...source,key:'manual_extra_'+n,human_locked:true,text:'Additional synthetic topic '+n}));
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:f.cfg.revision,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...f.cfg.configuration,
   questions:[...f.cfg.configuration.questions.map(q=>q.topic_source==='discovered'?{...q,human_locked:true}:q),...extra]})});
  const generation=await seedSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:f.map_id,round:2,source_generation_id:f.confirmed.id,
   seeds:cfg.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>({question_key:q.key,source_topic_keys:[source.key]}))});
  const c=await f.database.connect();try{await installProcessingProjectionV1(c);
   const scope=[f.workspace_id,cfg.id,f.map_id,generation.entity_context_digest];
   const initial=(await c.query("SELECT question_key,candidate FROM pg_temp.r16_projection_old($1,$2,$3,$4,$5,'llm-processing') WHERE definition->>'topic_source'='discovered'",[...scope,[f.roots[0]]])).rows;
   assert.equal(initial.filter(r=>r.candidate).length,4);const outside=initial.find(r=>!r.candidate);assert.ok(outside,'real native generation supplies more than four candidates');
   for(const belongs of [false,true]){
    await setSignalListeningDiscoveryManualV1({...access,configuration_id:cfg.id,map_id:f.map_id,question_key:outside.question_key,root_id:f.roots[0]!,belongs});
    await withProcessingProjectionSnapshotV1(c,async()=>{
     await processingProjectionReadV1(c,scope,null);await processingProjectionReadV1(c,scope,f.roots,true);
     const row=(await c.query("SELECT candidate,answer,cache_call_id FROM pg_temp.r16_projection_full($1,$2,$3,$4,$5,'llm-processing') WHERE root_id=$6 AND question_key=$7",[...scope,f.roots,f.roots[0],outside.question_key])).rows[0];
     assert.equal(row.candidate,true);assert.equal(row.answer.noul,belongs?1:0);assert.equal(row.cache_call_id,null);
    });
   }
  }finally{releaseProcessingProjectionClientV1(c);}
 });
 await withDiscoveryAdvanceFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:f.cfg.revision,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...f.cfg.configuration,
   questions:[...f.cfg.configuration.questions,{key:'excluded_probe',type:'noul',text:'Does this describe synthetic category use?',positive:'Category use',negative:'Other',scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined'}]})});
  const c=await f.database.connect();try{await installProcessingProjectionV1(c);
   const ctx=(await c.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest,scope=[f.workspace_id,cfg.id,f.map_id,ctx];
   await withProcessingProjectionSnapshotV1(c,async()=>{
    await processingProjectionReadV1(c,scope,null);await processingProjectionReadV1(c,scope,f.roots);
    assert.equal((await c.query("SELECT count(*)::int n FROM pg_temp.r16_projection_full($1,$2,$3,$4,$5,'llm-processing') WHERE question_key='excluded_probe' AND scope_state='excluded' AND answer IS NULL",[...scope,f.roots])).rows[0].n,3);
   });
  }finally{releaseProcessingProjectionClientV1(c);}
 },{no_category:true});
 // Real H5 decisions and the native serving snapshot travel through the same
 // unchanged effective wrapper; compare its20 fields as well as the raw14.
 await withSignalStudyFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const initial=await human.getSignalListeningHumanEditContextV1(access),from=initial.configuration.questions.find(q=>q.topic_source==='discovered')!.key;
  const moved=await human.correctSignalListeningTopicMembershipV1({...access,expected:initial.expected,root_id:f.roots[0]!,from_question_key:from,to_question_key:'additional_defined_topic',idempotency_key:randomUUID()});
  const c=await f.database.connect();try{await installProcessingProjectionV1(c);
   const ctx=(await c.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
   await withProcessingProjectionSnapshotV1(c,async()=>{for(const cid of [initial.expected.configuration_id,moved.configuration_id]){
    await processingProjectionReadV1(c,[f.workspace_id,cid,f.map_id,ctx],null,true);
    await processingProjectionReadV1(c,[f.workspace_id,cid,f.map_id,ctx],f.roots,true);
   }});
  }finally{releaseProcessingProjectionClientV1(c);}
 },{complete_listening:true,additional_defined_topic:true});
});

test('processing projection paired queries preserve narrow outputs and full population controls',{
 skip:!enabled,timeout:900000,
},async()=>{const receipt=await runProcessingProjection4096V1();await writeProcessingProjectionEvidenceV1(receipt);});

// Explicit local pure mode never enables either PostgreSQL acceptance title.
// Ordinary native CI registers exactly the two titles above.
if(process.env.NOISIA_R16_PROCESSING_PROJECTION_PURE==='true')test('processing projection transaction preserves primary errors and discards only uncertain clients',async()=>{
 for(const failure of ['none','body','dual','rollback'] as const){
  const primary=new Error('body sentinel'),secondary=new Error('rollback sentinel'),releases:boolean[]=[];
  const c={query:async(sql:string)=>{if(sql==='ROLLBACK'&&(failure==='rollback'||failure==='dual'))throw secondary;return{rows:[]};},release:(destroy:boolean)=>{releases.push(destroy);}} as unknown as PoolClient;
  let caught:unknown;
  try{await processingProjectionReadOnlyTransactionV1(c,async()=>{if(failure==='body'||failure==='dual')throw primary;});}
  catch(error){caught=error;}finally{releaseProcessingProjectionClientV1(c);}
  if(failure==='dual'){assert.ok(caught instanceof AggregateError);assert.deepEqual(caught.errors,[primary,secondary]);assert.equal(caught.cause,primary);}
  else assert.equal(caught,failure==='none'?undefined:failure==='body'?primary:secondary);
  assert.deepEqual(releases,[failure==='rollback'||failure==='dual'],'release exactly once; destroy only after failed rollback');
 }
});

if(process.env.NOISIA_R16_PROCESSING_PROJECTION_PURE==='true')test('processing projection source retains native0326 decisions and constant typed modes',async()=>{
 const source=await readFile(new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url),'utf8'),candidate=await readFile(new URL('./signal-listening-processing-projection.candidate.sql',import.meta.url),'utf8');
 assertProcessingProjectionSourceV1(source,candidate);
 assert.throws(()=>assertProcessingProjectionSourceV1(source,candidate.replace('ORDER BY d.created_at DESC,d.id DESC','ORDER BY d.created_at DESC,d.id ASC')));
 assert.throws(()=>assertProcessingProjectionSourceV1(source,candidate.replace("m.inclusion_status='included'","m.inclusion_status='excluded'")));
 assert.equal((candidate.match(/CREATE FUNCTION pg_temp\.r16_projection_/gu)??[]).length,4);
 const revokes=candidate.match(/^REVOKE ALL ON FUNCTION pg_temp\.r16_projection_.* FROM PUBLIC;$/gmu)??[];
 assert.deepEqual(revokes,[
  'REVOKE ALL ON FUNCTION pg_temp.r16_projection_core(uuid,uuid,uuid,text,uuid[],text,text) FROM PUBLIC;',
  'REVOKE ALL ON FUNCTION pg_temp.r16_projection_full(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;',
  'REVOKE ALL ON FUNCTION pg_temp.r16_projection_processing(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;',
  'REVOKE ALL ON FUNCTION pg_temp.r16_projection_census(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;',
 ]);
 assert.ok(!/SECURITY DEFINER|CREATE OR REPLACE|CREATE FUNCTION public\.|GRANT |ALTER FUNCTION/u.test(candidate));
});

if(process.env.NOISIA_R16_PROCESSING_PROJECTION_PURE==='true')test('processing projection schedules both independent full14 root controls',()=>{
 assert.deepEqual(PROCESSING_PROJECTION_QUERY_ORDER_V1,['census','metadata','full14','full14_bounded']);
 const schedule=PROCESSING_PROJECTION_QUERY_ORDER_V1.flatMap(query=>(['empty','historical'] as const).flatMap(scenario=>(['old','new','new','old'] as const).map((arm,position)=>({query,scenario,arm,position}))));
 assertProcessingProjectionMeasurementCountsV1(schedule);
 assert.throws(()=>assertProcessingProjectionMeasurementCountsV1(schedule.filter(r=>r.query!=='full14_bounded')));
 assert.throws(()=>assertProcessingProjectionMeasurementCountsV1(schedule.map(r=>r.query==='full14_bounded'?{...r,query:'full14' as const}:r)));
 assert.throws(()=>assertProcessingProjectionMeasurementCountsV1([]));
});

if(process.env.NOISIA_R16_PROCESSING_PROJECTION_PURE==='true')test('processing projection effective aliases match only the native service_role permission',async()=>{
 const owner={role:'postgres',is_owner:true,is_public:false,grantor_is_owner:true,privilege_type:'EXECUTE',is_grantable:false},reader={...owner,role:'service_role',is_owner:false};
 assertProcessingProjectionEffectiveAclV1([owner,reader]);
 for(const invalid of [[],[owner],[owner,{...reader,is_public:true}],[owner,{...reader,is_grantable:true}],[owner,{...reader,grantor_is_owner:false}],[owner,{...reader,role:'other_role'}],[owner,reader,reader]])assert.throws(()=>assertProcessingProjectionEffectiveAclV1(invalid));
 const fixture=await readFile(new URL('./signal-listening-processing-projection.fixture.ts',import.meta.url),'utf8');
 assert.deepEqual(fixture.match(/GRANT EXECUTE ON FUNCTION pg_temp\.r16_projection_.* TO service_role;/gu)??[],[
  'GRANT EXECUTE ON FUNCTION pg_temp.r16_projection_effective_old(uuid,uuid,uuid,text,uuid[],text) TO service_role;',
  'GRANT EXECUTE ON FUNCTION pg_temp.r16_projection_effective_new(uuid,uuid,uuid,text,uuid[],text) TO service_role;',
 ]);
});
