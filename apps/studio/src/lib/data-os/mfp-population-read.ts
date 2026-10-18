/** Population queries share one slot before acquiring a database connection.
 * The other two pool connections remain available to metadata and mutations.
 * This is process-wide, including separate route bundles and browser tabs.
 */
export function createMfpPopulationReader(maxPending = 8, waitMs = 120_000, concurrency = 1) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("read_concurrency_invalid");
  type Item = { start: () => void; cancel: () => void };
  const queue: Item[] = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length) {
      const next = queue.shift()!; active++; next.start();
    }
  };
  return <T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(new DOMException('Read aborted', 'AbortError'));
    if (queue.length >= maxPending) return Promise.reject(new Error('population_read_busy'));
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', item.cancel); };
      const remove = (error: Error) => {
        const index = queue.indexOf(item);
        if (index < 0) return;
        queue.splice(index, 1); cleanup(); reject(error);
      };
      const item: Item = {
        cancel: () => remove(new DOMException('Read aborted', 'AbortError')),
        start: () => {
          cleanup();
          Promise.resolve().then(read).then(resolve, reject)
            .finally(() => { active--; pump(); });
        },
      };
      const timer = setTimeout(() => remove(new Error('population_read_busy')), waitMs);
      signal?.addEventListener('abort', item.cancel, { once: true });
      queue.push(item); pump();
    });
  };
}

const shared = globalThis as typeof globalThis & {
  noisiaMfpPopulationReader?: ReturnType<typeof createMfpPopulationReader>;
  noisiaWorkspaceAnalysisReader?: ReturnType<typeof createMfpPopulationReader>;
};
export const readMfpPopulation = shared.noisiaMfpPopulationReader ??= createMfpPopulationReader();

/** Analysis stores acquire at most two clients; keep a pool slot for metadata,
 * population reads and recovery rather than queueing nine checkout requests. */
export const readWorkspaceAnalysis = shared.noisiaWorkspaceAnalysisReader ??= createMfpPopulationReader(8, 120_000, 2);
