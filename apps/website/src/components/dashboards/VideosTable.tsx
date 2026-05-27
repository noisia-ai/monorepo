"use client";

import { useMemo, useState } from "react";
import {
  applyFilters,
  BRANDS,
  DEFAULT_FILTERS,
  engagementRate,
  formatCount,
  formatDate,
  formatDuration,
  formatPercent,
  PLATFORMS,
  type Brand,
  type DateRange,
  type Filters,
  type Platform,
  type Video,
} from "@/lib/dashboards/grupo-salinas";
import { VideoDetailDrawer } from "./VideoDetailDrawer";
import { PlatformPill } from "./GrupoSalinasDashboard";

type SortKey = "publishedAt" | "views" | "engagement" | "completion";

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "12m", label: "12m" },
  { key: "all", label: "Todo" },
];

export function VideosTable({ allVideos }: { allVideos: Video[] }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>("publishedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Video | null>(null);

  const videos = useMemo(() => {
    const list = applyFilters(allVideos, filters);
    const sorted = [...list].sort((a, b) => {
      const av = getSortValue(a, sort);
      const bv = getSortValue(b, sort);
      return direction === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [allVideos, filters, sort, direction]);

  function setRange(r: DateRange) {
    setFilters((f) => ({ ...f, range: r }));
  }
  function togglePlatform(p: Platform) {
    setFilters((f) => ({
      ...f,
      platforms: f.platforms.includes(p)
        ? f.platforms.filter((x) => x !== p)
        : [...f.platforms, p],
    }));
  }
  function toggleBrand(b: Brand) {
    setFilters((f) => ({
      ...f,
      brands: f.brands.includes(b)
        ? f.brands.filter((x) => x !== b)
        : [...f.brands, b],
    }));
  }
  function changeSort(key: SortKey) {
    if (sort === key) {
      setDirection(direction === "asc" ? "desc" : "asc");
    } else {
      setSort(key);
      setDirection("desc");
    }
  }

  return (
    <>
      <div className="db-filterbar">
        <span className="db-filterbar__label">Período</span>
        <div className="db-filterbar__group">
          {DATE_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`db-chip ${filters.range === r.key ? "is-active" : ""}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="db-filterbar__label" style={{ marginLeft: 4 }}>Plataforma</span>
        <div className="db-filterbar__group">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              className={`db-chip ${filters.platforms.includes(p) || filters.platforms.length === 0 ? "is-active" : ""}`}
              onClick={() => togglePlatform(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="db-filterbar">
        <span className="db-filterbar__label">Marca</span>
        {BRANDS.map((b) => {
          const active = filters.brands.includes(b) || filters.brands.length === 0;
          return (
            <button
              key={b}
              type="button"
              className={`db-chip db-chip--brand ${active ? "is-active" : ""}`}
              onClick={() => toggleBrand(b)}
            >
              {b}
            </button>
          );
        })}
      </div>

      <div className="db-card" style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ background: "var(--surface-01)" }}>
              <Th label="Caption" />
              <Th label="Marca / Cuenta" />
              <Th label="Plataforma" />
              <Th label="Publicado" sortable active={sort === "publishedAt"} dir={direction} onClick={() => changeSort("publishedAt")} />
              <Th label="Duración" />
              <Th label="Views" sortable active={sort === "views"} dir={direction} onClick={() => changeSort("views")} align="right" />
              <Th label="Engagement" sortable active={sort === "engagement"} dir={direction} onClick={() => changeSort("engagement")} align="right" />
              <Th label="Completion" sortable active={sort === "completion"} dir={direction} onClick={() => changeSort("completion")} align="right" />
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => (
              <tr
                key={v.id}
                onClick={() => setSelected(v)}
                style={{ cursor: "pointer", borderTop: "1px solid var(--neutral-03)" }}
              >
                <Td>
                  <div style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                    {v.caption}
                  </div>
                </Td>
                <Td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontWeight: 700 }}>{v.brand}</span>
                    <span style={{ color: "var(--neutral-09)", fontSize: "0.74rem" }}>{v.account}</span>
                  </div>
                </Td>
                <Td>
                  <PlatformPill platform={v.platform} />
                </Td>
                <Td>{formatDate(v.publishedAt)}</Td>
                <Td>{formatDuration(v.durationSeconds)}</Td>
                <Td align="right">{formatCount(v.views)}</Td>
                <Td align="right">{formatPercent(engagementRate(v), 2)}</Td>
                <Td align="right">{formatPercent(v.metrics.completionRate, 0)}</Td>
              </tr>
            ))}
            {videos.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 30, textAlign: "center", color: "var(--neutral-09)" }}>
                  No hay videos en este filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <VideoDetailDrawer video={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function getSortValue(v: Video, key: SortKey): number {
  switch (key) {
    case "publishedAt":
      return new Date(v.publishedAt).getTime();
    case "views":
      return v.views;
    case "engagement":
      return engagementRate(v);
    case "completion":
      return v.metrics.completionRate;
  }
}

function Th({
  label,
  sortable,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  sortable?: boolean;
  active?: boolean;
  dir?: "asc" | "desc";
  onClick?: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      onClick={sortable ? onClick : undefined}
      style={{
        textAlign: align ?? "left",
        fontSize: "0.66rem",
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--neutral-09)",
        padding: "10px 14px",
        cursor: sortable ? "pointer" : "default",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {sortable && active ? <span>{dir === "asc" ? " ↑" : " ↓"}</span> : null}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td style={{ padding: "11px 14px", textAlign: align ?? "left", verticalAlign: "middle" }}>
      {children}
    </td>
  );
}
