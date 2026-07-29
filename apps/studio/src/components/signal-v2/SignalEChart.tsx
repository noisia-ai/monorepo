"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
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
  GridComponent,
  LegendComponent,
  LineChart,
  PieChart,
  TooltipComponent
]);

export function SignalEChart({
  ariaLabel,
  className = "",
  onActivate,
  onDatumClick,
  onDatumHover,
  option
}: {
  ariaLabel: string;
  className?: string;
  onActivate?: () => void;
  onDatumClick?: (name: string) => void;
  onDatumHover?: (name: string | null) => void;
  option: EChartsCoreOption;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const onActivateRef = useRef(onActivate);
  const onDatumClickRef = useRef(onDatumClick);
  const onDatumHoverRef = useRef(onDatumHover);

  useEffect(() => {
    onActivateRef.current = onActivate;
    onDatumClickRef.current = onDatumClick;
    onDatumHoverRef.current = onDatumHover;
  }, [onActivate, onDatumClick, onDatumHover]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const chart = echarts.init(element, undefined, {
      renderer: "canvas",
      useDirtyRect: false
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
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chartRef.current?.setOption({
      ...option,
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 950,
      animationDurationUpdate: reducedMotion ? 0 : 600,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicInOut",
      aria: {
        enabled: true,
        label: { description: ariaLabel }
      }
    }, {
      lazyUpdate: false,
      notMerge: true
    });
  }, [ariaLabel, option]);

  return (
    <div
      aria-label={ariaLabel}
      className={`signal-v2-chart ${className}`}
      ref={elementRef}
      role="img"
    />
  );
}

function chartDatumName(event: unknown) {
  if (!event || typeof event !== "object" || !("name" in event)) return null;
  const name = (event as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name : null;
}
