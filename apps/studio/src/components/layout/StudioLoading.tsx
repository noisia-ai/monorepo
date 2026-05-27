import { StudioNav } from "@/components/layout/StudioNav";

type StudioLoadingProps = {
  withNav?: boolean;
  title?: string;
};

export function StudioLoading({ withNav = true, title = "Preparando workspace" }: StudioLoadingProps) {
  return (
    <>
      {withNav ? <StudioNav activeSection={null} /> : null}
      <main className="app-content" aria-busy="true" aria-live="polite">
        <div className="studio-page studio-loading-page">
          <section className="loading-vitals">
            <div>
              <span className="skeleton skeleton-eyebrow" />
              <span className="skeleton skeleton-title" />
              <p>{title}</p>
            </div>
            <div className="loading-vitals-stats">
              <span className="skeleton skeleton-stat" />
              <span className="skeleton skeleton-stat" />
              <span className="skeleton skeleton-stat" />
            </div>
          </section>

          <section className="loading-grid">
            {/* TODO mejora-futura: hacer skeletons especificos por ruta cuando
                tengamos vistas finales de reportes, outputs y administración. */}
            {Array.from({ length: 6 }, (_, index) => (
              <article className="loading-card" key={index}>
                <span className="skeleton skeleton-pill" />
                <span className="skeleton skeleton-line skeleton-line--wide" />
                <span className="skeleton skeleton-line" />
                <span className="skeleton skeleton-line skeleton-line--short" />
              </article>
            ))}
          </section>
        </div>
      </main>
    </>
  );
}
