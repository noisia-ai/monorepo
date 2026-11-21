import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as bufferConstants } from "node:buffer";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertBlindSnapshotStreamMatchesV1, buildBlindPackageV1, LISTENING_COHORTS_V1, validatePacketV1, validateSnapshotV1,
  verifyBlindPackageV1, writeBlindPackageFromExportedSnapshotV1, writeBlindPackageV1, type BlindSnapshotV1 } from "./blind-package.js";
import { streamJsonV1, writePrivateJsonFileV1 } from "./private-json-stream.js";

const seed = "synthetic-seed-for-r16-blind-package-tests-2026";
const digest = "a".repeat(64);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function syntheticSnapshot(): BlindSnapshotV1 {
  const listening = [] as Array<{ mention_id: string; redacted_text: string; stage: "before" | "after";
    assignments: Array<{ topic_key: string; topic_name: string; topic_definition: string; volume_cohort: string; assigned: boolean }> }>;
  for (const stage of ["before", "after"] as const) for (const cohort of LISTENING_COHORTS_V1) {
    for (let i = 0; i < 55; i++) listening.push({ mention_id: `listen-${stage}-${cohort}-${i}`, redacted_text: `synthetic mention ${stage} ${cohort} ${i}`,
      stage, assignments: [{ topic_key: `topic-${cohort}`, topic_name: `Synthetic topic ${cohort}`, topic_definition: "Synthetic definition", volume_cohort: cohort, assigned: i % 2 === 0 }] });
  }
  const study = [] as Array<{ mention_id: string; redacted_text: string; axes_status: "observed" | "not_asked_outside_cut";
    direction: "trigger" | "barrier" | "mixed" | "none" | null;
    target: "category" | "own_brand" | "competitor_brand" | "alternative" | null; use: "literal" | "figurative_or_ironic" | "other" | null;
    in_cut: boolean; lexical_filter_match: boolean; base_voice_valid: boolean; review_flags: string[]; motive_key?: string; motive_volume_cohort?: string; motive_name?: string; motive_definition?: string; nearest_volume_cohort?: string;
    nearest_assigned_motive_key?: string;
    layer?: string; nearest_motives?: Array<{ motive_key: string; volume_cohort: string; name: string; definition: string }>;
    native_nearest_candidate_set?: Array<{ motive_key: string; volume_cohort: string; name: string; definition: string }> }>;
  const add = (id: string, overrides: Partial<(typeof study)[number]> = {}) => study.push({ mention_id: id, redacted_text: `synthetic study mention ${id}`,
    axes_status: "observed", direction: "trigger", target: "category", use: "literal", in_cut: true, lexical_filter_match: true, base_voice_valid: true, review_flags: [], ...overrides });
  for (const dir of ["mixed", "barrier", "trigger"] as const) for (let i = 0; i < 80; i++) add(`axis-${dir}-${i}`, { direction: dir });
  for (const target of ["own_brand", "competitor_brand", "alternative"] as const) for (let i = 0; i < 50; i++) add(`target-${target}-${i}`, { target });
  for (let i = 0; i < 35; i++) add(`false-irony-${i}`, { review_flags: ["false_irony_candidate"] });
  for (let i = 0; i < 35; i++) add(`ambiguous-brand-${i}`, { review_flags: ["ambiguous_brand_candidate"] });
  for (let i = 0; i < 35; i++) add(`false-none-in-${i}`, { direction: "none", review_flags: ["false_none_candidate"] });
  for (let motive = 0; motive < 20; motive++) for (let i = 0; i < 25; i++) add(`motive-${motive}-${i}`, { motive_key: `m${motive}`, motive_name: `Motive ${motive}`,
    motive_definition: "Synthetic motive", motive_volume_cohort: LISTENING_COHORTS_V1[motive % 10], layer: "social",
    nearest_motives: LISTENING_COHORTS_V1.slice(0, 4).map((c, n) => ({ motive_key: `n${n}`, volume_cohort: c, name: `Candidate ${n}`, definition: "Synthetic candidate" })) });
  for (const cohort of LISTENING_COHORTS_V1) for (let i = 0; i < 25; i++) add(`nearest-${cohort}-${i}`, { nearest_volume_cohort: cohort,
    nearest_assigned_motive_key: "n0", nearest_motives:
    LISTENING_COHORTS_V1.slice(0, 4).map((c, n) => ({ motive_key: `n${n}`, volume_cohort: c, name: `Candidate ${n}`, definition: "Synthetic candidate" })) });
  for (let i = 0; i < 35; i++) add(`outside-lexical-${i}`, { axes_status: "not_asked_outside_cut", direction: null, target: null, use: null,
    in_cut: false, lexical_filter_match: false, base_voice_valid: true });
  return { contract_version: "r16-blind-snapshot-v1" as const, exported_at: "2026-11-14T12:00:00.000Z", source: { export_contract: "synthetic-v1", export_digest: digest },
    study_provenance: { listening_before_digest: digest, listening_after_digest: "b".repeat(64), study_contract_version: "signal-study-v1",
      methodology_template_version: "r16-v1", methodology_template_digest: `sha256:${"c".repeat(64)}` },
    study_guidance: { subject_context: "Synthetic subject context", direction_options: ["trigger", "barrier", "mixed", "none"].map(key => ({ key, definition: `Definition ${key}` })),
      target_options: ["category", "own_brand", "competitor_brand", "alternative"].map(key => ({ key, definition: `Definition ${key}` })),
      use_options: ["literal", "figurative_or_ironic", "other"].map(key => ({ key, definition: `Definition ${key}` })),
      layer_diagnostics: ["island", "money_time", "nobody_knows", "without_network"].map((key, i) => ({ key,
        layer: ["psychological", "personal", "social", "cultural"][i]!, question: `Question ${key}`, definition: `Definition ${key}` })) },
    layer_agreement: { eligible_count: 10, pass_a_count: 10, pass_a_digest: "d".repeat(64), pass_b_count: 10, pass_b_digest: "e".repeat(64),
      denominator: 10, coverage: 1, observed_agreement: .91, expected_agreement: .5, kappa: .82, estimation_status: "complete" as const,
      not_estimable_reason: null, action: "stable" as const, status: "acceptable" as const, boundary_recoded_count: 2 },
    receipts: { status: "complete" as const, cost_scope: "native_provider_ledgers" as const, total_cost_usd: 0, total_reserved_usd: 0,
      total_elapsed_ms: 0, timing_scope: "wall_span" as const,
      stages: [{ stage: "synthetic", cost_usd: 0, reserved_usd: 0, elapsed_ms: 0 }] }, listening,
    official_motive_census: Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, motive_key: `m${i}`, name: `Motive ${i}`,
      layer: "social", mentions: 100 - i, volume_cohort: LISTENING_COHORTS_V1[Math.min(9, Math.floor(i / 2))]! })), study };
}

