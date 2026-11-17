import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {withInitialDiscoveryFixtureV1} from './signal-listening-discovery-initial.synthetic.fixture';
import {withDiscoveryAdvanceFixtureV1} from './signal-listening-discovery-advance.synthetic.fixture';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
import {seedSignalListeningDiscoveryV1} from '../signal-listening-discovery';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {setSignalListeningDiscoveryManualV1} from '../signal-listening-discovery';
import * as human from '../signal-listening-human-edits';
import {installManualLatestV1,manualLatestReadV1,manualLatestKernelV1,withManualLatestSnapshotV1,
 runManualLatest4096V1,writeManualLatestEvidenceV1} from './signal-listening-manual-latest.fixture';
const enabled=process.env.NOISIA_R16_MANUAL_LATEST_PG==='true';
// No provider, product function replacement, GUC authority or trigger disabling.
// Every product row is prepared by the existing native owned-lab fixtures/APIs.
test('manual latest relation preserves all native population bytes for full and bounded reads',{
 skip:!enabled,timeout:900000,
},async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','owned CI only');
 await withInitialDiscoveryFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:f.cfg.revision,provenance:'human',configuration:{...f.cfg.configuration,
   questions:f.cfg.configuration.questions.map(q=>q.topic_source==='discovered'?{...q,human_locked:true}:q)}});
  const requested=await f.request({configuration_id:cfg.id});
  const prepared=requested.result.status==='waiting_prototypes'?(await f.prototypes(requested.result.preparation_id)).result:requested.result;
  assert.ok(prepared.run_id);
  const census=await loadR16ListeningNativeCensusV1({...access,configuration_id:cfg.id,map_id:f.map_id,run_id:prepared.run_id},3);
  assert.equal(census.root_ids.length,3);assert.deepEqual(await census.readResolvedRootIds(),[]);
  const c=await f.database.connect();
  try{
   await installManualLatestV1(c);await manualLatestKernelV1(c);
   const context=(await c.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
   const roots=(await c.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[f.workspace_id,f.map_id])).rows.map(r=>r.root_id as string);
   const scope=[f.workspace_id,cfg.id,f.map_id,context];
   await withManualLatestSnapshotV1(c,async()=>{
    const full=await manualLatestReadV1(c,scope,null);assert.equal(full.rows,roots.length*cfg.configuration.questions.length);
    assert.equal((await manualLatestReadV1(c,scope,roots)).sha256,full.sha256);
    assert.equal((await manualLatestReadV1(c,scope,[])).rows,0);
    assert.equal((await manualLatestReadV1(c,[randomUUID(),...scope.slice(1)],roots)).rows,0);
    assert.equal((await manualLatestReadV1(c,scope,[randomUUID()])).rows,0);
    assert.equal((await manualLatestReadV1(c,[scope[0],randomUUID(),...scope.slice(2)],roots)).rows,0);
    await manualLatestReadV1(c,[...scope.slice(0,3),'sha256:'+'f'.repeat(64)],roots);
    await manualLatestReadV1(c,scope,[...roots,roots[0]!,null]);
    await manualLatestReadV1(c,scope,Array(4097).fill(roots[0]));
    const state=(await c.query("SELECT count(*) FILTER(WHERE definition->>'topic_source'='defined' AND candidate)::int defined FROM pg_temp.r16_manual_old($1,$2,$3,$4,$5,'llm-processing')",[...scope,[roots[0]]])).rows[0];
    assert.equal(state.defined,4,'nine native defined topics are genuinely top4 selected');
   });
   const q=cfg.configuration.questions.find(q=>q.topic_source==='discovered');assert.ok(q);
   await setSignalListeningDiscoveryManualV1({...access,configuration_id:cfg.id,map_id:f.map_id,question_key:q.key,root_id:roots[0]!,belongs:true});
   await setSignalListeningDiscoveryManualV1({...access,configuration_id:cfg.id,map_id:f.map_id,question_key:q.key,root_id:roots[0]!,belongs:false});
   // Guarded direct SQL supplies timestamp ties; immutable history is never edited.
   await c.query(`INSERT INTO signal_listening_discovery_manual(workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,created_by_user_id,created_at)
    SELECT workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,x.belongs,created_by_user_id,'2100-01-01 00:00:00.123456+00'::timestamptz
    FROM (SELECT * FROM signal_listening_discovery_manual WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1) d CROSS JOIN(VALUES(true),(false))x(belongs)`,[f.workspace_id]);
   await withManualLatestSnapshotV1(c,async()=>{
    await manualLatestReadV1(c,scope,null);await manualLatestReadV1(c,scope,roots);await manualLatestReadV1(c,scope,roots,true);
    await manualLatestReadV1(c,[scope[0],f.cfg.id,...scope.slice(2)],roots); // manual cfg is intentionally not a lookup predicate
    const row=(await c.query("SELECT answer,cache_call_id,candidate FROM pg_temp.r16_manual_new($1,$2,$3,$4,$5,'llm-processing') WHERE root_id=$6 AND question_key=$7",[...scope,roots,roots[0],q.key])).rows[0];
    const latest=(await c.query('SELECT belongs FROM signal_listening_discovery_manual WHERE workspace_id=$1 AND root_id=$2 AND question_key=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[f.workspace_id,roots[0],q.key])).rows[0];
    assert.equal(row.answer.noul,latest.belongs?1:0);assert.equal(row.cache_call_id,null);assert.equal(row.candidate,true);
   });
   await f.database.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);
   await withManualLatestSnapshotV1(c,async()=>{
    assert.equal((await manualLatestReadV1(c,scope,null)).rows,0);
    assert.equal((await manualLatestReadV1(c,scope,roots)).rows,0);
   });
  }finally{c.release();}
 },{prototypes:true});
 await withDiscoveryAdvanceFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const source=f.cfg.configuration.questions.find(q=>q.topic_source==='discovered');assert.ok(source&&source.type==='noul');
  const extra=Array.from({length:5},(_,n)=>({...source,key:'manual_extra_'+n,human_locked:true,text:'Additional synthetic topic '+n}));
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:f.cfg.revision,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...f.cfg.configuration,
   questions:[...f.cfg.configuration.questions.map(q=>q.topic_source==='discovered'?{...q,human_locked:true}:q),...extra]})});
  const generation=await seedSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:f.map_id,round:2,source_generation_id:f.confirmed.id,
   seeds:cfg.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>({question_key:q.key,source_topic_keys:[source.key]}))});
  const c=await f.database.connect();try{await installManualLatestV1(c);
   const scope=[f.workspace_id,cfg.id,f.map_id,generation.entity_context_digest];
   const initial=(await c.query("SELECT question_key,candidate FROM pg_temp.r16_manual_old($1,$2,$3,$4,$5,'llm-processing') WHERE definition->>'topic_source'='discovered'",[...scope,[f.roots[0]]])).rows;
   assert.equal(initial.filter(r=>r.candidate).length,4);const outside=initial.find(r=>!r.candidate);assert.ok(outside,'real native generation supplies more than four candidates');
   for(const belongs of [false,true]){
    await setSignalListeningDiscoveryManualV1({...access,configuration_id:cfg.id,map_id:f.map_id,question_key:outside.question_key,root_id:f.roots[0]!,belongs});
    await withManualLatestSnapshotV1(c,async()=>{
     await manualLatestReadV1(c,scope,null);await manualLatestReadV1(c,scope,f.roots,true);
     const row=(await c.query("SELECT candidate,answer,cache_call_id FROM pg_temp.r16_manual_new($1,$2,$3,$4,$5,'llm-processing') WHERE root_id=$6 AND question_key=$7",[...scope,f.roots,f.roots[0],outside.question_key])).rows[0];
     assert.equal(row.candidate,true);assert.equal(row.answer.noul,belongs?1:0);assert.equal(row.cache_call_id,null);
    });
   }
  }finally{c.release();}
 });
 // Real H5 decisions and the native serving snapshot travel through the same
 // unchanged effective wrapper; compare its20 fields as well as the raw14.
 await withSignalStudyFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const initial=await human.getSignalListeningHumanEditContextV1(access),from=initial.configuration.questions.find(q=>q.topic_source==='discovered')!.key;
  const moved=await human.correctSignalListeningTopicMembershipV1({...access,expected:initial.expected,root_id:f.roots[0]!,from_question_key:from,to_question_key:'additional_defined_topic',idempotency_key:randomUUID()});
  const c=await f.database.connect();try{await installManualLatestV1(c);
   const ctx=(await c.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[f.map_id])).rows[0].entity_context_digest;
   await withManualLatestSnapshotV1(c,async()=>{for(const cid of [initial.expected.configuration_id,moved.configuration_id]){
    await manualLatestReadV1(c,[f.workspace_id,cid,f.map_id,ctx],null,true);
    await manualLatestReadV1(c,[f.workspace_id,cid,f.map_id,ctx],f.roots,true);
   }});
  }finally{c.release();}
 },{complete_listening:true,additional_defined_topic:true});
});

test('manual latest relation paired queries preserve snapshots with empty and historical manual decisions',{
 skip:!enabled,timeout:900000,
},async()=>{const receipt=await runManualLatest4096V1();await writeManualLatestEvidenceV1(receipt);});
