import test from "node:test";
import assert from "node:assert/strict";
import { rankSignalLexiconEvidenceV1, signalLexiconStopwordsV1, signalLexiconTermAllowedV1 } from "./signal-lexicon-evidence-v1";

test("function words are left out by language, with or without accents", () => {
  assert.equal(signalLexiconTermAllowedV1("não", "pt"), false);
  assert.equal(signalLexiconTermAllowedV1("Você", "pt-BR"), false);
  assert.equal(signalLexiconTermAllowedV1("the", "en"), false);
  assert.equal(signalLexiconTermAllowedV1("the", "pt"), true, "an English article is not a Portuguese function word");
  assert.equal(signalLexiconTermAllowedV1("the", null), false, "an unknown language is filtered with every list");
  assert.equal(signalLexiconTermAllowedV1("cerva gelada", "pt"), true);
  assert.equal(signalLexiconTermAllowedV1("cerva de", "pt"), false, "a pair with a function word says nothing new");
  assert.equal(signalLexiconTermAllowedV1("uma bem gelada", "pt"), false, "at most two words");
  assert.equal(signalLexiconTermAllowedV1("2024", "pt"), false);
  assert.equal(signalLexiconTermAllowedV1("x", "pt"), false);
  assert.ok(signalLexiconStopwordsV1("es").includes("usted"));
});

test("suggestions are ordered by lift, so slang of the category beats common words", () => {
  // 400 posts show the category out of 30,000 comparable ones.
  const ranked = rankSignalLexiconEvidenceV1({ foreground_size: 400, background_size: 30_000, language: "pt", existing_terms: ["Boteco"], items: [
    { term: "que", foreground_roots: 390, background_roots: 25_000 }, { term: "de", foreground_roots: 380, background_roots: 24_000 },
    { term: "hoje", foreground_roots: 120, background_roots: 9_000 }, { term: "cerva", foreground_roots: 60, background_roots: 70 },
    { term: "litrão", foreground_roots: 25, background_roots: 30 }, { term: "litrao", foreground_roots: 6, background_roots: 36 },
    { term: "gelada", foreground_roots: 130, background_roots: 900 }, { term: "boteco", foreground_roots: 32, background_roots: 240 },
    { term: "tomar uma", foreground_roots: 50, background_roots: 400 }, { term: "raro", foreground_roots: 2, background_roots: 2 }] });
  assert.deepEqual(ranked.map(item => item.term), ["cerva", "litrão", "gelada", "hoje"]);
  assert.ok(ranked[0]!.lift > 50 && ranked.at(-1)!.lift < 1.1);
  assert.deepEqual(ranked[0], { term: "cerva", foreground_roots: 60, background_roots: 70, lift: ranked[0]!.lift }, "counts travel with the suggestion");
  assert.deepEqual(rankSignalLexiconEvidenceV1({ foreground_size: 0, background_size: 10, language: "pt", items: [] }), []);
  assert.equal(rankSignalLexiconEvidenceV1({ foreground_size: 400, background_size: 30_000, language: "pt", limit: 1,
    items: [{ term: "cerva", foreground_roots: 60, background_roots: 70 }, { term: "gelada", foreground_roots: 130, background_roots: 900 }] }).length, 1);
});

test("impossible counts are refused instead of ranked", () => {
  const base = { foreground_size: 10, background_size: 100, language: "pt" };
  assert.throws(() => rankSignalLexiconEvidenceV1({ ...base, items: [{ term: "cerva", foreground_roots: 5, background_roots: 4 }] }), /lexicon_evidence_invalid/u);
  assert.throws(() => rankSignalLexiconEvidenceV1({ ...base, items: [{ term: "cerva", foreground_roots: 11, background_roots: 20 }] }), /lexicon_evidence_invalid/u);
  assert.throws(() => rankSignalLexiconEvidenceV1({ ...base, foreground_size: 200, items: [] }), /lexicon_evidence_invalid/u);
  assert.throws(() => rankSignalLexiconEvidenceV1({ ...base, limit: 0, items: [] }), /lexicon_evidence_invalid/u);
});
