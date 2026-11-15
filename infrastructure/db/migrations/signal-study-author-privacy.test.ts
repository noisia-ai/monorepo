import assert from'node:assert/strict';
import test from'node:test';
import{createHash}from'node:crypto';
import{redactSignalStudyTextV1}from'@noisia/query-engine';
import{signalStudyKnownAuthorPrivacyV1}from'../signal-study-author-privacy';
const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
const metadata={source_author_label_recorded:false,source_author_label:null,legacy_author:null,linked_author_display_name:null,linked_author_handle:null};
test('recorded author labels are authoritative, including explicit null and empty suppression',()=>{
 const legacy={...metadata,legacy_author:'Stale Name',linked_author_display_name:'Different Name',linked_author_handle:'stale_handle'};
 for(const label of[null,'','   '])assert.deepEqual(signalStudyKnownAuthorPrivacyV1({...legacy,source_author_label_recorded:true,source_author_label:label}).private_person_names,[]);
 const p=signalStudyKnownAuthorPrivacyV1({...legacy,source_author_label_recorded:true,source_author_label:' Ana Silva '});assert.deepEqual(p.private_person_names,['Ana Silva']);assert.deepEqual(p.provenance,[{field:'source_author_label',sha256:sha('Ana Silva')}]);
});
test('legacy and linked aliases are known labels, not inferred legal identities or text NER',()=>{
 const p=signalStudyKnownAuthorPrivacyV1({...metadata,legacy_author:'Ana Silva',linked_author_display_name:'Ana Silva',linked_author_handle:'ana_42'});assert.deepEqual(p.private_person_names,['Ana Silva','ana_42']);assert.equal(p.provenance.length,3);assert.deepEqual(signalStudyKnownAuthorPrivacyV1(metadata).private_person_names,[]);
 assert.deepEqual(signalStudyKnownAuthorPrivacyV1({...metadata,source_author_label:'unrecorded stale label'}).private_person_names,[]);
 assert.notEqual(signalStudyKnownAuthorPrivacyV1({...metadata,legacy_author:'Other'}).metadata_digest,p.metadata_digest);assert.match(p.roster_digest,/^sha256:[a-f0-9]{64}$/u);
});
test('known pseudonyms and handles redact only after the original literal is retained',()=>{
 const original='Ana Silva says hello with ana_42 and @someone.';const p=signalStudyKnownAuthorPrivacyV1({...metadata,legacy_author:'Ana Silva',linked_author_handle:'ana_42'}),display=redactSignalStudyTextV1(original,p.private_person_names);assert.equal(display.display_text,'[persona] says hello with [persona] and [usuario]');assert.equal(original,'Ana Silva says hello with ana_42 and @someone.');assert.equal(display.redacted,true);assert.equal(p.private_person_names.includes('Ana'),false,'do not infer first names or unobserved people');
 assert.equal(redactSignalStudyTextV1('Unknown Person',signalStudyKnownAuthorPrivacyV1(metadata).private_person_names).display_text,'Unknown Person');
});
