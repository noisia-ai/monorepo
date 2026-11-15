import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1} from './signal-listening-contracts';
import {signalTopicEditorialDigestV1 as digest} from './signal-topic-consolidation-editorial-v1';
import {buildListeningDiscoveryEvidenceV1,listeningDiscoveryPopulationDigestV1} from './signal-listening-discovery-v1';
import {applyListeningDiscoveryEditorialOutputV1,buildListeningDiscoveryEditorialRequestV1} from './signal-listening-discovery-editorial-v1';

const localized={name:'Leisure',definition:'Shared leisure occasions'};
function fixture(locked=false){
  const base=signalListeningBaseTemplateV1({category:'invented category',lexicon_terms:['invented']});
  const config=validateSignalListeningConfigurationV1({...base,themes:[{key:'leisure',name:'Leisure',origin:'agent',human_locked:locked,
    localization:{original_language:'en',original:{name:'Leisure'},en:{name:'Leisure'},es:{name:'Ocio'}}}],
    questions:[...base.questions,{key:'foo',type:'noul',text:'Is this shared leisure?',positive:'Shared leisure',negative:'Other matters',
      scope:'all',origin:'agent',human_locked:locked,topic_source:'discovered',domain:'category',parent_theme_key:'leisure',
      localization:{original_language:'en',original:localized,en:localized,es:{name:'Ocio',definition:'Ocasiones de ocio compartido'}}},
    {key:'bar',type:'noul',text:'Is this a defined topic?',positive:'Defined topic',negative:'Other matters',scope:'all',origin:'brand_os',human_locked:true,
      topic_source:'defined',domain:'adjacent'}]});
  const excerpts=['Invented shared leisure.', 'Invented orphan matter.'].map((text,i)=>({root_id:`root-${i}`,
    text,source_text_sha256:`sha256:${createHash('sha256').update(text).digest('hex')}`}));
  const roots=excerpts.map((row,i)=>({root_id:row.root_id,input_sha256:row.source_text_sha256,in_category:true,
    vector:[1,...new Array<number>(1023).fill(0)],evaluations:[{topic_key:'foo',probability:i?0.1:0.9},{topic_key:'bar',probability:i?0.1:0.9}]}));
  const evidence=buildListeningDiscoveryEvidenceV1({workspace_id:'workspace',vector_space_digest:digest('voyage'),map_digest:digest(config),
    round:1,expected_root_count:2,expected_population_digest:listeningDiscoveryPopulationDigestV1(roots),topic_keys:['foo','bar'],roots});
  const orphan_groups=[{group_key:'orphan_one',root_count:1,terms:['invented'],representative_root_ids:['root-1']}];
  const args={configuration:config,evidence,orphan_groups,excerpts};
  const output={contract_version:'listening-discovery-editorial-output-v1',retained_topic_keys:locked?['foo']:[],topics:locked?[]:[{key:'foo',source_topic_keys:['foo'],orphan_group_keys:[],
    question:'Is this shared leisure?',positive:'Shared leisure',negative:'Other matters',domain:'category',theme_key:'leisure',
    original_language:'en',original:localized,en:localized,es:{name:'Ocio',definition:'Ocasiones de ocio compartido'}}],
    themes:locked?[]:[{key:'leisure',name:'Leisure',original_language:'en',original_name:'Leisure',en_name:'Leisure',es_name:'Ocio'}]};
  return {args,output,request:buildListeningDiscoveryEditorialRequestV1(args)};
}

test('seals one Sonnet request with topic counts, twins and orphan evidence, without document vectors',()=>{
  const {request}=fixture();const body=JSON.parse(request.request_body),data=JSON.parse(body.messages[0].content);
  assert.equal(body.model,'claude-sonnet-4-6');assert.equal(body.stream,false);
  assert.equal(data.topics.length,2);assert.equal(data.orphan_groups[0].examples[0].text,'Invented orphan matter.');
  assert.equal(data.topics[0].centroid,undefined);assert.equal(data.topics[0].confirmed_root_ids,undefined);
  assert.equal(request.request_digest,digest(body));
});

test('accepts the full discovered map while preserving defined and base questions byte-for-byte',()=>{
  const {request,output}=fixture(),result=applyListeningDiscoveryEditorialOutputV1(request,output);
  for(const question of request.configuration.questions.filter(q=>q.topic_source!=='discovered'))
    assert.deepEqual(result.questions.find(q=>q.key===question.key),question);
  assert.equal(result.questions.find(q=>q.key==='foo')!.parent_theme_key,'leisure');
});

