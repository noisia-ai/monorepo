import {createHash} from 'node:crypto';
import {LISTENING_DISCOVERY_POLICY_V1,listeningDiscoveryPolicyDigestV1,
  type ListeningDiscoveryPolicyV1,type ListeningDiscoveryRootV1,type ListeningDiscoveryEvidenceV1} from './signal-listening-discovery-v1';

export type ListeningDiscoveryMetadataV1=Omit<ListeningDiscoveryRootV1,'vector'>;
type Header={workspace_id:string;vector_space_digest:string;map_digest:string;round:number;expected_population_digest:string;
  expected_root_count:number;topic_keys:string[];policy?:ListeningDiscoveryPolicyV1;page_size?:number};
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sha=(value:unknown)=>'sha256:'+createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validKey=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/u,validDigest=/^sha256:[a-f0-9]{64}$/u;
function fail(code:string):never{throw Error('listening_discovery_'+code);}
function jsonArrayHash(){
  const hash=createHash('sha256').update('[');let count=0,closed=false;
  return{push(value:unknown){if(closed)fail('stream_closed');if(count++)hash.update(',');hash.update(JSON.stringify(value));},
    finish(){if(closed)fail('stream_closed');closed=true;return'sha256:'+hash.update(']').digest('hex');}};
}
type Ranked={id:string;rank:string};
type Topic={asked:number;members:string[];sum:number[]|null;memberHash:ReturnType<typeof jsonArrayHash>;
  accepted:Ranked[];rejected:Ranked[];centroid:number[]|null;memberDigest:string;centroidStatus:ListeningDiscoveryEvidenceV1['topics'][number]['centroid_status']};

/** Two ordered passes reproduce the eager v1 evidence exactly. The first pass
 * retains only output IDs/hashes, per-topic normalized sums, and pair counts.
 * The second pass has no document vectors or text: it selects the same seeded
 * examples and counts the distinct twin-root union. No raw root is retained.
 *
 * Output v1 itself contains O(roots) SHA/ID lineage and confirmed member IDs;
 * that contract is preserved rather than replaced by incomplete proof arrays.
 * Auxiliary vector memory is O(page_size*1024 + topics*1024), never O(roots*1024).
 */
