"use client";

import {
  CalendarBlank,
  CaretDown,
  ClockCounterClockwise,
  Database,
  FileText,
  Funnel,
  Gauge,
  List,
  ListMagnifyingGlass,
  Megaphone,
  Pulse,
  Quotes,
  SlidersHorizontal,
  Sparkle,
  SpinnerGap,
  Target
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { SignalV2ModuleHeader } from "@/components/signal-v2/SignalV2ModuleHeader";
import {
  WorkspaceAccount,
  WorkspaceProductBrand,
  WorkspaceSearchTrigger,
  WorkspaceTopbar,
  WorkspaceTopbarActions
} from "@/components/workspace/WorkspaceShell";

export function SignalV2RouteSkeleton({
  brandName = "Signal",
  variant = "monitoring"
}: {
  brandName?: string;
  variant?: "monitoring" | "mentions" | "topics";
}) {
  const t = useTranslations("SignalV2");
  const [showModulePreview, setShowModulePreview] = useState(false);
  const activeIndex = variant === "mentions" ? 1 : variant === "topics" ? 2 : 0;
  const navItems = [
    { icon: <Gauge />, label: t("nav.monitoring") },
    { icon: <ListMagnifyingGlass />, label: t("nav.mentions") },
    { icon: <Pulse />, label: t("nav.topics") },
    { icon: <Target />, label: t("nav.tb") },
    { icon: <Sparkle />, label: t("nav.opportunities") },
    { icon: <Database />, label: t("nav.evidence") }
  ];

  useEffect(() => {
    const timer = window.setTimeout(() => setShowModulePreview(true), 220);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div aria-busy="true" aria-label={t("actions.loading")} className="signal-v2-shell signal-v2-route-skeleton">
      <WorkspaceTopbar className="signal-v2-topbar">
        <button aria-hidden className="signal-v2-topbar__mobile-menu" tabIndex={-1} type="button">
          <List size={19} weight="bold" />
        </button>
        <WorkspaceProductBrand href="#" product="Signal" />
        <WorkspaceSearchTrigger>{t("search.placeholder")}</WorkspaceSearchTrigger>
        <WorkspaceTopbarActions>
          <WorkspaceAccount label="S" name={brandName} tone="brand" />
        </WorkspaceTopbarActions>
      </WorkspaceTopbar>

      <aside className="signal-v2-sidebar">
        <div className="signal-v2-sidebar__workspace">
          <span>S</span>
          <div>
            <strong>{brandName}</strong>
            <small>{t("nav.workspace")}</small>
          </div>
          <CaretDown size={14} />
        </div>
        <nav className="signal-v2-nav">
          {navItems.map((item, index) => (
            <div
              className={`workspace-shell__nav-link${index === activeIndex ? " workspace-shell__nav-link--active" : ""}`}
              key={item.label}
            >
              <span>{item.icon}</span>
              {item.label}
            </div>
          ))}
          <div className="signal-v2-nav__section">{t("nav.reports")}</div>
          <div className="workspace-shell__nav-link">
            <span><FileText /></span>
            {t("nav.strategic")}
          </div>
          <div className="workspace-shell__nav-link">
            <span><ClockCounterClockwise /></span>
            {t("nav.history")}
          </div>
        </nav>
        <div className="signal-v2-sidebar__footer">
          <div className="workspace-shell__nav-link">
            <span><SlidersHorizontal /></span>
            {t("nav.settings")}
          </div>
        </div>
      </aside>

      <main className="signal-v2-main">
        <SignalV2ModuleSkeleton
          brandName={brandName}
          showBody={showModulePreview}
          variant={variant}
        />
      </main>
    </div>
  );
}

export function SignalV2ModuleSkeleton({
  brandName = "Signal",
  showBody = true,
  variant
}: {
  brandName?: string;
  showBody?: boolean;
  variant: "monitoring" | "mentions" | "topics" | "triggersBarriers";
}) {
  const t = useTranslations("SignalV2");
  const page = variant === "mentions"
    ? {
        icon: <ListMagnifyingGlass size={20} weight="fill" />,
        status: t("mentions.status"),
        subtitle: t("mentions.subtitle", { brand: brandName }),
        title: t("mentions.title")
      }
    : variant === "topics"
      ? {
          icon: <Quotes size={20} weight="fill" />,
          status: t("topicsNarratives.status"),
          subtitle: t("topicsNarratives.subtitle"),
          title: t("topicsNarratives.title")
        }
      : variant === "triggersBarriers"
        ? {
            icon: <Target size={20} weight="fill" />,
            status: t("triggersBarriers.status"),
            subtitle: t("triggersBarriers.subtitle"),
            title: t("nav.tb")
          }
      : {
          icon: <Megaphone size={20} weight="fill" />,
          status: t("status.beta"),
          subtitle: t("subtitle"),
          title: t("title")
        };

  return (
    <div
      aria-busy="true"
      aria-label={t("actions.loading")}
      className="signal-v2-route-skeleton signal-v2-module-skeleton"
      role="status"
    >
      <SignalV2ModuleHeader
        controls={<>
          <span className="signal-v2-filter">
            <CalendarBlank size={15} />
            {t("filters.period")}
          </span>
          {variant !== "triggersBarriers" ? <span className="signal-v2-filter">
            <ClockCounterClockwise size={15} />
            {t("filters.comparison.label")}
          </span> : null}
          <span className="signal-v2-filter">
            <Database size={15} />
            {t("filters.dataScope", { brand: brandName })}
          </span>
          {variant !== "triggersBarriers" ? <span className="signal-v2-filter">
            <Funnel size={15} />
            {t("filters.more")}
          </span> : null}
        </>}
        controlsClassName="signal-v2-route-skeleton__static-filters"
        icon={page.icon}
        status={page.status}
        subtitle={page.subtitle}
        title={page.title}
      />
      <div className={`signal-v2-route-skeleton__delayed${showBody ? " is-visible" : ""}`}>
      {variant === "triggersBarriers" ? (
        <>
          <section className="signal-v2-route-skeleton__kpis">
            {Array.from({ length: 4 }, (_, index) => (
              <article key={index}><span /><strong /><i /></article>
            ))}
          </section>
          <section className="signal-v2-route-skeleton__tb-decision">
            <article className="signal-v2-route-skeleton__tb-matrix">
              <span /><strong /><div />
            </article>
            <article className="signal-v2-route-skeleton__tb-reading">
              <span /><strong /><div /><div />
            </article>
          </section>
          <section className="signal-v2-route-skeleton__tb-selection">
            <article className="signal-v2-route-skeleton__tb-ranking">
              <span /><strong /><div />
            </article>
            <article className="signal-v2-route-skeleton__tb-detail">
              <span /><strong /><div />
            </article>
          </section>
        </>
      ) : variant === "mentions" ? (
        <section className="signal-v2-route-skeleton__mentions">
          <header><strong /><i /></header>
          <div className="signal-v2-route-skeleton__mentions-toolbar">
            <span /><i /><i /><i />
          </div>
          <div className="signal-v2-route-skeleton__mentions-heading">
            <i /><strong /><i /><i /><i /><i />
          </div>
          {Array.from({ length: 8 }, (_, index) => (
            <div className="signal-v2-route-skeleton__mentions-row" key={index}>
              <i />
              <div className="signal-v2-route-skeleton__mention-copy">
                <strong />
                <small />
              </div>
              <span /><span /><span /><span />
            </div>
          ))}
          <footer><span /><div><i /><i /></div></footer>
        </section>
      ) : variant === "topics" ? (
        <>
          <section className="signal-v2-tn__coverage-note signal-v2-route-skeleton__coverage-note">
            <span />
            <div><strong /><i /></div>
          </section>
          <section className="signal-v2-tn__insight-status">
            <SpinnerGap className="signal-v2-route-skeleton__insight-spinner" size={18} />
            <div>
              <strong>{t("topicsNarratives.insights.emptyTitle")}</strong>
              <p>{t("topicsNarratives.insights.loadingBody")}</p>
            </div>
          </section>
          <section className="signal-v2-route-skeleton__taxonomy-kpis">
            {Array.from({ length: 4 }, (_, index) => (
              <article key={index}><span /><strong /><i /></article>
            ))}
          </section>
          <div className="signal-v2-tn__switch signal-v2-route-skeleton__static-tabs">
            <button aria-selected="true" role="tab" type="button">{t("topicsNarratives.tabs.topics")}</button>
            <button aria-selected="false" role="tab" type="button">{t("topicsNarratives.tabs.narratives")}</button>
          </div>
          <div className="signal-v2-tn__grid">
            <section className="signal-v2-card signal-v2-tn__ranking signal-v2-tn__skeleton-card">
              <header className="signal-v2-card__heading">
                <div>
                  <small>{t("topicsNarratives.ranking.eyebrow")}</small>
                  <h2>{t("topicsNarratives.ranking.topics")}</h2>
                </div>
              </header>
              <div className="signal-v2-tn__skeleton-ranking">
                {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
              </div>
            </section>
            <section className="signal-v2-card signal-v2-tn__detail signal-v2-tn__skeleton-card">
              <header className="signal-v2-card__heading">
                <div>
                  <small>{t("topicsNarratives.detail.eyebrow")}</small>
                  <h2>{t("topicsNarratives.detail.topicDetail")}</h2>
                </div>
              </header>
              <TaxonomyDetailSkeleton />
            </section>
            <section className="signal-v2-card signal-v2-tn__cooccurrence signal-v2-tn__skeleton-card">
              <header className="signal-v2-card__heading">
                <div>
                  <small>{t("topicsNarratives.cooccurrence.eyebrow")}</small>
                  <h2>{t("topicsNarratives.cooccurrence.topicTitle")}</h2>
                </div>
              </header>
              <i className="signal-v2-tn__skeleton-chart signal-v2-tn__skeleton-chart--relationship" />
            </section>
          </div>
        </>
      ) : (
        <>
          <section className="signal-v2-route-skeleton__insight">
            <div>
              <i /><i /><i /><i />
            </div>
            <article>
              <span /><strong /><p />
            </article>
            <div className="signal-v2-route-skeleton__mini-chart"><i /><i /></div>
          </section>
          <section className="signal-v2-route-skeleton__kpis">
            {Array.from({ length: 4 }, (_, index) => (
              <article key={index}><span /><strong /><i /></article>
            ))}
          </section>
          <section className="signal-v2-route-skeleton__cards">
            <article className="is-wide"><span /><strong /><div /></article>
            <article><span /><strong /><div className="is-donut" /></article>
            <article className="is-wide"><span /><strong /><div /></article>
            <article><span /><strong /><div /></article>
            <article><span /><strong /><div /></article>
          </section>
        </>
      )}
      </div>
    </div>
  );
}

function TaxonomyDetailSkeleton() {
  return (
    <div className="signal-v2-tn__detail-skeleton">
      <div className="signal-v2-tn__definition">
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--term" />
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--copy" />
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--copy-short" />
      </div>
      <div className="signal-v2-tn__term-metrics signal-v2-tn__skeleton-metrics">
        <article><i /><b /></article>
        <article><i /><b /><em /></article>
        <article><i /><b /></article>
      </div>
      <div className="signal-v2-tn__detail-charts">
        <article>
          <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--subheading" />
          <i className="signal-v2-tn__skeleton-chart signal-v2-tn__skeleton-chart--trend" />
        </article>
        <article>
          <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--subheading" />
          <i className="signal-v2-tn__skeleton-chart signal-v2-tn__skeleton-chart--donut" />
          <div className="signal-v2-tn__skeleton-legend"><i /><i /><i /></div>
        </article>
      </div>
      <div className="signal-v2-tn__preview">
        <div><i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--subheading" /></div>
        <div className="signal-v2-tn__preview-skeleton" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index}><span /><b /></i>
          ))}
        </div>
      </div>
      <div className="signal-v2-tn__detail-actions signal-v2-tn__skeleton-actions">
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--meta" />
        <i className="signal-v2-tn__skeleton-line signal-v2-tn__skeleton-line--button" />
      </div>
    </div>
  );
}
