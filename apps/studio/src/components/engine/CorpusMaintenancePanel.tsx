"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { SourceToken } from "@/components/ui/SourceIcon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";

/* ============================================================
   Types
   ============================================================ */

export type Snapshot = {
  id: string;
  label: string;
  kind: string;
  mentionCount: number;
  createdAt: Date | string;
};

export type CleanupAction = {
  id: string;
  kind: string;
  instruction: string | null;
  patterns: unknown;
  claudeNotes: string | null;
  mentionCount: number;
  createdAt: Date | string;
  revertedAt: Date | string | null;
};

type Props = {
  corpusId: string;
  totalIncluded: number;
  snapshots: Snapshot[];
  cleanups: CleanupAction[];
};

type Tab = "cleanup" | "snapshots" | "history";

type PreviewResult = {
  instruction: string;
  patterns: string[];
  reasoning: string;
  match_count: number;
  sample_matches: { id: string; snippet: string; matched_pattern: string }[];
};

type SnapshotCompareResult = {
  base: Snapshot;
  compare: Snapshot;
  counts: {
    added_count: number;
    removed_count: number;
    unchanged_count: number;
  };
  examples: {
    added: SnapshotDiffExample[];
    removed: SnapshotDiffExample[];
  };
};

type SnapshotDiffExample = {
  id: string;
  text_snippet: string | null;
  text_clean: string;
  platform: string;
  published_at?: string;
  sentiment_source?: string | null;
};

/* ============================================================
   Main panel
   ============================================================ */

