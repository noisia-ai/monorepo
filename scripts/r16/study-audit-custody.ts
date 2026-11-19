import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, lstat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const CONTRACT = "r16-study-audit-freeze-v1" as const;
const SHA = /^sha256:[a-f0-9]{64}$/u;
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

export async function sealStudyFreezeV1(args: {
  seal_path: string; study_ref: StudyFreezeV1["study_ref"]; result_refs: StudyFreezeResultRefV1[];
  allowed_human_root: string; human_refs: StudyFreezeHumanRefV1[]; private_root?: string; now?: () => Date;
}): Promise<StudyFreezeV1> {
  const privateRoot = resolve(args.private_root ?? DEFAULT_PRIVATE_ROOT), sealPath = resolve(args.seal_path);
  if (!inRoot(sealPath, privateRoot)) fail("study_freeze_paths_must_be_private");
  const allowedHumanRoot = resolve(args.allowed_human_root);
  if (!inRoot(allowedHumanRoot, privateRoot)) fail("study_freeze_paths_must_be_private");
  for (const ref of args.result_refs) if (!inRoot(ref.path, privateRoot)) fail("study_freeze_paths_must_be_private");
  for (const ref of args.human_refs) if (!inRoot(ref.path, allowedHumanRoot)) fail("study_freeze_human_path_outside_allowed_root");
  const body: Omit<StudyFreezeV1, "seal_sha256"> = { contract_version: CONTRACT, created_at: (args.now?.() ?? new Date()).toISOString(),
    study_ref: args.study_ref, allowed_human_root: allowedHumanRoot,
    result_refs: args.result_refs.map(ref => ({ ...ref, path: resolve(ref.path) })),
    human_refs: args.human_refs.map(ref => ({ ...ref, path: resolve(ref.path) })) };
  const freeze = validateFreeze({ ...body, seal_sha256: digestSeal(body) }, privateRoot);
  await rejectSymlinks(dirname(sealPath));
  await mkdir(dirname(sealPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(sealPath), 0o700);
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
  for (const ref of seal.result_refs) {
    await rejectSymlinks(ref.path);
    await assertPrivateRegularFile(ref.path);
    const bytes = await read(ref.path);
    if (hash(bytes) !== ref.sha256) fail("study_freeze_result_digest_mismatch");
  }
  return { valid: true, seal };
}

export async function readBoundReferenceV1(args: { seal_path: string; reference_key: string; receipt_path: string;
  private_root?: string; read_bytes?: (path: string) => Promise<Uint8Array>; now?: () => Date }): Promise<{ bytes: Uint8Array; sha256: string }> {
  const privateRoot = resolve(args.private_root ?? DEFAULT_PRIVATE_ROOT), receiptPath = resolve(args.receipt_path);
  if (!inRoot(receiptPath, privateRoot)) fail("study_freeze_paths_must_be_private");
  const verified = await verifyStudyFreezeV1({ seal_path: args.seal_path, private_root: privateRoot, read_bytes: args.read_bytes });
  const ref = verified.seal.human_refs.find(item => item.key === args.reference_key);
  if (!ref) fail("study_freeze_reference_not_bound");
  await rejectSymlinks(ref.path);
  await assertPrivateRegularFile(ref.path);
  const bytes = await (args.read_bytes ?? (async path => new Uint8Array(await readFile(path))))(ref.path);
  const actual = hash(bytes);
  const expectedDigestMatch = ref.expected_sha256 === undefined ? null : actual === ref.expected_sha256;
  await rejectSymlinks(dirname(receiptPath));
  await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(receiptPath), 0o700);
  await rejectSymlinks(receiptPath);
  try { await assertPrivateRegularFile(receiptPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const receipt = { contract_version: "r16-study-audit-reference-read-v1", seal_sha256: verified.seal.seal_sha256,
    reference_key: ref.key, reference_role: ref.role, reference_sha256: actual, expected_digest_match: expectedDigestMatch,
    read_at: (args.now?.() ?? new Date()).toISOString() };
  const handle = await open(receiptPath, "a", 0o600);
  try { await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  if (expectedDigestMatch === false) fail("study_freeze_human_reference_digest_mismatch");
  return { bytes, sha256: actual };
}
