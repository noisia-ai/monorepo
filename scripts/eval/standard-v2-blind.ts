import {createHash} from 'node:crypto';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function selectPrevalenceSampleV2<T extends {root_id:string;concept_key:string}>(rows:T[],seed:string,size=60):T[]{
 if(rows.length<size||new Set(rows.map(row=>`${row.root_id}:${row.concept_key}`)).size!==rows.length)throw new Error('mfp_standard_sample_population_invalid');
 const groups=new Map<string,T[]>();
 for(const row of rows){const group=groups.get(row.concept_key)??[];group.push(row);groups.set(row.concept_key,group);}
 const allocations=[...groups].map(([key,group])=>({key,n:Math.floor(group.length*size/rows.length),remainder:group.length*size/rows.length%1}));
 let remainder=size-allocations.reduce((sum,item)=>sum+item.n,0);
 for(const item of [...allocations].sort((a,b)=>b.remainder-a.remainder||a.key.localeCompare(b.key))){if(!remainder)break;item.n++;remainder--;}
 return allocations.sort((a,b)=>a.key.localeCompare(b.key)).flatMap(({key,n})=>groups.get(key)!.sort((a,b)=>hash(`${seed}:${a.root_id}:${a.concept_key}`).localeCompare(hash(`${seed}:${b.root_id}:${b.concept_key}`))).slice(0,n));
}
export function normalizeCitationsV2(text:string,citations:Array<{quote:string;start?:number;end?:number;quote_start?:number;quote_end?:number}>){
 const spans=citations.map(c=>({quote:c.quote,start:c.start??c.quote_start!,end:c.end??c.quote_end!})).sort((a,b)=>a.start-b.start||a.end-b.end);
 for(const c of spans)if(!Number.isSafeInteger(c.start)||!Number.isSafeInteger(c.end)||c.start<0||c.end<=c.start||text.slice(c.start,c.end)!==c.quote)throw new Error('mfp_standard_citation_invalid');
 const merged:typeof spans=[];
 for(const c of spans){const last=merged.at(-1);if(last&&c.start<=last.end){last.end=Math.max(last.end,c.end);last.quote=text.slice(last.start,last.end);}else merged.push({...c});}
 return merged;
}
export function blindDisagreementV2(key:string,seed:string,versions:Array<{verdict:string;citations:unknown[]}>) {
 const order=parseInt(hash(`${seed}:${key}`).slice(0,2),16)%2?[1,0]:[0,1];
 return {options:order.map((version,index)=>({option_id:String.fromCharCode(65+index),verdict:versions[version]!.verdict,citations:versions[version]!.citations})),version_order:order};
}
