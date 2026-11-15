import { connect, parseArgs, revalidateSite } from "./env";

/**
 * Changes the state of pieces and refreshes the site.
 *
 *   pnpm content:publish <id ...>            publish these pieces
 *   pnpm content:publish --study <id>        publish every draft of a study
 *   pnpm content:publish <id ...> --retire   take pieces off the site (they stay in the database)
 *   pnpm content:publish --list              show every piece and its state
 */

const { flags, positional } = parseArgs(process.argv.slice(2));
const db = connect("CONTENT_ADMIN_DATABASE_URL");
await db.connect();

try {
  if (flags.has("list")) {
    const { rows } = await db.query<{ id: string; status: string; format: string; position: number; study_id: string | null }>(
      "select id, status, format, position, study_id from content.stories order by position, id"
    );
    for (const row of rows) console.log(`${String(row.position).padStart(4)}  ${row.status.padEnd(9)}  ${row.format.padEnd(7)}  ${row.study_id ?? "-"}  ${row.id}`);
    console.log(`${rows.length} pieces.`);
  } else {
    const retire = flags.has("retire");
    const study = flags.get("study");
    if (positional.length === 0 && typeof study !== "string") {
      console.error("Say which pieces: pnpm content:publish <id ...> or --study <id>.");
      process.exitCode = 1;
    } else {
      const status = retire ? "retirado" : "publicado";
      const { rows } = await db.query<{ id: string }>(
        `update content.stories
            set status = $1, published_at = case when $1 = 'publicado' then coalesce(published_at, now()) else published_at end
          where ($2::text[] is not null and id = any($2::text[]))
             or ($3::text is not null and study_id = $3 and status = 'borrador')
          returning id`,
        [status, positional.length ? positional : null, typeof study === "string" ? study : null]
      );
      const missing = positional.filter((id) => !rows.some((row) => row.id === id));
      console.log(`${rows.length} pieces now ${status}.`);
      if (missing.length) console.error(`Not found: ${missing.join(", ")}`);
      if (rows.length) await revalidateSite();
    }
  }
} finally {
  await db.end();
}
