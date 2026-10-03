import { handleAuth } from "@kinde-oss/kinde-auth-nextjs/server";

import { handleKindeCallbackRequest } from "@/lib/auth/kinde-callback";

export const dynamic = "force-dynamic";

const callbackHandler = handleAuth();

export async function GET(request: Request) {
  return handleKindeCallbackRequest(request, callbackHandler);
}