type AxisOverlapKind = "false_irony" | "ambiguous_brand" | "false_none_inside";
function axisOverlapSnapshot(kind: AxisOverlapKind): BlindSnapshotV1 {
  const snapshot = syntheticSnapshot();
  // Keep unrelated official-motive, nearest and outside-cut populations intact.
  snapshot.study = snapshot.study.filter(row => row.motive_key || row.nearest_volume_cohort || row.axes_status === "not_asked_outside_cut");
  const add = (count: number, part: string, overrides: Partial<BlindSnapshotV1["study"][number]> = {}) => {
    for (let i = 0; i < count; i++) snapshot.study.push({ mention_id: `overlap-${kind}-${part}-${i}`,
      redacted_text: "Synthetic axis overlap example.", axes_status: "observed", direction: "trigger", target: "category", use: "literal",
      in_cut: true, lexical_filter_match: true, base_voice_valid: true, review_flags: [], ...overrides });
  };
  if (kind === "false_irony") {
    add(50, "mixed", { direction: "mixed", use: "figurative_or_ironic", review_flags: ["false_irony_candidate"] });
    add(40, "own", { target: "own_brand", review_flags: ["ambiguous_brand_candidate"] });
    add(40, "competitor", { target: "competitor_brand" });
    add(40, "alternative", { target: "alternative" });
    add(30, "none", { direction: "none", review_flags: ["false_none_candidate"] });
  } else if (kind === "ambiguous_brand") {
    add(50, "mixed", { direction: "mixed", review_flags: ["ambiguous_brand_candidate"] });
    add(30, "irony", { target: "own_brand", use: "figurative_or_ironic", review_flags: ["false_irony_candidate", "ambiguous_brand_candidate"] });
    add(10, "own", { target: "own_brand", review_flags: ["ambiguous_brand_candidate"] });
    add(40, "competitor", { target: "competitor_brand" });
    add(40, "alternative", { target: "alternative" });
    add(30, "none", { direction: "none", review_flags: ["false_none_candidate"] });
  } else {
    add(50, "mixed", { direction: "mixed" });
    add(30, "irony", { target: "competitor_brand", use: "figurative_or_ironic", review_flags: ["false_irony_candidate"] });
    add(30, "none", { direction: "none", target: "own_brand", review_flags: ["ambiguous_brand_candidate", "false_none_candidate"] });
    add(10, "own", { target: "own_brand" });
    add(10, "competitor", { target: "competitor_brand" });
    add(40, "alternative", { target: "alternative" });
    // The overlapping minima above cover170 distinct cases. Any30 eligible
    // filler cases may be sampled without exhausting another official packet:
    // each motive retains >=10 and each nearest cohort retains >=20 even if
    // the entire filler comes from that one population.
    for (let motive = 0; motive < 20; motive++) {
      const exemplar = snapshot.study.find(row => row.motive_key === `m${motive}`)!;
      for (let i = 0; i < 15; i++) snapshot.study.push({ ...exemplar, mention_id: `overlap-spare-motive-${motive}-${i}` });
    }
    for (const cohort of LISTENING_COHORTS_V1) {
      const exemplar = snapshot.study.find(row => row.nearest_volume_cohort === cohort)!;
      for (let i = 0; i < 25; i++) snapshot.study.push({ ...exemplar, mention_id: `overlap-spare-nearest-${cohort}-${i}` });
    }
  }
  return snapshot;
}
type AxisOverlapAnswer = { axes_status: string; direction: string; target: string; use: string; in_cut: boolean; review_flags: string[] };
function assertOverlapAxisSample(built: ReturnType<typeof buildBlindPackageV1>, expectedReady = true) {
  const rows = built.key.rows.filter(row => row.sample_code === "TAX");
  const answers = rows.map(row => row.answer as AxisOverlapAnswer);
  assert.ok(rows.length >= 200, "combined axes sample still has at least200 distinct cases");
  assert.equal(new Set(rows.map(row => row.mention_id)).size, rows.length);
  assert.equal(new Set(built.key.rows.map(row => row.mention_id)).size, built.key.rows.length, "overlap never repeats an identity across packets");
  assert.ok(answers.every(answer => answer.axes_status === "observed"));
  assert.ok(answers.filter(answer => answer.direction === "mixed").length >= 50);
  for (const target of ["category", "own_brand", "competitor_brand", "alternative"]) {
    assert.ok(answers.filter(answer => answer.target === target).length >= 40);
  }
  const stratum = built.key.custody_manifest.strata.find(row => row.sample_code === "TAX")!;
  assert.equal(stratum.quota, 200); assert.equal(stratum.selected, rows.length);
  const visible = built.packets.find(packet => packet.packet_ref === stratum.packet_ref)!;
  assert.equal(visible.cases.length, rows.length);
  for (const packet of built.packets) validatePacketV1(packet);
  assert.doesNotMatch(JSON.stringify(visible), /"(?:mention_id|sample_code|answer|direction|target|use|review_flags)":/u);
  if (expectedReady) {
    assert.equal(built.manifest.readiness, "ready");
    assert.deepEqual(built.manifest.readiness_reasons, []);
    assert.equal(built.manifest.shortfall_count, 0);
    assert.ok(built.key.custody_manifest.axis_coverage.every(row => row.selected >= row.required && row.shortfall === 0));
    assert.ok(answers.filter(answer => answer.review_flags.includes("false_irony_candidate")).length >= 30);
    assert.ok(answers.filter(answer => answer.review_flags.includes("ambiguous_brand_candidate")).length >= 30);
    assert.ok(answers.filter(answer => answer.direction === "none" && answer.in_cut && answer.review_flags.includes("false_none_candidate")).length >= 30);
  }
  return answers;
}

test("axis coverage reuses mixed cases that also meet the false-irony minimum", () => {
  const built = buildBlindPackageV1(axisOverlapSnapshot("false_irony"), seed);
  const answers = assertOverlapAxisSample(built);
  assert.equal(answers.filter(answer => answer.review_flags.includes("false_irony_candidate")).length, 50);
  const coverage = built.key.custody_manifest.axis_coverage.find(row => row.code === "false_irony")!;
  assert.deepEqual([coverage.required, coverage.selected, coverage.shortfall], [30, 50, 0]);
});

