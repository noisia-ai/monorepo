import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Dashboards",
};

export default function DashboardsIndexPage() {
  return (
    <div className="db-index">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Image src="/assets/logos/logo_black.svg" alt="Noisia" width={84} height={22} priority />
      </div>
      <div className="db-index__head">
        <span className="db-index__eyebrow">Workspace</span>
        <h1 className="db-index__title">Dashboards</h1>
        <p className="db-index__sub">
          Cada cliente con un protocolo operativo activo tiene su propio workspace. Acceso restringido por sesión.
        </p>
      </div>
      <div className="db-index__grid">
        <Link href="/dashboards/grupo-salinas" className="db-card db-index__card">
          <span className="db-index__eyebrow">Cliente activo</span>
          <span className="db-index__card-name">Grupo Salinas</span>
          <span className="db-index__card-sub">
            Analítica de contenido · TikTok · YouTube · Instagram · 5 marcas
          </span>
        </Link>
      </div>
    </div>
  );
}
