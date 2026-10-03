import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Study OS Worker is a thin adapter over the single provider-neutral composer",async()=>{
  const source=await readFile(new URL("./compose-initial-query.ts",import.meta.url),"utf8");
  assert.match(source,/adaptStudyQueryComposerInputV1/u);
  assert.match(source,/composeQueryDraftWithProviderV1/u);
  assert.doesNotMatch(source,/function composeWithClaude/u);
  assert.doesNotMatch(source,/function refreshGenerationContract/u);
  assert.doesNotMatch(source,/buildQueryComposerPrompt/u);
  assert.doesNotMatch(source,/parseComposedQueryJson/u);
  assert.equal((source.match(/generateAnthropicBoundedTextV1\(/gu)??[]).length,1);
});
