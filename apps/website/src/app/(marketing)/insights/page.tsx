import { InsightsIndexPage } from "@/components/insights/InsightsPages";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Insights",
  description: "Reportes editoriales de Noisia para convertir conversación digital en inteligencia accionable.",
  path: "/insights"
});

type InsightsPageProps = {
  searchParams?: Promise<{
    page?: string;
  }>;
};

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const params = await searchParams;
  const page = Number(params?.page ?? "1");

  return <InsightsIndexPage page={Number.isFinite(page) ? page : 1} />;
}