test("axis coverage counts ambiguous brands already selected for mixed and irony without demanding thirty new identities", () => {
  const built = buildBlindPackageV1(axisOverlapSnapshot("ambiguous_brand"), seed);
  const answers = assertOverlapAxisSample(built);
  assert.equal(answers.filter(answer => answer.review_flags.includes("ambiguous_brand_candidate")).length, 90);
  const coverage = built.key.custody_manifest.axis_coverage.find(row => row.code === "ambiguous_brand")!;
  assert.equal(coverage.required, 30); assert.ok(coverage.selected >= 30); assert.equal(coverage.shortfall, 0);
});

test("axis coverage credits none cases already selected for brands and targets while filling the combined sample to two hundred", () => {
  const built = buildBlindPackageV1(axisOverlapSnapshot("false_none_inside"), seed);
  const answers = assertOverlapAxisSample(built);
  assert.equal(answers.filter(answer => answer.direction === "none" && answer.in_cut && answer.review_flags.includes("false_none_candidate")).length, 30);
  const coverage = built.key.custody_manifest.axis_coverage.find(row => row.code === "false_none_inside")!;
  assert.deepEqual([coverage.required, coverage.selected, coverage.shortfall], [30, 30, 0]);
});

test("axis coverage keeps a genuine twenty-nine-case population not ready with the original thirty-case minimum", () => {
  for (const kind of ["false_irony", "ambiguous_brand", "false_none_inside"] as const) {
    const snapshot = axisOverlapSnapshot(kind);
    const flag = kind === "false_none_inside" ? "false_none_candidate" : `${kind}_candidate`;
    for (const row of snapshot.study) row.review_flags = row.review_flags.filter(value => value !== flag);
    const available = snapshot.study.filter(row => row.mention_id.startsWith(`overlap-${kind}-${kind === "false_none_inside" ? "none" : "mixed"}-`)).slice(0, 29);
    assert.equal(available.length, 29);
    for (const row of available) row.review_flags = [...row.review_flags, flag];
    assert.equal(snapshot.study.filter(row => row.review_flags.includes(flag)).length, 29, "the source really lacks a thirtieth candidate");
    const built = buildBlindPackageV1(snapshot, seed);
    const answers = assertOverlapAxisSample(built, false);
    assert.equal(answers.filter(answer => answer.review_flags.includes(flag)).length, 29);
    const coverage = built.key.custody_manifest.axis_coverage.find(row => row.code === kind)!;
    assert.deepEqual([coverage.required, coverage.selected, coverage.shortfall], [30, 29, 1]);
    assert.equal(built.manifest.readiness, "not_ready");
    assert.ok(built.manifest.readiness_reasons.includes("sampling_shortfalls"));
    assert.equal(built.manifest.shortfall_count, 1, "only the real missing thirtieth case remains a shortfall");
  }
});


test("same synthetic snapshot and custody seed produce identical blind packets and key", () => {
  const snapshot = syntheticSnapshot();
  const a = buildBlindPackageV1(snapshot, seed); const b = buildBlindPackageV1(snapshot, seed);
  assert.deepEqual(a, b);
  const axisStratum = a.key.custody_manifest.strata.find(row => row.sample_code === "TAX")!;
  assert.ok(axisStratum.selected > axisStratum.quota, "the Study axis census may exceed its 200-case minimum");
  const targetOverrepresentation = a.key.custody_manifest.axis_coverage.find(row => row.code === "target_own_brand")!;
  assert.equal(targetOverrepresentation.selected, 40, "the target stratum includes already-selected cases toward its minimum");
  assert.equal(a.packets.length, 52);
  assert.ok(a.packets.every(packet => { validatePacketV1(packet); return packet.cases.every(row => !("mention_id" in row)); }));
  assert.equal(a.manifest.completeness, "complete");
  assert.equal(a.manifest.readiness, "ready");
  assert.equal(a.manifest.source_digest, a.key.custody_manifest.source_digest);
  assert.equal(a.manifest.strata.length, a.key.custody_manifest.strata.length);
  assert.notDeepEqual(a.manifest.strata.map(x => x.packet_ref), a.key.custody_manifest.strata.map(x => x.packet_ref));
  assert.notDeepEqual(a.manifest.strata.map(x => x.packet_ref), a.packets.map(x => x.packet_ref));
  const publicMetadata = JSON.stringify({ manifest: a.manifest, packets: a.packets.map(p => ({ packet_ref: p.packet_ref, cases: p.cases.map(c => c.blind_id) })) });
  assert.doesNotMatch(publicMetadata, /TAX|T01|M\d{2}|N-C\d{2}|LB-C\d{2}|LA-C\d{2}/u);
  assert.notDeepEqual(a.manifest.strata.map(x => x.packet_ref), a.manifest.strata.map(x => x.packet_ref).slice().sort());
});

test("snapshot preserves an externally configured methodology version while validating its digest", () => {
  const snapshot = syntheticSnapshot();
  snapshot.study_provenance.methodology_template_version = "synthetic-external-r16";
  assert.equal(validateSnapshotV1(snapshot).study_provenance.methodology_template_version, "synthetic-external-r16");
  assert.throws(() => validateSnapshotV1({ ...snapshot, study_provenance: { ...snapshot.study_provenance,
    methodology_template_version: " " } }), /blind_snapshot_invalid/u);
  assert.throws(() => validateSnapshotV1({ ...snapshot, study_provenance: { ...snapshot.study_provenance,
    methodology_template_version: "v".repeat(81) } }), /blind_snapshot_invalid/u);
  assert.throws(() => validateSnapshotV1({ ...snapshot, study_provenance: { ...snapshot.study_provenance,
    methodology_template_digest: "not-a-digest" } }), /blind_snapshot_invalid/u);
});

