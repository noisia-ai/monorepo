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
