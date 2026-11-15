import {createHash} from 'node:crypto';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import {signalWorkspaceMassLabelingConfigV3} from './signal-workspace-engine-v1';
import {validateSignalStudyV1,SIGNAL_STUDY_DIRECTIONS_V1,SIGNAL_STUDY_TARGETS_V1,SIGNAL_STUDY_USES_V1,
  type SignalStudyAxesV1,type SignalStudyV1,type SignalStudyLayerV1,type SignalStudyDirectionV1,type SignalStudyPermissionV1} from './signal-study-contracts';

export type SignalStudyRootV1={root_id:string;text:string;text_sha256:string;vector:number[];axes:SignalStudyAxesV1;
  occurred_at:string;channel:string;source_url:string;listening_topic_keys:string[];private_person_names:string[];
  selected_fragment?:{text:string;text_sha256:string;start:number;end:number}};
export type SignalStudyMotiveV1={key:string;name:string;definition:string;centroid:number[];layer:SignalStudyLayerV1;human_locked:boolean;
  permission_override?:{permission:SignalStudyPermissionV1;reason:string}};
export type SignalStudySampleV1={contract_version:'signal-study-sample-v1';study_digest:string;group_key:string;pass:'a'|'b';
  random_count:number;far_count:number;population_count:number;independence:'disjoint'|'overlapping'|'small_group';
  sampling_policy:{seed_digest:string;population_digest:string;centroid_digest:string;requested_random:number;requested_far:number};
  insufficient_sample:boolean;rows:Array<{root_id:string;text:string;text_sha256:string;source:'random'|'far';axes:SignalStudyAxesV1}>;sample_digest:string};
function fail(code:string):never{throw Error(code);}
function assertVector(vector:number[]):void{
  if(vector.length!==1024||vector.some(x=>!Number.isFinite(x))||!vector.some(x=>x!==0)||!Number.isFinite(Math.hypot(...vector)))fail('study_vector_invalid');
}
export function assertSignalStudyRootsV1(roots:SignalStudyRootV1[]):void{
  const seen=new Set<string>();
  for(const root of roots){
    if(!root.root_id||seen.has(root.root_id)||!root.text.trim()||root.text_sha256!=='sha256:'+createHash('sha256').update(root.text,'utf8').digest('hex')
      ||!Number.isFinite(Date.parse(root.occurred_at))||!root.channel.trim())fail('study_root_invalid');
    const axes=root.axes;
    if(!SIGNAL_STUDY_DIRECTIONS_V1.includes(axes.direction)||!SIGNAL_STUDY_DIRECTIONS_V1.includes(axes.source_direction)
      ||!SIGNAL_STUDY_TARGETS_V1.includes(axes.target)||!SIGNAL_STUDY_USES_V1.includes(axes.use)
      ||!['subject','competitor','alternative','figurative_or_ironic','other'].includes(axes.aggregate)
      ||typeof axes.alternative_inverted!=='boolean'||(axes.alternative_inverted
        ?axes.direction!=='trigger'||axes.source_direction!=='barrier'||axes.target!=='category'||axes.use!=='literal'
        :axes.direction!==axes.source_direction)
      ||axes.use==='figurative_or_ironic'&&axes.aggregate!=='figurative_or_ironic'
      ||axes.use==='other'&&axes.aggregate!=='other'
      ||axes.use==='literal'&&(axes.target==='competitor_brand'?axes.aggregate!=='competitor':
        axes.target==='alternative'?!['subject','alternative'].includes(axes.aggregate):axes.aggregate!=='subject'))fail('study_axes_invalid');
    seen.add(root.root_id);assertVector(root.vector);
    const fragment=root.selected_fragment;
    if(fragment&&(!Number.isSafeInteger(fragment.start)||!Number.isSafeInteger(fragment.end)||fragment.start<0||fragment.end<=fragment.start
      ||fragment.end>root.text.length||fragment.text!==root.text.slice(fragment.start,fragment.end)
      ||fragment.text_sha256!=='sha256:'+createHash('sha256').update(fragment.text).digest('hex')))fail('study_fragment_invalid');
  }
}
function cosine(left:number[],right:number[]):number{
  const ll=Math.hypot(...left),rr=Math.hypot(...right);let dot=0;
  for(let i=0;i<left.length;i++)dot+=(left[i]!/ll)*(right[i]!/rr);
  return Math.max(-1,Math.min(1,dot));
}
export function signalStudyConfirmedCentroidV1(roots:SignalStudyRootV1[]):number[]{
  if(!roots.length)fail('study_centroid_empty');assertSignalStudyRootsV1(roots);
  const result=Array.from({length:1024},()=>0);
  for(const root of [...roots].sort((a,b)=>a.root_id.localeCompare(b.root_id))){const norm=Math.hypot(...root.vector);for(let i=0;i<1024;i++)result[i]!+=root.vector[i]!/norm;}
  const norm=Math.hypot(...result);if(norm===0)fail('study_centroid_cancelled');return result.map(x=>x/norm);
}
/** A single pooled fit population. Direction is carried as metadata, never as
 * separate trigger/barrier fits; competitor rows retain their reporting scope. */
