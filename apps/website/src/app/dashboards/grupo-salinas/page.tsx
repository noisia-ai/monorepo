import { DashboardShell } from "@/components/dashboards/DashboardShell";
import { GrupoSalinasDashboard } from "@/components/dashboards/GrupoSalinasDashboard";
import { loadAllVideos } from "@/lib/dashboards/grupo-salinas";

export const metadata = {
  title: "Grupo Salinas — Resumen",
};

export default function GrupoSalinasPage() {
  const videos = loadAllVideos();

  return (
    <DashboardShell
      title="Grupo Salinas · Analítica de contenido"
      badge={`${videos.length} videos · 5 marcas`}
      actions={
        <>
          <button type="button" className="db-btn" title="Exportar CSV (HU-20)">
            Exportar CSV
          </button>
          <button type="button" className="db-btn db-btn--primary" title="Generar PDF (HU-22)">
            Generar PDF
          </button>
        </>
      }
    >
      <GrupoSalinasDashboard allVideos={videos} />
    </DashboardShell>
  );
}
