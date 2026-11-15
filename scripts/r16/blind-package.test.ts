import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildBlindPackageV1, LISTENING_COHORTS_V1, validatePacketV1, verifyBlindPackageV1, writeBlindPackageV1 } from "./blind-package.js";

const seed = "synthetic-seed-for-r16-blind-package-tests-2026";
const digest = "a".repeat(64);
function syntheticSnapshot() {
  const listening = [] as Array<{ mention_id: string; redacted_text: string; stage: "before" | "after";
    assignments: Array<{ topic_key: string; topic_name: string; topic_definition: string; volume_cohort: string; assigned: boolean }> }>;
  for (const stage of ["before", "after"] as const) for (const cohort of LISTENING_COHORTS_V1) {
    for (let i = 0; i < 55; i++) listening.push({ mention_id: `listen-${stage}-${cohort}-${i}`, redacted_text: `synthetic mention ${stage} ${cohort} ${i}`,
      stage, assignments: [{ topic_key: `topic-${cohort}`, topic_name: `Synthetic topic ${cohort}`, topic_definition: "Synthetic definition", volume_cohort: cohort, assigned: i % 2 === 0 }] });
  }
  const study = [] as Array<{ mention_id: string; redacted_text: string; direction: "trigger" | "barrier" | "mixed" | "none";
    target: "category" | "own_brand" | "competitor_brand" | "alternative"; use: "literal" | "figurative_or_ironic" | "other";
    in_cut: boolean; review_flags: string[]; motive_key?: string; motive_volume_cohort?: string; motive_name?: string; motive_definition?: string; nearest_volume_cohort?: string;
    layer?: string; nearest_motives?: Array<{ motive_key: string; volume_cohort: string; name: string; definition: string }> }>;
  const add = (id: string, overrides: Partial<(typeof study)[number]> = {}) => study.push({ mention_id: id, redacted_text: `synthetic study mention ${id}`,
    direction: "trigger", target: "category", use: "literal", in_cut: true, review_flags: [], ...overrides });
  for (const dir of ["mixed", "barrier", "trigger"] as const) for (let i = 0; i < 80; i++) add(`axis-${dir}-${i}`, { direction: dir });
  for (const target of ["own_brand", "competitor_brand", "alternative"] as const) for (let i = 0; i < 50; i++) add(`target-${target}-${i}`, { target });
  for (let i = 0; i < 35; i++) add(`false-irony-${i}`, { review_flags: ["false_irony_candidate"] });
  for (let i = 0; i < 35; i++) add(`false-none-in-${i}`, { direction: "none", review_flags: ["false_none_candidate"] });
  for (let i = 0; i < 35; i++) add(`false-none-out-${i}`, { direction: "none", in_cut: false, review_flags: ["false_none_candidate"] });
  for (let motive = 0; motive < 20; motive++) for (let i = 0; i < 15; i++) add(`motive-${motive}-${i}`, { motive_key: `m${motive}`, motive_name: `Motive ${motive}`,
    motive_definition: "Synthetic motive", motive_volume_cohort: LISTENING_COHORTS_V1[motive % 10], layer: "social",
    nearest_motives: LISTENING_COHORTS_V1.slice(0, 4).map((c, n) => ({ motive_key: `n${n}`, volume_cohort: c, name: `Candidate ${n}`, definition: "Synthetic candidate" })) });
  for (const cohort of LISTENING_COHORTS_V1) for (let i = 0; i < 25; i++) add(`nearest-${cohort}-${i}`, { nearest_volume_cohort: cohort, nearest_motives:
    LISTENING_COHORTS_V1.slice(0, 4).map((c, n) => ({ motive_key: `n${n}`, volume_cohort: c, name: `Candidate ${n}`, definition: "Synthetic candidate" })) });
  return { contract_version: "r16-blind-snapshot-v1" as const, exported_at: "2026-11-14T12:00:00.000Z", source: { export_contract: "synthetic-v1", export_digest: digest },
    study_provenance: { listening_before_digest: digest, listening_after_digest: "b".repeat(64), study_contract_version: "signal-study-v1",
      methodology_template_version: "r16-v1", methodology_template_digest: `sha256:${"c".repeat(64)}` },
    receipts: { total_cost_usd: 0, total_elapsed_ms: 0, stages: [{ stage: "synthetic", cost_usd: 0, elapsed_ms: 0 }] }, listening, study };
}

test("same synthetic snapshot and custody seed produce identical blind packets and key", () => {
  const snapshot = syntheticSnapshot();
  const a = buildBlindPackageV1(snapshot, seed); const b = buildBlindPackageV1(snapshot, seed);
  assert.deepEqual(a, b);
  assert.equal(a.packets.length, 58);
  assert.ok(a.packets.every(packet => { validatePacketV1(packet); return packet.cases.every(row => !("mention_id" in row)); }));
  assert.equal(a.manifest.completeness, "complete");
});

test("private answer key carries identity and labels while blind payloads omit them", () => {
  const built = buildBlindPackageV1(syntheticSnapshot(), seed);
  assert.ok(built.packets.flatMap(packet => packet.cases).every(row => !Object.keys(row).some(key => /mention_id|sample_code|answer|direction|target|use|layer|cohort|stratum/u.test(key))));
  assert.ok(!("mention_id" in built.manifest) && !("sample_code" in built.manifest));
  assert.ok(built.key.rows.some(row => row.sample_code === "T01" && (row.answer as { direction?: string }).direction === "mixed"));
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
  assert.equal(built.manifest.strata && Object.keys(built.manifest.strata).length, 58);
});

test("invalid receipts, duplicate source identities, and weak seeds fail closed", () => {
  const snapshot = syntheticSnapshot();
  assert.throws(() => buildBlindPackageV1(snapshot, "short"), /seed_too_short/);
  const duplicate = syntheticSnapshot(); duplicate.study.push({ ...duplicate.study[0]! });
  assert.throws(() => buildBlindPackageV1(duplicate, seed), /duplicate_study_identity/);
  const invalid = syntheticSnapshot(); invalid.receipts.total_cost_usd = Number.NaN;
  assert.throws(() => buildBlindPackageV1(invalid, seed), /snapshot_invalid/);
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
    await writeBlindPackageV1({ snapshotPath, seedPath, packageDir, custodyKeyPath: keyPath });
    assert.deepEqual(await verifyBlindPackageV1(packageDir), { valid: true, files: 59 });
    const sums = await readFile(resolve(packageDir, "SHA256SUMS"), "utf8");
    assert.doesNotMatch(sums, /answer-key/u);
    assert.equal((await stat(packageDir)).mode & 0o777, 0o700);
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
    const firstPacket = resolve(packageDir, "packet-01.json");
    const saved = await readFile(firstPacket, "utf8");
    await writeFile(firstPacket, `${saved}tamper`);
    await assert.rejects(() => verifyBlindPackageV1(packageDir), /checksum_mismatch/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
