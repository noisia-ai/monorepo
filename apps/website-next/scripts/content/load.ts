import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { storySchema, type Story } from "../../src/content/stories/schema";
import { connect, parseArgs, revalidateSite } from "./env";
import { lintStory } from "./lint";

/**
 * Loads Insights pieces into the content database as drafts.
 *
 *   pnpm content:load <file.json | folder> [...] [--study <id>] [--dry-run]
 *
 * Every piece is validated against the site's schema and the privacy checks before anything is
 * written; one bad piece stops the whole load. New pieces land as `borrador` at the end of the
 * feed. A piece that already exists keeps its status and position and gets the new content,
 * which shows on the site after the next `content:publish` (or any refresh).
 *
 * `--publish-initial` is only for moving the pieces that were already live in the repo.
 */

const { flags, positional } = parseArgs(process.argv.slice(2));
if (positional.length === 0) {
  console.error("Usage: pnpm content:load <file.json | folder> [...] [--study <id>] [--dry-run]");
  process.exit(1);
}

function jsonFiles(path: string): string[] {
  const full = resolve(path);
  if (statSync(full).isDirectory()) {
    return readdirSync(full)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => join(full, file));
  }
  return [full];
}

type Item = { story: Story; notes: string | null; file: string };

const items: Item[] = [];
const problems: string[] = [];
for (const file of positional.flatMap(jsonFiles)) {
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  for (const entry of Array.isArray(raw) ? raw : [raw]) {
    const parsed = storySchema.safeParse(entry);
    if (!parsed.success) {
      const id = (entry as { id?: string })?.id ?? "?";
      problems.push(`${file} ${id}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      continue;
    }
    problems.push(...lintStory(parsed.data).map((issue) => `${file} ${issue}`));
    const notes = (entry as { notes?: unknown }).notes;
    items.push({ story: parsed.data, notes: typeof notes === "string" ? notes : null, file });
  }
}

const ids = new Set<string>();
for (const { story } of items) {
  if (ids.has(story.id)) problems.push(`Repeated id ${story.id}`);
  ids.add(story.id);
}

if (problems.length > 0) {
  console.error(`Nothing was loaded. Fix these ${problems.length} problems:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const studyId = typeof flags.get("study") === "string" ? (flags.get("study") as string) : null;
const initial = flags.has("publish-initial");

if (flags.has("dry-run")) {
  console.log(`${items.length} pieces pass the checks. Nothing was written (--dry-run).`);
  process.exit(0);
}

let refresh = false;
const db = connect("CONTENT_ADMIN_DATABASE_URL");
await db.connect();
try {
  await db.query("begin");
  if (studyId) {
    const study = await db.query("select 1 from content.studies where id = $1", [studyId]);
    if (study.rowCount === 0) throw new Error(`Study ${studyId} does not exist yet.`);
  }
  const { rows } = await db.query<{ max: number | null }>("select max(position) as max from content.stories");
  let next = (rows[0]?.max ?? -1) + 1;
  let created = 0;
  let updated = 0;
  let liveUpdated = 0;
  for (const { story, notes } of items) {
    const result = await db.query<{ inserted: boolean; status: string }>(
      `insert into content.stories (id, study_id, status, format, position, payload, notes, published_at)
       values ($1, $2, $3, 'animada', $4, $5, $6, case when $3 = 'publicado' then now() end)
       on conflict (id) do update set payload = excluded.payload, notes = excluded.notes,
         study_id = coalesce(excluded.study_id, content.stories.study_id)
       returning (xmax = 0) as inserted, status`,
      [story.id, studyId, initial ? "publicado" : "borrador", next, JSON.stringify(story), notes]
    );
    if (result.rows[0]?.inserted) {
      created++;
      next++;
    } else {
      updated++;
      if (result.rows[0]?.status === "publicado") liveUpdated++;
    }
  }
  await db.query("commit");
  console.log(`Loaded ${items.length} pieces: ${created} new as ${initial ? "publicado" : "borrador"}, ${updated} updated (status unchanged).`);
  if (!initial && created > 0) console.log("Review them in UAT, then run pnpm content:publish <id ...> or --study <id>.");
  // A piece that is already live changed on the site's data: refresh it now, or the site keeps
  // the old text until the next publish or deploy. content:study refreshes once for the study.
  if ((initial || liveUpdated > 0) && !flags.has("no-refresh")) {
    if (liveUpdated > 0) console.log(`${liveUpdated} of them were already live; refreshing the site.`);
    refresh = true;
  }
} catch (error) {
  await db.query("rollback");
  console.error(`Nothing was loaded: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
if (refresh) await revalidateSite();
