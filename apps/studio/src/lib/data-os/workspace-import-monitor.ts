/** Cancelling a status reader never mutates the server-side import. */
export type ImportStatusSnapshot = { id: string; status: string; phase?: string };
export function isImportTerminal(value: ImportStatusSnapshot) {
  return value.status === "completed" || value.status === "failed";
}
export function replaceMonitoredImport<T extends ImportStatusSnapshot>(current: T | null, next: T) {
  if (current?.id !== next.id) return current;
  // A finalize response can arrive after a newer polling response.
  if (isImportTerminal(current) && current.status !== next.status) return current;
  if (current.status === "processing" && next.status === "queued") return current;
  return next;
}
export function canConfirmImportUpload(item: ImportStatusSnapshot) {
  return item.status === "queued" && item.phase === "uploading";
}
/** Reuses the stored file and import ID, including after a page reload. */
export async function confirmWorkspaceImportUpload<T extends ImportStatusSnapshot>(args: {
  url: string; importId: string; transport?: typeof fetch;
}) {
  const response = await (args.transport ?? fetch)(args.url, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `complete-upload:${args.importId}` },
    body: JSON.stringify({ action: "complete-upload" })
  });
  const payload = await response.json() as { import?: T; error?: string };
  if (!response.ok || !payload.import) throw new Error(payload.error ?? "import_finalize_unavailable");
  if (payload.import.id !== args.importId) throw new Error("import_status_identity_mismatch");
  return payload.import;
}
export async function pollWorkspaceImport<T extends ImportStatusSnapshot>(args: {
  url: string;
  importId: string;
  signal: AbortSignal;
  onProgress: (item: T) => void;
  transport?: typeof fetch;
  pause?: (signal: AbortSignal) => Promise<void>;
}) {
  const transport = args.transport ?? fetch;
  const pause = args.pause ?? ((signal) => waitForImportPoll(signal, 1_500));
  while (!args.signal.aborted) {
    const response = await transport(args.url, { cache: "no-store", signal: args.signal });
    const payload = await response.json() as { import?: T };
    args.signal.throwIfAborted();
    if (!response.ok || !payload.import) throw new Error("import_status_unavailable");
    if (payload.import.id !== args.importId) throw new Error("import_status_identity_mismatch");
    args.onProgress(payload.import);
    if (isImportTerminal(payload.import)) return payload.import;
    await pause(args.signal);
  }
  args.signal.throwIfAborted();
  throw new Error("import_status_unavailable");
}
export function waitForImportPoll(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { window.clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
