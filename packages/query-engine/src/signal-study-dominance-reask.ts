import type{SignalStudyExecutionConfigurationV1}from'./signal-study-configuration';
import type{SignalStudyRootV1,SignalStudyMotiveV1,SignalStudyMembershipV1}from'./signal-study-evidence';
import{signalStudyJevMotiveConfigurationV1}from'./signal-study-jev-contracts';
import{buildSignalStudyMotiveRequestV1,buildSignalStudyMotiveReaskRequestV1}from'./signal-study-output';

/** Sealed in a newly prepared source before its digest. Absence identifies the
 * original compiler, including its configuration and replacement semantics. */
export const SIGNAL_STUDY_DOMINANCE_REASK_VERSION_V1='signal-study-dominance-reask-v1' as const;
export function resolveSignalStudyDominanceReaskVersionV1(value:unknown):typeof SIGNAL_STUDY_DOMINANCE_REASK_VERSION_V1|undefined{
 if(value===undefined)return undefined;
 if(value!==SIGNAL_STUDY_DOMINANCE_REASK_VERSION_V1)throw Error('study_dominance_reask_version_invalid');
 return value;
}

/** Shared by the worker and native replay. Never reinterpret an old immutable
 * source with a new candidate population: that changes its batch plan digest. */
export function compileSignalStudyDominanceReaskV1(args:{version:unknown;configuration:SignalStudyExecutionConfigurationV1;
 roots:SignalStudyRootV1[];motives:SignalStudyMotiveV1[];memberships:SignalStudyMembershipV1[];affected_keys:readonly string[]}){
 const version=resolveSignalStudyDominanceReaskVersionV1(args.version);
 const candidates=version?args.motives:args.motives.filter(m=>args.affected_keys.includes(m.key));
 const stage_configuration=signalStudyJevMotiveConfigurationV1(args.configuration,candidates);
 const lockedByRoot=new Map<string,string[]>();
 if(version)for(const row of args.memberships)if(row.human_locked){const keys=lockedByRoot.get(row.root_id)??[];keys.push(row.motive_key);lockedByRoot.set(row.root_id,keys);}
 const inputs=args.roots.flatMap(root=>{
  const request=version?buildSignalStudyMotiveReaskRequestV1(root,candidates,stage_configuration,{affected_keys:args.affected_keys,locked_keys:lockedByRoot.get(root.root_id)??[]})
   :buildSignalStudyMotiveRequestV1(root,candidates,stage_configuration);
  return request?[{root_id:root.root_id,request}]:[];
 });
 return{stage_configuration,inputs};
}

export function replaceSignalStudyDominanceMembershipsV1(args:{version:unknown;memberships:SignalStudyMembershipV1[];
 reasked:SignalStudyMembershipV1[];target_root_ids:ReadonlySet<string>;affected_keys:readonly string[]}):SignalStudyMembershipV1[]{
 if(resolveSignalStudyDominanceReaskVersionV1(args.version)===undefined){
  // Exact pre-version behavior. Do not "repair" the domain of an old journal.
  return[...args.memberships.filter(row=>!args.target_root_ids.has(row.root_id)||!args.affected_keys.includes(row.motive_key)||row.human_locked),...args.reasked];
 }
 const replaced=new Set(args.reasked.map(row=>JSON.stringify([row.root_id,row.motive_key])));
 return[...args.memberships.filter(row=>row.human_locked||!replaced.has(JSON.stringify([row.root_id,row.motive_key]))),...args.reasked];
}
