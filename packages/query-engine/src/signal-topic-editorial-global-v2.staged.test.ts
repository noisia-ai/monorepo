import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {signalTopicEditorialDigestV1 as sha,type SignalTopicEditorialScreeningGroupV1} from './signal-topic-consolidation-editorial-v1';
import {buildSignalTopicEditorialScreeningPlanV2,validateSignalTopicEditorialGroupOutputV2} from './signal-topic-consolidation-editorial-v2';
import {buildSignalTopicEditorialGlobalMergeReviewsV2,buildSignalTopicEditorialGlobalShardsV2,
  applySignalTopicEditorialGlobalRootV2,buildSignalTopicEditorialGlobalCatalogInputV2,composeSignalTopicEditorialGlobalShardOutcomesV2,
  summarizeSignalTopicEditorialGlobalMergeRoundV2,validateSignalTopicEditorialGlobalMergeResultV2,validateSignalTopicEditorialGlobalShardResultV2,
  buildSignalTopicEditorialGlobalRankingReviewV2,validateSignalTopicEditorialGlobalRankingResultV2,
  applySignalTopicEditorialGlobalRankingV2,
  type SignalTopicEditorialGlobalShardResultV2,type SignalTopicEditorialGlobalUnitV2} from './signal-topic-editorial-global-v2';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={brand_name:'Example',default_locale:'es-MX',summary:'Producto de ejemplo.',audiences:['hogares'],categories:['tecnología'],
  competitors:[],positive_anchors:['uso'],negative_anchors:[],abstention_anchors:[]};
function group(n:number,routing?:{community_key?:string;neighbors?:Array<{group_key:string;similarity:number}>}):SignalTopicEditorialScreeningGroupV1{
  const text=`Mención de ejemplo ${n}`,root_id=id(n+1),chunk_sha256=`sha256:${createHash('sha256').update(text).digest('hex')}`;
  const evidence=[{ref_id:sha({root_id,chunk_index:0,start:0,end:text.length,chunk_sha256}),root_id,chunk_index:0,
    start:0,end:text.length,chunk_sha256,text,locale:'es-MX',platform:'reddit',occurred_at:'2026-09-20T00:00:00Z'}];
  const scope_counts={brand:1,competitor:0,category:0,unknown:0},locale_counts=[{key:'es-MX',count:1}],
    platform_counts=[{key:'reddit',count:1}],month_counts=[{key:'2026-09',count:1}],brand_affinity={positive:[],negative:[],abstention:[]},
    neighbors:SignalTopicEditorialScreeningGroupV1['neighbors']=routing?.neighbors??[],metrics={cohesion:null,outlier_ratio:null};
  const dossier={contract_version:'signal-topic-group-dossier-v1',scope_counts,locale_counts,platform_counts,month_counts,
    brand_affinity,neighbors,metrics,evidence:evidence.map(({text:_text,...item})=>item)};
  return {group_key:`open:g-${n}`,lane:'open',group_digest:sha(['group',n]),source_dossier_digest:sha(['source-dossier',n]),
    dossier_digest:sha(dossier),community_key:routing?.community_key??'community',root_count:1,chunk_count:1,terms:['term-'+n],scope_counts,
    locale_counts,platform_counts,month_counts,brand_affinity,neighbors,metrics,evidence};
}
function makeUnits(total:number,errors:number[]=[],routing?:Array<{community_key?:string;neighbors?:Array<{group_key:string;similarity:number}>}>):SignalTopicEditorialGlobalUnitV2[]{
  const groups=Array.from({length:total},(_,index)=>group(index,routing?.[index])),plan=buildSignalTopicEditorialScreeningPlanV2({workspace_id:id(80001),
    run_id:id(80002),expected_group_count:total,source_context_digest:sha('source'),editorial_context_digest:sha(context),context,groups});
  return plan.requests.map((request,index)=>{
    if(errors.includes(index))return {request,decision:null,technical_error_code:'provider_timeout'};
    const decision=validateSignalTopicEditorialGroupOutputV2(request,{contract_version:'signal-topic-editorial-group-output-v2',
      group_id:request.receipt.group_id,disposition:'topic',candidate:{label:`Asunto ${index}`,definition:`Definición ${index}`,locale:'es-MX'},
      confidence:0.8,rationale:'Cita de la mención.',cited_evidence_ids:[request.receipt.evidence[0]!.evidence_id]});
    return {request,decision,technical_error_code:null};
  });
}
function shardResult(shard:ReturnType<typeof buildSignalTopicEditorialGlobalShardsV2>[number]):SignalTopicEditorialGlobalShardResultV2{
  return validateSignalTopicEditorialGlobalShardResultV2({shard,value:{contract_version:'signal-topic-editorial-global-shard-result-v2',
    concepts:shard.groups.map(group=>({concept_key:`topic-${group.id}`,kind:'topic',label:`Tema ${group.id}`,definition:'Asunto verificable.',
      members:[{group_key:group.group_key,cited_ref_ids:[group.evidence[0]!.ref_id],rationale:'Esta cita corresponde sólo a este grupo.'}]})),
    noise:[],unresolved:[]}});
}

