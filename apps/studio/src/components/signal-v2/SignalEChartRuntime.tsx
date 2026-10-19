"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import {
  BarChart,
  GraphChart,
  LineChart,
  PieChart,
  ScatterChart
} from "echarts/charts";
import {
  AriaComponent,
  DatasetComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  AriaComponent,
  BarChart,
  CanvasRenderer,
  DatasetComponent,
  GraphicComponent,
  GraphChart,
  GridComponent,
  LegendComponent,
  LineChart,
  PieChart,
  ScatterChart,
  TooltipComponent
]);

export function SignalEChartRuntime({
  ariaLabel,
  deferUntilVisible,
  onActivate,
  onDatumClick,
  onDatumHover,
  onReady,
  option
}: {
  ariaLabel: string;
  deferUntilVisible: boolean;
  onActivate?: () => void;
  onDatumClick?: (name: string) => void;
  onDatumHover?: (name: string | null) => void;
  onReady: () => void;
  option: EChartsCoreOption;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const onActivateRef = useRef(onActivate);
  const onDatumClickRef = useRef(onDatumClick);
  const onDatumHoverRef = useRef(onDatumHover);
  const onReadyRef = useRef(onReady);
  const [shouldRender, setShouldRender] = useState(!deferUntilVisible);
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    onActivateRef.current = onActivate;
    onDatumClickRef.current = onDatumClick;
    onDatumHoverRef.current = onDatumHover;
    onReadyRef.current = onReady;
  }, [onActivate, onDatumClick, onDatumHover, onReady]);

  useEffect(() => {
    if (!deferUntilVisible || shouldRender) return;
    const element = elementRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldRender(true);
      observer.disconnect();
    }, { rootMargin: "240px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [deferUntilVisible, shouldRender]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !shouldRender) return;

    const chart = echarts.init(element, undefined, {
      renderer: "canvas",
      useDirtyRect: true
    });
    chartRef.current = chart;

    const handleClick = (event: unknown) => {
      const name = chartDatumName(event);
      if (name && onDatumClickRef.current) {
        onDatumClickRef.current(name);
        return;
      }
      onActivateRef.current?.();
    };
    const handleMouseOver = (event: unknown) => {
      const name = chartDatumName(event);
      if (name) onDatumHoverRef.current?.(name);
    };
    const handleGlobalOut = () => {
      chart.dispatchAction({ type: "hideTip" });
      onDatumHoverRef.current?.(null);
    };
    const handleMouseLeave = () => {
      chart.dispatchAction({ type: "hideTip" });
      onDatumHoverRef.current?.(null);
    };
    chart.on("click", handleClick);
    chart.on("mouseover", handleMouseOver);
    chart.getZr().on("globalout", handleGlobalOut);
    element.addEventListener("mouseleave", handleMouseLeave);

    let resizeFrame = 0;
    let lastWidth = element.clientWidth;
    let lastHeight = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width <= 0 || height <= 0 || (width === lastWidth && height === lastHeight)) return;
      lastWidth = width;
      lastHeight = height;
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => chart.resize({ animation: { duration: 0 } }));
    });
    observer.observe(element);
    setChartReady(true);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      chart.off("click", handleClick);
      chart.off("mouseover", handleMouseOver);
      chart.getZr().off("globalout", handleGlobalOut);
      element.removeEventListener("mouseleave", handleMouseLeave);
      chart.dispose();
      chartRef.current = null;
    };
  }, [shouldRender]);

  useEffect(() => {
    if (!chartReady) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chartRef.current?.setOption({
      ...option,
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 420,
      animationDurationUpdate: reducedMotion ? 0 : 200,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicOut",
      aria: {
        enabled: true,
        label: { description: ariaLabel }
      }
    }, {
      lazyUpdate: true,
      notMerge: false,
      replaceMerge: ["dataset", "series"]
    });
    onReadyRef.current();
  }, [ariaLabel, chartReady, option]);

  return <div className="signal-v2-chart__runtime" ref={elementRef} />;
}

function chartDatumName(event: unknown) {
  if (!event || typeof event !== "object" || !("name" in event)) return null;
  const name = (event as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name : null;
}