export function createListeningDiscoveryEvidenceStreamV1(args:Header){
  const supplied=args.policy??LISTENING_DISCOVERY_POLICY_V1;
  const policy:ListeningDiscoveryPolicyV1={contract_version:supplied.contract_version,approval:supplied.approval,twin_jaccard:supplied.twin_jaccard,
    twin_coapproval:supplied.twin_coapproval,min_jointly_asked:supplied.min_jointly_asked,min_jointly_approved:supplied.min_jointly_approved,
    stop_absolute_improvement:supplied.stop_absolute_improvement,max_rounds:supplied.max_rounds,examples_per_stratum:supplied.examples_per_stratum};
  // Copy only the header fields: spreading an eager caller's object here could
  // accidentally retain its entire `roots` array in this closure.
  args=Object.freeze({workspace_id:args.workspace_id,vector_space_digest:args.vector_space_digest,map_digest:args.map_digest,round:args.round,
    expected_population_digest:args.expected_population_digest,expected_root_count:args.expected_root_count,topic_keys:[...args.topic_keys],policy,page_size:args.page_size});
  const policyDigest=listeningDiscoveryPolicyDigestV1(policy);
  const pageSize=args.page_size??1024;
  if(!validKey.test(args.workspace_id)||!validDigest.test(args.vector_space_digest)||!validDigest.test(args.map_digest)
    ||!validDigest.test(args.expected_population_digest)||!Number.isSafeInteger(args.round)||args.round<1||args.round>policy.max_rounds
    ||!Number.isSafeInteger(args.expected_root_count)||args.expected_root_count<1||!args.topic_keys.length||args.topic_keys.length>256
    ||new Set(args.topic_keys).size!==args.topic_keys.length||args.topic_keys.some(key=>!validKey.test(key))
    ||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1024)fail('input_invalid');
  const keys=[...args.topic_keys].sort(cmp),known=new Set(keys);
  const topics=new Map<string,Topic>(keys.map(key=>[key,{asked:0,members:[],sum:new Array<number>(1024).fill(0),
    memberHash:jsonArrayHash(),accepted:[],rejected:[],centroid:null,memberDigest:'',centroidStatus:'no_confirmed_members'}]));
  const pairs=new Map<string,{jointly_asked:number;jointly_approved:number}>(),twinKeys=new Set<string>();
  const inputByRoot:Record<string,string>={},orphans:string[]=[];
  const census=jsonArrayHash(),evaluationsHash=jsonArrayHash();
  const censusSecond=jsonArrayHash(),evaluationsSecond=jsonArrayHash();
  let state:'first'|'second'|'completed'='first',count=0,categoryCount=0,secondCount=0,twinRootCount=0;
  let previous='',secondPrevious='',populationDigest='',evaluationDigest='',peakPageRoots=0;
  let twins:ListeningDiscoveryEvidenceV1['twins']=[];

  function validateMetadata(root:ListeningDiscoveryMetadataV1,last:string){
    if(!validKey.test(root.root_id)||!validDigest.test(root.input_sha256)||typeof root.in_category!=='boolean'
      ||!Array.isArray(root.evaluations)||new Set(root.evaluations.map(e=>e.topic_key)).size!==root.evaluations.length)fail('root_invalid');
    if(last&&cmp(last,root.root_id)>=0)fail(last===root.root_id?'root_invalid':'stream_order_invalid');
    const evaluations=[...root.evaluations].sort((a,b)=>cmp(a.topic_key,b.topic_key));
    if(evaluations.some(e=>!known.has(e.topic_key)||!Number.isFinite(e.probability)||e.probability<0||e.probability>1))fail('evaluation_invalid');
    return evaluations;
  }
  function pushHashes(root:ListeningDiscoveryMetadataV1,evaluations:ListeningDiscoveryMetadataV1['evaluations'],
    population:ReturnType<typeof jsonArrayHash>,evaluation:ReturnType<typeof jsonArrayHash>){
    population.push([root.root_id,root.input_sha256,root.in_category]);
    evaluation.push([root.root_id,root.input_sha256,root.in_category,evaluations.map(e=>[e.topic_key,e.probability])]);
  }
  function addFirstPage(roots:ListeningDiscoveryRootV1[]):void{
    if(state!=='first')fail('stream_phase_invalid');if(roots.length>pageSize)fail('stream_page_invalid');
    peakPageRoots=Math.max(peakPageRoots,roots.length);
    for(const root of roots){
      const evaluations=validateMetadata(root,previous);
      if(root.vector.length!==1024||root.vector.some(value=>!Number.isFinite(value)))fail('root_invalid');
      const norm=Math.hypot(...root.vector);if(!Number.isFinite(norm)||norm===0)fail('vector_invalid');
      if(++count>args.expected_root_count)fail('input_invalid');
      previous=root.root_id;inputByRoot[root.root_id]=root.input_sha256;pushHashes(root,evaluations,census,evaluationsHash);
      let accepted=false;
      for(const e of evaluations){const topic=topics.get(e.topic_key)!;topic.asked++;
        if(e.probability>=policy.approval){accepted=true;topic.members.push(root.root_id);topic.memberHash.push([root.root_id,root.input_sha256]);
          for(let dimension=0;dimension<1024;dimension++)topic.sum![dimension]!+=root.vector[dimension]!/norm;}
      }
      if(root.in_category){categoryCount++;if(!accepted)orphans.push(root.root_id);}
      for(let a=0;a<evaluations.length;a++)for(let b=a+1;b<evaluations.length;b++){
        const left=evaluations[a]!,right=evaluations[b]!,key=left.topic_key+'\0'+right.topic_key;
        const pair=pairs.get(key)??{jointly_asked:0,jointly_approved:0};pair.jointly_asked++;
        if(left.probability>=policy.approval&&right.probability>=policy.approval)pair.jointly_approved++;
        pairs.set(key,pair);
      }
    }
  }
  function finishFirstPass():{population_digest:string;root_count:number}{
    if(state!=='first')fail('stream_phase_invalid');if(count!==args.expected_root_count)fail('input_invalid');
    populationDigest=census.finish();evaluationDigest=evaluationsHash.finish();
    if(populationDigest!==args.expected_population_digest)fail('population_changed');
    for(const topic of topics.values()){
      topic.memberDigest=topic.memberHash.finish();const norm=Math.hypot(...topic.sum!);
      if(topic.members.length&&norm>1e-12){
        for(let dimension=0;dimension<1024;dimension++)topic.sum![dimension]!/=norm;
        topic.centroid=topic.sum;topic.centroidStatus='confirmed';
      }else topic.centroidStatus=topic.members.length?'cancelled_vectors':'no_confirmed_members';
      topic.sum=null;
    }
    twins=[...pairs].sort(([a],[b])=>cmp(a,b)).flatMap(([key,pair])=>{
      const [left,right]=key.split('\0') as [string,string];
      const union=topics.get(left)!.members.length+topics.get(right)!.members.length-pair.jointly_approved;
      const jaccard=union?pair.jointly_approved/union:0,coapproval=pair.jointly_approved/pair.jointly_asked;
      if(pair.jointly_asked<policy.min_jointly_asked||pair.jointly_approved<policy.min_jointly_approved
        ||jaccard<policy.twin_jaccard&&coapproval<policy.twin_coapproval)return[];
      twinKeys.add(key);return[{left,right,...pair,union_approved:union,jaccard,coapproval}];
    });
    state='second';return{population_digest:populationDigest,root_count:count};
  }
  function rankExample(list:Ranked[],id:string,topic:string,stratum:'accepted'|'rejected'){
    const entry={id,rank:sha([populationDigest,topic,stratum,id])};
    const index=list.findIndex(current=>cmp(entry.rank,current.rank)<0||entry.rank===current.rank&&cmp(entry.id,current.id)<0);
    if(index>=0)list.splice(index,0,entry);else if(list.length<policy.examples_per_stratum)list.push(entry);
    if(list.length>policy.examples_per_stratum)list.pop();
  }
  function addSecondPage(roots:ListeningDiscoveryMetadataV1[]):void{
    if(state!=='second')fail('stream_phase_invalid');if(roots.length>pageSize)fail('stream_page_invalid');
    for(const root of roots){const evaluations=validateMetadata(root,secondPrevious);
      if(++secondCount>args.expected_root_count||!Object.hasOwn(inputByRoot,root.root_id)||inputByRoot[root.root_id]!==root.input_sha256)fail('population_changed');
      secondPrevious=root.root_id;pushHashes(root,evaluations,censusSecond,evaluationsSecond);
      for(const e of evaluations){const topic=topics.get(e.topic_key)!;
        rankExample(e.probability>=policy.approval?topic.accepted:topic.rejected,root.root_id,e.topic_key,e.probability>=policy.approval?'accepted':'rejected');}
      if(root.in_category){const approved=evaluations.filter(e=>e.probability>=policy.approval);let twin=false;
        for(let a=0;a<approved.length&&!twin;a++)for(let b=a+1;b<approved.length;b++)if(twinKeys.has(approved[a]!.topic_key+'\0'+approved[b]!.topic_key)){twin=true;break;}
        if(twin)twinRootCount++;
      }
    }
  }
  function finish():ListeningDiscoveryEvidenceV1{
    if(state!=='second')fail('stream_phase_invalid');
    if(secondCount!==count||censusSecond.finish()!==populationDigest||evaluationsSecond.finish()!==evaluationDigest)fail('stream_snapshot_changed');
    state='completed';
    return{contract_version:'listening-discovery-evidence-v1',workspace_id:args.workspace_id,vector_space_digest:args.vector_space_digest,
      population_digest:populationDigest,policy_digest:policyDigest,map_digest:args.map_digest,round:args.round,root_count:count,
      root_input_sha256:inputByRoot,category_root_count:categoryCount,orphan_root_ids:orphans,orphan_rate:categoryCount?orphans.length/categoryCount:null,
      twin_root_count:twinRootCount,twin_root_rate:categoryCount?twinRootCount/categoryCount:null,twins,
      topics:keys.map(topic_key=>{const t=topics.get(topic_key)!;return{topic_key,asked:t.asked,approved:t.members.length,
        acceptance_rate:t.asked?t.members.length/t.asked:null,confirmed_root_ids:t.members,confirmed_members_digest:t.memberDigest,
        centroid:t.centroid,centroid_status:t.centroidStatus,accepted_examples:t.accepted.map(row=>row.id),rejected_examples:t.rejected.map(row=>row.id)};})};
  }
  function inspectMemory(){return{population_roots:count,peak_page_roots:peakPageRoots,
    retained_vector_values:[...topics.values()].reduce((sum,t)=>sum+(t.sum?.length??t.centroid?.length??0),0),
    retained_example_ids:[...topics.values()].reduce((sum,t)=>sum+t.accepted.length+t.rejected.length,0),
    confirmed_member_ids:[...topics.values()].reduce((sum,t)=>sum+t.members.length,0),pair_count:pairs.size};}
  return{addFirstPage,finishFirstPass,addSecondPage,finish,inspectMemory};
}
