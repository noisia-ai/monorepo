import assert from "node:assert/strict";
import test from "node:test";
import { buildMassLabelingCategoryLexiconRequestV1, parseMassLabelingCategoryLexiconResponseV1 } from "./signal-mass-labeling-category-lexicon-v1";
import { buildMassLabelingConsolidationRequestV1, parseMassLabelingConsolidationResponseV1 } from "./signal-mass-labeling-consolidation-v1";
import { SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_LEGACY_CONFIGURATION_V2, SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2 as configuration } from "./signal-workspace-interpretation-v1";
const context = { category: "tea", terms: ["tea", "synthetic brand"] };
test("lexicon bootstrap uses only Brand OS and yields an editable literal list", () => {
  const batch = buildMassLabelingCategoryLexiconRequestV1(context, ["pt", "en"]);
  assert.match(batch.request.system, /abbreviations, colloquial slang/u);
  const raw = JSON.stringify({ model: batch.request.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ category: "tea", terms: ["tea", "chá"] }) }], usage: { input_tokens: 12, output_tokens: 5 } });
  assert.deepEqual(parseMassLabelingCategoryLexiconResponseV1(context, raw).output.terms, ["tea", "chá"]);
  assert.throws(() => parseMassLabelingCategoryLexiconResponseV1({ ...context, category: "coffee" }, raw), /category_changed/u);
  assert.throws(() => buildMassLabelingCategoryLexiconRequestV1({ ...context, text: "private text" } as never, ["en"]));
});
test("product consolidation requires the Brand OS lexicon in the existing editorial receipt", () => {
  const input = { workspace_id: "00000000-0000-4000-8000-000000000001", source_engine_execution_id: "00000000-0000-4000-8000-000000000002",
    source_groups: [{ group_id: "guided:one", cluster_digest: `sha256:${"a".repeat(64)}`, name: "Tea", definition: "Tea drinking", status: "coherent" as const, source_artifact_id: "00000000-0000-4000-8000-000000000003" }], configuration, category_context: context };
  const batch = buildMassLabelingConsolidationRequestV1(input);
  assert.match(batch.request_body, /category_context/u);
  assert.match(batch.request_body, /abbreviations, colloquial slang/u);
  const legacy = buildMassLabelingConsolidationRequestV1({ ...input, configuration: SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_LEGACY_CONFIGURATION_V2 });
  assert.doesNotMatch(legacy.request_body, /abbreviations, colloquial slang/u);
  assert.notEqual(legacy.request_digest, batch.request_digest);
  assert.throws(() => buildMassLabelingConsolidationRequestV1({ ...input, category_context: undefined }), /contract_invalid/u);
  const topic = { topic_key: "tea", name: "Tea", definition: "Tea drinking", group_ids: ["guided:one"], localization: {
    original_language: "pt", original: { name: "Chá", definition: "Consumo de chá" }, en: { name: "Tea", definition: "Tea drinking" }, es: { name: "Té", definition: "Consumo de té" } } };
  const response = (value: unknown) => JSON.stringify({ model: configuration.model, type: "message", role: "assistant", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify(value) }] });
  assert.throws(() => parseMassLabelingConsolidationResponseV1(batch, response({ topics: [topic], excluded_groups: [] })), /contract_invalid/u);
  const parsed = parseMassLabelingConsolidationResponseV1(batch, response({ topics: [topic], excluded_groups: [], category_lexicon: context }));
  assert.deepEqual(parsed.output.category_lexicon, context);
});
