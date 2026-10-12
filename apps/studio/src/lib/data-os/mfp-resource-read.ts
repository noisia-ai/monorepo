type Read = (endpoint: string, options: { signal?: AbortSignal; cache: 'no-store'; method: 'GET' }) => Promise<Response>;

/** Limit population reads per workspace; lighter reads and mutations never enter this queue. */
export function createMfpResourceReader(read: Read) {
  type Item = { run: () => void; cancel: () => void };
  type Lane = { active: boolean; queue: Item[] };
  const lanes = new Map<string, Lane>();
  const pump = (key: string, lane: Lane) => {
    if (lane.active) return;
    const next = lane.queue.shift();
    if (!next) { lanes.delete(key); return; }
    lane.active = true;
    next.run();
  };
  return (endpoint: string, signal?: AbortSignal): Promise<Response> => {
    const aborted = () => new DOMException('Read aborted', 'AbortError');
    if (signal?.aborted) return Promise.reject(aborted());
    const key = endpoint.match(/^\/api\/data-os\/signal\/([^/?]+)\/(?:facets|memberships)(?:\?|$)/u)?.[1];
    if (!key) return read(endpoint, { signal, cache: 'no-store', method: 'GET' });
    const lane = lanes.get(key) ?? { active: false, queue: [] };
    // Three mounted population readers fit; excess refreshes fail visibly instead of growing unbounded.
    if (lane.queue.length >= 3) return Promise.reject(new Error('request'));
    lanes.set(key, lane);
    return new Promise((resolve, reject) => {
      const item: Item = { cancel: () => {}, run: () => {} };
      item.cancel = () => {
        const index = lane.queue.indexOf(item);
        if (index < 0) return;
        lane.queue.splice(index, 1);
        signal?.removeEventListener('abort', item.cancel);
        reject(aborted());
      };
      item.run = () => {
        signal?.removeEventListener('abort', item.cancel);
        if (signal?.aborted) { lane.active = false; reject(aborted()); pump(key, lane); return; }
        Promise.resolve().then(() => read(endpoint, { signal, cache: 'no-store', method: 'GET' }))
          .then(resolve, reject).finally(() => { lane.active = false; pump(key, lane); });
      };
      signal?.addEventListener('abort', item.cancel, { once: true });
      lane.queue.push(item);
      pump(key, lane);
    });
  };
}
export const readMfpResource = createMfpResourceReader((endpoint, options) => fetch(endpoint, options));
