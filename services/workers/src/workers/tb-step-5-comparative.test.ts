import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("finding entity presence query starts its coded-mention predicate with WHERE", async () => {
  const source = await readFile(new URL("./tb-step-5-comparative.ts", import.meta.url), "utf8");

  assert.match(source, /WHERE m\.id IN \(\s+SELECT mention_id FROM tb_mention_codings/);
  assert.doesNotMatch(source, /WHERE\s+(?:--[^\n]*\n\s*)+AND m\.id IN/);
});
