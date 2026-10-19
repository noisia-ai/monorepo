import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hasSourceMark } from "../../components/brand/SourceMark";
import { collections } from "./collections";
import { storySchema, type Story } from "./schema";

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

function read(folder: string): Story[] {
  const full = join(process.cwd(), "src/content/stories", folder);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith(".json"))
    .flatMap((file) => {
      const raw = JSON.parse(readFileSync(join(full, file), "utf8")) as unknown;
      return (Array.isArray(raw) ? raw : [raw]).map((item) => storySchema.parse(item));
    });
}

test("demo stories are marked as demo and belong to a known collection", () => {
  const known = new Set(collections.map((collection) => collection.id));
  for (const story of read("demo")) {
    assert.equal(story.kind, "demo", `${story.id} must be kind demo`);
    assert.ok(story.collection && known.has(story.collection), `${story.id} has no known collection`);
  }
});

test("every source and platform has its icon", () => {
  for (const story of [...read("public"), ...read("demo")]) {
    const names = [
      ...story.sources,
      ...[story.es, story.en].flatMap((copy) => [
        ...copy.evidence.map((item) => item.platform),
        ...copy.scenes.flatMap((scene) => (scene.type === "quote" ? [scene.platform] : []))
      ])
    ];
    for (const name of names) assert.ok(hasSourceMark(name), `${story.id}: "${name}" has no icon`);
  }
});
