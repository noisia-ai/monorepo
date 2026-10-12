import {binary,wilson} from './metrics';
type Row={partition:'dev'|'test';truth:boolean;probability:number|null};
/** Cached probabilities only. Test never participates in choosing the threshold. */
export function sweepHybridThresholdsV1(rows:readonly Row[]){
 if(rows.some(r=>r.probability!==null&&(!Number.isFinite(r.probability)||r.probability<0||r.probability>1)))throw Error('hybrid_sweep_probability_invalid');
 const score=(threshold:number,partition:'dev'|'test')=>{
  const part=rows.filter(r=>r.partition===partition),positive=(r:Row)=>r.probability!==null&&r.probability>=threshold;
  const tp=part.filter(r=>r.truth&&positive(r)).length,fp=part.filter(r=>!r.truth&&positive(r)).length,
   fn=part.filter(r=>r.truth&&!positive(r)).length;
  return {threshold,...binary(tp,fp,fn),denominator:part.length,
   missing_probabilities:part.filter(r=>r.probability===null).length,
   precision_wilson:wilson(tp,tp+fp),recall_wilson:wilson(tp,tp+fn)};
 };
 const dev=[.30,.35,.40].map(t=>score(t,'dev'));
 const selected=[...dev].sort((a,b)=>(b.f1??-1)-(a.f1??-1)||(b.recall??-1)-(a.recall??-1)||b.threshold-a.threshold)[0]!;
 return {dev,selected_threshold:selected.threshold,selected_on:'dev' as const,
  test:score(selected.threshold,'test'),new_provider_calls:0,calibration_claim:'not_established' as const};
}