test('new topics require a real orphan group and retain the previous map as append-only retirement',()=>{
  const {request,output}=fixture();const original=output.topics[0]!;
  const merged={...output,topics:[{...original,key:'redefined',source_topic_keys:['foo']},
    {...original,key:'new_matter',source_topic_keys:[],orphan_group_keys:['orphan_one'],domain:'outside'}]};
  const result=applyListeningDiscoveryEditorialOutputV1(request,merged);
  assert.ok(result.retired_question_keys.includes('foo'));assert.equal(result.questions.find(q=>q.key==='new_matter')!.domain,'outside');
  for(const groups of [[],['invented_group']])assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(request,
    {...merged,topics:[merged.topics[0]!,{...merged.topics[1]!,orphan_group_keys:groups}]}),/topic_conflict/u);
});

test('rejects omitted, multiply assigned, rebound and defined topic keys',()=>{
  const {request,output}=fixture(),topic=output.topics[0]!;
  assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(request,{...output,topics:[]}),/coverage_incomplete/u);
  assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(request,{...output,topics:[topic,{...topic,key:'another'}]}),/topic_conflict/u);
  assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(request,{...output,topics:[{...topic,key:'bar'}]}),/topic_conflict/u);
  assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(request,{...output,topics:[{...topic,source_topic_keys:['bar']}]}),/topic_conflict/u);
});

test('a human lock preserves metadata and forbids renaming, contrast edits, movement and merges',()=>{
  const {request,output}=fixture(true),topic=fixture().output.topics[0]!;
  assert.deepEqual(applyListeningDiscoveryEditorialOutputV1(request,output).questions.find(q=>q.key==='foo'),
    request.configuration.questions.find(q=>q.key==='foo'));
  for(const change of [{key:'renamed'}, {positive:'Changed'}, {domain:'outside'}, {orphan_group_keys:['orphan_one']}])
    assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(request,{...output,topics:[{...topic,...change}]}),/human_edit_protected/u);
  assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(request,{...output,themes:[{key:'leisure',name:'Replaced',
    original_language:'en',original_name:'Replaced',en_name:'Replaced',es_name:'Replaced'}]}),/theme_conflict/u);
  assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(request,{...output,retained_topic_keys:[]}),/human_edit_protected/u);
  const {args}=fixture(true),configuration=validateSignalListeningConfigurationV1({...args.configuration,
    questions:args.configuration.questions.map(q=>{if(q.key!=='foo')return q;
      const {parent_theme_key:_,localization:__,...retained}=q;return retained;})});
  const legacy=buildListeningDiscoveryEditorialRequestV1({...args,configuration,evidence:{...args.evidence,map_digest:digest(configuration)}});
  assert.deepEqual(applyListeningDiscoveryEditorialOutputV1(legacy,output).questions.find(q=>q.key==='foo'),
    configuration.questions.find(q=>q.key==='foo'));
});

test('cannot change request scope or configuration after sealing the provider payload',()=>{
  const {request,output}=fixture();
  for(const altered of [{...request,evidence:{...request.evidence,workspace_id:'foreign'}},
    {...request,configuration:{...request.configuration,instructions:'Changed'}},
    {...request,orphan_groups:[]}])assert.throws(()=>applyListeningDiscoveryEditorialOutputV1(altered,output),/request_invalid/u);
});

test('validates original excerpt bytes and forbids excerpts outside the sampled evidence',()=>{
  const {args}=fixture();
  assert.throws(()=>buildListeningDiscoveryEditorialRequestV1({...args,excerpts:[{...args.excerpts[0]!,text:'Changed'},args.excerpts[1]!]}),/excerpt_invalid/u);
  assert.throws(()=>buildListeningDiscoveryEditorialRequestV1({...args,excerpts:args.excerpts.slice(1)}),/excerpt_missing/u);
  const extra={root_id:'extra',text:'Extra',source_text_sha256:`sha256:${createHash('sha256').update('Extra').digest('hex')}`};
  assert.throws(()=>buildListeningDiscoveryEditorialRequestV1({...args,excerpts:[...args.excerpts,extra]}),/excerpt_invalid/u);
  const swapped={...args.excerpts[0]!,text:'Changed',source_text_sha256:`sha256:${createHash('sha256').update('Changed').digest('hex')}`};
  assert.throws(()=>buildListeningDiscoveryEditorialRequestV1({...args,excerpts:[swapped,args.excerpts[1]!]}),/excerpt_invalid/u);
});