export function buildSignalStudyMotivePopulationV1(roots:SignalStudyRootV1[]):{
  roots:SignalStudyRootV1[];direction_counts:Record<SignalStudyDirectionV1,number>;population_digest:string}{
  assertSignalStudyRootsV1(roots);
  const selected=roots.filter(root=>root.axes.direction!=='none'&&root.axes.use==='literal');
  const direction_counts={trigger:0,barrier:0,mixed:0,none:0};
  for(const root of selected)direction_counts[root.axes.direction]++;
  return{roots:selected,direction_counts,population_digest:digest(selected.map(r=>({root_id:r.root_id,text_sha256:r.text_sha256,axes:r.axes})).sort((a,b)=>a.root_id.localeCompare(b.root_id)))};
}
/** Fresh numerical fit over the shared relevant-fragment vectors. No new
 * embedding request, prior human taxonomy, direction-specific partition or
 * paused multimethod-engine execution is introduced by this manifest. */
export function buildSignalStudyMotiveFitPlanV1(args:{study:SignalStudyV1;roots:SignalStudyRootV1[];embedding_space_digest:string}){
  const study=validateSignalStudyV1(args.study),population=buildSignalStudyMotivePopulationV1(args.roots);
  if(!/^sha256:[a-f0-9]{64}$/u.test(args.embedding_space_digest))fail('study_embedding_space_invalid');
  const rows=population.roots.map(root=>({root_id:root.root_id,text:root.selected_fragment?.text??root.text,
    text_sha256:root.selected_fragment?.text_sha256??root.text_sha256,vector:[...root.vector],vector_digest:digest(root.vector),
    direction:root.axes.direction,target:root.axes.target,aggregate:root.axes.aggregate})).sort((a,b)=>a.root_id.localeCompare(b.root_id));
  const body={contract_version:'signal-study-motive-fit-plan-v1' as const,study_digest:digest(study),workspace_id:study.workspace_id,
    corpus_id:study.corpus_id,embedding_space_digest:args.embedding_space_digest,dimensions:1024 as const,
    configuration:signalWorkspaceMassLabelingConfigV3(rows.length),pooled_directions:['trigger','barrier','mixed'],
    fit_required:rows.length>0,source:'existing_corpus_vectors' as const,guides:[],rows};
  return{...body,plan_digest:digest(body)};
}
/** Hash-ranked random samples are reproducible and independent of input order.
 * Large groups use disjoint evidence across blind passes. Small groups expose
 * their shortfall instead of claiming 30 independent random observations. */