test('bounded shards conserve complete group coverage and keep technical failures out of Noise',()=>{
  const source=makeUnits(7,[2,6]),shards=buildSignalTopicEditorialGlobalShardsV2({units:source,expected_group_count:7,batch_size:3});
  assert.equal(shards.length,3);
  assert.deepEqual(shards.flatMap(item=>item.group_keys).sort(),source.map(item=>item.request.receipt.group_key).sort());
  assert.equal(shards.flatMap(item=>item.technical_errors).length,2);
  assert.deepEqual(shards.flatMap(item=>item.technical_errors).map(item=>item.code),['provider_timeout','provider_timeout']);
  const results=shards.filter(shard=>shard.groups.length>0).map(shard=>{
    const result=shardResult(shard);
    assert.equal(result.concepts.length+result.noise.length+result.unresolved.length,shard.groups.length);
    assert.equal(shard.request_body?.includes('provider_timeout')??false,shard.technical_errors.length>0);
    return {batch_index:shard.batch_index,result};
  });
  const outcomes=composeSignalTopicEditorialGlobalShardOutcomesV2({shards,results});
  assert.equal(outcomes.length,7);
  assert.equal(outcomes.filter(item=>item.status==='technical_error').length,2);
  assert.equal(outcomes.filter(item=>item.status==='topic').length,5);
  assert.equal(outcomes.filter(item=>item.status==='noise'||item.status==='insufficient_evidence').length,0);
  const requests=shards.filter(shard=>shard.request_body!==null).map(shard=>JSON.parse(shard.request_body!));
  assert.equal(requests.every(request=>JSON.stringify(request.output_config.format.schema)===JSON.stringify(requests[0]!.output_config.format.schema)),true);
  assert.equal(requests.every(request=>JSON.parse(request.messages[0].content).context.brand_name==='Example'),true);
});

test('centroid-neighbor routing places related source groups together without asserting they should merge',()=>{
  const routing=[
    {community_key:'left',neighbors:[{group_key:'open:g-3',similarity:0.92}]},
    {community_key:'other-a',neighbors:[]},
    {community_key:'other-b',neighbors:[]},
    {community_key:'right',neighbors:[{group_key:'open:g-0',similarity:0.92}]},
  ];
  const source=makeUnits(4,[],routing),shards=buildSignalTopicEditorialGlobalShardsV2({units:source,expected_group_count:4,batch_size:2});
  const together=shards.find(shard=>shard.group_keys.includes('open:g-0'))!;
  assert.equal(together.group_keys.includes('open:g-3'),true);
  assert.equal(together.groups.find(item=>item.group_key==='open:g-0')!.community_key,'left');
  assert.equal(together.groups.find(item=>item.group_key==='open:g-0')!.neighbors[0]!.similarity,0.92);
});

