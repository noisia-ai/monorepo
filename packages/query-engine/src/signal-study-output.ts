import {validateSignalStudyV1,signalStudyPermissionForLayerV1,type SignalStudyTemplateSnapshotV1,type SignalStudyV1,type SignalStudyDirectionV1,type SignalStudyLayerV1} from './signal-study-contracts';
import {assertSignalStudyRootsV1,signalStudyNearestMotivesV1,type SignalStudyRootV1,type SignalStudyMotiveV1,type SignalStudyMembershipV1} from './signal-study-evidence';
import {validateSignalListeningConfigurationV1,type SignalListeningConfigurationV1} from './signal-listening-contracts';
import {buildSignalListeningJevRequestV1} from './signal-listening-contracts';
import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import type {JevRequestV1} from './signal-mention-facets-jev-v1';

/** Motive wording is persisted as a new Study configuration. The generic JEV
 * compiler can then ask only these four keys, without repeating base or axes. */
export function buildSignalStudyMotiveConfigurationV1(configuration:SignalListeningConfigurationV1,motives:SignalStudyMotiveV1[]):SignalListeningConfigurationV1{
  return validateSignalListeningConfigurationV1({...configuration,questions:[...configuration.questions,
    ...motives.map(motive=>({key:motive.key,type:'noul' as const,text:motive.name,positive:motive.definition,
      negative:'The defined motive is absent; shared vocabulary alone is insufficient.',scope:'all' as const,origin:'methodology' as const,
      human_locked:motive.human_locked,topic_source:'discovered' as const,domain:'category' as const}))]});
}
export function buildSignalStudyMotiveRequestV1(root:SignalStudyRootV1,motives:SignalStudyMotiveV1[],configuration:SignalListeningConfigurationV1):JevRequestV1|null{
  const candidates=signalStudyNearestMotivesV1(root,motives);if(!candidates.length)return null;
  const config=validateSignalListeningConfigurationV1(configuration);
  for(const candidate of candidates){const q=config.questions.find(q=>q.key===candidate.key),m=motives.find(m=>m.key===candidate.key)!;
    if(q?.type!=='noul'||q.origin!=='methodology'||q.positive!==m.definition||q.text!==m.name)throw Error('study_motive_configuration_mismatch');}
  return buildSignalListeningJevRequestV1({text:root.selected_fragment?.text??root.text,question_keys:candidates.map(c=>c.key)},config);
}

/** Contrast changes wording, never the global nearest-four domain. Select the
 * original global request first, then intersect its actual question keys with
 * affected/unlocked pairs. Filtering the motive population before ranking
 * would pad the request with previously unasked motives. */
export function buildSignalStudyMotiveReaskRequestV1(root:SignalStudyRootV1,motives:SignalStudyMotiveV1[],configuration:SignalListeningConfigurationV1,
 scope:{affected_keys:readonly string[];locked_keys?:readonly string[]}):JevRequestV1|null{
  const byKey=new Map(motives.map(m=>[m.key,m])),locked=scope.locked_keys===undefined?[]:scope.locked_keys;
  for(const keys of [scope.affected_keys,locked])if(!Array.isArray(keys)||new Set(keys).size!==keys.length||keys.some(key=>!byKey.has(key)))
    throw Error('study_motive_reask_scope_invalid');
  const original=buildSignalStudyMotiveRequestV1(root,motives,configuration);if(!original)return null;
  const affected=new Set(scope.affected_keys),protectedKeys=new Set(locked);
  const questions=Object.fromEntries(Object.entries(original.questions).filter(([key])=>affected.has(key)&&!protectedKeys.has(key)&&!byKey.get(key)!.human_locked));
  return Object.keys(questions).length?{...original,questions}:null;
}

