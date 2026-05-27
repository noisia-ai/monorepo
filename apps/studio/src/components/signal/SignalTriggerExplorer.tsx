"use client";

import { useMemo, useState } from "react";
import { MessageCircle } from "react-feather";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type JsonRecord = Record<string, unknown>;

type SignalTriggerExplorerProps = {
  triggers: JsonRecord[];
  mentionsSample: JsonRecord[];
  volumeTimeline: JsonRecord[];
  corpusTotal: number;
};

const COLORS = {
  ink: "#25262a",
  quiet: "#8d9094",
  grid: "rgba(37, 38, 42, 0.08)",
  signal: "#007e89",
  signalDark: "#01535f",
  tension: "#d91441",
};

export function SignalTriggerExplorer({
  triggers,
  mentionsSample,
  volumeTimeline,
  corpusTotal,
}: SignalTriggerExplorerProps) {
  const [selectedId, setSelectedId] = useState(() => stringValue(triggers[0]?.finding_id) || "0");
  const [tab, setTab] = useState<"insight" | "mentions" | "chat">("insight");
  const selected = triggers.find((trigger, index) => (stringValue(trigger.finding_id) || String(index)) === selectedId) ?? triggers[0];
  const selectedName = stringValue(selected?.finding_name) || "Trigger";
  const selectedMentions = mentionsSample.filter((mention) => stringValue(mention.finding_id) === stringValue(selected?.finding_id));
  const timeline = useMemo(() => normalizeTimeline(volumeTimeline), [volumeTimeline]);
  const share = Math.round((selectedMentions.length / Math.max(1, corpusTotal)) * 1000) / 10;
  const selectedNarrative =
    stringValue(selected?.text) ||
    stringValue(selected?.success_signal) ||
    [
      stringValue(selected?.medium) ? `Medio recomendado: ${stringValue(selected?.medium)}.` : "",
      stringValue(selected?.tone) ? `Tono sugerido: ${stringValue(selected?.tone)}.` : "",
    ].filter(Boolean).join(" ") ||
    "Este trigger requiere una descripción editorial más rica en la próxima recomposición del Signal.";

  if (triggers.length === 0) {
    return (
      <div className="signal-trigger-empty">
        <strong>Este corte no produjo triggers accionables.</strong>
        <p>El corpus está dominado por fricción. La próxima iteración debería capturar recomendación, satisfacción y casos resueltos.</p>
      </div>
    );
  }

  return (
    <div className="signal-trigger-explorer">
      <div className="signal-trigger-list" aria-label="Triggers detectados">
        {triggers.map((trigger, index) => {
          const id = stringValue(trigger.finding_id) || String(index);
          const active = id === selectedId;
          return (
            <button
              className={`signal-trigger-item${active ? " is-active" : ""}`}
              key={id}
              onClick={() => setSelectedId(id)}
              type="button"
            >
              <span>{stringValue(trigger.finding_id) || `T-${index + 1}`}</span>
              <strong>{stringValue(trigger.finding_name) || "Trigger sin nombre"}</strong>
              <small>{prettifyKey(stringValue(trigger.layer) || "sin capa")} · {stringValue(trigger.confidence) || "media"}</small>
            </button>
          );
        })}
      </div>

      <article className="signal-trigger-detail">
        <header>
          <div>
            <span>Trigger seleccionado</span>
            <h3>{selectedName}</h3>
          </div>
          <div className="signal-trigger-tabs" role="tablist">
            <button className={tab === "insight" ? "is-active" : ""} onClick={() => setTab("insight")} type="button">Insight</button>
            <button className={tab === "mentions" ? "is-active" : ""} onClick={() => setTab("mentions")} type="button">Menciones</button>
            <button className={tab === "chat" ? "is-active" : ""} onClick={() => setTab("chat")} type="button">Chat</button>
          </div>
        </header>

        {tab === "insight" && (
          <div className="signal-trigger-tab-panel">
            <div className="signal-trigger-stats">
              <Metric label="Menciones sample" value={String(selectedMentions.length)} />
              <Metric label="% corpus" value={`${share}%`} />
              <Metric label="Capa" value={prettifyKey(stringValue(selected?.layer) || "Sin capa")} />
              <Metric label="Movilidad" value={prettifyKey(stringValue(selected?.movilidad) || "Sin clasificar")} />
            </div>
            <p className="signal-trigger-copy">{selectedNarrative}</p>
            <div className="signal-trigger-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 8" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" minTickGap={26} tick={{ fill: COLORS.quiet, fontSize: 11 }} tickLine={false} />
                  <YAxis hide />
                  <Tooltip content={<MiniTooltip />} />
                  <Area
                    activeDot={{ r: 5, fill: COLORS.signalDark, stroke: "#fff", strokeWidth: 2 }}
                    dataKey="mentions"
                    dot={false}
                    fill="rgba(0,126,137,0.08)"
                    name="Volumen"
                    stroke={COLORS.signalDark}
                    strokeWidth={2}
                    type="monotone"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {tab === "mentions" && (
          <div className="signal-trigger-comments">
            {selectedMentions.length > 0 ? selectedMentions.slice(0, 5).map((mention, index) => (
              <blockquote key={stringValue(mention.mention_id) || index}>
                <span>{stringValue(mention.platform) || "Fuente"}</span>
                {truncate(stringValue(mention.text), 240)}
              </blockquote>
            )) : (
              <p>No hay verbatims de muestra asociados a este trigger en el payload publicado.</p>
            )}
          </div>
        )}

        {tab === "chat" && (
          <div className="signal-trigger-coming">
            <MessageCircle size={18} />
            <strong>Chat client-safe coming soon.</strong>
            <p>Responderá sólo con el snapshot publicado de este Signal.</p>
          </div>
        )}
      </article>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: unknown }>; label?: unknown }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="signal-chart-tooltip">
      <strong>{stringValue(label)}</strong>
      <span><i style={{ background: COLORS.signal }} /> Volumen: {formatNumber(Number(payload[0]?.value ?? 0))}</span>
    </div>
  );
}

function normalizeTimeline(rows: JsonRecord[]) {
  if (rows.length === 0) return [{ label: "Sin datos", mentions: 0 }];
  return rows.map((row) => {
    const rawMonth = stringValue(row.month);
    const date = rawMonth ? new Date(`${rawMonth}-01T00:00:00Z`) : null;
    return {
      label: date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" })
        : rawMonth || "Mes",
      mentions: Number(row.count ?? 0),
    };
  });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX").format(Number.isFinite(value) ? value : 0);
}

function prettifyKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "...";
}
