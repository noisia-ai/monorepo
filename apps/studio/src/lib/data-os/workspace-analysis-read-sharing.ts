/** Share only an unfinished read with exactly the same authorized scope.
 * Each caller revalidates authority after waiting. No completed result is cached.
 */
export function createWorkspaceAnalysisReadSharing() {
  const databases = new WeakMap<object, Map<string, Promise<unknown>>>();
  return async <T>(database: object, scope: string, read: () => Promise<T>, revalidate: () => Promise<void>): Promise<T> => {
    let pending = databases.get(database);
    if (!pending) { pending = new Map(); databases.set(database, pending); }
    let value = pending.get(scope) as Promise<T> | undefined;
    if (!value) {
      const result = Promise.resolve().then(read);
      value = result.finally(() => { if (pending!.get(scope) === value) pending!.delete(scope); });
      pending.set(scope, value);
    }
    const result = await value;
    await revalidate();
    return structuredClone(result);
  };
}
const shared = globalThis as typeof globalThis & {
  noisiaWorkspaceAnalysisReadSharing?: ReturnType<typeof createWorkspaceAnalysisReadSharing>;
};
export const shareWorkspaceAnalysisRead = shared.noisiaWorkspaceAnalysisReadSharing ??= createWorkspaceAnalysisReadSharing();
