import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  advanceSignalStudyV1, beginSignalStudyAgentStepV1, chargeSignalStudyV1, claimSignalStudyV1, countSignalStudyCutV1, countSignalStudyStumbleV1, finishSignalStudyV1, getSignalStudyV1,
  listSignalStudyMotivesV1, matchSignalStudyLexiconV1, readSignalStudyAxesV1, readSignalStudyMembershipsV1, readSignalStudyRootsV1, readSignalStudyTopicMembershipsV1,
  recordSignalStudyAgentAnswerV1, releaseSignalStudyV1, renewSignalStudyV1, requestSignalStudyRunV1, rewordSignalStudyMotivesV1, saveSignalStudyMotivesV1,
  setSignalStudyMotiveLayersV1, settleSignalStudyRunV1, type SignalStudyV1,
} from "@noisia/db";
import {
  applySignalStudyContrastV1, applySignalStudyMentionLayersV1, applySignalStudyMotivesV1,
  buildSignalStudyContrastPayloadV1, buildSignalStudyMentionLayersPayloadV1, buildSignalStudyMotivesPayloadV1, clusterSignalListeningOrphansV1, cutSignalStudyTextV1,
  decideSignalStudyMotiveLayersV1, pickSignalStudyVerbatimV1, resolveSignalStudyAxesV1, sampleSignalStudyGroupV1, signalStudyDominanceV1, signalStudyInMotivePoolV1,
  signalStudyMentionKappaV1, signalStudyPermissionForLayerV1, SIGNAL_STUDY_CONTRAST_SCHEMA_V1, SIGNAL_STUDY_MENTION_LAYERS_SCHEMA_V1, SIGNAL_STUDY_MOTIVES_SCHEMA_V1,
  type SignalStudyAxesV1, type SignalStudyGroupV1, type SignalStudyLayerPostV1, type SignalStudySampleRowV1, type SignalStudyWordingV1,
} from "@noisia/query-engine";
import { createSonnetJsonAgentV1, SonnetJsonAgentErrorV1, sonnetJsonCostMicroUsdV1, type SonnetJsonAgentV1 } from "../providers/sonnet-json-agent";

type Database = Pick<Pool, "connect" | "query">;
/** Room kept for the agent steps that follow a JEV pass, and the least a step needs to start. */
const AGENT_RESERVE_MICRO_USD = 4_000_000, AGENT_STEP_MIN_MICRO_USD = 1_500_000, MAX_AGENT_ATTEMPTS = 2, MAX_STUMBLES = 5;
/** After the motives are confirmed the layer is read twice. The second reading must still find the least a step needs,
 * so a pass before them leaves that plus the most one reading has cost. */
const LAYER_READINGS_RESERVE_MICRO_USD = AGENT_STEP_MIN_MICRO_USD + 1_000_000;
type StoredGroup = SignalStudyGroupV1 & { centroid: number[]; sample_b: SignalStudySampleRowV1[] };
type StoredMotive = { motive_key: string; wording: SignalStudyWordingV1; group_keys: string[] };
type Answers = Record<string, { output: unknown } | undefined>;

