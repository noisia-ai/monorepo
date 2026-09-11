import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {appendSignalSemanticContextProposalsV1, type SignalSemanticContextQueryable} from './signal-semantic-context-proposal';

function fixture() {
  const workspace={id:randomUUID(),organization_id:randomUUID(),brand_id:randomUUID()};
  const actor={id:randomUUID(),user_type:'noisia_internal' as const};
  const lineage={proposal_model:'claude-sonnet-4-6',proposal_model_version:'claude-sonnet-4-6',
    proposal_prompt_digest:'sha256:'+'a'.repeat(64),proposal_pricing_version:'synthetic-v1'};
  const generations=[1,2].map(version=>({id:randomUUID(),generation_key:`semantic-context-v${version}`,status:'draft',
    brand_os_profile_id:randomUUID(),brand_os_digest:'sha256:'+'b'.repeat(64),
    knowledge_digest:'sha256:'+String(version).repeat(64),locale_context_digest:'sha256:'+'c'.repeat(64),...lineage}));
  const proposal={element_key:'benefit.scheduled-repairs',element_kind:'benefit',canonical_key:'scheduled-repairs',
    display_text:'Scheduled repairs',scope:'primary_brand',entity_type:null,entity_id:null,locale:null,
    relation_kind:null,relation_target_key:null,confidence:1,origin_kind:'provider_proposal' as const,
    source_refs:[{source_type:'knowledge_source',source_id:randomUUID(),relation_type:'supports'}]};
  type Operation={id:string;actor_user_id:unknown;action:unknown;request_digest:unknown;status:string;result:unknown};
  type Artifact={id:string;workspace_id:unknown;digest:unknown;key:unknown;revision:number;content:unknown;metadata:unknown};
  type Element={id:string;generation_id:unknown;artifact_id:unknown;element_key:unknown;element_digest:unknown;
    source_refs_digest:unknown;origin_kind:unknown;element_version:number;disposition:string};
  const operations=new Map<unknown,Operation>(),artifacts:Artifact[]=[],elements:Element[]=[];
  const queryable:SignalSemanticContextQueryable={async query<T>(sql:string,values:unknown[]=[]){let rows:unknown[]=[];
    if(sql.includes('pg_advisory_xact_lock'))return{rows:[],rowCount:1};
    if(sql.includes('FROM signal_semantic_context_generations'))rows=generations.filter(row=>row.generation_key===values[1]);
    else if(sql.startsWith('WITH requested AS('))rows=[{allowed:true}];
    else if(sql.includes('signal_data_governance_actor_is_valid'))rows=[{allowed:true}];
    else if(sql.startsWith('INSERT INTO signal_governance_control_operations')){
      if(!operations.has(values[4]))operations.set(values[4],{id:randomUUID(),actor_user_id:values[1],action:values[2],
        request_digest:values[3],status:'in_progress',result:null});
    }else if(sql.includes('FROM signal_governance_control_operations'))rows=[operations.get(values[1])!];
    else if(sql.startsWith('UPDATE signal_governance_control_operations')){
      const op=operations.get(values[1])!;op.status='completed';op.result=JSON.parse(String(values[2]));return{rows:[],rowCount:1};
    }else if(sql.startsWith('SELECT 1 FROM signal_semantic_context_element_versions')){
      rows=elements.filter(row=>row.generation_id===values[0]&&row.element_key===values[1]);
    }else if(sql.startsWith('INSERT INTO analysis_artifacts')){
      const row={id:randomUUID(),workspace_id:values[0],digest:values[1],key:values[2],revision:1,
        content:JSON.parse(String(values[3])),metadata:JSON.parse(String(values[5]))};
      // Model the existing physical uniqueness boundary, independently of how
      // the producer chooses its key. No SQL or schema guard is relaxed.
      if(artifacts.some(prior=>prior.workspace_id===row.workspace_id&&prior.digest===row.digest&&prior.key===row.key&&prior.revision===row.revision))
        throw Object.assign(new Error('uq_analysis_artifacts_semantic_context_key_revision'),{code:'23505'});
      artifacts.push(row);rows=[{id:row.id}];
    }else if(sql.startsWith('INSERT INTO analysis_evidence_groups'))rows=[{id:randomUUID()}];
    else if(sql.startsWith('INSERT INTO analysis_evidence_links')||sql.startsWith('INSERT INTO signal_semantic_context_events'))return{rows:[],rowCount:1};
    else if(sql.startsWith('INSERT INTO signal_semantic_context_element_versions')){
      const row={id:randomUUID(),generation_id:values[1],artifact_id:values[2],element_key:values[4],
        element_digest:values[17],source_refs_digest:values[16],origin_kind:values[15],element_version:1,disposition:'pending'};
      elements.push(row);rows=[{id:row.id}];
    }else if(sql.startsWith('SELECT element.element_key'))rows=elements.filter(row=>row.generation_id===values[0]);
    else if(sql.startsWith('UPDATE signal_semantic_context_generations'))return{rows:[],rowCount:1};
    else throw new Error(`Unexpected statement: ${sql.split('\n')[0]}`);
    return{rows:rows as T[],rowCount:rows.length};}};
  const append=(index:number,key=`append-generation-${index}`)=>appendSignalSemanticContextProposalsV1({queryable,workspace,actor,
    generation_key:generations[index]!.generation_key,idempotency_key:key,proposals:[proposal]});
  return{append,artifacts,elements,proposal,generations};
}

test('identical semantic elements in successive generations have distinct physical artifacts',async()=>{
  const f=fixture();const first=await f.append(0);const history=structuredClone({artifact:f.artifacts[0],element:f.elements[0]});
  const second=await f.append(1);
  assert.equal(first.created,1);assert.equal(second.created,1);assert.equal(f.artifacts.length,2);
  const [a,b]=f.artifacts;assert.notEqual(a!.id,b!.id);assert.notEqual(a!.key,b!.key);
  assert.equal(a!.digest,b!.digest,'physical generation identity must not alter semantic digest');
  assert.deepEqual(a!.content,b!.content);assert.deepEqual(a!.metadata,b!.metadata);
  assert.deepEqual({artifact:f.artifacts[0],element:f.elements[0]},history);
  for(const [index,element] of f.elements.entries()){
    assert.equal(element.generation_id,f.generations[index]!.id);
    assert.equal(element.element_key,f.proposal.element_key);assert.equal(element.origin_kind,'provider_proposal');
    assert.equal(element.element_digest,a!.digest);assert.equal(element.source_refs_digest,f.elements[0]!.source_refs_digest);
  }
  const beforeReplay=structuredClone({artifacts:f.artifacts,elements:f.elements});
  assert.deepEqual(await f.append(1),second);
  assert.deepEqual({artifacts:f.artifacts,elements:f.elements},beforeReplay);
  await assert.rejects(f.append(1,'another-key-same-generation'),
    error=>error instanceof Error&&'code' in error&&error.code==='semantic_context_element_exists');
  assert.deepEqual({artifacts:f.artifacts,elements:f.elements},beforeReplay);
});

test('accepted legacy artifact keys remain unchanged during an exact append replay',async()=>{
  const f=fixture();const accepted=await f.append(0);
  f.artifacts[0]!.key=f.proposal.element_key; // Existing receipt from the previous producer.
  const legacy=structuredClone({artifacts:f.artifacts,elements:f.elements});
  assert.deepEqual(await f.append(0),accepted);
  assert.deepEqual({artifacts:f.artifacts,elements:f.elements},legacy);
});
