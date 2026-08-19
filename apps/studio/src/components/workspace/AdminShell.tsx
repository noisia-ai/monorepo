"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Buildings,
  ChartBar,
  Database,
  FileText,
  Gauge,
  Gear,
  List,
  MagnifyingGlass,
  SquaresFour,
  UsersThree,
  X
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  WorkspaceContextSidebar,
  WorkspaceAccount,
  WorkspaceGlobalSidebar,
  WorkspaceMain,
  WorkspaceNavLink,
  WorkspaceNavigation,
  WorkspaceOverlay,
  WorkspaceProductBrand,
  WorkspaceSearchTrigger,
  WorkspaceShell,
  WorkspaceSkipLink,
  WorkspaceTopbar,
  WorkspaceTopbarActions
} from "@/components/workspace/WorkspaceShell";
import { WorkspaceSelect } from "@/components/admin/WorkspaceSelect";
import { AdminRouteSkeleton } from "@/components/admin/AdminRouteSkeleton";
import {
  brandIdFromStudioPath,
  buildAdminNavigation,
  buildBrandContextNavigation,
  buildCorpusContextNavigation,
  corpusIdFromStudioPath,
  type AdminNavigationKey,
  type BrandContextNavigationKey,
  type CorpusContextNavigationKey
} from "@/lib/navigation/admin-navigation";

type AdminShellUser = {
  email: string;
  fullName: string | null;
  primaryRole: string;
};

type AdminReadMode = "legacy" | "shadow" | "governed";

const ADMIN_ICONS: Record<AdminNavigationKey, ReactNode> = {
  dashboard: <Gauge />,
  brands: <Buildings />,
  data: <Database />,
  reports: <FileText />,
  team: <UsersThree />,
  settings: <Gear />,
  corpora: <ChartBar />,
  themes: <SquaresFour />
};

