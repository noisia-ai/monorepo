import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {signalTopicEditorialDigestV1 as sha,type SignalTopicEditorialScreeningGroupV1,
  buildSignalTopicEditorialScreeningPlanV2,validateSignalTopicEditorialGroupOutputV2,
  buildSignalTopicEditorialGlobalReviewV2} from '../../packages/query-engine/src';
import {buildSignalTopicEditorialGlobalCatalogV2,signalTopicEditorialGlobalCatalogReplayCompatibleV2}
  from './signal-topic-editorial-global-v2';
import {signalTopicConsolidationDigestV1,parseSignalTopicConsolidationRevisionV1} from './signal-topic-consolidation';
import {buildSignalTopicEditorialGlobalCatalogInputV2} from '../../packages/query-engine/src/signal-topic-editorial-global-v2';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={brand_name:'Alexa+',default_locale:'es-MX',summary:'Asistente de voz',audiences:[],categories:[],
  competitors:[],positive_anchors:[],negative_anchors:[],abstention_anchors:[]};
function group(n:number):SignalTopicEditorialScreeningGroupV1{
  const text=`Alexa+ ${n}`,root_id=id(n+1),chunk_sha256=`sha256:${createHash('sha256').update(text).digest('hex')}`;
  const evidence=[{ref_id:sha({root_id,chunk_index:0,start:0,end:text.length,chunk_sha256}),root_id,chunk_index:0,
    start:0,end:text.length,chunk_sha256,text,locale:'es-MX',platform:null,occurred_at:null}];
  const scope_counts={brand:1,competitor:0,category:0,unknown:0},locale_counts=[{key:'es-MX',count:1}],
    platform_counts:never[]=[],month_counts:never[]=[],brand_affinity={positive:[],negative:[],abstention:[]},
    neighbors:never[]=[],metrics={cohesion:null,outlier_ratio:null};
  const dossier={contract_version:'signal-topic-group-dossier-v1',scope_counts,locale_counts,platform_counts,
    month_counts,brand_affinity,neighbors,metrics,evidence:evidence.map(({text:_text,...item})=>item)};
  return {group_key:`open:cluster-${n}`,lane:'open',group_digest:sha(['group',n]),source_dossier_digest:sha(dossier),
    dossier_digest:sha(dossier),community_key:'one',root_count:1,chunk_count:1,terms:['Alexa+'],scope_counts,
    locale_counts,platform_counts,month_counts,brand_affinity,neighbors,metrics,evidence};
}

test('staged catalog is parseable when priority order differs from concept keys',()=>{
  const groups=[group(1),group(2)];
  const plan=buildSignalTopicEditorialScreeningPlanV2({workspace_id:id(70001),run_id:id(70002),
    expected_group_count:2,source_context_digest:sha('source'),editorial_context_digest:sha(context),context,groups});
  const units=plan.requests.map(request=>({request,technical_error_code:null,decision:
    validateSignalTopicEditorialGroupOutputV2(request,{contract_version:'signal-topic-editorial-group-output-v2',
      group_id:request.receipt.group_id,disposition:'topic',candidate:{label:'Alexa+',definition:'Uso de Alexa+.',locale:'es-MX'},
      confidence:0.8,rationale:'Evidencia original.',cited_evidence_ids:[request.receipt.evidence[0]!.evidence_id]})}));
  const roots=[{concept_key:'z-priority-first',index:0},{concept_key:'a-priority-second',index:1}].map(({concept_key,index})=>({
    concept_key,kind:'topic' as const,label:`Tema ${index}`,definition:'Conversaciones verificadas sobre Alexa+.',
    priority_rationale:'Importancia para la marca.',priority_rank:index+1,source_concept_keys:[`source-${index}`],
    members:[{group_key:groups[index]!.group_key,cited_ref_ids:[groups[index]!.evidence[0]!.ref_id],
      rationale:'Cita original.',community_key:'one',neighbors:[]}]}));
  const outcomes=groups.map((item,index)=>({group_key:item.group_key,status:'topic' as const,concept_key:roots[index]!.concept_key,
    cited_ref_ids:[item.evidence[0]!.ref_id],rationale:'Cita original.',error_code:null}));
  const catalog=buildSignalTopicEditorialGlobalCatalogInputV2({snapshot_digest:plan.requests[0]!.identity.snapshot_digest,
    units,outcomes,root_concepts:roots,revision:1});
  assert.deepEqual(catalog.revision?.concepts.map(item=>item.concept_key),['a-priority-second','z-priority-first']);
  assert.equal(catalog.concept_metadata.get('z-priority-first')?.priority_rank,1);
  assert.equal(catalog.concept_metadata.get('a-priority-second')?.priority_rank,2);
  assert.equal(parseSignalTopicConsolidationRevisionV1(catalog.revision,groups.map(item=>item.group_key)).decisions.length,2);
});

