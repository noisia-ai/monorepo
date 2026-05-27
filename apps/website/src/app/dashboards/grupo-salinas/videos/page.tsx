import { DashboardShell } from "@/components/dashboards/DashboardShell";
import { VideosTable } from "@/components/dashboards/VideosTable";
import { loadAllVideos } from "@/lib/dashboards/grupo-salinas";

export const metadata = {
  title: "Grupo Salinas — Videos",
};

export default function VideosPage() {
  const videos = loadAllVideos();

  return (
    <DashboardShell
      title="Grupo Salinas · Videos"
      badge={`${videos.length} videos indexados`}
      actions={
        <>
          <button type="button" className="db-btn">Exportar CSV</button>
          <button type="button" className="db-btn db-btn--primary">+ Comparar 2 videos</button>
        </>
      }
    >
      <VideosTable allVideos={videos} />
    </DashboardShell>
  );
}
