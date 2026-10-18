import {createHash} from 'node:crypto';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

/** Hamilton allocation on all model positives; exclusions remove entire roots only from sampling.
 * Bipartite matching gives each root one slot while preserving the preregistered concept quotas. */
export function selectPrevalencePositivesV1<T extends {root_id:string;concept_key:string}>(rows:T[],excluded:Set<string>,seed:string,size=60){
 const groups=new Map<string,Map<string,T>>();
 for(const row of rows){const group=groups.get(row.concept_key)??new Map<string,T>();
  if(group.has(row.root_id))throw Error('blind_duplicate_pair');group.set(row.root_id,row);groups.set(row.concept_key,group);}
 const keys=[...groups.keys()].sort(),total=rows.length;
 if(!Number.isSafeInteger(size)||size<keys.length||!keys.length||total<size)throw Error('blind_sample_invalid');
 const quotas=Object.fromEntries(keys.map(key=>[key,Math.floor(size*groups.get(key)!.size/total)]));
 const remainder=[...keys].sort((a,b)=>(size*groups.get(b)!.size/total)%1-(size*groups.get(a)!.size/total)%1||a.localeCompare(b));
 for(let i=0;Object.values(quotas).reduce((a,b)=>a+b,0)<size;i++)quotas[remainder[i]!]!++;
 for(const key of keys)if(!quotas[key]){
  const donor=[...keys].filter(k=>quotas[k]!>1).sort((a,b)=>quotas[b]!-quotas[a]!||a.localeCompare(b))[0];
  if(!donor)throw Error('blind_sample_invalid');quotas[donor]!--;quotas[key]=1;
 }
 const eligible=new Map(keys.map(key=>[key,[...groups.get(key)!.values()].filter(r=>!excluded.has(r.root_id))
  .sort((a,b)=>hash(`${seed}:${a.root_id}:${key}`).localeCompare(hash(`${seed}:${b.root_id}:${key}`)))]));
 for(const key of keys)if(eligible.get(key)!.length<quotas[key]!)throw Error('blind_stratum_insufficient');
 const slots=keys.flatMap(key=>Array.from({length:quotas[key]!},()=>key));
 const owners=new Map<string,number>(),chosen=new Map<number,T>();
 const assign=(slot:number,visited:Set<string>):boolean=>{
  for(const row of eligible.get(slots[slot]!)!){
   if(visited.has(row.root_id))continue;visited.add(row.root_id);
   const owner=owners.get(row.root_id);
   if(owner===undefined||assign(owner,visited)){owners.set(row.root_id,slot);chosen.set(slot,row);return true;}
  }return false;
 };
 for(let slot=0;slot<slots.length;slot++)if(!assign(slot,new Set()))throw Error('blind_distinct_roots_insufficient');
 return {quotas,population:Object.fromEntries(keys.map(key=>[key,groups.get(key)!.size])),
  items:[...chosen.entries()].sort(([a],[b])=>a-b).map(([,row])=>row)};
}
