import { createHash } from 'node:crypto';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** The exclusion is by root, including all of that root's concept pairs. */
export function selectDisjointHybridPositivesV1<T extends {root_id:string;concept_key:string}>(rows:T[],excluded:Set<string>,seed:string,size=30):T[]{
 const eligible=rows.filter(row=>!excluded.has(row.root_id));
 if(new Set(eligible.map(row=>row.root_id)).size<size)throw new Error('hybrid_blind_sample_insufficient');
 const grouped=new Map<string,T[]>();
 for(const row of eligible){const group=grouped.get(row.concept_key)??[];group.push(row);grouped.set(row.concept_key,group);}
 for(const group of grouped.values())group.sort((a,b)=>hash(`${seed}:${a.root_id}:${a.concept_key}`).localeCompare(hash(`${seed}:${b.root_id}:${b.concept_key}`)));
 const selected:T[]=[],seen=new Set<string>();
 while(selected.length<size)for(const key of [...grouped.keys()].sort()){
  const group=grouped.get(key)!;let row:T|undefined;
  while((row=group.shift())&&seen.has(row.root_id)){}
  if(row){selected.push(row);seen.add(row.root_id);}if(selected.length===size)break;
 }
 return selected;
}