type Counts=Record<SignalStudyDirectionV1,number>;
type Aggregate='subject'|'competitor'|'alternative';
const counts=():Counts=>({trigger:0,barrier:0,mixed:0,none:0});
export type SignalStudySummaryV1={contract_version:'signal-study-output-v1';status:'directional';study_digest:string;population_digest:string;
  denominator:number;resolved_axes:number;unresolved_axes:number;count_unit:'mentions_with_signal';multilabel:true;
  direction:Counts;axes_raw_direction:Counts;subject_direction:Counts;competitor_direction:Counts;alternative_direction:Counts;figurative_or_ironic:number;other_use:number;
  motives:Array<{key:string;name:string;layer:SignalStudyLayerV1;permission:ReturnType<typeof signalStudyPermissionForLayerV1>;
    permission_overridden:boolean;permission_override_reason:string|null;
    mentions:number;share_of_cut:number;subject:Counts;competitor:Counts;alternative:Counts;mixed:number}>;
  layers:Array<{key:SignalStudyLayerV1;mentions:number;share_of_cut:number;direction:Counts}>;
  motive_by_topic:Array<{motive_key:string;aggregate:Aggregate;topic_key:string;mentions:number}>;
  motive_by_channel:Array<{motive_key:string;aggregate:Aggregate;channel:string;mentions:number}>;
  series:Array<{motive_key:string;aggregate:Aggregate;date:string;direction:Counts}>;limitations:string[]};
