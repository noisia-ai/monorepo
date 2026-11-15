import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildBlindPackageV1, LISTENING_COHORTS_V1, validatePacketV1, verifyBlindPackageV1, writeBlindPackageV1, type BlindSnapshotV1 } from "./blind-package.js";

const seed = "synthetic-seed-for-r16-blind-package-tests-2026";
const digest = "a".repeat(64);
function syntheticSnapshot(): BlindSnapshotV1 {
  const listening = [] as Array<{ mention_id: string; redacted_text: string; stage: "before" | "after";
    assignments: Array<{ topic_key: string; topic_name: string; topic_definition: string; volume_cohort: string; assigned: boolean }> }>;
  for (const stage of ["before", "after"] as const) for (const cohort of LISTENING_COHORTS_V1) {
    for (let i = 0; i < 55; i++) listening.push({ mention_id: `listen-${stage}-${cohort}-${i}`, redacted_text: `synthetic mention ${stage} ${cohort} ${i}`,
      stage, assignments: [{ topic_key: `topic-${cohort}`, topic_name: `Synthetic topic ${cohort}`, topic_definition: "Synthetic definition", volume_cohort: cohort, assigned: i % 2 === 0 }] });
  }
  const study = [] as Array<{ mention_id: string; redacted_text: string; direction: "trigger" | "barrier" | "mixed" | "none";
    target: "category" | "own_brand" | "competitor_brand" | "alternative"; use: "literal" | "figurative_or_ironic" | "other";
    in_cut: boolean; review_flags: string[]; motive_key?: string; motive_volume_cohort?: string; motive_name?: string; motive_definition?: string; nearest_volume_cohort?: string;
    nearest_assigned_motive_key?: string;
    layer?: string; nearest_motives?: Array<{ motive_key: string; volume_cohort: string; name: string; definition: string }> }>;
  const add = (id: string, overrides: Partial<(typeof study)[number]> = {}) => study.push({ mention_id: id, redacted_text: `synthetic study mention ${id}`,
    direction: "trigger", target: "category", use: "literal", in_cut: true, review_flags: [], ...overrides });
  for (const dir of ["mixed", "barrier", "trigger"] as const) for (let i = 0; i < 80; i++) add(`axis-${dir}-${i}`, { direction: dir });
  for (const target of ["own_brand", "competitor_brand", "alternative"] as const) for (let i = 0; i < 50; i++) add(`target-${target}-${i}`, { target });
  for (let i = 0; i < 35; i++) add(`false-irony-${i}`, { review_flags: ["false_irony_candidate"] });
  for (let i = 0; i < 35; i++) add(`ambiguous-brand-${i}`, { review_flags: ["ambiguous_brand_candidate"] });
  for (let i = 0; i < 35; i++) add(`false-none-in-${i}`, { direction: "none", review_flags: ["false_none_candidate"] });
  for (let i = 0; i < 35; i++) add(`false-none-out-${i}`, { direction: "none", in_cut: false, review_flags: ["false_none_candidate"] });
  for (let motive = 0; motive < 20; motive++) for (let i = 0; i < 25; i++) add(`motive-${motive}-${i}`, { motive_key: `m${motive}`, motive_name: `Motive ${motive}`,
    motive_definition: "Synthetic motive", motive_volume_cohort: LISTENING_COHORTS_V1[motive % 10], layer: "social",
    nearest_motives: LISTENING_COHORTS_V1.slice(0, 4).map((c, n) => ({ motive_key: `n${n}`, volume_cohort: c, name: `Candidate ${n}`, definition: "Synthetic candidate" })) });
  for (const cohort of LISTENING_COHORTS_V1) for (let i = 0; i < 25; i++) add(`nearest-${cohort}-${i}`, { nearest_volume_cohort: cohort,
    nearest_assigned_motive_key: "n0", nearest_motives:
    LISTENING_COHORTS_V1.slice(0, 4).map((c, n) => ({ motive_key: `n${n}`, volume_cohort: c, name: `Candidate ${n}`, definition: "Synthetic candidate" })) });
  return { contract_version: "r16-blind-snapshot-v1" as const, exported_at: "2026-11-14T12:00:00.000Z", source: { export_contract: "synthetic-v1", export_digest: digest },
    study_provenance: { listening_before_digest: digest, listening_after_digest: "b".repeat(64), study_contract_version: "signal-study-v1",
      methodology_template_version: "r16-v1", methodology_template_digest: `sha256:${"c".repeat(64)}` },
    study_guidance: { subject_context: "Synthetic subject context", direction_options: ["trigger", "barrier", "mixed", "none"].map(key => ({ key, definition: `Definition ${key}` })),
      target_options: ["category", "own_brand", "competitor_brand", "alternative"].map(key => ({ key, definition: `Definition ${key}` })),
      use_options: ["literal", "figurative_or_ironic", "other"].map(key => ({ key, definition: `Definition ${key}` })),
      layer_diagnostics: ["island", "money_time", "nobody_knows", "without_network"].map((key, i) => ({ key,
        layer: ["psychological", "personal", "social", "cultural"][i]!, question: `Question ${key}`, definition: `Definition ${key}` })) },
    layer_agreement: { eligible_count: 10, denominator: 10, coverage: 1, kappa: .82, status: "acceptable" as const, boundary_recoded_count: 2 },
    receipts: { total_cost_usd: 0, total_elapsed_ms: 0, stages: [{ stage: "synthetic", cost_usd: 0, elapsed_ms: 0 }] }, listening, study };
}

