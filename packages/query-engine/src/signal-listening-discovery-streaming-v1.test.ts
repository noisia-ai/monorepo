import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createListeningDiscoveryEvidenceStreamV1} from './signal-listening-discovery-streaming-v1';
import {buildListeningDiscoveryEvidenceV1,listeningDiscoveryPopulationDigestV1,LISTENING_DISCOVERY_POLICY_V1,
  type ListeningDiscoveryRootV1,type ListeningDiscoveryPolicyV1} from './signal-listening-discovery-v1';
import {buildListeningDiscoveryEditorialRequestV1} from './signal-listening-discovery-editorial-v1';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1} from './signal-listening-contracts';
import {signalTopicEditorialDigestV1} from './signal-topic-consolidation-editorial-v1';

const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
const vector=(a=1,b=0)=>[a,b,...new Array<number>(1022).fill(0)];
function root(n:number,a:number|null,b:number|null,category=true):ListeningDiscoveryRootV1{
  return{root_id:'root-'+String(n).padStart(6,'0'),input_sha256:sha('text-'+n),in_category:category,vector:vector(),
    evaluations:[a===null?null:{topic_key:'a',probability:a},b===null?null:{topic_key:'b',probability:b}].filter((r):r is NonNullable<typeof r>=>r!==null)};
}
function setup(roots:ListeningDiscoveryRootV1[],policy:ListeningDiscoveryPolicyV1=LISTENING_DISCOVERY_POLICY_V1,topic_keys=['unasked','b','a']){
  return{workspace_id:'workspace-1',vector_space_digest:sha('voyage-space'),map_digest:sha('map'),round:1,
    expected_root_count:roots.length,expected_population_digest:listeningDiscoveryPopulationDigestV1(roots),topic_keys,policy};
}
function run(roots:ListeningDiscoveryRootV1[],page=7,policy:ListeningDiscoveryPolicyV1=LISTENING_DISCOVERY_POLICY_V1,keys=['unasked','b','a']){
  const args=setup(roots,policy,keys),ordered=[...roots].sort((a,b)=>a.root_id<b.root_id?-1:1),stream=createListeningDiscoveryEvidenceStreamV1({...args,page_size:page});
  for(let offset=0;offset<ordered.length;offset+=page)stream.addFirstPage(ordered.slice(offset,offset+page));
  stream.finishFirstPass();
  for(let offset=0;offset<ordered.length;offset+=page)stream.addSecondPage(ordered.slice(offset,offset+page).map(({vector:_,...row})=>row));
  return{eager:buildListeningDiscoveryEvidenceV1({...args,roots}),actual:stream.finish(),memory:stream.inspectMemory()};
}
test('streaming is bit-for-bit identical for asked denominators, exact threshold, unasked topics and category orphans',()=>{
  const roots=[root(1,.7,null),root(2,.69,.1),root(3,null,.9,false),root(4,.1,.2,false)];
  for(const page of [1,2,3,1024]){const result=run(roots,page);assert.deepEqual(result.actual,result.eager);}
});
test('streaming preserves normalized centroids, cancellation and missing-confirmation statuses exactly',()=>{
  const roots=[root(1,1,0),root(2,1,0),root(3,0,1)];
  roots[0]!.vector=vector(100,0);roots[1]!.vector=vector(0,1);roots[2]!.vector=vector(-1,0);
  assert.deepEqual(run(roots,1).actual,run(roots,1).eager);
  roots[1]!.vector=vector(-1,0);
  const result=run(roots,2);assert.deepEqual(result.actual,result.eager);assert.equal(result.actual.topics[0]!.centroid_status,'cancelled_vectors');
  assert.equal(result.actual.topics[2]!.centroid_status,'no_confirmed_members');
});
test('streaming preserves every twin branch and counts the distinct category-only union without pair-root arrays',()=>{
  const population=[...Array.from({length:20},(_,i)=>root(i,1,1,i!==0)),...Array.from({length:10},(_,i)=>root(20+i,1,null))];
  const third=population.map(r=>({...r,evaluations:[...r.evaluations,{topic_key:'c',probability:1}]}));
  for(const rows of [population.slice(0,19),population,third]){
    const keys=rows===third?['a','b','c','unasked']:['a','b','unasked'];
    const result=run(rows,3,LISTENING_DISCOVERY_POLICY_V1,keys);assert.deepEqual(result.actual,result.eager);
  }
  for(const policy of [{...LISTENING_DISCOVERY_POLICY_V1,twin_jaccard:1,twin_coapproval:1},
    {...LISTENING_DISCOVERY_POLICY_V1,min_jointly_asked:31},
    {...LISTENING_DISCOVERY_POLICY_V1,approval:.9,examples_per_stratum:3},
    {...LISTENING_DISCOVERY_POLICY_V1,min_jointly_asked:2,min_jointly_approved:1,twin_coapproval:1,twin_jaccard:.1}]){
    const result=run(population,11,policy);assert.deepEqual(result.actual,result.eager);
  }
});
test('example order and complete editorial request bytes remain identical across pagination and metadata input order',()=>{
  const roots=Array.from({length:87},(_,i)=>({...root(i,i%3===0?.7:i%3===1?.3:.99,i%4===0?.7:.1,i%5!==0),vector:vector(i+1,90-i)}));
  const base=signalListeningBaseTemplateV1({category:'fixture',lexicon_terms:['text']});
  const configuration=validateSignalListeningConfigurationV1({...base,questions:[...base.questions,...['a','b','unasked'].map(key=>({key,type:'noul' as const,
    text:'Configured '+key,positive:'Evidence for '+key,negative:'No evidence',scope:'all' as const,origin:'agent' as const,human_locked:false,topic_source:'discovered' as const}))]});
  const common=setup(roots),args={...common,map_digest:signalTopicEditorialDigestV1(configuration)};
  const eager=buildListeningDiscoveryEvidenceV1({...args,roots:[...roots].reverse().map(r=>({...r,evaluations:[...r.evaluations].reverse()}))});
  const stream=createListeningDiscoveryEvidenceStreamV1({...args,page_size:13});
  for(let offset=0;offset<roots.length;offset+=13)stream.addFirstPage(roots.slice(offset,offset+13));
  stream.finishFirstPass();for(let offset=0;offset<roots.length;offset+=11)stream.addSecondPage(roots.slice(offset,offset+11).map(({vector:_,...r})=>({...r,evaluations:[...r.evaluations].reverse()})));
  const actual=stream.finish();assert.deepEqual(actual,eager);
  const used=[...new Set(eager.topics.flatMap(t=>[...t.accepted_examples,...t.rejected_examples]))];
  const excerpts=used.map(id=>{const n=Number(id.slice(5));return{root_id:id,text:'text-'+n,source_text_sha256:sha('text-'+n)};});
  const expected=buildListeningDiscoveryEditorialRequestV1({configuration,evidence:eager,orphan_groups:[],excerpts});
  const request=buildListeningDiscoveryEditorialRequestV1({configuration,evidence:actual,orphan_groups:[],excerpts});
  assert.deepEqual(request,expected);assert.equal(request.request_body,expected.request_body);assert.equal(request.request_digest,expected.request_digest);
});
test('streaming preserves null rates when the category is empty',()=>{
  const {actual,eager}=run([root(1,1,0,false)],1);assert.deepEqual(actual,eager);assert.equal(actual.orphan_rate,null);assert.equal(actual.twin_root_rate,null);
});
test('empty evaluation lists are valid missing candidates, not negative answers, in all-empty and mixed populations',()=>{
  const empty={...root(1,null,null),evaluations:[]};
  for(const roots of [[empty],[empty,root(2,.9,.1),{...root(3,null,null,false),evaluations:[]}]]){
    const {actual,eager}=run(roots,1);assert.deepEqual(actual,eager);
    assert.equal(actual.root_count,roots.length);assert.equal(actual.root_input_sha256[empty.root_id],empty.input_sha256);
    assert.deepEqual(actual.orphan_root_ids,[empty.root_id]);assert.ok(actual.topics.every(t=>!t.rejected_examples.includes(empty.root_id)));
  }
});
test('streaming rejects incomplete census, duplicate or unordered pages, invalid evaluations and vectors',()=>{
  const good=root(1,1,0),args=setup([good]);
  for(const bad of [{...good,evaluations:null as never},{...good,evaluations:[...good.evaluations,good.evaluations[0]!]},{...good,evaluations:[{topic_key:'unknown',probability:1}]},
    {...good,evaluations:[{topic_key:'a',probability:NaN}]},{...good,evaluations:[{topic_key:'a',probability:null as never}]},{...good,vector:[1,2]},{...good,vector:new Array(1024).fill(0)},
    {...good,vector:[Infinity,...new Array(1023).fill(0)]},{...good,input_sha256:'invalid'}]){
    assert.throws(()=>createListeningDiscoveryEvidenceStreamV1(args).addFirstPage([bad]),/listening_discovery_/);
  }
  const duplicate=createListeningDiscoveryEvidenceStreamV1({...args,expected_root_count:2});duplicate.addFirstPage([good]);assert.throws(()=>duplicate.addFirstPage([good]),/root_invalid/);
  const backwards=createListeningDiscoveryEvidenceStreamV1({...args,expected_root_count:2});backwards.addFirstPage([root(2,1,0)]);assert.throws(()=>backwards.addFirstPage([good]),/stream_order_invalid/);
  assert.throws(()=>createListeningDiscoveryEvidenceStreamV1(args).finishFirstPass(),/input_invalid/);
  const changed=createListeningDiscoveryEvidenceStreamV1({...args,expected_population_digest:sha('changed')});changed.addFirstPage([good]);assert.throws(()=>changed.finishFirstPass(),/population_changed/);
  assert.throws(()=>createListeningDiscoveryEvidenceStreamV1({...args,page_size:0}),/input_invalid/);
  assert.throws(()=>createListeningDiscoveryEvidenceStreamV1({...args,page_size:1}).addFirstPage([good,root(2,1,0)]),/page_invalid/);
});
test('second pass cannot silently change categories, probability values, root inputs or coverage',()=>{
  const good=root(1,.8,.1),args=setup([good]);
  for(const bad of [{...good,in_category:false},{...good,input_sha256:sha('changed')},{...good,evaluations:[{topic_key:'a',probability:.9},{topic_key:'b',probability:.1}]}]){
    const stream=createListeningDiscoveryEvidenceStreamV1(args);stream.addFirstPage([good]);stream.finishFirstPass();
    assert.throws(()=>{stream.addSecondPage([bad]);stream.finish();},/population_changed|snapshot_changed/);
  }
  const stream=createListeningDiscoveryEvidenceStreamV1(args);stream.addFirstPage([good]);stream.finishFirstPass();assert.throws(()=>stream.finish(),/snapshot_changed/);
});
test('the streaming accumulator does not retain document vectors across many pages (actual GC proof)',()=>{
  const helper=new URL('./signal-listening-discovery-streaming-v1.ts',import.meta.url).href;
  const eager=new URL('./signal-listening-discovery-v1.ts',import.meta.url).href;
  const script=`import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
   import {createListeningDiscoveryEvidenceStreamV1} from ${JSON.stringify(helper)};
   import {listeningDiscoveryPopulationDigestV1} from ${JSON.stringify(eager)};
   const digest=s=>'sha256:'+createHash('sha256').update(s).digest('hex'),n=4096,page=32;
   const metadata=Array.from({length:n},(_,i)=>({root_id:'root-'+String(i).padStart(6,'0'),input_sha256:digest('text-'+i),in_category:true,evaluations:[{topic_key:'a',probability:.9}]}));
   let eagerExtras=Array.from({length:64},()=>({vector:[1,...new Array(1023).fill(0)]}));const refs=eagerExtras.map(r=>new WeakRef(r.vector));
   const stream=createListeningDiscoveryEvidenceStreamV1({workspace_id:'workspace',vector_space_digest:digest('space'),map_digest:digest('map'),round:1,expected_root_count:n,
    expected_population_digest:listeningDiscoveryPopulationDigestV1(metadata),topic_keys:['a','unasked'],page_size:page,roots:eagerExtras});eagerExtras=null;
   for(let offset=0;offset<n;offset+=page){let rows=metadata.slice(offset,offset+page).map(r=>({...r,vector:[1,...new Array(1023).fill(0)]}));
    refs.push(...rows.map(r=>new WeakRef(r.vector)));stream.addFirstPage(rows);rows=null;await new Promise(setImmediate);
    assert.ok(stream.inspectMemory().retained_vector_values<=2*1024);}
   stream.finishFirstPass();for(let i=0;i<4;i++){global.gc();await new Promise(setImmediate);}
   assert.ok(refs.filter(ref=>ref.deref()).length<=page,'only a live page may retain input vectors; the corpus must be collectible');
   for(let offset=0;offset<n;offset+=page)stream.addSecondPage(metadata.slice(offset,offset+page));
   const result=stream.finish();assert.equal(result.root_count,n);assert.equal(result.topics[0].confirmed_root_ids.length,n);
   assert.ok(stream.inspectMemory().retained_example_ids<=2*2*8);assert.equal(stream.inspectMemory().peak_page_roots,page);`;
  const child=spawnSync(process.execPath,['--expose-gc','--import','tsx','--input-type=module','-e',script],{encoding:'utf8',timeout:60000});
  assert.equal(child.status,0,child.stderr||child.stdout);
});