export function buildSignalStudySummaryV1(args:{study:SignalStudyV1;template_snapshot?:SignalStudyTemplateSnapshotV1;roots:SignalStudyRootV1[];motives:SignalStudyMotiveV1[];
  memberships:SignalStudyMembershipV1[];cut_root_ids:string[];unresolved_root_ids:string[]}):SignalStudySummaryV1{
  const study=validateSignalStudyV1(args.study,args.template_snapshot);assertSignalStudyRootsV1(args.roots);
  const byRoot=new Map(args.roots.map(root=>[root.root_id,root])),motives=new Map(args.motives.map(m=>[m.key,m]));
  const census=new Set(args.cut_root_ids),unresolved=new Set(args.unresolved_root_ids);
  if(census.size!==args.cut_root_ids.length||unresolved.size!==args.unresolved_root_ids.length
    ||[...byRoot.keys()].some(id=>!census.has(id))||[...unresolved].some(id=>!census.has(id)||byRoot.has(id))
    ||byRoot.size+unresolved.size!==census.size)throw Error('study_output_coverage_incomplete');
  if(motives.size!==args.motives.length)throw Error('study_motive_duplicate');
  for(const root of args.roots)if(Date.parse(root.occurred_at)<Date.parse(study.cut.start_at)||Date.parse(root.occurred_at)>=Date.parse(study.cut.end_at))throw Error('study_output_cut_mismatch');
  const direction=counts(),rawDirection=counts(),subject=counts(),competitor=counts(),alternative=counts();let figurative=0,other=0;
  for(const root of args.roots){
    // Keep the original classifier axis for audit, separately from the literal
    // force balance and any subject-relative alternative inversion.
    rawDirection[root.axes.source_direction]++;
    if(root.axes.use==='literal')direction[root.axes.direction]++;
    switch(root.axes.aggregate){case'subject':subject[root.axes.direction]++;break;case'competitor':competitor[root.axes.direction]++;break;
      case'alternative':alternative[root.axes.direction]++;break;case'figurative_or_ironic':figurative++;break;case'other':other++;break;}}
  const byMotive=new Map<string,Set<string>>(),byLayer=new Map<SignalStudyLayerV1,Set<string>>(),unique=new Set<string>();
  for(const row of args.memberships){
    const root=byRoot.get(row.root_id),motive=motives.get(row.motive_key),identity=JSON.stringify([row.root_id,row.motive_key]);
    if(!root||!motive||unique.has(identity)||!Number.isFinite(row.probability)||row.probability<0||row.probability>1
      ||row.source==='human'&&(!row.human_locked||row.probability!==1))throw Error('study_membership_invalid');
    unique.add(identity);
    if(row.probability<.7||root.axes.direction==='none'||root.axes.use!=='literal')continue;
    const members=byMotive.get(motive.key)??new Set<string>();members.add(root.root_id);byMotive.set(motive.key,members);
    // Competitor/alternative-only evidence is reported separately and never
    // contributes to the category/own-subject layer aggregate.
    if(root.axes.aggregate==='subject'){
      const layers=byLayer.get(motive.layer)??new Set<string>();layers.add(root.root_id);byLayer.set(motive.layer,layers);
    }
  }
  const topics=new Map<string,{motive_key:string;aggregate:Aggregate;topic_key:string;mentions:number}>(),channels=new Map<string,{motive_key:string;aggregate:Aggregate;channel:string;mentions:number}>();
  const series=new Map<string,{motive_key:string;aggregate:Aggregate;date:string;direction:Counts}>();
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:study.cut.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  const rows=args.motives.map(motive=>{
    const members=byMotive.get(motive.key)??new Set<string>(),own=counts(),comp=counts(),alt=counts();let mixed=0;
    for(const id of members){const root=byRoot.get(id)!;
      const aggregate=root.axes.aggregate as Aggregate;
      (root.axes.aggregate==='subject'?own:root.axes.aggregate==='competitor'?comp:alt)[root.axes.direction]++;
      if(root.axes.direction==='mixed')mixed++;
      for(const topic_key of new Set(root.listening_topic_keys)){
        const k=JSON.stringify([motive.key,aggregate,topic_key]),row=topics.get(k)??{motive_key:motive.key,aggregate,topic_key,mentions:0};row.mentions++;topics.set(k,row);
      }
      const ckey=JSON.stringify([motive.key,aggregate,root.channel]),channel=channels.get(ckey)??{motive_key:motive.key,aggregate,channel:root.channel,mentions:0};channel.mentions++;channels.set(ckey,channel);
      const parts=Object.fromEntries(formatter.formatToParts(new Date(root.occurred_at)).map(p=>[p.type,p.value]));
      const date=`${parts.year}-${parts.month}-${parts.day}`,skey=JSON.stringify([motive.key,aggregate,date]);
      const point=series.get(skey)??{motive_key:motive.key,aggregate,date,direction:counts()};point.direction[root.axes.direction]++;series.set(skey,point);
    }
    if(motive.permission_override&&(!motive.permission_override.reason.trim()||motive.layer==='unclear'&&motive.permission_override.permission!=='no_permission'))throw Error('study_permission_override_invalid');
    const basePermission=signalStudyPermissionForLayerV1(motive.layer);
    return{key:motive.key,name:motive.name,layer:motive.layer,permission:motive.permission_override?.permission??basePermission,
      permission_overridden:Boolean(motive.permission_override&&motive.permission_override.permission!==basePermission),
      permission_override_reason:motive.permission_override?.reason??null,mentions:members.size,
      share_of_cut:census.size?members.size/census.size:0,subject:own,competitor:comp,alternative:alt,mixed};
  }).sort((a,b)=>b.mentions-a.mentions||a.key.localeCompare(b.key));
  const layers=[...byLayer].map(([key,ids])=>{const direction=counts();for(const id of ids)direction[byRoot.get(id)!.axes.direction]++;
    return{key,mentions:ids.size,share_of_cut:census.size?ids.size/census.size:0,direction};}).sort((a,b)=>a.key.localeCompare(b.key));
  return{contract_version:'signal-study-output-v1',status:'directional',study_digest:digest(study),
    population_digest:digest({roots:args.roots.map(r=>({root_id:r.root_id,text_sha256:r.text_sha256,axes:r.axes})).sort((a,b)=>a.root_id.localeCompare(b.root_id)),
      unresolved_root_ids:[...unresolved].sort(),cut_root_ids:[...census].sort()}),
    denominator:census.size,resolved_axes:byRoot.size,unresolved_axes:unresolved.size,count_unit:'mentions_with_signal',multilabel:true,direction,axes_raw_direction:rawDirection,subject_direction:subject,competitor_direction:competitor,
    alternative_direction:alternative,figurative_or_ironic:figurative,other_use:other,motives:rows,layers,
    motive_by_topic:[...topics.values()].sort((a,b)=>a.motive_key.localeCompare(b.motive_key)||a.aggregate.localeCompare(b.aggregate)||a.topic_key.localeCompare(b.topic_key)),
    motive_by_channel:[...channels.values()].sort((a,b)=>a.motive_key.localeCompare(b.motive_key)||a.aggregate.localeCompare(b.aggregate)||a.channel.localeCompare(b.channel)),
    series:[...series.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.motive_key.localeCompare(b.motive_key)||a.aggregate.localeCompare(b.aggregate)),
    limitations:['Directional results; the blind auditor evaluates classification quality.','Counts represent mentions with signals, not people or market demand.',
      'Motives are multi-label; shares must not be added across motives.','Layer counts exclude competitor and alternative-only aggregates; unclear remains separate.']};
}
