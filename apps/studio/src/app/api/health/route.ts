import { NextResponse } from "next/server";

import { assertStudioUatIdentity } from "@/lib/runtime/uat-identity";

export const dynamic = "force-dynamic";

const coreRequiredEnv = [
  "DATABASE_URL",
  "REDIS_URL",
  "KINDE_CLIENT_ID",
  "KINDE_CLIENT_SECRET",
  "KINDE_ISSUER_URL",
  "KINDE_SITE_URL",
  "KINDE_POST_LOGIN_REDIRECT_URL",
  "KINDE_POST_LOGOUT_REDIRECT_URL"
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";
  const missingEnv = coreRequiredEnv.filter((key) => !process.env[key]);
  const missingCapabilities = ["ANTHROPIC_API_KEY"].filter((key) => !process.env[key]);

  const checks: Record<string, "ok" | "missing" | "skipped" | "error"> = {
    app: "ok",
    env: missingEnv.length ? "missing" : "ok",
    database: "skipped",
    llm_provider: missingCapabilities.length ? "missing" : "ok",
    uat_identity: "skipped"
  };

  if (deep) {
    try {
      assertStudioUatIdentity();
      checks.uat_identity = "ok";
    } catch {
      checks.uat_identity = "error";
    }
  }

  if (deep && !missingEnv.includes("DATABASE_URL")) {
    try {
      const { pool } = await import("@/lib/db");
      await pool.query("select 1");
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }
  }

  const ok = !deep || (
    missingEnv.length === 0
    && checks.database === "ok"
    && checks.uat_identity === "ok"
  );

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      runtimeProfile: process.env.NOISIA_RUNTIME_PROFILE?.trim() || "default",
      checks,
      missingEnv,
      missingCapabilities
    },
    { status: ok ? 200 : 503 }
  );
}
