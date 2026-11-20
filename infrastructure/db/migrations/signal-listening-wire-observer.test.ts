import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadWireObserverContractV1,wireObserverContractV1,assertWireObserverMetadataV1,assertWireObserverSignatureV1} from './signal-listening-wire-observer.test-support';
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
test('E observer extracts actual complete nine-bind SQL and closes the historical inverse without accepting another reader',async()=>{
 const contract=await loadWireObserverContractV1(),expected={workspace_id:ids[0]!,configuration_id:ids[1]!,map_id:ids[2]!,entity_context_digest:'sha256:'+'a'.repeat(64),run_id:ids[3]!};
 const params:unknown[]=[expected.workspace_id,expected.configuration_id,expected.map_id,expected.entity_context_digest,expected.run_id,3,1000,[ids[0]],'512000'];
 assertWireObserverMetadataV1(contract.metadataSql,params,contract,expected);
 assert.equal(contract.metadataSql,contract.metadataBeforeSurvey.replace('   ), prefix AS MATERIALIZED(','   )  , prefix AS MATERIALIZED('));
 assert.notEqual(contract.metadataSql,contract.metadataBeforeSurvey,'the observer compares the actual new SQL, not a historical substitute');
 assert.equal(contract.populationSignature,'public.signal_listening_wire_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)');
 for(const sql of[contract.metadataBeforeSurvey,contract.metadataBefore,contract.metadataSql+' ',contract.metadataSql.replace('signal_listening_wire_population_roots_v1','signal_listening_population_roots_v1'),contract.metadataSql.replace('$8::uuid[]','NULL::uuid[]'),contract.metadataSql.replace('12*max(text_bytes)','11*max(text_bytes)')])assert.throws(()=>assertWireObserverMetadataV1(sql,params,contract,expected));
 for(const [index,value]of[[0,ids[1]],[1,ids[2]],[2,ids[0]],[3,'sha256:'+'b'.repeat(64)],[4,ids[0]],[5,0],[6,-1],[7,null],[7,[null]],[7,['not-a-uuid']],[7,Array(4097).fill(ids[0])],[8,'-1']] as Array<[number,unknown]>){const bad=[...params];bad[index]=value;assert.throws(()=>assertWireObserverMetadataV1(contract.metadataSql,bad,contract,expected));}
 assert.throws(()=>assertWireObserverMetadataV1(contract.metadataSql,params.slice(0,8),contract,expected));assert.throws(()=>assertWireObserverMetadataV1(contract.metadataSql,[...params,0],contract,expected));
 const names=['0333_signal_listening_bounded_mentions.sql','0336_signal_listening_statement_native_projection.sql','0337_signal_listening_wire_population.sql'];
 const sources=await Promise.all(names.map(n=>readFile(new URL('./'+n,import.meta.url),'utf8'))),runs=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');
 for(const index of[0,1,2]){const bad=[...sources];bad[index]=bad[index]!+'\n';assert.throws(()=>wireObserverContractV1(bad[0]!,bad[1]!,bad[2]!,runs));}
 assert.throws(()=>wireObserverContractV1(sources[0]!,sources[1]!,sources[2]!,runs.replace('p.body_octets::bigint','p.body_octets::integer')));
});
test('wire observer requires the exact six-input eleven-output native E signature',()=>{
 const row={proname:'signal_listening_wire_population_roots_v1',arguments:'uuid, uuid, uuid, text, uuid[], text',defaults:0,names:['w','cid','mid','ctx','roots','purpose','root_id','input_digest','question_key','question_digest','wire','scope_basis','candidate','scope_state','answer','body_octets','platform_octets'],modes:[...Array(6).fill('i'),...Array(11).fill('t')],result:'record',outputs:['uuid','text','text','text','jsonb','text','boolean','text','jsonb','integer','integer']};
 assertWireObserverSignatureV1(row);
 for(const patch of[{proname:'signal_listening_population_roots_v1'},{arguments:'uuid, uuid, uuid, text, text[], text'},{defaults:1},{names:row.names.slice(0,-1)},{names:[...row.names,'body']},{modes:[...Array(6).fill('i'),...Array(11).fill('o')]},{result:'text'},{outputs:row.outputs.map((x,i)=>i===9?'text':x)}])assert.throws(()=>assertWireObserverSignatureV1({...row,...patch}));
});
