import "server-only";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { storySchema, type Story } from "./schema";

/**
 * Stories live as JSON files. `public/` is committed (Noisia's own editorial work).
 * `_local/` is gitignored and only exists on machines that hold client-derived test
 * content; the site works without it.
 */
const ROOT = join(process.cwd(), "src/content/stories");

function readDir(dir: string): Story[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((file) => {
      const raw = JSON.parse(readFileSync(join(full, file), "utf8")) as unknown;
      const list = Array.isArray(raw) ? raw : [raw];
      return list.map((item) => {
        const parsed = storySchema.safeParse(item);
        if (!parsed.success) {
          throw new Error(`Invalid story in ${dir}/${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
        }
        return parsed.data;
      });
    });
}

let cache: Story[] | null = null;

export function getStories(): Story[] {
  if (!cache) {
    const local = readDir("_local");
    const published = readDir("public");
    // Interleave so the feed alternates sources instead of showing one block after another.
    const merged: Story[] = [];
    const max = Math.max(local.length, published.length);
    for (let i = 0; i < max; i++) {
      if (local[i]) merged.push(local[i]);
      if (published[i]) merged.push(published[i]);
    }
    const seen = new Set<string>();
    cache = merged.filter((story) => (seen.has(story.id) ? false : (seen.add(story.id), true)));
  }
  return cache;
}

export function getStory(id: string): Story | undefined {
  return getStories().find((story) => story.id === id);
}
