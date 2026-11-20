import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {signalListeningBaseTemplateV1} from '../../packages/query-engine/src/index';
import {withInitialDiscoveryFixtureV1} from '../../infrastructure/db/migrations/signal-listening-discovery-initial.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../../infrastructure/db/signal-listening-configuration';
import {localizeSyntheticListeningConfigurationV1} from '../../infrastructure/db/migrations/signal-listening-localized.synthetic.fixture';
import {loadR16ListeningNativeCensusV1} from './listening-native-census';

test('native census counts distinct roots only after every eligible question and rejects changed scope',{
 skip:process.env.NOISIA_R16_LISTENING_CENSUS_PG!=='true',timeout:240000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const template=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
 const base=await saveSignalListeningConfigurationV1({...f,expected_revision:f.cfg.revision,provenance:'human',configuration:{...template,
  retired_question_keys:f.cfg.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>q.key)}});
 const first=await f.request({configuration_id:base.id});assert.ok(first.result.run_id);
 const binding={...f,configuration_id:base.id,run_id:first.result.run_id};
 const census=await loadR16ListeningNativeCensusV1(binding,3);
 assert.equal(census.root_ids.length,3);assert.deepEqual(await census.readResolvedRootIds(),[]);
 await f.classify(first.result.run_id,base.configuration);
 assert.deepEqual(await census.readResolvedRootIds(),census.root_ids);
 assert.deepEqual(await census.readResolvedRootIds([census.root_ids[1]!]),[census.root_ids[1]!]);
 await assert.rejects(census.readResolvedRootIds([]),/batch_bounds/u);
 await assert.rejects(census.readResolvedRootIds([census.root_ids[0]!,census.root_ids[0]!]),/duplicate_request/u);
 await assert.rejects(census.readResolvedRootIds([randomUUID()]),/foreign_root/u);
 await assert.rejects(census.readResolvedRootIds(Array(1025).fill(census.root_ids[0]!)),/batch_bounds/u);
 await assert.rejects(loadR16ListeningNativeCensusV1(binding,4),/population_count/u);
 await assert.rejects(loadR16ListeningNativeCensusV1({...binding,run_id:randomUUID()},3),/owner_unavailable/u);
 await assert.rejects(loadR16ListeningNativeCensusV1({...binding,actor_user_id:randomUUID()},3),/forbidden/u);
 const defined=await saveSignalListeningConfigurationV1({...f,expected_revision:base.revision,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base.configuration,
  questions:[...base.configuration.questions,...['repairs','equipment'].map(key=>({key,type:'noul' as const,text:'Is this about '+key+'?',
   positive:'Bicycle '+key,negative:'Other conversation',scope:'consumer_category' as const,origin:'brand_os' as const,human_locked:true,topic_source:'defined' as const}))]})});
 await assert.rejects(census.readResolvedRootIds(),/configuration_changed/u);
 const second=await f.request({configuration_id:defined.id});assert.ok(second.result.run_id);
 const next=await loadR16ListeningNativeCensusV1({...binding,configuration_id:defined.id,run_id:second.result.run_id},3);
 // The previous native run has cached voice/promotion. Those answers alone
 // must not credit even one root with two newly eligible topic questions.
 assert.deepEqual(await next.readResolvedRootIds(),[]);
 const before=Number((await f.database.query('SELECT count(*) n FROM signal_labeling_calls WHERE run_id=$1',[first.result.run_id])).rows[0].n);
 await f.classify(second.result.run_id,defined.configuration);
 assert.deepEqual(await next.readResolvedRootIds(),next.root_ids);
 assert.equal(Number((await f.database.query('SELECT count(*) n FROM signal_labeling_calls WHERE run_id=$1',[first.result.run_id])).rows[0].n),before);
 const calls=(await f.database.query('SELECT request FROM signal_labeling_calls WHERE run_id=$1',[second.result.run_id])).rows;
 assert.ok(calls.length>0);assert.ok(calls.every(row=>Object.keys(row.request.questions).every(key=>['repairs','equipment'].includes(key))),
  'the second run must reuse all base answers and send only its new topics');
}));
