import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,open,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {loadSignalListeningLexiconSuggestionsV1} from '../signal-listening-lexicon';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,
  mapSignalListeningJevResponseV1} from '@noisia/query-engine';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';

test('native lexical evidence uses configured category topics without trigger/barrier and retains tenant and feature guards',{
  skip:process.env.NOISIA_R16_LISTENING_LEXICON_PG!=='true',timeout:180000,
},async()=>{
  await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
    const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
    await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
    const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['unmatchedlexicalterm']});
    const configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,
      questions:[...base.questions,{key:'category_topic',type:'noul',text:'Category conversation?',positive:'Bicycle conversation',negative:'Other content',
        scope:'all',origin:'brand_os',human_locked:false,topic_source:'defined',domain:'category'}]})});
    const args={...access,configuration_id:configuration.id,map_id:ctx.map_id};
    const empty=await loadSignalListeningLexiconSuggestionsV1(args);
    assert.equal(empty.background_size,0);assert.deepEqual(empty.items,[]);
    const dir=await mkdtemp(join(tmpdir(),'r16-lexicon-pg-'));
    try{
      const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
      const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
        store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{
          const path=join(dir,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});
          const fd=await open(path,'r+');try{await fd.sync();}finally{await fd.close();}
          const read=await readFile(path,'utf8');assert.equal(sha(read),a.raw_sha256);assert.equal(Buffer.byteLength(read),a.size_bytes);
          return {storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};
        },load:async(a:{sha256:string})=>readFile(join(dir,a.sha256.slice(7)),'utf8')};
      const store=createSignalListeningStoreV1({database,rawPages,page_size:200,storeRaw:async()=>{throw Error('individual raw forbidden');}});
      const admitted=await requestSignalListeningV1({...args,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
      const run=await store.claim(admitted.run_id);assert.ok(run);
      const input=await store.inputs(run);assert.equal(input.length,3);
      const calls=await store.reserve(run,input.map(i=>{
        const request=buildSignalListeningJevRequestV1(i,configuration.configuration),request_digest=signalListeningRequestDigestV1(run,i,request);
        assert.ok(!('trigger_barrier'in request.questions));
        return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[i],reserved_micro_usd:1000};
      }));
      await store.markSubmitting(run,calls);
      const outcomes=calls.map(call=>{
        const request=buildSignalListeningJevRequestV1(call.inputs[0]!,configuration.configuration);
        const response={model:configuration.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(
          Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:key==='promotion'?.1:.9}:
            {type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(option=>[option,option==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
        return{call,response,raw:JSON.stringify({http_status:200,latency_ms:1,body:JSON.stringify(response)})};
      });
      await store.persistRawPage(run,outcomes.map(({call,raw})=>({call,raw})));
      await store.settlePage(run,outcomes.map(({call,response})=>({call,usage:jevUsageV1(response.usage),settled_micro_usd:6})));
      await store.apply(run,outcomes.map(({call,response})=>({call,results:[mapSignalListeningJevResponseV1(call.inputs[0]!,run.context,configuration.configuration,response)]})));
      assert.equal(await store.finish(run),'completed');await store.release(run);
      const evidence=await loadSignalListeningLexiconSuggestionsV1(args);
      assert.equal(evidence.available,true);assert.equal(evidence.foreground_size,3);assert.equal(evidence.background_size,3);
      assert.ok(evidence.items.length>0);assert.ok(evidence.items.every(item=>item.foreground_roots===3&&item.background_roots===3&&item.lift===1));
      assert.ok(evidence.items.every(item=>!('body'in item)&&!('text'in item)&&!('root_id'in item)));
      await assert.rejects(loadSignalListeningLexiconSuggestionsV1({...args,workspace_id:randomUUID()}),/listening_forbidden/);
      await database.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[ctx.workspace_id]);
      try{
        const restricted=await loadSignalListeningLexiconSuggestionsV1(args);
        assert.equal(restricted.foreground_size,0);assert.equal(restricted.background_size,0);assert.deepEqual(restricted.items,[]);
      }catch(error){assert.match(String(error),/map_stale|context_changed|forbidden/);}
      await database.query("DELETE FROM signal_workspace_features WHERE workspace_id=$1 AND feature='mass_labeling'",[ctx.workspace_id]);
      await assert.rejects(loadSignalListeningLexiconSuggestionsV1(args),/listening_not_enabled/);
    }finally{await rm(dir,{recursive:true,force:true});}
  }});
});

