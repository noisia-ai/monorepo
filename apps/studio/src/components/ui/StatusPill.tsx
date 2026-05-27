import type { ReactNode } from "react";

import { Icon } from "./Icon";

type StatusTone = "idle" | "running" | "success" | "warn" | "error" | "info";

export function StatusPill({
  tone,
  children,
  icon,
}: {
  tone: StatusTone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span className={`status-pill status-pill--${tone}`}>
      <span className="status-pill-dot" aria-hidden="true" />
      {icon}
      <span className="status-pill-label">{children}</span>
    </span>
  );
}

export function RunningPill({ children = "Procesando" }: { children?: ReactNode }) {
  return (
    <StatusPill tone="running" icon={<Icon name="spinner" size={12} />}>
      {children}
    </StatusPill>
  );
}

export function SuccessPill({ children }: { children: ReactNode }) {
  return (
    <StatusPill tone="success" icon={<Icon name="check" size={12} />}>
      {children}
    </StatusPill>
  );
}
