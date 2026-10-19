import type { ReactNode } from "react";

import { AdminShell } from "@/components/workspace/AdminShell";
import { requireStudioUser } from "@/lib/auth/guards";
import { signalOperationalReadMode } from "@/lib/data-os/signal-operational-read-scope";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: ReactNode }) {
  const session = await requireStudioUser("/studio");
  return (
    <AdminShell
      readMode={signalOperationalReadMode()}
      user={{
        email: session.appUser.email,
        fullName: session.appUser.fullName,
        primaryRole: session.appUser.primaryRole
      }}
    >
      {children}
    </AdminShell>
  );
}
