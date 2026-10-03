import { SignalV2WorkspacePage } from "@/components/signal-v2/SignalV2WorkspacePage";

import "../../../../signal-v2/signal-v2.css";

export const dynamic = "force-dynamic";

export default async function SignalTriggersBarriersReportPage({
  params,
  searchParams
}: {
  params: Promise<{ outputId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { outputId } = await params;
  return (
    <SignalV2WorkspacePage
      activeReportKey="triggers-barriers"
      searchParams={searchParams}
      workspaceSlug={outputId}
    />
  );
}
