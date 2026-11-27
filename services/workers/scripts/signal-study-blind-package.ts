/**
 * Builds the blind evaluation package of a finished study.
 *
 *   axes        direction, target and use of a post, in strata: tension, irony,
 *               each target, each direction, posts answered `none` inside the
 *               cut, and consumer posts the category lexicon left outside it.
 *   assignment  posts confirmed for the motives with the most members; the
 *               evaluator chooses motives from the catalog without seeing ours.
 *   purity      random members of the largest motives, shown with their motive
 *               and its layer: is the post of this motive, and does it show the layer?
 *
 * The package carries no answer of the classifier. The answer key is written
 * to a different, private directory. Both must be outside the repository or
 * under `.data`; nothing is printed except counts and hashes.
 *
 *   pnpm tsx scripts/signal-study-blind-package.ts --study <uuid> --out <dir> --key-out <dir>
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { getSignalStudyV1, listSignalStudyMotivesV1, readSignalStudyAxesV1, readSignalStudyMembershipsV1, readSignalStudyRootsV1, signalStudyRulesOfV1 } from "@noisia/db";
import { compileSignalListeningConfigurationV1, compileSignalStudyAxesV1, resolveSignalStudyAxesV1, SIGNAL_LISTENING_CONSUMER_CUT_V1,
  validateSignalListeningConfigurationV1 } from "@noisia/query-engine";

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
const ssl = ["0", "false", "off", "disable"].includes((process.env.DATABASE_SSL ?? "").toLowerCase()) ? false : { rejectUnauthorized: false };
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 2 });
/** How many posts each stratum of the axes section asks for, in the order they are drawn. A post is drawn once. */
const AXES_STRATA = [["direction_mixed", 40], ["use_figurative_or_ironic", 30], ["target_competitor_brand", 25], ["target_own_brand", 25], ["target_alternative", 25],
  ["direction_trigger", 30], ["direction_barrier", 30], ["none_inside_cut", 30]] as const;
const NONE_OUTSIDE = 30, ASSIGNMENT_MOTIVES = 10, ASSIGNMENT_EACH = 20, PURITY_MOTIVES = 20, PURITY_EACH = 10;

