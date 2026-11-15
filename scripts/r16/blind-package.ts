import { createHash, createHmac } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export const LISTENING_COHORTS_V1 = ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10"] as const;
const DIRECTIONS = ["trigger", "barrier", "mixed", "none"] as const;
const TARGETS = ["category", "own_brand", "competitor_brand", "alternative"] as const;
const USES = ["literal", "figurative_or_ironic", "other"] as const;
const HASH_RE = /^[a-f0-9]{64}$/u;
const OMIT_KEYS = new Set(["mention_id", "root_id", "workspace_id", "corpus_id", "study_id", "run_id", "topic_key", "motive_key",
  "direction", "target", "use", "layer", "permission", "label", "answer", "expected", "prediction", "confidence", "probability",
  "cohort", "stratum", "cut_membership", "model", "assigned", "nearest_motives", "flags", "review_flags"]);

export type BlindSnapshotV1 = {
  contract_version: "r16-blind-snapshot-v1";
  exported_at: string;
  source: { export_contract: string; export_digest: string };
  study_provenance: { listening_before_digest: string; listening_after_digest: string; study_contract_version: string;
    methodology_template_version: string; methodology_template_digest: string };
  receipts: { total_cost_usd: number; total_elapsed_ms: number; stages: Array<{ stage: string; cost_usd: number; elapsed_ms: number }> };
  listening: Array<{ mention_id: string; redacted_text: string; stage: "before" | "after";
    assignments: Array<{ topic_key: string; topic_name: string; topic_definition: string; volume_cohort: string; assigned: boolean }> }>;
  study: Array<{ mention_id: string; redacted_text: string; direction: typeof DIRECTIONS[number]; target: typeof TARGETS[number];
    use: typeof USES[number]; in_cut: boolean; review_flags: string[]; motive_key?: string; motive_volume_cohort?: string;
    motive_name?: string; motive_definition?: string; layer?: string; nearest_volume_cohort?: string;
    nearest_motives?: Array<{ motive_key: string; volume_cohort: string; name: string; definition: string }> }>;
};

type CaseV1 = { blind_id: string; text: string; prompt: string; context?: string };
type PacketV1 = { contract_version: "r16-blind-packet-v1"; packet_ref: string; cases: CaseV1[] };
type KeyRow = { blind_id: string; mention_id: string; sample_code: string; stage?: string; topic_key?: string; answer: unknown };
type KeyV1 = { contract_version: "r16-blind-custody-key-v1"; seed_fingerprint: string; rows: KeyRow[] };

export function validateSnapshotV1(value: unknown): BlindSnapshotV1 {
  if (!value || typeof value !== "object") throw new Error("blind_snapshot_invalid");
  const s = value as BlindSnapshotV1;
  const fail = () => { throw new Error("blind_snapshot_invalid"); };
  if (s.contract_version !== "r16-blind-snapshot-v1" || !Number.isFinite(Date.parse(s.exported_at))
    || !s.source || typeof s.source.export_contract !== "string" || !HASH_RE.test(s.source.export_digest)
    || !s.study_provenance || !HASH_RE.test(s.study_provenance.listening_before_digest) || !HASH_RE.test(s.study_provenance.listening_after_digest)
    || s.study_provenance.study_contract_version !== "signal-study-v1" || s.study_provenance.methodology_template_version !== "r16-v1"
    || !/^sha256:[a-f0-9]{64}$/u.test(s.study_provenance.methodology_template_digest)
    || !s.receipts || !finiteNonNegative(s.receipts.total_cost_usd) || !finiteNonNegative(s.receipts.total_elapsed_ms)
    || !Array.isArray(s.receipts.stages) || !s.receipts.stages.length || s.receipts.stages.some(x => !x || typeof x.stage !== "string" || !x.stage.trim()
      || !finiteNonNegative(x.cost_usd) || !finiteNonNegative(x.elapsed_ms)) || !Array.isArray(s.listening) || !Array.isArray(s.study)) fail();
  if (new Set(s.receipts.stages.map(x => x.stage)).size !== s.receipts.stages.length
    || Math.abs(s.receipts.stages.reduce((n, x) => n + x.cost_usd, 0) - s.receipts.total_cost_usd) > .000001
    || Math.abs(s.receipts.stages.reduce((n, x) => n + x.elapsed_ms, 0) - s.receipts.total_elapsed_ms) > 1) fail();
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
  for (const row of s.study) {
    if (!(DIRECTIONS as readonly string[]).includes(row.direction) || !(TARGETS as readonly string[]).includes(row.target)
      || !(USES as readonly string[]).includes(row.use) || typeof row.in_cut !== "boolean" || !Array.isArray(row.review_flags)) fail();
    if (row.review_flags.some(f => !["false_none_candidate", "false_irony_candidate"].includes(f))) fail();
    if (row.motive_volume_cohort !== undefined && !LISTENING_COHORTS_V1.includes(row.motive_volume_cohort as typeof LISTENING_COHORTS_V1[number])) fail();
    if (row.nearest_volume_cohort !== undefined && (!LISTENING_COHORTS_V1.includes(row.nearest_volume_cohort as typeof LISTENING_COHORTS_V1[number])
      || row.nearest_motives?.length !== 4)) fail();
    if (row.nearest_motives && row.nearest_motives.length > 4) fail();
  }
  if (new Set(s.listening.map(r => `${r.mention_id}\0${r.stage}`)).size !== s.listening.length) throw new Error("blind_snapshot_duplicate_listening_identity");
  if (new Set(s.study.map(r => r.mention_id)).size !== s.study.length) throw new Error("blind_snapshot_duplicate_study_identity");
  return s;
}

