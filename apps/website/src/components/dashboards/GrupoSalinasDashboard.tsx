"use client";

import { useMemo, useState } from "react";
import {
  applyFilters,
  BRANDS,
  DEFAULT_FILTERS,
  engagementRate,
  type Brand,
  type DateRange,
  type Filters,
  type Platform,
  type Video,
  PLATFORMS,
  formatCount,
  formatPercent,
  rankByViews,
  rankByEngagement,
  summarize,
} from "@/lib/dashboards/grupo-salinas";
import { BrandsBarChart } from "./BrandsBarChart";
import { VideoDetailDrawer } from "./VideoDetailDrawer";

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "90d", label: "90 días" },
  { key: "12m", label: "12 meses" },
  { key: "all", label: "Todo" },
];

export function GrupoSalinasDashboard({ allVideos }: { allVideos: Video[] }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Video | null>(null);

  const videos = useMemo(
    () => applyFilters(allVideos, filters),
    [allVideos, filters],
  );
  const summary = useMemo(() => summarize(videos), [videos]);

  const top = useMemo(() => rankByEngagement(videos).slice(0, 5), [videos]);
  const bottom = useMemo(() => rankByEngagement(videos).slice(-3).reverse(), [videos]);
  const mostViewed = useMemo(() => rankByViews(videos)[0], [videos]);

  const engagementByBrand = useMemo(() => {
    const map = new Map<Brand, { engagement: number; views: number }>();
    for (const v of videos) {
      const prev = map.get(v.brand) ?? { engagement: 0, views: 0 };
      prev.engagement += (v.likes + v.comments + v.shares + v.saves);
      prev.views += v.views;
      map.set(v.brand, prev);
    }
    return Array.from(map.entries())
      .map(([label, { engagement, views }]) => ({
        label,
        value: views > 0 ? engagement / views : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [videos]);

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

  function setRange(r: DateRange) {
    setFilters((f) => ({ ...f, range: r }));
  }

  return (
    <>
      {/* Date range + Platform filter bar */}
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
        <span className="db-filterbar__label" style={{ marginLeft: 4 }}>
          Plataforma
        </span>
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

      {/* Brand filter bar */}
      <div className="db-filterbar">
        <span className="db-filterbar__label">Marca</span>
        {BRANDS.map((b) => {
          const active =
            filters.brands.includes(b) || filters.brands.length === 0;
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

      {/* Top metrics */}
      <div className="db-metrics">
        <Metric label="Videos analizados" value={summary.videoCount.toString()} sub={`${PLATFORMS.length} fuentes`} />
        <Metric
          label="Reproducciones"
          value={formatCount(summary.totalViews)}
          sub={`${formatCount(summary.totalLikes)} likes · ${formatCount(summary.totalComments)} comments`}
        />
        <Metric
          label="Engagement rate"
          value={formatPercent(summary.averageEngagementRate, 2)}
          sub="promedio ponderado por views"
          accent
        />
        <Metric
          label="Completion rate"
          value={formatPercent(summary.averageCompletionRate, 0)}
          sub="% de viewers que ven el video completo"
        />
      </div>

      {/* Main grid: list + insights */}
      <div className="db-grid-2">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Top videos */}
          <div className="db-card db-section">
            <div className="db-section__head">
              <div>
                <h2 className="db-section__title">Mejor desempeño</h2>
                <p className="db-section__sub">Top 5 por engagement rate en el período seleccionado.</p>
              </div>
              <span className="db-section__hint">Click para detalle</span>
            </div>
            <div className="db-video-list">
              {top.map((v, i) => (
                <VideoRow key={v.id} video={v} rank={i + 1} onClick={() => setSelected(v)} />
              ))}
              {top.length === 0 ? (
                <EmptyState />
              ) : null}
            </div>
          </div>

          {/* Brand performance bar chart */}
          <div className="db-card db-section">
            <div className="db-section__head">
              <div>
                <h2 className="db-section__title">Engagement rate por marca</h2>
                <p className="db-section__sub">
                  Ratio de interacciones sobre views, promedio ponderado.
                </p>
              </div>
            </div>
            <BrandsBarChart
              data={engagementByBrand.map((d) => ({ label: d.label, value: d.value * 100 }))}
              height={Math.max(140, engagementByBrand.length * 32 + 40)}
            />
          </div>

          {/* Underperformers */}
          {bottom.length > 0 ? (
            <div className="db-card db-section">
              <div className="db-section__head">
                <div>
                  <h2 className="db-section__title">Necesitan revisión</h2>
                  <p className="db-section__sub">
                    Los 3 videos con menor engagement rate. Click para entender por qué.
                  </p>
                </div>
              </div>
              <div className="db-video-list">
                {bottom.map((v, i) => (
                  <VideoRow key={v.id} video={v} rank={bottom.length - i} onClick={() => setSelected(v)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Right rail */}
        <div className="db-insights">
          {mostViewed ? (
            <div className="db-card db-insight">
              <span className="db-insight__label">Mayor alcance</span>
              <span className="db-insight__metric">{formatCount(mostViewed.views)}</span>
              <span className="db-insight__text">
                <strong>{mostViewed.brand}</strong> · {mostViewed.platform} · {formatPercent(mostViewed.metrics.completionRate, 0)} completion
              </span>
            </div>
          ) : null}

          <div className="db-card db-insight db-insight--positive">
            <span className="db-insight__label">Engagement promedio</span>
            <span className="db-insight__metric">{formatPercent(summary.averageEngagementRate, 1)}</span>
            <span className="db-insight__text">
              Por encima del benchmark promedio LATAM (≈3.2%) para marcas de retail/banca.
            </span>
          </div>

          <div className="db-card db-insight">
            <span className="db-insight__label">Patrón detectado</span>
            <span className="db-insight__text">
              Los videos &lt;30s tienen{" "}
              <strong>
                {formatPercent(
                  videos.filter((v) => v.durationSeconds < 30).length > 0
                    ? videos
                        .filter((v) => v.durationSeconds < 30)
                        .reduce((s, v) => s + v.metrics.completionRate, 0) /
                        Math.max(1, videos.filter((v) => v.durationSeconds < 30).length)
                    : 0,
                  0,
                )}
              </strong>{" "}
              de completion rate. Los de &gt;60s caen a{" "}
              <strong>
                {formatPercent(
                  videos.filter((v) => v.durationSeconds >= 60).length > 0
                    ? videos
                        .filter((v) => v.durationSeconds >= 60)
                        .reduce((s, v) => s + v.metrics.completionRate, 0) /
                        Math.max(1, videos.filter((v) => v.durationSeconds >= 60).length)
                    : 0,
                  0,
                )}
              </strong>
              .
            </span>
          </div>

          <div className="db-card db-insight">
            <span className="db-insight__label">Apuesta prioritaria</span>
            <span className="db-insight__text">
              {leadingPlatform(videos)
                ? `${leadingPlatform(videos)} concentra el mayor retorno por video. Mover producción hacia formatos verticales <30s con apertura directa.`
                : "Ampliar la muestra antes de inferir patrones de plataforma."}
            </span>
          </div>
        </div>
      </div>

      <VideoDetailDrawer video={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function leadingPlatform(videos: Video[]): Platform | null {
  if (videos.length === 0) return null;
  const byPlatform = new Map<Platform, { eng: number; views: number }>();
  for (const v of videos) {
    const prev = byPlatform.get(v.platform) ?? { eng: 0, views: 0 };
    prev.eng += v.likes + v.comments + v.shares + v.saves;
    prev.views += v.views;
    byPlatform.set(v.platform, prev);
  }
  let best: Platform | null = null;
  let bestRate = 0;
  for (const [p, { eng, views }] of byPlatform) {
    const r = views > 0 ? eng / views : 0;
    if (r > bestRate) {
      best = p;
      bestRate = r;
    }
  }
  return best;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="db-card db-metric">
      <span className="db-metric__label">{label}</span>
      <div className={`db-metric__val ${accent ? "db-metric__val--accent" : ""}`}>{value}</div>
      {sub ? <span className="db-metric__sub">{sub}</span> : null}
    </div>
  );
}

function VideoRow({
  video,
  rank,
  onClick,
}: {
  video: Video;
  rank: number;
  onClick: () => void;
}) {
  const er = engagementRate(video);
  return (
    <button type="button" className="db-video-row" onClick={onClick}>
      <span className="db-video-row__rank">{rank.toString().padStart(2, "0")}</span>
      <div className="db-video-row__body">
        <span className="db-video-row__caption">{video.caption}</span>
        <div className="db-video-row__meta">
          <PlatformPill platform={video.platform} />
          <span>·</span>
          <span>{video.brand}</span>
          <span>·</span>
          <span>{formatCount(video.views)} views</span>
        </div>
      </div>
      <div className="db-video-row__stats">
        <span className="db-video-row__stat">{formatPercent(er, 1)}</span>
        <span className="db-video-row__stat-label">engagement</span>
      </div>
    </button>
  );
}

export function PlatformPill({ platform }: { platform: Platform }) {
  const cls =
    platform === "TikTok"
      ? "db-platform--tt"
      : platform === "YouTube"
        ? "db-platform--yt"
        : "db-platform--ig";
  return <span className={`db-platform ${cls}`}>{platform}</span>;
}

function EmptyState() {
  return (
    <div style={{ padding: "20px 12px", textAlign: "center", color: "var(--neutral-09)", fontSize: "0.82rem" }}>
      No hay videos en este filtro. Ajusta el rango o las plataformas.
    </div>
  );
}
