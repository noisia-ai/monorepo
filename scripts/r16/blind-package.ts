import { createHash, createHmac, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export const LISTENING_COHORTS_V1 = ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10"] as const;
const DIRECTIONS = ["trigger", "barrier", "mixed", "none"] as const;
const TARGETS = ["category", "own_brand", "competitor_brand", "alternative"] as const;
const USES = ["literal", "figurative_or_ironic", "other"] as const;
const HASH_RE = /^[a-f0-9]{64}$/u;
const OMIT_KEYS = new Set(["mention_id", "root_id", "workspace_id", "corpus_id", "study_id", "run_id", "topic_key", "motive_key",
  "direction", "target", "use", "layer", "permission", "label", "answer", "expected", "prediction", "confidence", "probability",
  "cohort", "stratum", "cut_membership", "in_cut", "model", "assigned", "assigned_motive_key", "system_assigned_motive_key", "predicted_motive_key", "ranked_candidate_keys",
  "option_map", "nearest_motives", "flags", "review_flags", "false_none_candidate", "false_irony_candidate", "ambiguous_brand_candidate",
  "axes_status", "lexical_filter_match", "base_voice_valid"]);

export type BlindSnapshotV1 = {
  contract_version: "r16-blind-snapshot-v1";
  exported_at: string;
  source: { export_contract: string; export_digest: string };
  study_provenance: { listening_before_digest: string; listening_after_digest: string; study_contract_version: string;
    methodology_template_version: string; methodology_template_digest: string };
  study_guidance: { subject_context: string; direction_options: Array<{ key: string; definition: string }>;
    target_options: Array<{ key: string; definition: string }>; use_options: Array<{ key: string; definition: string }>;
    layer_diagnostics: Array<{ key: string; layer: string; question: string; definition: string }> };
  layer_agreement: { eligible_count: number; pass_a_count: number; pass_a_digest: string | null; pass_b_count: number; pass_b_digest: string | null;
    denominator: number; coverage: number; observed_agreement: number | null; expected_agreement: number | null; kappa: number | null;
    estimation_status: "complete" | "not_estimable"; not_estimable_reason: "no_passes" | "incomplete_coverage" | "expected_agreement_one" | null;
    action: "stable" | "recode_boundary_once" | "unstable_report" | "not_estimable";
    status: "not_measured" | "insufficient_data" | "not_estimable" | "below_threshold" | "acceptable"; boundary_recoded_count: number } | null;
  receipts: { status: "complete" | "incomplete"; cost_scope: "native_provider_ledgers";
    total_cost_usd: number | null; total_reserved_usd: number | null;
    total_elapsed_ms: number | null; timing_scope: "wall_span" | "unknown";
    stages: Array<{ stage: string; cost_usd: number | null; reserved_usd: number | null; elapsed_ms: number | null }> };
  listening: Array<{ mention_id: string; redacted_text: string; stage: "before" | "after";
    assignments: Array<{ topic_key: string; topic_name: string; topic_definition: string; volume_cohort: string; assigned: boolean }> }>;
  study: Array<{ mention_id: string; redacted_text: string; axes_status: "observed" | "not_asked_outside_cut";
    direction: typeof DIRECTIONS[number] | null; target: typeof TARGETS[number] | null; use: typeof USES[number] | null; alternative_inverted?: boolean;
    in_cut: boolean; lexical_filter_match: boolean; base_voice_valid: boolean; review_flags: string[]; motive_key?: string; motive_volume_cohort?: string;
    motive_name?: string; motive_definition?: string; layer?: string; nearest_volume_cohort?: string;
    nearest_assigned_motive_key?: string;
    native_nearest_candidate_set?: Array<{ motive_key: string; volume_cohort: string; name: string; definition: string }> ;
    motive_memberships?: Array<{ motive_key: string; volume_cohort: string; name: string; definition: string; layer: string; probability?: number; assigned?: boolean }>;
    nearest_motives?: Array<{ motive_key: string; volume_cohort: string; name: string; definition: string }> }>;
};

type CaseV1 = { blind_id: string; text: string; prompt: string; context?: string; options?: Array<{ key: string; text: string }> };
type PacketV1 = { contract_version: "r16-blind-packet-v1"; packet_ref: string; cases: CaseV1[] };
type KeyRow = { blind_id: string; mention_id: string; sample_code: string; stage?: string; topic_key?: string; answer: unknown };
type StratumCount = { quota: number; available: number; selected: number; shortfall: number };
type KeyV1 = { contract_version: "r16-blind-custody-key-v1"; seed_fingerprint: string; rows: KeyRow[];
  custody_manifest: { source_digest: string; study_provenance: BlindSnapshotV1["study_provenance"];
    strata: Array<{ sample_code: string; packet_ref: string } & StratumCount>;
    axis_coverage: Array<{ code: string; ref: string; packet_ref: string; required: number; selected: number; shortfall: number }> };
  layer_agreement: BlindSnapshotV1["layer_agreement"] };

export function validateSnapshotV1(value: unknown): BlindSnapshotV1 {
  if (!value || typeof value !== "object") throw new Error("blind_snapshot_invalid");
  const s = value as BlindSnapshotV1;
  const fail = () => { throw new Error("blind_snapshot_invalid"); };
  if (s.contract_version !== "r16-blind-snapshot-v1" || !Number.isFinite(Date.parse(s.exported_at))
    || !s.source || typeof s.source.export_contract !== "string" || !s.source.export_contract.trim() || !HASH_RE.test(s.source.export_digest)
    || !s.study_provenance || !HASH_RE.test(s.study_provenance.listening_before_digest) || !HASH_RE.test(s.study_provenance.listening_after_digest)
    || s.study_provenance.study_contract_version !== "signal-study-v1" || s.study_provenance.methodology_template_version !== "r16-v1"
    || !/^sha256:[a-f0-9]{64}$/u.test(s.study_provenance.methodology_template_digest)
    || !s.study_guidance || typeof s.study_guidance.subject_context !== "string" || !s.study_guidance.subject_context.trim()
    || !validOptions(s.study_guidance.direction_options, DIRECTIONS) || !validOptions(s.study_guidance.target_options, TARGETS)
    || !validOptions(s.study_guidance.use_options, USES) || !Array.isArray(s.study_guidance.layer_diagnostics)
    || s.study_guidance.layer_diagnostics.length !== 4 || new Set(s.study_guidance.layer_diagnostics.map(d => d?.key)).size !== 4
    || new Set(s.study_guidance.layer_diagnostics.map(d => d?.layer)).size !== 4
    || s.study_guidance.layer_diagnostics.some(d => !d || !d.key || typeof d.question !== "string" || !d.question.trim()
      || typeof d.definition !== "string" || !d.definition.trim()
      || !["psychological", "personal", "social", "cultural"].includes(d.layer))
    || (s.layer_agreement !== null && s.layer_agreement !== undefined && !validLayerAgreement(s.layer_agreement))
    || !s.receipts || !["complete", "incomplete"].includes(s.receipts.status)
    || s.receipts.cost_scope !== "native_provider_ledgers"
    || (s.receipts.total_cost_usd !== null && !finiteNonNegative(s.receipts.total_cost_usd))
    || (s.receipts.total_reserved_usd !== null && !finiteNonNegative(s.receipts.total_reserved_usd))
    || (s.receipts.total_elapsed_ms !== null && !finiteNonNegative(s.receipts.total_elapsed_ms))
    || !["wall_span", "unknown"].includes(s.receipts.timing_scope)
    || !Array.isArray(s.receipts.stages) || !s.receipts.stages.length || s.receipts.stages.some(x => !x || typeof x.stage !== "string" || !x.stage.trim()
      || (x.cost_usd !== null && !finiteNonNegative(x.cost_usd)) || (x.reserved_usd !== null && !finiteNonNegative(x.reserved_usd))
      || (x.elapsed_ms !== null && !finiteNonNegative(x.elapsed_ms)))
    || !Array.isArray(s.listening) || !Array.isArray(s.study)) fail();
  if (new Set(s.receipts.stages.map(x => x.stage)).size !== s.receipts.stages.length) fail();
  const allReceiptsMeasured = s.receipts.total_cost_usd !== null && s.receipts.total_reserved_usd === 0 && s.receipts.total_elapsed_ms !== null
    && s.receipts.timing_scope === "wall_span" && s.receipts.stages.every(x => x.cost_usd !== null && x.reserved_usd !== null && x.elapsed_ms !== null);
  if (s.receipts.status === "complete" && !allReceiptsMeasured || s.receipts.status === "incomplete" && allReceiptsMeasured
    || allReceiptsMeasured && (Math.abs(s.receipts.stages.reduce((n, x) => n + x.cost_usd!, 0) - s.receipts.total_cost_usd!) > .000001
      || Math.abs(s.receipts.stages.reduce((n, x) => n + x.reserved_usd!, 0) - s.receipts.total_reserved_usd!) > .000001)) fail();
  for (const row of [...s.listening, ...s.study]) {
    if (!row || typeof row.mention_id !== "string" || !row.mention_id || typeof row.redacted_text !== "string" || !row.redacted_text.trim()) fail();
  }
  for (const row of s.listening) {
    if (!(["before", "after"] as string[]).includes(row.stage) || !Array.isArray(row.assignments) || !row.assignments.length) fail();
    const keys = new Set<string>();
    for (const a of row.assignments) {
      if (!a || !a.topic_key || !a.topic_name || !a.topic_definition || !LISTENING_COHORTS_V1.includes(a.volume_cohort as typeof LISTENING_COHORTS_V1[number])
        || typeof a.assigned !== "boolean" || keys.has(a.topic_key)) fail();
      keys.add(a.topic_key);
    }
  }
  const listeningDefinitions = new Map<string, string>();
  for (const row of s.listening) for (const a of row.assignments) {
    const key = `${row.stage}\0${a.topic_key}`; const definition = `${a.topic_name}\0${a.topic_definition}\0${a.volume_cohort}`;
    const previous = listeningDefinitions.get(key);
    if (previous && previous !== definition) throw new Error("blind_snapshot_listening_definition_inconsistent");
    listeningDefinitions.set(key, definition);
  }
  const motiveDefinitions = new Map<string, { definitions: Set<string>; layers: Set<string> }>();
  const nearestDefinitions = new Map<string, string>();
  for (const row of s.study) {
    if (typeof row.in_cut !== "boolean" || typeof row.lexical_filter_match !== "boolean" || typeof row.base_voice_valid !== "boolean"
      || !Array.isArray(row.review_flags)) fail();
    if (row.axes_status === "observed") {
      if (!(DIRECTIONS as readonly string[]).includes(row.direction as string) || !(TARGETS as readonly string[]).includes(row.target as string)
        || !(USES as readonly string[]).includes(row.use as string) || !row.lexical_filter_match || !row.base_voice_valid) fail();
    } else if (row.axes_status === "not_asked_outside_cut") {
      if (row.direction !== null || row.target !== null || row.use !== null || row.in_cut || row.lexical_filter_match || !row.base_voice_valid
        || row.motive_key !== undefined || row.nearest_motives !== undefined) fail();
    } else fail();
    if (row.review_flags.some(f => !["false_none_candidate", "false_irony_candidate", "ambiguous_brand_candidate"].includes(f))) fail();
    if (row.motive_key !== undefined && (typeof row.motive_key !== "string" || !row.motive_key.trim())) fail();
    if (row.motive_name !== undefined && typeof row.motive_name !== "string") fail();
    if (row.motive_definition !== undefined && typeof row.motive_definition !== "string") fail();
    if (row.motive_memberships !== undefined && (!Array.isArray(row.motive_memberships) || new Set(row.motive_memberships.map(m => m?.motive_key)).size !== row.motive_memberships.length
      || row.motive_memberships.some(m => !m || !m.motive_key?.trim() || !m.name?.trim() || !m.definition?.trim()
        || !LISTENING_COHORTS_V1.includes(m.volume_cohort as typeof LISTENING_COHORTS_V1[number])
        || !["psychological", "personal", "social", "cultural", "unclear"].includes(m.layer)
        || m.probability !== undefined && (!finiteNonNegative(m.probability) || m.probability > 1)
        || m.assigned !== undefined && typeof m.assigned !== "boolean"
        || m.assigned !== undefined && m.probability === undefined
        || m.assigned !== undefined && m.assigned !== (m.probability! >= .7)))) fail();
    if (row.nearest_assigned_motive_key !== undefined && typeof row.nearest_assigned_motive_key !== "string") fail();
    if (row.alternative_inverted !== undefined && typeof row.alternative_inverted !== "boolean") fail();
    if (row.native_nearest_candidate_set !== undefined && (!Array.isArray(row.native_nearest_candidate_set)
      || new Set(row.native_nearest_candidate_set.map(m => m?.motive_key)).size !== row.native_nearest_candidate_set.length
      || row.native_nearest_candidate_set.length !== 4
      || row.native_nearest_candidate_set.some(m => !m?.motive_key?.trim() || !m.name?.trim() || !m.definition?.trim()
        || !LISTENING_COHORTS_V1.includes(m.volume_cohort as typeof LISTENING_COHORTS_V1[number])
        || !(row.motive_memberships ?? []).some(assignment => assignment.motive_key === m.motive_key
          && assignment.probability !== undefined && assignment.assigned !== undefined)))) fail();
    if (row.nearest_motives !== undefined && !Array.isArray(row.nearest_motives)) fail();
    if (row.motive_volume_cohort !== undefined && !LISTENING_COHORTS_V1.includes(row.motive_volume_cohort as typeof LISTENING_COHORTS_V1[number])) fail();
    if (row.layer !== undefined && !["psychological", "personal", "social", "cultural", "unclear"].includes(row.layer)) fail();
    if (row.motive_key) {
      const set = motiveDefinitions.get(row.motive_key) ?? { definitions: new Set<string>(), layers: new Set<string>() };
      if (row.motive_name && row.motive_definition) set.definitions.add(`${row.motive_name}\0${row.motive_definition}`);
      if (row.layer) set.layers.add(row.layer);
      motiveDefinitions.set(row.motive_key, set);
    }
    for (const membership of row.motive_memberships ?? []) {
      const set = motiveDefinitions.get(membership.motive_key) ?? { definitions: new Set<string>(), layers: new Set<string>() };
      set.definitions.add(`${membership.name}\0${membership.definition}`); set.layers.add(membership.layer);
      motiveDefinitions.set(membership.motive_key, set);
    }
    for (const candidate of row.nearest_motives ?? []) if (candidate?.motive_key && candidate.name && candidate.definition) {
      const signature = `${candidate.name}\0${candidate.definition}\0${candidate.volume_cohort}`;
      const previous = nearestDefinitions.get(candidate.motive_key);
      if (previous && previous !== signature) throw new Error("blind_snapshot_nearest_motive_definition_inconsistent");
      nearestDefinitions.set(candidate.motive_key, signature);
    }
  }
  for (const values of motiveDefinitions.values()) {
    if (values.definitions.size > 1) throw new Error("blind_snapshot_motive_definition_inconsistent");
    if (values.layers.size > 1) throw new Error("blind_snapshot_motive_layer_inconsistent");
  }
  if (new Set(s.listening.map(r => `${r.mention_id}\0${r.stage}`)).size !== s.listening.length) throw new Error("blind_snapshot_duplicate_listening_identity");
  if (new Set(s.study.map(r => r.mention_id)).size !== s.study.length) throw new Error("blind_snapshot_duplicate_study_identity");
  return s;
}

function validOptions(options: Array<{ key: string; definition: string }>, keys: readonly string[]): boolean {
  return Array.isArray(options) && options.length === keys.length && new Set(options.map(x => x?.key)).size === keys.length
    && keys.every(key => options.some(x => x?.key === key && typeof x.definition === "string" && x.definition.trim()));
}
function validLayerAgreement(value: NonNullable<BlindSnapshotV1["layer_agreement"]>): boolean {
  if (!value || !Number.isSafeInteger(value.eligible_count) || value.eligible_count < 0
    || !Number.isSafeInteger(value.pass_a_count) || value.pass_a_count < 0 || value.pass_a_count > value.eligible_count
    || !Number.isSafeInteger(value.pass_b_count) || value.pass_b_count < 0 || value.pass_b_count > value.eligible_count
    || (value.pass_a_count === 0 ? value.pass_a_digest !== null : !HASH_RE.test(value.pass_a_digest ?? ""))
    || (value.pass_b_count === 0 ? value.pass_b_digest !== null : !HASH_RE.test(value.pass_b_digest ?? ""))
    || !Number.isSafeInteger(value.denominator)
    || value.denominator < 0 || value.denominator > value.eligible_count || !Number.isFinite(value.coverage) || value.coverage < 0 || value.coverage > 1
    || value.denominator > Math.min(value.pass_a_count, value.pass_b_count)
    || !agreement(value.observed_agreement) || !agreement(value.expected_agreement)
    || !["complete", "not_estimable"].includes(value.estimation_status)
    || ![null, "no_passes", "incomplete_coverage", "expected_agreement_one"].includes(value.not_estimable_reason)
    || !["stable", "recode_boundary_once", "unstable_report", "not_estimable"].includes(value.action)
    || !Number.isSafeInteger(value.boundary_recoded_count) || value.boundary_recoded_count < 0 || value.boundary_recoded_count > value.denominator
    || !["not_measured", "insufficient_data", "not_estimable", "below_threshold", "acceptable"].includes(value.status)) return false;
  if (Math.abs(value.coverage - (value.eligible_count ? value.denominator / value.eligible_count : 0)) > .000001) return false;
  if (value.kappa !== null && (!Number.isFinite(value.kappa) || value.kappa < -1 || value.kappa > 1)) return false;
  if (value.status === "not_measured") return value.kappa === null && value.denominator === 0
    && value.pass_a_count === 0 && value.pass_b_count === 0 && value.observed_agreement === null && value.expected_agreement === null
    && value.estimation_status === "not_estimable" && value.not_estimable_reason === "no_passes" && value.action === "not_estimable";
  if (value.status === "insufficient_data") return value.kappa === null && value.denominator < value.eligible_count
    && (value.pass_a_count > 0 || value.pass_b_count > 0) && value.observed_agreement === null && value.expected_agreement === null
    && value.estimation_status === "not_estimable" && value.not_estimable_reason === "incomplete_coverage";
  const fullCoverage = value.eligible_count > 0 && value.pass_a_count === value.eligible_count && value.pass_b_count === value.eligible_count
    && value.denominator === value.eligible_count && value.coverage === 1;
  if (value.status === "not_estimable") return fullCoverage && value.kappa === null && value.observed_agreement === 1
    && value.expected_agreement === 1 && value.estimation_status === "not_estimable"
    && value.not_estimable_reason === "expected_agreement_one" && value.action !== "stable";
  if (!fullCoverage || value.kappa === null || value.observed_agreement === null || value.expected_agreement === null
    || value.estimation_status !== "complete" || value.not_estimable_reason !== null || value.expected_agreement >= 1) return false;
  const computed = (value.observed_agreement - value.expected_agreement) / (1 - value.expected_agreement);
  if (Math.abs(computed - value.kappa) > .000001) return false;
  if (value.status === "acceptable") return value.kappa >= .8;
  if (value.status === "below_threshold") return value.kappa < .8;
  return false;
}

function agreement(value: number | null): boolean { return value === null || Number.isFinite(value) && value >= 0 && value <= 1; }

function finiteNonNegative(n: number): boolean { return Number.isFinite(n) && n >= 0; }
function hash(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function rank(seed: string, code: string, id: string): string { return createHmac("sha256", seed).update(`${code}\0${id}`).digest("hex"); }
function choose<T>(rows: T[], count: number, seed: string, code: string, id: (row: T) => string): T[] {
  return [...rows].sort((a, b) => rank(seed, code, id(a)).localeCompare(rank(seed, code, id(b)))).slice(0, count);
}
function opaqueId(seed: string, code: string, mentionId: string, serial?: string): string {
  return createHmac("sha256", seed).update(`case\0${code}\0${mentionId}\0${serial ?? ""}`).digest("hex").slice(0, 24);
}
function caseRow(seed: string, code: string, mentionId: string, text: string, prompt: string, answer: unknown, context?: string,
  options?: Array<{ key: string; text: string }>, serial?: string) {
  const blind_id = opaqueId(seed, code, mentionId, serial);
  return { packet: { blind_id, text, prompt, ...(context ? { context } : {}), ...(options ? { options } : {}) } as CaseV1,
    key: { blind_id, mention_id: mentionId, sample_code: code, answer } as KeyRow };
}

/** A deterministic, label-blind sampling plan. The caller writes snapshots and keys only into private .data. */
export function buildBlindPackageV1(snapshotValue: unknown, seed: string) {
  if (!seed || Buffer.byteLength(seed) < 32) throw new Error("blind_seed_too_short");
  const s = validateSnapshotV1(snapshotValue);
  const packets: PacketV1[] = [];
  const keyRows: KeyRow[] = [];
  const usedIdentities = new Set<string>();
  const census: Record<string, StratumCount> = {};
  const publicRefs = new Map<string, string>();
  const add = (code: string, candidates: Array<{ id: string; text: string; answer: unknown; prompt: string; context?: string;
    options?: Array<{ key: string; text: string }> }>, quota: number, useAll = false, populationAvailable?: number) => {
    const ordered = [...candidates].sort((a, b) => rank(seed, `${code}:dedupe`, `${a.id}\0${JSON.stringify(a.answer)}`)
      .localeCompare(rank(seed, `${code}:dedupe`, `${b.id}\0${JSON.stringify(b.answer)}`)));
    const ids = new Set<string>();
    const unique = ordered.filter(c => !usedIdentities.has(c.id) && !ids.has(c.id) && Boolean(ids.add(c.id)));
    const selected = useAll ? unique : choose(unique, quota, seed, code, c => c.id);
    census[code] = { quota, available: populationAvailable ?? unique.length, selected: selected.length, shortfall: Math.max(0, quota - selected.length) };
    const packetRef = createHmac("sha256", seed).update(`manifest-stratum\0${code}`).digest("hex").slice(0, 12);
    publicRefs.set(code, packetRef);
    const rows = selected.map(c => caseRow(seed, code, c.id, c.text, c.prompt, c.answer, c.context, c.options));
    const packet = rows.map(r => r.packet).sort((a, b) => rank(seed, `${code}:order`, a.blind_id).localeCompare(rank(seed, `${code}:order`, b.blind_id)));
    for (const row of selected) usedIdentities.add(row.id);
    packets.push({ contract_version: "r16-blind-packet-v1", packet_ref: packetRef, cases: packet });
    keyRows.push(...rows.map(r => ({ ...r.key, ...(code.startsWith("L") ? { stage: code.includes("A") ? "after" : "before" } : {}) })));
  };

  for (const stage of ["before", "after"] as const) for (const cohort of LISTENING_COHORTS_V1) {
    const code = `L${stage === "before" ? "B" : "A"}-${cohort}`;
    const candidates = s.listening.filter(r => r.stage === stage).flatMap(r => r.assignments.filter(a => a.volume_cohort === cohort)
      .map(a => ({ id: r.mention_id, text: r.redacted_text, prompt: `Does this mention fit the topic “${a.topic_name}”? ${a.topic_definition}`,
        context: `Assess whether the mention belongs to the described topic.`, answer: { topic_key: a.topic_key, assigned: a.assigned, cohort } })));
    add(code, candidates, 50);
  }

  const t = s.study;
  const axisSelected: typeof t = [];
  const axisIds = new Set<string>();
  const axisCoverage: Array<{ code: string; required: number; selected: number; shortfall: number }> = [];
  const takeAxis = (code: string, rows: typeof t, required: number, trackCoverage = true) => {
    const eligible = rows.filter(r => !usedIdentities.has(r.mention_id) && !axisIds.has(r.mention_id));
    const chosen = choose(eligible, required, seed, `axes:${code}`, r => r.mention_id);
    for (const row of chosen) { axisSelected.push(row); axisIds.add(row.mention_id); }
    if (trackCoverage) axisCoverage.push({ code, required, selected: chosen.length, shortfall: Math.max(0, required - chosen.length) });
  };
  takeAxis("mixed", t.filter(r => r.direction === "mixed"), 50);
  takeAxis("false_irony", t.filter(r => r.review_flags.includes("false_irony_candidate")), 30);
  takeAxis("ambiguous_brand", t.filter(r => r.review_flags.includes("ambiguous_brand_candidate")), 30);
  for (const target of TARGETS) {
    const already = axisSelected.filter(r => r.target === target).length;
    takeAxis(`target_${target}`, t.filter(r => r.target === target), Math.max(0, 40 - already));
    const coverage = axisCoverage.at(-1)!;
    coverage.required = 40; coverage.selected += already; coverage.shortfall = Math.max(0, 40 - coverage.selected);
  }
  takeAxis("false_none_inside", t.filter(r => r.direction === "none" && r.in_cut && r.review_flags.includes("false_none_candidate")), 30);
  takeAxis("axes_total", t.filter(r => r.axes_status === "observed" && r.direction !== "none"), Math.max(0, 200 - axisSelected.length), false);
  const guidance = s.study_guidance;
  const axisContext = [guidance.subject_context,
    `Direction options: ${guidance.direction_options.map(o => `${o.key}: ${o.definition}`).join("; ")}`,
    `Target options: ${guidance.target_options.map(o => `${o.key}: ${o.definition}`).join("; ")}`,
    `Use options: ${guidance.use_options.map(o => `${o.key}: ${o.definition}`).join("; ")}`].join("\n");
  const axisCases = axisSelected.map(r => ({ id: r.mention_id, text: r.redacted_text,
    prompt: "Independently code all three axes for this mention: direction, target, and use, using the definitions below.", context: axisContext,
    answer: { axes_status: r.axes_status, candidate_source: "native_observed_axes", direction: r.direction, target: r.target, use: r.use,
      in_cut: r.in_cut, review_flags: r.review_flags } }));
  const axisPopulation = new Set(t.filter(r => r.axes_status === "observed" && !usedIdentities.has(r.mention_id)).map(r => r.mention_id)).size;
  add("TAX", axisCases, 200, true, axisPopulation);

  const outsideLexical = t.filter(r => r.axes_status === "not_asked_outside_cut" && !r.in_cut && !r.lexical_filter_match && r.base_voice_valid);
  const outsidePrompt = "Independently code direction, target, and use for this mention, using the configured definitions below.";
  add("TAX-OUTSIDE", outsideLexical.map(r => ({ id: r.mention_id, text: r.redacted_text, prompt: outsidePrompt, context: axisContext,
    answer: { axes_status: r.axes_status, candidate_source: "outside_lexical_cut", direction: r.direction, target: r.target,
      use: r.use, review_flags: r.review_flags } })), 30);
  axisCoverage.push({ code: "outside_lexical_missing_axes", required: 30, selected: Math.min(30, outsideLexical.length),
    shortfall: Math.max(0, 30 - outsideLexical.length) });

  const motiveCounts = new Map<string, number>();
  for (const row of t) {
    const keys = new Set([...(row.motive_memberships ?? []).filter(m => m.assigned ?? true).map(m => m.motive_key), ...(row.motive_key ? [row.motive_key] : [])]);
    for (const key of keys) motiveCounts.set(key, (motiveCounts.get(key) ?? 0) + 1);
  }
  const topMotives = [...motiveCounts.keys()].sort((a, b) => motiveCounts.get(b)! - motiveCounts.get(a)!
    || hash(`${seed}:motive-order:${a}`).localeCompare(hash(`${seed}:motive-order:${b}`))).slice(0, 20);
  for (let i = 0; i < 20; i++) {
    const motive = topMotives[i]; const code = `M${String(i + 1).padStart(2, "0")}`;
    const rows = motive ? t.filter(r => r.direction !== "none" && (r.motive_memberships?.some(m => m.motive_key === motive && m.layer && (m.assigned ?? true))
      || r.motive_key === motive && r.layer && r.motive_name && r.motive_definition)) : [];
    const detail = (r: typeof t[number]) => r.motive_memberships?.find(m => m.motive_key === motive) ?? (r.motive_key === motive && r.motive_name
      && r.motive_definition && r.motive_volume_cohort && r.layer ? { motive_key: motive!, name: r.motive_name, definition: r.motive_definition,
        volume_cohort: r.motive_volume_cohort, layer: r.layer } : undefined);
    const firstDetail = rows.map(detail).find(Boolean);
    const layerContext = [`Motive: ${firstDetail?.name ?? ""}. ${firstDetail?.definition ?? ""}`,
      `Diagnostic layers: ${guidance.layer_diagnostics.map(d => `${d.layer}: ${d.question} ${d.definition}`).join("; ")}`,
      "Select one layer only when supported by the text; otherwise select unclear."].join("\n");
    add(code, rows.map(r => ({ id: r.mention_id, text: r.redacted_text,
      prompt: "Does this mention belong to the described motive, and which diagnostic layer is supported by its text?",
      context: layerContext, answer: { motive_key: motive, layer: detail(r)?.layer, direction: r.direction } })), 10);
  }
  for (const cohort of LISTENING_COHORTS_V1) {
    const code = `N-${cohort}`;
    const nativeRows = t.filter(r => r.direction !== "none" && r.use === "literal"
      && r.native_nearest_candidate_set?.some(candidate => candidate.volume_cohort === cohort)
      && r.native_nearest_candidate_set.every(candidate => (r.motive_memberships ?? []).some(m => m.motive_key === candidate.motive_key
        && m.probability !== undefined && m.assigned !== undefined)));
    if (nativeRows.length) {
      const candidates = nativeRows.map(row => {
        const set = row.native_nearest_candidate_set!;
        const target = choose(set.filter(candidate => candidate.volume_cohort === cohort), 1, seed,
          `${code}:candidate-target`, candidate => candidate.motive_key)[0]!;
        const shuffled = [...set].sort((a, b) => rank(seed, `${code}:options`, `${row.mention_id}:${a.motive_key}`)
          .localeCompare(rank(seed, `${code}:options`, `${row.mention_id}:${b.motive_key}`)));
        const options = shuffled.map((m, i) => ({ key: String.fromCharCode(65 + i), text: `${m.name}: ${m.definition}` }));
        const option_map = Object.fromEntries(shuffled.map((m, i) => [String.fromCharCode(65 + i), m.motive_key]));
        const assignments = Object.fromEntries(set.map(m => [m.motive_key, (row.motive_memberships ?? []).find(a => a.motive_key === m.motive_key)!.assigned!]));
        const probabilities = Object.fromEntries(set.map(m => [m.motive_key, (row.motive_memberships ?? []).find(a => a.motive_key === m.motive_key)!.probability!]));
        return { id: row.mention_id, text: row.redacted_text,
          prompt: "For each motive option, independently mark YES if this mention belongs to that motive and NO otherwise. Motives may overlap.",
          context: "Candidate definitions are shown in shuffled order. Assess each definition independently.", options,
          answer: { source_candidate_set: set.map(m => m.motive_key), stratum_candidate_key: target.motive_key,
            candidate_memberships: assignments, candidate_probabilities: probabilities, option_map, cohort } };
      });
      add(code, candidates, 20);
      continue;
    }
    // Compatibility for older snapshots that contain a real native rank and one assigned key.
    const legacyCandidates = t.filter(r => r.direction !== "none" && r.nearest_volume_cohort === cohort && r.nearest_assigned_motive_key
      && r.nearest_motives?.length === 4 && new Set(r.nearest_motives.map(m => m.motive_key)).size === 4
      && r.nearest_motives.every(m => m.motive_key && m.name?.trim() && m.definition?.trim()
        && LISTENING_COHORTS_V1.includes(m.volume_cohort as typeof LISTENING_COHORTS_V1[number]))
      && r.nearest_motives.some(m => m.motive_key === r.nearest_assigned_motive_key)).map(r => {
        const ranked = r.nearest_motives!;
        const shuffled = [...ranked].sort((a, b) => rank(seed, `${code}:options`, `${r.mention_id}:${a.motive_key}`)
          .localeCompare(rank(seed, `${code}:options`, `${r.mention_id}:${b.motive_key}`)));
        const options = shuffled.map((m, i) => ({ key: String.fromCharCode(65 + i), text: `${m.name}: ${m.definition}` }));
        const option_map = Object.fromEntries(shuffled.map((m, i) => [String.fromCharCode(65 + i), m.motive_key]));
        return { id: r.mention_id, text: r.redacted_text, prompt: "Which option best matches the force expressed in this mention? Choose A, B, C, or D.",
          options, answer: { system_assigned_motive_key: r.nearest_assigned_motive_key, ranked_candidate_keys: ranked.map(m => m.motive_key), option_map, cohort } };
      });
    add(code, legacyCandidates, 20);
  }


  // Every selected source identity appears in one packet only, including across listening stages.
  const privateStrata = Object.entries(census).map(([sample_code, counts]) => ({ sample_code, packet_ref: publicRefs.get(sample_code)!, ...counts }));
  const blindStrata = privateStrata.map(item => ({ packet_ref: item.packet_ref, quota: item.quota, available: item.available,
    selected: item.selected, shortfall: item.shortfall }))
    .sort((a, b) => rank(seed, "manifest-visible-strata", a.packet_ref).localeCompare(rank(seed, "manifest-visible-strata", b.packet_ref)));
  const privateAxisCoverage = axisCoverage.map(item => ({ ...item, ref: createHmac("sha256", seed).update(`axis-coverage\0${item.code}`).digest("hex").slice(0, 12),
    packet_ref: item.code === "outside_lexical_missing_axes" ? publicRefs.get("TAX-OUTSIDE")! : publicRefs.get("TAX")! }));
  const visibleAxisCoverage = privateAxisCoverage.map(({ ref, packet_ref, required, selected, shortfall }) => ({ ref, packet_ref, required, selected, shortfall }))
    .sort((a, b) => rank(seed, "manifest-visible-axis-coverage", a.ref).localeCompare(rank(seed, "manifest-visible-axis-coverage", b.ref)));
  const totalShortfall = Object.values(census).reduce((n, x) => n + x.shortfall, 0) + axisCoverage.reduce((n, x) => n + x.shortfall, 0);
  const missingAgreementEvidence = !s.layer_agreement || ["not_measured", "insufficient_data"].includes(s.layer_agreement.status)
    || s.receipts.status !== "complete";
  const completeness = totalShortfall ? "census_with_shortfalls" : missingAgreementEvidence ? "evidence_incomplete" : "complete";
  const manifest = { contract_version: "r16-blind-manifest-v1", snapshot_contract: s.contract_version,
    source_digest: s.source.export_digest, created_at: s.exported_at, seed_fingerprint: hash(seed),
    strata: blindStrata, axis_coverage: visibleAxisCoverage,
    completeness, incompleteness_reasons: missingAgreementEvidence ? ["required_metric_receipt_missing"] : [],
    shortfall_count: totalShortfall, receipts: s.receipts, packet_count: packets.length,
    case_count: packets.reduce((n, p) => n + p.cases.length, 0), answer_key_separate: true };
  const key: KeyV1 = { contract_version: "r16-blind-custody-key-v1", seed_fingerprint: hash(seed), rows: keyRows,
    custody_manifest: { source_digest: s.source.export_digest, study_provenance: s.study_provenance,
      strata: privateStrata.sort((a, b) => a.sample_code.localeCompare(b.sample_code)), axis_coverage: privateAxisCoverage },
    layer_agreement: s.layer_agreement };
  packets.sort((a, b) => rank(seed, "packet-file-order", a.packet_ref).localeCompare(rank(seed, "packet-file-order", b.packet_ref)));
  return { packets, manifest, key };
}

export function validatePacketV1(packet: unknown): asserts packet is PacketV1 {
  const p = packet as PacketV1;
  if (!p || p.contract_version !== "r16-blind-packet-v1" || !/^[a-f0-9]{12}$/u.test(p.packet_ref) || !Array.isArray(p.cases)) throw new Error("blind_packet_invalid");
  const ids = new Set<string>();
  for (const c of p.cases) {
    if (!/^[a-f0-9]{24}$/u.test(c.blind_id) || ids.has(c.blind_id) || typeof c.text !== "string" || !c.text.trim()
      || typeof c.prompt !== "string" || !c.prompt.trim() || Object.keys(c).some(k => OMIT_KEYS.has(k))
      || (c.options !== undefined && (c.options.length !== 4 || new Set(c.options.map(o => o.key)).size !== 4
        || !["A", "B", "C", "D"].every(key => c.options!.some(o => o.key === key && o.text.trim()))))) throw new Error("blind_packet_invalid");
    ids.add(c.blind_id);
  }
}

export async function writeBlindPackageV1(args: { snapshotPath: string; seedPath: string; packageDir: string; custodyKeyPath: string }) {
  const privateRoot = resolve(".data/piloto-masivo/r16");
  const snapshotPath = resolve(args.snapshotPath), seedPath = resolve(args.seedPath), packageDir = resolve(args.packageDir), keyPath = resolve(args.custodyKeyPath);
  for (const path of [snapshotPath, seedPath, packageDir, keyPath]) if (path !== privateRoot && !path.startsWith(`${privateRoot}${sep}`))
    throw new Error("blind_paths_must_be_private_r16_data");
  if (packageDir === keyPath || keyPath.startsWith(`${packageDir}${sep}`) || packageDir.startsWith(`${keyPath}${sep}`)) throw new Error("blind_key_must_be_separate");
  for (const input of [snapshotPath, seedPath]) await rejectSymlinkComponents(input);
  for (const output of [packageDir, keyPath]) await rejectSymlinkComponents(dirname(output));
  for (const input of [snapshotPath, seedPath]) if (((await stat(input)).mode & 0o077) !== 0) throw new Error("blind_input_permissions_too_open");
  try { await lstat(packageDir); throw new Error("blind_output_exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { await lstat(keyPath); throw new Error("blind_key_exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const raw = JSON.parse(await readFile(snapshotPath, "utf8"));
  const seed = (await readFile(seedPath, "utf8")).trim();
  const built = buildBlindPackageV1(raw, seed);
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(keyPath), 0o700);
  await mkdir(dirname(packageDir), { recursive: true, mode: 0o700 });
  const lockPath = `${packageDir}.lock`;
  await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: "wx" });
  try { await lstat(packageDir); throw new Error("blind_output_exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { await rm(lockPath, { force: true }); throw error; } }
  let stagingDir = "";
  const keyTemp = `${keyPath}.${process.pid}.${randomUUID()}.tmp`;
  let keyPublished = false; let packagePublished = false;
  try {
  stagingDir = await mkdtemp(resolve(dirname(packageDir), ".blind-package-")); await chmod(stagingDir, 0o700);
  const filenames: string[] = [];
  for (let i = 0; i < built.packets.length; i++) {
    const packet = built.packets[i]; validatePacketV1(packet);
    const name = `packet-${String(i + 1).padStart(2, "0")}.json`;
    const path = resolve(stagingDir, `${name}.tmp`); await writeFile(path, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(path, resolve(stagingDir, name)); filenames.push(name);
  }
  const packetDigests = await Promise.all(filenames.map(async name => {
    const packet = JSON.parse(await readFile(resolve(stagingDir, name), "utf8")) as PacketV1;
    return { name, sha256: hash(await readFile(resolve(stagingDir, name), "utf8")), packet_ref: packet.packet_ref };
  }));
  const manifestName = "manifest.json";
  const manifestTemp = resolve(stagingDir, `${manifestName}.tmp`);
  await writeFile(manifestTemp, `${JSON.stringify({ ...built.manifest, packet_files: packetDigests }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(manifestTemp, resolve(stagingDir, manifestName)); filenames.push(manifestName);
  const sums = (await Promise.all(filenames.sort().map(async name => `${hash(await readFile(resolve(stagingDir, name), "utf8"))}  ${name}`))).join("\n") + "\n";
  const sumsTemp = resolve(stagingDir, "SHA256SUMS.tmp");
  await writeFile(sumsTemp, sums, { mode: 0o600, flag: "wx" }); await rename(sumsTemp, resolve(stagingDir, "SHA256SUMS"));
  await writeFile(keyTemp, `${JSON.stringify(built.key, null, 2)}\n`, { mode: 0o600, flag: "wx" }); await chmod(keyTemp, 0o600);
  await link(keyTemp, keyPath); keyPublished = true;
  await rename(stagingDir, packageDir);
  packagePublished = true;
  await unlink(keyTemp);
  await unlink(lockPath);
  } catch (error) {
    if (keyPublished && !packagePublished) {
      try { const [tempInfo, keyInfo] = await Promise.all([stat(keyTemp), stat(keyPath)]); if (tempInfo.dev === keyInfo.dev && tempInfo.ino === keyInfo.ino) await unlink(keyPath); }
      catch { /* Leave any path we cannot prove is our own untouched. */ }
    }
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    await rm(keyTemp, { force: true });
    await rm(lockPath, { force: true });
    throw error;
  }
  return { packageDir, custodyKeyPath: keyPath, complete: built.manifest.completeness === "complete", shortfallCount: built.manifest.shortfall_count };
}

async function rejectSymlinkComponents(path: string): Promise<void> {
  const parts = resolve(path).split(sep).filter(Boolean); let at: string = sep;
  for (const part of parts) {
    at = resolve(at, part);
    try { const info = await lstat(at); if (info.isSymbolicLink()) throw new Error("blind_symlink_path_rejected"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
}

export async function verifyBlindPackageV1(packageDir: string): Promise<{ valid: boolean; files: number }> {
  const dir = resolve(packageDir); await rejectSymlinkComponents(dir);
  const sums = (await readFile(resolve(dir, "SHA256SUMS"), "utf8")).trim().split("\n");
  if (!sums.length || sums.some(line => !/^[a-f0-9]{64}  [a-z0-9-]+\.json$/u.test(line))) throw new Error("blind_checksums_invalid");
  let files = 0;
  const observed = new Map<string, string>();
  const observedPackets = new Map<string, PacketV1>();
  for (const line of sums) {
    const [expected, name] = line.split("  "); if (!expected || !name) throw new Error("blind_checksums_invalid"); const contents = await readFile(resolve(dir, name), "utf8");
    if ((await lstat(resolve(dir, name))).isSymbolicLink()) throw new Error("blind_symlink_path_rejected");
    if (hash(contents) !== expected) throw new Error("blind_checksum_mismatch");
    if (observed.has(name)) throw new Error("blind_checksums_duplicate_entry");
    const parsed = JSON.parse(contents); if (name.startsWith("packet-")) { validatePacketV1(parsed); observedPackets.set(name, parsed); }
    observed.set(name, expected); files++;
  }
  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
  const refs = new Set<string>();
  const strata = manifest.strata as Array<StratumCount & { packet_ref: string }>;
  const rows = Array.isArray(strata) ? strata : [];
  const axisCoverage = manifest.axis_coverage as Array<{ ref: string; packet_ref: string; required: number; selected: number; shortfall: number }>;
  const axisRows = Array.isArray(axisCoverage) ? axisCoverage : [];
  const expectedShortfall = rows.reduce((n, x) => n + x.shortfall, 0) + axisRows.reduce((n, x) => n + x.shortfall, 0);
  const names = new Set(await readdir(dir));
  const expectedNames = new Set([...observed.keys(), "SHA256SUMS"]);
  if ([...names].some(name => !expectedNames.has(name)) || [...expectedNames].some(name => !names.has(name))
    || !observed.has("manifest.json") || manifest.contract_version !== "r16-blind-manifest-v1"
    || !HASH_RE.test(manifest.source_digest) || !HASH_RE.test(manifest.seed_fingerprint)
    || !Number.isFinite(Date.parse(manifest.created_at)) || !Array.isArray(manifest.packet_files) || !rows.length || manifest.answer_key_separate !== true
    || rows.some(x => !/^[a-f0-9]{12}$/u.test(x.packet_ref) || !Number.isSafeInteger(x.quota) || x.quota < 1 || !Number.isSafeInteger(x.available) || x.available < 0
      || !Number.isSafeInteger(x.selected) || x.selected < 0 || x.selected > x.available
      || x.shortfall !== Math.max(0, x.quota - x.selected))
    || !axisRows.length || axisRows.some(x => !/^[a-f0-9]{12}$/u.test(x.ref) || !/^[a-f0-9]{12}$/u.test(x.packet_ref)
      || !rows.some(s => s.packet_ref === x.packet_ref) || !Number.isSafeInteger(x.required) || x.required < 0
      || !Number.isSafeInteger(x.selected) || x.selected < 0 || !Number.isSafeInteger(x.shortfall) || x.shortfall !== Math.max(0, x.required - x.selected))
    || !Array.isArray(manifest.incompleteness_reasons) || manifest.incompleteness_reasons.some((x: string) => x !== "required_metric_receipt_missing")
    || manifest.shortfall_count !== expectedShortfall
    || !["complete", "census_with_shortfalls", "evidence_incomplete"].includes(manifest.completeness)
    || (expectedShortfall > 0 && manifest.completeness !== "census_with_shortfalls")
    || (expectedShortfall === 0 && (!Array.isArray(manifest.incompleteness_reasons)
      || manifest.completeness !== (manifest.incompleteness_reasons.length ? "evidence_incomplete" : "complete")))
    || manifest.packet_files.some((file: { name: string; sha256: string; packet_ref: string }) => observed.get(file.name) !== file.sha256
      || !rows.some(x => x.packet_ref === file.packet_ref) || refs.has(file.packet_ref) || !refs.add(file.packet_ref)
      || observedPackets.get(file.name)?.packet_ref !== file.packet_ref)
    || manifest.packet_files.length !== [...observed.keys()].filter(k => k.startsWith("packet-")).length) throw new Error("blind_manifest_invalid");
  if (refs.size !== rows.length || new Set(rows.map(x => x.packet_ref)).size !== rows.length
    || new Set(axisRows.map(x => x.ref)).size !== axisRows.length || manifest.packet_count !== manifest.packet_files.length
    || manifest.case_count !== [...observedPackets.values()].reduce((n, packet) => n + packet.cases.length, 0)) throw new Error("blind_manifest_invalid");
  return { valid: true, files };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [, , command, ...argv] = process.argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) { const flag = argv[i], value = argv[i + 1]; if (!flag?.startsWith("--") || !value) throw new Error("blind_cli_usage"); flags[flag.slice(2)] = value; }
  if (command === "build" && flags.snapshot && flags.seed && flags.out && flags.key) {
    const result = await writeBlindPackageV1({ snapshotPath: flags.snapshot, seedPath: flags.seed, packageDir: flags.out, custodyKeyPath: flags.key });
    console.log(JSON.stringify(result)); if (!result.complete) process.exitCode = 2;
  } else if (command === "verify" && flags.package) console.log(JSON.stringify(await verifyBlindPackageV1(flags.package)));
  else throw new Error("usage: tsx scripts/r16/blind-package.ts build --snapshot <private.json> --seed <private-seed> --out <private-package-dir> --key <separate-private-key.json> | verify --package <private-package-dir>");
}