/** One judgment of the agent inside a study: stored and charged before anything is built on it, and never asked twice. */
async function agentStep(args: { database: Database; study: SignalStudyV1; agent: SonnetJsonAgentV1; key: string; system: string; payload: string; schema: unknown }): Promise<unknown> {
  const { database, study, key } = args, stored = (study.state.answers as Answers | undefined)?.[key];
  if (stored) return stored.output;
  if (study.cap_micro_usd - study.spent_micro_usd < AGENT_STEP_MIN_MICRO_USD) throw new Error("study_cap_reached");
  if (await beginSignalStudyAgentStepV1(database, study, key) > MAX_AGENT_ATTEMPTS) throw new Error("study_agent_attempts_exhausted");
  const started = Date.now();
  let answer: Awaited<ReturnType<SonnetJsonAgentV1>>;
  try { answer = await args.agent({ system: args.system, payload: args.payload, schema: args.schema }); }
  catch (error) {
    // An unusable answer was still billed: the study is charged before it stops.
    if (error instanceof SonnetJsonAgentErrorV1 && error.usage) await chargeSignalStudyV1(database, study, sonnetJsonCostMicroUsdV1(error.usage));
    throw error instanceof SonnetJsonAgentErrorV1 ? new Error(`study_${error.code}`) : error;
  }
  const cost = sonnetJsonCostMicroUsdV1(answer.usage);
  try {
    await recordSignalStudyAgentAnswerV1(database, study, key, { output: answer.output, usage: answer.usage, cost_micro_usd: cost, model: answer.model,
      duration_ms: Date.now() - started, payload_bytes: Buffer.byteLength(args.payload) }, cost);
  } catch (error) {
    // The answer was paid even if it could not be kept.
    await chargeSignalStudyV1(database, study, cost).catch(() => undefined);
    throw error;
  }
  study.spent_micro_usd += cost;
  return answer.output;
}

