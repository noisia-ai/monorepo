import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

export const R16_STORE_OPERATIONS_V1 = ["inputs", "calls", "reserve", "markSubmitting", "admitAndMarkSelected", "persistRawPage",
  "settlePage", "apply", "finish", "refresh", "requeueUnsent"] as const;
export type R16StoreOperationV1 = typeof R16_STORE_OPERATIONS_V1[number];

type QueryResult = { rows: unknown[]; rowCount?: number | null };
type DatabaseLike = { query: (...args: any[]) => Promise<QueryResult>; connect?: () => Promise<any> };
type DurationStats = { calls: number; total_ms: number; p50_ms: number; p95_ms: number; max_ms: number };
type SampleStats = { count: number; total: number; p50: number; p95: number; max: number };
type OperationMetrics = { operation: string; duration_ms: DurationStats; batch_size: SampleStats | null };
type QueryMetrics = { operation: string; sql_template_sha256: string; duration_ms: DurationStats };
type OperationSpan = { operation: R16StoreOperationV1; start_ms: number; end_ms: number;
  batch_size: number | null; outcome: "completed" | "failed" };
export const R16_OPERATION_TIMELINE_MAX_SPANS_V1 = 8192;

const percentile = (values: readonly number[], quantile: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
};
const stats = (values: readonly number[]): DurationStats => ({ calls: values.length,
  total_ms: values.reduce((sum, value) => sum + value, 0), p50_ms: percentile(values, 0.5),
  p95_ms: percentile(values, 0.95), max_ms: values.length ? Math.max(...values) : 0 });
const sampleStats = (values: readonly number[]): SampleStats => ({ count: values.length,
  total: values.reduce((sum, value) => sum + value, 0), p50: percentile(values, 0.5),
  p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : 0 });

