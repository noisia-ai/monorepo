import Link from "next/link";

import { StudioNav } from "@/components/layout/StudioNav";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import { requireStudioUser } from "@/lib/auth/guards";
import { listThemesForUser } from "@/lib/data/themes";
import {
  getPositiveNumber,
  getSearchParam,
  resolveSearchParams,
  type StudioSearchParams,
} from "@/lib/url/search";

export const dynamic = "force-dynamic";

export default async function ThemesPage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const session = await requireStudioUser("/studio/themes");

  const params = await resolveSearchParams(searchParams);
  const filters = {
    organization: getSearchParam(params, "organization"),
    industry: getSearchParam(params, "industry"),
    status: getSearchParam(params, "status"),
    page: getPositiveNumber(getSearchParam(params, "page"), 1),
    pageSize: 25,
  };
  const result = await listThemesForUser(session.appUser, filters);
  const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.pageSize));

  return (
    <>
      <StudioNav activeSection="themes" crumbs={[{ label: "Themes" }]} user={session.appUser} />
      <main className="app-content">
        <div className="studio-page">
          <header className="page-head">
            <div>
              <p className="vitals-eyebrow">Studio</p>
              <h1 className="page-head-title">Themes</h1>
              <p className="page-head-sub">
                {result.pagination.total} {result.pagination.total === 1 ? "theme" : "themes"} ·
                página {result.pagination.page} de {totalPages}
              </p>
              <p className="page-head-sub">
                Themes son estudios temáticos no atados a una marca: sirven para investigar tópicos,
                categorías o tensiones de mercado y después correr corpora con metodologías.
              </p>
            </div>
          </header>

          <form className="filter-bar-v2">
            <label className="filter-field">
              <span className="filter-label">Organización</span>
              <input
                className="filter-input"
                defaultValue={filters.organization ?? ""}
                name="organization"
                placeholder="internal, slug o UUID"
              />
            </label>
            <label className="filter-field">
              <span className="filter-label">Industria</span>
              <input
                className="filter-input"
                defaultValue={filters.industry ?? ""}
                name="industry"
                placeholder="ej. seguros"
              />
            </label>
            <label className="filter-field">
              <span className="filter-label">Status</span>
              <select className="filter-input" defaultValue={filters.status ?? ""} name="status">
                <option value="">Todos</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <button className="wizard-cta wizard-cta--secondary" type="submit">
              <Icon name="play" size={13} /> Filtrar
            </button>
          </form>

          {result.data.length === 0 ? (
            <div className="empty-card">
              <Icon name="info" size={20} className="empty-card-icon" />
              <p>No hay themes con esos filtros.</p>
            </div>
          ) : (
            <ul className="brand-grid">
              {result.data.map((theme) => (
                <li key={theme.id}>
                  <Link prefetch={false} href={`/studio/themes/${theme.id}`} className="brand-card">
                    <div className="brand-card-head">
                      <div>
                        <p className="brand-card-eyebrow">
                          {theme.organizationName ?? theme.organizationSlug ?? "Noisia Internal"}
                        </p>
                        <h3 className="brand-card-name">{theme.name}</h3>
                      </div>
                      {theme.status === "published" || theme.status === "active" ? (
                        <SuccessPill>{theme.status}</SuccessPill>
                      ) : (
                        <StatusPill tone="idle">{theme.status}</StatusPill>
                      )}
                    </div>
                    <p className="brand-card-meta">
                      {theme.industryFocus && theme.industryFocus.length > 0
                        ? theme.industryFocus.join(", ")
                        : "Sin industria"}
                    </p>
                    <footer className="brand-card-foot">
                      <Icon name="arrow-right" size={16} className="brand-card-arrow" />
                    </footer>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <nav className="pagination-v2" aria-label="Paginación de themes">
              <Link prefetch={false}
                className="wizard-cta wizard-cta--ghost"
                href={`/studio/themes?page=${Math.max(1, filters.page - 1)}`}
              >
                <Icon name="chevron-down" size={13} className="icon--flip" /> Anterior
              </Link>
              <span className="pagination-position">
                {filters.page} / {totalPages}
              </span>
              <Link prefetch={false}
                className="wizard-cta wizard-cta--ghost"
                href={`/studio/themes?page=${Math.min(totalPages, filters.page + 1)}`}
              >
                Siguiente <Icon name="arrow-right" size={13} />
              </Link>
            </nav>
          )}
        </div>
      </main>
    </>
  );
}
