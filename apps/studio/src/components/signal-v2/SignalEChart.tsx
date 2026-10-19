"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";

const SignalEChartRuntime = dynamic(
  () => import("./SignalEChartRuntime").then((module) => module.SignalEChartRuntime),
  { loading: () => null, ssr: false }
);

export function SignalEChart({
  ariaLabel,
  className = "",
  deferUntilVisible = true,
  onActivate,
  onDatumClick,
  onDatumHover,
  option
}: {
  ariaLabel: string;
  className?: string;
  deferUntilVisible?: boolean;
  onActivate?: () => void;
  onDatumClick?: (name: string) => void;
  onDatumHover?: (name: string | null) => void;
  option: EChartsCoreOption;
}) {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);

  return (
    <div
      aria-busy={!ready}
      aria-label={ariaLabel}
      className={`signal-v2-chart signal-v2-chart--host${ready ? " is-ready" : ""} ${className}`}
      role="img"
    >
      <SignalEChartRuntime
        ariaLabel={ariaLabel}
        deferUntilVisible={deferUntilVisible}
        onActivate={onActivate}
        onDatumClick={onDatumClick}
        onDatumHover={onDatumHover}
        onReady={markReady}
        option={option}
      />
    </div>
  );
}