export function sampleSignalStudyGroupV1(args:{study_digest:string;group_key:string;roots:SignalStudyRootV1[];
  centroid:number[];seed:string;random_count?:number;far_count?:number}):[SignalStudySampleV1,SignalStudySampleV1]{
  assertSignalStudyRootsV1(args.roots);assertVector(args.centroid);
  const random=args.random_count??35,far=args.far_count??5;
  if(!Number.isInteger(random)||random<30||random>40||!Number.isInteger(far)||far<1||far>5||!args.seed||!args.study_digest||!args.group_key)fail('study_sampling_invalid');
  const sampling_policy={seed_digest:digest(args.seed),population_digest:digest(args.roots.map(root=>({root_id:root.root_id,text_sha256:root.text_sha256,
    vector_digest:digest(root.vector),axes:root.axes})).sort((a,b)=>a.root_id.localeCompare(b.root_id))),
    centroid_digest:digest(args.centroid),requested_random:random,requested_far:far};
  const seen=new Set<string>();
  const result=(['a','b'] as const).map(pass=>{
    const remaining=args.roots.filter(root=>!seen.has(root.root_id));
    const disjoint=pass==='b'&&remaining.length>=30+far;
    const population=disjoint?remaining:args.roots;
    const farN=Math.min(far,Math.max(0,population.length-1));
    const randomN=Math.min(random,Math.max(0,population.length-farN-(disjoint?0:1)));
    const rank=(root:SignalStudyRootV1)=>digest({seed:args.seed,study:args.study_digest,group:args.group_key,pass,root:root.root_id});
    const randomRows=[...population].sort((a,b)=>rank(a).localeCompare(rank(b))).slice(0,randomN);
    const randomIds=new Set(randomRows.map(root=>root.root_id));
    const distant=()=>population.filter(root=>!randomIds.has(root.root_id))
      .sort((a,b)=>cosine(a.vector,args.centroid)-cosine(b.vector,args.centroid)||a.root_id.localeCompare(b.root_id)).slice(0,farN);
    let farRows=distant();
    const sampled=[...randomRows,...farRows];
    if(pass==='b'&&randomRows.length&&sampled.length===seen.size&&sampled.every(root=>seen.has(root.root_id))){
      const holdout=[...population].filter(root=>!seen.has(root.root_id)).sort((a,b)=>rank(a).localeCompare(rank(b)))[0];
      if(holdout){randomIds.delete(randomRows[randomRows.length-1]!.root_id);randomRows[randomRows.length-1]=holdout;randomIds.add(holdout.root_id);farRows=distant();}
    }
    const rows=[...randomRows.map(root=>({...root,source:'random' as const})),...farRows.map(root=>({...root,source:'far' as const}))]
      .map(root=>({root_id:root.root_id,text:root.text,text_sha256:root.text_sha256,source:root.source,axes:root.axes}));
    if(pass==='a')for(const row of rows)seen.add(row.root_id);
    const sample={contract_version:'signal-study-sample-v1' as const,study_digest:args.study_digest,group_key:args.group_key,pass,
      random_count:randomRows.length,far_count:farRows.length,population_count:args.roots.length,
      independence:(randomN<30?'small_group':disjoint||pass==='a'&&args.roots.length>=random+far+30+far?'disjoint':'overlapping') as SignalStudySampleV1['independence'],
      insufficient_sample:randomN<30,sampling_policy,rows};
    return{...sample,sample_digest:digest(sample)};
  });
  return result as [SignalStudySampleV1,SignalStudySampleV1];
}
export function signalStudyNearestMotivesV1(root:SignalStudyRootV1,motives:SignalStudyMotiveV1[]):Array<{key:string;similarity:number}>{
  assertSignalStudyRootsV1([root]);
  if(root.axes.direction==='none'||root.axes.use!=='literal')return[];
  if(new Set(motives.map(m=>m.key)).size!==motives.length)fail('study_motive_duplicate');
  for(const motive of motives)assertVector(motive.centroid);
  return motives.map(motive=>({key:motive.key,similarity:cosine(root.vector,motive.centroid)}))
    .sort((a,b)=>b.similarity-a.similarity||a.key.localeCompare(b.key)).slice(0,4);
}
export type SignalStudyMembershipV1={root_id:string;motive_key:string;probability:number;source:'jev'|'human';human_locked:boolean};
export function signalStudyDominancePlanV1(args:{roots:SignalStudyRootV1[];motives:SignalStudyMotiveV1[];memberships:SignalStudyMembershipV1[];
  cut_root_ids:string[]}):{motive_keys:string[];layer_keys:SignalStudyLayerV1[];reask_root_ids:string[];locked_motive_keys:string[]}{
  const byRoot=new Map(args.roots.map(r=>[r.root_id,r]));const cut=new Set(args.cut_root_ids);
  if(!cut.size||cut.size!==args.cut_root_ids.length||[...cut].some(id=>!byRoot.has(id)))fail('study_cut_population_invalid');
  assertSignalStudyRootsV1(args.roots);
  const motives=new Map(args.motives.map(m=>[m.key,m])),byMotive=new Map<string,Set<string>>(),byLayer=new Map<SignalStudyLayerV1,Set<string>>(),asked=new Map<string,Set<string>>();
  if(motives.size!==args.motives.length)fail('study_motive_duplicate');
  const seen=new Set<string>();
  for(const member of args.memberships){
    const motive=motives.get(member.motive_key),root=byRoot.get(member.root_id);
    const identity=JSON.stringify([member.root_id,member.motive_key]);
    if(!motive||!root||!cut.has(root.root_id)||!Number.isFinite(member.probability)||member.probability<0||member.probability>1)fail('study_membership_invalid');
    if(seen.has(identity)||member.source==='human'&&(!member.human_locked||member.probability!==1))fail('study_membership_invalid');seen.add(identity);
    if(root.axes.direction==='none'||root.axes.use!=='literal')continue;
    if(!member.human_locked){const ids=asked.get(motive.key)??new Set<string>();ids.add(root.root_id);asked.set(motive.key,ids);}
    if(member.probability<.7||root.axes.aggregate!=='subject')continue;
    const ids=byMotive.get(motive.key)??new Set<string>();ids.add(root.root_id);byMotive.set(motive.key,ids);
    const layers=byLayer.get(motive.layer)??new Set<string>();layers.add(root.root_id);byLayer.set(motive.layer,layers);
  }
  const layer_keys=[...byLayer].filter(([,ids])=>ids.size/cut.size>.5).map(([key])=>key).sort();
  const affected=args.motives.filter(m=>(byMotive.get(m.key)?.size??0)/cut.size>.5||layer_keys.includes(m.layer));
  const motive_keys=affected.filter(m=>!m.human_locked).map(m=>m.key).sort();
  const reask=new Set<string>();for(const key of motive_keys)for(const id of asked.get(key)??[])reask.add(id);
  return{motive_keys,layer_keys,reask_root_ids:[...reask].sort(),locked_motive_keys:affected.filter(m=>m.human_locked).map(m=>m.key).sort()};
}
/** The unredacted literal span remains private. Display is generated only after
 * exact UTF-8 substring verification and redaction; redacted prose is never
 * represented as an untouched source quote. */
