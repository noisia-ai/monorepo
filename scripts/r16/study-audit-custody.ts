import { createHash } from "node:crypto";
import { mkdir, open, readFile, lstat, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { canonicalJsonDigestV1 } from "./private-json-stream.js";

const CONTRACT = "r16-study-audit-freeze-v1" as const;
const SHA = /^sha256:[a-f0-9]{64}$/u;
const HEX64 = /^[a-f0-9]{64}$/u;
const DEFAULT_PRIVATE_ROOT = resolve(".data/piloto-masivo/r16");
const hash = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export type StudyFreezeResultRefV1 = { role: "snapshot" | "source_manifest" | "native_receipt"; path: string; sha256: string };
export type StudyFreezeHumanRefV1 = { key: string; role: "human_audit_answers" | "auditor_answers"; path: string; expected_sha256?: string };
export type StudyFreezeV1 = {
  contract_version: typeof CONTRACT;
  created_at: string;
  study_ref: { study_id: string; execution_id: string; source_digest: string; output_digest: string };
  allowed_human_root: string;
  result_refs: StudyFreezeResultRefV1[];
  human_refs: StudyFreezeHumanRefV1[];
  seal_sha256: string;
};
type NativeExportManifestV2 = {
  contract_version: "r16-native-audit-source-manifest-v2"; study_id: string; study_execution_id: string;
  study_execution_status: "completed"; study_source_digest: string;
  source_digests: { study_output: string; study_output_verified_digest: string };
};

function inRoot(path: string, root: string): boolean {
  const rel = relative(root, resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`);
}
function fail(message: string): never { throw new Error(message); }
function digestSeal(value: Omit<StudyFreezeV1, "seal_sha256">): string {
  return hash(JSON.stringify(value));
}
function validateFreeze(value: unknown, privateRoot: string): StudyFreezeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("study_freeze_invalid");
  const seal = value as StudyFreezeV1;
  if (seal.contract_version !== CONTRACT || !Number.isFinite(Date.parse(seal.created_at))
    || !seal.study_ref || !seal.study_ref.study_id?.trim() || !seal.study_ref.execution_id?.trim()
    || !SHA.test(seal.study_ref.source_digest) || !SHA.test(seal.study_ref.output_digest)
    || !inRoot(seal.allowed_human_root, privateRoot)
    || !Array.isArray(seal.result_refs) || !seal.result_refs.length || !Array.isArray(seal.human_refs)
    || !SHA.test(seal.seal_sha256)) fail("study_freeze_invalid");
  const resultPaths = new Set<string>(), resultRoles = new Set<string>();
  for (const ref of seal.result_refs) {
    if (!ref || !["snapshot", "source_manifest", "native_receipt"].includes(ref.role) || !inRoot(ref.path, privateRoot)
      || !SHA.test(ref.sha256) || resultPaths.has(resolve(ref.path))) fail("study_freeze_result_ref_invalid");
    resultPaths.add(resolve(ref.path));
    resultRoles.add(ref.role);
  }
  if (!resultRoles.has("snapshot") || !resultRoles.has("source_manifest")) fail("study_freeze_result_refs_incomplete");
  const humanKeys = new Set<string>(), humanPaths = new Set<string>();
  for (const ref of seal.human_refs) {
    if (!ref || !/^[a-z][a-z0-9_-]{0,63}$/u.test(ref.key) || !["human_audit_answers", "auditor_answers"].includes(ref.role)
      || !inRoot(ref.path, seal.allowed_human_root) || ref.expected_sha256 !== undefined && !SHA.test(ref.expected_sha256)
      || humanKeys.has(ref.key) || humanPaths.has(resolve(ref.path)) || resultPaths.has(resolve(ref.path))) fail("study_freeze_human_ref_invalid");
    humanKeys.add(ref.key); humanPaths.add(resolve(ref.path));
  }
  const { seal_sha256, ...body } = seal;
  if (digestSeal(body) !== seal_sha256) fail("study_freeze_seal_digest_mismatch");
  return seal;
}

async function rejectSymlinks(path: string): Promise<void> {
  const absolute = resolve(path), parts = absolute.split(sep).filter(Boolean);
  let cursor = absolute.startsWith(sep) ? sep : "";
  for (const part of parts) {
    cursor = cursor ? resolve(cursor, part) : part;
    try { if ((await lstat(cursor)).isSymbolicLink()) fail("study_freeze_symlink_rejected"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
async function assertPrivateRegularFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("study_freeze_file_permissions_invalid");
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("study_freeze_directory_permissions_invalid");
}

async function assertPrivateParents(path: string, privateRoot: string): Promise<void> {
  let cursor = dirname(resolve(path));
  while (cursor === privateRoot || inRoot(cursor, privateRoot)) {
    await assertPrivateDirectory(cursor);
    if (cursor === privateRoot) return;
    cursor = dirname(cursor);
  }
  fail("study_freeze_paths_must_be_private");
}

async function ensurePrivateParents(path: string, privateRoot: string): Promise<void> {
  const parent = dirname(resolve(path));
  if (parent !== privateRoot && !inRoot(parent, privateRoot)) fail("study_freeze_paths_must_be_private");
  const missing: string[] = [];
  let cursor = parent;
  while (cursor !== privateRoot) {
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) fail("study_freeze_directory_permissions_invalid");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(cursor);
      cursor = dirname(cursor);
    }
  }
  for (const directory of missing.reverse()) {
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await assertPrivateDirectory(directory);
    }
  }
  await assertPrivateParents(path, privateRoot);
}

function parsedObject(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("study_freeze_export_invalid");
  return value as Record<string, unknown>;
}

function bindExport(snapshotBytes: Uint8Array, manifestBytes: Uint8Array): StudyFreezeV1["study_ref"] {
  const snapshot = parsedObject(snapshotBytes), manifest = parsedObject(manifestBytes);
  const source = snapshot.source as { export_contract?: unknown; export_digest?: unknown } | undefined;
  const exported = manifest as unknown as NativeExportManifestV2;
  if (source?.export_contract !== "r16-native-audit-export-v2" || typeof source.export_digest !== "string" || !HEX64.test(source.export_digest)
    || exported.contract_version !== "r16-native-audit-source-manifest-v2" || exported.study_execution_status !== "completed"
    || typeof exported.study_id !== "string" || !exported.study_id.trim()
    || typeof exported.study_execution_id !== "string" || !exported.study_execution_id.trim()
    || !SHA.test(exported.study_source_digest) || !SHA.test(exported.source_digests?.study_output)
    || exported.source_digests.study_output !== exported.source_digests.study_output_verified_digest
    || canonicalJsonDigestV1(manifest).slice("sha256:".length) !== source.export_digest) fail("study_freeze_export_binding_invalid");
  return { study_id: exported.study_id, execution_id: exported.study_execution_id,
    source_digest: exported.study_source_digest, output_digest: exported.source_digests.study_output };
}

export async function sealStudyFreezeV1(args: {
  seal_path: string; result_refs: StudyFreezeResultRefV1[];
  allowed_human_root: string; human_refs: StudyFreezeHumanRefV1[]; private_root?: string; now?: () => Date;
}): Promise<StudyFreezeV1> {
  const privateRoot = resolve(args.private_root ?? DEFAULT_PRIVATE_ROOT), sealPath = resolve(args.seal_path);
  if (!inRoot(sealPath, privateRoot)) fail("study_freeze_paths_must_be_private");
  const allowedHumanRoot = resolve(args.allowed_human_root);
  if (!inRoot(allowedHumanRoot, privateRoot)) fail("study_freeze_paths_must_be_private");
  for (const ref of args.result_refs) if (!inRoot(ref.path, privateRoot)) fail("study_freeze_paths_must_be_private");
  for (const ref of args.human_refs) if (!inRoot(ref.path, allowedHumanRoot)) fail("study_freeze_human_path_outside_allowed_root");
  const resultRefs = args.result_refs.map(ref => ({ ...ref, path: resolve(ref.path) }));
  const snapshotRef = resultRefs.find(ref => ref.role === "snapshot"), manifestRef = resultRefs.find(ref => ref.role === "source_manifest");
  if (!snapshotRef || !manifestRef) fail("study_freeze_result_refs_incomplete");
  await rejectSymlinks(dirname(sealPath));
  await ensurePrivateParents(sealPath, privateRoot);
  await assertDisjointPaths([sealPath, ...resultRefs.map(ref => ref.path), ...args.human_refs.map(ref => resolve(ref.path))]);
  for (const ref of resultRefs) { await assertPrivateParents(ref.path, privateRoot); await assertPrivateRegularFile(ref.path); }
  for (const ref of args.human_refs) { await assertPrivateParents(resolve(ref.path), privateRoot); await assertPrivateRegularFile(resolve(ref.path)); }
  await assertPrivateDirectory(allowedHumanRoot);
  const snapshotBytes = new Uint8Array(await readFile(snapshotRef.path)), manifestBytes = new Uint8Array(await readFile(manifestRef.path));
  if (hash(snapshotBytes) !== snapshotRef.sha256 || hash(manifestBytes) !== manifestRef.sha256) fail("study_freeze_result_digest_mismatch");
  const studyRef = bindExport(snapshotBytes, manifestBytes);
  const body: Omit<StudyFreezeV1, "seal_sha256"> = { contract_version: CONTRACT, created_at: (args.now?.() ?? new Date()).toISOString(),
    study_ref: studyRef, allowed_human_root: allowedHumanRoot,
    result_refs: resultRefs,
    human_refs: args.human_refs.map(ref => ({ ...ref, path: resolve(ref.path) })) };
  const freeze = validateFreeze({ ...body, seal_sha256: digestSeal(body) }, privateRoot);
  await rejectSymlinks(dirname(sealPath));
  await assertPrivateParents(sealPath, privateRoot);
  const handle = await open(sealPath, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(freeze, null, 2)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  return freeze;
}

async function loadAndSyncSeal(sealPath: string, privateRoot: string): Promise<StudyFreezeV1> {
  if (!inRoot(sealPath, privateRoot)) fail("study_freeze_paths_must_be_private");
  await rejectSymlinks(sealPath);
  const handle = await open(sealPath, "r+");
  let bytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0) fail("study_freeze_permissions_invalid");
    bytes = await handle.readFile();
    await handle.sync();
  } finally { await handle.close(); }
  return validateFreeze(JSON.parse(bytes!.toString("utf8")), privateRoot);
}

export async function verifyStudyFreezeV1(args: { seal_path: string; private_root?: string;
  read_bytes?: (path: string) => Promise<Uint8Array> }): Promise<{ valid: true; seal: StudyFreezeV1 }> {
  const privateRoot = resolve(args.private_root ?? DEFAULT_PRIVATE_ROOT);
  const seal = await loadAndSyncSeal(resolve(args.seal_path), privateRoot);
  const read = args.read_bytes ?? (async path => new Uint8Array(await readFile(path)));
  const verifiedBytes = new Map<string, Uint8Array>();
  for (const ref of seal.result_refs) {
    await rejectSymlinks(ref.path);
    await assertPrivateRegularFile(ref.path);
    const bytes = await read(ref.path);
    if (hash(bytes) !== ref.sha256) fail("study_freeze_result_digest_mismatch");
    verifiedBytes.set(ref.path, bytes);
  }
  const snapshot = seal.result_refs.find(ref => ref.role === "snapshot")!, manifest = seal.result_refs.find(ref => ref.role === "source_manifest")!;
  const snapshotBytes = verifiedBytes.get(snapshot.path)!, manifestBytes = verifiedBytes.get(manifest.path)!;
  const bound = bindExport(snapshotBytes, manifestBytes);
  if (JSON.stringify(bound) !== JSON.stringify(seal.study_ref)) fail("study_freeze_export_binding_mismatch");
  return { valid: true, seal };
}

async function assertDisjointPaths(paths: string[]): Promise<void> {
  const canonicalPaths = new Set<string>(), inodeIdentities = new Set<string>();
  for (const path of paths) {
    await rejectSymlinks(path);
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
    const canonical = info ? await realpath(path) : resolve(await realpath(dirname(path)), basename(path));
    const inode = info ? `${info.dev}:${info.ino}` : null;
    if (canonicalPaths.has(canonical) || (inode && inodeIdentities.has(inode))) fail("study_freeze_paths_must_be_disjoint");
    canonicalPaths.add(canonical);
    if (inode) inodeIdentities.add(inode);
  }
}

async function appendSynced(path: string, value: Record<string, unknown>, forbiddenPaths: string[]): Promise<void> {
  const handle = await open(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0) fail("study_freeze_receipt_permissions_invalid");
    for (const forbidden of forbiddenPaths) {
      const target = await stat(forbidden);
      if (target.dev === info.dev && target.ino === info.ino) fail("study_freeze_paths_must_be_disjoint");
    }
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await handle.close(); }
}

export async function readBoundReferenceV1(args: { seal_path: string; reference_key: string; receipt_path: string;
  private_root?: string; read_bytes?: (path: string) => Promise<Uint8Array>; now?: () => Date }): Promise<{ bytes: Uint8Array; sha256: string }> {
  const privateRoot = resolve(args.private_root ?? DEFAULT_PRIVATE_ROOT), receiptPath = resolve(args.receipt_path);
  if (!inRoot(receiptPath, privateRoot)) fail("study_freeze_paths_must_be_private");
  const sealPath = resolve(args.seal_path);
  await rejectSymlinks(dirname(receiptPath));
  await ensurePrivateParents(receiptPath, privateRoot);
  await assertPrivateDirectory(dirname(receiptPath));
  const preliminary = await loadAndSyncSeal(sealPath, privateRoot);
  await assertDisjointPaths([sealPath, ...preliminary.result_refs.map(ref => ref.path), ...preliminary.human_refs.map(ref => ref.path), receiptPath]);
  for (const ref of preliminary.result_refs) await assertPrivateRegularFile(ref.path);
  for (const ref of preliminary.human_refs) await assertPrivateRegularFile(ref.path);
  const verified = await verifyStudyFreezeV1({ seal_path: args.seal_path, private_root: privateRoot, read_bytes: args.read_bytes });
  const ref = verified.seal.human_refs.find(item => item.key === args.reference_key);
  if (!ref) fail("study_freeze_reference_not_bound");
  await rejectSymlinks(ref.path);
  await assertPrivateRegularFile(ref.path);
  await rejectSymlinks(receiptPath);
  try { await assertPrivateRegularFile(receiptPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const receiptBase = { contract_version: "r16-study-audit-reference-read-v1", seal_sha256: verified.seal.seal_sha256,
    reference_key: ref.key, reference_role: ref.role,
    read_at: (args.now?.() ?? new Date()).toISOString() };
  const protectedPaths = [sealPath, ...verified.seal.result_refs.map(item => item.path), ...verified.seal.human_refs.map(item => item.path)];
  await appendSynced(receiptPath, { ...receiptBase, status: "intent" }, protectedPaths);
  const bytes = await (args.read_bytes ?? (async path => new Uint8Array(await readFile(path))))(ref.path);
  const completedDigest = hash(bytes);
  const completedExpectedMatch = ref.expected_sha256 === undefined ? null : completedDigest === ref.expected_sha256;
  await appendSynced(receiptPath, { ...receiptBase, reference_sha256: completedDigest,
    expected_digest_match: completedExpectedMatch, status: "completed" }, protectedPaths);
  if (completedExpectedMatch === false) fail("study_freeze_human_reference_digest_mismatch");
  return { bytes, sha256: completedDigest };
}
