"use client";

import { useEffect } from "react";
import {
  engagementRate,
  formatCount,
  formatDate,
  formatDuration,
  formatPercent,
  relativeDays,
  type Video,
} from "@/lib/dashboards/grupo-salinas";
import { RetentionChart } from "./RetentionChart";
import { EvolutionChart } from "./EvolutionChart";
import { PlatformPill } from "./GrupoSalinasDashboard";

export function VideoDetailDrawer({
  video,
  onClose,
}: {
  video: Video | null;
  onClose: () => void;
}) {
  // ESC closes the drawer
  useEffect(() => {
    if (!video) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [video, onClose]);

  const open = video !== null;

  return (
    <>
      <div
        className={`db-drawer-backdrop ${open ? "is-open" : ""}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`db-drawer ${open ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del video"
      >
        <header className="db-drawer__head">
          <h2 className="db-drawer__title">Detalle del video</h2>
          <button
            type="button"
            className="db-drawer__close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>

        {video ? (
          <div className="db-drawer__body">
            <div className="db-drawer__meta">
              <PlatformPill platform={video.platform} />
              <span className="db-tag">{video.brand}</span>
              <span className="db-tag">{video.account}</span>
              <span className="db-tag">
                {formatDate(video.publishedAt)} · hace {relativeDays(video.publishedAt)}d
              </span>
              <span className="db-tag">{formatDuration(video.durationSeconds)}</span>
            </div>

            <p className="db-drawer__caption">{video.caption}</p>

            {/* Primary metrics */}
            <div className="db-drawer__primary">
              <MetricCell label="Views" value={formatCount(video.views)} />
              <MetricCell label="Likes" value={formatCount(video.likes)} />
              <MetricCell label="Comments" value={formatCount(video.comments)} />
              <MetricCell
                label={video.platform === "TikTok" ? "Shares" : video.platform === "Instagram" ? "Saves" : "—"}
                value={
                  video.platform === "TikTok"
                    ? formatCount(video.shares)
                    : video.platform === "Instagram"
                      ? formatCount(video.saves)
                      : "—"
                }
              />
            </div>

            {/* Secondary metrics */}
            <div className="db-drawer__secondary">
              <SecondaryCell
                label="Engagement rate"
                value={formatPercent(engagementRate(video), 2)}
              />
              <SecondaryCell
                label="Completion rate"
                value={formatPercent(video.metrics.completionRate, 0)}
              />
              <SecondaryCell
                label="Watch promedio"
                value={`${video.metrics.averageWatchSeconds.toFixed(1)}s`}
              />
            </div>

            {/* Retention curve */}
            <div className="db-drawer__chart">
              <span className="db-drawer__chart-title">Curva de retención</span>
              <span className="db-drawer__chart-sub">
                Porcentaje de audiencia que sigue viendo en cada segundo. El quiebre típico ocurre entre el 10% y 30% del video.
              </span>
              <RetentionChart
                curve={video.metrics.retentionCurve}
                durationSeconds={video.durationSeconds}
              />
            </div>

            {/* Evolution */}
            <div className="db-drawer__chart">
              <span className="db-drawer__chart-title">Evolución de views</span>
              <span className="db-drawer__chart-sub">
                Acumulado diario desde la publicación. Picos tardíos suelen indicar viralidad cross-plataforma.
              </span>
              <EvolutionChart viewsByDay={video.metrics.viewsByDay} />
            </div>

            {/* Hashtags */}
            {video.hashtags.length > 0 ? (
              <div>
                <span className="db-drawer__chart-title" style={{ display: "block", marginBottom: 6 }}>
                  Hashtags / Tags
                </span>
                <div className="db-drawer__tags">
                  {video.hashtags.map((h) => (
                    <span key={h} className="db-tag">
                      #{h}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <a
              className="db-drawer__external"
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir en {video.platform} ↗
            </a>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="db-drawer__primary-cell">
      <span className="db-drawer__primary-label">{label}</span>
      <div className="db-drawer__primary-val">{value}</div>
    </div>
  );
}

function SecondaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="db-drawer__secondary-cell">
      <span className="db-drawer__secondary-label">{label}</span>
      <div className="db-drawer__secondary-val">{value}</div>
    </div>
  );
}
