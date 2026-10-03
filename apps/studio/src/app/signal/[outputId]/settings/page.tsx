import "@/app/signal-v2/signal-v2.css";

import { SignalV2WorkspacePage } from "@/components/signal-v2/SignalV2WorkspacePage";

export default async function SignalWorkspaceSettingsPage({
  params,
  searchParams
}: {
  params: Promise<{ outputId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { outputId } = await params;
  return (
    <SignalV2WorkspacePage
      activeModule="settings"
      searchParams={searchParams}
      workspaceSlug={outputId}
    />
  );
}
