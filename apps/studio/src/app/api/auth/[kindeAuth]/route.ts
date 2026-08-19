import { handleAuth } from "@kinde-oss/kinde-auth-nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { canonicalAuthStartUrl } from "@/lib/auth/redirects";

const kindeAuthHandler = handleAuth();

type KindeAuthRouteContext = {
  params: Promise<{ kindeAuth: string | string[] }>;
};

export async function GET(request: NextRequest, context: KindeAuthRouteContext) {
  const { kindeAuth: rawEndpoint } = await context.params;
  const endpoint = Array.isArray(rawEndpoint) ? rawEndpoint[0] : rawEndpoint;
  const canonicalUrl = canonicalAuthStartUrl(request.url, endpoint);

  if (canonicalUrl) {
    const response = NextResponse.redirect(canonicalUrl);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  return kindeAuthHandler(request, context);
}
