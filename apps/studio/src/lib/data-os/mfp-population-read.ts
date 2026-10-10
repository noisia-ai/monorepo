/** Population queries share one slot before acquiring a database connection.
 * The other two pool connections remain available to metadata and mutations.
 * This is process-wide, including separate route bundles and browser tabs.
 */
export function createMfpPopulationReader(maxPending = 8, waitMs = 60_000) {
  type Item = { start: () => void; cancel: () => void };
  const queue: Item[] = [];
  let active = false;
  const pump = () => {
    if (active) return;
    const next = queue.shift();
    if (next) { active = true; next.start(); }
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
            .finally(() => { active = false; pump(); });
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
};
export const readMfpPopulation = shared.noisiaMfpPopulationReader ??= createMfpPopulationReader();
