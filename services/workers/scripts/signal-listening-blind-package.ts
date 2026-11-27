/**
 * Builds the blind evaluation package of a finished discovery cycle: the ten
 * topics with the most confirmed roots, fifty roots each, shuffled.
 *
 * The package (samples, catalog, manifest) carries no topic assignment. The
 * answer key is written to a different, private directory. Both directories
 * must be outside the repository; nothing is printed except counts and hashes.
 *
 *   pnpm tsx scripts/signal-listening-blind-package.ts --cycle <uuid> --out <dir> --key-out <dir> [--topics 10] [--per-topic 50]
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { getSignalListeningCycleV1, signalListeningCarriedClosingMergesV1 } from "@noisia/db";
import { signalListeningTopicWordingV1 } from "@noisia/query-engine";

const flag = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; };
const required = (name: string) => flag(name) ?? (() => { throw new Error(`--${name} is required`); })();
const sha = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const out = resolve(required("out")), keyOut = resolve(required("key-out"));
const repository = resolve(new URL("../../..", import.meta.url).pathname);
for (const directory of [out, keyOut]) {
  if (directory.startsWith(repository) && !directory.includes("/.data/")) throw new Error("the package must be written outside the repository or under .data");
}
if (out === keyOut) throw new Error("the answer key needs its own directory");
const topicCount = Number(flag("topics") ?? 10), perTopic = Number(flag("per-topic") ?? 50);
const ssl = ["0", "false", "off", "disable"].includes((process.env.DATABASE_SSL ?? "").toLowerCase()) ? false : { rejectUnauthorized: false };
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 2 });

try {
  const state = await getSignalListeningCycleV1(pool, required("cycle"));
  if (!state || state.cycle.status !== "completed") throw new Error("the cycle is not finished");
  const round = state.rounds.at(-1)!, { cycle } = state;
  // The package evaluates the map as it is read: a topic the last pass folded into another is not a topic of its own,
  // and its posts are posts of the one that stays.
  const folded = new Map(signalListeningCarriedClosingMergesV1(round.review, round.catalog).map(item => [item.folded, item.stays]));
  const sourcesOf = (topic_key: string) => [topic_key, ...[...folded].filter(([, stays]) => stays === topic_key).map(([source]) => source)];
  const visible = new Map(round.catalog.filter(topic => topic.domain !== "outside" && !folded.has(topic.topic_key)).map(topic => [topic.topic_key, topic]));
  const volumes = (await pool.query<{ topic_key: string; approved: number }>(`SELECT COALESCE(merged.target,topic.topic_key) topic_key,count(DISTINCT answer.root_id)::int approved
    FROM signal_listening_round_topics topic
    LEFT JOIN unnest($5::text[],$6::text[]) merged(source,target) ON merged.source=topic.topic_key
    JOIN signal_listening_answers answer ON answer.question_id=topic.question_id AND answer.workspace_id=$1
    JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.workspace_id=$1 AND item.root_id=answer.root_id
      AND answer.input_sha=decode(substr(item.input_digest,8),'hex')
    LEFT JOIN signal_listening_answer_overrides decided ON decided.cycle_id=(SELECT scoped.cycle_id FROM signal_listening_rounds scoped WHERE scoped.id=$3) AND decided.question_id=topic.question_id AND decided.root_id=answer.root_id AND decided.input_sha=answer.input_sha
    WHERE topic.round_id=$3 AND COALESCE(decided.belongs,answer.probability>=$4::real) GROUP BY 1 ORDER BY 2 DESC,1`,
    [cycle.workspace_id, cycle.base_map_id, round.id, cycle.policy.approval, [...folded.keys()], [...folded.values()]])).rows
    .filter(row => visible.has(row.topic_key));
  const cohorts = volumes.slice(0, topicCount);
  if (cohorts.length < topicCount) throw new Error("not enough topics with confirmed roots");
  const seed = randomBytes(32), sampled = new Set<string>();
  const cases: Array<{ case_id: string; text: string; root_id: string; topic_key: string; probability: number; cohort_rank: number }> = [];
  for (const [rank, cohort] of cohorts.entries()) {
    const rows = (await pool.query<{ root_id: string; text: string; probability: number }>(`SELECT member.* FROM (
      SELECT DISTINCT ON (item.root_id) item.root_id,item.text,answer.probability::float8 probability
      FROM signal_listening_round_topics topic
      JOIN signal_listening_answers answer ON answer.question_id=topic.question_id AND answer.workspace_id=$1
      JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.workspace_id=$1 AND item.root_id=answer.root_id
        AND answer.input_sha=decode(substr(item.input_digest,8),'hex')
      LEFT JOIN signal_listening_answer_overrides decided ON decided.cycle_id=(SELECT scoped.cycle_id FROM signal_listening_rounds scoped WHERE scoped.id=$3) AND decided.question_id=topic.question_id AND decided.root_id=answer.root_id AND decided.input_sha=answer.input_sha
      WHERE topic.round_id=$3 AND topic.topic_key=ANY($5::text[]) AND COALESCE(decided.belongs,answer.probability>=$4::real) AND item.root_id<>ALL($8::uuid[])
      ORDER BY item.root_id,answer.probability DESC) member
      ORDER BY md5(member.root_id::text||$6) LIMIT $7`,
      [cycle.workspace_id, cycle.base_map_id, round.id, cycle.policy.approval, sourcesOf(cohort.topic_key), seed.toString("hex"), perTopic, [...sampled]])).rows;
    if (rows.length < perTopic) throw new Error("a cohort has fewer roots than requested");
    // A root already drawn for another cohort is not drawn again, so a repeated text never hints at an overlap.
    for (const row of rows) sampled.add(row.root_id);
    for (const row of rows) cases.push({ case_id: createHmac("sha256", seed).update(`${rank}:${row.root_id}`).digest("hex").slice(0, 24), text: row.text,
      root_id: row.root_id, topic_key: cohort.topic_key, probability: row.probability, cohort_rank: rank + 1 });
  }
  // Order by the opaque identifier, so position says nothing about the topic.
  cases.sort((a, b) => a.case_id.localeCompare(b.case_id));
  const language = (await pool.query<{ language: "en" | "original" }>("SELECT configuration->>'candidate_language' language FROM signal_listening_configurations WHERE id=$1",
    [cycle.configuration_id])).rows[0]!.language;
  const samples = cases.map(item => JSON.stringify({ case_id: item.case_id, text: item.text })).join("\n") + "\n";
  // The catalog lists every visible topic of the final map in key order, with no volumes: it does not reveal which ten were sampled.
  const catalog = JSON.stringify({ themes: round.themes, topics: [...visible.values()].sort((a, b) => a.topic_key.localeCompare(b.topic_key)).map(topic => ({
    topic_key: topic.topic_key, theme_key: topic.theme_key, domain: topic.domain, asked_as: signalListeningTopicWordingV1(topic, language),
    es: topic.localization.es, original: topic.localization.original })) }, null, 1) + "\n";
  const key = JSON.stringify({ contract_version: "r16b-blind-answer-key-v1", cycle_id: cycle.id, round: round.round_no,
    cohorts: cohorts.map((cohort, index) => ({ rank: index + 1, topic_key: cohort.topic_key, confirmed_roots: cohort.approved })),
    cases: cases.map(({ text: _text, ...rest }) => rest) }, null, 1) + "\n";
  const manifest = JSON.stringify({ contract_version: "r16b-blind-samples-v1", generated_at: new Date().toISOString(), case_count: cases.length,
    distinct_roots: new Set(cases.map(item => item.root_id)).size,
    selection: { cohorts: topicCount, cases_per_cohort: perTopic, rule: "the topics with the most confirmed roots among those visible by default; random roots within each" },
    final_round: round.round_no, visible_topics: visible.size, themes: round.themes.length, approval_threshold: cycle.policy.approval,
    samples_sha256: sha(samples), catalog_sha256: sha(catalog), answer_key_sha256: sha(key) }, null, 1) + "\n";
  for (const directory of [out, keyOut]) { mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700); }
  const write = (directory: string, name: string, body: string) => writeFileSync(join(directory, name), body, { mode: 0o600 });
  write(out, "blind-samples.jsonl", samples); write(out, "catalog.json", catalog); write(out, "blind-manifest.json", manifest);
  write(out, "SHA256SUMS", [["blind-samples.jsonl", samples], ["catalog.json", catalog], ["blind-manifest.json", manifest]].map(([name, body]) => `${sha(body!)}  ${name}`).join("\n") + "\n");
  write(keyOut, "blind-answer-key.private.json", key);
  write(keyOut, "SHA256SUMS", `${sha(key)}  blind-answer-key.private.json\n`);
  console.log(JSON.stringify({ cases: cases.length, distinct_roots: new Set(cases.map(item => item.root_id)).size, cohorts: cohorts.length,
    samples_sha256: sha(samples), answer_key_sha256: sha(key) }));
} finally { await pool.end(); }
