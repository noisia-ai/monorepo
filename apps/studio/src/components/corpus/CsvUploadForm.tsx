"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type UploadStats = {
  record_count: number;
  included_count: number;
  excluded_count: number;
  duplicate_count: number;
};

type UploadResult = {
  import_batch_id: string;
  stats: UploadStats;
};

export function CsvUploadForm({
  corpusId,
  onSuccess,
}: {
  corpusId: string;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = fileRef.current?.files?.[0];

    if (!file) {
      setErrorMsg("Selecciona un archivo CSV.");
      return;
    }

    setStatus("uploading");
    setErrorMsg(null);
    setResult(null);

    const formData = new FormData(form);

    try {
      const res = await fetch(`/api/corpora/${corpusId}/mentions/csv-upload`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        setErrorMsg(json?.message ?? `Error ${res.status}`);
        setStatus("error");
        return;
      }

      setResult(json as UploadResult);
      setStatus("success");
      form.reset();
      router.refresh();
      onSuccess?.();
    } catch {
      setErrorMsg("No se pudo conectar con el servidor.");
      setStatus("error");
    }
  }

  return (
    <div className="upload-panel">
      <form className="upload-box" onSubmit={handleSubmit}>
        <label>
          <span>Archivo CSV SentiOne</span>
          <input accept=".csv,text/csv" name="file" ref={fileRef} required type="file" />
        </label>
        <label>
          <span>Etiqueta interna</span>
          <input defaultValue="sentione_export" name="source_label" />
        </label>
        <button disabled={status === "uploading"} type="submit">
          {status === "uploading" ? "Importando…" : "Importar CSV"}
        </button>
      </form>

      <p className="helper-copy">
        El parser acepta delimitador punto y coma, conserva metadata cruda y excluye
        automaticamente textos menores a 30 caracteres.
      </p>

      {status === "error" && errorMsg && (
        <p className="upload-feedback upload-feedback--error">{errorMsg}</p>
      )}

      {status === "success" && result && (
        <div className="upload-feedback upload-feedback--success">
          <p>
            <strong>Importacion completada.</strong> Batch:{" "}
            <code>{result.import_batch_id.slice(0, 8)}…</code>
          </p>
          <ul className="upload-stats">
            <li>
              <span>Total</span> <strong>{result.stats.record_count}</strong>
            </li>
            <li>
              <span>Incluidas</span> <strong>{result.stats.included_count}</strong>
            </li>
            <li>
              <span>Excluidas</span> <strong>{result.stats.excluded_count}</strong>
            </li>
            <li>
              <span>Duplicadas</span> <strong>{result.stats.duplicate_count}</strong>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
