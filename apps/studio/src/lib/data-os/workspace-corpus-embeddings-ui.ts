export type CorpusEmbeddingRequest = {
  preparation_run_id: string;
  quote_digest: string;
  hard_cap_micro_usd: number;
};

export type PendingCorpusEmbeddingRequest = {
  version: 1;
  workspace_id: string;
  request_scope: string;
  key: string;
  body: CorpusEmbeddingRequest;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const digest = /^sha256:[0-9a-f]{64}$/u;
const microAmount = /^(?:0|[1-9]\d{0,15})$/u;

/** Currency input is decimal USD. Convert without floating point rounding. */
export function parseEmbeddingCapMicroUsd(value: string): string | null {
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,6}))?$/u.exec(value.trim());
  if (!match) return null;
  return (BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"))).toString();
}

export function embeddingCapUsdInput(microUsd: string): string {
  if (!microAmount.test(microUsd)) throw new Error("embedding_amount_invalid");
  const amount = BigInt(microUsd);
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${amount / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export function formatEmbeddingMicroUsd(microUsd: string, locale: string): string {
  if (!microAmount.test(microUsd) || BigInt(microUsd) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("embedding_amount_invalid");
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(microUsd) / 1_000_000);
}

export function embeddingRequestStorageKey(workspaceId: string, requestScope: string): string {
  return `noisia:corpus-embeddings:v1:${workspaceId}:${requestScope}`;
}

/** Retain only the exact paid request, never text, credentials or caller authority. */
export function parsePendingCorpusEmbeddingRequest(value: unknown, workspaceId: string, requestScope: string): PendingCorpusEmbeddingRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding_request_invalid");
  const pending = value as Partial<PendingCorpusEmbeddingRequest>;
  const body = pending.body;
  if (Object.keys(pending).sort().join(",") !== "body,key,request_scope,version,workspace_id"
    || pending.version !== 1 || pending.workspace_id !== workspaceId || pending.request_scope !== requestScope
    || typeof pending.key !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/u.test(pending.key)
    || !body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).sort().join(",") !== "hard_cap_micro_usd,preparation_run_id,quote_digest"
    || typeof body.preparation_run_id !== "string" || !uuid.test(body.preparation_run_id)
    || typeof body.quote_digest !== "string" || !digest.test(body.quote_digest)
    || !Number.isSafeInteger(body.hard_cap_micro_usd) || body.hard_cap_micro_usd < 0) {
    throw new Error("embedding_request_invalid");
  }
  return pending as PendingCorpusEmbeddingRequest;
}

export function latestCorpusEmbeddingSnapshot<T extends { workspace_id: string; observed_at: string }>(
  current: T | null, next: T, workspaceId: string
): T | null {
  const previous = current?.workspace_id === workspaceId ? current : null;
  if (next.workspace_id !== workspaceId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(next.observed_at)) return previous;
  return previous && previous.observed_at > next.observed_at ? previous : next;
}
