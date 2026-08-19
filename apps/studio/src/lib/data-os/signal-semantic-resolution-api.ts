export type SignalSemanticResolutionStatusDependencies<TContext, TRun> = {
  loadContext: (workspaceId: string) => Promise<TContext | { response: Response }>;
  loadLatest: (workspaceId: string) => Promise<TRun | null>;
  isUnavailableSchema: (error: unknown) => boolean;
};

/** Polling is intentionally incapable of dispatching work. POST owns queueing. */
export async function handleSignalSemanticResolutionStatus<TContext extends {
  workspace: { id: string };
}, TRun>(
  workspaceId: string,
  dependencies: SignalSemanticResolutionStatusDependencies<TContext, TRun>
) {
  const loaded = await dependencies.loadContext(workspaceId);
  if ("response" in loaded) return loaded.response;
  try {
    const run = await dependencies.loadLatest(loaded.workspace.id);
    return semanticResolutionStatusJson({ available: true, run });
  } catch (error) {
    if (!dependencies.isUnavailableSchema(error)) throw error;
    return semanticResolutionStatusJson({ available: false, run: null });
  }
}

function semanticResolutionStatusJson(payload: unknown) {
  return Response.json(payload, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" }
  });
}
