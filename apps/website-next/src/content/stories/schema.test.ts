import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { storySchema } from "./schema";

const dir = join(process.cwd(), "src/content/stories/public");

test("every published story validates and has a unique id", () => {
  const ids = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      const parsed = storySchema.safeParse(item);
      assert.ok(parsed.success, `${file}: ${parsed.success ? "" : parsed.error.message}`);
      assert.ok(!ids.has(parsed.data.id), `duplicate id ${parsed.data.id}`);
      ids.add(parsed.data.id);
    }
  }
  assert.ok(ids.size > 0);
});

test("published copy has no em dashes", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    assert.ok(!readFileSync(join(dir, file), "utf8").includes("—"), `${file} contains an em dash`);
  }
});