export function verifySignalStudyVerbatimV1(root:SignalStudyRootV1,quote:string,additional_private_person_names:string[]=[]):{
  root_id:string;literal_sha256:string;display_text:string;redacted:boolean;source_url:string;channel:string;occurred_at:string}{
  assertSignalStudyRootsV1([root]);
  if(!quote.trim()||!root.text.includes(quote))fail('study_verbatim_not_literal');
  let url:URL;try{url=new URL(root.source_url);}catch{return fail('study_verbatim_source_invalid');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('study_verbatim_source_invalid');
  if(additional_private_person_names.some(name=>!name.trim()||!quote.includes(name)))fail('study_verbatim_privacy_invalid');
  let display=quote.normalize('NFC').replace(/@[\p{L}\p{N}_.-]+/gu,'[usuario]');
  for(const name of [...root.private_person_names,...additional_private_person_names].map(name=>name.normalize('NFC')).filter(name=>name.trim()).sort((a,b)=>b.length-a.length)){
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
    display=display.replace(new RegExp(escaped,'giu'),'[persona]');
  }
  return{root_id:root.root_id,literal_sha256:'sha256:'+createHash('sha256').update(quote).digest('hex'),display_text:display,
    redacted:display!==quote,source_url:url.href,channel:root.channel,occurred_at:root.occurred_at};
}
export function signalStudyQueryBiasV1(args:{query_terms:string[];problem_terms:string[];subject_roots:number;brand_baseline_roots:number}):{
  status:'possible_query_bias'|'query_not_problem_selected';reason:string;base_ratio:number|null;subject_roots:number;brand_baseline_roots:number}{
  if(!Number.isSafeInteger(args.subject_roots)||!Number.isSafeInteger(args.brand_baseline_roots)||args.subject_roots<0||args.brand_baseline_roots<args.subject_roots)fail('study_baseline_invalid');
  const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('und').trim();
  const problems=new Set(args.problem_terms.map(normalize)),matched=args.query_terms.filter(term=>problems.has(normalize(term)));
  return{status:matched.length?'possible_query_bias':'query_not_problem_selected',
    reason:matched.length?'The acquisition query includes problem vocabulary; direction partly reflects that selection.':'No configured problem term is present in the acquisition query; this does not prove absence of selection bias.',
    base_ratio:args.brand_baseline_roots?args.subject_roots/args.brand_baseline_roots:null,subject_roots:args.subject_roots,brand_baseline_roots:args.brand_baseline_roots};
}
export function signalStudyPromotionProposalV1(args:{study:SignalStudyV1;motive:SignalStudyMotiveV1;explicit_action:boolean;
  target_revision:number}):{action:'promote_study_motive';target_revision:number;question:{key:string;type:'noul';text:string;positive:string;negative:string;
    scope:'all';origin:'methodology';human_locked:true;topic_source:'defined'};source:{study_digest:string;motive_key:string}}{
  const study=validateSignalStudyV1(args.study);
  if(args.explicit_action!==true||!Number.isSafeInteger(args.target_revision)||args.target_revision<1)fail('study_promotion_explicit_action_required');
  return{action:'promote_study_motive',target_revision:args.target_revision,question:{key:args.motive.key,type:'noul',text:args.motive.name,
    positive:args.motive.definition,negative:'The configured motive is absent.',scope:'all',origin:'methodology',human_locked:true,topic_source:'defined'},
    source:{study_digest:digest(study),motive_key:args.motive.key}};
}
