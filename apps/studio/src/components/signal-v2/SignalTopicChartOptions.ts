import type { EChartsCoreOption } from "echarts/core";

const BLUE = "#1689f5";
const BLUE_SOFT = "#8fcef9";
const GRID = "#ebebeb";
const MUTED = "#737373";
const TEXT = "#303030";

export type SignalTopicTrendPoint = {
  label: string;
  value: number;
};

export type SignalTopicSentimentCounts = {
  negative: number;
  neutral: number;
  positive: number;
};

export function buildSignalTopicTrendOption(
  points: SignalTopicTrendPoint[],
  seriesName: string,
  animation = true
): EChartsCoreOption {
  return {
    animation,
    grid: { top: 16, right: 8, bottom: 36, left: 40 },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "#fff",
      borderColor: "#d3d3d3",
      borderWidth: 1,
      textStyle: { color: TEXT, fontFamily: "Product Sans, Google Sans, sans-serif", fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 7px 22px rgba(0,0,0,.14)"
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.label),
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: MUTED,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 10,
        hideOverlap: true
      }
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: {
        color: MUTED,
        fontFamily: "Product Sans, Google Sans, sans-serif",
        fontSize: 10
      },
      splitLine: { lineStyle: { color: GRID } }
    },
    series: [{
      name: seriesName,
      type: "line",
      smooth: 0.28,
      showSymbol: false,
      lineStyle: { color: BLUE, width: 2 },
      itemStyle: { color: BLUE },
      areaStyle: { color: BLUE_SOFT, opacity: 0.18 },
      data: points.map((point) => point.value)
    }]
  };
}

export function buildSignalTopicSentimentOption(
  counts: SignalTopicSentimentCounts,
  labels: { negative: string; neutral: string; positive: string },
  animation = true
): EChartsCoreOption {
  const total = counts.positive + counts.neutral + counts.negative;
  return {
    animation,
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: number; percent?: number };
        return `<strong>${item.name ?? ""}</strong><br/>${item.value ?? 0} · ${Number(item.percent ?? 0).toFixed(1)}%`;
      },
      backgroundColor: "#fff",
      borderColor: "#d3d3d3",
      borderWidth: 1,
      textStyle: { color: TEXT, fontFamily: "Product Sans, Google Sans, sans-serif", fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 7px 22px rgba(0,0,0,.14)"
    },
    graphic: [{
      type: "text",
      left: "center",
      top: "middle",
      style: {
        text: String(total),
        fill: TEXT,
        font: "700 24px Product Sans, Google Sans, sans-serif",
        textAlign: "center",
        textVerticalAlign: "middle"
      }
    }],
    series: [{
      type: "pie",
      radius: ["58%", "78%"],
      center: ["50%", "50%"],
      minAngle: 2,
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: { show: false },
      emphasis: { scaleSize: 4 },
      data: [
        { name: labels.positive, value: counts.positive, itemStyle: { color: "#008060" } },
        { name: labels.neutral, value: counts.neutral, itemStyle: { color: "#d7d7d7" } },
        { name: labels.negative, value: counts.negative, itemStyle: { color: "#d72c0d" } }
      ]
    }]
  };
}