test('merge routing translates KNN source-group links to concept keys across communities',()=>{
  const routing=[
    {community_key:'community-a',neighbors:[{group_key:'open:g-2',similarity:0.94}]},
    {community_key:'community-b',neighbors:[]},
    {community_key:'community-c',neighbors:[]},
  ];
  const shards=buildSignalTopicEditorialGlobalShardsV2({units:makeUnits(3,[],routing),expected_group_count:3,batch_size:1});
  const results=shards.map(shard=>({batch_index:shard.batch_index,result:shardResult(shard)}));
  const reviews=buildSignalTopicEditorialGlobalMergeReviewsV2({shards,results,round:1,fan_in:2});
  const routed=reviews.find(review=>review.nodes.some(node=>node.members.some(member=>member.group_key==='open:g-0')))!;
  assert.equal(routed.nodes.some(node=>node.members.some(member=>member.group_key==='open:g-2')),true);
  assert.equal(routed.nodes.some(node=>node.members.some(member=>member.group_key==='open:g-1')),false);
  assert.equal(routed.nodes.flatMap(node=>node.members).length,2);
  assert.equal(reviews.flatMap(review=>review.nodes).length,3);
});

test('merge routing deduplicates cross-group links by maximum similarity deterministically',()=>{
  const member=(group_key:string,neighbors:Array<{group_key:string;similarity:number}>)=>({group_key,cited_ref_ids:[`ref-${group_key}`],
    rationale:'Cita del grupo.',community_key:`community-${group_key}`,neighbors});
  const concepts=[
    {concept_key:'topic-a',kind:'topic' as const,label:'A',definition:'Definición A',priority_rationale:null,priority_rank:null,
      source_concept_keys:['source-a'],members:[member('open:g-0',[{group_key:'open:g-2',similarity:0.99},
        {group_key:'open:g-3',similarity:0.8}]),member('open:g-1',[{group_key:'open:g-2',similarity:0.2}])]},
    {concept_key:'topic-b',kind:'topic' as const,label:'B',definition:'Definición B',priority_rationale:null,priority_rank:null,
      source_concept_keys:['source-b'],members:[member('open:g-2',[])]},
    {concept_key:'topic-c',kind:'topic' as const,label:'C',definition:'Definición C',priority_rationale:null,priority_rank:null,
      source_concept_keys:['source-c'],members:[member('open:g-3',[])]},
  ];
  const args={prior_nodes:concepts,snapshot_digest:sha('snapshot'),context,round:2,fan_in:2};
  const first=buildSignalTopicEditorialGlobalMergeReviewsV2(args),second=buildSignalTopicEditorialGlobalMergeReviewsV2(args);
  const routed=first.find(review=>review.nodes.some(node=>node.concept_key==='topic-a'))!;
  assert.deepEqual(routed.nodes.map(node=>node.concept_key).sort(),['topic-a','topic-b']);
  assert.deepEqual(first.map(review=>review.nodes.map(node=>node.concept_key)),second.map(review=>review.nodes.map(node=>node.concept_key)));
  assert.equal(first.flatMap(review=>review.nodes).length,3);
});

test('shard result rejects cross-group citations, omissions, duplicates, and ungrounded Noise',()=>{
  const shards=buildSignalTopicEditorialGlobalShardsV2({units:makeUnits(3),expected_group_count:3,batch_size:2}),shard=shards[0]!;
  const a=shard.groups[0]!,b=shard.groups[1]!;
  const base={contract_version:'signal-topic-editorial-global-shard-result-v2',concepts:[{concept_key:'merged',kind:'topic',label:'Tema',
    definition:'Definición',members:[{group_key:a.group_key,cited_ref_ids:[a.evidence[0]!.ref_id],rationale:'A'},{group_key:b.group_key,
      cited_ref_ids:[b.evidence[0]!.ref_id],rationale:'B'}]}],noise:[],unresolved:[]};
  assert.equal(validateSignalTopicEditorialGlobalShardResultV2({shard,value:base}).concepts[0]!.members.length,2);
  assert.throws(()=>validateSignalTopicEditorialGlobalShardResultV2({shard,value:{...base,concepts:[{...base.concepts[0],members:[
    {group_key:a.group_key,cited_ref_ids:[b.evidence[0]!.ref_id],rationale:'foreign'}]}]}}),/citation_invalid/u);
  assert.throws(()=>validateSignalTopicEditorialGlobalShardResultV2({shard,value:{...base,concepts:[]}}),/coverage_invalid/u);
  assert.throws(()=>validateSignalTopicEditorialGlobalShardResultV2({shard,value:{...base,concepts:[],noise:[
    {group_key:a.group_key,cited_ref_ids:[],rationale:'No evidence'}],unresolved:[{group_key:b.group_key,cited_ref_ids:[],rationale:'uncertain'}]}}),/citation_invalid/u);
});