test("private answer key carries identity and labels while blind payloads omit them", () => {
  const built = buildBlindPackageV1(syntheticSnapshot(), seed);
  assert.ok(built.packets.flatMap(packet => packet.cases).every(row => !Object.keys(row).some(key => /mention_id|sample_code|answer|direction|target|use|layer|cohort|stratum/u.test(key))));
  assert.ok(!("mention_id" in built.manifest) && !("sample_code" in built.manifest));
  assert.doesNotMatch(JSON.stringify(built.manifest), /layer_agreement|boundary_recoded|eligible_count|\bkappa\b/u);
  const axes = built.key.rows.filter(row => row.sample_code === "TAX");
  assert.ok(axes.length >= 200);
  assert.ok(axes.every(row => ["direction", "target", "use"].every(axis => axis in (row.answer as object))
    && (row.answer as { axes_status: string }).axes_status === "observed"));
  const axisAnswers = axes.map(row => row.answer as { direction: string; target: string; review_flags: string[] });
  assert.ok(axisAnswers.filter(a => a.direction === "mixed").length >= 50);
  for (const target of ["category", "own_brand", "competitor_brand", "alternative"]) assert.ok(axisAnswers.filter(a => a.target === target).length >= 40);
  assert.ok(axisAnswers.filter(a => a.review_flags.includes("false_irony_candidate")).length >= 30);
  assert.ok(axisAnswers.filter(a => a.review_flags.includes("ambiguous_brand_candidate")).length >= 30);
  assert.ok(axisAnswers.filter(a => a.direction === "none" && a.review_flags.includes("false_none_candidate")).length >= 30);
  const outside = built.key.rows.filter(row => row.sample_code === "TAX-OUTSIDE");
  assert.equal(outside.length, 30);
  const outsideCoverage = built.key.custody_manifest.axis_coverage.find(item => item.code === "outside_lexical_missing_axes");
  assert.deepEqual([outsideCoverage?.required, outsideCoverage?.selected, outsideCoverage?.shortfall], [30, 30, 0]);
  assert.ok(built.key.rows.filter(row => row.sample_code === "TAX").every(row => (row.answer as { axes_status: string }).axes_status === "observed"));
  assert.ok(outside.every(row => {
    const answer = row.answer as { axes_status: string; candidate_source: string; direction: null; target: null; use: null };
    return answer.axes_status === "not_asked_outside_cut" && answer.candidate_source === "outside_lexical_cut"
      && answer.direction === null && answer.target === null && answer.use === null;
  }));
  const visibleOutside = built.packets.flatMap(packet => packet.cases).filter(row => outside.some(key => key.blind_id === row.blind_id));
  assert.equal(visibleOutside.length, 30);
  assert.ok(visibleOutside.every(row => !JSON.stringify(row).includes("not_asked_outside_cut") && /Independently code direction, target, and use/u.test(row.prompt)));
  assert.ok(built.key.custody_manifest.axis_coverage.every(item => item.selected >= item.required));
  const ambiguityCoverage = built.key.custody_manifest.axis_coverage.find(item => item.code === "ambiguous_brand");
  assert.equal(ambiguityCoverage?.selected, 30);
  assert.ok(built.key.rows.some(row => row.sample_code === "M01" && (row.answer as { layer?: string }).layer));
  assert.deepEqual(built.key.layer_agreement, { eligible_count: 10, pass_a_count: 10, pass_a_digest: "d".repeat(64), pass_b_count: 10,
    pass_b_digest: "e".repeat(64), denominator: 10, coverage: 1, observed_agreement: .91, expected_agreement: .5, kappa: .82,
    estimation_status: "complete", not_estimable_reason: null, action: "stable", status: "acceptable", boundary_recoded_count: 2 });
  assert.ok(!("layer_agreement" in built.manifest));
  const nearest = built.key.rows.find(row => row.sample_code.startsWith("N-"));
  assert.ok(nearest);
  const nearestAnswer = nearest!.answer as { system_assigned_motive_key: string; ranked_candidate_keys: string[]; option_map: Record<string, string> };
  assert.ok(nearestAnswer.system_assigned_motive_key);
  assert.ok(nearestAnswer.ranked_candidate_keys.includes(nearestAnswer.system_assigned_motive_key));
  assert.equal(new Set(Object.values(nearestAnswer.option_map)).size, 4);
  assert.deepEqual(Object.values(nearestAnswer.option_map).sort(), [...nearestAnswer.ranked_candidate_keys].sort());
  const nearestPacketCase = built.packets.flatMap(p => p.cases).find(c => c.blind_id === nearest!.blind_id)!;
  assert.deepEqual(nearestPacketCase.options?.map(o => o.key), ["A", "B", "C", "D"]);
  assert.ok(nearestPacketCase.options?.every(o => !/^\d+[.)]/u.test(o.text)));
  assert.match(nearestPacketCase.prompt, /Choose A, B, C, or D/u);
  assert.ok(Object.values(nearestAnswer.option_map).some((key, i) => key !== nearestAnswer.ranked_candidate_keys[i]));
  const layerRow = built.key.rows.find(row => row.sample_code === "M01")!;
  const layerPacketCase = built.packets.flatMap(p => p.cases).find(c => c.blind_id === layerRow.blind_id)!;
  assert.match(layerPacketCase.context ?? "", /Diagnostic layers: psychological:/u);
  assert.match(layerPacketCase.context ?? "", /otherwise select unclear/u);
  assert.ok((layerRow.answer as { layer?: string }).layer);
  assert.ok(built.key.rows.every(row => row.blind_id && row.mention_id && row.sample_code));
});

test("motive strata follow the official summary rank and absent official ranks remain shortfalls", () => {
  const snapshot = syntheticSnapshot();
  const m0 = snapshot.study.find(row => row.motive_key === "m0")!;
  for (let i = 0; i < 40; i++) snapshot.study.push({ ...m0, mention_id: `membership-count-dominates-${i}` });
  snapshot.official_motive_census = [...snapshot.official_motive_census!].reverse().map((motive, index) => ({ ...motive, rank: index + 1 }));
  const built = buildBlindPackageV1(snapshot, seed);
  assert.deepEqual(built.key.rows.filter(row => row.sample_code === "M01").map(row => (row.answer as { motive_key: string }).motive_key),
    Array(10).fill("m19"));
  snapshot.official_motive_census = snapshot.official_motive_census.slice(0, 2);
  const short = buildBlindPackageV1(snapshot, seed);
  assert.equal(short.key.custody_manifest.strata.find(item => item.sample_code === "M03")?.selected, 0);
  assert.equal(short.manifest.readiness, "not_ready");
  assert.ok(short.manifest.readiness_reasons.includes("sampling_shortfalls"));
  assert.ok(short.manifest.readiness_reasons.includes("official_motive_rank_missing"));
});

test("sampling deduplicates identities across strata and reports census shortfalls", () => {
  const snapshot = syntheticSnapshot();
  snapshot.listening = snapshot.listening.slice(0, 3); // deliberately omit almost every cohort and all after-stage records
  const built = buildBlindPackageV1(snapshot, seed);
  assert.equal(built.manifest.completeness, "census_with_shortfalls");
  assert.ok(built.manifest.shortfall_count > 0);
  const allIds = built.key.rows.map(row => row.mention_id);
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(built.manifest.strata.length, 52);
});