test('lexical foreground follows versioned human remove, move and merge while outside conversation stays in background',{
  skip:process.env.NOISIA_R16_LISTENING_LEXICON_PG!=='true',timeout:600000,
},async()=>{
  const {withDiscoveryAdvanceFixtureV1}=await import('./signal-listening-discovery-advance.synthetic.fixture');
  const {createSignalListeningDiscoveryAdvanceStoreV1}=await import('../signal-listening-discovery-advance');
  const {activateSignalListeningServingSnapshotV1}=await import('../signal-listening-discovery-money');
  const human=await import('../signal-listening-human-edits');
  await withDiscoveryAdvanceFixtureV1(async f=>{
    const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
    const store=createSignalListeningDiscoveryAdvanceStoreV1({database:f.database,numeric_storage:f.storage});
    for(let i=1;i<=3;i++){
      const lease=await store.claim({database:f.database,execution_id:f.execution.id});assert.ok(lease);
      const subset=await store.ensureSubset({database:f.database,lease,generation_id:lease.source_generation_id});
      const numeric=await f.emptyNumeric(subset);await store.persistNumeric({database:f.database,lease,subset_id:subset.id,numeric});
      const round=await store.enqueue({database:f.database,lease,generation_id:lease.source_generation_id,expected_ordinal:lease.next_ordinal,
        expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,
        expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true});
      if(!round||round.status==='budget_exhausted')throw Error('fixture native round missing');
      await store.release({database:f.database,lease});await f.finishRound(round,3);await activateSignalListeningServingSnapshotV1({...f,round_id:round.id});
      if((await f.database.query('SELECT status FROM signal_listening_discovery_executions WHERE id=$1',[f.execution.id])).rows[0]!.status==='completed')break;
    }
    let ctx=await human.getSignalListeningHumanEditContextV1(access);assert.equal(ctx.can_edit,true);
    const category=ctx.configuration.questions.find(q=>q.topic_source==='discovered'&&q.domain==='category')!.key;
    const outside=ctx.configuration.questions.find(q=>q.topic_source==='defined'&&q.domain==='outside')!.key;
    assert.equal(ctx.configuration.questions.filter(q=>q.topic_source&&q.domain==='category').length,1);
    const originalConfiguration=ctx.expected.configuration_id;
    const read=(configuration_id:string)=>loadSignalListeningLexiconSuggestionsV1({...access,configuration_id,map_id:f.map_id});
    const labels=(configuration_id:string,root_id:string)=>human.readSignalListeningEffectiveTopicLabelsV1({...access,configuration_id,map_id:f.map_id,root_ids:[root_id],question_keys:[category]});
    const originals=(await f.database.query('SELECT * FROM signal_listening_answers WHERE workspace_id=$1 ORDER BY root_id,question_digest',[f.workspace_id])).rows;
    // One deterministic lexical root keeps the native discovery population
    // nonempty; UUID ordering must not decide which cases the test exercises.
    const outsideLexicon=new Set((await f.database.query<{id:string}>(`SELECT id FROM mentions WHERE workspace_id=$1 AND id=ANY($2::uuid[])
      AND NOT signal_mass_labeling_category_matches_v1(text_clean,ARRAY['0000'])`,[f.workspace_id,f.roots])).rows.map(row=>row.id));
    assert.equal(outsideLexicon.size,59);
    const initialForeground=f.roots.slice(0,3).filter(id=>outsideLexicon.has(id)).length;
    const root=f.roots.slice(0,3).find(id=>outsideLexicon.has(id))!;
    const negativeRoot=f.roots.slice(3).find(id=>outsideLexicon.has(id))!;assert.ok(root);assert.ok(negativeRoot);
    const initial=await read(originalConfiguration);assert.equal(initial.foreground_size,initialForeground);assert.equal(initial.background_size,60);
    const original=(await labels(originalConfiguration,root))[0]!;
    assert.equal((original.answer as {noul:number}).noul,.9);
    const removed=await human.correctSignalListeningTopicMembershipV1({...access,expected:ctx.expected,root_id:root,from_question_key:category,idempotency_key:randomUUID()});
    const negative=(await labels(removed.configuration_id,root))[0]!;
    assert.deepEqual(negative.answer,original.answer);assert.equal(negative.human_belongs,false);assert.equal(negative.effective_belongs,false);
    const afterRemove=await read(removed.configuration_id);
    assert.equal(afterRemove.foreground_size,initialForeground-1,'a positive provider answer cannot restore a human removal; outside membership is not category confirmation');
    assert.equal(afterRemove.background_size,60,'outside-only consumer conversation remains in the comparison population');
    assert.deepEqual(afterRemove.items,[],'fewer than three foreground roots do not meet the unchanged minimum');
    assert.deepEqual(await read(originalConfiguration),initial,'later decisions cannot leak into the original configuration revision');
    ctx=await human.getSignalListeningHumanEditContextV1(access);
    const moved=await human.correctSignalListeningTopicMembershipV1({...access,expected:ctx.expected,root_id:root,from_question_key:outside,to_question_key:category,idempotency_key:randomUUID()});
    const afterMove=await read(moved.configuration_id);assert.equal(afterMove.foreground_size,initialForeground);assert.equal(afterMove.background_size,60);
    assert.equal((await labels(moved.configuration_id,root))[0]!.human_belongs,true);
    const rawNegative=(await labels(moved.configuration_id,negativeRoot))[0]!;
    assert.equal((rawNegative.answer as {noul:number}).noul,.1);assert.equal(rawNegative.effective_belongs,false);
    ctx=await human.getSignalListeningHumanEditContextV1(access);
    const merged=await human.mergeSignalListeningTopicsV1({...access,expected:ctx.expected,source_question_keys:[category,outside],target_question_key:category,idempotency_key:randomUUID()});
    const afterMerge=await read(merged.configuration_id);assert.equal(afterMerge.foreground_size,59);assert.equal(afterMerge.background_size,60);
    assert.ok(afterMerge.items.length>0);assert.ok(afterMerge.items.every(item=>item.foreground_roots>=3&&item.foreground_roots<=59&&item.background_roots<=60));
    const mergedLabel=(await labels(merged.configuration_id,negativeRoot))[0]!;
    assert.deepEqual(mergedLabel.answer,rawNegative.answer);assert.equal(mergedLabel.human_belongs,true);assert.equal(mergedLabel.effective_belongs,true);
    assert.equal((await read(moved.configuration_id)).foreground_size,initialForeground,'a later merge does not alter the prior revision');

    assert.deepEqual((await f.database.query('SELECT * FROM signal_listening_answers WHERE workspace_id=$1 ORDER BY root_id,question_digest',[f.workspace_id])).rows,originals);
    await assert.rejects(loadSignalListeningLexiconSuggestionsV1({...access,configuration_id:merged.configuration_id,map_id:f.map_id,workspace_id:randomUUID()}),/listening_forbidden/);
    await assert.rejects(read(randomUUID()),/listening_configuration_unavailable/);
    await assert.rejects(loadSignalListeningLexiconSuggestionsV1({...access,configuration_id:merged.configuration_id,map_id:randomUUID()}),/map_stale/);
    await f.database.query("UPDATE users SET status='suspended' WHERE id=$1",[f.actor_user_id]);
    try{await assert.rejects(read(merged.configuration_id),/listening_forbidden/);}
    finally{await f.database.query("UPDATE users SET status='active' WHERE id=$1",[f.actor_user_id]);}
  },{population_count:60,initial_approved:60,additional_defined_topic:true,additional_defined_topic_domain:'outside',lexicon_terms:['0000']});
});
