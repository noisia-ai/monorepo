import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, parseArgs } from "./env";

/**
 * Personal links for a study: one per person, so a lead opens the full study without a form.
 *
 *   pnpm content:links <study-id> <leads.csv> [--days 90] [--out file.csv] [--base https://noisia.ai] [--lang en]
 *   pnpm content:links <study-id> --list
 *   pnpm content:links --revoke <link-id>
 *
 * The CSV needs a header row with nombre, correo, empresa and quien_manda (or name, email,
 * company, sent_by). The output is the same CSV with a `link` column, next to the input unless
 * --out says otherwise. Each token is shown only in that file; the database keeps its hash.
 * The output file opens the study for whoever has it: keep it out of Git and shared drives.
 */

const { flags, positional } = parseArgs(process.argv.slice(2));
const value = (name: string) => {
  const flag = flags.get(name);
  return typeof flag === "string" ? flag : undefined;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const csvCell = (cell: string) => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

const db = connect("CONTENT_ADMIN_DATABASE_URL");
await db.connect();
try {
  const revoke = value("revoke");
  if (revoke) {
    const result = await db.query("update content.access_links set revoked_at = now() where id = $1 and revoked_at is null", [revoke]);
    console.log(result.rowCount ? `Link ${revoke} revoked.` : `No active link ${revoke}.`);
  } else {
    const studyId = positional[0];
    if (!studyId) throw new Error("Say which study: pnpm content:links <study-id> <leads.csv>");
    const study = await db.query<{ status: string }>("select status from content.studies where id = $1", [studyId]);
    if (study.rowCount === 0) throw new Error(`Study ${studyId} does not exist.`);

    if (flags.has("list")) {
      const { rows } = await db.query<{ id: string; recipient_name: string | null; recipient_company: string | null; expires_at: Date; revoked_at: Date | null; open_count: number; last_opened_at: Date | null }>(
        "select id, recipient_name, recipient_company, expires_at, revoked_at, open_count, last_opened_at from content.access_links where study_id = $1 order by created_at",
        [studyId]
      );
      for (const row of rows) {
        const state = row.revoked_at ? "revoked" : row.expires_at < new Date() ? "expired" : "active";
        console.log(`${row.id}  ${state.padEnd(7)}  opens ${String(row.open_count).padStart(3)}  last ${row.last_opened_at?.toISOString().slice(0, 10) ?? "-"}  ${row.recipient_name ?? ""} · ${row.recipient_company ?? ""}`);
      }
      console.log(`${rows.length} links.`);
    } else {
      const input = positional[1];
      if (!input) throw new Error("Say which CSV: pnpm content:links <study-id> <leads.csv>");
      const days = Number(value("days") ?? 90);
      if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error("--days must be between 1 and 365");
      const base = (value("base") ?? process.env.CONTENT_SITE_URL ?? "https://noisia.ai").replace(/\/$/, "");
      const lang = value("lang") === "en" ? "?lang=en" : "";
      if (study.rows[0].status !== "publicado") console.warn(`  ! ${studyId} is ${study.rows[0].status}: its links open only once it is published (in UAT, drafts open too).`);

      const [header, ...rows] = parseCsv(readFileSync(resolve(input), "utf8"));
      if (!header) throw new Error("The CSV is empty.");
      const column = (...names: string[]) => header.findIndex((cell) => names.includes(cell.trim().toLowerCase()));
      const cols = { name: column("nombre", "name"), email: column("correo", "email"), company: column("empresa", "company"), sentBy: column("quien_manda", "sent_by", "quién manda") };
      if (cols.name < 0 && cols.email < 0) throw new Error("The CSV needs a nombre or correo column.");
      const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() || null : null);

      const out: string[] = [[...header, "link"].map(csvCell).join(",")];
      await db.query("begin");
      for (const row of rows) {
        const token = randomBytes(18).toString("base64url");
        await db.query(
          `insert into content.access_links (study_id, token_hash, source, recipient_name, recipient_email, recipient_company, sent_by, expires_at)
           values ($1, $2, 'personal', $3, $4, $5, $6, now() + make_interval(days => $7))`,
          [studyId, createHash("sha256").update(token).digest("hex"), cell(row, cols.name), cell(row, cols.email), cell(row, cols.company), cell(row, cols.sentBy), days]
        );
        out.push([...row, `${base}/e/${token}${lang}`].map(csvCell).join(","));
      }
      await db.query("commit");
      const output = resolve(value("out") ?? input.replace(/\.csv$/i, "") + ".links.csv");
      writeFileSync(output, out.join("\n") + "\n", { mode: 0o600 });
      console.log(`${rows.length} links for ${studyId}, valid ${days} days. Written to ${output}`);
      console.log("That file opens the study for whoever holds it: keep it out of Git and shared drives.");
    }
  }
} catch (error) {
  await db.query("rollback").catch(() => undefined);
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