/** Runs one JEV pass of the study, or reports that it is still running. */
async function jevPass(database: Database, study: SignalStudyV1, planner: "study_axes_v1" | "study_motives_v1", pass: number, reserve: number): Promise<"waiting" | "done"> {
  const run_id = (study.state.runs as Record<string, string> | undefined)?.[`${planner}:${pass}`];
  if (!run_id) {
    const budget = study.cap_micro_usd - study.spent_micro_usd - reserve;
    if (budget < 50_000) throw new Error("study_cap_reached");
    await requestSignalStudyRunV1(database, study, planner, pass, budget);
    return "waiting";
  }
  const run = await settleSignalStudyRunV1(database, study, run_id);
  if (run.status === "queued" || run.status === "running") return "waiting";
  if (run.status !== "completed") throw new Error(`study_run_${run.status}`);
  return "done";
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const count = <T extends string>(values: T[]) => values.reduce<Record<string, number>>((totals, value) => { totals[value] = (totals[value] ?? 0) + 1; return totals; }, {});
const wordingOf = (motive: { wording: SignalStudyWordingV1 }, language: "en" | "original" = "en") => language === "en" ? motive.wording.en : motive.wording.original;
function interleave(groups: StoredGroup[], pass: "a" | "b", limit: number): SignalStudySampleRowV1[] {
  const lists = groups.map(group => pass === "a" ? group.sample : group.sample_b), rows: SignalStudySampleRowV1[] = [];
  for (let index = 0; rows.length < limit && lists.some(list => index < list.length); index++) for (const list of lists) if (index < list.length && rows.length < limit) rows.push(list[index]!);
  return rows;
}

export type StudyStepOutcomeV1 = "continue" | "waiting" | "done";
/**
 * Advances a claimed study by one step. The order is the methodology's:
 * the three questions on the cut → motives discovered from the pooled
 * directions → a layer per motive in two blind passes → every directed root
 * confirmed against its closest motives → checks → the directional result.
 * No step waits for a person.
 */
export async function stepSignalStudyV1(args: { database: Database; study: SignalStudyV1; agent: SonnetJsonAgentV1 }): Promise<StudyStepOutcomeV1> {
  const { database } = args, fresh = await getSignalStudyV1(database, args.study.id);
  if (!fresh) throw new Error("study_unavailable");
  const study: SignalStudyV1 = { ...fresh, lease_token: args.study.lease_token }, template = study.methodology, rules = template.rules;
  const state = study.state as { groups?: StoredGroup[]; motives?: StoredMotive[]; contrast_done?: boolean; directed_roots?: number; lexicon_matched?: number | null };
  const system = (part: keyof typeof template.editorial) => `${template.editorial.base}\n\n${template.editorial[part]}`;

  if (study.step === "created") {
    // A study with its own lexicon finds its cut first; one that uses the brand's lexicon already has it.
    if (study.cut.lexicon_terms?.length && state.lexicon_matched === undefined) {
      const lexicon_matched = await matchSignalStudyLexiconV1(database, study, () => renewSignalStudyV1(database, study));
      await advanceSignalStudyV1(database, study, "created", { lexicon_matched });
      return "continue";
    }
    if (await jevPass(database, study, "study_axes_v1", 1, AGENT_RESERVE_MICRO_USD) === "waiting") return "waiting";
    await advanceSignalStudyV1(database, study, "axes_asked");
    return "continue";
  }

  if (study.step === "axes_asked") {
    const rows = await readSignalStudyAxesV1(database, study);
    const axes = new Map(rows.map(row => [row.root_id, resolveSignalStudyAxesV1(study.subject, row, rules)]));
    const pool = rows.filter(row => signalStudyInMotivePoolV1(template, axes.get(row.root_id)!)).map(row => row.root_id);
    const groups: StoredGroup[] = [];
    if (pool.length >= rules.min_group * 2) {
      const texts: string[] = [], ids: string[] = [], chunks: Float32Array[] = [];
      let dimensions = 0;
      for (let from = 0; from < pool.length; from += 500) {
        for (const row of await readSignalStudyRootsV1(database, study, pool.slice(from, from + 500), { vectors: true })) {
          if (!row.vector) continue;
          dimensions ||= row.vector.length;
          if (row.vector.length !== dimensions) continue;
          ids.push(row.root_id); texts.push(row.text); chunks.push(Float32Array.from(row.vector));
        }
        await renewSignalStudyV1(database, study);
      }
      const vectors = new Float32Array(ids.length * dimensions);
      chunks.forEach((chunk, index) => vectors.set(chunk, index * dimensions));
      const wanted = Math.max(rules.min_groups, Math.min(rules.max_groups, Math.round(ids.length / rules.roots_per_group)));
      // Posts without a vector cannot be grouped: with too few left there are no groups, and the study says so.
      const clustered = ids.length >= rules.min_group * 2 ? clusterSignalListeningOrphansV1({ vectors, dimensions, groups: wanted })
        : { assignments: new Int32Array(0), similarities: new Float32Array(0), centroids: new Float32Array(0) };
      const members = new Map<number, number[]>();
      clustered.assignments.forEach((group, row) => { const list = members.get(group); if (list) list.push(row); else members.set(group, [row]); });
      [...members].filter(([, list]) => list.length >= rules.min_group).sort((a, b) => b[1].length - a[1].length).forEach(([group, list], index) => {
        const group_key = `group_${index + 1}`;
        const sampled = list.map(row => ({ root_id: ids[row]!, text: texts[row]!, similarity: clustered.similarities[row]! }));
        const sample = (pass: "a" | "b") => sampleSignalStudyGroupV1({ group_key, members: sampled, random: rules.random_sample, far: rules.far_sample, pass, excerpt_chars: rules.excerpt_chars });
        groups.push({ group_key, roots: list.length, directions: count(list.map(row => axes.get(ids[row]!)!.direction)), sample: sample("a"), sample_b: sample("b"),
          centroid: Array.from(clustered.centroids.subarray(group * dimensions, (group + 1) * dimensions)) });
      });
    }
    await advanceSignalStudyV1(database, study, "grouped", { groups, pool_roots: pool.length, directed_roots: rows.filter(row => axes.get(row.root_id)!.direction !== "none").length });
    return "continue";
  }

  if (study.step === "grouped") {
    const groups = state.groups ?? [];
    let motives: StoredMotive[] = [], naming: Record<string, unknown> = { groups: 0 };
    if (groups.length) {
      const output = await agentStep({ database, study, agent: args.agent, key: "motives", system: system("motives"), schema: SIGNAL_STUDY_MOTIVES_SCHEMA_V1,
        payload: buildSignalStudyMotivesPayloadV1({ subject: study.subject, groups }) });
      const named = applySignalStudyMotivesV1({ groups, output });
      motives = named.motives;
      naming = { groups: groups.length, motives: motives.length, insufficient_groups: named.insufficient_groups, uncovered_groups: named.uncovered_groups, rejected: named.rejected };
    }
    const byKey = new Map(groups.map(group => [group.group_key, group]));
    await saveSignalStudyMotivesV1(database, study, motives.map(motive => {
      const own = motive.group_keys.map(group => byKey.get(group)!), total = own.reduce((sum, group) => sum + group.roots, 0);
      const centroid = new Float64Array(own[0]!.centroid.length);
      for (const group of own) for (let d = 0; d < centroid.length; d++) centroid[d]! += group.centroid[d]! * group.roots / total;
      return { motive_key: motive.motive_key, wording: motive.wording, layer: "unclear" as const, permission: signalStudyPermissionForLayerV1(template, "unclear"),
        layer_record: {}, group_keys: motive.group_keys, centroid };
    }));
    await advanceSignalStudyV1(database, study, "motives_named", { motives, naming });
    return "continue";
  }

  if (study.step === "motives_named") {
    if (!(await listSignalStudyMotivesV1(database, study.id)).length) { await advanceSignalStudyV1(database, study, "checked"); return "continue"; }
    // Every post with a direction is asked its closest motives. Room is kept for reading the layers afterwards.
    if (await jevPass(database, study, "study_motives_v1", 1, LAYER_READINGS_RESERVE_MICRO_USD) === "waiting") return "waiting";
    await advanceSignalStudyV1(database, study, "motives_asked");
    return "continue";
  }

  if (study.step === "motives_asked" || study.step === "layers_coded") {
    if (state.contrast_done) {
      // The rewritten motives are asked again; everything else is already in the cache.
      if (await jevPass(database, study, "study_motives_v1", 2, LAYER_READINGS_RESERVE_MICRO_USD) === "waiting") return "waiting";
      await advanceSignalStudyV1(database, study, "members_confirmed");
      return "continue";
    }
    const motives = await listSignalStudyMotivesV1(database, study.id), memberships = await readSignalStudyMembershipsV1(database, study);
    const sizes = count(memberships.map(row => row.motive_key));
    // Layers are not read yet: here only a motive that holds more than half of the cut is rewritten.
    const dominance = signalStudyDominanceV1({ template, directed_roots: state.directed_roots ?? 0, layer_roots: {},
      motives: motives.map(motive => ({ motive_key: motive.motive_key, layer: motive.layer, roots: sizes[motive.motive_key] ?? 0 })) });
    if (!dominance.rewrite.length) { await advanceSignalStudyV1(database, study, "members_confirmed", { checks: { ...dominance, contrast_applied: false } }); return "continue"; }
    // The rewrite is an improvement, not a requirement: without room for it the study goes on as it is, and says so.
    if (!(study.state.answers as Answers | undefined)?.contrast && study.cap_micro_usd - study.spent_micro_usd < AGENT_STEP_MIN_MICRO_USD + LAYER_READINGS_RESERVE_MICRO_USD) {
      await advanceSignalStudyV1(database, study, "members_confirmed", { checks: { ...dominance, contrast_applied: false, contrast_skipped: "budget" } });
      return "continue";
    }
    // More than half of the cut in one motive points at its definition: it is rewritten in contrast, once.
    const groups = new Map((state.groups ?? []).map(group => [group.group_key, group]));
    const rewrite = motives.filter(motive => dominance.rewrite.includes(motive.motive_key));
    const output = await agentStep({ database, study, agent: args.agent, key: "contrast", system: system("contrast"), schema: SIGNAL_STUDY_CONTRAST_SCHEMA_V1,
      payload: buildSignalStudyContrastPayloadV1({ subject: study.subject,
        rewrite: rewrite.map(motive => ({ motive_key: motive.motive_key, ...wordingOf(motive),
          sample: interleave(motive.group_keys.flatMap(group => groups.has(group) ? [groups.get(group)!] : []), "a", rules.random_sample + rules.far_sample) })),
        neighbours: motives.filter(motive => !dominance.rewrite.includes(motive.motive_key)).map(motive => ({ motive_key: motive.motive_key, ...wordingOf(motive) })) }) });
    const reworded = applySignalStudyContrastV1(output, rewrite.map(motive => motive.motive_key));
    await rewordSignalStudyMotivesV1(database, study, reworded, { contrast_done: true, checks: { ...dominance, contrast_applied: true, reworded: [...reworded.keys()] } });
    return "continue";
  }

  if (study.step === "members_confirmed") {
    // The layer is read post by post, on posts confirmed for each motive, twice and blind. A motive takes the layer most
    // of its posts show; agreement is measured over the posts, not over a dozen motives.
    const motives = await listSignalStudyMotivesV1(database, study.id), memberships = await readSignalStudyMembershipsV1(database, study);
    const rows = await readSignalStudyAxesV1(database, study);
    const ofSubject = new Set(rows.filter(row => { const axes = resolveSignalStudyAxesV1(study.subject, row, rules); return axes.direction !== "none" && axes.aggregate === "subject"; })
      .map(row => row.root_id));
    const perMotive = rules.layer_mentions_per_motive ?? 20, chosen = new Map<string, string[]>();
    for (const row of [...memberships].sort((a, b) => a.root_id.localeCompare(b.root_id))) {
      if (!ofSubject.has(row.root_id)) continue;
      const list = chosen.get(row.motive_key) ?? [];
      // Repeatable and spread over the motive: the posts are taken in the order of a hash of their id.
      list.push(row.root_id); chosen.set(row.motive_key, list);
    }
    const order = (motive_key: string, root_id: string) => hash(`${study.id}:${motive_key}:${root_id}`);
    const picked = [...chosen].flatMap(([motive_key, roots]) => roots.sort((a, b) => order(motive_key, a).localeCompare(order(motive_key, b))).slice(0, perMotive)
      .map(root_id => ({ motive_key, root_id })));
    const texts = new Map<string, string>();
    const wanted = [...new Set(picked.map(item => item.root_id))];
    for (let from = 0; from < wanted.length; from += 500) {
      for (const row of await readSignalStudyRootsV1(database, study, wanted.slice(from, from + 500), { vectors: false })) texts.set(row.root_id, row.text);
      await renewSignalStudyV1(database, study);
    }
    const posts: SignalStudyLayerPostV1[] = picked.flatMap((item, index) => texts.has(item.root_id)
      ? [{ id: `p${index + 1}`, motive_key: item.motive_key, text: cutSignalStudyTextV1(texts.get(item.root_id)!, 600) }] : []);
    let stability: Record<string, unknown> = { unit: "posts", n: 0, kappa: null, agreement: null };
    if (posts.length) {
      const named = motives.map(motive => ({ motive_key: motive.motive_key, ...wordingOf(motive) }));
      // Kept under their own names: a study made before the layer was read by post holds readings by motive under the
      // old ones, in another shape, and takes these readings again instead of failing on them.
      const reading = async (key: "layers_a" | "layers_b") => applySignalStudyMentionLayersV1({ posts, output: await agentStep({ database, study, agent: args.agent,
        key: key === "layers_a" ? "post_layers_a" : "post_layers_b",
        system: system("layers"), schema: SIGNAL_STUDY_MENTION_LAYERS_SCHEMA_V1,
        payload: buildSignalStudyMentionLayersPayloadV1({ template, subject: study.subject, motives: named, posts, order: key }) }) });
      const first = await reading("layers_a"), second = await reading("layers_b");
      const agreement = signalStudyMentionKappaV1(first, second), decided = decideSignalStudyMotiveLayersV1({ template, posts, readings: [first, second] });
      await setSignalStudyMotiveLayersV1(database, study, decided.map(item => ({ motive_key: item.motive_key, layer: item.layer, permission: item.permission,
        layer_record: { unit: "posts", posts: item.posts, votes: item.votes, share: item.share, proofs: item.proofs } })));
      const without = [...first.values(), ...second.values()].filter(item => item.downgraded !== null).length;
      stability = { unit: "posts", n: agreement.n, kappa: agreement.kappa, agreement: agreement.agreement, kappa_min: rules.kappa_min,
        readings_without_literal_proof: without, motives_without_majority: decided.filter(item => item.layer === "unclear").map(item => item.motive_key) };
    }
    // Reported, not acted on: a layer that holds more than half of the cut.
    const after = await listSignalStudyMotivesV1(database, study.id), layerOf = new Map(after.map(motive => [motive.motive_key, motive.layer]));
    const inLayer = new Map<string, Set<string>>();
    for (const row of memberships) { const layer = layerOf.get(row.motive_key) ?? "unclear", roots = inLayer.get(layer); if (roots) roots.add(row.root_id); else inLayer.set(layer, new Set([row.root_id])); }
    const dominant_layers = [...inLayer].filter(([, roots]) => roots.size / Math.max(1, state.directed_roots ?? 0) > rules.dominance_max).map(([layer]) => layer).sort();
    await advanceSignalStudyV1(database, study, "checked", { layer_stability: stability, checks: { ...(study.state.checks as Record<string, unknown> | undefined ?? {}), dominant_layers } });
    return "continue";
  }

  if (study.step === "checked") {
    await finishSignalStudyV1(database, study, { status: "completed", output: await buildStudyOutput(database, study) });
    return "done";
  }
  return "done";
}

/** The directional result of a study. Every number is counted here; nothing in it was written by the agent except names, definitions and layers. */
async function buildStudyOutput(database: Database, study: SignalStudyV1): Promise<Record<string, unknown>> {
  const template = study.methodology, rules = template.rules;
  const rows = await readSignalStudyAxesV1(database, study), sizes = await countSignalStudyCutV1(database, study);
  const axes = new Map<string, SignalStudyAxesV1>(rows.map(row => [row.root_id, resolveSignalStudyAxesV1(study.subject, row, rules)]));
  const motives = await listSignalStudyMotivesV1(database, study.id), memberships = await readSignalStudyMembershipsV1(database, study);
  const members = new Map<string, string[]>();
  for (const row of memberships) { const list = members.get(row.motive_key); if (list) list.push(row.root_id); else members.set(row.motive_key, [row.root_id]); }
  const directed = rows.filter(row => axes.get(row.root_id)!.direction !== "none"), assigned = new Set(memberships.map(row => row.root_id));
  const subjectRoots = new Set(directed.filter(row => axes.get(row.root_id)!.aggregate === "subject").map(row => row.root_id));
  // Texts and where they were published are read once, for the roots that carry a motive.
  const meta = new Map<string, { text: string; url: string | null; platform: string | null; published_at: string | null }>();
  const needed = [...new Set([...assigned, ...subjectRoots])];
  for (let from = 0; from < needed.length; from += 1000) {
    for (const row of await readSignalStudyRootsV1(database, study, needed.slice(from, from + 1000), { vectors: false })) meta.set(row.root_id, row);
    await renewSignalStudyV1(database, study);
  }
  const topics = new Map<string, string[]>();
  for (let from = 0; from < needed.length; from += 2000) {
    for (const row of await readSignalStudyTopicMembershipsV1(database, study, needed.slice(from, from + 2000))) {
      const list = topics.get(row.root_id); if (list) list.push(row.topic_key); else topics.set(row.root_id, [row.topic_key]);
    }
  }
  const month = (value: string | null) => value ? value.slice(0, 7) : "unknown";
  const top = (totals: Record<string, number>, limit: number) => Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([key, mentions]) => ({ key, mentions }));
  const motiveRows = motives.map(motive => {
    const all = members.get(motive.motive_key) ?? [], own = all.filter(root => subjectRoots.has(root));
    const directions = count(own.map(root => axes.get(root)!.direction));
    const verbatims = [...own].sort().flatMap(root => {
      const source = meta.get(root), quote = source ? pickSignalStudyVerbatimV1(source.text, 280) : null;
      // A quote is shown only as a literal piece of its post, with its link, network and date.
      return source && quote && source.url ? [{ quote, url: source.url, platform: source.platform, published_at: source.published_at }] : [];
    }).slice(0, rules.verbatims_per_motive);
    return { motive_key: motive.motive_key, wording: motive.wording, layer: motive.layer, permission: motive.permission, layer_record: motive.layer_record,
      mentions: own.length, share_of_directed: subjectRoots.size ? own.length / subjectRoots.size : 0,
      mentions_with_trigger_signal: directions.trigger ?? 0, mentions_with_barrier_signal: directions.barrier ?? 0, mentions_with_tension: directions.mixed ?? 0,
      competitor_mentions: all.filter(root => axes.get(root)?.aggregate === "competitor").length,
      by_channel: top(count(own.map(root => meta.get(root)?.platform ?? "unknown")), 8), by_month: top(count(own.map(root => month(meta.get(root)?.published_at ?? null))), 36)
        .sort((a, b) => a.key.localeCompare(b.key)), listening_topics: top(count(own.flatMap(root => topics.get(root) ?? [])), 6), verbatims };
  }).sort((a, b) => b.mentions - a.mentions || a.motive_key.localeCompare(b.motive_key));
  const layers = template.layers.map(layer => {
    const own = motiveRows.filter(motive => motive.layer === layer.key), mentions = new Set(own.flatMap(motive => (members.get(motive.motive_key) ?? []).filter(root => subjectRoots.has(root)))).size;
    return { layer: layer.key, permission: layer.permission, motives: own.length, mentions, share_of_directed: subjectRoots.size ? mentions / subjectRoots.size : 0 };
  });
  const barrierShare = subjectRoots.size ? directed.filter(row => subjectRoots.has(row.root_id) && axes.get(row.root_id)!.direction === "barrier").length / subjectRoots.size : null;
  // The guard of the methodology: a direction that takes more than its share of the cut means the rules read too much.
  const directionShares = Object.fromEntries(Object.entries(count(directed.map(row => axes.get(row.root_id)!.direction))).map(([key, mentions]) => [key, mentions / rows.length]));
  const tooWide = rules.direction_share_max === undefined ? [] : Object.entries(directionShares).filter(([, share]) => share > rules.direction_share_max!).map(([key]) => key).sort();
  return {
    contract_version: "signal-study-output-v1", status: rules.output_status, generated_at: new Date().toISOString(),
    methodology: { key: template.key, version: template.version }, subject: study.subject,
    cut: { ...study.cut, mentions: sizes.cut_roots, corpus_mentions: sizes.corpus_roots, share_of_corpus: sizes.corpus_roots ? sizes.cut_roots / sizes.corpus_roots : 0,
      answered: rows.length },
    axes: { direction: count(rows.map(row => axes.get(row.root_id)!.direction)),
      // Directions the classifier gave below the line that makes them count: kept, read as none.
      direction_probable: count(rows.flatMap(row => axes.get(row.root_id)!.direction_probable ? [axes.get(row.root_id)!.direction_probable!] : [])), target: count(rows.map(row => row.target)), use: count(rows.map(row => row.use)),
      counted_as: count(directed.map(row => axes.get(row.root_id)!.aggregate)) },
    directed: { mentions: directed.length, about_the_subject: subjectRoots.size,
      // How the posts that count toward the subject were used, as the use question read them.
      about_the_subject_by_use: count(directed.filter(row => subjectRoots.has(row.root_id)).map(row => row.use)), with_a_motive: [...assigned].filter(root => subjectRoots.has(root)).length,
      without_a_motive: [...subjectRoots].filter(root => !assigned.has(root)).length },
    // The balance of direction depends in part on how the corpus was collected, so its base rates travel with it.
    query_bias: { note: "direction_balance_depends_on_the_corpus_query", cut_share_of_corpus: sizes.corpus_roots ? sizes.cut_roots / sizes.corpus_roots : null,
      directed_share_of_cut: rows.length ? directed.length / rows.length : null, barrier_share_of_directed: barrierShare,
      direction_share_of_cut: directionShares, directions_over_the_share_allowed: tooWide },
    layer_stability: study.state.layer_stability ?? null, checks: study.state.checks ?? null, naming: study.state.naming ?? null,
    motives: motiveRows, layers,
    competitor: { mentions: directed.filter(row => axes.get(row.root_id)!.aggregate === "competitor").length,
      motives: motiveRows.filter(motive => motive.competitor_mentions > 0).map(motive => ({ motive_key: motive.motive_key, mentions: motive.competitor_mentions })) },
    series: top(count(directed.filter(row => subjectRoots.has(row.root_id)).map(row => `${month(meta.get(row.root_id)?.published_at ?? null)}|${axes.get(row.root_id)!.direction}`)), 200)
      .map(item => ({ period: item.key.split("|")[0], direction: item.key.split("|")[1], mentions: item.mentions })).sort((a, b) => `${a.period}${a.direction}`.localeCompare(`${b.period}${b.direction}`)),
    spent_micro_usd: study.spent_micro_usd,
  };
}

