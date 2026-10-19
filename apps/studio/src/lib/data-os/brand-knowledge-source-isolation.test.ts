import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';
import {signalSemanticContextProposalDigestV1 as digest} from '@noisia/query-engine';

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const brandId=id(1),actorId=id(2),organizationId=id(3),corpusId=id(4),corpusSourceId=id(5),manualId=id(6),automaticId=id(7),operationId=id(8);
const timestamp='2026-09-11T12:00:00.000Z';
type Row=Record<string,unknown>;
const source=(sourceId:string,corpus:string|null,automatic:boolean):Row=>({id:sourceId,brand_id:brandId,organization_id:organizationId,
 study_corpus_id:corpus,source_kind:automatic?'brand_os_context':'brand_brief',title:automatic?'Generated context':'Manual knowledge',
 raw_text:'Original source text',extracted_payload:{source:automatic?'automatic_brand_os':'manual_editor'},status:'processed',
 created_by_user_id:actorId,created_at:timestamp,updated_at:timestamp});
const sources=[source(manualId,null,false),source(automaticId,null,true),source(corpusSourceId,corpusId,true)];
const originalCorpus=structuredClone(sources[2]!);
const statements:string[]=[];
let action='update-brand-knowledge',key='source-isolation.patch',operation:Row|null=null;

// Real Drizzle queries and route handlers over an in-memory pg adapter. No
// connection string is configured, and connect() never opens a socket.
const pool={async connect(){return{query:pool.query,release(){}};},async query(input:string|{text:string;rowMode?:string},values:unknown[]=[]){
 const sql=typeof input==='string'?input:input.text;statements.push(sql);let rows:Row[]=[];
 if(/^begin|^commit/iu.test(sql)||sql.includes('pg_advisory_xact_lock')){}
 else if(/^rollback/iu.test(sql))operation=null;
 else if(sql.includes(' from "users"'))rows=[{id:actorId,email:'brand-isolation@noisia.local',full_name:'Synthetic actor',user_type:'noisia_internal',primary_role:'noisia_admin',status:'active'}];
 else if(sql.includes(' from "brands"'))rows=[{'brands.id':brandId,'brands.slug':'synthetic','brands.name':'Synthetic','brands.display_name':'Synthetic',
   'brands.countries':['JP'],'brands.status':'active','brands.organization_id':organizationId,'brands.created_at':timestamp,
   'organizations.id':organizationId,'organizations.slug':'synthetic','organizations.display_name':'Synthetic organization'}];
 else if(sql.includes(' from "study_corpora"')||sql.includes(' from "competitors"')){}
 else if(sql.includes(' from "signal_workspaces"'))rows=[{id:brandId}];
 else if(sql.startsWith('insert into "signal_governance_control_operations"')){
   const sourceInput=action==='update-brand-knowledge'?{brand_id:brandId,source_id:corpusSourceId,title:'Edited',raw_text:'Edited corpus text',source_kind:'brand_brief'}:
     {brand_id:brandId,source_id:corpusSourceId};
   operation={id:operationId,actor_user_id:actorId,action,status:'in_progress',result:null,
     request_digest:digest({contract_version:'brand-context-domain-mutation-v1',workspace_id:brandId,action,input:sourceInput})};
   rows=[operation];
 }else if(sql.includes(' from "signal_governance_control_operations"'))rows=operation?[operation]:[];
 else if(sql.includes(' from "brand_knowledge_sources"')){
   assert.match(sql,/"study_corpus_id" is null/iu);
   rows=sources.filter(row=>row.study_corpus_id===null && (!values.includes(corpusSourceId)||row.id===corpusSourceId));
 }else if(sql.startsWith('update "brand_knowledge_sources"')||sql.startsWith('delete from "brand_knowledge_sources"')){
   assert.match(sql,/"study_corpus_id" is null/iu);assert.ok(values.includes(corpusSourceId));
   rows=sources.filter(row=>row.id===corpusSourceId&&row.study_corpus_id===null);
 }else if(sql.startsWith('insert into "brand_knowledge_sources"')){
   assert.ok(values.includes(corpusSourceId));assert.match(sql,/on conflict do nothing/iu);
   // The requested UUID already belongs to corpus knowledge; the scoped replay
   // lookup must reject it, even if every visible payload field matches.
 }else if(sql.includes('FROM brands brand WHERE brand.id=$1::uuid FOR SHARE'))rows=[{name:'Synthetic',description:null,industry:null,industry_sub:null,countries:['JP'],aliases:[],competitors:[]}];
 else if(sql.includes('SELECT id::text,extracted_payload FROM brand_knowledge_sources')){
   assert.match(sql,/study_corpus_id IS NULL/u);
   rows=sources.filter(row=>row.study_corpus_id===null&&(row.extracted_payload as Row).source==='automatic_brand_os');
 }else if(sql.includes('UPDATE brand_knowledge_sources SET raw_text=')){
   assert.match(sql,/WHERE id=\$1::uuid AND brand_id=\$4::uuid AND study_corpus_id IS NULL/u);assert.equal(values[3],brandId);
   const row=sources.find(row=>row.id===values[0]&&row.brand_id===values[3]&&row.study_corpus_id===null);
   if(row)row.raw_text=values[1];
 }else throw new Error(`Unexpected synthetic query: ${sql.slice(0,110)}`);
 if(typeof input!=='string'&&input.rowMode==='array'){
   const projection=sql.startsWith('select ')?sql.slice(7,sql.indexOf(' from ')):sql.slice(sql.lastIndexOf(' returning ')+11);
   return{rows:rows.map(row=>projection.split(', ').map(field=>{const names=[...field.matchAll(/"([^"]+)"/gu)].map(match=>match[1]!);
     return row[names.join('.')]??row[names.at(-1)!]??null;})),rowCount:rows.length};
 }
 return{rows,rowCount:rows.length};}};