test("unordered four-candidate sets are audited as multilabel membership without a winner or leakage", () => {
  const snapshot = syntheticSnapshot();
  for (const [index, row] of snapshot.study.entries()) {
    delete row.nearest_motives; delete row.nearest_assigned_motive_key; delete row.nearest_volume_cohort;
    const keys = ["native_a", "native_b", "native_c", "native_d"];
    row.native_nearest_candidate_set = keys.map((motive_key, candidateIndex) => ({ motive_key,
      volume_cohort: LISTENING_COHORTS_V1[(index + candidateIndex * 3) % LISTENING_COHORTS_V1.length]!,
      name: `Synthetic candidate ${candidateIndex + 1}`, definition: `Synthetic candidate definition ${candidateIndex + 1}` }));
    row.motive_memberships = keys.map((motive_key, candidateIndex) => {
      const probability = index % 3 === 0 ? .2 : index % 3 === 1 ? (candidateIndex < 2 ? .9 : .1) : (candidateIndex === 2 ? .95 : .1);
      return { motive_key, volume_cohort: row.native_nearest_candidate_set!.find(m => m.motive_key === motive_key)!.volume_cohort,
        name: `Synthetic candidate ${candidateIndex + 1}`, definition: `Synthetic candidate definition ${candidateIndex + 1}`, layer: "personal", probability, assigned: probability >= .7 };
    });
  }
  const built = buildBlindPackageV1(snapshot, seed);
  const nativeNearest = built.key.rows.filter(row => row.sample_code.startsWith("N-"));
  assert.equal(nativeNearest.length, 200);
  const positives = nativeNearest.map(row => Object.values((row.answer as { candidate_memberships: Record<string, boolean> }).candidate_memberships).filter(Boolean).length);
  assert.ok(positives.includes(0), "the source set may have no positive motive");
  assert.ok(positives.some(count => count >= 2), "native multiple assignments remain multiple");
  assert.ok(nativeNearest.every(row => {
    const answer = row.answer as { source_candidate_set: string[]; candidate_memberships: Record<string, boolean>;
      candidate_probabilities: Record<string, number>; option_map: Record<string, string>; stratum_candidate_key: string };
    return answer.source_candidate_set.length === 4 && answer.source_candidate_set.includes(answer.stratum_candidate_key)
      && Object.keys(answer.candidate_memberships).length === 4 && Object.keys(answer.candidate_probabilities).length === 4
      && Object.values(answer.option_map).length === 4;
  }));
  assert.ok(built.key.custody_manifest.strata.filter(item => item.sample_code.startsWith("N-")).every(item => item.selected === 20));
  const nearestIds = new Set(nativeNearest.map(row => row.blind_id));
  const visible = built.packets.flatMap(packet => packet.cases).filter(row => nearestIds.has(row.blind_id));
  assert.doesNotMatch(JSON.stringify(visible), /native_[a-d]|candidate_memberships|option_map/u);
  assert.ok(visible.every(row => row.options?.length === 4 && /independently mark YES/u.test(row.prompt)));
});

test("missing native layer truth or nearest assignment reports shortfalls without placeholder answers", () => {
  const snapshot = syntheticSnapshot();
  for (const row of snapshot.study) {
    if (row.motive_key) delete row.layer;
    if (row.nearest_volume_cohort) delete row.nearest_assigned_motive_key;
  }
  const built = buildBlindPackageV1(snapshot, seed);
  assert.equal(built.manifest.completeness, "census_with_shortfalls");
  assert.ok(built.manifest.shortfall_count > 0);
  assert.ok(!built.key.rows.some(row => row.sample_code.startsWith("M")));
  assert.ok(!built.key.rows.some(row => row.sample_code.startsWith("N-")));
  assert.ok(built.key.rows.filter(row => row.sample_code.startsWith("M")).every(row => (row.answer as { layer?: string }).layer !== undefined));
});

test("unmeasured two-pass kappa stays null and marks package evidence incomplete", () => {
  const snapshot = syntheticSnapshot();
  snapshot.layer_agreement = null;
  const built = buildBlindPackageV1(snapshot, seed);
  assert.equal(built.key.layer_agreement, null);
  assert.equal(built.manifest.completeness, "evidence_incomplete");
  assert.deepEqual(built.manifest.incompleteness_reasons, ["required_metric_receipt_missing"]);
  assert.ok(!("layer_agreement" in built.manifest));
});

test("missing native cost or timing stays null and marks package incomplete instead of inventing zero", () => {
  const snapshot = syntheticSnapshot();
  snapshot.receipts = { status: "incomplete", cost_scope: "native_provider_ledgers", total_cost_usd: null, total_reserved_usd: null,
    total_elapsed_ms: null, timing_scope: "unknown",
    stages: [{ stage: "study_execution", cost_usd: null, reserved_usd: null, elapsed_ms: null }] };
  const built = buildBlindPackageV1(snapshot, seed);
  assert.equal(built.manifest.completeness, "evidence_incomplete");
  assert.equal(built.manifest.receipts.total_cost_usd, null);
  assert.equal(built.manifest.receipts.total_elapsed_ms, null);
  assert.equal(built.manifest.receipts.total_reserved_usd, null);
  assert.equal(built.manifest.receipts.stages[0]?.cost_usd, null);
  assert.ok(built.manifest.incompleteness_reasons.includes("required_metric_receipt_missing"));
  snapshot.receipts.total_cost_usd = 0;
  const partialMeasured = buildBlindPackageV1(snapshot, seed);
  assert.equal(partialMeasured.manifest.completeness, "evidence_incomplete");
  assert.equal(partialMeasured.manifest.receipts.total_cost_usd, 0);
  assert.equal(partialMeasured.manifest.receipts.total_elapsed_ms, null);
});

test("receipt timing is a measured wall span and does not sum overlapping stage intervals", () => {
  const snapshot = syntheticSnapshot();
  snapshot.receipts = { status: "complete", cost_scope: "native_provider_ledgers", total_cost_usd: 3.5, total_reserved_usd: 0, total_elapsed_ms: 1500,
    timing_scope: "wall_span", stages: [
      { stage: "listening_review", cost_usd: 1.5, reserved_usd: 0, elapsed_ms: 1500 },
      { stage: "study_editorial", cost_usd: 2, reserved_usd: 0, elapsed_ms: 900 },
    ] };
  assert.doesNotThrow(() => buildBlindPackageV1(snapshot, seed), "overlapping stage windows can exceed the total wall span when summed");
});

