import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SessionBadge } from "@/components/layout/SessionBadge";
import { Icon } from "@/components/ui/Icon";
import { canManageTeam } from "@/lib/auth/roles";

type Crumb = { label: string; href?: string };
type StudioNavUser = {
  email: string;
  fullName: string | null;
  primaryRole: string;
};

type StudioNavProps = {
  crumbs?: Crumb[];
  /** Show the Marcas/Themes pill tabs (default true on top-level pages). */
  showSections?: boolean;
  activeSection?: "brands" | "themes" | "home" | "team" | null;
  user?: StudioNavUser;
};

/**
 * Top navigation for all /studio pages that don't have the corpus navbar.
 * Mirrors the corpus-navbar visually (glass floating pill) but shows the
 * full nav (logo + breadcrumbs + sections) instead of corpus context.
 */
export async function StudioNav({ crumbs = [], showSections = true, activeSection = null, user }: StudioNavProps) {
  const t = await getTranslations("Nav");

  return (
    <nav className="studio-navbar" aria-label="Noisia Studio">
      <Link prefetch={false} href="/studio" className="studio-navbar-logo" aria-label={t("workspace")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logos/logo_black.svg" alt="Noisia" width={84} height={29} />
      </Link>

      {crumbs.length > 0 && (
        <ol className="studio-navbar-crumbs" aria-label={t("breadcrumbs")}>
          {crumbs.map((c, i) => (
            <li key={i} className="studio-navbar-crumb">
              {i > 0 && <Icon name="chevron-down" size={12} className="studio-navbar-sep" />}
              {c.href ? (
                <Link prefetch={false} href={c.href}>{c.label}</Link>
              ) : (
                <span className="studio-navbar-crumb-current">{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      )}

      {showSections && (
        <div className="studio-navbar-sections" role="tablist">
          <SectionTab href="/studio/brands" active={activeSection === "brands"}>
            {t("brands")}
          </SectionTab>
          <SectionTab href="/studio/themes" active={activeSection === "themes"}>
            {t("themes")}
          </SectionTab>
          {user && canManageTeam(user.primaryRole) ? (
            <SectionTab href="/studio/team" active={activeSection === "team"}>
              {t("team")}
            </SectionTab>
          ) : null}
        </div>
      )}

      {user ? <SessionBadge user={user} compact /> : null}
    </nav>
  );
}

function SectionTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link prefetch={false}
      href={href}
      className={`studio-section-tab${active ? " studio-section-tab--active" : ""}`}
      role="tab"
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
