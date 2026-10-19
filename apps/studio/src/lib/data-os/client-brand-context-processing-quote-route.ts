import {
  validClientBrandContextProcessingConfirmationV1,
  type ClientBrandContextProcessingConfirmationV1,
  type ClientBrandContextProcessingQuoteViewV1,
  type ClientBrandContextProcessingViewV1
} from "./client-brand-context-processing-quote";

type ReadWorkspaceContext = { workspace: { id: string }; session: { appUser: { id: string } } } | { response: Response };
type MutationWorkspaceContext = { workspace: { id: string; organizationId: string; subject: { type: string; id: string } };
  session: { appUser: { id: string } } } | { response: Response };

const headers = { "Cache-Control": "private, no-store" };
function rejected(status: number, code = "brand_context_processing_quote") {
  const publicStatus = [400, 401, 403, 404, 409, 422].includes(status) ? status : 503;
  const suffix = publicStatus === 400 ? "invalid"
    : publicStatus === 401 ? "unauthorized"
    : publicStatus === 403 ? "forbidden"
    : publicStatus === 404 ? "not_found"
    : publicStatus === 409 ? "changed"
    : publicStatus === 422 ? "invalid" : "unavailable";
  return Response.json({ error: `${code}_${suffix}` }, { status: publicStatus, headers });
}

export function createClientBrandContextProcessingQuoteGetV1(dependencies: {
  loadWorkspaceContext: (workspaceId: string) => Promise<ReadWorkspaceContext>;
  loadQuote: (args: { workspaceId: string; actorUserId: string }) => Promise<
    ClientBrandContextProcessingViewV1 | ClientBrandContextProcessingQuoteViewV1>;
  logError?: (error: unknown) => void;
}) {
  return async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
    const { workspaceId } = await context.params;
    try {
      const loaded = await dependencies.loadWorkspaceContext(workspaceId);
      if ("response" in loaded) return rejected(loaded.response.status);
      const quote = await dependencies.loadQuote({
        workspaceId: loaded.workspace.id,
        actorUserId: loaded.session.appUser.id
      });
      if (quote.workspace_id !== loaded.workspace.id) return rejected(503);
      return Response.json(quote, { headers });
    } catch (error) {
      dependencies.logError?.(error);
      const forbidden = error instanceof Error && "code" in error && error.code === "processing_forbidden"
        && "status" in error && error.status === 403;
      return rejected(forbidden ? 403 : 503);
    }
  };
}

export function createClientBrandContextProcessingPostV1(dependencies: {
  loadWorkspaceContext: (workspaceId: string) => Promise<MutationWorkspaceContext>;
  start: (args: { workspace: { id: string; organizationId: string; brandId: string };
    actorUserId: string; idempotencyKey: string;
    body: ClientBrandContextProcessingConfirmationV1 })
    => Promise<ClientBrandContextProcessingViewV1>;
  logError?: (error: unknown) => void;
}) {
  return async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
    const { workspaceId } = await context.params;
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) return rejected(400, "idempotency_key");
    let body: unknown;
    try { body = await request.json(); } catch { return rejected(422, "brand_context_processing_request"); }
    if (!validClientBrandContextProcessingConfirmationV1(body)) {
      return rejected(422, "brand_context_processing_request");
    }
    try {
      const loaded = await dependencies.loadWorkspaceContext(workspaceId);
      if ("response" in loaded) return rejected(loaded.response.status);
      if (loaded.workspace.subject.type !== "brand") return rejected(404);
      const view = await dependencies.start({
        workspace: { id: loaded.workspace.id, organizationId: loaded.workspace.organizationId,
          brandId: loaded.workspace.subject.id },
        actorUserId: loaded.session.appUser.id,
        idempotencyKey,
        body
      });
      if (view.workspace_id !== loaded.workspace.id) return rejected(503);
      return Response.json(view, { status: 202, headers });
    } catch (error) {
      dependencies.logError?.(error);
      const status = error instanceof Error && "status" in error && typeof error.status === "number"
        ? error.status : 503;
      return rejected(status, "brand_context_processing_request");
    }
  };
}
