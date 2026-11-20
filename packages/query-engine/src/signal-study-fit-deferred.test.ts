import assert from'node:assert/strict';
import test from'node:test';
import{createHash}from'node:crypto';
import{SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1,type SignalStudyV1}from'./signal-study-contracts';
import{buildSignalStudyMotiveFitPlanV1,type SignalStudyRootV1}from'./signal-study-evidence';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'./signal-workspace-embeddings-v1';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id:id(1),corpus_id:id(2),listening_configuration_id:id(3),listening_configuration_digest:digest('synthetic'),
 methodology:{key:'triggers_barriers',version:'r16-v1',template_digest:SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1},subject:{kind:'category',name:'synthetic bicycles',category:'synthetic bicycles',own_brand:'Fixture',competitors:[],alternatives:[]},business_question:'Which forces explain a synthetic choice?',
 cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'UTC',voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'human',revision:1};
function root():SignalStudyRootV1{const text='Synthetic bicycle choice';return{root_id:id(4),text,text_sha256:'sha256:'+createHash('sha256').update(text).digest('hex'),vector:Array(1024).fill(.03125),axes:{direction:'trigger',source_direction:'trigger',target:'category',use:'literal',aggregate:'subject',alternative_inverted:false},occurred_at:'2026-02-01T00:00:00Z',channel:'synthetic',source_url:'https://example.invalid/synthetic',listening_topic_keys:[],private_person_names:[]};}
test('deferred fit binds exact vector digests without copying vectors; legacy fit bytes stay unchanged',()=>{
 const r=root(),args={study,roots:[r],embedding_space_digest:digest('native-voyage-config')};
 const old=buildSignalStudyMotiveFitPlanV1(args),{plan_digest,...body}=old;
 assert.equal(old.contract_version,'signal-study-motive-fit-plan-v1');assert.deepEqual(old.rows[0]!.vector,r.vector);assert.equal(plan_digest,digest(body));assert.equal(Object.hasOwn(old,'vector_storage'),false);
 const next=buildSignalStudyMotiveFitPlanV1({...args,vector_storage:'native_paged_cache'});
 assert.equal(next.contract_version,'signal-study-motive-fit-plan-v2');assert.equal(next.vector_storage,'native_paged_cache');assert.equal(next.rows[0]!.vector_digest,digest(r.vector));assert.equal(Object.hasOwn(next.rows[0]!,'vector'),false);
 assert.deepEqual(next.rows.map(row=>row.root_id),old.rows.map(row=>row.root_id));assert.deepEqual(next.configuration,old.configuration);assert.ok(Buffer.byteLength(JSON.stringify(next))<Buffer.byteLength(JSON.stringify(old)));
 const changed=root();changed.vector=[...changed.vector];changed.vector[0]=.03124;
 assert.notEqual(buildSignalStudyMotiveFitPlanV1({...args,roots:[changed],vector_storage:'native_paged_cache'}).plan_digest,next.plan_digest);
});
