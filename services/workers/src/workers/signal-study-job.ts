import type { Pool } from "pg";
import {
  advanceSignalStudyV1, beginSignalStudyAgentStepV1, chargeSignalStudyV1, claimSignalStudyV1, countSignalStudyCutV1, countSignalStudyStumbleV1, finishSignalStudyV1, getSignalStudyV1,
  listSignalStudyMotivesV1, readSignalStudyAxesV1, readSignalStudyMembershipsV1, readSignalStudyRootsV1, readSignalStudyTopicMembershipsV1,
  recordSignalStudyAgentAnswerV1, releaseSignalStudyV1, renewSignalStudyV1, requestSignalStudyRunV1, rewordSignalStudyMotivesV1, saveSignalStudyMotivesV1,
  settleSignalStudyRunV1, type SignalStudyV1,
} from "@noisia/db";
import {
  applySignalStudyBoundaryV1, applySignalStudyContrastV1, applySignalStudyLayersV1, applySignalStudyMotivesV1, buildSignalStudyBoundaryPayloadV1,
  buildSignalStudyContrastPayloadV1, buildSignalStudyLayersPayloadV1, buildSignalStudyMotivesPayloadV1, clusterSignalListeningOrphansV1,
  pickSignalStudyVerbatimV1, resolveSignalStudyAxesV1, sampleSignalStudyGroupV1, signalStudyDominanceV1, signalStudyInMotivePoolV1, signalStudyLayerKappaV1,
  signalStudyLayersSchemaV1, signalStudyPermissionForLayerV1, SIGNAL_STUDY_BOUNDARY_SCHEMA_V1, SIGNAL_STUDY_CONTRAST_SCHEMA_V1, SIGNAL_STUDY_MOTIVES_SCHEMA_V1,
  type SignalStudyAxesV1, type SignalStudyGroupV1, type SignalStudyLayerCodingV1, type SignalStudyLayerV1, type SignalStudyMotiveSampleV1,
  type SignalStudySampleRowV1, type SignalStudyWordingV1,
} from "@noisia/query-engine";
import { createSonnetJsonAgentV1, SonnetJsonAgentErrorV1, sonnetJsonCostMicroUsdV1, type SonnetJsonAgentV1 } from "../providers/sonnet-json-agent";

