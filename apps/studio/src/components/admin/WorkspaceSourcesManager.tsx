"use client";

import { ArrowRight, FileCsv, Plus, UploadSimple } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { AdminSettingsRow, AdminStatus, formatAdminDate, formatAdminNumber } from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import { buildAdminWorkspacePrimarySourceInput } from "@/lib/data-os/admin-workspace-source-contract";
import type { AdminWorkspaceImport, AdminWorkspaceSource } from "@/lib/data/admin-workspace";

type DrawerState =
  | { mode: "create" }
  | { mode: "import"; source: AdminWorkspaceSource;retryOf?: string }
  | { mode: "history"; source: AdminWorkspaceSource }
  | null;

export function WorkspaceSourcesManager({
  imports,
  sources,
  workspaceId
}: {
  imports: AdminWorkspaceImport[];
  sources: AdminWorkspaceSource[];
  workspaceId: string;
}) {
  const t = useTranslations("AdminWorkspace");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: string;
    percent: number | null;
    recordsProcessed: number;
    records?: number;
    included?: number;
    excluded?: number;
    duplicates?: number;
    failureCode?: string | null;
  } | null>(null);
  const [history, setHistory] = useState<AdminWorkspaceImport[] | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const uploadRef = useRef<{ abort: () => void | Promise<void> } | null>(null);
  const createKeyRef = useRef<string | null>(null);
  const importKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const importsBySource = useMemo(() => {
    const grouped = new Map<string, AdminWorkspaceImport[]>();
    for (const item of imports) grouped.set(item.sourceId, [...(grouped.get(item.sourceId) ?? []), item]);
    return grouped;
  }, [imports]);

  useEffect(() => {
    if (searchParams.get("action") === "add-source") setDrawer({ mode: "create" });
  }, [searchParams]);

  useEffect(() => () => {
    requestRef.current?.abort();
    void uploadRef.current?.abort();
  }, []);

  const closeDrawer = () => {
    if (busy) return;
    requestRef.current?.abort();
    void uploadRef.current?.abort();
    setDrawer(null);
    setError(null);
    setResult(null);
    setHistory(null);
  };

  const createSource = async (form: FormData) => {
    beginRequest();
    createKeyRef.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/data-os/signal/${workspaceId}/sources`, {
        body: JSON.stringify(buildAdminWorkspacePrimarySourceInput({
          name: String(form.get("name") ?? ""),
          provider: String(form.get("provider") ?? "")
        })),
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createKeyRef.current },
        method: "POST",
        signal: requestRef.current?.signal
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("data.errors.create"));
      createKeyRef.current = null;
      setDrawer(null);
      router.refresh();
    } catch (requestError) {
      if (!isAbort(requestError)) setError(requestError instanceof Error ? requestError.message : t("data.errors.create"));
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async (source: AdminWorkspaceSource, form: FormData) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError(t("data.errors.fileRequired"));
      return;
    }
    beginRequest();
    setResult(null);
    let createdImport: ImportCreatePayload | null = null;
    let requestKey: string | null = null;
    try {
      const fingerprint = `${source.id}:${file.name}:${file.size}:${file.lastModified}`;
      if (importKeyRef.current?.fingerprint !== fingerprint) {
        importKeyRef.current = { fingerprint,key: crypto.randomUUID() };
      }
      requestKey = importKeyRef.current.key;
      const createResponse = await fetch(
        `/api/data-os/signal/${workspaceId}/sources/${source.id}/imports`,{
          body: JSON.stringify({
            action: "create-upload",file_name: file.name,file_size_bytes: file.size,
            content_type: file.type || "text/csv",
            supersedes_import_batch_id: drawer?.mode==="import" ? drawer.retryOf ?? null : null
          }),
          cache: "no-store",
          headers: { "Content-Type": "application/json","Idempotency-Key": importKeyRef.current.key },
          method: "POST",signal: requestRef.current?.signal
        }
      );
      const created = await createResponse.json() as ImportCreatePayload;
      createdImport = created;
      if (!createResponse.ok || !created.import) {
        throw new Error(created.message ?? t("data.errors.import"));
      }
      if (created.upload) {
        setResult({ status: "uploading",percent: 0,recordsProcessed: 0 });
        await uploadMultipartSigned(file,created.upload,(percent) => {
          setResult({ status: "uploading",percent,recordsProcessed: 0 });
        },uploadRef);
      }
      const finalizeResponse = await fetch(created.polling_url,{
        body: JSON.stringify({ action: "complete-upload" }),cache: "no-store",
        headers: { "Content-Type": "application/json","Idempotency-Key": `${importKeyRef.current.key}:finalize` },
        method: "POST",signal: requestRef.current?.signal
      });
      const finalized = await finalizeResponse.json() as ImportPollPayload;
      if (!finalizeResponse.ok) throw new Error(finalized.message ?? t("data.errors.import"));
      setResult(fromImportStatus(finalized.import));
      setBusy(false);
      const terminal = await pollWorkspaceImport(created.polling_url,requestRef.current?.signal,(item) => {
        setResult(fromImportStatus(item));
      });
      setResult(fromImportStatus(terminal));
      importKeyRef.current = null;
      router.refresh();
    } catch (requestError) {
      if (createdImport?.import && createdImport.polling_url && requestKey) {
        const failureCode = isAbort(requestError) ? "upload_aborted" : "upload_transport_failed";
        const failed = await reportWorkspaceUploadFailure(
          createdImport.polling_url,requestKey,failureCode
        );
        if (failed) setResult(fromImportStatus(failed));
      }
      if (!isAbort(requestError)) setError(requestError instanceof Error ? requestError.message : t("data.errors.import"));
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (source: AdminWorkspaceSource) => {
    setDrawer({ mode: "history", source });
    setHistory(importsBySource.get(source.id) ?? []);
    beginRequest();
    try {
      const response = await fetch(`/api/data-os/signal/${workspaceId}/sources/${source.id}/imports`, {
        cache: "no-store",
        signal: requestRef.current?.signal
      });
      const payload = await response.json() as {
        message?: string;
        imports?: Array<ImportStatusPayload>;
      };
      if (!response.ok) throw new Error(payload.message ?? t("data.errors.history"));
      setHistory((payload.imports ?? []).map((item) => ({
        id: item.id,
        sourceId: source.id,
        sourceFileName: item.source_file_name,
        status: item.status,phase: item.phase,
        records: Number(item.final_counts?.record_count ?? 0),
        included: Number(item.final_counts?.included_count ?? 0),
        excluded: Number(item.final_counts?.excluded_count ?? 0),
        duplicates: Number(item.final_counts?.duplicate_count ?? 0),
        progressRecords: item.progress.records_processed,
        progressBytes: item.progress.bytes_processed,
        totalBytes: item.progress.bytes_total,
        failureCode: item.failure?.code ?? null,
        supersedesImportBatchId: item.supersedes_import_batch_id,
        createdAt: item.created_at
      })));
    } catch (requestError) {
      if (!isAbort(requestError)) setError(requestError instanceof Error ? requestError.message : t("data.errors.history"));
    } finally {
      setBusy(false);
    }
  };

  const cancelIncompleteUpload = async (source: AdminWorkspaceSource,item: AdminWorkspaceImport) => {
    setBusy(true);setError(null);
    try {
      const pollingUrl = `/api/data-os/signal/${workspaceId}/sources/${source.id}/imports/${item.id}`;
      const failed = await reportWorkspaceUploadFailure(
        pollingUrl,crypto.randomUUID(),"upload_aborted"
      );
      if (!failed) throw new Error(t("data.errors.import"));
      setDrawer({ mode: "import",source,retryOf: item.id });
      setResult(fromImportStatus(failed));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("data.errors.import"));
    } finally { setBusy(false); }
  };

  const retryFromStorage = async (source: AdminWorkspaceSource,item: AdminWorkspaceImport) => {
    beginRequest();
    try {
      const response=await fetch(
        `/api/data-os/signal/${workspaceId}/sources/${source.id}/imports/${item.id}`,
        {
          body: JSON.stringify({ action: "retry-from-storage" }),cache: "no-store",
          headers: { "Content-Type": "application/json","Idempotency-Key": crypto.randomUUID() },
          method: "POST",signal: requestRef.current?.signal
        }
      );
      const payload=await response.json() as ImportPollPayload & { polling_url?: string };
      if (!response.ok || !payload.polling_url) {
        throw new Error(payload.message ?? t("data.errors.import"));
      }
      const updateHistory=(next: ImportStatusPayload) => setHistory((current)=>{
        if (!current) return null;
        const replacement=historyImport(source.id,next);
        const exists=current.some((entry)=>entry.id===next.id);
        return exists
          ? current.map((entry)=>entry.id===next.id ? replacement : entry)
          : [replacement,...current];
      });
      updateHistory(payload.import);
      setBusy(false);
      const terminal=await pollWorkspaceImport(
        payload.polling_url,requestRef.current?.signal,updateHistory
      );
      updateHistory(terminal);router.refresh();
    } catch (requestError) {
      if (!isAbort(requestError)) {
        setError(requestError instanceof Error ? requestError.message : t("data.errors.import"));
      }
    } finally { setBusy(false); }
  };

  const beginRequest = () => {
    requestRef.current?.abort();
    requestRef.current = new AbortController();
    setBusy(true);
    setError(null);
  };

  return (
    <>
      <section className="admin-section">
        <header className="admin-section__head">
          <div><h2>{t("data.sources.title")}</h2><p>{t("data.sources.subtitle")}</p></div>
          <button className="admin-button admin-button--primary" onClick={() => setDrawer({ mode: "create" })} type="button">
            <Plus aria-hidden size={15} weight="bold" />{t("data.actions.addSource")}
          </button>
        </header>
        {sources.length === 0 ? (
          <div className="admin-empty">
            <strong>{t("data.sources.emptyTitle")}</strong>
            <p>{t("data.sources.emptyBody")}</p>
            <button className="admin-button" onClick={() => setDrawer({ mode: "create" })} type="button">{t("data.actions.addSource")}</button>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-table--sources">
              <thead><tr>
                <th>{t("data.columns.source")}</th>
                <th>{t("data.columns.scope")}</th>
                <th>{t("data.columns.status")}</th>
                <th>{t("data.columns.freshness")}</th>
                <th>{t("data.columns.lastImport")}</th>
                <th>{t("data.columns.results")}</th>
                <th aria-label={t("data.columns.actions")} />
              </tr></thead>
              <tbody>{sources.map((source) => (
                <tr key={source.id}>
                  <td><div className="admin-table__primary"><strong>{source.name}</strong><small>{source.provider} · {source.connectionMethod}</small></div></td>
                  <td><AdminStatus state={source.scopeReviewStatus === "approved" ? "good" : "warning"}>{source.scope ?? t("states.not_available")}</AdminStatus></td>
                  <td><AdminStatus state={source.status === "active" ? "good" : "warning"}>{t(`states.${source.status}`)}</AdminStatus></td>
                  <td><AdminStatus state={freshnessTone(source.freshnessState)}>{t(`states.${source.freshnessState}`)}</AdminStatus></td>
                  <td className="admin-table__muted">{formatAdminDate(source.latestImport?.createdAt, locale)}</td>
                  <td>{source.latestImport ? t("data.resultSummary", {
                    included: source.latestImport.included,
                    duplicates: source.latestImport.duplicates
                  }) : "—"}</td>
                  <td>
                    <div className="admin-workspace-actions">
                      <button className="admin-button" onClick={() => void openHistory(source)} type="button">{t("data.actions.history")}</button>
                      <button className="admin-button" onClick={() => setDrawer({ mode: "import", source })} type="button"><UploadSimple aria-hidden size={14} />{t("data.actions.import")}</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {drawer?.mode === "create" ? (
        <WorkspaceDrawer
          ariaLabel={t("data.create.title")}
          closeLabel={t("actions.close")}
          eyebrow={t("data.eyebrow")}
          onClose={closeDrawer}
          title={t("data.create.title")}
        >
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createSource(new FormData(event.currentTarget));
            }}
          >
            <p className="admin-table__muted">{t("data.create.body")}</p>
            <label className="workspace-field"><span>{t("data.create.name")}</span><input className="workspace-control" maxLength={200} name="name" required /></label>
            <label className="workspace-field"><span>{t("data.create.provider")}</span><input className="workspace-control" defaultValue="sentione" maxLength={120} name="provider" required /></label>
            <div className="admin-settings-list admin-form__metadata">
              <AdminSettingsRow title={t("data.create.sourceType")} value={t("data.create.listeningCsv")} />
              <AdminSettingsRow title={t("data.create.connection")} value={t("data.create.manualUpload")} />
              <AdminSettingsRow description={t("data.create.scopeHelp")} title={t("data.create.scope")} value={t("data.create.primaryBrand")} />
            </div>
            {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
            <button className="admin-button admin-button--primary" disabled={busy} type="submit">{busy ? t("actions.saving") : t("data.actions.create")}</button>
          </form>
        </WorkspaceDrawer>
      ) : null}

      {drawer?.mode === "import" ? (
        <WorkspaceDrawer
          ariaLabel={t("data.import.title", { source: drawer.source.name })}
          closeLabel={t("actions.close")}
          eyebrow={drawer.source.name}
          onClose={closeDrawer}
          title={t("data.import.title", { source: drawer.source.name })}
        >
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              void importCsv(drawer.source, new FormData(event.currentTarget));
            }}
          >
            <p className="admin-table__muted">{t("data.import.body")}</p>
            <label className="workspace-field"><span>{t("data.import.file")}</span><input className="workspace-control workspace-control--file" accept=".csv,text/csv" name="file" required type="file" /><small>{t("data.import.fileHelp")}</small></label>
            {result?.status === "completed" ? (
              <dl className="admin-definition-list">
                <div><dt>{t("data.import.records")}</dt><dd>{formatAdminNumber(result.records ?? 0, locale)}</dd></div>
                <div><dt>{t("data.import.included")}</dt><dd>{formatAdminNumber(result.included ?? 0, locale)}</dd></div>
                <div><dt>{t("data.import.excluded")}</dt><dd>{formatAdminNumber(result.excluded ?? 0, locale)}</dd></div>
                <div><dt>{t("data.import.duplicates")}</dt><dd>{formatAdminNumber(result.duplicates ?? 0, locale)}</dd></div>
              </dl>
            ) : null}
            {result && result.status !== "completed" ? (
              <div className="admin-status-card" aria-live="polite">
                <AdminStatus state={result.status==="failed" ? "danger" : "warning"}>{t(`data.import.status.${result.status}`)}</AdminStatus>
                <p className="admin-table__muted">{result.percent==null
                  ? t("data.import.recordsProcessed",{ count: result.recordsProcessed })
                  : t("data.import.progress",{ percent: result.percent,count: result.recordsProcessed })}</p>
              </div>
            ) : null}
            {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
            <button className="admin-button admin-button--primary" disabled={busy} type="submit"><FileCsv aria-hidden size={15} />{busy ? t("data.import.uploading") : t("data.actions.import")}</button>
          </form>
        </WorkspaceDrawer>
      ) : null}

      {drawer?.mode === "history" ? (
        <WorkspaceDrawer
          ariaLabel={t("data.history.title", { source: drawer.source.name })}
          closeLabel={t("actions.close")}
          eyebrow={drawer.source.name}
          onClose={closeDrawer}
          title={t("data.history.title", { source: drawer.source.name })}
        >
          {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
          {busy && !history ? <p className="admin-table__muted">{t("data.history.loading")}</p> : null}
          {history?.length === 0 ? <div className="admin-empty"><strong>{t("data.history.empty")}</strong></div> : null}
          {history && history.length > 0 ? (
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>{t("data.history.file")}</th><th>{t("data.columns.results")}</th></tr></thead>
              <tbody>{history.map((item) => (
                <tr key={item.id}>
                  <td><div className="admin-table__primary"><strong>{item.sourceFileName ?? t("data.history.unnamed")}</strong><small>{formatAdminDate(item.createdAt, locale)} · {t(`data.import.status.${item.status}`)}</small></div></td>
                  <td>{item.status==="completed"
                    ? <span>{t("data.history.counts", { records: item.records, included: item.included, excluded: item.excluded, duplicates: item.duplicates })}</span>
                    : <div className="admin-table__primary"><span>{item.status==="failed" && item.totalBytes && (item.progressBytes ?? 0)>=item.totalBytes ? t("data.import.finalValidationFailed") : t("data.import.recordsProcessed",{ count: item.progressRecords ?? 0 })}</span>{item.status==="failed" ? <button className="admin-button admin-button--plain" disabled={busy} onClick={() => void retryFromStorage(drawer.source,item)} type="button">{t("data.import.retryFromStorage")}</button> : null}{item.status==="queued" && item.phase==="uploading" ? <button className="admin-button admin-button--plain" disabled={busy} onClick={() => void cancelIncompleteUpload(drawer.source,item)} type="button">{t("data.import.cancelUpload")}</button> : null}</div>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : null}
          <button className="admin-button" onClick={() => setDrawer({ mode: "import", source: drawer.source })} type="button">{t("data.actions.import")}<ArrowRight aria-hidden size={14} /></button>
        </WorkspaceDrawer>
      ) : null}
    </>
  );
}

async function reportWorkspaceUploadFailure(
  pollingUrl: string,
  idempotencyKey: string,
  failureCode: "upload_aborted" | "upload_transport_failed"
) {
  try {
    const response = await fetch(pollingUrl,{
      body: JSON.stringify({ action: "fail-upload",failure_code: failureCode }),
      cache: "no-store",
      headers: { "Content-Type": "application/json","Idempotency-Key": `${idempotencyKey}:upload-failed` },
      method: "POST"
    });
    const payload = await response.json() as ImportPollPayload;
    return response.ok ? payload.import : null;
  } catch { return null; }
}

function freshnessTone(state: string) {
  if (state === "fresh") return "good" as const;
  if (state === "failed") return "danger" as const;
  if (state === "stale" || state === "partial") return "warning" as const;
  return "not_available" as const;
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

type ImportStatusPayload = {
  id: string;
  status: string;
  phase: string;
  source_file_name: string | null;
  supersedes_import_batch_id: string | null;
  progress: {
    records_processed: number;bytes_processed: number;bytes_total: number | null;percent: number | null;
  };
  final_counts: {
    record_count: number;included_count: number;excluded_count: number;duplicate_count: number;
  } | null;
  failure: { code: string;recoverable: boolean } | null;
  created_at: string;
};

type ImportCreatePayload = {
  message?: string;
  import?: ImportStatusPayload;
  polling_url: string;
  upload: {
    bucket: string;part_size_bytes: number;
    parts: Array<{
      part_number: number;expected_size_bytes: number;upload_url: string;
    }>;
  } | null;
};

type ImportPollPayload = { message?: string;import: ImportStatusPayload };

async function uploadMultipartSigned(
  file: File,
  authority: NonNullable<ImportCreatePayload["upload"]>,
  onProgress: (percent: number) => void,
  uploadRef: { current: { abort: () => void | Promise<void> } | null }
) {
  let completedBytes = 0;
  for (const part of authority.parts) {
    const slice = file.slice(completedBytes,completedBytes+part.expected_size_bytes,file.type);
    await uploadSignedPart(file,slice,part,completedBytes,onProgress,uploadRef);
    completedBytes+=part.expected_size_bytes;
    onProgress(Math.min(99,Math.floor((completedBytes/file.size)*100)));
  }
  if (completedBytes!==file.size) throw new Error("Multipart upload size mismatch.");
}

function uploadSignedPart(
  file: File,
  slice: Blob,
  part: NonNullable<ImportCreatePayload["upload"]>["parts"][number],
  completedBytes: number,
  onProgress: (percent: number) => void,
  uploadRef: { current: { abort: () => void | Promise<void> } | null }
) {
  return new Promise<void>((resolve,reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled=true;uploadRef.current=null;
      if (error) reject(error);else resolve();
    };
    request.open("PUT",part.upload_url,true);
    request.setRequestHeader("x-upsert","false");
    request.upload.onprogress = (event) => onProgress(Math.min(
      99,Math.floor(((completedBytes+event.loaded)/file.size)*100)
    ));
    request.onerror = () => finish(new Error(`Signed upload transport failed (${request.status}).`));
    request.onabort = () => finish(new DOMException("Upload aborted.","AbortError"));
    request.onload = () => request.status>=200 && request.status<300
      ? finish()
      : finish(new Error(`Signed upload failed (${request.status}).`));
    const body = new FormData();
    body.append("cacheControl","3600");
    const partFile = new File(
      [slice],`${file.name}.part-${String(part.part_number).padStart(5,"0")}`,
      { type: file.type || "text/csv" }
    );
    body.append("",partFile);
    uploadRef.current = { abort: () => request.abort() };
    try { request.send(body); }
    catch (error) { finish(error instanceof Error ? error : new Error("Signed upload request failed.")); }
  });
}

async function pollWorkspaceImport(
  pollingUrl: string,
  signal: AbortSignal | undefined,
  onProgress: (item: ImportStatusPayload) => void
) {
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted","AbortError");
    const response = await fetch(pollingUrl,{ cache: "no-store",signal });
    const payload = await response.json() as ImportPollPayload;
    if (!response.ok) throw new Error(payload.message ?? "Import status is unavailable.");
    onProgress(payload.import);
    if (["completed","failed"].includes(payload.import.status)) return payload.import;
    await new Promise<void>((resolve,reject) => {
      const timer = window.setTimeout(resolve,1_500);
      signal?.addEventListener("abort",() => {
        window.clearTimeout(timer);reject(new DOMException("Aborted","AbortError"));
      },{ once: true });
    });
  }
}

function fromImportStatus(item: ImportStatusPayload) {
  return {
    status: item.status,
    percent: item.progress.percent,
    recordsProcessed: item.progress.records_processed,
    records: item.final_counts?.record_count,
    included: item.final_counts?.included_count,
    excluded: item.final_counts?.excluded_count,
    duplicates: item.final_counts?.duplicate_count,
    failureCode: item.failure?.code
  };
}

function historyImport(sourceId: string,item: ImportStatusPayload): AdminWorkspaceImport {
  return {
    id: item.id,sourceId,sourceFileName: item.source_file_name,status: item.status,
    phase: item.phase,records: Number(item.final_counts?.record_count ?? 0),
    included: Number(item.final_counts?.included_count ?? 0),
    excluded: Number(item.final_counts?.excluded_count ?? 0),
    duplicates: Number(item.final_counts?.duplicate_count ?? 0),
    progressRecords: item.progress.records_processed,
    progressBytes: item.progress.bytes_processed,
    totalBytes: item.progress.bytes_total,
    failureCode: item.failure?.code ?? null,
    supersedesImportBatchId: item.supersedes_import_batch_id,
    createdAt: item.created_at
  };
}
