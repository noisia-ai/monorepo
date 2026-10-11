import type { SignalTopicEditorialScreeningPlanV2 } from '@noisia/query-engine';

/** Forecast, not a cap: chars/3.5 and expected output; includes the three
 * global stages, whose final requests only exist after screening completes.
 * Usage from every paid stage remains the source of the settled cost. */
export function estimateTopicEditorialMicroUsd(plan: SignalTopicEditorialScreeningPlanV2): string {
  const screening = plan.requests.reduce((sum, request) => {
    const input = Math.ceil(JSON.stringify(request.provider_request.params).length / 3.5);
    const output = Math.min(2048, request.configuration.max_output_tokens);
    return sum + Math.ceil((input * request.configuration.input_micro_usd_per_million_tokens
      + output * request.configuration.output_micro_usd_per_million_tokens) / 1_000_000);
  }, 0);
  const groups = plan.expected_group_count;
  // Global normalization, semantic review and ranking use standard prices.
  const globalInput = 3 * (4096 + groups * 1024);
  const globalOutput = 3 * (2048 + groups * 512);
  return String(screening + Math.ceil((globalInput * 3_000_000 + globalOutput * 15_000_000) / 1_000_000));
}
