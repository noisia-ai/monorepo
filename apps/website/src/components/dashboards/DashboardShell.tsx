"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type SidebarLink = {
  href: string;
  label: string;
  status?: "live" | "warn" | "idle";
};

type Group = {
  label: string;
  links: SidebarLink[];
};

const GROUPS: Group[] = [
  {
    label: "Dashboards",
    links: [
      { href: "/dashboards/grupo-salinas", label: "Grupo Salinas", status: "live" },
    ],
  },
  {
    label: "Workspace",
    links: [
      { href: "/dashboards/grupo-salinas/videos", label: "Videos" },
      { href: "/dashboards/grupo-salinas/configuracion", label: "Configuración" },
    ],
  },
];

export function DashboardShell({
  title,
  badge,
  actions,
  children,
}: {
  title: string;
  badge?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="db-shell">
      <aside className="db-sidebar">
        <div className="db-sidebar__logo">
          <Image
            src="/assets/logos/logo_black.svg"
            alt="Noisia"
            width={84}
            height={22}
            priority
          />
        </div>

        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="db-sidebar__label">{group.label}</div>
            {group.links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`db-sidebar__link ${active ? "is-active" : ""}`}
                >
                  <span
                    className={`db-sidebar__dot ${
                      link.status === "live"
                        ? "db-sidebar__dot--live"
                        : link.status === "warn"
                          ? "db-sidebar__dot--warn"
                          : ""
                    }`}
                  />
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="db-sidebar__divider" />

        <div className="db-sidebar__label">Cuenta</div>
        <Link href="/" className="db-sidebar__link">
          <span className="db-sidebar__dot" />
          Volver al sitio
        </Link>

        <div className="db-sidebar__spacer" />

        <div className="db-sidebar__health">
          <span className="db-sidebar__health-label">Sistema</span>
          <span className="db-sidebar__health-status">Activo</span>
          <span className="db-sidebar__health-sub">3 fuentes · actualizado hace 12 min</span>
        </div>
      </aside>

      <div className="db-main">
        <header className="db-toolbar">
          <div className="db-toolbar__title">
            <h1>{title}</h1>
            {badge ? <span className="db-toolbar__badge">{badge}</span> : null}
          </div>
          <div className="db-toolbar__actions">{actions}</div>
        </header>
        <div className="db-content">
          <div className="db-content__inner">{children}</div>
        </div>
      </div>
    </div>
  );
}