test("partial agreement coverage cannot carry numeric kappa, while full low-kappa evidence remains reportable", () => {
  const partial = syntheticSnapshot();
  partial.layer_agreement = { eligible_count: 10, pass_a_count: 10, pass_a_digest: "d".repeat(64), pass_b_count: 1, pass_b_digest: "e".repeat(64),
    denominator: 1, coverage: .1, observed_agreement: 1, expected_agreement: .5, kappa: 1, estimation_status: "complete",
    not_estimable_reason: null, action: "stable", status: "acceptable", boundary_recoded_count: 0 };
  assert.throws(() => buildBlindPackageV1(partial, seed), /snapshot_invalid/);

  partial.layer_agreement = { ...partial.layer_agreement, observed_agreement: null, expected_agreement: null, kappa: null,
    estimation_status: "not_estimable", not_estimable_reason: "incomplete_coverage", action: "recode_boundary_once", status: "insufficient_data" };
  const incomplete = buildBlindPackageV1(partial, seed);
  assert.equal(incomplete.key.layer_agreement?.kappa, null);
  assert.equal(incomplete.key.layer_agreement?.denominator, 1);
  assert.equal(incomplete.key.layer_agreement?.pass_a_count, 10);
  assert.equal(incomplete.key.layer_agreement?.pass_b_count, 1);
  assert.equal(incomplete.manifest.completeness, "evidence_incomplete");

  const degenerate = syntheticSnapshot();
  degenerate.layer_agreement = { eligible_count: 10, pass_a_count: 10, pass_a_digest: "d".repeat(64), pass_b_count: 10, pass_b_digest: "e".repeat(64),
    denominator: 10, coverage: 1, observed_agreement: 1, expected_agreement: 1, kappa: null, estimation_status: "not_estimable",
    not_estimable_reason: "expected_agreement_one", action: "not_estimable", status: "not_estimable", boundary_recoded_count: 0 };
  const nonEstimable = buildBlindPackageV1(degenerate, seed);
  assert.equal(nonEstimable.key.layer_agreement?.kappa, null);
  assert.equal(nonEstimable.key.layer_agreement?.expected_agreement, 1);
  assert.equal(nonEstimable.key.layer_agreement?.not_estimable_reason, "expected_agreement_one");
  assert.equal(nonEstimable.manifest.completeness, "complete", "full-census degeneracy is explicit, not a missing-coverage claim");

  const low = syntheticSnapshot();
  low.layer_agreement = { ...low.layer_agreement!, observed_agreement: .81, kappa: .62, status: "below_threshold",
    action: "unstable_report", boundary_recoded_count: 4 };
  const reportable = buildBlindPackageV1(low, seed);
  assert.equal(reportable.manifest.completeness, "complete", "a measured low kappa is evidence, not a package shortfall");
  assert.equal(reportable.key.layer_agreement?.kappa, .62);
  assert.equal(reportable.key.layer_agreement?.boundary_recoded_count, 4);
});

test("invalid receipts, duplicate source identities, and weak seeds fail closed", () => {
  const snapshot = syntheticSnapshot();
  assert.throws(() => buildBlindPackageV1(snapshot, "short"), /seed_too_short/);
  const duplicate = syntheticSnapshot(); duplicate.study.push({ ...duplicate.study[0]! });
  assert.throws(() => buildBlindPackageV1(duplicate, seed), /duplicate_study_identity/);
  const invalid = syntheticSnapshot(); invalid.receipts.total_cost_usd = Number.NaN;
  assert.throws(() => buildBlindPackageV1(invalid, seed), /snapshot_invalid/);
  const invalidKappa = syntheticSnapshot(); invalidKappa.layer_agreement!.coverage = .5;
  assert.throws(() => buildBlindPackageV1(invalidKappa, seed), /snapshot_invalid/);
  const fakeAxes = syntheticSnapshot();
  fakeAxes.study[0]!.axes_status = "not_asked_outside_cut";
  fakeAxes.study[0]!.direction = "none";
  fakeAxes.study[0]!.target = null;
  fakeAxes.study[0]!.use = null;
  fakeAxes.study[0]!.in_cut = false;
  fakeAxes.study[0]!.lexical_filter_match = false;
  assert.throws(() => buildBlindPackageV1(fakeAxes, seed), /snapshot_invalid/);
  const missingOutsideProof = syntheticSnapshot();
  missingOutsideProof.study[0]!.axes_status = "not_asked_outside_cut";
  missingOutsideProof.study[0]!.direction = null;
  missingOutsideProof.study[0]!.target = null;
  missingOutsideProof.study[0]!.use = null;
  missingOutsideProof.study[0]!.in_cut = false;
  missingOutsideProof.study[0]!.lexical_filter_match = false;
  missingOutsideProof.study[0]!.base_voice_valid = false;
  assert.throws(() => buildBlindPackageV1(missingOutsideProof, seed), /snapshot_invalid/);
});

