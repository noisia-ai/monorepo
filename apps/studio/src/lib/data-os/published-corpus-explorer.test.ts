import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("published corpus queries type both immutable scope parameters in their shared CTE", async () => {
  const source = await readFile(new URL("./published-corpus-explorer.ts", import.meta.url), "utf8");

  assert.match(source, /\$1::uuid AS snapshot_id/);
  assert.match(source, /\$2::uuid AS analysis_id/);
  assert.match(source, /JOIN explorer_scope scope ON scope\.snapshot_id = csm\.snapshot_id/);
  assert.doesNotMatch(source, /subject_id = (?:pm|fm)\.id::text/);
  assert.match(source, /f_filter\.layer =/);
  assert.match(source, /f_filter\.polarity =/);
  assert.match(source, /lenses: lensFacetResult\.rows/);
  assert.match(source, /protagonists: summary\?\.protagonist_count/);
});