/** Runs queued studies. Off unless `NOISIA_SIGNAL_LISTENING_ENABLED=true`. */
export function startSignalStudyDrainerV1(options: { database?: Database; env?: NodeJS.ProcessEnv; interval_ms?: number; agent?: SonnetJsonAgentV1 } = {}) {
  const env = options.env ?? process.env;
  let active: Promise<void> | undefined, ready = false, agent = options.agent;
  const tick = async () => {
    if (env.NOISIA_SIGNAL_LISTENING_ENABLED !== "true") return;
    const database = options.database ?? (await import("../db/client")).pool;
    ready ||= Boolean((await database.query("SELECT to_regclass('signal_studies') IS NOT NULL ready")).rows[0]?.ready);
    if (!ready) return;
    const study = await claimSignalStudyV1(database);
    if (!study) return;
    agent ??= createSonnetJsonAgentV1({ apiKey: env.NOISIA_MASS_LABELING_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY ?? "" });
    let owned = true;
    const beat = setInterval(() => void renewSignalStudyV1(database, study).then(result => { owned &&= result; }).catch(() => undefined), 60_000); beat.unref?.();
    try {
      for (;;) {
        const outcome = await stepSignalStudyV1({ database, study, agent });
        if (outcome === "done") { console.log(`[study] ${study.id} finished`); return; }
        if (outcome === "waiting") { await releaseSignalStudyV1(database, study); return; }
        if (!owned) { console.warn(`[study] ${study.id} lease lost`); return; }
      }
    } catch (error) {
      const known = error instanceof Error && /^(?:study|listening)_[a-z0-9_]{1,70}$/u.test(error.message) ? error.message : null;
      // A failure that is not one of the study's own (a database hiccup, a provider outage) is tried again a few times.
      if (!known && await countSignalStudyStumbleV1(database, study).catch(() => MAX_STUMBLES + 1) <= MAX_STUMBLES) {
        console.warn(`[study] ${study.id} stumbled; it will be tried again`);
        await releaseSignalStudyV1(database, study).catch(() => undefined);
        return;
      }
      console.warn(`[study] ${study.id} failed: ${known ?? "study_failed"}`);
      await finishSignalStudyV1(database, study, { status: "failed", error_code: known ?? "study_failed" }).catch(() => undefined);
    } finally { clearInterval(beat); }
  };
  const start = () => { active ??= tick().catch(() => console.warn("[study] drainer unavailable")).finally(() => { active = undefined; }); };
  const timer = setInterval(start, options.interval_ms ?? 10_000); timer.unref?.();
  start();
  return { async close() { clearInterval(timer); if (active) await active; } };
}
