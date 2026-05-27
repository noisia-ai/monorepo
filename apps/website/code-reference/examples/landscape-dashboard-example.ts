import { data, focusMarkets, getMarket, MarketCode } from "../data";
import { compact, number, pct, reachLabel } from "../utils/format";

const trendSeries: Record<MarketCode, number[]> = {
  ALL: data.volume_by_month.map((item) => item.mentions),
  AR: [60, 150, 32, 10],
  CL: [20, 78, 31, 16],
  MX: [18, 25, 28, 25],
  CO: [2, 4, 7, 11],
  US: [8, 22, 9, 4]
};

const trendCopy: Record<MarketCode, string> = {
  ALL: "Febrero concentra el 56% del volumen. No es crecimiento: es crisis viral.",
  AR: "El epicentro cae después del meme. La atención no se capitalizó.",
  CL: "La conversación baja, pero deja un ratio crítico detrás.",
  MX: "Estable: la prensa sostiene una fase educacional más limpia.",
  CO: "Entrada reciente. Todavía hay espacio para moldear el frame.",
  US: "Reacción de audiencia LATAM migrante. No es prioridad."
};

const renderSparkline = (values: number[]) => {
  const width = 320;
  const height = 150;
  const margin = { top: 14, right: 12, bottom: 28, left: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const max = Math.max(...values);
  const axisMax = Math.ceil(max / 10) * 10 || 10;
  const yTicks = [axisMax, axisMax / 2, 0];
  const monthLabels = data.volume_by_month.map((item) => item.label.slice(0, 3));
  const points = values.map((value, index) => {
    const x = margin.left + (index / (values.length - 1)) * plotWidth;
    const y = margin.top + plotHeight - (value / axisMax) * plotHeight;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
      <g class="sparkline__grid">
        ${yTicks
          .map((tick) => {
            const y = margin.top + plotHeight - (tick / axisMax) * plotHeight;
            return `
              <line class="sparkline__gridline" x1="${margin.left}" x2="${width - margin.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" />
              <text class="sparkline__y-label" x="${margin.left - 8}" y="${(y + 4).toFixed(1)}">${compact(tick)}</text>
            `;
          })
          .join("")}
        <line class="sparkline__axis" x1="${margin.left}" x2="${width - margin.right}" y1="${margin.top + plotHeight}" y2="${margin.top + plotHeight}" />
        <line class="sparkline__axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${margin.top + plotHeight}" />
        ${monthLabels
          .map((label, index) => {
            const x = margin.left + (index / (monthLabels.length - 1)) * plotWidth;
            return `<text class="sparkline__x-label" x="${x.toFixed(1)}" y="${height - 7}">${label}</text>`;
          })
          .join("")}
      </g>
      <path class="sparkline__line" d="${path}" />
      ${points
        .map(([x, y]) => `<circle class="sparkline__point" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" />`)
        .join("")}
    </svg>
  `;
};

const renderSentiment = (sentiment: { positive: number; neutral: number; negative: number }) => `
  <div class="sentiment-bar" aria-hidden="true">
    <span class="pos" style="width:${sentiment.positive}%"></span>
    <span class="neu" style="width:${sentiment.neutral}%"></span>
    <span class="neg" style="width:${sentiment.negative}%"></span>
  </div>
  <div class="sentiment-legend">
    <span>${pct(sentiment.positive)} pos</span>
    <span>${pct(sentiment.neutral)} neu</span>
    <span>${pct(sentiment.negative)} neg</span>
  </div>
`;

const renderGeoList = (code: MarketCode) => {
  if (code !== "ALL") {
    const market = getMarket(code);
    if (!market) return "";

    return `
      <div class="geo-list">
        <div class="geo-row">
          <strong>${market.code}</strong>
          <span class="geo-track"><span class="geo-fill" style="width:100%"></span></span>
          <span>100%</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="geo-list">
      ${focusMarkets
        .map(
          (market) => `
            <div class="geo-row">
              <strong>${market.code}</strong>
              <span class="geo-track"><span class="geo-fill" style="width:${Math.min(market.pct_of_total * 2.6, 100)}%"></span></span>
              <span>${pct(market.pct_of_total)}</span>
            </div>
          `
        )
        .join("")}
    </div>
    <p class="data-card__footnote">6 mercados con señal. Foco en 4.</p>
  `;
};

const getView = (code: MarketCode) => {
  const market = getMarket(code);
  if (!market) {
    return {
      title: "All LATAM",
      mentions: data.topline_metrics.total_mentions,
      reach: compact(data.topline_metrics.total_reach),
      reachCaption: "alcance estimado",
      sentiment: {
        positive: data.topline_metrics.sentiment.positive.pct,
        neutral: data.topline_metrics.sentiment.neutral.pct,
        negative: data.topline_metrics.sentiment.negative.pct
      },
      code: "ALL" as MarketCode
    };
  }

  return {
    title: market.name,
    mentions: market.mentions_total,
    reach: reachLabel(market.reach_level),
    reachCaption: "alcance relativo",
    sentiment: market.sentiment_pcts,
    code
  };
};

const renderTiles = (code: MarketCode) => {
  const view = getView(code);
  const series = trendSeries[code] ?? trendSeries.ALL;

  return `
    <article class="data-card data-card--landscape">
      <span class="data-card__label">Volumen · ${view.title}</span>
      <div class="data-card__metric">${number(view.mentions)}</div>
      <p class="data-card__submetric">${view.reach} ${view.reachCaption}</p>
    </article>
    <article class="data-card data-card--landscape">
      <span class="data-card__label">Sentiment split</span>
      <div class="data-card__metric">${pct(view.sentiment.negative)}</div>
      <p class="data-card__submetric">menciones negativas</p>
      ${renderSentiment(view.sentiment)}
    </article>
    <article class="data-card data-card--landscape">
      <span class="data-card__label">Distribución geo</span>
      <div class="data-card__metric">${code === "ALL" ? "6" : "1"}</div>
      <p class="data-card__submetric">${code === "ALL" ? "mercados con señal relevante" : "mercado filtrado"}</p>
      ${renderGeoList(code)}
    </article>
    <article class="data-card data-card--landscape data-card--spark">
      <span class="data-card__label">El pico que importa</span>
      <div class="data-card__metric">${code === "ALL" ? "56%" : view.code}</div>
      <p class="data-card__submetric">${trendCopy[code]}</p>
      ${renderSparkline(series)}
    </article>
  `;
};

export const initLandscapeDashboard = () => {
  const root = document.querySelector<HTMLElement>("[data-landscape-grid]");
  const toggle = document.querySelector<HTMLElement>("[data-landscape-toggle]");
  if (!root || !toggle) return;

  const setView = (code: MarketCode) => {
    root.innerHTML = renderTiles(code);
    toggle.querySelectorAll<HTMLButtonElement>(".toggle-button").forEach((button) => {
      const active = button.dataset.view === code;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
  };

  toggle.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]");
    if (!button) return;
    setView((button.dataset.view ?? "ALL") as MarketCode);
  });

  setView("ALL");
};
