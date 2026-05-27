export default function PortalLoading() {
  return (
    <main className="portal-page">
      <section className="portal-hero portal-hero--loading">
        <div className="skeleton-line skeleton-line--wide" />
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line skeleton-line--copy" />
      </section>
    </main>
  );
}
