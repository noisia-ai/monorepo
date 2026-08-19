import type { ReactNode } from "react";

import { WorkspaceHeader } from "@/components/workspace/WorkspaceShell";

export function SignalV2ModuleHeader({
  aside,
  controls,
  controlsClassName,
  icon,
  status,
  subtitle,
  title,
  titleId
}: {
  aside?: ReactNode;
  controls?: ReactNode;
  controlsClassName?: string;
  icon: ReactNode;
  status?: ReactNode;
  subtitle: ReactNode;
  title: ReactNode;
  titleId?: string;
}) {
  return (
    <WorkspaceHeader
      data-signal-module-header=""
      aside={aside}
      className={`signal-v2-module-header${controls ? " signal-v2-module-header--with-controls" : ""}`}
      controls={controls}
      controlsClassName={`signal-v2-filterbar${controlsClassName ? ` ${controlsClassName}` : ""}`}
      headClassName="signal-v2-page-head"
      icon={icon}
      status={status}
      subtitle={subtitle}
      title={title}
      titleId={titleId}
      titleLineClassName="signal-v2-title-line"
    />
  );
}
