import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {wirePopulationSourceV1,wirePopulationRawV1,invertWirePopulationMetadataV1,wirePopulationMetadataV1,wirePopulationShaV1,wireOctetProbeTextsV1} from './signal-listening-wire-population.oracle';
test('0337 closes both native producer branches and reverses every0333/0336 source byte',async()=>{
 const [raw,d,e]=await Promise.all(['0333_signal_listening_bounded_mentions.sql','0336_signal_listening_statement_native_projection.sql','0337_signal_listening_wire_population.sql'].map(n=>readFile(new URL('./'+n,import.meta.url),'utf8')));
 const proof=wirePopulationSourceV1(raw!,d!,e!);
 assert.equal(proof.original_raw,raw);assert.equal(proof.original_money,d);
 assert.equal(proof.raw,wirePopulationRawV1(raw!));
 assert.equal(proof.columns.length,11);
 assert.equal(proof.raw.split('octet_length(i.text) body_octets').length,3);
 assert.equal(proof.raw.split("octet_length(COALESCE(m.platform,'')) platform_octets").length,3);
 for(const literal of ['SELECT q.*','SELECT b.*','SELECT c.*','SELECT item.*','SELECT i.*','SELECT d.*','m.published_at,m.platform','SELECT m.text_clean','/* flat_input_begin */','/* flat_basis_begin */'])assert.ok(proof.raw.includes(literal),literal);
 assert.equal(proof.money,d!.replace('FROM signal_listening_population_roots_v1','FROM signal_listening_wire_population_roots_v1'));
 for(const changed of [raw!+'\n',raw!.replace("scope'='all'","scope'='consumer_category'")])assert.throws(()=>wirePopulationRawV1(changed));
 for(const changed of [e!+'\n',e!.replace('octet_length(i.text)','length(i.text)'),e!.replace('m.id=ANY($5)','true'),e!.replace("'EXECUTE') IS DISTINCT FROM true","'EXECUTE') IS DISTINCT FROM false")])assert.throws(()=>wirePopulationSourceV1(raw!,d!,changed));
 assert.match(wirePopulationShaV1(e!),/^[0-9a-f]{64}$/u);
});
test('0337 metadata inverse closes exactly three bounded changes before the frozen source chain',async()=>{
 const source=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8'),old=invertWirePopulationMetadataV1(source);
 assert.equal(wirePopulationMetadataV1(old),source);
 const before=source.slice(0,source.indexOf('async function inputProjectionMetadata'));
 assert.equal(old.slice(0,old.indexOf('async function inputProjectionMetadata')),before,'unbounded metadata stays literal');
 assert.equal(source.slice(source.indexOf('async function inputs')),old.slice(old.indexOf('async function inputs')),'hydration and adapter suffix stay literal');
 for(const changed of [source.replace('p.body_octets::bigint','p.body_octets::integer'),source.replace('p.platform_octets::bigint','p.platform_octets::integer'),source.replace('FROM signal_listening_wire_population_roots_v1','FROM signal_listening_population_roots_v1')])assert.throws(()=>invertWirePopulationMetadataV1(changed));
});

test('synthetic octet probe preserves ordinary absent/false seed bytes and only opts in three roots before import',()=>{
 const historical=['Synthetic fixture root 0000.','Synthetic fixture root 0001.','Synthetic fixture root 0002.'];
 const frozen=JSON.stringify(historical),sha=wirePopulationShaV1(frozen);
 for(const enabled of[undefined,false]){const same=wireOctetProbeTextsV1(historical,enabled);assert.equal(same,historical);assert.equal(JSON.stringify(same),frozen);assert.equal(wirePopulationShaV1(JSON.stringify(same)),sha);}
 const probe=wireOctetProbeTextsV1(historical,true);assert.notEqual(probe,historical);assert.equal(JSON.stringify(historical),frozen);assert.deepEqual(probe.slice(1),historical.slice(1));assert.ok(probe[0]!.startsWith(historical[0]!+' synthetic bicycle '));
 assert.ok(Buffer.byteLength(probe[0]!)>[...probe[0]!].length);assert.ok(Buffer.byteLength(probe[0]!)<12000);assert.deepEqual(wireOctetProbeTextsV1(historical,true),probe);
 assert.throws(()=>wireOctetProbeTextsV1(historical.slice(0,2),true));
});