function finiteNonNegative(n: number): boolean { return Number.isFinite(n) && n >= 0; }
function hash(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function rank(seed: string, code: string, id: string): string { return createHmac("sha256", seed).update(`${code}\0${id}`).digest("hex"); }
function choose<T>(rows: T[], count: number, seed: string, code: string, id: (row: T) => string): T[] {
  return [...rows].sort((a, b) => rank(seed, code, id(a)).localeCompare(rank(seed, code, id(b)))).slice(0, count);
}
function opaqueId(seed: string, code: string, mentionId: string, serial?: string): string {
  return createHmac("sha256", seed).update(`case\0${code}\0${mentionId}\0${serial ?? ""}`).digest("hex").slice(0, 24);
}
function caseRow(seed: string, code: string, mentionId: string, text: string, prompt: string, answer: unknown, context?: string, serial?: string) {
  const blind_id = opaqueId(seed, code, mentionId, serial);
  return { packet: { blind_id, text, prompt, ...(context ? { context } : {}) } as CaseV1,
    key: { blind_id, mention_id: mentionId, sample_code: code, answer } as KeyRow };
}

/** A deterministic, label-blind sampling plan. The caller writes snapshots and keys only into private .data. */
export function buildBlindPackageV1(snapshotValue: unknown, seed: string) {
  if (!seed || Buffer.byteLength(seed) < 32) throw new Error("blind_seed_too_short");
  const s = validateSnapshotV1(snapshotValue);
  const packets: PacketV1[] = [];
  const keyRows: KeyRow[] = [];
  const usedIdentities = new Set<string>();
  const census: Record<string, { quota: number; available: number; selected: number; shortfall: number }> = {};
  const publicRefs = new Map<string, string>();
  const add = (code: string, candidates: Array<{ id: string; text: string; answer: unknown; prompt: string; context?: string }>, quota: number) => {
    const ordered = [...candidates].sort((a, b) => rank(seed, `${code}:dedupe`, `${a.id}\0${JSON.stringify(a.answer)}`)
      .localeCompare(rank(seed, `${code}:dedupe`, `${b.id}\0${JSON.stringify(b.answer)}`)));
    const ids = new Set<string>();
    const unique = ordered.filter(c => !usedIdentities.has(c.id) && !ids.has(c.id) && Boolean(ids.add(c.id)));
    const selected = choose(unique, quota, seed, code, c => c.id);
    census[code] = { quota, available: unique.length, selected: selected.length, shortfall: Math.max(0, quota - selected.length) };
    const packetRef = createHmac("sha256", seed).update(`manifest-stratum\0${code}`).digest("hex").slice(0, 12);
    publicRefs.set(code, packetRef);
    const rows = selected.map(c => caseRow(seed, code, c.id, c.text, c.prompt, c.answer, c.context));
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
  const axisCandidates = [
    ["T01", t.filter(r => r.direction === "mixed"), 50, "Does this mention express both attraction and restraint, guilt, or rejection toward its target?"],
    ["T02", t.filter(r => r.target === "category"), 40, "Which target does the expressed force concern: category, own brand, competitor brand, or alternative?"],
    ["T03", t.filter(r => r.target === "own_brand"), 40, "Which target does the expressed force concern: category, own brand, competitor brand, or alternative?"],
    ["T04", t.filter(r => r.target === "competitor_brand"), 40, "Which target does the expressed force concern: category, own brand, competitor brand, or alternative?"],
    ["T05", t.filter(r => r.target === "alternative"), 40, "Which target does the expressed force concern: category, own brand, competitor brand, or alternative?"],
    ["T06", t.filter(r => r.review_flags.includes("false_irony_candidate")), 30, "Is this a literal consumption evaluation, figurative or ironic use, or other?"],
    ["T07", t.filter(r => r.direction === "none" && r.in_cut && r.review_flags.includes("false_none_candidate")), 30, "Does this mention express a trigger, barrier, mixed force, or no force?"],
    ["T08", t.filter(r => r.direction === "none" && !r.in_cut && r.review_flags.includes("false_none_candidate")), 30, "Does this mention express a trigger, barrier, mixed force, or no force?"],
  ] as const;
  for (const [code, sourceRows, quota, prompt] of axisCandidates) {
    add(code, sourceRows.map(r => ({ id: r.mention_id, text: r.redacted_text, prompt,
      answer: { direction: r.direction, target: r.target, use: r.use, in_cut: r.in_cut } })), quota);
  }

  const topMotives = [...new Set(t.filter(r => r.motive_key).map(r => r.motive_key!))].sort((a, b) => {
    const n = (key: string) => t.filter(r => r.motive_key === key).length;
    return n(b) - n(a) || hash(`${seed}:motive-order:${a}`).localeCompare(hash(`${seed}:motive-order:${b}`));
  }).slice(0, 20);
  for (let i = 0; i < 20; i++) {
    const motive = topMotives[i]; const code = `M${String(i + 1).padStart(2, "0")}`;
    const rows = motive ? t.filter(r => r.motive_key === motive && r.direction !== "none") : [];
    add(code, rows.map(r => ({ id: r.mention_id, text: r.redacted_text,
      prompt: "Does this mention belong to the described motive, and does its text support the proposed diagnostic layer?",
      context: rows.find(x => x.motive_key === motive)?.motive_name ? `Motive: ${rows.find(x => x.motive_key === motive)!.motive_name}. ${rows.find(x => x.motive_key === motive)!.motive_definition ?? ""}` : undefined,
      answer: { motive_key: motive, layer: r.layer, direction: r.direction } })), 10);
  }
  for (const cohort of LISTENING_COHORTS_V1) {
    const code = `N-${cohort}`;
    const candidates = t.filter(r => r.direction !== "none" && r.nearest_volume_cohort === cohort)
      .map(r => ({ id: r.mention_id, text: r.redacted_text, prompt: "Which of the four candidate motives, if any, best explains the force expressed in this mention?",
        context: r.nearest_motives!.map((m, i) => `${i + 1}. ${m.name}: ${m.definition}`).join("\n"),
        answer: { nearest_motives: r.nearest_motives!.map(m => m.motive_key), cohort } }));
    add(code, candidates, 20);
  }

  // Every selected source identity appears in one packet only, including across listening stages.
  const totalShortfall = Object.values(census).reduce((n, x) => n + x.shortfall, 0);
  const blindStrata = Object.fromEntries(Object.entries(census).map(([k, v]) => [publicRefs.get(k)!, v]));
  const manifest = { contract_version: "r16-blind-manifest-v1", snapshot_contract: s.contract_version,
    source_digest: s.source.export_digest, created_at: s.exported_at, seed_fingerprint: hash(seed),
    strata: blindStrata,
    completeness: totalShortfall ? "census_with_shortfalls" : "complete",
    shortfall_count: totalShortfall, receipts: s.receipts, packet_count: packets.length,
    case_count: packets.reduce((n, p) => n + p.cases.length, 0), answer_key_separate: true };
  const key: KeyV1 = { contract_version: "r16-blind-custody-key-v1", seed_fingerprint: hash(seed), rows: keyRows };
  packets.sort((a, b) => rank(seed, "packet-file-order", a.packet_ref).localeCompare(rank(seed, "packet-file-order", b.packet_ref)));
  return { packets, manifest, key };
}

export function validatePacketV1(packet: unknown): asserts packet is PacketV1 {
  const p = packet as PacketV1;
  if (!p || p.contract_version !== "r16-blind-packet-v1" || !/^[a-f0-9]{12}$/u.test(p.packet_ref) || !Array.isArray(p.cases)) throw new Error("blind_packet_invalid");
  const ids = new Set<string>();
  for (const c of p.cases) {
    if (!/^[a-f0-9]{24}$/u.test(c.blind_id) || ids.has(c.blind_id) || typeof c.text !== "string" || !c.text.trim()
      || typeof c.prompt !== "string" || !c.prompt.trim() || Object.keys(c).some(k => OMIT_KEYS.has(k))) throw new Error("blind_packet_invalid");
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
  const stagingDir = await mkdtemp(resolve(dirname(packageDir), ".blind-package-")); await chmod(stagingDir, 0o700);
  const keyTemp = `${keyPath}.${process.pid}.tmp`;
  try {
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
  await rename(stagingDir, packageDir);
  await rename(keyTemp, keyPath); await chmod(keyPath, 0o600);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    await rm(keyTemp, { force: true });
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
  const dir = resolve(packageDir); const sums = (await readFile(resolve(dir, "SHA256SUMS"), "utf8")).trim().split("\n");
  if (!sums.length || sums.some(line => !/^[a-f0-9]{64}  [a-z0-9-]+\.json$/u.test(line))) throw new Error("blind_checksums_invalid");
  let files = 0;
  const observed = new Map<string, string>();
  const observedPackets = new Map<string, PacketV1>();
  for (const line of sums) {
    const [expected, name] = line.split("  "); const contents = await readFile(resolve(dir, name), "utf8");
    if (hash(contents) !== expected) throw new Error("blind_checksum_mismatch");
    const parsed = JSON.parse(contents); if (name.startsWith("packet-")) { validatePacketV1(parsed); observedPackets.set(name, parsed); }
    observed.set(name, expected); files++;
  }
  const manifest = JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8"));
  const refs = new Set<string>();
  const strata = manifest.strata as Record<string, { quota: number; available: number; selected: number; shortfall: number }>;
  const rows = Object.values(strata ?? {});
  const expectedShortfall = rows.reduce((n, x) => n + x.shortfall, 0);
  if (manifest.contract_version !== "r16-blind-manifest-v1" || !HASH_RE.test(manifest.source_digest) || !HASH_RE.test(manifest.seed_fingerprint)
    || !Number.isFinite(Date.parse(manifest.created_at)) || !Array.isArray(manifest.packet_files) || !rows.length || manifest.answer_key_separate !== true
    || rows.some(x => !Number.isSafeInteger(x.quota) || x.quota < 1 || !Number.isSafeInteger(x.available) || x.available < 0
      || !Number.isSafeInteger(x.selected) || x.selected < 0 || x.selected > x.available || x.selected > x.quota
      || x.shortfall !== Math.max(0, x.quota - x.selected))
    || manifest.shortfall_count !== expectedShortfall || manifest.completeness !== (expectedShortfall ? "census_with_shortfalls" : "complete")
    || manifest.packet_files.some((file: { name: string; sha256: string; packet_ref: string }) => observed.get(file.name) !== file.sha256
      || !Object.hasOwn(strata, file.packet_ref) || refs.has(file.packet_ref) || !refs.add(file.packet_ref)
      || observedPackets.get(file.name)?.packet_ref !== file.packet_ref)
    || manifest.packet_files.length !== [...observed.keys()].filter(k => k.startsWith("packet-")).length) throw new Error("blind_manifest_invalid");
  if (refs.size !== Object.keys(strata).length || manifest.packet_count !== manifest.packet_files.length
    || manifest.case_count !== [...observedPackets.values()].reduce((n, packet) => n + packet.cases.length, 0)) throw new Error("blind_manifest_invalid");
  return { valid: true, files };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [, , command, ...argv] = process.argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith("--") || !argv[i + 1]) throw new Error("blind_cli_usage"); flags[argv[i].slice(2)] = argv[i + 1]; }
  if (command === "build" && flags.snapshot && flags.seed && flags.out && flags.key) {
    const result = await writeBlindPackageV1({ snapshotPath: flags.snapshot, seedPath: flags.seed, packageDir: flags.out, custodyKeyPath: flags.key });
    console.log(JSON.stringify(result)); if (!result.complete) process.exitCode = 2;
  } else if (command === "verify" && flags.package) console.log(JSON.stringify(await verifyBlindPackageV1(flags.package)));
  else throw new Error("usage: tsx scripts/r16/blind-package.ts build --snapshot <private.json> --seed <private-seed> --out <private-package-dir> --key <separate-private-key.json> | verify --package <private-package-dir>");
}