type Database = Pick<Pool, "connect" | "query">;
/** Room kept for the agent steps that follow a JEV pass, and the least a step needs to start. */
const AGENT_RESERVE_MICRO_USD = 4_000_000, AGENT_STEP_MIN_MICRO_USD = 1_500_000, MAX_AGENT_ATTEMPTS = 2, MAX_STUMBLES = 5;
type StoredGroup = SignalStudyGroupV1 & { centroid: number[]; sample_b: SignalStudySampleRowV1[] };
type StoredMotive = { motive_key: string; wording: SignalStudyWordingV1; group_keys: string[] };
type Answers = Record<string, { output: unknown } | undefined>;
type FinalMotive = Parameters<typeof saveSignalStudyMotivesV1>[2][number];

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
  const state = study.state as { groups?: StoredGroup[]; motives?: StoredMotive[]; contrast_done?: boolean; directed_roots?: number };
  const system = (part: keyof typeof template.editorial) => `${template.editorial.base}\n\n${template.editorial[part]}`;

  if (study.step === "created") {
    if (await jevPass(database, study, "study_axes_v1", 1, AGENT_RESERVE_MICRO_USD) === "waiting") return "waiting";
    await advanceSignalStudyV1(database, study, "axes_asked");
    return "continue";
  }

  if (study.step === "axes_asked") {
    const rows = await readSignalStudyAxesV1(database, study);
    const axes = new Map(rows.map(row => [row.root_id, resolveSignalStudyAxesV1(study.subject, row)]));
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
    await advanceSignalStudyV1(database, study, "grouped", { groups, pool_roots: pool.length, directed_roots: rows.filter(row => row.direction !== "none").length });
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
    const groups = new Map((state.groups ?? []).map(group => [group.group_key, group])), named = state.motives ?? [];
    const limit = rules.random_sample + rules.far_sample;
    const sampleOf = (motive: StoredMotive, pass: "a" | "b", rule?: string): SignalStudyMotiveSampleV1 => ({ motive_key: motive.motive_key, ...wordingOf(motive),
      sample: interleave(motive.group_keys.map(group => groups.get(group)!), pass, limit), ...(rule ? { rule } : {}) });
    const schema = signalStudyLayersSchemaV1(template);
    const pass = async (key: string, which: "a" | "b", subset: StoredMotive[], rule?: Map<string, string>): Promise<SignalStudyLayerCodingV1[]> => {
      const samples = subset.map(motive => sampleOf(motive, which, rule?.get(motive.motive_key)));
      const output = await agentStep({ database, study, agent: args.agent, key, system: system("layers"), schema,
        payload: buildSignalStudyLayersPayloadV1({ template, subject: study.subject, motives: samples }) });
      return applySignalStudyLayersV1({ template, motives: samples, output });
    };
    let first: SignalStudyLayerCodingV1[] = [], second: SignalStudyLayerCodingV1[] = [];
    let stability: Record<string, unknown> = { kappa: null, agreement: null, disagreements: [], recoded: [] };
    if (named.length) {
      // Two independent, blind passes over different examples of each motive.
      first = await pass("layers_a", "a", named); second = await pass("layers_b", "b", named);
      const initial = signalStudyLayerKappaV1(first, second);
      stability = { kappa: initial.kappa, agreement: initial.agreement, disagreements: initial.disagreements, recoded: [] };
      if (initial.kappa !== null && initial.kappa < rules.kappa_min && initial.disagreements.length) {
        // The rule for the boundary cases is rewritten once and only those motives are coded again.
        const boundary = named.filter(motive => initial.disagreements.includes(motive.motive_key));
        const codedFirst = new Map(first.map(item => [item.motive_key, item])), codedSecond = new Map(second.map(item => [item.motive_key, item]));
        const ruleOutput = await agentStep({ database, study, agent: args.agent, key: "boundary", system: system("boundary"), schema: SIGNAL_STUDY_BOUNDARY_SCHEMA_V1,
          payload: buildSignalStudyBoundaryPayloadV1({ template, subject: study.subject, motives: boundary.map(motive => ({ ...sampleOf(motive, "a"),
            first: codedFirst.get(motive.motive_key)!, second: codedSecond.get(motive.motive_key)! })) }) });
        const decisionRules = applySignalStudyBoundaryV1(ruleOutput, boundary.map(motive => motive.motive_key));
        const again = new Map((await pass("layers_a_recode", "a", boundary, decisionRules)).map(item => [item.motive_key, item]));
        const againSecond = new Map((await pass("layers_b_recode", "b", boundary, decisionRules)).map(item => [item.motive_key, item]));
        first = first.map(item => again.get(item.motive_key) ?? item); second = second.map(item => againSecond.get(item.motive_key) ?? item);
        const after = signalStudyLayerKappaV1(first, second);
        stability = { ...stability, recoded: boundary.map(motive => motive.motive_key), kappa_after_recode: after.kappa, agreement_after_recode: after.agreement,
          // If it fails again it is marked, not repeated.
          unstable: after.kappa !== null && after.kappa < rules.kappa_min ? after.disagreements : [], decision_rules: Object.fromEntries(decisionRules) };
      }
    }
    const codedSecond = new Map(second.map(item => [item.motive_key, item]));
    const centroids = new Map((state.motives ?? []).map(motive => {
      const own = motive.group_keys.map(group => groups.get(group)!), total = own.reduce((sum, group) => sum + group.roots, 0);
      const centroid = new Float64Array(own[0]!.centroid.length);
      for (const group of own) for (let d = 0; d < centroid.length; d++) centroid[d]! += group.centroid[d]! * group.roots / total;
      return [motive.motive_key, centroid] as const;
    }));
    const final = first.flatMap<FinalMotive>(coding => {
      // Names and groups come from the naming step, so this step can be repeated after it already wrote its motives.
      const base = named.find(motive => motive.motive_key === coding.motive_key)!, other = codedSecond.get(coding.motive_key);
      // When the examples show two layers the motive is split; it is never averaged.
      if (coding.parts.length >= 2) {
        return coding.parts.map((part, index) => ({ motive_key: `${coding.motive_key}_${index + 1}`.slice(0, 120), wording: part.wording, layer: part.layer,
          permission: signalStudyPermissionForLayerV1(template, part.layer), group_keys: base.group_keys, centroid: centroids.get(coding.motive_key) ?? null,
          layer_record: { split_from: coding.motive_key, proof: part.proof, single_pass: true } }));
      }
      const agreed = other?.layer === coding.layer, layer: SignalStudyLayerV1 = agreed ? coding.layer : "unclear";
      return [{ motive_key: coding.motive_key, wording: base.wording, layer, permission: agreed ? coding.permission : signalStudyPermissionForLayerV1(template, "unclear"),
        group_keys: base.group_keys, centroid: centroids.get(coding.motive_key) ?? null,
        layer_record: { agreed, proof: coding.proof, normative_proof: coding.normative_proof, diagnostics: coding.diagnostics, permission_override: agreed ? coding.permission_override : null,
          first: { layer: coding.layer, downgraded: coding.downgraded }, second: other ? { layer: other.layer, downgraded: other.downgraded } : null } }];
    });
    await saveSignalStudyMotivesV1(database, study, final);
    await advanceSignalStudyV1(database, study, "layers_coded", { layer_stability: stability });
    return "continue";
  }

  if (study.step === "layers_coded") {
    if (!(await listSignalStudyMotivesV1(database, study.id)).length) { await advanceSignalStudyV1(database, study, "checked"); return "continue"; }
    if (await jevPass(database, study, "study_motives_v1", 1, AGENT_STEP_MIN_MICRO_USD) === "waiting") return "waiting";
    await advanceSignalStudyV1(database, study, "motives_asked");
    return "continue";
  }

  if (study.step === "motives_asked") {
    if (state.contrast_done) {
      // The rewritten motives are asked again; everything else is already in the cache.
      if (await jevPass(database, study, "study_motives_v1", 2, 0) === "waiting") return "waiting";
      await advanceSignalStudyV1(database, study, "checked");
      return "continue";
    }
    const motives = await listSignalStudyMotivesV1(database, study.id), memberships = await readSignalStudyMembershipsV1(database, study);
    const sizes = count(memberships.map(row => row.motive_key)), layerOf = new Map(motives.map(motive => [motive.motive_key, motive.layer]));
    const inLayer = new Map<string, Set<string>>();
    for (const row of memberships) { const layer = layerOf.get(row.motive_key)!, roots = inLayer.get(layer); if (roots) roots.add(row.root_id); else inLayer.set(layer, new Set([row.root_id])); }
    const dominance = signalStudyDominanceV1({ template, directed_roots: state.directed_roots ?? 0,
      motives: motives.map(motive => ({ motive_key: motive.motive_key, layer: motive.layer, roots: sizes[motive.motive_key] ?? 0 })),
      layer_roots: Object.fromEntries([...inLayer].map(([layer, roots]) => [layer, roots.size])) });
    if (!dominance.rewrite.length) { await advanceSignalStudyV1(database, study, "checked", { checks: { ...dominance, contrast_applied: false } }); return "continue"; }
    // The rewrite is an improvement, not a requirement: without room for it the study is published as it is, and says so.
    if (!(study.state.answers as Answers | undefined)?.contrast && study.cap_micro_usd - study.spent_micro_usd < AGENT_STEP_MIN_MICRO_USD) {
      await advanceSignalStudyV1(database, study, "checked", { checks: { ...dominance, contrast_applied: false, contrast_skipped: "budget" } });
      return "continue";
    }
    // More than half of the cut in one motive or layer points at the definitions: they are rewritten in contrast, once.
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
  const axes = new Map<string, SignalStudyAxesV1>(rows.map(row => [row.root_id, resolveSignalStudyAxesV1(study.subject, row)]));
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
  return {
    contract_version: "signal-study-output-v1", status: rules.output_status, generated_at: new Date().toISOString(),
    methodology: { key: template.key, version: template.version }, subject: study.subject,
    cut: { ...study.cut, mentions: sizes.cut_roots, corpus_mentions: sizes.corpus_roots, share_of_corpus: sizes.corpus_roots ? sizes.cut_roots / sizes.corpus_roots : 0,
      answered: rows.length },
    axes: { direction: count(rows.map(row => axes.get(row.root_id)!.direction)), target: count(rows.map(row => row.target)), use: count(rows.map(row => row.use)),
      counted_as: count(directed.map(row => axes.get(row.root_id)!.aggregate)) },
    directed: { mentions: directed.length, about_the_subject: subjectRoots.size, with_a_motive: [...assigned].filter(root => subjectRoots.has(root)).length,
      without_a_motive: [...subjectRoots].filter(root => !assigned.has(root)).length },
    // The balance of direction depends in part on how the corpus was collected, so its base rates travel with it.
    query_bias: { note: "direction_balance_depends_on_the_corpus_query", cut_share_of_corpus: sizes.corpus_roots ? sizes.cut_roots / sizes.corpus_roots : null,
      directed_share_of_cut: rows.length ? directed.length / rows.length : null, barrier_share_of_directed: barrierShare },
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
