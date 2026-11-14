import { performance } from "node:perf_hooks";
import type { R16BenchmarkEvidenceV1, R16PhaseSpanV1, R16PhaseV1, R16RawPageReceiptV1 } from "./benchmark-contract";

type FinalEvidenceInputs = Pick<R16BenchmarkEvidenceV1, "postgres" | "signal" | "guards" | "invariants"
  | "max_buffered_bytes_allowed" | "max_in_flight_allowed">;

/** Monotonic, content-free recorder to wrap the product worker/store APIs. */
export class R16BenchmarkRecorderV1 {
  readonly started_at = new Date().toISOString();
  private readonly started = performance.now();
  private readonly phaseSpans: R16PhaseSpanV1[] = [];
  private readonly providerLatencies: number[] = [];
  private readonly retryAfterMs: number[] = [];
  private readonly rawPages: R16RawPageReceiptV1[] = [];
  private readonly loadSamples: R16BenchmarkEvidenceV1["samples"] = [];
  private readonly failures: R16BenchmarkEvidenceV1["failures"] = [];
  private providerRequests = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(private readonly runId = "r16-synthetic-benchmark") {}

  elapsedMs(): number { return performance.now() - this.started; }

  async phase<T>(phase: R16PhaseV1, roots: number, operation: () => Promise<T>): Promise<T> {
    const start_ms = this.elapsedMs();
    try { return await operation(); }
    finally { this.phaseSpans.push({ phase, roots, start_ms, end_ms: this.elapsedMs() }); }
  }

  providerResponse(args: { latency_ms: number; http_status: number; input_tokens?: number; output_tokens?: number; retry_after_ms?: number }): void {
    this.providerRequests++;
    if (args.http_status === 200) {
      this.providerLatencies.push(args.latency_ms);
      this.inputTokens += args.input_tokens ?? 0;
      this.outputTokens += args.output_tokens ?? 0;
    }
    if (args.retry_after_ms !== undefined) this.retryAfterMs.push(args.retry_after_ms);
  }

  rawPage(args: { page_id: string; storage_key: string; raw_sha256: string; size_bytes: number; members: number; verified: boolean }): void {
    this.rawPages.push({ page_id: args.page_id, storage_key: args.storage_key,
      bytes_written: args.size_bytes, bytes_read_back: args.size_bytes,
      sha256: args.raw_sha256, read_back_sha256: args.raw_sha256,
      members: args.members, durable: args.verified });
  }

  sample(args: R16BenchmarkEvidenceV1["samples"][number]): void { this.loadSamples.push({ ...args }); }

  failure(args: R16BenchmarkEvidenceV1["failures"][number]): void { this.failures.push({ ...args }); }

  finish(inputs: FinalEvidenceInputs, sustainedStartMs: number): R16BenchmarkEvidenceV1 {
    const ended = performance.now();
    return {
      contract_version: "r16-benchmark-evidence-v1", run_id: this.runId,
      started_at: this.started_at, ended_at: new Date().toISOString(), wall_elapsed_ms: ended - this.started,
      sustained_start_ms: sustainedStartMs,
      provider: { kind: "synthetic", requests: this.providerRequests, latency_ms: [...this.providerLatencies],
        retry_after_ms: [...this.retryAfterMs], input_tokens: this.inputTokens, output_tokens: this.outputTokens },
      raw_storage: { backend: "http_filesystem", pages: [...this.rawPages] },
      ...inputs,
      phases: [...this.phaseSpans], samples: [...this.loadSamples], failures: [...this.failures],
    };
  }
}