test('actual three-root import bindings keep one governed worker chunk per UTF8 probe root',async()=>{
 const {syntheticImportedWorkspaceFixtureV1}=await import('./signal-client-workspace-entry.synthetic.fixture');
 const {prepareWorkspaceCorpusTextChunksV1,WORKSPACE_CORPUS_TEXT_CHUNK_SIZE_V1}=await import('../../../services/workers/src/workers/signal-workspace-corpus-preparation-chunks');
 type SeedTx=Parameters<typeof syntheticImportedWorkspaceFixtureV1>[0];
 const identity={organization_id:'00000000-0000-4000-8000-000000000001',brand_id:'00000000-0000-4000-8000-000000000002',actor_user_id:'00000000-0000-4000-8000-000000000003',workspace_id:'00000000-0000-4000-8000-000000000004'};
 const seed=async(enabled?:true,withAuthors=false)=>{
  const imports:Array<{text:string;hash:string;length:number}>=[];
  // Capture the REAL seed's import bindings only. No DB/provider or fabricated
  // PostgreSQL success is exercised; these exact text_clean bytes feed chunking.
  const query=async(sql:string,values:unknown[]=[])=>{
   if(sql.startsWith('SELECT id FROM signal_workspaces'))return{rows:[{id:identity.workspace_id}]};
   if(sql.startsWith('INSERT INTO mentions(')){
    assert.ok(sql.includes('text_raw,text_clean,text_length'));
    assert.ok(sql.includes("VALUES($1,$2,$3,$1,$4,$4,'synthetic',$5,$6,$7,$7,$8"));
    assert.equal(typeof values[6],'string');assert.equal(typeof values[5],'string');assert.equal(typeof values[7],'number');
    imports.push({text:values[6] as string,hash:values[5] as string,length:values[7] as number});
   }
   return{rows:[]};
  };
  const tx={query,database:{},scoped:{},cleanup:()=>{}} as unknown as SeedTx;
  const result=await syntheticImportedWorkspaceFixtureV1(tx,identity,{root_count:3,study_author_metadata:withAuthors,...(enabled===true?{wire_octet_probe:true as const}:{})});
  assert.equal(result.roots.length,3);assert.equal(imports.length,3);return imports;
 };
 for(const withAuthors of[false,true]){
 const ordinary=await seed(undefined,withAuthors),current=await seed(true,withAuthors),old=ordinary.map(row=>({...row}));
 // Reproduce frozen512 solely as a negative seed, using the REAL ordinary
 // source text including its author suffix. Never change the chunker/policy.
 old[0]!.text+=' synthetic bicycle '+'é é 😀 漢字 '.repeat(512);
 old[0]!.hash='sha256:'+wirePopulationShaV1(old[0]!.text);old[0]!.length=old[0]!.text.length;
 const prepare=(rows:typeof current)=>rows.map(row=>{
  assert.equal(row.length,row.text.length);assert.equal(row.hash,'sha256:'+wirePopulationShaV1(row.text));
  const prepared=prepareWorkspaceCorpusTextChunksV1(row.text,row.hash);
  assert.equal(prepared.offset_unit,'utf16');assert.equal(prepared.code_units,row.text.length);assert.equal(prepared.text_sha256,row.hash);
  let cursor=0;for(const chunk of prepared.chunks){assert.equal(chunk.start,cursor);assert.ok(chunk.end>chunk.start&&chunk.end-chunk.start<=WORKSPACE_CORPUS_TEXT_CHUNK_SIZE_V1);const text=row.text.slice(chunk.start,chunk.end);assert.equal(chunk.sha256,'sha256:'+wirePopulationShaV1(text));assert.equal(Buffer.from(text).toString('utf8'),text);cursor=chunk.end;}
  assert.equal(cursor,row.text.length);assert.equal(prepared.chunks.map(chunk=>row.text.slice(chunk.start,chunk.end)).join(''),row.text);return prepared;
 });
 const oldChunks=prepare(old),currentChunks=prepare(current);assert.equal(oldChunks.reduce((n,row)=>n+row.chunks.length,0),7,'frozen512 reproduces the observed7!=3 governed-chunk failure');
 assert.deepEqual(currentChunks.map(row=>row.chunks.length),[1,1,1]);assert.equal(prepare(ordinary).reduce((n,row)=>n+row.chunks.length,0),3);
 assert.deepEqual(current.slice(1),ordinary.slice(1));assert.deepEqual(await seed(undefined,withAuthors),ordinary,'absent opt-in preserves every deterministic seed/import text byte');
 assert.ok(current[0]!.text.length<=WORKSPACE_CORPUS_TEXT_CHUNK_SIZE_V1);assert.ok(Buffer.byteLength(current[0]!.text)>WORKSPACE_CORPUS_TEXT_CHUNK_SIZE_V1,'UTF8 bytes exceed the code-unit bound while the actual worker still makes one chunk');assert.ok(Buffer.byteLength(current[0]!.text)>[...current[0]!.text].length);
 const texts=ordinary.map(row=>row.text);for(const enabled of[undefined,false])assert.equal(wireOctetProbeTextsV1(texts,enabled),texts,'defaultfalse/absent retains the same array and byte identities');
 }
});