test('census keeps Noise, insufficient evidence, and technical error as separate terminal outcomes',()=>{
  const shards=buildSignalTopicEditorialGlobalShardsV2({units:makeUnits(4,[3]),expected_group_count:4,batch_size:4}),shard=shards[0]!;
  const [topic,noise,unresolved]=shard.groups;
  const result=validateSignalTopicEditorialGlobalShardResultV2({shard,value:{contract_version:'signal-topic-editorial-global-shard-result-v2',
    concepts:[{concept_key:'topic-one',kind:'topic',label:'Topic',definition:'Definición',members:[{group_key:topic!.group_key,
      cited_ref_ids:[topic!.evidence[0]!.ref_id],rationale:'Cita perteneciente al grupo.'}]}],
    noise:[{group_key:noise!.group_key,cited_ref_ids:[noise!.evidence[0]!.ref_id],rationale:'La evidencia muestra un asunto ajeno.'}],
    unresolved:[{group_key:unresolved!.group_key,cited_ref_ids:[],rationale:'La evidencia no resuelve si pertenece a la marca.'}]}});
  const outcomes=composeSignalTopicEditorialGlobalShardOutcomesV2({shards,results:[{batch_index:0,result}]});
  assert.deepEqual(outcomes.map(item=>item.status),['topic','noise','insufficient_evidence','technical_error']);
  assert.equal(outcomes[2]!.error_code,null);
  assert.equal(outcomes[3]!.error_code,'provider_timeout');
  assert.deepEqual(outcomes[3]!.cited_ref_ids,[]);
});

test('all-Noise results need no concept merge request and error-only lots do not create provider calls',()=>{
  const source=makeUnits(4,[3]).map((item,index)=>{
    if(index===3)return item;
    const request=item.request,decision=validateSignalTopicEditorialGroupOutputV2(request,{contract_version:'signal-topic-editorial-group-output-v2',
      group_id:request.receipt.group_id,disposition:'noise',candidate:null,confidence:0.9,rationale:'Evidencia de conversación ajena.',
      cited_evidence_ids:[request.receipt.evidence[0]!.evidence_id]});
    return {...item,decision};
  });
  const shards=buildSignalTopicEditorialGlobalShardsV2({units:source,expected_group_count:4,batch_size:1});
  assert.equal(shards.slice(0,3).every(shard=>shard.groups.length===1&&shard.request_body!==null),true);
  assert.equal(shards[3]!.groups.length,0);
  assert.equal(shards[3]!.request_body,null);
  assert.equal(shards[3]!.request_digest,null);
  const results=shards.slice(0,3).map(shard=>{
    const group=shard.groups[0]!;
    return {batch_index:shard.batch_index,result:validateSignalTopicEditorialGlobalShardResultV2({shard,value:{
      contract_version:'signal-topic-editorial-global-shard-result-v2',concepts:[],
      noise:[{group_key:group.group_key,cited_ref_ids:[group.evidence[0]!.ref_id],rationale:'Cita muestra que es ajeno.'}],unresolved:[]}})};
  });
  assert.deepEqual(buildSignalTopicEditorialGlobalMergeReviewsV2({shards,results,round:1}),[]);
  const outcomes=composeSignalTopicEditorialGlobalShardOutcomesV2({shards,results});
  assert.deepEqual(outcomes.map(item=>item.status),['noise','noise','noise','technical_error']);
  assert.deepEqual(outcomes.slice(0,3).map(item=>item.cited_ref_ids.length),[1,1,1]);
  const allNoise=makeUnits(3).map(item=>{const request=item.request,decision=validateSignalTopicEditorialGroupOutputV2(request,{contract_version:'signal-topic-editorial-group-output-v2',
    group_id:request.receipt.group_id,disposition:'noise',candidate:null,confidence:0.9,rationale:'La evidencia demuestra que es ajeno.',
    cited_evidence_ids:[request.receipt.evidence[0]!.evidence_id]});return {...item,decision};});
  const noiseShards=buildSignalTopicEditorialGlobalShardsV2({units:allNoise,expected_group_count:3,batch_size:3}),noiseShard=noiseShards[0]!,
    noiseGroup=noiseShard.groups[0]!,noiseResult=validateSignalTopicEditorialGlobalShardResultV2({shard:noiseShard,value:{
      contract_version:'signal-topic-editorial-global-shard-result-v2',concepts:[],
      noise:noiseShard.groups.map(group=>({group_key:group.group_key,cited_ref_ids:[group.evidence[0]!.ref_id],rationale:'Fuera de marca.'})),unresolved:[]}}),
    noiseOutcomes=composeSignalTopicEditorialGlobalShardOutcomesV2({shards:noiseShards,results:[{batch_index:0,result:noiseResult}]}),
    noiseCatalog=buildSignalTopicEditorialGlobalCatalogInputV2({snapshot_digest:noiseShard.snapshot_digest,units:allNoise,
      outcomes:noiseOutcomes,root_concepts:[],revision:1});
  assert.equal(noiseGroup.group_key,allNoise[0]!.request.receipt.group_key);
  assert.equal(noiseCatalog.ready_to_materialize,true);
  assert.equal(noiseCatalog.revision!.concepts.length,0);
  assert.equal(noiseCatalog.outcome_counts.noise,3);
});

