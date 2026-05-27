import Link from "next/link";

import { SessionBadge } from "@/components/layout/SessionBadge";
import { Icon } from "@/components/ui/Icon";

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
  activeSection?: "brands" | "themes" | "home" | null;
  user?: StudioNavUser;
};

/**
 * Top navigation for all /studio pages that don't have the corpus navbar.
 * Mirrors the corpus-navbar visually (glass floating pill) but shows the
 * full nav (logo + breadcrumbs + sections) instead of corpus context.
 */
export function StudioNav({ crumbs = [], showSections = true, activeSection = null, user }: StudioNavProps) {
  return (
    <nav className="studio-navbar" aria-label="Noisia Studio">
      <Link href="/studio" className="studio-navbar-logo" aria-label="Ir al workspace">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logos/logo_black.svg" alt="Noisia" width={84} height={29} />
      </Link>

      {crumbs.length > 0 && (
        <ol className="studio-navbar-crumbs" aria-label="Breadcrumbs">
          {crumbs.map((c, i) => (
            <li key={i} className="studio-navbar-crumb">
              {i > 0 && <Icon name="chevron-down" size={12} className="studio-navbar-sep" />}
              {c.href ? (
                <Link href={c.href}>{c.label}</Link>
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
            Marcas
          </SectionTab>
          <SectionTab href="/studio/themes" active={activeSection === "themes"}>
            Themes
          </SectionTab>
        </div>
      )}

      {user ? <SessionBadge user={user} compact /> : null}
    </nav>
  );
}

function SectionTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`studio-section-tab${active ? " studio-section-tab--active" : ""}`}
      role="tab"
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
