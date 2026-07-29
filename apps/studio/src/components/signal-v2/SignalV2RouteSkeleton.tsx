"use client";

import Image from "next/image";
import { Bell, List, MagnifyingGlass } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";

export function SignalV2RouteSkeleton({
  variant = "monitoring"
}: {
  variant?: "monitoring" | "mentions" | "topics";
}) {
  const t = useTranslations("SignalV2");

  return (
    <div aria-busy="true" aria-label={t("actions.loading")} className="signal-v2-shell signal-v2-route-skeleton">
      <header className="signal-v2-topbar">
        <button aria-hidden className="signal-v2-topbar__mobile-menu" tabIndex={-1} type="button">
          <List size={19} weight="bold" />
        </button>
        <div className="signal-v2-brand">
          <Image alt="" height={23} priority src="/assets/logos/logo_black.svg" width={79} />
          <span>Signal</span>
        </div>
        <div className="signal-v2-search-trigger">
          <MagnifyingGlass size={16} />
          <span>{t("search.placeholder")}</span>
          <kbd>⌘ K</kbd>
        </div>
        <div className="signal-v2-topbar__actions">
          <span className="signal-v2-icon-button"><Bell size={17} /></span>
          <span className="signal-v2-route-skeleton__avatar" />
        </div>
      </header>

      <aside className="signal-v2-sidebar">
        <div className="signal-v2-route-skeleton__workspace">
          <span />
          <div><i /><i /></div>
        </div>
        <nav className="signal-v2-route-skeleton__nav">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              className={index === (variant === "mentions" ? 1 : variant === "topics" ? 2 : 0) ? "is-active" : ""}
              key={index}
            >
              <span />
              <i />
            </div>
          ))}
          <small />
          {Array.from({ length: 2 }, (_, index) => (
            <div key={`report-${index}`}><span /><i /></div>
          ))}
        </nav>
        <div className="signal-v2-route-skeleton__settings"><span /><i /></div>
      </aside>

      <main className="signal-v2-main">
        <SignalV2ModuleSkeleton variant={variant} />
      </main>
    </div>
  );
}

export function SignalV2ModuleSkeleton({
  variant
}: {
  variant: "monitoring" | "mentions" | "topics";
}) {
  const t = useTranslations("SignalV2");

  return (
    <div
      aria-busy="true"
      aria-label={t("actions.loading")}
      className="signal-v2-route-skeleton signal-v2-module-skeleton"
      role="status"
    >
      <div className="signal-v2-route-skeleton__head">
        <div><i /><span /></div>
        <span />
      </div>
      <div className="signal-v2-route-skeleton__filters">
        <span /><span /><span /><span />
      </div>
      {variant === "mentions" ? (
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
          <section className="signal-v2-route-skeleton__taxonomy-kpis">
            {Array.from({ length: 4 }, (_, index) => (
              <article key={index}><span /><strong /><i /></article>
            ))}
          </section>
          <div className="signal-v2-route-skeleton__taxonomy-tabs"><span /><span /></div>
          <section className="signal-v2-route-skeleton__taxonomy-grid">
            <article className="is-ranking">
              <header><span /><strong /></header>
              {Array.from({ length: 7 }, (_, index) => (
                <div key={index}><span /><i /><i /><i /></div>
              ))}
            </article>
            <article className="is-trend">
              <header><span /><strong /></header>
              <p />
              <div />
            </article>
            <article><header><span /><strong /></header><div /></article>
            <article><header><span /><strong /></header><div /></article>
          </section>
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
  );
}
