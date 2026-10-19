import { forbidden, unauthorized } from "@/lib/api/responses";
import { canManageCorpus } from "@/lib/auth/roles";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { decodePerformanceCsvInput, parsePerformanceCsv, type PerformanceFieldMapping } from "@/lib/signal-pulse/performance-import";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();
  if (!canManageCorpus(session.appUser.primaryRole)) return forbidden();

  const url = new URL(request.url);
  const provider = cleanParam(url.searchParams.get("provider")) || "file";
  const fileName = cleanParam(url.searchParams.get("file_name")) || cleanParam(url.searchParams.get("source_label")) || "Performance export";
  const defaultPlatform = cleanParam(url.searchParams.get("platform")) || provider;
  const defaultChannel = cleanParam(url.searchParams.get("channel")) || "paid";
  const mapping = parseMapping(url.searchParams.get("mapping"));
  const text = decodePerformanceCsvInput(await request.arrayBuffer());

  if (!text.trim()) {
    return Response.json(
      { error: "validation_error", message: "Performance CSV file is required." },
      { status: 422 }
    );
  }

  const parsed = parsePerformanceCsv(text, {
    mapping,
    defaultPlatform,
    defaultChannel,
    sourceFileName: fileName
  });

  return Response.json({
    ok: true,
    mode: "preview",
    mapping: parsed.mapping,
    stats: parsed.stats,
    diagnostics: parsed.diagnostics,
    warnings: parsed.warnings,
    preview: parsed.preview
  });
}

function parseMapping(value: string | null): PerformanceFieldMapping | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PerformanceFieldMapping : undefined;
  } catch {
    return undefined;
  }
}

function cleanParam(value: string | null) {
  return value?.trim().slice(0, 180) ?? "";
}