export function AdminShell({
  children,
  readMode,
  user
}: {
  children: ReactNode;
  readMode: AdminReadMode;
  user: AdminShellUser;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("AdminWorkspace");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [showPendingSkeleton, setShowPendingSkeleton] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const brandId = brandIdFromStudioPath(pathname);
  const corpusId = corpusIdFromStudioPath(pathname);
  const navigation = useMemo(() => buildAdminNavigation(user.primaryRole), [user.primaryRole]);
  const contextNavigation = useMemo(() => {
    if (brandId) return buildBrandContextNavigation(brandId);
    if (corpusId) return buildCorpusContextNavigation(corpusId);
    return [];
  }, [brandId, corpusId]);
  const contextNamespace = corpusId ? "studyContext" : "context";

  useEffect(() => {
    setPendingHref(null);
    setShowPendingSkeleton(false);
    setNavigationOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) {
      setShowPendingSkeleton(false);
      return;
    }
    setShowPendingSkeleton(false);
    const timer = window.setTimeout(() => setShowPendingSkeleton(true), 220);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSearchQuery("");
        setNavigationOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [searchOpen]);

  const navigate = (href: string) => {
    if (href === pathname) return;
    setPendingHref(href);
    setNavigationOpen(false);
    router.push(href);
  };
  const contextActive = contextNavigation.find((item) => isContextActive(pathname, item.href, item.key));
  const hasContext = contextNavigation.length > 0;

  return (
    <WorkspaceShell
      className={`admin-shell${hasContext ? " admin-shell--with-context" : ""}${navigationOpen ? " admin-shell--nav-open" : ""}`}
      data-shell="admin"
    >
      <WorkspaceSkipLink href="#admin-workspace-content">{t("a11y.skip")}</WorkspaceSkipLink>
      <WorkspaceTopbar className="admin-shell__topbar">
        <button
          aria-controls="admin-global-navigation"
          aria-expanded={navigationOpen}
          aria-label={t("navigation.open")}
          className="admin-shell__mobile-menu"
          onClick={() => setNavigationOpen((open) => !open)}
          type="button"
        >
          <List aria-hidden size={19} weight="bold" />
        </button>
        <WorkspaceProductBrand href="/studio" product="Admin" />
        <WorkspaceSearchTrigger onClick={() => setSearchOpen(true)}>
          {t("search.placeholder")}
        </WorkspaceSearchTrigger>
        <WorkspaceTopbarActions>
          <Link
            className={`admin-shell__serving-status admin-shell__serving-status--${readMode}`}
            href="/studio/settings"
            prefetch={false}
            title={t("topbar.servingHelp")}
          >
            <span aria-hidden />
            <strong>{t("topbar.serving")}</strong>
            {t(`topbar.readMode.${readMode}`)}
          </Link>
          <WorkspaceAccount
            label={initials(user.fullName ?? user.email)}
            name={user.fullName ?? user.email}
          />
        </WorkspaceTopbarActions>
      </WorkspaceTopbar>

      <WorkspaceGlobalSidebar
        aria-label={t("navigation.label")}
        className="admin-shell__global-sidebar"
        id="admin-global-navigation"
      >
        <WorkspaceNavigation>
          {navigation.map((item, index) => (
            <div className={item.section === "advanced" ? "admin-shell__nav-section" : undefined} key={item.key}>
              {item.section === "advanced" && navigation[index - 1]?.section !== "advanced" ? (
                <small>{t("navigation.advanced")}</small>
              ) : null}
              <WorkspaceNavLink
                active={isGlobalActive(pathname, item.href, item.key)}
                href={item.href}
                icon={ADMIN_ICONS[item.key]}
                label={t(`navigation.items.${item.key}`)}
                onNavigate={() => navigate(item.href)}
                pending={pendingHref === item.href}
              />
            </div>
          ))}
        </WorkspaceNavigation>
        <div className="admin-shell__sidebar-foot">
          <small>{t("navigation.role")}</small>
          <strong>{t(`roles.${roleKey(user.primaryRole)}`)}</strong>
        </div>
      </WorkspaceGlobalSidebar>

      {hasContext ? (
        <WorkspaceContextSidebar
          aria-label={t(`${contextNamespace}.label`)}
          className="admin-shell__context-sidebar"
        >
          <div className="admin-shell__context-head">
            <small>{t(`${contextNamespace}.eyebrow`)}</small>
            <strong>{t(`${contextNamespace}.title`)}</strong>
          </div>
          <nav>
            {contextNavigation.map((item) => (
              <WorkspaceNavLink
                active={isContextActive(pathname, item.href, item.key)}
                activeClassName="admin-shell__context-link--active"
                className={`admin-shell__context-link${"depth" in item && item.depth === 1 ? " admin-shell__context-link--nested" : ""}`}
                href={item.href}
                key={item.key}
                label={t(`${contextNamespace}.items.${item.key}`)}
                onNavigate={() => navigate(item.href)}
                pending={pendingHref === item.href}
                pendingClassName="admin-shell__context-link--pending"
              />
            ))}
          </nav>
        </WorkspaceContextSidebar>
      ) : null}

      <WorkspaceOverlay
        aria-hidden={!navigationOpen}
        aria-label={t("navigation.close")}
        className="admin-shell__nav-scrim"
        onClick={() => setNavigationOpen(false)}
        tabIndex={navigationOpen ? 0 : -1}
      />

      <WorkspaceMain className="admin-shell__main" id="admin-workspace-content">
        {hasContext && contextActive ? (
          <div className="admin-shell__context-select">
            <span>{t(`${contextNamespace}.compactLabel`)}</span>
            <WorkspaceSelect
              ariaLabel={t(`${contextNamespace}.compactLabel`)}
              className="admin-shell__context-picker"
              name="admin-context-view"
              onChange={navigate}
              options={contextNavigation.map((item) => ({
                label: t(`${contextNamespace}.items.${item.key}`),
                value: item.href
              }))}
              value={pendingHref ?? contextActive.href}
            />
          </div>
        ) : null}
        <div className={pendingHref && !showPendingSkeleton ? "admin-shell__content admin-shell__content--updating" : "admin-shell__content"}>
          {showPendingSkeleton && pendingHref
            ? <AdminRouteSkeleton delayed={false} kind={adminSkeletonKind(pendingHref)} />
            : children}
        </div>
      </WorkspaceMain>

      {searchOpen ? (
        <div className="admin-shell__command-layer">
          <button
            aria-label={t("search.close")}
            className="admin-shell__command-scrim"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            type="button"
          />
          <section aria-label={t("search.label")} aria-modal="true" className="admin-shell__command" role="dialog">
            <div>
              <MagnifyingGlass aria-hidden size={17} />
              <input
                aria-label={t("search.label")}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("search.input")}
                ref={searchRef}
                value={searchQuery}
              />
              <button aria-label={t("search.close")} onClick={() => {
                setSearchOpen(false);
                setSearchQuery("");
              }} type="button">
                <X aria-hidden size={16} />
              </button>
            </div>
            <nav>
              {navigation.filter((item) => item.section !== "advanced" && (
                !searchQuery.trim()
                || t(`navigation.items.${item.key}`).toLocaleLowerCase()
                  .includes(searchQuery.trim().toLocaleLowerCase())
              )).map((item) => (
                <Link href={item.href} key={item.key} onClick={() => setSearchOpen(false)} prefetch={false}>
                  {ADMIN_ICONS[item.key]}
                  {t(`navigation.items.${item.key}`)}
                </Link>
              ))}
              <Link href="/studio/brands/new" onClick={() => setSearchOpen(false)} prefetch={false}>
                <Buildings aria-hidden />
                {t("search.createBrand")}
              </Link>
            </nav>
          </section>
        </div>
      ) : null}
    </WorkspaceShell>
  );
}

function adminSkeletonKind(href: string) {
  if (href === "/studio/brands/new") return "brandForm" as const;
  if (/^\/studio\/brands\/[^/]+\/(?:brand-os|edit)$/u.test(href)) return "brandForm" as const;
  if (/^\/studio\/brands\/[^/]+(?:\/|$)/u.test(href)) return "brandWorkspace" as const;
  if (href.startsWith("/studio/brands")) return "brands" as const;
  if (href.startsWith("/studio/data")) return "data" as const;
  if (href.startsWith("/studio/reports")) return "reports" as const;
  if (href.startsWith("/studio/team")) return "team" as const;
  if (href.startsWith("/studio/settings")) return "settings" as const;
  if (href.startsWith("/studio/themes")) return "themes" as const;
  if (href === "/studio/corpora/new") return "studyWizard" as const;
  if (href.startsWith("/studio/corpora/")) return "study" as const;
  return "index" as const;
}

function isGlobalActive(pathname: string, href: string, key: AdminNavigationKey) {
  if (key === "dashboard") return pathname === href;
  if (key === "brands") return pathname.startsWith("/studio/brands");
  if (key === "corpora") return pathname.startsWith("/studio/corpora");
  if (key === "themes") return pathname.startsWith("/studio/themes");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isContextActive(
  pathname: string,
  href: string,
  key: BrandContextNavigationKey | CorpusContextNavigationKey
) {
  if (key === "overview") return pathname === href;
  if (key === "data" || key === "data-mentions" || key === "data-review") return pathname === href;
  if (key === "brand-os") return pathname === href || pathname === `${href.replace(/\/brand-os$/u, "")}/edit`;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(value: string) {
  return value.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "N";
}

function roleKey(role: string) {
  return role === "noisia_admin" ? "admin" : "analyst";
}
