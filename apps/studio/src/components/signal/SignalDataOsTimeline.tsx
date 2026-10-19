"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { useSignalUiLanguage } from "@/components/signal/SignalReportShell";
import { Icon } from "@/components/ui/Icon";
import type { SignalDataOsTimelineModel } from "@/lib/data-os/signal-timeline";

export function SignalDataOsTimeline({ model }: { model: SignalDataOsTimelineModel }) {
  const { uiLanguage: language } = useSignalUiLanguage();
  const [metricKey, setMetricKey] = useState(model.metrics[0]?.key ?? "");
  const metric = model.metrics.find((candidate) => candidate.key === metricKey) ?? model.metrics[0];
  const chartData = useMemo(() => model.points.map((point) => ({
    month: point.month,
    label: monthLabel(point.month, language),
    mentions: point.mentions,
    metric: metric ? point.values[metric.key] : null
  })), [language, metric, model.points]);

  if (!metric) return null;

  const copy = language === "es" ? {
    eyebrow: "Data OS · cruce gobernado",
    title: "Conversación y resultado de negocio",
    compare: "Comparar con",
    mentions: "Menciones",
    months: "meses comparables",
    note: "Series agregadas de observaciones aceptadas. La coincidencia temporal no implica causalidad."
  } : {
    eyebrow: "Data OS · governed join",
    title: "Conversation and business outcome",
    compare: "Compare with",
    mentions: "Mentions",
    months: "comparable months",
    note: "Aggregated accepted observations. Temporal association does not imply causality."
  };

  return (
    <section className="signal-data-os-timeline" aria-labelledby="signal-data-os-title">
      <header className="signal-data-os-timeline__header">
        <div className="signal-data-os-timeline__title">
          <span><Icon name="layers" size={14} />{copy.eyebrow}</span>
          <h3 id="signal-data-os-title">{copy.title}</h3>
          <small>{model.overlappingMonths} {copy.months}</small>
        </div>
        <label className="signal-data-os-timeline__metric">
          <span>{copy.compare}</span>
          <select value={metric.key} onChange={(event) => setMetricKey(event.target.value)}>
            {model.metrics.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
      </header>

      <div className="signal-data-os-timeline__chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 18, right: 18, bottom: 8, left: 4 }}>
            <CartesianGrid stroke="rgba(37, 38, 42, 0.08)" strokeDasharray="2 8" vertical={false} />
            <XAxis axisLine={false} dataKey="label" minTickGap={24} tick={{ fill: "#8d9094", fontSize: 12 }} tickLine={false} />
            <YAxis axisLine={false} tick={{ fill: "#8d9094", fontSize: 11 }} tickLine={false} yAxisId="mentions" width={48} />
            <YAxis axisLine={false} orientation="right" tick={{ fill: "#8d9094", fontSize: 11 }} tickFormatter={(value) => compactNumber(Number(value))} tickLine={false} width={54} yAxisId="metric" />
            <Tooltip
              contentStyle={{ border: "1px solid rgba(37,38,42,.1)", borderRadius: 8, boxShadow: "0 18px 42px rgba(37,38,42,.12)" }}
              formatter={(value, name) => [
                name === metric.label ? formatMetric(Number(value), metric.unit, language) : compactNumber(Number(value)),
                name
              ]}
            />
            <Line activeDot={{ r: 5 }} dataKey="mentions" dot={{ r: 3 }} name={copy.mentions} stroke="#25262a" strokeWidth={2} type="monotone" yAxisId="mentions" />
            <Line activeDot={{ r: 5 }} connectNulls={false} dataKey="metric" dot={{ r: 3 }} name={metric.label} stroke="#007e89" strokeWidth={2.5} type="monotone" yAxisId="metric" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <footer>
        <span><i className="signal-data-os-timeline__legend signal-data-os-timeline__legend--mentions" />{copy.mentions}</span>
        <span><i className="signal-data-os-timeline__legend signal-data-os-timeline__legend--metric" />{metric.label}</span>
        <p><Icon name="info" size={14} />{copy.note}</p>
      </footer>
    </section>
  );
}

function monthLabel(value: string, language: "en" | "es") {
  const date = new Date(`${value}-01T00:00:00Z`);
  return new Intl.DateTimeFormat(language === "es" ? "es-MX" : "en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC"
  }).format(date);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatMetric(value: number, unit: string | null, language: "en" | "es") {
  if (unit?.toUpperCase() === "MXN") {
    return new Intl.NumberFormat(language === "es" ? "es-MX" : "en-US", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0
    }).format(value);
  }
  if (unit === "ratio") return new Intl.NumberFormat(language === "es" ? "es-MX" : "en-US", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
  return new Intl.NumberFormat(language === "es" ? "es-MX" : "en-US", { maximumFractionDigits: 1 }).format(value);
}
