"use client";

import { useTranslations } from "next-intl";

import { WorkspaceHeader } from "@/components/workspace/WorkspaceShell";

type AdminRouteSkeletonProps = {
  delayed?: boolean;
  kind: "index" | "brands" | "brandWorkspace" | "brandForm" | "data" | "reports" | "team" | "settings" | "themes" | "study" | "studyWizard";
};

export function AdminRouteSkeleton({ delayed = true, kind }: AdminRouteSkeletonProps) {
  const className = `admin-workspace-page admin-route-skeleton admin-route-skeleton--${kind}${delayed ? " admin-route-skeleton--delayed" : ""}`;
  const hasSummary = kind === "index" || kind === "brandWorkspace" || kind === "data" || kind === "reports" || kind === "study";
  if (kind === "settings") {
    return (
      <div aria-busy="true" className={className}>
        <SkeletonHeader kind={kind} />
        <div className="admin-route-skeleton__settings">
          {[2, 4].map((rows, groupIndex) => (
            <section className="admin-route-skeleton__settings-group" key={groupIndex}>
              <header><span /><i /></header>
              {Array.from({ length: rows }, (_, rowIndex) => <div key={rowIndex}><b /><span /><i /></div>)}
            </section>
          ))}
        </div>
      </div>
    );
  }

  if (kind === "studyWizard") {
    return (
      <div aria-busy="true" className={className}>
        <SkeletonHeader kind={kind} />
        <div className="admin-route-skeleton__wizard">
          <aside>{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</aside>
          <section><header /><div /><div /><footer /></section>
        </div>
      </div>
    );
  }

  if (kind === "brandForm") {
    return (
      <div aria-busy="true" className={className}>
        <SkeletonHeader kind={kind} />
        <div className="admin-route-skeleton__form">
          {[6, 3].map((fields, sectionIndex) => (
            <section key={sectionIndex}>
              <header><span /><i /></header>
              <div>
                {Array.from({ length: fields }, (_, fieldIndex) => (
                  <label key={fieldIndex}><span /><b /></label>
                ))}
              </div>
              {sectionIndex === 1 ? <footer><i /><b /></footer> : null}
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div aria-busy="true" className={className}>
      <SkeletonHeader kind={kind} />
      {hasSummary ? <div className="admin-route-skeleton__summary">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div> : null}
      <section className="admin-route-skeleton__resource">
        <header><span /><i /></header>
        <nav>{Array.from({ length: kind === "team" ? 3 : kind === "study" ? 2 : kind === "brandWorkspace" ? 3 : 4 }, (_, index) => <span key={index} />)}</nav>
        <div>{Array.from({ length: kind === "team" ? 2 : kind === "study" ? 5 : kind === "brandWorkspace" ? 4 : 6 }, (_, index) => <i key={index} />)}</div>
      </section>
    </div>
  );
}

function SkeletonHeader({ kind }: Pick<AdminRouteSkeletonProps, "kind">) {
  const t = useTranslations("AdminWorkspace.loading");
  return (
    <WorkspaceHeader
      eyebrow={t(`${kind}.eyebrow`)}
      subtitle={t(`${kind}.subtitle`)}
      title={t(`${kind}.title`)}
    />
  );
}
