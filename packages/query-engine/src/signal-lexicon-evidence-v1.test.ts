import assert from 'node:assert/strict';
import test from 'node:test';
import {rankSignalLexiconEvidenceV1, signalLexiconTermAllowedV1} from './signal-lexicon-evidence-v1';

test('lexicon suggestions remove language stopwords including accents without dropping category vocabulary', () => {
  for (const [term, language] of [['você','pt-BR'], ['não','pt'], ['de cerveja','pt'], ['the','en-US'], ['para','es-MX']])
    assert.equal(signalLexiconTermAllowedV1(term!, language!), false);
  for (const term of ['cerva', 'litrão', 'cerveja gelada']) assert.equal(signalLexiconTermAllowedV1(term, 'pt-BR'), true);
  assert.equal(signalLexiconTermAllowedV1('https://private.example', 'pt'), false);
  assert.equal(signalLexiconTermAllowedV1('@private', 'pt'), false);
});

test('root-level lift ranks distinctive evidence above raw popularity and excludes existing terms and singleton noise', () => {
  const ranked = rankSignalLexiconEvidenceV1({foreground_size:100, background_size:1000, existing_terms:['CERVEJA'], items:[
    {term:'popular',language:'pt',foreground_roots:50,background_roots:900},
    {term:'cerva',language:'pt',foreground_roots:15,background_roots:18},
    {term:'litrão',language:'pt',foreground_roots:10,background_roots:12},
    {term:'cerveja',language:'pt',foreground_roots:80,background_roots:90},
    {term:'isolado',language:'pt',foreground_roots:1,background_roots:1},
    {term:'que',language:'pt',foreground_roots:90,background_roots:900},
  ]});
  assert.deepEqual(ranked.map(row=>row.term), ['litrão','cerva','popular']);
  assert.equal(ranked.find(row=>row.term==='cerva')!.lift, ((15+.5)/101)/((18+.5)/1001));
});

test('lexicon evidence rejects impossible denominators and duplicate root aggregates', () => {
  const row = {term:'cerva',language:'pt',foreground_roots:3,background_roots:4};
  for (const args of [
    {foreground_size:5,background_size:4,items:[row]},
    {foreground_size:3,background_size:5,items:[{...row,foreground_roots:4}]},
    {foreground_size:5,background_size:5,items:[row,row]},
    {foreground_size:5,background_size:5,items:[{...row,background_roots:2}]},
  ]) assert.throws(()=>rankSignalLexiconEvidenceV1(args), /lexicon_evidence_invalid/);
  assert.deepEqual(rankSignalLexiconEvidenceV1({foreground_size:0,background_size:0,items:[]}), []);
});