function queryTemplateHash(query: unknown): string {
  const template = typeof query === "string" ? query
    : query && typeof query === "object" && "text" in query && typeof query.text === "string" ? query.text : "unknown-query-template";
  const normalized = template.replace(/\s+/gu, " ").trim();
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

function batchSize(operation: R16StoreOperationV1, args: readonly unknown[], result: unknown): number | undefined {
  if (operation === "inputs" || operation === "calls") return Array.isArray(result) ? result.length : undefined;
  if (operation === "admitAndMarkSelected") {
    if (!result || typeof result !== "object") return undefined;
    const admission = result as { kind?: unknown; calls?: unknown };
    if (admission.kind === "legacy") return 0;
    return admission.kind === "committed" && Array.isArray(admission.calls) ? admission.calls.length : undefined;
  }
  const rows = args[1];
  // Selected Mark receives a synchronous callback, and resolves only with its
  // committed cohort. Observation must never invoke that callback itself.
  if (operation === "markSubmitting" && typeof rows === "function") return Array.isArray(result) ? result.length : undefined;
  return Array.isArray(rows) ? rows.length : undefined;
}

/** Query text and bind values are never retained. AsyncLocalStorage labels every
 * query made during a store operation, including nested PoolClient queries and
 * concurrently active page flushes. Durations are wall-clock spans and can
 * overlap across operations/queries. */
export class R16QueryProfilerV1 {
  private readonly operationContext = new AsyncLocalStorage<string>();
  private readonly operationDurations = new Map<string, number[]>();
  private readonly operationSpans: OperationSpan[] = [];
  private operationSpansStarted = 0;
  private operationSpansCompleted = 0;
  private readonly operationBatchSizes = new Map<string, number[]>();
  private readonly queryDurations = new Map<string, { operation: string; hash: string; values: number[] }>();

  async measureStoreOperation<T>(operation: R16StoreOperationV1, args: readonly unknown[], action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    let result: T | undefined;
    try { result = await this.operationContext.run(operation, action); }
    finally {
      const elapsed = performance.now() - started;
      const operationValues = this.operationDurations.get(operation) ?? [];
      operationValues.push(elapsed); this.operationDurations.set(operation, operationValues);
      const size = batchSize(operation, args, result);
      if (size !== undefined) {
        const sizes = this.operationBatchSizes.get(operation) ?? [];
        sizes.push(size); this.operationBatchSizes.set(operation, sizes);
      }
    }
    return result as T;
  }

  wrapStore<T extends Record<string, unknown>>(store: T, observeApply?: (args: { start_ms: number; end_ms: number; roots: number }) => void,
    elapsedMs: () => number = () => performance.now()): T {
    return new Proxy(store, { get: (target, property, receiver) => {
      const value = Reflect.get(target, property, receiver);
      const operationName = property === "markSubmittingSelected" ? "markSubmitting" : property;
      if (typeof operationName !== "string" || !(R16_STORE_OPERATIONS_V1 as readonly string[]).includes(operationName)
        || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      const operation = operationName as R16StoreOperationV1;
      return async (...args: unknown[]) => {
        const start_ms = elapsedMs();
        this.operationSpansStarted++;
        let result: unknown, outcome: OperationSpan["outcome"] = "failed";
        try {
          result = await this.measureStoreOperation(operation, args, () => value.apply(target, args));
          outcome = "completed";
          return result;
        } finally {
          const end_ms = elapsedMs();
          this.operationSpansCompleted++;
          // Keep only closed allowlisted scalar spans, in completion order.
          // Aggregates above retain their exact historical samples even when
          // this bounded timeline overflows. Never retain arguments or errors.
          if (this.operationSpans.length < R16_OPERATION_TIMELINE_MAX_SPANS_V1) this.operationSpans.push({
            operation, start_ms, end_ms, batch_size: batchSize(operation, args, result) ?? null, outcome,
          });
          if (operation === "apply") observeApply?.({ start_ms, end_ms,
            roots: Array.isArray(args[1]) ? args[1].length : 0 });
        }
      };
    } }) as T;
  }

  wrapDatabase<T extends DatabaseLike>(database: T, observeQuery?: (args: { start_ms: number; end_ms: number }) => void,
    elapsedMs: () => number = () => performance.now()): T {
    const wrapQuery = (query: (...args: any[]) => Promise<QueryResult>) => async (...args: any[]) => {
      const started = performance.now(), start_ms = elapsedMs();
      const operation = this.operationContext.getStore() ?? "unlabeled";
      const hash = queryTemplateHash(args[0]);
      try { return await query(...args); }
      finally {
        const duration = performance.now() - started;
        const key = `${operation}\0${hash}`;
        const entry = this.queryDurations.get(key) ?? { operation, hash, values: [] };
        entry.values.push(duration); this.queryDurations.set(key, entry);
        observeQuery?.({ start_ms, end_ms: elapsedMs() });
      }
    };
    return new Proxy(database, { get: (target, property, receiver) => {
      if (property === "query") return wrapQuery(target.query.bind(target));
      if (property === "connect" && target.connect) return async () => {
        const client = await target.connect!();
        return new Proxy(client, { get: (clientTarget, clientProperty, clientReceiver) => {
          if (clientProperty === "query") return wrapQuery(clientTarget.query.bind(clientTarget));
          const value = Reflect.get(clientTarget, clientProperty, clientReceiver);
          return typeof value === "function" ? value.bind(clientTarget) : value;
        } });
      };
      return Reflect.get(target, property, receiver);
    } }) as T;
  }

  snapshot() {
    const operations: OperationMetrics[] = [...this.operationDurations].map(([operation, durations]) => {
      const sizes = this.operationBatchSizes.get(operation) ?? [];
      return { operation, duration_ms: stats(durations), batch_size: sizes.length ? sampleStats(sizes) : null };
    }).sort((a, b) => a.operation.localeCompare(b.operation));
    const queries: QueryMetrics[] = [...this.queryDurations.values()].map(entry => ({ operation: entry.operation,
      sql_template_sha256: entry.hash, duration_ms: stats(entry.values) }))
      .sort((a, b) => a.operation.localeCompare(b.operation) || a.sql_template_sha256.localeCompare(b.sql_template_sha256));
    return { contract_version: "r16-query-profile-v1" as const, sql_text_recorded: false as const,
      bind_values_recorded: false as const, operation_durations_overlap: true as const,
      query_durations_overlap: true as const, operations, queries,
      operation_timeline: {
        contract_version: "r16-store-operation-timeline-v1" as const,
        clock: "caller_elapsed_ms" as const, order: "completion" as const,
        max_spans: R16_OPERATION_TIMELINE_MAX_SPANS_V1,
        started_spans: this.operationSpansStarted, completed_spans: this.operationSpansCompleted,
        in_flight_spans: this.operationSpansStarted - this.operationSpansCompleted,
        dropped_spans: this.operationSpansCompleted - this.operationSpans.length,
        complete: this.operationSpansStarted === this.operationSpansCompleted
          && this.operationSpansCompleted === this.operationSpans.length,
        spans: this.operationSpans.map(span => ({ ...span })),
      } };
  }
}
