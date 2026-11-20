import assert from 'node:assert/strict';
import test from 'node:test';
import {redactSignalStudyTextV1} from './signal-study-evidence';
test('audit text redaction works without inventing axes, membership or source provenance',()=>{
 const text='@usuário talked to Private Person and Private Person Jr.';
 assert.deepEqual(redactSignalStudyTextV1(text,['Private Person','Private Person Jr.']),{
  display_text:'[usuario] talked to [persona] and [persona]',redacted:true});
 assert.deepEqual(redactSignalStudyTextV1('Unchanged synthetic text'),{display_text:'Unchanged synthetic text',redacted:false});
 assert.equal(redactSignalStudyTextV1('A (private) name',['(private)']).display_text,'A [persona] name');
});