export function CorpusMaintenancePanel({ corpusId, totalIncluded, snapshots, cleanups }: Props) {
  const [tab, setTab] = useState<Tab>("cleanup");
  const activeCleanups = cleanups.filter((c) => !c.revertedAt);

  return (
    <section className="maintenance">
      <header className="maintenance-head">
        <div>
          <p className="maintenance-eyebrow">Mantenimiento del corpus</p>
          <h3 className="maintenance-title">Limpia, versiona y reabre el engine</h3>
        </div>
        <div className="maintenance-tabs" role="tablist">
          <TabButton active={tab === "cleanup"} onClick={() => setTab("cleanup")} icon="sparkle">
            Limpiar con AI
          </TabButton>
          <TabButton active={tab === "snapshots"} onClick={() => setTab("snapshots")} icon="star">
            Snapshots
            {snapshots.length > 0 && <span className="tab-count">{snapshots.length}</span>}
          </TabButton>
          <TabButton active={tab === "history"} onClick={() => setTab("history")} icon="refresh">
            Historial
            {activeCleanups.length > 0 && <span className="tab-count">{activeCleanups.length}</span>}
          </TabButton>
        </div>
      </header>

      <div className="maintenance-body">
        {tab === "cleanup" && <CleanupTab corpusId={corpusId} />}
        {tab === "snapshots" && (
          <SnapshotsTab
            corpusId={corpusId}
            snapshots={snapshots}
            totalIncluded={totalIncluded}
          />
        )}
        {tab === "history" && <HistoryTab corpusId={corpusId} cleanups={cleanups} />}
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: "sparkle" | "star" | "refresh";
  children: React.ReactNode;
}) {
  return (
    <button
      className={`maintenance-tab${active ? " maintenance-tab--active" : ""}`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <Icon name={icon} size={13} />
      {children}
    </button>
  );
}

/* ============================================================
   Cleanup tab — instrucción + preview + apply
   ============================================================ */

function CleanupTab({ corpusId }: { corpusId: string }) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [stage, setStage] = useState<"input" | "loading-preview" | "preview" | "applying" | "done">("input");
  const [progress, setProgress] = useState(0);
  const [applyMeta, setApplyMeta] = useState<{ patterns: number; excluded: number }>({ patterns: 0, excluded: 0 });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runPreview() {
    if (instruction.trim().length < 8) {
      setError("La instrucción debe tener al menos 8 caracteres.");
      return;
    }
    setStage("loading-preview");
    setProgress(5);
    setError(null);
    setPreview(null);

    const res = await fetch(`/api/corpora/${corpusId}/cleanup/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: instruction.trim() }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.message ?? "No se pudo iniciar el preview.");
      setStage("input");
      return;
    }
    const jobId = payload.job_id;
    const poll = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      const j = await jr.json();
      setProgress((p) => Math.max(p, j.progress ?? 0));
      if (j.status === "completed") {
        clearInterval(poll);
        setProgress(100);
        setPreview(j.result as PreviewResult);
        setStage("preview");
      } else if (j.status === "failed") {
        clearInterval(poll);
        setError(j.failed_reason ?? "El preview falló.");
        setStage("input");
      }
    }, 1200);
  }

  async function applyCleanup() {
    if (!preview) return;
    setStage("applying");
    setProgress(0);
    setApplyMeta({ patterns: preview.patterns.length, excluded: 0 });
    setError(null);

    const res = await fetch(`/api/corpora/${corpusId}/cleanup/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instruction: preview.instruction,
        patterns: preview.patterns,
        reasoning: preview.reasoning,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.message ?? "No se pudo aplicar.");
      setStage("preview");
      return;
    }

    // Poll job progress until done — real percentage from BullMQ
    const jobId = payload.job_id;
    const poll = setInterval(async () => {
      try {
        const jr = await fetch(`/api/jobs/${jobId}`);
        const j = await jr.json();
        setProgress((p) => Math.max(p, j.progress ?? 0));
        if (j.status === "completed") {
          clearInterval(poll);
          setProgress(100);
          setApplyMeta({
            patterns: preview.patterns.length,
            excluded: j.result?.excluded_count ?? 0,
          });
          setStage("done");
          // Persist the done state until the user dismisses it explicitly.
          // We still refresh server data so vital signs reflect the new count,
          // but the success card stays visible.
          router.refresh();
        } else if (j.status === "failed") {
          clearInterval(poll);
          setError(j.failed_reason ?? "El motor falló aplicando exclusiones.");
          setStage("preview");
        }
      } catch {
        // transient network blip — try again next tick
      }
    }, 1000);
  }

  function cancel() {
    setStage("input");
    setPreview(null);
    setProgress(0);
    setError(null);
  }

  if (stage === "done") {
    return (
      <div className="cleanup-done">
        <div className="cleanup-done-mark"><Icon name="check" size={28} /></div>
        <h4 className="cleanup-done-headline">Limpieza aplicada</h4>
        <p className="cleanup-done-stats">
          <strong>{fmt(applyMeta.excluded)}</strong> menciones excluidas usando{" "}
          <strong>{applyMeta.patterns}</strong> {applyMeta.patterns === 1 ? "patrón" : "patrones"}
        </p>
        <p className="cleanup-done-hint">
          Aparece en <strong>Historial</strong> con botón de revertir. El conteo de
          menciones del corpus arriba ya está actualizado.
        </p>
        <div className="cleanup-done-actions">
          <button
            className="wizard-cta"
            onClick={() => {
              setInstruction("");
              setPreview(null);
              setStage("input");
              router.refresh();
            }}
            type="button"
          >
            <Icon name="sparkle" size={14} /> Hacer otra limpieza
          </button>
          <button
            className="wizard-cta wizard-cta--ghost"
            onClick={() => {
              setInstruction("");
              setPreview(null);
              setStage("input");
              router.refresh();
            }}
            type="button"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cleanup-tab">
      <p className="maintenance-helper">
        Escribe lo que quieres remover en lenguaje natural. El motor deriva patrones
        de texto y te muestra cuántas menciones matchean antes de aplicar. Todo es
        reversible desde Historial.
      </p>

      <label className="cleanup-label">
        Instrucción
        <textarea
          className="cleanup-textarea"
          placeholder="Ej: excluye menciones sobre conciertos de BTS, política de Veracruz y el Estadio GNP. No quites menciones de aseguradoras."
          rows={4}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={stage !== "input"}
        />
      </label>

      {stage === "input" && (
        <button className="wizard-cta" onClick={runPreview} type="button">
          <Icon name="play" size={14} /> Previsualizar
        </button>
      )}

      {stage === "loading-preview" && (
        <div className="wizard-progress">
          <div className="wizard-progress-bar"><span style={{ width: `${progress}%` }} /></div>
          <p className="wizard-progress-text">
            <Icon name="spinner" className="icon--spin" size={12} /> Derivando patrones · {progress}%
          </p>
        </div>
      )}

      {stage === "preview" && preview && preview.patterns.length === 0 && (
        <div className="cleanup-empty">
          <p className="cleanup-empty-title">
            <Icon name="info" size={14} /> El motor no encontró nada que matchear
          </p>
          {preview.reasoning && (
            <p className="cleanup-empty-reason">{preview.reasoning}</p>
          )}
          <p className="cleanup-empty-hint">
            Prueba con una instrucción más específica que mencione palabras que
            efectivamente aparecen en las menciones (ej: <em>excluye menciones que digan
            BTS, ARMY o tour</em>).
          </p>
          <div className="cleanup-actions">
            <button className="wizard-cta wizard-cta--secondary" onClick={cancel} type="button">
              <Icon name="pencil" size={13} /> Reescribir instrucción
            </button>
          </div>
        </div>
      )}

      {stage === "preview" && preview && preview.patterns.length > 0 && (
        <PreviewBlock
          preview={preview}
          onApply={applyCleanup}
          onCancel={cancel}
          onRerun={runPreview}
        />
      )}

      {stage === "applying" && (
        <div className="wizard-progress">
          <div className="wizard-progress-bar"><span style={{ width: `${progress}%` }} /></div>
          <p className="wizard-progress-text">
            <Icon name="spinner" className="icon--spin" size={12} />
            {progress < 95 ? (
              <>
                Procesando patrón {Math.min(applyMeta.patterns, Math.ceil((progress / 95) * applyMeta.patterns))}/
                {applyMeta.patterns} · {progress}%
              </>
            ) : (
              <>Finalizando · {progress}%</>
            )}
          </p>
        </div>
      )}

      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}

function PreviewBlock({
  preview,
  onApply,
  onCancel,
  onRerun,
}: {
  preview: PreviewResult;
  onApply: () => void;
  onCancel: () => void;
  onRerun: () => void;
}) {
  return (
    <div className="cleanup-preview">
      <header className="cleanup-preview-head">
        <div>
          <p className="cleanup-preview-label">Preview · sin aplicar todavía</p>
          <h4 className="cleanup-preview-count">
            {fmt(preview.match_count)} {preview.match_count === 1 ? "mención matchea" : "menciones matchean"}
          </h4>
          {preview.reasoning && <p className="cleanup-preview-reason">{preview.reasoning}</p>}
        </div>
      </header>

      <div className="cleanup-patterns">
        <p className="cleanup-section-label">Patrones derivados ({preview.patterns.length})</p>
        <div className="cleanup-pattern-chips">
          {preview.patterns.map((p, i) => (
            <code className="cleanup-pattern-chip" key={i}>{p}</code>
          ))}
        </div>
      </div>

      {preview.sample_matches.length > 0 && (
        <div className="cleanup-samples">
          <p className="cleanup-section-label">Ejemplos de lo que se excluiría</p>
          <ul className="cleanup-sample-list">
            {preview.sample_matches.map((m) => (
              <li key={m.id}>
                <code className="cleanup-sample-pattern">{m.matched_pattern}</code>
                <span className="cleanup-sample-text">{m.snippet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="cleanup-actions">
        <button
          className="wizard-cta"
          disabled={preview.match_count === 0}
          onClick={onApply}
          type="button"
        >
          <Icon name="check" size={14} /> Aplicar exclusión a {fmt(preview.match_count)}
        </button>
        <button className="wizard-cta wizard-cta--secondary" onClick={onRerun} type="button">
          <Icon name="refresh" size={14} /> Refinar patrones
        </button>
        <button className="wizard-cta wizard-cta--ghost" onClick={onCancel} type="button">
          <Icon name="x" size={13} /> Cancelar
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Snapshots tab
   ============================================================ */

function SnapshotsTab({
  corpusId,
  snapshots,
  totalIncluded,
}: {
  corpusId: string;
  snapshots: Snapshot[];
  totalIncluded: number;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [baseSnapshotId, setBaseSnapshotId] = useState(snapshots[1]?.id ?? snapshots[0]?.id ?? "");
  const [compareSnapshotId, setCompareSnapshotId] = useState(snapshots[0]?.id ?? "");
  const [compare, setCompare] = useState<SnapshotCompareResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [openSnapshotPicker, setOpenSnapshotPicker] = useState<"base" | "compare" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseSnapshot = snapshots.find((s) => s.id === baseSnapshotId) ?? snapshots[1] ?? snapshots[0];
  const compareSnapshot = snapshots.find((s) => s.id === compareSnapshotId) ?? snapshots[0];

  async function create() {
    setCreating(true);
    setError(null);
    const res = await fetch(`/api/corpora/${corpusId}/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: label.trim() }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.message ?? "No se pudo crear el snapshot.");
      setCreating(false);
      return;
    }
    setLabel("");
    setCreating(false);
    router.refresh();
  }

  async function restore(snapshotId: string) {
    if (!confirm("Esto reescribe qué menciones están incluidas para que coincida con el snapshot. ¿Continuar?")) {
      return;
    }
    setRestoringId(snapshotId);
    setError(null);
    const res = await fetch(`/api/corpora/${corpusId}/snapshots/${snapshotId}/restore`, {
      method: "POST",
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.message ?? "No se pudo restaurar.");
      setRestoringId(null);
      return;
    }
    setRestoringId(null);
    router.refresh();
  }

  async function compareSnapshots() {
    if (!baseSnapshotId || !compareSnapshotId || baseSnapshotId === compareSnapshotId) {
      setError("Elige dos snapshots distintos.");
      return;
    }

    setComparing(true);
    setCompare(null);
    setError(null);
    const res = await fetch(`/api/corpora/${corpusId}/snapshots/compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        base_snapshot_id: baseSnapshotId,
        compare_snapshot_id: compareSnapshotId
      })
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.message ?? "No se pudo comparar snapshots.");
      setComparing(false);
      return;
    }
    setCompare(json as SnapshotCompareResult);
    setComparing(false);
  }

  function selectSnapshot(kind: "base" | "compare", snapshotId: string) {
    if (kind === "base") setBaseSnapshotId(snapshotId);
    if (kind === "compare") setCompareSnapshotId(snapshotId);
    setCompare(null);
    setError(null);
    setOpenSnapshotPicker(null);
  }

  return (
    <div className="snapshots-tab">
      <p className="maintenance-helper">
        Los snapshots congelan qué menciones estaban <strong>incluidas</strong> en un momento dado.
        Cada aprobación crea uno automáticamente. Restaurar uno re-incluye exactamente
        ese conjunto y excluye lo demás.
      </p>

      <div className="snapshot-create">
        <input
          className="snapshot-input"
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`Snapshot ${new Date().toISOString().slice(0, 10)}`}
          type="text"
          value={label}
        />
        <button
          className="wizard-cta wizard-cta--secondary"
          disabled={creating}
          onClick={create}
          type="button"
        >
          {creating ? (
            <><Icon name="spinner" className="icon--spin" size={14} /> Guardando…</>
          ) : (
            <><Icon name="star" size={14} /> Guardar snapshot ({fmt(totalIncluded)})</>
          )}
        </button>
      </div>

      {snapshots.length >= 2 && (
        <div className="snapshot-compare">
          <div className="snapshot-compare-head">
            <div>
              <p className="maintenance-eyebrow">Comparar snapshots</p>
              <h4>Qué entró y qué salió del corpus</h4>
            </div>
            <button
              className="wizard-cta wizard-cta--secondary"
              disabled={comparing || baseSnapshotId === compareSnapshotId}
              onClick={compareSnapshots}
              type="button"
            >
              {comparing ? (
                <><Icon name="spinner" className="icon--spin" size={13} /> Comparando…</>
              ) : (
                <><Icon name="refresh" size={13} /> Comparar</>
              )}
            </button>
          </div>
          <div className="snapshot-compare-controls">
            <SnapshotSelect
              label="Base"
              open={openSnapshotPicker === "base"}
              onOpen={() => setOpenSnapshotPicker(openSnapshotPicker === "base" ? null : "base")}
              onSelect={(snapshotId) => selectSnapshot("base", snapshotId)}
              snapshots={snapshots}
              value={baseSnapshotId}
            />
            <SnapshotSelect
              label="Comparar contra"
              open={openSnapshotPicker === "compare"}
              onOpen={() => setOpenSnapshotPicker(openSnapshotPicker === "compare" ? null : "compare")}
              onSelect={(snapshotId) => selectSnapshot("compare", snapshotId)}
              snapshots={snapshots}
              value={compareSnapshotId}
            />
          </div>
          <div className="snapshot-compare-route" aria-label="Ruta de comparación">
            <SnapshotMiniCard snapshot={baseSnapshot} />
            <Icon name="arrow-right" size={15} />
            <SnapshotMiniCard snapshot={compareSnapshot} />
          </div>
          {compare && (
            <div className="snapshot-diff">
              <SnapshotDiffNarrative compare={compare} />
              <div className="snapshot-diff-stats">
                <SnapshotDiffStat label="Agregadas" value={compare.counts.added_count} tone="good" />
                <SnapshotDiffStat label="Quitadas" value={compare.counts.removed_count} tone="warn" />
                <SnapshotDiffStat label="Sin cambio" value={compare.counts.unchanged_count} />
              </div>
              <SnapshotDiffBar compare={compare} />
              <div className="snapshot-diff-examples">
                <SnapshotExampleList
                  items={compare.examples.added}
                  title="Entraron"
                />
                <SnapshotExampleList
                  items={compare.examples.removed}
                  title="Salieron"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {snapshots.length === 0 ? (
        <p className="empty-state">Todavía no hay snapshots. Aprueba el corpus o guarda uno manual.</p>
      ) : (
        <ul className="snapshot-list">
          {snapshots.map((s) => (
            <li className="snapshot-item" key={s.id}>
              <div className="snapshot-item-main">
                <div className="snapshot-item-head">
                  <span className="snapshot-item-label">{s.label}</span>
                  {s.kind === "approval" ? (
                    <SuccessPill>Aprobación</SuccessPill>
                  ) : (
                    <StatusPill tone="idle">Manual</StatusPill>
                  )}
                </div>
                <p className="snapshot-item-meta">
                  {fmt(s.mentionCount)} menciones · {fmtDate(s.createdAt)}
                </p>
              </div>
              <button
                className="wizard-cta wizard-cta--ghost"
                disabled={restoringId === s.id}
                onClick={() => restore(s.id)}
                type="button"
              >
                {restoringId === s.id ? (
                  <><Icon name="spinner" className="icon--spin" size={13} /> Restaurando…</>
                ) : (
                  <><Icon name="refresh" size={13} /> Restaurar</>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}

function SnapshotSelect({
  label,
  open,
  onOpen,
  onSelect,
  snapshots,
  value,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  onSelect: (snapshotId: string) => void;
  snapshots: Snapshot[];
  value: string;
}) {
  const selected = snapshots.find((snapshot) => snapshot.id === value) ?? snapshots[0];

  return (
    <div className="snapshot-select">
      <span className="snapshot-select-label">{label}</span>
      <button
        aria-expanded={open}
        className="snapshot-select-trigger"
        onClick={onOpen}
        type="button"
      >
        <span className="snapshot-select-main">
          <span>{selected?.label ?? "Elige snapshot"}</span>
          {selected ? <small>{fmt(selected.mentionCount)} menciones · {fmtDate(selected.createdAt)}</small> : null}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open ? (
        <div className="snapshot-select-menu">
          {/* TODO mejora-futura: virtualizar esta lista cuando haya cientos de snapshots historicos por corpus. */}
          {snapshots.map((snapshot) => (
            <button
              className={snapshot.id === value ? "is-selected" : ""}
              key={snapshot.id}
              onClick={() => onSelect(snapshot.id)}
              type="button"
            >
              <span>
                {snapshot.label}
                <small>{snapshot.kind === "approval" ? "Aprobación" : "Manual"} · {fmtDate(snapshot.createdAt)}</small>
              </span>
              <strong>{fmt(snapshot.mentionCount)}</strong>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SnapshotMiniCard({ snapshot }: { snapshot: Snapshot | undefined }) {
  if (!snapshot) return <div className="snapshot-mini-card">Sin snapshot</div>;

  return (
    <div className="snapshot-mini-card">
      <strong>{snapshot.label}</strong>
      <span>{fmt(snapshot.mentionCount)} menciones · {fmtDate(snapshot.createdAt)}</span>
    </div>
  );
}

function SnapshotDiffNarrative({ compare }: { compare: SnapshotCompareResult }) {
  const added = compare.counts.added_count;
  const removed = compare.counts.removed_count;
  const unchanged = compare.counts.unchanged_count;
  const totalBase = unchanged + removed;
  const totalCompare = unchanged + added;
  const net = totalCompare - totalBase;
  const retainedPct = totalBase > 0 ? Math.round((unchanged / totalBase) * 100) : 100;

  return (
    <div className="snapshot-diff-narrative">
      <p className="maintenance-eyebrow">Lectura del cambio</p>
      <h5>
        {net === 0
          ? "El corpus conserva el mismo tamaño"
          : net > 0
            ? `El corpus creció en ${fmt(net)} menciones`
            : `El corpus se depuró en ${fmt(Math.abs(net))} menciones`}
      </h5>
      <p>
        Se conserva <strong>{retainedPct}%</strong> del snapshot base.{" "}
        {added > 0 ? <span>Entraron <strong>{fmt(added)}</strong> menciones nuevas. </span> : null}
        {removed > 0 ? <span>Salieron <strong>{fmt(removed)}</strong> menciones del corpus. </span> : null}
      </p>
    </div>
  );
}

function SnapshotDiffBar({ compare }: { compare: SnapshotCompareResult }) {
  const total = compare.counts.added_count + compare.counts.removed_count + compare.counts.unchanged_count;
  const unchanged = percent(compare.counts.unchanged_count, total);
  const added = percent(compare.counts.added_count, total);
  const removed = percent(compare.counts.removed_count, total);

  return (
    <div className="snapshot-diff-bar" aria-label="Distribución del cambio">
      <span className="snapshot-diff-bar-unchanged" style={{ width: `${unchanged}%` }} />
      <span className="snapshot-diff-bar-added" style={{ width: `${added}%` }} />
      <span className="snapshot-diff-bar-removed" style={{ width: `${removed}%` }} />
    </div>
  );
}

function SnapshotDiffStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className={`snapshot-diff-stat snapshot-diff-stat--${tone}`}>
      <span>{label}</span>
      <strong>{fmt(value)}</strong>
    </div>
  );
}

function SnapshotExampleList({ title, items }: { title: string; items: SnapshotDiffExample[] }) {
  return (
    <div className="snapshot-example-list">
      <h5>{title}</h5>
      {items.length === 0 ? (
        <p>No hay ejemplos en este lado del diff.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span className="snapshot-example-meta">
                <SourceToken compact value={item.platform} />
                {item.published_at ? <small>{fmtDate(item.published_at)}</small> : null}
                {item.sentiment_source ? <small>{item.sentiment_source}</small> : null}
              </span>
              <p>{item.text_snippet ?? item.text_clean}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   History tab — revert past cleanups
   ============================================================ */

function HistoryTab({ corpusId, cleanups }: { corpusId: string; cleanups: CleanupAction[] }) {
  const router = useRouter();
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revert(actionId: string) {
    setRevertingId(actionId);
    setError(null);
    const res = await fetch(`/api/corpora/${corpusId}/cleanup-actions/${actionId}/revert`, {
      method: "POST",
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.message ?? "No se pudo revertir.");
      setRevertingId(null);
      return;
    }
    setRevertingId(null);
    router.refresh();
  }

  if (cleanups.length === 0) {
    return (
      <div className="history-empty">
        <p className="empty-state">Sin acciones de limpieza. Cuando apliques una desde la pestaña <strong>Limpiar con AI</strong>, aparecerá aquí lista para revertir.</p>
      </div>
    );
  }

  return (
    <div className="history-tab">
      <ul className="cleanup-history">
        {cleanups.map((c) => {
          const patterns = Array.isArray(c.patterns) ? (c.patterns as string[]) : [];
          const isReverted = !!c.revertedAt;
          return (
            <li className={`cleanup-history-item${isReverted ? " cleanup-history-item--reverted" : ""}`} key={c.id}>
              <div className="cleanup-history-main">
                <div className="cleanup-history-head">
                  <span className="cleanup-history-count">
                    {isReverted ? (
                      <s>{fmt(c.mentionCount)}</s>
                    ) : (
                      fmt(c.mentionCount)
                    )}
                  </span>
                  <span className="cleanup-history-label">menciones excluidas</span>
                  {isReverted ? (
                    <StatusPill tone="idle">Revertida</StatusPill>
                  ) : (
                    <StatusPill tone="warn">Activa</StatusPill>
                  )}
                  <span className="cleanup-history-date">{fmtDate(c.createdAt)}</span>
                </div>
                {c.instruction && <p className="cleanup-history-instruction">{c.instruction}</p>}
                {patterns.length > 0 && (
                  <div className="cleanup-history-patterns">
                    {patterns.slice(0, 8).map((p, i) => (
                      <code className="cleanup-pattern-chip cleanup-pattern-chip--mini" key={i}>{p}</code>
                    ))}
                    {patterns.length > 8 && (
                      <span className="cleanup-history-more">+{patterns.length - 8}</span>
                    )}
                  </div>
                )}
              </div>
              {!isReverted && (
                <button
                  className="wizard-cta wizard-cta--ghost"
                  disabled={revertingId === c.id}
                  onClick={() => revert(c.id)}
                  type="button"
                >
                  {revertingId === c.id ? (
                    <><Icon name="spinner" className="icon--spin" size={13} /> Revirtiendo…</>
                  ) : (
                    <><Icon name="refresh" size={13} /> Revertir</>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}

/* ============================================================
   Helpers
   ============================================================ */

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}

function fmtDate(date: Date | string): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function percent(value: number, total: number) {
  if (total <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / total) * 100));
}
