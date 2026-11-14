type SyntheticQuestionV1 =
  | { type: "noul"; [key: string]: unknown }
  | { type: "choice"; criteria: Record<string, unknown>; [key: string]: unknown };
type SyntheticRequestV1 = { model: string; questions: Record<string, SyntheticQuestionV1> };

export function buildSyntheticJevResponseV1(request: SyntheticRequestV1, inputTokens?: number): string {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    if (question.type === "noul") return [key, { type: "noul", noul: key === "promotion" ? 0.1 : 0.91 }];
    const choices = Object.keys(question.criteria);
    if (!choices.length) throw new Error("r16_synthetic_choice_without_criteria");
    const selected = choices.includes("individual") ? "individual" : choices[0]!;
    const otherCount = choices.length - 1;
    const probabilities = Object.fromEntries(choices.map(choice => [choice,
      choice === selected ? 1 : 0,
    ]));
    return [key, { type: "choice", choice: selected, confidence: 1, probabilities }];
  }));
  return JSON.stringify({ model: request.model,
    usage: { input_tokens: inputTokens ?? Math.max(1, Math.ceil(JSON.stringify(request).length / 4)), output_tokens: 64 },
    answers });
}

/** A provider HTTP fetch replacement: the requested remote URL is only validated, never contacted. */
export function createSyntheticJevFetchV1(options: { latencyForRequest(index: number): number;
  responseForRequest?(index: number): { status: number; retry_after_ms?: number };
  onRequest?(args: { index: number; body: string }): void | Promise<void>;
  onResponse?(args: { latency_ms: number; input_tokens: number; output_tokens: number; http_status: number }): void }): typeof fetch {
  let requestIndex = 0;
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.typesafe.ai/v1/systemone") throw new Error("r16_remote_http_blocked");
    if (init?.method !== "POST" || typeof init.body !== "string") throw new Error("r16_synthetic_request_invalid");
    const index = requestIndex++;
    const request = JSON.parse(init.body) as SyntheticRequestV1;
    const latency = options.latencyForRequest(index);
    if (!Number.isSafeInteger(latency) || latency < 100 || latency > 500) throw new Error("r16_synthetic_latency_invalid");
    await options.onRequest?.({ index, body: init.body });
    const response = options.responseForRequest?.(index) ?? { status: 200 };
    if (response.status !== 200) {
      await new Promise(resolve => setTimeout(resolve, latency));
      options.onResponse?.({ latency_ms: latency, input_tokens: Math.max(1, Math.ceil(init.body.length / 4)),
        output_tokens: 0, http_status: response.status });
      const body = JSON.stringify({ error: "synthetic_provider_rejection" });
      return new Response(body, { status: response.status,
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)),
          ...(response.retry_after_ms === undefined ? {} : { "retry-after": String(response.retry_after_ms / 1_000) }) } });
    }
    const inputTokens = Math.max(1, Math.ceil(init.body.length / 4));
    const body = buildSyntheticJevResponseV1(request, inputTokens);
    await new Promise(resolve => setTimeout(resolve, latency));
    options.onResponse?.({ latency_ms: latency, input_tokens: inputTokens, output_tokens: 64, http_status: 200 });
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } });
  };
}

// Keep margin at both contract edges because the measured fetch latency includes
// timer scheduling and local HTTP serialization overhead.
export const deterministicR16LatencyV1 = (index: number): number => 125 + ((index * 137 + 47) % 351);
