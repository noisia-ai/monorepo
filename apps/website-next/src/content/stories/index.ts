import "server-only";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { unstable_cache } from "next/cache";
import { contentDatabaseConfigured, contentDb, showsDrafts } from "@/lib/content/db";
import { storySchema, type Story } from "./schema";

/**
 * Insights pieces come from the content database (see content-db/ and scripts/content).
 * Until CONTENT_DATABASE_URL is set, they come from the JSON files in `public/`, as before.
 *
 * `_local/` is gitignored and only exists on machines that hold client-derived test content;
 * it never loads in production unless explicitly enabled. `demo/` holds invented stories that
 * test a format and only load outside production or in UAT.
 */
const ROOT = join(process.cwd(), "src/content/stories");

/** Cache tag of the pieces. The publish script revalidates it so the feed updates without a deploy. */
export const STORIES_TAG = "content:stories";

const fileCache = new Map<string, Story[]>();

function readDir(dir: string): Story[] {
  // Files only change with a deploy, so production reads each folder once.
  const cached = process.env.NODE_ENV === "production" ? fileCache.get(dir) : undefined;
  if (cached) return cached;
  const stories = readDirUncached(dir);
  fileCache.set(dir, stories);
  return stories;
}

function readDirUncached(dir: string): Story[] {
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

async function readDatabase(): Promise<Story[]> {
  const view = showsDrafts() ? "content.review_stories" : "content.published_stories";
  // Video pieces join the feed in a later stage; until then only animated pieces are served.
  const { rows } = await contentDb().query<{ id: string; payload: unknown }>(
    `select id, payload from ${view} where format = 'animada' order by position, id`
  );
  return rows.flatMap((row) => {
    const parsed = storySchema.safeParse(row.payload);
    if (parsed.success) return [parsed.data];
    // The load script validates before writing, so this only happens if the schema changed.
    console.error(`[content] Skipping story ${row.id}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    return [];
  });
}

const cachedDatabase = unstable_cache(readDatabase, ["content-stories"], { tags: [STORIES_TAG] });

async function publishedStories(): Promise<Story[]> {
  if (contentDatabaseConfigured()) return cachedDatabase();
  const allowDemo = process.env.NODE_ENV !== "production" || process.env.NOISIA_DEMO_STORIES === "1";
  return [...readDir("public"), ...(allowDemo ? readDir("demo") : [])];
}

export async function getStories(): Promise<Story[]> {
  // Client-derived test stories never load in production unless explicitly enabled.
  const allowLocal = process.env.NODE_ENV !== "production" || process.env.NOISIA_LOCAL_STORIES === "1";
  const local = allowLocal ? readDir("_local") : [];
  const published = await publishedStories();
  // Interleave so the feed alternates sources instead of showing one block after another.
  const merged: Story[] = [];
  const max = Math.max(local.length, published.length);
  for (let i = 0; i < max; i++) {
    if (local[i]) merged.push(local[i]);
    if (published[i]) merged.push(published[i]);
  }
  const seen = new Set<string>();
  return merged.filter((story) => (seen.has(story.id) ? false : (seen.add(story.id), true)));
}

export async function getStory(id: string): Promise<Story | undefined> {
  return (await getStories()).find((story) => story.id === id);
}
