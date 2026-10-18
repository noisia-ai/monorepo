import type {MembershipInputV1} from './signal-concept-membership-v1';
export type HybridCitationWindowV1={start:number;end:number;index:number;count:number};
export type HybridWindowInputV1=MembershipInputV1&{citation_window:HybridCitationWindowV1};
/** Text and provenance remain whole-root. Only supplied spans are windowed. */
export function hybridCitationWindowsV1(input:MembershipInputV1,maxCharacters=6000):HybridWindowInputV1[]{
 if(!Number.isSafeInteger(maxCharacters)||maxCharacters<1)throw Error('hybrid_window_size_invalid');
 const segments=[...new Intl.Segmenter('und',{granularity:'sentence'}).segment(input.text)];
 const bounds:Array<{start:number;end:number}>=[];let start=0,end=0;
 for(const segment of segments){
  const next=segment.index+segment.segment.length;
  if(segment.index>start&&next-start>maxCharacters){bounds.push({start,end});start=segment.index;}
  end=next;
 }
 if(end>start)bounds.push({start,end});
 if(!bounds.length)throw Error('hybrid_window_text_empty');
 return bounds.map((bound,index)=>({...input,citation_window:{...bound,index,count:bounds.length}}));
}
