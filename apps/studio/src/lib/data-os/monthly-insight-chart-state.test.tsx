import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React, { act, createElement, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { NextIntlClientProvider, useLocale, useTranslations } from "next-intl";
import ts from "typescript";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { DatasetComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { SignalInsightCarouselData, SignalInsightCarouselItem } from "../../components/signal-v2/MonthlyInsightCarousel";

echarts.use([BarChart, LineChart, DatasetComponent, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);
const browser = new Window({ url: "https://studio.example.test/signal/synthetic/monitoring" });
Object.assign(globalThis, { window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true });
const require = createRequire(import.meta.url);
let currentChart: echarts.EChartsType;

/** Use real React reconciliation and real ECharts option merging, substituting
 * its supported SVG SSR renderer for Canvas. No model, series or axes are mocked. */
function SvgChart({ option }: { option: echarts.EChartsCoreOption }) {
  const chart = useRef<echarts.EChartsType | null>(null);
  const [svg, setSvg] = useState("");
  useEffect(() => {
    chart.current = echarts.init(null, undefined, { renderer: "svg", ssr: true, width: 320, height: 180 });
    currentChart = chart.current;
    return () => { chart.current!.dispose(); };
  }, []);
  useEffect(() => {
    chart.current!.setOption({ ...option, animation: false }, { notMerge: false, replaceMerge: ["dataset", "series"] });
    setSvg(chart.current!.renderToSVGString());
  }, [option]);
  return createElement("div", { dangerouslySetInnerHTML: { __html: svg } });
}
const source = await readFile(new URL("../../components/signal-v2/MonthlyInsightCarousel.tsx", import.meta.url), "utf8");
const exports: Record<string, unknown> = {};
new Function("require", "exports", ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
} }).outputText)((name: string) => {
  if (name === "@/components/signal-v2/SignalEChart") return { SignalEChart: SvgChart };
  if (name === "next-intl") return { useLocale, useTranslations };
  return require(name);
}, exports);
const MonthlyInsightCarousel = exports.MonthlyInsightCarousel as React.ComponentType<{
  insights: SignalInsightCarouselData; onOpenEvidence: () => void;
}>;
const item = (id: string, chart: SignalInsightCarouselItem["chart"]): SignalInsightCarouselItem => ({
  id, kind: "volume_momentum", tone: "neutral", rank: 1,
  metric: { current: 100, previous: 90, delta: 10, delta_ratio: .1, unit: "count" }, chart,
  evidence: { mention_ids: [], evidence_count: 100 }, editorial: { state: "claude", short_title: id,
    headline: id, explanation: "Synthetic aggregate description", why_it_matters: "Synthetic baseline",
    confidence: "low", limitations: [] }
});
const insights: SignalInsightCarouselData = {
  window: { start: "2026-10-01", end: "2026-10-30", days: 30 }, calculated_through: "2026-10-30",
  items: [item("volume", { type: "line", current: [{ period_start: "2026-10-01", value: 165 },
    { period_start: "2026-10-02", value: 593 }], previous: [{ period_start: "2026-09-01", value: 125 },
    { period_start: "2026-09-02", value: 480 }] }),
  item("comparison", { type: "comparison", items: [{ key: "root_posts", current: 40, previous: 30 }] }),
  item("sentiment", { type: "donut", items: [{ key: "positive", value: 4 }, { key: "neutral", value: 3 },
    { key: "negative", value: 2 }], previous_items: [] })]
};

for (const locale of ["es-MX", "en-US"]) test(`${locale}: changing insight chart types preserves visible volume and discards the previous axes and legend`, async () => {
  const element = document.createElement("div"); document.body.appendChild(element); const root = createRoot(element);
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const select = async (id: string) => {
    const button = element.querySelector<HTMLButtonElement>(`#monthly-insight-tab-${id}`); assert.ok(button);
    await act(async () => button.click());
  };
  const visibleVolume = () => {
    const point = currentChart.convertToPixel({ seriesIndex: 0 }, [0, 165]) as number[];
    assert.ok(Number.isFinite(point[1]) && point[1]! >= 0 && point[1]! <= 180,
      `volume point is clipped outside its chart: ${JSON.stringify(point)}`);
    const option = currentChart.getOption() as { legend?: unknown[]; series: Array<{ data: number[] }> };
    assert.deepEqual(option.series[0]!.data, [165, 593]);
    assert.equal(option.legend?.length ?? 0, 0);
    assert.ok(element.querySelector("svg"));
  };
  try {
    await act(async () => root.render(createElement(NextIntlClientProvider,
      { locale, messages, timeZone: "UTC" } as React.ComponentProps<typeof NextIntlClientProvider>,
      createElement(MonthlyInsightCarousel, { insights, onOpenEvidence: () => {} }))));
    visibleVolume(); await select("comparison"); await select("volume"); visibleVolume();
    await select("comparison"); await select("sentiment"); await select("volume"); visibleVolume();
    await select("sentiment"); await select("volume"); visibleVolume();
  } finally { await act(async () => root.unmount()); element.remove(); }
});
