import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmedConceptsV4, COBROS_KEY_V4 } from './concepts-v4';
const read=(name:string)=>JSON.parse(readFileSync(new URL('../../docs/product/PROMPT_LOOPING/'+name,import.meta.url),'utf8'));
const previous=read('PROPOSED_MFP_CONCEPTS_V3_2026-10-11.json');
const next=read('CONFIRMED_MFP_CONCEPTS_V4_2026-10-13.json');
test('v4 changes only Cobros, preserving every other definition and no promotion exclusions per concept',()=>{
 const concepts=confirmedConceptsV4(next);
 assert.equal(concepts.length,4);
 for(const concept of concepts.filter(item=>item.concept_key!==COBROS_KEY_V4))assert.deepEqual(concept,previous.concepts.find((item:any)=>item.concept_key===concept.concept_key));
 const cobros=concepts.find(item=>item.concept_key===COBROS_KEY_V4)!;
 assert.match(cobros.definition,/ocurri[oó]/i);
 assert.ok(cobros.exclusions.some(item=>/cubre|cobertura/.test(item)&&/ocurri[oó]/.test(item)));
 assert.ok(cobros.exclusions.some(item=>/medios de pago/.test(item)&&/ocurri[oó]/.test(item)));
 assert.ok(cobros.examples_negative.some(item=>/debito|débito/.test(item)));
 assert.ok(cobros.examples_positive.some(item=>/seguro/.test(item)&&/cobraron/.test(item)));
 assert.throws(()=>confirmedConceptsV4({...next,version:3}),/version/);
});
