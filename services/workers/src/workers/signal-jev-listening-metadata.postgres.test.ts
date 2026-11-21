import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from '../../../../infrastructure/db/migrations/signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../../../../infrastructure/db/signal-listening-configuration';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../../../../infrastructure/db/signal-listening-runs';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,mapSignalListeningJevResponseV1,
 signalListeningRequestDigestV1,entityContextDigestV1,type SignalListeningResultV1} from '@noisia/query-engine';
import {jevUsageV1} from './signal-jev-labeling-page';
import {jevListeningSqlMetadataBytesV3} from './signal-jev-phase-geometry-v3';

/** Observe REAL native serializers and SQL; this test never activates the phase
 * profile through a wrapped DB/store or invokes an HTTP/paid provider. */
test('Listening metadata PostgreSQL serializes four disjoint per-call lanes and five exact mixed query frames',{
 skip:process.env.NOISIA_R16_LISTENING_METADATA_SQL_PG!=='true',timeout:600000,
},async()=>{
 await runMassLabelingAcceptanceFixtureV1('product',{seed_published_at:'2026-11-21T00:00:00.000Z',beforeProcessing:async ctx=>{
  await ctx.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const access={database:ctx.database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  const configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:0,
   configuration:signalListeningBaseTemplateV1({category:'synthetic',lexicon_terms:['synthetic']}),provenance:'human'});
  const queued=await requestSignalListeningV1({...access,configuration_id:configuration.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
  const frames:Array<{lane:string;bytes:number;sha256:string}>=[];
  const lane=(sql:string)=>sql.includes("SET status='settled',usage=x.usage")?'settle':sql.includes(' replay_ok')?'replay':
   sql.includes('SET results_applied=true,results=page.results')?'results':sql.includes('INSERT INTO signal_listening_answers')?'answers':sql.includes('INSERT INTO signal_listening_failures')?'failures':undefined;
  const capture=(args:unknown[])=>{const sql=args[0];if(typeof sql!=='string')return;const name=lane(sql);if(!name)return;
   const params=args[1];assert.ok(Array.isArray(params));const value=params.at(-1);if(typeof value!=='string')throw Error('SQL JSON missing');frames.push({lane:name,bytes:Buffer.byteLength(value),sha256:createHash('sha256').update(value).digest('hex')});};
  // Preserve every actual PG method/argument; only inspect the five known JSON
  // parameters. No fake authority rows, SQL rewriting, caches or mocked result.
  const tracked=<T extends object>(target:T):T=>new Proxy(target,{get(object,key){const value=Reflect.get(object,key,object);
   if(key==='query'&&typeof value==='function')return(...args:unknown[])=>{capture(args);return Reflect.apply(value,object,args);};
   return typeof value==='function'?value.bind(object):value;}});
  const db=new Proxy(ctx.database,{get(object,key){if(key==='connect')return async()=>tracked(await object.connect());
   const value=Reflect.get(object,key,object);if(key==='query'&&typeof value==='function')return(...args:unknown[])=>{capture(args);return Reflect.apply(value,object,args);};
   return typeof value==='function'?value.bind(object):value;}});
  const blobs=new Map<string,string>(),sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
  const rawPages={reference:(a:{raw_sha256:string})=>({storage_key:'synthetic/'+a.raw_sha256.slice(7)}),
   store:async(a:{raw_text:string;raw_sha256:string;size_bytes:number})=>{assert.equal(sha(a.raw_text),a.raw_sha256);assert.equal(Buffer.byteLength(a.raw_text),a.size_bytes);blobs.set(a.raw_sha256,a.raw_text);return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};},
   load:async(a:{sha256:string})=>{const text=blobs.get(a.sha256);assert.notEqual(text,undefined);return text!;}};
  const store=createSignalListeningStoreV1({database:db,rawPages,page_size:200,storeRaw:async()=>{throw Error('one native RAW page required');}}),run=await store.claim(queued.run_id);assert.ok(run);
  const inputs=(await store.inputs(run)).slice(0,2);assert.equal(inputs.length,2);
  const calls=await store.reserve(run,inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,configuration.configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
   return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000};}));assert.equal(calls.length,2);
  await store.markSubmitting(run,calls);
  const responses=calls.map(call=>({model:configuration.configuration.model,usage:{input_tokens:1,output_tokens:0,extra:{nested:[1e20,'é😀',String.fromCharCode(0xd800)]}},
   answers:Object.fromEntries(Object.entries(buildSignalListeningJevRequestV1(call.inputs[0]!,configuration.configuration).questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:1,extra:{preserved:[1e20,'\"',String.fromCharCode(0)]}}:
    {type:'choice' as const,choice:Object.keys(q.criteria)[0]!,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,i)=>[k,i===0?1:0])),extra:{preserved:[1e20,'é😀']}}]))}));
  const bodies=responses.map(r=>JSON.stringify(r).replaceAll('100000000000000000000','1e20'));assert.ok(bodies.every(body=>body.includes('1e20')));assert.ok(bodies.every(body=>Buffer.byteLength(body)<=16384));
  await store.persistRawPage(run,calls.map((call,i)=>({call,raw:JSON.stringify({body:bodies[i],http_status:200,latency_ms:100})})));
  const pages=calls.map((call,i)=>({call,results:[i===0?mapSignalListeningJevResponseV1(call.inputs[0]!,run.context,configuration.configuration,responses[i]!):
   {root_id:call.inputs[0]!.root_id,input_digest:call.inputs[0]!.input_digest,entity_context_digest:entityContextDigestV1(run.context),status:'error' as const,answers:{},question_digests:{...call.inputs[0]!.question_digests},error_code:'jev_response_invalid'}]satisfies SignalListeningResultV1[]}));
  frames.length=0;
  await store.settlePage(run,calls.map((call,i)=>({call,usage:jevUsageV1(responses[i]!.usage),settled_micro_usd:1,stop_reason:i===0?'completed':'jev_response_invalid'})));
  await store.apply(run,pages);
  assert.deepEqual(frames.map(f=>f.lane).sort(),['answers','failures','replay','results','settle']);
  const J=calls.map((call,i)=>6*Buffer.byteLength(bodies[i]!)+jevListeningSqlMetadataBytesV3(call.inputs[0]!.question_keys.length));
  let bytes=0;for(const frame of frames){const applicable=frame.lane==='answers'?[J[0]!]:frame.lane==='failures'?[J[1]!]:J;
   const actual=frame.bytes;assert.ok(actual<=1+applicable.reduce((n,v)=>n+v,0),frame.lane+' actual JSON bytes exceed immutable metadata/body bound');bytes+=actual;}
  assert.ok(5*bytes<=20*J.reduce((n,v)=>n+v,0)+25,'four payload lanes plus exactly five array frames, five copies each');
  // SQL observation retains ONLY bounded scalar lengths/hashes, never JSON,
  // PG params, parsed response trees or aliases beyond their owner's await.
  assert.ok(frames.every(frame=>/^[0-9a-f]{64}$/u.test(frame.sha256)));
  const stored=(await db.query<{answer:unknown}>('SELECT answer FROM signal_listening_answers WHERE run_id=$1 ORDER BY question_key',[run.id])).rows;
  assert.deepEqual(stored.map(row=>row.answer),Object.entries(pages[0]!.results[0]!.answers).sort(([a],[b])=>a.localeCompare(b)).map(([,answer])=>answer));
  const storedUsage=(await db.query<{usage:unknown}>('SELECT usage FROM signal_labeling_calls WHERE id=$1',[calls[0]!.id])).rows[0]!.usage;
  assert.deepEqual(Reflect.get(storedUsage as object,'extra'),responses[0]!.usage.extra);
  await store.finish(run);await store.release(run);
 }});
});