globalThis.noisiaStudioPgPool=pool as unknown as Pool;
Object.assign(process.env,{NODE_ENV:'test',RAILWAY_ENVIRONMENT:'test',VERCEL_ENV:'test',
 NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE:'true',NOISIA_LOCAL_AUTH_EMAIL:'brand-isolation@noisia.local'});
const {getBrandDetailForUser}=await import('../data/brands');
const knowledge=await import('../../app/api/brands/[id]/knowledge/route');
const sourceRoute=await import('../../app/api/brands/[id]/knowledge/[sourceId]/route');
const {refreshAutomaticBrandContextKnowledgeV1}=await import('./brand-automatic-knowledge-server');
const request=(method:string,body:Row)=>new Request('https://noisia.invalid/api/brands/synthetic/knowledge',{method,
 headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});

test('Brand OS detail and its Knowledge GET exclude corpus-owned sources of the same brand',async()=>{
 const brand=await getBrandDetailForUser({id:actorId,userType:'noisia_internal',organizationId:null},brandId);
 assert.deepEqual(brand!.knowledgeSources.map(row=>row.id),[manualId,automaticId]);
 const response=await knowledge.GET(new Request('https://noisia.invalid'),{params:Promise.resolve({id:brandId})});
 assert.equal(response.status,200);assert.deepEqual((await response.json()).data.map((row:Row)=>row.id),[manualId,automaticId]);
});
for(const method of ['PATCH','DELETE'] as const)test(`Brand OS ${method} cannot mutate corpus knowledge or complete a domain receipt`,async()=>{
 key=`source-isolation.${method.toLowerCase()}`;action=method==='PATCH'?'update-brand-knowledge':'delete-brand-knowledge';
 const body={preparation:{idempotency_key:key},...(method==='PATCH'?{title:'Edited',raw_text:'Edited corpus text',source_kind:'brand_brief'}:{})};
 const response=await sourceRoute[method](request(method,body),{params:Promise.resolve({id:brandId,sourceId:corpusSourceId})});
 assert.equal(response.status,404);assert.equal((await response.json()).error,'not_found');
 assert.equal(operation,null,'the attempted operation rolled back');assert.deepEqual(sources[2],originalCorpus);
});
test('Knowledge POST cannot recover a corpus row through an idempotency UUID collision',async()=>{
 key=corpusSourceId;
 const response=await knowledge.POST(request('POST',{title:originalCorpus.title,raw_text:originalCorpus.raw_text,source_kind:originalCorpus.source_kind}),
   {params:Promise.resolve({id:brandId})});
 assert.equal(response.status,409);assert.equal((await response.json()).error,'idempotency_conflict');assert.deepEqual(sources[2],originalCorpus);
});
test('automatic refresh touches only generated non-corpus knowledge',async()=>{
 const manual=structuredClone(sources[0]);const refreshed=await refreshAutomaticBrandContextKnowledgeV1(brandId);
 assert.equal(refreshed.refreshed_count,1);assert.match(String(sources[1]!.raw_text),/Marca: Synthetic/u);
 assert.deepEqual(sources[0],manual);assert.deepEqual(sources[2],originalCorpus);
});
test('Brand PATCH bulk updates and both automatic source inserts remain scoped away from corpus ingestion',async()=>{
 const update=await readFile(new URL('../../app/api/brands/[id]/route.ts',import.meta.url),'utf8');
 assert.match(update,/where\(and\(eq\(brandKnowledgeSources\.brandId, current\.id\), isNull\(brandKnowledgeSources\.studyCorpusId\)\)\)/u);
 assert.match(update,/eq\(brandKnowledgeSources\.sourceKind, "brand_os_context"\)/u);
 assert.equal((update.match(/isNull\(brandKnowledgeSources\.studyCorpusId\)/gu)??[]).length,3);
 for(const path of ['../../app/api/brands/route.ts','../../app/api/brands/[id]/knowledge/route.ts']){
   const create=await readFile(new URL(path,import.meta.url),'utf8');assert.match(create,/studyCorpusId: null/u);
 }
});
test('corpus readers retain their exact corpus branch and accept only non-corpus Brand OS context',async()=>{
 const readiness=await readFile(new URL('./readiness.ts',import.meta.url),'utf8');
 assert.match(readiness,/ks\.study_corpus_id = s\.id\s+OR \(s\.brand_id IS NOT NULL AND ks\.brand_id = s\.brand_id AND ks\.study_corpus_id IS NULL\)/u);
 const insights=await readFile(new URL('./signal-taxonomy-insights.ts',import.meta.url),'utf8');
 assert.equal((insights.match(/source\.study_corpus_id = \$1::uuid\s+OR \(\$2 = 'brand' AND source\.brand_id = \$3::uuid AND source\.study_corpus_id IS NULL\)/gu)??[]).length,2);
 assert.equal(statements.some(sql=>/prepare-brand-context|signal_semantic_context|^update "signal_governance_control_operations"/u.test(sql)),false,
   'denied Brand OS mutations never complete their operation or reach semantic preparation');
});
