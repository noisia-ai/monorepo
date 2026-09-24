import { z } from 'zod';
import { createSignalTopicInterestReviewOutputValidatorV1, signalTopicEditorialDigestV1 as digest,
  type SignalTopicInterestReviewV1, type SignalTopicInterestReviewProviderRequestV1,
  type SignalTopicInterestReviewResultV1 } from '@noisia/query-engine';

const CONTRACT = 'signal-topic-interest-review-checkpoint-v1' as const;
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const bodySchema = z.object({
  contract_version: z.literal(CONTRACT), execution_key: z.string().min(1).max(200),
  workspace_id: z.string().uuid(), taxonomy_profile_id: z.string().uuid(),
  input_digest: hash, review_digest: hash,
  phase: z.enum(['pending', 'completed']), outputs: z.array(z.unknown())
}).strict();
const stateSchema = bodySchema.extend({ state_digest: hash }).strict();
export type SignalTopicInterestReviewCheckpointV1 = z.infer<typeof stateSchema>;
export type SignalTopicInterestReviewCheckpointStoreV1 = {
  load(executionKey: string): Promise<unknown | null>;
  /** Must atomically compare expected digest and bind the execution to one immutable review. */
  save(args: { execution_key: string; expected_state_digest: string | null;
    state: SignalTopicInterestReviewCheckpointV1 }): Promise<void>;
};
const fail = (code: string): never => { throw Error(`topic_interest_review_${code}`); };

/** Local composition seam. There is deliberately no default store, queue, DB or
 * transport. The existing provider ledger owns send admission and paid receipts;
 * this checkpoint only records validated progress, never authorizes spending. */
export async function runSignalTopicInterestReviewV1(args: {
  execution_key: string; review: SignalTopicInterestReviewV1;
  store: SignalTopicInterestReviewCheckpointStoreV1;
  provider: { complete(request: SignalTopicInterestReviewProviderRequestV1): Promise<unknown> };
  /** Revalidate the authoritative review/input and lease before new work and checkpoint writes. */
  assertCurrent(input: { execution_key: string; workspace_id: string; taxonomy_profile_id: string;
    input_digest: string; review_digest: string }): Promise<void>;
  max_batches?: number;
}): Promise<{ status: 'pending'; state: SignalTopicInterestReviewCheckpointV1; pending_batches: number }
  | { status: 'completed'; state: SignalTopicInterestReviewCheckpointV1; result: SignalTopicInterestReviewResultV1 }> {
  const { execution_key, store, provider, assertCurrent, max_batches } = args;
  if (!/^[A-Za-z0-9_.:-]{1,200}$/u.test(execution_key)) return fail('execution_key_invalid');
  // Own the snapshot before awaiting any store/provider; callers cannot mutate
  // the meaning or batch count while a paid response is in flight.
  const review = structuredClone(args.review), validator = createSignalTopicInterestReviewOutputValidatorV1(review);
  const limit = max_batches ?? review.batches.length;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > review.batches.length) return fail('batch_limit_invalid');
  const identity = { execution_key: execution_key, workspace_id: review.manifest.workspace_id,
    taxonomy_profile_id: review.manifest.taxonomy_profile_id, input_digest: review.input_digest, review_digest: review.review_digest };
  const current = () => assertCurrent({ ...identity });
  await current();
  const raw = await store.load(execution_key);
  let state: SignalTopicInterestReviewCheckpointV1 | null = null;
  if (raw !== null) {
    const parsed = stateSchema.safeParse(raw);
    if (!parsed.success) return fail('checkpoint_invalid');
    const { state_digest, ...body } = parsed.data;
    if (digest(body) !== state_digest || Object.entries(identity).some(([key, value]) => body[key as keyof typeof body] !== value)
      || body.outputs.length > review.batches.length
      || (body.phase === 'completed') !== (body.outputs.length === review.batches.length)) return fail('checkpoint_invalid');
    body.outputs.forEach((output, index) => validator.parseBatch(index, output));
    state = structuredClone(parsed.data);
  }
  const save = async (outputs: unknown[]) => {
    await current();
    const body = { contract_version: CONTRACT, ...identity,
      phase: outputs.length === review.batches.length ? 'completed' as const : 'pending' as const, outputs };
    const next = { ...body, state_digest: digest(body) };
    await store.save({ execution_key: execution_key, expected_state_digest: state?.state_digest ?? null,
      state: structuredClone(next) });
    state = next;
    return next;
  };
  if (!state) state = await save([]);
  const end = Math.min(review.batches.length, state.outputs.length + limit);
  for (let index = state.outputs.length; index < end; index++) {
    await current();
    const request = validator.buildRequest({ batch_index: index, execution_key: execution_key });
    // No retry here. A later invocation recovers the same immutable request via
    // the existing ledger; uncertain sends cannot become replacement requests.
    const rawOutput = await provider.complete(request);
    const output = validator.parseBatch(index, rawOutput);
    state = await save([...state.outputs, output]);
  }
  if (state.phase === 'completed') return { status: 'completed', state,
    result: validator.parseAll(state.outputs) };
  return { status: 'pending', state, pending_batches: review.batches.length - state.outputs.length };
}