test("private writer emits separated custody key, atomic package, and verifiable SHA manifest", async () => {
  const privateRoot = resolve(".data/piloto-masivo/r16");
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(resolve(privateRoot, ".synthetic-blind-test-"));
  try {
    const snapshotPath = resolve(temp, "snapshot.json"); const seedPath = resolve(temp, "seed.txt");
    const packageDir = resolve(temp, "auditor"); const keyPath = resolve(temp, "custody", "answer-key.json");
    await mkdir(resolve(temp, "custody"), { mode: 0o700 });
    await writeFile(snapshotPath, `${JSON.stringify(syntheticSnapshot())}\n`, { mode: 0o600 });
    await writeFile(seedPath, seed, { mode: 0o600 });
    const snapshotLink = resolve(temp, "snapshot-link.json"); await symlink(snapshotPath, snapshotLink);
    await assert.rejects(() => writeBlindPackageV1({ snapshotPath: snapshotLink, seedPath, packageDir: resolve(temp, "symlink-output"),
      custodyKeyPath: resolve(temp, "custody", "symlink-key.json") }), /symlink_path_rejected/);
    await writeBlindPackageV1({ snapshotPath, seedPath, packageDir, custodyKeyPath: keyPath });
  assert.deepEqual(await verifyBlindPackageV1(packageDir), { valid: true, files: 53, readiness: "ready", readiness_reasons: [] });
    const noOfficialRank = syntheticSnapshot(); delete noOfficialRank.official_motive_census;
    const legacySnapshotPath = resolve(temp, "legacy-snapshot.json"), legacyPackage = resolve(temp, "legacy-auditor");
    await writeFile(legacySnapshotPath, `${JSON.stringify(noOfficialRank)}\n`, { mode: 0o600 });
    await writeBlindPackageV1({ snapshotPath: legacySnapshotPath, seedPath, packageDir: legacyPackage,
      custodyKeyPath: resolve(temp, "custody", "legacy-key.json") });
    assert.deepEqual(await verifyBlindPackageV1(legacyPackage), { valid: true, files: 53, readiness: "not_ready",
      readiness_reasons: ["official_motive_rank_missing", "sampling_shortfalls"] });

    const oldManifestPackage = resolve(temp, "legacy-manifest-auditor");
    await writeBlindPackageV1({ snapshotPath, seedPath, packageDir: oldManifestPackage,
      custodyKeyPath: resolve(temp, "custody", "legacy-manifest-key.json") });
    const oldManifestPath = resolve(oldManifestPackage, "manifest.json");
    const oldManifest = JSON.parse(await readFile(oldManifestPath, "utf8"));
    delete oldManifest.readiness_protocol; delete oldManifest.readiness; delete oldManifest.readiness_reasons; delete oldManifest.readiness_evidence;
    const oldManifestText = `${JSON.stringify(oldManifest, null, 2)}\n`;
    await writeFile(oldManifestPath, oldManifestText, { mode: 0o600 });
    const oldSumsPath = resolve(oldManifestPackage, "SHA256SUMS");
    const oldSums = (await readFile(oldSumsPath, "utf8")).trim().split("\n").map(line => line.endsWith("  manifest.json")
      ? `${sha256(oldManifestText)}  manifest.json` : line);
    await writeFile(oldSumsPath, `${oldSums.join("\n")}\n`, { mode: 0o600 });
    assert.deepEqual(await verifyBlindPackageV1(oldManifestPackage), { valid: true, files: 53, readiness: "not_ready",
      readiness_reasons: ["legacy_readiness_protocol_missing"] });

    const mismatchPackage = resolve(temp, "mismatch-count-auditor");
    await writeBlindPackageV1({ snapshotPath, seedPath, packageDir: mismatchPackage,
      custodyKeyPath: resolve(temp, "custody", "mismatch-count-key.json") });
    const mismatchPacketPath = resolve(mismatchPackage, "packet-01.json");
    const mismatchPacket = JSON.parse(await readFile(mismatchPacketPath, "utf8")); mismatchPacket.cases.pop();
    const mismatchPacketText = `${JSON.stringify(mismatchPacket, null, 2)}\n`;
    await writeFile(mismatchPacketPath, mismatchPacketText, { mode: 0o600 });
    const mismatchManifestPath = resolve(mismatchPackage, "manifest.json");
    const mismatchManifest = JSON.parse(await readFile(mismatchManifestPath, "utf8"));
    mismatchManifest.packet_files.find((file: { name: string }) => file.name === "packet-01.json").sha256 = sha256(mismatchPacketText);
    mismatchManifest.case_count--;
    const mismatchManifestText = `${JSON.stringify(mismatchManifest, null, 2)}\n`;
    await writeFile(mismatchManifestPath, mismatchManifestText, { mode: 0o600 });
    const sumsPath = resolve(mismatchPackage, "SHA256SUMS");
    const updatedSums = (await readFile(sumsPath, "utf8")).trim().split("\n").map(line => {
      if (line.endsWith("  packet-01.json")) return `${sha256(mismatchPacketText)}  packet-01.json`;
      if (line.endsWith("  manifest.json")) return `${sha256(mismatchManifestText)}  manifest.json`;
      return line;
    });
    await writeFile(sumsPath, `${updatedSums.join("\n")}\n`, { mode: 0o600 });
    await assert.rejects(() => verifyBlindPackageV1(mismatchPackage), /selected_case_mismatch/u);

    const inconsistentReceiptsPackage = resolve(temp, "inconsistent-receipts-auditor");
    await writeBlindPackageV1({ snapshotPath, seedPath, packageDir: inconsistentReceiptsPackage,
      custodyKeyPath: resolve(temp, "custody", "inconsistent-receipts-key.json") });
    const inconsistentManifestPath = resolve(inconsistentReceiptsPackage, "manifest.json");
    const inconsistentManifest = JSON.parse(await readFile(inconsistentManifestPath, "utf8"));
    inconsistentManifest.receipts.status = "incomplete";
    const inconsistentManifestText = `${JSON.stringify(inconsistentManifest, null, 2)}\n`;
    await writeFile(inconsistentManifestPath, inconsistentManifestText, { mode: 0o600 });
    const inconsistentSumsPath = resolve(inconsistentReceiptsPackage, "SHA256SUMS");
    const inconsistentSums = (await readFile(inconsistentSumsPath, "utf8")).trim().split("\n").map(line => line.endsWith("  manifest.json")
      ? `${sha256(inconsistentManifestText)}  manifest.json` : line);
    await writeFile(inconsistentSumsPath, `${inconsistentSums.join("\n")}\n`, { mode: 0o600 });
    await assert.rejects(() => verifyBlindPackageV1(inconsistentReceiptsPackage), /readiness_metric_receipt_mismatch/u);

    const lowQuotaPackage = resolve(temp, "lowered-quota-auditor");
    await writeBlindPackageV1({ snapshotPath, seedPath, packageDir: lowQuotaPackage,
      custodyKeyPath: resolve(temp, "custody", "lowered-quota-key.json") });
    const lowQuotaManifestPath = resolve(lowQuotaPackage, "manifest.json");
    const lowQuotaManifest = JSON.parse(await readFile(lowQuotaManifestPath, "utf8"));
    lowQuotaManifest.strata.find((row: { quota: number }) => row.quota === 50).quota = 49;
    const lowQuotaText = `${JSON.stringify(lowQuotaManifest, null, 2)}\n`;
    await writeFile(lowQuotaManifestPath, lowQuotaText, { mode: 0o600 });
    const lowQuotaSumsPath = resolve(lowQuotaPackage, "SHA256SUMS");
    const lowQuotaSums = (await readFile(lowQuotaSumsPath, "utf8")).trim().split("\n").map(line => line.endsWith("  manifest.json")
      ? `${sha256(lowQuotaText)}  manifest.json` : line);
    await writeFile(lowQuotaSumsPath, `${lowQuotaSums.join("\n")}\n`, { mode: 0o600 });
    await assert.rejects(() => verifyBlindPackageV1(lowQuotaPackage), /blind_manifest_(?:protocol_quotas_invalid|invalid)/u);
    const sums = await readFile(resolve(packageDir, "SHA256SUMS"), "utf8");
    assert.doesNotMatch(sums, /answer-key/u);
    assert.equal((await stat(packageDir)).mode & 0o777, 0o700);
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
    const firstPacket = resolve(packageDir, "packet-01.json");
    const saved = await readFile(firstPacket, "utf8");
    await writeFile(firstPacket, `${saved}tamper`);
    await assert.rejects(() => verifyBlindPackageV1(packageDir), /checksum_mismatch/);

    const raceKey = resolve(temp, "custody", "raced-key.json");
    const racePackages = [resolve(temp, "raced-a"), resolve(temp, "raced-b")];
    const outcomes = await Promise.allSettled(racePackages.map(packagePath => writeBlindPackageV1({ snapshotPath, seedPath,
      packageDir: packagePath, custodyKeyPath: raceKey })));
    const winners = outcomes.map((outcome, i) => outcome.status === "fulfilled" ? racePackages[i] : undefined).filter(Boolean);
    assert.equal(winners.length, 1, "exclusive hard-link publication permits only one concurrent custody key owner");
    const loser = racePackages.find(path => path !== winners[0])!;
    await assert.rejects(() => stat(loser), /ENOENT/u);
    assert.deepEqual(await verifyBlindPackageV1(winners[0]!), { valid: true, files: 53, readiness: "ready", readiness_reasons: [] });
    assert.equal((await stat(raceKey)).mode & 0o777, 0o600);

    const samePackage = resolve(temp, "same-package"); const sameKey = resolve(temp, "custody", "same-package-key.json");
    const samePackageRace = await Promise.allSettled([1, 2].map(() => writeBlindPackageV1({ snapshotPath, seedPath,
      packageDir: samePackage, custodyKeyPath: sameKey })));
    assert.equal(samePackageRace.filter(x => x.status === "fulfilled").length, 1, "exclusive output lock permits only one directory publisher");
    assert.deepEqual(await verifyBlindPackageV1(samePackage), { valid: true, files: 53, readiness: "ready", readiness_reasons: [] });
    const sumsBeforeOverwrite = await readFile(resolve(samePackage, "SHA256SUMS"), "utf8");
    const keyBeforeOverwrite = await readFile(sameKey, "utf8");
    await assert.rejects(() => writeBlindPackageV1({ snapshotPath, seedPath, packageDir: samePackage, custodyKeyPath: sameKey }));
    assert.equal(await readFile(resolve(samePackage, "SHA256SUMS"), "utf8"), sumsBeforeOverwrite);
    assert.equal(await readFile(sameKey, "utf8"), keyBeforeOverwrite);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("exported-object package path checks streamed private bytes before publishing", async () => {
  const privateRoot = resolve(".data/piloto-masivo/r16");
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(resolve(privateRoot, ".synthetic-exported-snapshot-test-"));
  try {
    const snapshot = syntheticSnapshot();
    const snapshotPath = resolve(temp, "snapshot.json"), seedPath = resolve(temp, "seed.txt");
    const packageDir = resolve(temp, "auditor"), keyPath = resolve(temp, "custody", "answer-key.json");
    await mkdir(resolve(temp, "custody"), { mode: 0o700 });
    await writePrivateJsonFileV1(snapshotPath, snapshot, temp);
    await writeFile(seedPath, seed, { mode: 0o600 });

    const mismatchPackage = resolve(temp, "mismatch-auditor"), mismatchKey = resolve(temp, "custody", "mismatch-key.json");
    const mismatch = { ...snapshot, exported_at: "2026-11-15T00:00:00.000Z" };
    await assert.rejects(() => writeBlindPackageFromExportedSnapshotV1({ snapshotPath, seedPath, packageDir: mismatchPackage,
      custodyKeyPath: mismatchKey, snapshot: mismatch }), /blind_snapshot_file_mismatch/u);
    await assert.rejects(stat(mismatchPackage), { code: "ENOENT" });
    await assert.rejects(stat(mismatchKey), { code: "ENOENT" });

    const mutableArgs = { snapshotPath, seedPath, packageDir, custodyKeyPath: keyPath, snapshot };
    const writing = writeBlindPackageFromExportedSnapshotV1(mutableArgs);
    mutableArgs.snapshot = mismatch;
    await writing;
    assert.deepEqual(await verifyBlindPackageV1(packageDir), { valid: true, files: 53, readiness: "ready", readiness_reasons: [] });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("exported-object verifier compares a virtual snapshot larger than Node's string limit without collecting it", async () => {
  const shared = "\u0000".repeat(9_000);
  const count = Math.ceil((bufferConstants.MAX_STRING_LENGTH + 1) / (shared.length * 6 + 4)) + 2;
  const snapshot = new Array(count).fill(shared);
  let producer: Promise<void> | undefined;
  await assertBlindSnapshotStreamMatchesV1(snapshot, () => {
    const bytes = new PassThrough({ highWaterMark: 64 * 1024 });
    producer = (async () => {
      try {
        await streamJsonV1(snapshot, async chunk => {
          if (!bytes.write(Buffer.from(chunk, "utf8"))) await once(bytes, "drain");
        }, { pretty: true, trailing_newline: true });
        bytes.end();
      } catch (error) { bytes.destroy(error as Error); throw error; }
    })();
    return bytes;
  });
  await producer;
  assert.ok(count * shared.length * 6 > bufferConstants.MAX_STRING_LENGTH);
});

test("exported snapshot preflight freezes before opening bytes and always destroys a failed reader", async () => {
  const snapshot = { nested: { value: "sealed" } };
  let opened = false;
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let destroyed = false;
  await assert.rejects(() => assertBlindSnapshotStreamMatchesV1({ value: new Date() }, () => {
    opened = true;
    return (async function* () {})();
  }), /blind_snapshot_json_plain_required/u);
  assert.equal(opened, false, "unsupported builtins must fail before opening a file stream");

  const frozen = assertBlindSnapshotStreamMatchesV1(snapshot, () => {
    opened = true;
    return { destroy() { destroyed = true; }, async *[Symbol.asyncIterator]() { await released; yield Buffer.from("{}\n"); throw new Error("synthetic_reader_failure"); } };
  });
  // The root is synchronously frozen before the verifier yields to serialize/read.
  assert.throws(() => { snapshot.nested.value = "changed"; }, TypeError);
  release();
  await assert.rejects(frozen, /synthetic_reader_failure/u);
  assert.equal(opened, true);
  assert.equal(destroyed, true, "failed readers must be closed in finally");
});