test('bounded merge rounds can merge concepts from different screening lots without changing source membership/citations',()=>{
  const shards=buildSignalTopicEditorialGlobalShardsV2({units:makeUnits(6),expected_group_count:6,batch_size:2});
  const results=shards.map(shard=>({batch_index:shard.batch_index,result:shardResult(shard)}));
  const roundOne=buildSignalTopicEditorialGlobalMergeReviewsV2({shards,results,round:1,fan_in:2});
  assert.equal(roundOne.length,3);
  const collapse=(reviews:ReturnType<typeof buildSignalTopicEditorialGlobalMergeReviewsV2>)=>reviews.map(review=>
    validateSignalTopicEditorialGlobalMergeResultV2({review,value:{contract_version:'signal-topic-editorial-global-merge-result-v2',
      concepts:[{concept_key:`r${review.round}-${review.batch_index}`,kind:'topic',label:`Capa ${review.round}`,
        definition:'Concepto superior con trazabilidad.',priority_rationale:'Relevancia entre conceptos del lote.',
        member_concept_keys:review.nodes.map(node=>node.concept_key)}]}}).concepts).flat();
  const levelOne=collapse(roundOne);
  assert.equal(levelOne.length,3);
  const roundTwo=buildSignalTopicEditorialGlobalMergeReviewsV2({prior_nodes:levelOne,snapshot_digest:shards[0]!.snapshot_digest,
    context:shards[0]!.context,
    round:2,fan_in:2});
  assert.equal(roundTwo.length,2);
  const levelTwo=collapse(roundTwo);
  const roundThree=buildSignalTopicEditorialGlobalMergeReviewsV2({prior_nodes:levelTwo,snapshot_digest:shards[0]!.snapshot_digest,
    context:shards[0]!.context,
    round:3,fan_in:2});
  assert.equal(roundThree.length,1);
  const final=collapse(roundThree);
  assert.equal(final.length,1);
  assert.equal(final[0]!.members.length,6);
  assert.equal(new Set(final[0]!.members.map(member=>member.group_key)).size,6);
  assert.equal(final[0]!.members.every(member=>member.cited_ref_ids.length===1),true);
  assert.equal(final[0]!.priority_rank,1);
  const base=composeSignalTopicEditorialGlobalShardOutcomesV2({shards,results});
  const projected=applySignalTopicEditorialGlobalRootV2({outcomes:base,root_concepts:final});
  assert.equal(projected.every(item=>item.status==='topic'&&item.concept_key===final[0]!.concept_key),true);
  const catalog=buildSignalTopicEditorialGlobalCatalogInputV2({snapshot_digest:shards[0]!.snapshot_digest,units:makeUnits(6),
    outcomes:projected,root_concepts:final,revision:1});
  assert.equal(catalog.complete,true);
  assert.equal(catalog.ready_to_materialize,true);
  assert.equal(catalog.revision!.decisions.length,6);
  assert.equal(catalog.revision!.concepts.length,1);
  assert.equal(catalog.concept_metadata.get(final[0]!.concept_key)?.priority_rank,1);
  assert.equal(catalog.group_evidence.every(item=>item.cited_ref_ids.length===1),true);
  assert.equal(catalog.outcome_counts.topic,6);
});

