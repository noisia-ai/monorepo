import { unauthorized } from "@/lib/api/responses";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { getSignalOutputForUser } from "@/lib/data/signal";
import {
  buildPulseApiContext,
  isSignalPulseOutput
} from "@/lib/signal-pulse/pulse-api";

export async function loadPulseApiContext(outputId: string) {
  const session = await getAuthenticatedAppUser();
  if (!session) return { response: unauthorized() } as const;

  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (!isSignalPulseOutput(output)) {
    return {
      response: Response.json({ error: "not_found", message: "Signal Pulse output not found." }, { status: 404 })
    } as const;
  }

  const context = buildPulseApiContext({
    output,
    isInternalUser: session.appUser.userType === "noisia_internal"
  });

  return { output, ...context } as const;
}
