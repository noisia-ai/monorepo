import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminDashboard } from "@/lib/data/admin-workspace";

export const dynamic = "force-dynamic";

export default async function StudioHomePage() {
  const session = await requireStudioUser("/studio");
  const dashboard = await getAdminDashboard(session.appUser);
  return <AdminDashboard dashboard={dashboard} />;
}
