import type { ClientBrandContextProcessingQuoteViewV1 } from "./client-brand-context-processing-quote";

type WorkspaceContext = { workspace: { id: string }; session: { appUser: { id: string } } } | { response: Response };

export function createClientBrandContextProcessingQuoteGetV1(dependencies: {
  loadWorkspaceContext: (workspaceId: string) => Promise<WorkspaceContext>;
  loadQuote: (args: { workspaceId: string; actorUserId: string }) => Promise<ClientBrandContextProcessingQuoteViewV1>;
  logError?: (error: unknown) => void;
}) {
  const headers = { "Cache-Control": "private, no-store" };
  const rejected = (status: number) => {
    const publicStatus = [400, 401, 403, 404].includes(status) ? status : 503;
    const suffix = publicStatus === 400 ? "invalid"
      : publicStatus === 401 ? "unauthorized"
      : publicStatus === 403 ? "forbidden"
      : publicStatus === 404 ? "not_found"
      : "unavailable";
    return Response.json({ error: `brand_context_processing_quote_${suffix}` }, {
      status: publicStatus,
      headers
    });
  };
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