test('a broad consolidated topic keeps the complete citation census without oversized concept metadata',()=>{
  const units=makeUnits(500),members=units.map(unit=>({group_key:unit.request.receipt.group_key,
    cited_ref_ids:[unit.request.source_group.evidence[0]!.ref_id],rationale:'Cita original de este grupo.',
    community_key:unit.request.source_group.community_key,neighbors:[]}));
  const root={concept_key:'broad-topic',kind:'topic' as const,label:'Uso de Alexa+',definition:'Conversaciones relacionadas con Alexa+.',
    priority_rationale:'Tema principal.',priority_rank:1,source_concept_keys:['many-groups'],members};
  const outcomes=members.map(member=>({group_key:member.group_key,status:'topic' as const,concept_key:root.concept_key,
    cited_ref_ids:member.cited_ref_ids,rationale:member.rationale,error_code:null}));
  const catalog=buildSignalTopicEditorialGlobalCatalogInputV2({snapshot_digest:units[0]!.request.identity.snapshot_digest,
    units,outcomes,root_concepts:[root],revision:1});
  const metadata=catalog.concept_metadata.get(root.concept_key)!;
  assert.equal(catalog.ready_to_materialize,true);
  assert.equal(catalog.group_evidence.length,500);
  assert.equal(catalog.group_evidence.every(item=>item.cited_ref_ids.length===1),true);
  assert.equal(metadata.cited_ref_ids.length,16);
  assert.ok(Buffer.byteLength(JSON.stringify({contract_version:'signal-topic-editorial-concept-metadata-v2',...metadata}),'utf8')<32768);
});

test('catalog bridge preserves census but blocks revision when any group has a technical error',()=>{
  const units=makeUnits(3,[2]),shards=buildSignalTopicEditorialGlobalShardsV2({units,expected_group_count:3,batch_size:3});
  const shard=shards[0]!,result=shardResult(shard),results=[{batch_index:0,result}];
  const initial=composeSignalTopicEditorialGlobalShardOutcomesV2({shards,results});
  const root=buildSignalTopicEditorialGlobalMergeReviewsV2({shards,results,round:1})[0]!;
  const merged=validateSignalTopicEditorialGlobalMergeResultV2({review:root,value:{contract_version:'signal-topic-editorial-global-merge-result-v2',
    concepts:[{concept_key:'root',kind:'topic',label:'Tema',definition:'Definición',priority_rationale:'Pertinencia',
      member_concept_keys:root.nodes.map(node=>node.concept_key)}]}}).concepts;
  const ranked=applySignalTopicEditorialGlobalRootV2({outcomes:initial,root_concepts:merged});
  const catalog=buildSignalTopicEditorialGlobalCatalogInputV2({snapshot_digest:shard.snapshot_digest,units,outcomes:ranked,
    root_concepts:merged,revision:1});
  assert.equal(catalog.complete,true);
  assert.equal(catalog.ready_to_materialize,false);
  assert.equal(catalog.revision,null);
  assert.deepEqual(catalog.blocking_group_keys,[units[2]!.request.receipt.group_key]);
  assert.equal(catalog.group_evidence.filter(item=>item.status==='technical_error').length,1);
});

test('unchanged concepts stop the merge loop and expose missing cross-lot ranking',()=>{
  const shards=buildSignalTopicEditorialGlobalShardsV2({units:makeUnits(6),expected_group_count:6,batch_size:2});
  const results=shards.map(shard=>({batch_index:shard.batch_index,result:shardResult(shard)}));
  const reviews=buildSignalTopicEditorialGlobalMergeReviewsV2({shards,results,round:1,fan_in:2});
  const identityResults=reviews.map(review=>({batch_index:review.batch_index,result:validateSignalTopicEditorialGlobalMergeResultV2({
    review,value:{contract_version:'signal-topic-editorial-global-merge-result-v2',concepts:review.nodes.map(node=>({
      concept_key:'copy-'+node.concept_key,kind:node.kind,label:node.label,definition:node.definition,
      priority_rationale:'Se conserva sin forzar una fusión.',member_concept_keys:[node.concept_key]}))}})}));
  const summary=summarizeSignalTopicEditorialGlobalMergeRoundV2({reviews,results:identityResults});
  assert.equal(summary.semantic_progress,'no_progress');
  assert.equal(summary.semantic_reduction,0);
  assert.equal(summary.ranking_status,'aggregate_required');
  assert.equal(summary.next_round_allowed,false);
  assert.equal(summary.blocking_reason,'no_semantic_reduction');
  assert.equal(reviews[0]!.round,1);
});