test("same synthetic snapshot and custody seed produce identical blind packets and key", () => {
  const snapshot = syntheticSnapshot();
  const a = buildBlindPackageV1(snapshot, seed); const b = buildBlindPackageV1(snapshot, seed);
  assert.deepEqual(a, b);
  assert.equal(a.packets.length, 51);
  assert.ok(a.packets.every(packet => { validatePacketV1(packet); return packet.cases.every(row => !("mention_id" in row)); }));
  assert.equal(a.manifest.completeness, "complete");
  assert.equal(a.manifest.source_digest, a.key.custody_manifest.source_digest);
  assert.equal(a.manifest.strata.length, a.key.custody_manifest.strata.length);
  assert.notDeepEqual(a.manifest.strata.map(x => x.packet_ref), a.key.custody_manifest.strata.map(x => x.packet_ref));
  assert.notDeepEqual(a.manifest.strata.map(x => x.packet_ref), a.packets.map(x => x.packet_ref));
  const publicMetadata = JSON.stringify({ manifest: a.manifest, packets: a.packets.map(p => ({ packet_ref: p.packet_ref, cases: p.cases.map(c => c.blind_id) })) });
  assert.doesNotMatch(publicMetadata, /TAX|T01|M\d{2}|N-C\d{2}|LB-C\d{2}|LA-C\d{2}/u);
  assert.notDeepEqual(a.manifest.strata.map(x => x.packet_ref), a.manifest.strata.map(x => x.packet_ref).slice().sort());
});

