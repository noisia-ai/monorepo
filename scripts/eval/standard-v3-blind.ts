import {selectPrevalenceSampleV2} from './standard-v2-blind';
type Pair={root_id:string;concept_key:string};
const key=(row:Pair)=>`${row.root_id}:${row.concept_key}`;
export function reviewedPairExclusionV3(trace:{positive_items:Pair[];disagreement_items:Pair[]}){
 if(trace.positive_items.length!==60||trace.disagreement_items.length!==60||[...trace.positive_items,...trace.disagreement_items].some(row=>!row.root_id||!row.concept_key))throw new Error('mfp_previous_review_population_invalid');
 return new Set([...trace.positive_items,...trace.disagreement_items].map(key));
}
/** Filter before computing prevalence; no reviewed case is reused to assess the prompt designed from it. */
export function selectFreshPrevalenceSampleV3<T extends Pair>(rows:T[],excluded:ReadonlySet<string>,seed:string,size=60){
 return selectPrevalenceSampleV2(rows.filter(row=>!excluded.has(key(row))),seed,size);
}

/** AUDIT §17.5.6 allows 60 disagreements total, shared equally across completed arms. */
export function selectFreshDisagreementsV3<T extends Pair>(rows:T[],excluded:ReadonlySet<string>,seed:string,armCount:number){
 if(!Number.isSafeInteger(armCount)||armCount<1||armCount>2)throw new Error('mfp_standard_sample_arms_invalid');
 const fresh=rows.filter(row=>!excluded.has(key(row)));
 return fresh.length?selectPrevalenceSampleV2(fresh,seed,Math.min(fresh.length,Math.floor(60/armCount))):[];
}