test('global result becomes one ranked editable concept with original group decisions',()=>{
  const plan=buildSignalTopicEditorialScreeningPlanV2({workspace_id:id(70001),run_id:id(70002),
    expected_group_count:3,source_context_digest:sha('source'),editorial_context_digest:sha(context),
    context,groups:[group(0),group(1),group(2)]});
  const units=plan.requests.map((request,n)=>({request,technical_error_code:null,decision:
    validateSignalTopicEditorialGroupOutputV2(request,{contract_version:'signal-topic-editorial-group-output-v2',
      group_id:request.receipt.group_id,disposition:n===2?'noise':'topic',
      candidate:n===2?null:{label:'Rutinas con Alexa+',definition:'Rutinas de voz.',locale:'es-MX'},
      confidence:0.8,rationale:'Evidencia revisada.',cited_evidence_ids:[request.receipt.evidence[0]!.evidence_id]})}));
  const review=buildSignalTopicEditorialGlobalReviewV2({units,expected_group_count:3});
  const result={contract_version:'signal-topic-editorial-global-output-v2',concepts:[{kind:'topic',
    label:'Rutinas domésticas',definition:'Conversaciones sobre rutinas configuradas con Alexa+.',
    priority_rationale:'La marca participa directamente.',member_ids:[1,2],
    cited_ref_ids:[plan.requests[0]!.receipt.evidence[0]!.ref_id]}],noise_ids:[],unresolved_ids:[]};
  const catalog=buildSignalTopicEditorialGlobalCatalogV2({review,result,units,revision:1});
  assert.equal(catalog.revision.concepts.length,1);
  assert.equal(catalog.revision.decisions.length,3);
  assert.equal(catalog.revision.decisions.filter(item=>item.concept_key!==null).length,2);
  assert.equal(catalog.revision.decisions.find(item=>item.group_key===plan.requests[2]!.receipt.group_key)!.disposition,'noise');
  assert.equal(catalog.outcome_counts.noise,1);
  assert.equal(catalog.concept_metadata.get(catalog.revision.concepts[0]!.concept_key)!.priority_rank,1);
  const persistedMetadata=new Map([...catalog.concept_metadata].map(([key,value])=>[key,
    {contract_version:'signal-topic-editorial-concept-metadata-v2',...value}]));
  assert.equal(signalTopicEditorialGlobalCatalogReplayCompatibleV2({desired:catalog,
    existing_revision:catalog.revision,existing_concept_metadata:persistedMetadata}),true);
  const sameResultAtRevisionTwo=buildSignalTopicEditorialGlobalCatalogV2({review,result,units,revision:2});
  assert.equal(signalTopicEditorialGlobalCatalogReplayCompatibleV2({desired:catalog,
    existing_revision:sameResultAtRevisionTwo.revision,existing_concept_metadata:persistedMetadata}),true,
  'the sequence number does not change logical replay identity');
  const changedMetadata=new Map(persistedMetadata);
  changedMetadata.set(catalog.revision.concepts[0]!.concept_key,{...persistedMetadata.get(catalog.revision.concepts[0]!.concept_key)!,
    cited_ref_ids:[sha('different-citation')]});
  assert.equal(signalTopicEditorialGlobalCatalogReplayCompatibleV2({desired:catalog,
    existing_revision:catalog.revision,existing_concept_metadata:changedMetadata}),false);
  const changedResult={...result,concepts:[{...result.concepts[0]!,priority_rationale:'Otra prioridad.'}]};
  const changedCatalog=buildSignalTopicEditorialGlobalCatalogV2({review,result:changedResult,units,revision:2});
  assert.equal(signalTopicEditorialGlobalCatalogReplayCompatibleV2({desired:catalog,
    existing_revision:changedCatalog.revision,existing_concept_metadata:new Map([...changedCatalog.concept_metadata].map(([key,value])=>[key,
      {contract_version:'signal-topic-editorial-concept-metadata-v2',...value}]))}),false);
  assert.throws(()=>buildSignalTopicEditorialGlobalCatalogV2({review,
    result:{...result,concepts:[{...result.concepts[0]!,cited_ref_ids:[plan.requests[2]!.receipt.evidence[0]!.ref_id]}]},
    units,revision:1}),/citation_invalid/u);

  // V2 returns concept-level citations rather than a citation list per member;
  // preserve the exact aggregate citations and validate they belong to a member.
  const allNoise=buildSignalTopicEditorialGlobalCatalogV2({review,
    result:{contract_version:'signal-topic-editorial-global-output-v2',concepts:[],noise_ids:[1,2],unresolved_ids:[]},
    units,revision:1});
  assert.equal(allNoise.revision.concepts.length,0);
  assert.equal(allNoise.outcome_counts.noise,3);
  assert.equal(signalTopicEditorialGlobalCatalogReplayCompatibleV2({desired:allNoise,
    existing_revision:allNoise.revision,existing_concept_metadata:new Map()}),true);
  const alteredNoise={...allNoise.revision,decisions:allNoise.revision.decisions.map((item,index)=>index===0
    ?{...item,disposition:'unresolved' as const}:item)};
  const alteredNoiseBody={contract_version:alteredNoise.contract_version,revision:alteredNoise.revision,
    concepts:alteredNoise.concepts,decisions:alteredNoise.decisions};
  assert.equal(signalTopicEditorialGlobalCatalogReplayCompatibleV2({desired:allNoise,
    existing_revision:{...alteredNoise,revision_digest:signalTopicConsolidationDigestV1(alteredNoiseBody)},
    existing_concept_metadata:new Map()}),false);
  assert.throws(()=>buildSignalTopicEditorialGlobalCatalogV2({review,result,units:units.slice(0,2),revision:1}),/catalog_input_invalid/u);
});
