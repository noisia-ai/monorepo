/**
 * Two extra strata for the blind evaluation of a finished discovery cycle.
 * Neither calls a provider.
 *
 *   fusion  roots that both topics of a pair of possible twins accepted, at most
 *           three per pair, starting with the pairs that are accepted together
 *           most often. They tell apart topics that mean the same from topics
 *           that simply happen together.
 *   voice   roots stratified by the base answers (who speaks, and whether it is
 *           promotion), to measure the filter every consumer cut depends on.
 *   probable  roots about the category with no confirmed topic that do have a
 *           probable one, to see whether the confirmation line leaves good
 *           members out. Only when the loop has two levels of membership.
 *
 * Samples carry only an opaque id and the text. Each stratum has its own answer
 * key in a different, private directory. Nothing is printed except counts and hashes.
 *
 *   pnpm tsx scripts/signal-listening-blind-strata.ts --cycle <uuid> --out <dir> --key-out <dir> [--fusion 60] [--per-pair 3]
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { getSignalListeningCycleV1 } from "@noisia/db";
import { compileSignalListeningConfigurationV1, SIGNAL_LISTENING_CONSUMER_CUT_V1, validateSignalListeningConfigurationV1 } from "@noisia/query-engine";

const flag = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; };
const required = (name: string) => flag(name) ?? (() => { throw new Error(`--${name} is required`); })();
const sha = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const out = resolve(required("out")), keyOut = resolve(required("key-out"));
const repository = resolve(new URL("../../..", import.meta.url).pathname);
for (const directory of [out, keyOut]) {
  if (directory.startsWith(repository) && !directory.includes("/.data/")) throw new Error("the package must be written outside the repository or under .data");
}
if (out === keyOut) throw new Error("the answer keys need their own directory");
const fusionTotal = Number(flag("fusion") ?? 60), perPair = Number(flag("per-pair") ?? 3);
/** Voice strata, in the order they are drawn. A root is drawn once. */
const PROBABLE_ORPHANS = 60;
const VOICE_STRATA = [["consumer_sure", 20], ["consumer_unsure", 20], ["promotion", 30], ["other_voice", 30]] as const;
const ssl = ["0", "false", "off", "disable"].includes((process.env.DATABASE_SSL ?? "").toLowerCase()) ? false : { rejectUnauthorized: false };
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 2 });