test('global rank-only pass keeps all concepts, excludes long evidence, and requires exact result coverage',()=>{
  const concepts=Array.from({length:3},(_,index)=>({concept_key:`concept-${index}`,kind:'topic' as const,
    label:`Tema ${index}`,definition:`Definición ${index}`,priority_rationale:null,priority_rank:null,
    source_concept_keys:[`source-${index}`],members:[{group_key:`open:g-${index}`,cited_ref_ids:[`ref-${index}`],
      rationale:'Evidencia citada previa.',community_key:'community',neighbors:[]}]}));
  const review=buildSignalTopicEditorialGlobalRankingReviewV2({snapshot_digest:sha('snapshot'),context,concepts});
  const input=JSON.parse(review.input_body);
  assert.equal(input.concept_count,3);
  assert.deepEqual(input.concepts.map((item:{concept_key:string})=>item.concept_key),['concept-0','concept-1','concept-2']);
  assert.equal(review.request_body.includes('ref-0'),false);
  assert.equal(review.request_body.includes('Evidencia citada previa.'),false);
  const result=validateSignalTopicEditorialGlobalRankingResultV2({review,value:{
    contract_version:'signal-topic-editorial-global-ranking-result-v2',concepts:[
      {concept_key:'concept-2',priority_rationale:'Prioridad alta.'},
      {concept_key:'concept-0',priority_rationale:'Uso cotidiano.'},
      {concept_key:'concept-1',priority_rationale:'Menor ajuste.'},
    ]}});
  const ranked=applySignalTopicEditorialGlobalRankingV2({concepts,review,result});
  assert.deepEqual(ranked.map(item=>[item.concept_key,item.priority_rank]),[['concept-2',1],['concept-0',2],['concept-1',3]]);
  assert.deepEqual(ranked.map(item=>item.members[0]!.cited_ref_ids[0]),['ref-2','ref-0','ref-1']);
  assert.throws(()=>validateSignalTopicEditorialGlobalRankingResultV2({review,value:{
    contract_version:'signal-topic-editorial-global-ranking-result-v2',concepts:[
      {concept_key:'concept-2',priority_rationale:'Primero.'},{concept_key:'concept-2',priority_rationale:'Duplicado.'},
      {concept_key:'concept-1',priority_rationale:'Falta concept-0.'},
    ]}}),/coverage_invalid/u);
});

test('rank preflight accepts 1,652 compact concepts and blocks oversized 5,000-concept input',()=>{
  const makeConcepts=(count:number,definitionLength:number)=>Array.from({length:count},(_,index)=>({
    concept_key:`topic-v2-${String(index).padStart(24,'0')}`,kind:'topic' as const,label:`Tema ${index}`,
    definition:'x'.repeat(definitionLength),priority_rationale:null,priority_rank:null,source_concept_keys:[`source-${index}`],
    members:[{group_key:`open:g-${index}`,cited_ref_ids:[`ref-${index}`],rationale:'Cita retenida.',community_key:'community',neighbors:[]}],
  }));
  const review=buildSignalTopicEditorialGlobalRankingReviewV2({snapshot_digest:sha('snapshot'),context,
    concepts:makeConcepts(1652,80)});
  assert.equal(review.concept_count,1652);
  assert.equal(review.preflight.status,'within_conservative_budget');
  assert.ok(review.preflight.request_body_utf8_bytes<750_000);
  assert.ok(review.preflight.estimated_max_output_utf8_bytes<380_000);
  assert.throws(()=>buildSignalTopicEditorialGlobalRankingReviewV2({snapshot_digest:sha('snapshot'),context,
    concepts:makeConcepts(5000,500)}),/topic_editorial_global_ranking_preflight_(input|output)_oversize/u);
});
