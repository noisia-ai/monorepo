import { Suspense } from "react";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { requireStudioUser } from "@/lib/auth/guards";
import { resolveSearchParams, getSearchParam, type StudioSearchParams } from "@/lib/url/search";
import { getAdminDashboard, loadAdminDashboardCorpus } from "@/lib/data/admin-workspace";

export const dynamic = "force-dynamic";

export default async function StudioHomePage({ searchParams }: { searchParams?: StudioSearchParams }) {
  const session = await requireStudioUser("/studio");
  const dashboard = await getAdminDashboard(session.appUser, { includeCorpus: false });
  const requested = getSearchParam(await resolveSearchParams(searchParams), "receipts");
  const scope = requested === "all" || dashboard.brands.some(brand => brand.workspaceId === requested)
    ? requested : undefined;
  if (!scope) return <AdminDashboard dashboard={dashboard} corpusRequested={null} />;
  return (
    <Suspense fallback={<AdminDashboard dashboard={dashboard} corpusLoading corpusRequested={scope} />}>
      <DashboardCorpus dashboard={dashboard} user={session.appUser} scope={scope} />
    </Suspense>
  );
}

async function DashboardCorpus({ dashboard, user, scope }: {
  scope: string;
  dashboard: Awaited<ReturnType<typeof getAdminDashboard>>;
  user: Awaited<ReturnType<typeof requireStudioUser>>["appUser"];
}) {
  let resolved = dashboard;
  try {
    resolved = await loadAdminDashboardCorpus(user, dashboard, scope);
  } catch (error) {
    console.error("admin_dashboard_corpus_unavailable", error instanceof Error ? error.message : "unknown_error");
  }
  return <AdminDashboard dashboard={resolved} corpusRequested={scope} />;
}
