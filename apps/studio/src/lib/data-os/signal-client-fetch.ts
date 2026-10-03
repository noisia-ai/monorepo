const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type SignalJsonFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type SharedSignalJsonResult<T> = {
  body: T | null;
  ok: boolean;
};

const sharedSignalRequests = new Map<string, Promise<SharedSignalJsonResult<unknown>>>();

export class SignalClientFetchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SignalClientFetchError";
    this.status = status;
  }
}

/**
 * Coalesces identical read requests while they are in flight. This keeps React
 * Strict Mode and sibling consumers from asking the server to resolve the same
 * expensive Signal read more than once.
 */
export function fetchSharedSignalJson<T>(input: string): Promise<SharedSignalJsonResult<T>> {
  const current = sharedSignalRequests.get(input);
  if (current) return current as Promise<SharedSignalJsonResult<T>>;

  const request = fetch(input, { cache: "no-store" })
    .then(async (response) => ({
      body: await response.json().catch(() => null) as unknown,
      ok: response.ok
    }));

  sharedSignalRequests.set(input, request);
  const clear = () => {
    if (sharedSignalRequests.get(input) === request) sharedSignalRequests.delete(input);
  };
  void request.then(clear, clear);

  return request as Promise<SharedSignalJsonResult<T>>;
}

export async function fetchSignalJsonWithRetry<T>(
  input: string,
  options: {
    fallbackMessage: string;
    fetcher?: SignalJsonFetcher;
    retryDelaysMs?: number[];
    signal?: AbortSignal;
  }
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const retryDelaysMs = options.retryDelaysMs ?? [250, 650];

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    throwIfAborted(options.signal);
    let response: Response;
    try {
      response = await fetcher(input, {
        cache: "no-store",
        signal: options.signal
      });
    } catch (error) {
      if (options.signal?.aborted || attempt === retryDelaysMs.length) throw error;
      await waitForRetry(retryDelaysMs[attempt] ?? 0, options.signal);
      continue;
    }

    const payload = await response.json().catch(() => null) as T & { message?: string } | null;
    if (response.ok && payload != null) return payload;

    const error = new SignalClientFetchError(
      payload?.message ?? options.fallbackMessage,
      response.status
    );
    if (
      attempt === retryDelaysMs.length
      || !RETRYABLE_STATUSES.has(response.status)
    ) {
      throw error;
    }
    await waitForRetry(retryDelaysMs[attempt] ?? 0, options.signal);
  }

  throw new Error(options.fallbackMessage);
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw signal.reason ?? new Error("Request aborted.");
}

function waitForRetry(delayMs: number, signal: AbortSignal | undefined) {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new Error("Request aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
