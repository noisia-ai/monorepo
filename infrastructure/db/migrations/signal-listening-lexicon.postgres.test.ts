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

test('native lexical evidence uses configured category topics without trigger/barrier and retains tenant and feature guards',{
  skip:process.env.NOISIA_R16_LISTENING_LEXICON_PG!=='true',timeout:180000,
},async()=>{
  await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
    const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
    await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
    const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['unmatchedlexicalterm']});
    const configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:{...base,
      questions:[...base.questions,{key:'category_topic',type:'noul',text:'Category conversation?',positive:'Bicycle conversation',negative:'Other content',
        scope:'all',origin:'brand_os',human_locked:false,topic_source:'defined',domain:'category'}]}});
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
