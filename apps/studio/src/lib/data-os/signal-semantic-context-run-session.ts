export type SignalSemanticContextRunSessionReferenceV1 = {
  version: 1;
  generation_key: string;
  run_key: string;
};

export function canStartSignalSemanticContextProposalGenerationV1(input: {
  lifecycleState: "draft" | "published" | null;
  elementCount: number;
  hasServerDiscoveredRun: boolean;
}) {
  return input.lifecycleState === "draft"
    && input.elementCount === 0
    && !input.hasServerDiscoveredRun;
}

const keyPattern = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;

export function serializeSignalSemanticContextRunSessionReferenceV1(
  generationKey: string,
  runKey: string
) {
  return JSON.stringify({
    version: 1,
    generation_key: generationKey,
    run_key: runKey
  } satisfies SignalSemanticContextRunSessionReferenceV1);
}

export function parseSignalSemanticContextRunSessionReferenceV1(
  value: string | null
): SignalSemanticContextRunSessionReferenceV1 | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SignalSemanticContextRunSessionReferenceV1>;
    if (parsed.version !== 1
      || typeof parsed.generation_key !== "string"
      || typeof parsed.run_key !== "string"
      || parsed.generation_key.length > 160
      || parsed.run_key.length > 200
      || !keyPattern.test(parsed.generation_key)
      || !keyPattern.test(parsed.run_key)) return null;
    return parsed as SignalSemanticContextRunSessionReferenceV1;
  } catch {
    return null;
  }
}

export function isSignalSemanticContextRunSessionCurrentV1(
  reference: SignalSemanticContextRunSessionReferenceV1,
  generationKey: string
) {
  return reference.generation_key === generationKey;
}