try {
  const state = await getSignalListeningCycleV1(pool, required("cycle"));
  if (!state || state.cycle.status !== "completed") throw new Error("the cycle is not finished");
  const round = state.rounds.at(-1)!, { cycle } = state, seed = randomBytes(32);
  const caseId = (section: string, root_id: string) => createHmac("sha256", seed).update(`${section}:${root_id}`).digest("hex").slice(0, 24);
  const lines = <T extends { case_id: string }>(rows: T[]) => [...rows].sort((a, b) => a.case_id.localeCompare(b.case_id)).map(row => JSON.stringify(row)).join("\n") + "\n";

  // ---- fusion
  type Pair = { left: string; right: string; jaccard: number; coapproval: number; jointly_asked: number; jointly_approved: number };
  const pairs = [...((round.evidence as unknown as { twins?: Pair[] } | null)?.twins ?? [])]
    .sort((a, b) => b.coapproval - a.coapproval || b.jaccard - a.jaccard || `${a.left}${a.right}`.localeCompare(`${b.left}${b.right}`));
  const drawn = new Set<string>();
  const fusion: Array<{ root_id: string; text: string; pair_rank: number; left: string; right: string; coapproval: number; jaccard: number; left_probability: number; right_probability: number }> = [];
  for (const [rank, pair] of pairs.entries()) {
    if (fusion.length >= fusionTotal) break;
    const rows = (await pool.query<{ root_id: string; text: string; left_probability: number; right_probability: number }>(`
      SELECT item.root_id,item.text,first.probability::float8 left_probability,second.probability::float8 right_probability
      FROM signal_listening_round_topics a JOIN signal_listening_round_topics b ON b.round_id=a.round_id AND b.topic_key=$6
      JOIN signal_listening_answers first ON first.question_id=a.question_id AND first.workspace_id=$1
      JOIN signal_listening_answers second ON second.question_id=b.question_id AND second.workspace_id=$1 AND second.root_id=first.root_id
      JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.workspace_id=$1 AND item.root_id=first.root_id
        AND first.input_sha=decode(substr(item.input_digest,8),'hex') AND second.input_sha=decode(substr(item.input_digest,8),'hex')
      -- Both memberships as they count today: where the classifier chose between the two, its choice.
      LEFT JOIN signal_listening_answer_overrides left_decided ON left_decided.cycle_id=(SELECT scoped.cycle_id FROM signal_listening_rounds scoped WHERE scoped.id=$3) AND left_decided.question_id=a.question_id AND left_decided.root_id=first.root_id AND left_decided.input_sha=first.input_sha
      LEFT JOIN signal_listening_answer_overrides right_decided ON right_decided.cycle_id=(SELECT scoped.cycle_id FROM signal_listening_rounds scoped WHERE scoped.id=$3) AND right_decided.question_id=b.question_id AND right_decided.root_id=first.root_id AND right_decided.input_sha=second.input_sha
      WHERE a.round_id=$3 AND a.topic_key=$5 AND COALESCE(left_decided.belongs,first.probability>=$4::real) AND COALESCE(right_decided.belongs,second.probability>=$4::real)
        AND item.root_id<>ALL($9::uuid[]) ORDER BY md5(item.root_id::text||$7) LIMIT $8`,
      [cycle.workspace_id, cycle.base_map_id, round.id, cycle.policy.approval, pair.left, pair.right, seed.toString("hex"), Math.min(perPair, fusionTotal - fusion.length), [...drawn]])).rows;
    for (const row of rows) { drawn.add(row.root_id); fusion.push({ ...row, pair_rank: rank + 1, left: pair.left, right: pair.right, coapproval: pair.coapproval, jaccard: pair.jaccard }); }
  }

  // ---- voice
  const configuration = validateSignalListeningConfigurationV1((await pool.query<{ configuration: unknown }>(
    "SELECT configuration FROM signal_listening_configurations WHERE id=$1 AND workspace_id=$2", [cycle.configuration_id, cycle.workspace_id])).rows[0]!.configuration);
  const base = compileSignalListeningConfigurationV1(configuration).base, cut = SIGNAL_LISTENING_CONSUMER_CUT_V1;
  const ids = new Map((await pool.query<{ id: string; question_digest: string }>("SELECT id::text,question_digest FROM signal_listening_questions WHERE workspace_id=$1 AND question_digest=ANY($2::text[])",
    [cycle.workspace_id, [base.voice.question_digest, base.promotion.question_digest]])).rows.map(row => [row.question_digest, row.id]));
  const condition: Record<typeof VOICE_STRATA[number][0], string> = {
    // The consumer cut, split by how sure the classifier was of the voice.
    consumer_sure: "voice.choice=$5 AND promotion.probability<=$6 AND voice.probability>=0.9",
    consumer_unsure: "voice.choice=$5 AND promotion.probability<=$6 AND voice.probability<0.7",
    promotion: "promotion.probability>$6 AND $5::text IS NOT NULL",
    other_voice: "voice.choice<>$5 AND promotion.probability<=$6" };
  const voice: Array<{ root_id: string; text: string; stratum: string; voice: string; voice_probabilities: Record<string, number>; promotion_probability: number }> = [];
  for (const [stratum, limit] of VOICE_STRATA) {
    const rows = (await pool.query<{ root_id: string; text: string; voice: string; voice_probabilities: Record<string, number>; promotion_probability: number }>(`
      SELECT item.root_id,item.text,voice.choice voice,voice.probabilities voice_probabilities,promotion.probability::float8 promotion_probability
      FROM signal_mass_labeling_items item
      JOIN signal_listening_answers voice ON voice.question_id=$3::bigint AND voice.root_id=item.root_id AND voice.workspace_id=item.workspace_id
        AND voice.input_sha=decode(substr(item.input_digest,8),'hex')
      JOIN signal_listening_answers promotion ON promotion.question_id=$4::bigint AND promotion.root_id=item.root_id AND promotion.workspace_id=item.workspace_id
        AND promotion.input_sha=decode(substr(item.input_digest,8),'hex')
      WHERE item.workspace_id=$1 AND item.map_id=$2 AND ${condition[stratum]} AND item.root_id<>ALL($9::uuid[]) ORDER BY md5(item.root_id::text||$7) LIMIT $8`,
      [cycle.workspace_id, cycle.base_map_id, ids.get(base.voice.question_digest) ?? -1, ids.get(base.promotion.question_digest) ?? -1, cut.voice, cut.promotion_max,
        seed.toString("hex"), limit, [...drawn]])).rows;
    for (const row of rows) { drawn.add(row.root_id); voice.push({ ...row, stratum }); }
  }

  // ---- probable: category posts without a confirmed topic whose best topic is only probable
  const probableLine = cycle.policy.probable;
  const probable = probableLine === undefined ? [] : (await pool.query<{ root_id: string; text: string; topic_key: string; probability: number }>(`
    WITH scored AS (
      SELECT answer.root_id,topic.topic_key,CASE WHEN decided.belongs IS NULL THEN answer.probability WHEN decided.belongs THEN 1::real ELSE 0::real END probability
      FROM signal_listening_round_topics topic
      JOIN signal_listening_answers answer ON answer.question_id=topic.question_id AND answer.workspace_id=$1
      JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.workspace_id=$1 AND item.root_id=answer.root_id
        AND answer.input_sha=decode(substr(item.input_digest,8),'hex')
      LEFT JOIN signal_listening_answer_overrides decided ON decided.cycle_id=(SELECT scoped.cycle_id FROM signal_listening_rounds scoped WHERE scoped.id=$3) AND decided.question_id=topic.question_id AND decided.root_id=answer.root_id AND decided.input_sha=answer.input_sha
      WHERE topic.round_id=$3),
    best AS (SELECT DISTINCT ON (root_id) root_id,topic_key,probability FROM scored ORDER BY root_id,probability DESC,topic_key)
    SELECT item.root_id,item.text,best.topic_key,best.probability::float8 probability FROM best
    JOIN signal_mass_labeling_category_matches lexical ON lexical.workspace_id=$1 AND lexical.policy_revision=$5::int AND lexical.root_id=best.root_id AND lexical.matched
    JOIN signal_mass_labeling_items item ON item.map_id=$2 AND item.workspace_id=$1 AND item.root_id=best.root_id
    WHERE best.probability<$4::real AND best.probability>=$6::real AND item.root_id<>ALL($9::uuid[]) ORDER BY md5(item.root_id::text||$7) LIMIT $8`,
    [cycle.workspace_id, cycle.base_map_id, round.id, cycle.policy.approval, cycle.lexicon_revision, probableLine, seed.toString("hex"), PROBABLE_ORPHANS, [...drawn]])).rows;
  for (const row of probable) drawn.add(row.root_id);
  const probableSamples = lines(probable.map(item => ({ case_id: caseId("probable", item.root_id), text: item.text })));
  const probableKey = JSON.stringify({ contract_version: "r16b-blind-probable-key-v1", cycle_id: cycle.id, round: round.round_no, confirmed_from: cycle.policy.approval,
    probable_from: probableLine ?? null, cases: probable.map(({ text: _text, ...item }) => ({ case_id: caseId("probable", item.root_id), ...item, best_probable_topic: item.topic_key })) }, null, 1) + "\n";

  const fusionSamples = lines(fusion.map(item => ({ case_id: caseId("fusion", item.root_id), text: item.text })));
  const voiceSamples = lines(voice.map(item => ({ case_id: caseId("voice", item.root_id), text: item.text })));
  // The two base questions exactly as they were asked, so the evaluator applies the same definitions.
  const voiceGuide = JSON.stringify({ questions: { voice: base.voice.wire, promotion: base.promotion.wire }, consumer_cut: cut,
    instructions: "For each text answer both questions. The topics of the fusion stratum are defined in the catalog of the main package." }, null, 1) + "\n";
  const fusionKey = JSON.stringify({ contract_version: "r16b-blind-fusion-key-v1", cycle_id: cycle.id, round: round.round_no, approval_threshold: cycle.policy.approval,
    cases: fusion.map(({ text: _text, ...item }) => ({ case_id: caseId("fusion", item.root_id), ...item })) }, null, 1) + "\n";
  const voiceKey = JSON.stringify({ contract_version: "r16b-blind-voice-key-v1", cycle_id: cycle.id,
    cases: voice.map(({ text: _text, ...item }) => ({ case_id: caseId("voice", item.root_id), ...item })) }, null, 1) + "\n";
  const count = (values: string[]) => values.reduce<Record<string, number>>((totals, value) => { totals[value] = (totals[value] ?? 0) + 1; return totals; }, {});
  const files: Array<[string, string]> = [["fusion-samples.jsonl", fusionSamples], ["voice-samples.jsonl", voiceSamples], ["voice-guide.json", voiceGuide],
    ...(probable.length ? [["probable-orphans-samples.jsonl", probableSamples] as [string, string]] : [])];
  const manifest = JSON.stringify({ contract_version: "r16b-blind-strata-v1", generated_at: new Date().toISOString(), cycle_round: round.round_no,
    fusion: { cases: fusion.length, pairs_in_the_round: pairs.length, pairs_sampled: new Set(fusion.map(item => item.pair_rank)).size,
      rule: `pairs of possible twins by how often they are accepted together; up to ${perPair} random roots that both topics accepted, each root once` },
    voice: { cases: voice.length, requested: Object.fromEntries(VOICE_STRATA), drawn: count(voice.map(item => item.stratum)),
      rule: "consumer cut with a sure voice (>= 0.9) and an unsure one (< 0.7), promotion above the cut, and other voices; random within each" },
    probable_orphans: { cases: probable.length, rule: "posts about the category with no confirmed topic whose best topic is between the probable and the confirmed line; random" },
    sha256: Object.fromEntries(files.map(([name, body]) => [name, sha(body)])), fusion_key_sha256: sha(fusionKey), voice_key_sha256: sha(voiceKey),
    ...(probable.length ? { probable_key_sha256: sha(probableKey) } : {}) }, null, 1) + "\n";
  files.push(["strata-manifest.json", manifest]);
  for (const directory of [out, keyOut]) { mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700); }
  const write = (directory: string, name: string, body: string) => writeFileSync(join(directory, name), body, { mode: 0o600 });
  for (const [name, body] of files) write(out, name, body);
  write(out, "SHA256SUMS", files.map(([name, body]) => `${sha(body)}  ${name}`).join("\n") + "\n");
  write(keyOut, "fusion-answer-key.private.json", fusionKey);
  write(keyOut, "voice-answer-key.private.json", voiceKey);
  if (probable.length) write(keyOut, "probable-orphans-answer-key.private.json", probableKey);
  write(keyOut, "SHA256SUMS", `${sha(fusionKey)}  fusion-answer-key.private.json\n${sha(voiceKey)}  voice-answer-key.private.json\n`
    + (probable.length ? `${sha(probableKey)}  probable-orphans-answer-key.private.json\n` : ""));
  console.log(JSON.stringify({ probable_orphans: probable.length, fusion: fusion.length, fusion_pairs: new Set(fusion.map(item => item.pair_rank)).size, voice: count(voice.map(item => item.stratum)),
    fusion_key_sha256: sha(fusionKey), voice_key_sha256: sha(voiceKey) }));
} finally { await pool.end(); }