test("private answer key carries identity and labels while blind payloads omit them", () => {
  const built = buildBlindPackageV1(syntheticSnapshot(), seed);
  assert.ok(built.packets.flatMap(packet => packet.cases).every(row => !Object.keys(row).some(key => /mention_id|sample_code|answer|direction|target|use|layer|cohort|stratum/u.test(key))));
  assert.ok(!("mention_id" in built.manifest) && !("sample_code" in built.manifest));
  assert.doesNotMatch(JSON.stringify(built.manifest), /layer_agreement|boundary_recoded|eligible_count|\bkappa\b/u);
  const axes = built.key.rows.filter(row => row.sample_code === "TAX");
  assert.ok(axes.length >= 200);
  assert.ok(axes.every(row => ["direction", "target", "use"].every(axis => axis in (row.answer as object))));
  const axisAnswers = axes.map(row => row.answer as { direction: string; target: string; review_flags: string[] });
  assert.ok(axisAnswers.filter(a => a.direction === "mixed").length >= 50);
  for (const target of ["category", "own_brand", "competitor_brand", "alternative"]) assert.ok(axisAnswers.filter(a => a.target === target).length >= 40);
  assert.ok(axisAnswers.filter(a => a.review_flags.includes("false_irony_candidate")).length >= 30);
  assert.ok(axisAnswers.filter(a => a.review_flags.includes("ambiguous_brand_candidate")).length >= 30);
  assert.ok(axisAnswers.filter(a => a.direction === "none" && a.review_flags.includes("false_none_candidate")).length >= 60);
  assert.ok(built.key.custody_manifest.axis_coverage.every(item => item.selected >= item.required));
  const ambiguityCoverage = built.key.custody_manifest.axis_coverage.find(item => item.code === "ambiguous_brand");
  assert.equal(ambiguityCoverage?.selected, 30);
  assert.ok(built.key.rows.some(row => row.sample_code === "M01" && (row.answer as { layer?: string }).layer));
  assert.deepEqual(built.key.layer_agreement, { eligible_count: 10, denominator: 10, coverage: 1, kappa: .82, status: "acceptable", boundary_recoded_count: 2 });
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

test("sampling deduplicates identities across strata and reports census shortfalls", () => {
  const snapshot = syntheticSnapshot();
  snapshot.listening = snapshot.listening.slice(0, 3); // deliberately omit almost every cohort and all after-stage records
  const built = buildBlindPackageV1(snapshot, seed);
  assert.equal(built.manifest.completeness, "census_with_shortfalls");
  assert.ok(built.manifest.shortfall_count > 0);
  const allIds = built.key.rows.map(row => row.mention_id);
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(built.manifest.strata.length, 51);
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

test("invalid receipts, duplicate source identities, and weak seeds fail closed", () => {
  const snapshot = syntheticSnapshot();
  assert.throws(() => buildBlindPackageV1(snapshot, "short"), /seed_too_short/);
  const duplicate = syntheticSnapshot(); duplicate.study.push({ ...duplicate.study[0]! });
  assert.throws(() => buildBlindPackageV1(duplicate, seed), /duplicate_study_identity/);
  const invalid = syntheticSnapshot(); invalid.receipts.total_cost_usd = Number.NaN;
  assert.throws(() => buildBlindPackageV1(invalid, seed), /snapshot_invalid/);
  const invalidKappa = syntheticSnapshot(); invalidKappa.layer_agreement!.coverage = .5;
  assert.throws(() => buildBlindPackageV1(invalidKappa, seed), /snapshot_invalid/);
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
    assert.deepEqual(await verifyBlindPackageV1(packageDir), { valid: true, files: 52 });
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
    assert.deepEqual(await verifyBlindPackageV1(winners[0]!), { valid: true, files: 52 });
    assert.equal((await stat(raceKey)).mode & 0o777, 0o600);

    const samePackage = resolve(temp, "same-package"); const sameKey = resolve(temp, "custody", "same-package-key.json");
    const samePackageRace = await Promise.allSettled([1, 2].map(() => writeBlindPackageV1({ snapshotPath, seedPath,
      packageDir: samePackage, custodyKeyPath: sameKey })));
    assert.equal(samePackageRace.filter(x => x.status === "fulfilled").length, 1, "exclusive output lock permits only one directory publisher");
    assert.deepEqual(await verifyBlindPackageV1(samePackage), { valid: true, files: 52 });
    const sumsBeforeOverwrite = await readFile(resolve(samePackage, "SHA256SUMS"), "utf8");
    const keyBeforeOverwrite = await readFile(sameKey, "utf8");
    await assert.rejects(() => writeBlindPackageV1({ snapshotPath, seedPath, packageDir: samePackage, custodyKeyPath: sameKey }));
    assert.equal(await readFile(resolve(samePackage, "SHA256SUMS"), "utf8"), sumsBeforeOverwrite);
    assert.equal(await readFile(sameKey, "utf8"), keyBeforeOverwrite);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
