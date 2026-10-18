import assert from 'node:assert/strict';
import test from 'node:test';
import {hybridCitationWindowsV1} from './signal-hybrid-windows-v1';
import {hybridSentenceSpansV1,parseHybridCitationGroupV1} from './signal-hybrid-citation-quality-v1';
import type {MembershipInputV1} from './signal-concept-membership-v1';
test('long H1 windows cover every sentence once and keep absolute literal offsets',()=>{
 const text='A whole sentence about a governed category. '.repeat(550);
 const input={text,evaluated_concepts:[{concept_key:'theme',definition_digest:'digest'}]} as MembershipInputV1;
 const windows=hybridCitationWindowsV1(input);
 assert.ok(windows.length>3);assert.equal(windows.map(w=>text.slice(w.citation_window.start,w.citation_window.end)).join(''),text);
 const parts=windows.flatMap(w=>hybridSentenceSpansV1([w]));
 assert.equal(parts.map(p=>p.quote).join(''),text);assert.equal(new Set(parts.map(p=>p.span_id)).size,parts.length);
 const last=windows.at(-1)!,span=hybridSentenceSpansV1([last])[0]!;
 assert.ok(span.quote_start>12000);
 const parsed=parseHybridCitationGroupV1(JSON.stringify({contract_version:'concept-membership-judge-v1',roots:[{root_ordinal:0,memberships:[{concept_key:'theme',verdict:'belongs',span_ids:[span.span_id],rationale:'The sentence establishes the defined condition.'}]}]}),[last]);
 assert.equal(parsed.results[0]?.citations[0]?.quote_start,span.quote_start);
 assert.equal(text.slice(parsed.results[0]!.citations[0]!.quote_start,parsed.results[0]!.citations[0]!.quote_end),span.quote);
});
