export default function Loading() {
  return (
    <main className="app-content" aria-busy="true" aria-live="polite">
      <div className="studio-page studio-loading-page">
        <section className="loading-vitals loading-vitals--corpus">
          <div>
            <span className="skeleton skeleton-eyebrow" />
            <span className="skeleton skeleton-title" />
            <p>Cargando corpus y estado del engine</p>
          </div>
          <div className="loading-vitals-stats">
            <span className="skeleton skeleton-stat" />
            <span className="skeleton skeleton-stat" />
          </div>
        </section>

        <section className="loading-workbench">
          {/* TODO mejora-futura: separar skeletons para Engine y Menciones
              cuando el browser de menciones se reutilice en reportes finales. */}
          <div className="loading-workbench-main">
            <span className="skeleton skeleton-line skeleton-line--wide" />
            <span className="skeleton skeleton-block" />
            <span className="skeleton skeleton-block skeleton-block--short" />
          </div>
          <aside className="loading-workbench-side">
            <span className="skeleton skeleton-pill" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line skeleton-line--short" />
          </aside>
        </section>
      </div>
    </main>
  );
}
