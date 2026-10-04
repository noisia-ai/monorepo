/** USD/MTok verified 2026-10-04: https://platform.claude.com/docs/en/about-claude/pricing .
 * Cache multipliers stack with batch's 50% discount. Rates are integer microUSD/MTok. */
export type LlmUsageV1 = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
};
export type LlmPriceV1 = {
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
};
export function llmPriceV1(
  provider: string,
  model: string,
  transport: "batch" | "sync",
  jevInputUsdPerMillion?: number,
): LlmPriceV1 {
  if (provider === "typesafe") {
    if (!Number.isFinite(jevInputUsdPerMillion) || jevInputUsdPerMillion! < 0)
      throw new Error("jev_price_required");
    return {
      input: Math.round(jevInputUsdPerMillion! * 1e6),
      output: 0,
      cache_read: 0,
      cache_write_5m: 0,
      cache_write_1h: 0,
    };
  }
  if (
    provider !== "anthropic" ||
    !["claude-sonnet-5-5", "claude-haiku-4-5"].includes(model)
  )
    throw new Error("llm_price_unknown");
  const input =
    (model === "claude-sonnet-5-5" ? 2e6 : 1e6) *
    (transport === "batch" ? 0.5 : 1);
  return {
    input,
    output: input * 5,
    cache_read: input / 10,
    cache_write_5m: input * 1.25,
    cache_write_1h: input * 2,
  };
}
export function llmCostMicroUsdV1(
  usage: LlmUsageV1,
  price: LlmPriceV1,
): number {
  const amounts = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation.ephemeral_5m_input_tokens,
    usage.cache_creation.ephemeral_1h_input_tokens,
  ];
  if (
    amounts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    (amounts[3] ?? 0) + (amounts[4] ?? 0) !== usage.cache_creation_input_tokens
  )
    throw new Error("llm_usage_invalid");
  const rates = [
    price.input,
    price.output,
    price.cache_read,
    price.cache_write_5m,
    price.cache_write_1h,
  ];
  if (rates.some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new Error("llm_price_invalid");
  const sum = amounts.reduce(
    (total, n, i) => total + BigInt(n) * BigInt(rates[i]!),
    0n,
  );
  const cost = (sum + 999999n) / 1000000n;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("llm_cost_overflow");
  return Number(cost);
}
