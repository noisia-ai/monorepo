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