try {
  const study = await getSignalStudyV1(pool, required("study"));
  if (!study || study.status !== "completed") throw new Error("the study is not finished");
  const seed = randomBytes(32), order = (id: string, salt: string) => createHmac("sha256", seed).update(`${salt}:${id}`).digest("hex");
  const caseId = (section: string, id: string) => order(id, `case:${section}`).slice(0, 24);
  const shuffled = <T extends { root_id: string }>(rows: T[], salt: string) => rows.map(row => ({ row, rank: order(row.root_id, salt) })).sort((a, b) => a.rank.localeCompare(b.rank)).map(item => item.row);
  const drawn = new Set<string>();
  const take = <T extends { root_id: string }>(rows: T[], salt: string, limit: number) => {
    const chosen = shuffled(rows.filter(row => !drawn.has(row.root_id)), salt).slice(0, limit);
    for (const row of chosen) drawn.add(row.root_id);
    return chosen;
  };
  const texts = new Map<string, string>();
  const loadTexts = async (ids: string[]) => {
    const missing = ids.filter(id => !texts.has(id));
    for (let from = 0; from < missing.length; from += 500) {
      for (const row of await readSignalStudyRootsV1(pool, study, missing.slice(from, from + 500), { vectors: false })) texts.set(row.root_id, row.text);
    }
  };

  // ---- assignment and purity are drawn first, so no post of theirs shows up again with a hint.
  const motives = await listSignalStudyMotivesV1(pool, study.id), memberships = await readSignalStudyMembershipsV1(pool, study);
  const byMotive = new Map<string, Array<{ root_id: string }>>(), byRoot = new Map<string, string[]>();
  for (const row of memberships) {
    const members = byMotive.get(row.motive_key); if (members) members.push({ root_id: row.root_id }); else byMotive.set(row.motive_key, [{ root_id: row.root_id }]);
    const own = byRoot.get(row.root_id); if (own) own.push(row.motive_key); else byRoot.set(row.root_id, [row.motive_key]);
  }
  const ranked = motives.map(motive => ({ motive, members: byMotive.get(motive.motive_key) ?? [] })).filter(item => item.members.length)
    .sort((a, b) => b.members.length - a.members.length || a.motive.motive_key.localeCompare(b.motive.motive_key));
  const assignment = ranked.slice(0, ASSIGNMENT_MOTIVES).flatMap((item, rank) => take(item.members, `assignment:${item.motive.motive_key}`, ASSIGNMENT_EACH)
    .map(row => ({ root_id: row.root_id, cohort_motive: item.motive.motive_key, cohort_rank: rank + 1 })));
  const purity = ranked.slice(0, PURITY_MOTIVES).flatMap((item, rank) => take(item.members, `purity:${item.motive.motive_key}`, PURITY_EACH)
    .map(row => ({ root_id: row.root_id, motive_key: item.motive.motive_key, motive_rank: rank + 1 })));

  // ---- axes
  const answered = await readSignalStudyAxesV1(pool, study);
  // Strata follow the direction as the study counts it: one below its probability line is read as none.
  const axes = answered.map(row => ({ ...row, resolved: resolveSignalStudyAxesV1(study.subject, row, signalStudyRulesOfV1(study)) }));
  const stratum: Record<typeof AXES_STRATA[number][0], (row: typeof axes[number]) => boolean> = {
    direction_mixed: row => row.resolved.direction === "mixed", use_figurative_or_ironic: row => row.use === "figurative_or_ironic",
    target_competitor_brand: row => row.resolved.direction !== "none" && row.target === "competitor_brand", target_own_brand: row => row.resolved.direction !== "none" && row.target === "own_brand",
    target_alternative: row => row.resolved.direction !== "none" && row.target === "alternative",
    direction_trigger: row => row.resolved.source_direction === "trigger" && row.resolved.direction !== "none", direction_barrier: row => row.resolved.source_direction === "barrier" && row.resolved.direction !== "none",
    none_inside_cut: row => row.resolved.direction === "none" };
  const axisCases = AXES_STRATA.flatMap(([name, limit]) => take(axes.filter(stratum[name]), `axes:${name}`, limit).map(row => ({ root_id: row.root_id, stratum: name as string,
    answers: { direction: row.resolved.direction, target: row.target, use: row.use, classifier_direction: row.direction, direction_probability: row.direction_probability } as
      { direction: string; target: string; use: string; classifier_direction: string; direction_probability: number | null } | null, counted_as: row.resolved.aggregate as string | null })));
  // Consumer posts that the category lexicon left outside the cut: nothing was asked of them.
  const configuration = validateSignalListeningConfigurationV1((await pool.query<{ configuration: unknown }>(
    "SELECT configuration FROM signal_listening_configurations WHERE id=$1 AND workspace_id=$2", [study.configuration_id, study.workspace_id])).rows[0]!.configuration);
  const compiled = compileSignalListeningConfigurationV1(configuration);
  const baseIds = new Map((await pool.query<{ id: string; question_digest: string }>("SELECT id::text,question_digest FROM signal_listening_questions WHERE workspace_id=$1 AND question_digest=ANY($2::text[])",
    [study.workspace_id, [compiled.base.voice.question_digest, compiled.base.promotion.question_digest]])).rows.map(row => [row.question_digest, row.id]));
  const outside = (await pool.query<{ root_id: string; text: string }>(`SELECT item.root_id,item.text FROM signal_mass_labeling_items item
    JOIN signal_mass_labeling_root_segments segment ON segment.map_id=item.map_id AND segment.root_id=item.root_id AND NOT segment.hashtag_only
    JOIN signal_listening_answers voice ON voice.question_id=$3::bigint AND voice.root_id=item.root_id AND voice.workspace_id=item.workspace_id
      AND voice.choice=$5 AND voice.input_sha=decode(substr(item.input_digest,8),'hex')
    JOIN signal_listening_answers promotion ON promotion.question_id=$4::bigint AND promotion.root_id=item.root_id AND promotion.workspace_id=item.workspace_id
      AND promotion.probability<=$6 AND promotion.input_sha=decode(substr(item.input_digest,8),'hex')
    LEFT JOIN signal_mass_labeling_category_matches lexical ON lexical.workspace_id=item.workspace_id AND lexical.policy_revision=$7::int AND lexical.root_id=item.root_id
    WHERE item.workspace_id=$1 AND item.map_id=$2 AND NOT COALESCE(lexical.matched,false) ORDER BY md5(item.root_id::text||$8) LIMIT $9`,
    [study.workspace_id, study.base_map_id, baseIds.get(compiled.base.voice.question_digest) ?? -1, baseIds.get(compiled.base.promotion.question_digest) ?? -1,
      SIGNAL_LISTENING_CONSUMER_CUT_V1.voice, study.cut.promotion_max, study.lexicon_revision, seed.toString("hex"), NONE_OUTSIDE])).rows;
  for (const row of outside) { texts.set(row.root_id, row.text); axisCases.push({ root_id: row.root_id, stratum: "outside_cut_by_lexicon", answers: null, counted_as: null }); }

  await loadTexts([...assignment, ...purity, ...axisCases].map(item => item.root_id));
  const language = configuration.candidate_language, asked = (motive: typeof motives[number]) => language === "en" ? motive.wording.en : motive.wording.original;
  const motiveOf = new Map(motives.map(motive => [motive.motive_key, motive]));
  const lines = <T extends { case_id: string }>(rows: T[]) => rows.sort((a, b) => a.case_id.localeCompare(b.case_id)).map(row => JSON.stringify(row)).join("\n") + "\n";
  // Order by the opaque identifier, so position says nothing about the stratum or the motive.
  const axisSamples = lines(axisCases.map(item => ({ case_id: caseId("axes", item.root_id), text: texts.get(item.root_id)! })));
  const assignmentSamples = lines(assignment.map(item => ({ case_id: caseId("assignment", item.root_id), text: texts.get(item.root_id)! })));
  const puritySamples = lines(purity.map(item => { const motive = motiveOf.get(item.motive_key)!;
    return { case_id: caseId("purity", item.root_id), text: texts.get(item.root_id)!, motive: { asked_as: asked(motive), es: motive.wording.es }, layer: motive.layer }; }));
  const questions = compileSignalStudyAxesV1(study.methodology, study.subject);
  // What the evaluator needs to apply the same definitions: the subject and the three questions exactly as they were asked.
  const guide = JSON.stringify({ study: { name: study.name, methodology: { key: study.methodology.key, version: study.methodology.version }, subject: study.subject, cut: study.cut },
    questions: Object.fromEntries(Object.entries(questions).map(([role, question]) => [role, question.wire])),
    layers: study.methodology.layers, diagnostics: study.methodology.diagnostics,
    // Every motive in key order, with no volumes: it does not reveal which ones were sampled.
    motives: motives.map(motive => ({ motive_key: motive.motive_key, asked_as: asked(motive), es: motive.wording.es, original: motive.wording.original, layer: motive.layer, permission: motive.permission })),
    instructions: { axes: "For each text answer the three questions.", assignment: "For each text list every motive of the catalog it expresses, or none.",
      purity: "For each text answer: is it of the motive shown? does it show evidence of the layer shown?" } }, null, 1) + "\n";
  const key = JSON.stringify({ contract_version: "r16b-study-blind-answer-key-v1", study_id: study.id,
    axes: axisCases.map(item => ({ case_id: caseId("axes", item.root_id), root_id: item.root_id, stratum: item.stratum, answers: item.answers, counted_as: item.counted_as })),
    assignment: assignment.map(item => ({ case_id: caseId("assignment", item.root_id), ...item, confirmed_motives: (byRoot.get(item.root_id) ?? []).sort() })),
    purity: purity.map(item => ({ case_id: caseId("purity", item.root_id), ...item, layer: motiveOf.get(item.motive_key)!.layer })),
    motive_volumes: ranked.map(item => ({ motive_key: item.motive.motive_key, confirmed_roots: item.members.length })) }, null, 1) + "\n";
  const count = (values: string[]) => values.reduce<Record<string, number>>((totals, value) => { totals[value] = (totals[value] ?? 0) + 1; return totals; }, {});
  const files: Array<[string, string]> = [["axes-samples.jsonl", axisSamples], ["assignment-samples.jsonl", assignmentSamples], ["purity-samples.jsonl", puritySamples], ["guide.json", guide]];
  const manifest = JSON.stringify({ contract_version: "r16b-study-blind-samples-v1", generated_at: new Date().toISOString(),
    sections: { axes: { cases: axisCases.length, requested: Object.fromEntries([...AXES_STRATA, ["outside_cut_by_lexicon", NONE_OUTSIDE] as const]), drawn: count(axisCases.map(item => item.stratum)) },
      assignment: { cases: assignment.length, rule: `the ${ASSIGNMENT_MOTIVES} motives with the most confirmed posts, ${ASSIGNMENT_EACH} random posts each` },
      purity: { cases: purity.length, rule: `the ${PURITY_MOTIVES} motives with the most confirmed posts, ${PURITY_EACH} random members each` } },
    distinct_roots: drawn.size + outside.length, motives: motives.length, approval_threshold: study.methodology.rules.motive_approval_min,
    layer_stability: (study.state as { layer_stability?: unknown }).layer_stability ?? null, output_status: study.methodology.rules.output_status,
    sha256: Object.fromEntries(files.map(([name, body]) => [name, sha(body)])), answer_key_sha256: sha(key) }, null, 1) + "\n";
  files.push(["blind-manifest.json", manifest]);
  for (const directory of [out, keyOut]) { mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700); }
  const write = (directory: string, name: string, body: string) => writeFileSync(join(directory, name), body, { mode: 0o600 });
  for (const [name, body] of files) write(out, name, body);
  write(out, "SHA256SUMS", files.map(([name, body]) => `${sha(body)}  ${name}`).join("\n") + "\n");
  write(keyOut, "study-blind-answer-key.private.json", key);
  write(keyOut, "SHA256SUMS", `${sha(key)}  study-blind-answer-key.private.json\n`);
  console.log(JSON.stringify({ axes: axisCases.length, assignment: assignment.length, purity: purity.length, answer_key_sha256: sha(key) }));
} finally { await pool.end(); }
