export const TB_TEMPORAL_CONTRACT_VERSION = "tb-temporal-v1" as const;
export const TB_PROMPT_VERSION = "tb-prompts-2026.07.22" as const;
export const TB_METHODOLOGY_SLUG = "triggers-barriers" as const;

export type TbTemporalQualityStateV1 = "pass" | "partial" | "not_available";
export type TbTemporalMovementV1 =
  | "emerging"
  | "growing"
  | "declining"
  | "persistent"
  | "mutated"
  | "disappeared";

export type TbRunScopeV1 = {
  contract_version: typeof TB_TEMPORAL_CONTRACT_VERSION;
  workspace_subject_key: string;
  corpus_id: string;
  corpus_revision: number;
  snapshot_id: string;
  snapshot_digest: string;
  snapshot_mention_count: number;
  period_start: string;
  period_end: string;
  methodology_slug: typeof TB_METHODOLOGY_SLUG;
  methodology_version: string;
  pipeline_version: string;
  prompt_version: string;
  model_version: string;
};

export type TbComparisonCompatibilityV1 = {
  compatible: boolean;
  reasons: string[];
  dimensions: {
    subject: boolean;
    methodology: boolean;
    pipeline: boolean;
    prompt: boolean;
    model: boolean;
    non_overlapping_periods: boolean;
    snapshots_distinct: boolean;
  };
};

export type TbTemporalFindingV1 = {
  id: string;
  semantic_key: string;
  title: string;
  polarity: "trigger" | "barrier" | "mixed";
  layer: string;
  frequency: number;
  denominator: number;
  intensity: number | null;
  predictive_capacity: number | null;
  evidence_count: number;
};

export type TbTemporalMovementResultV1 = {
  movement: TbTemporalMovementV1;
  reason: string;
  quality_state: TbTemporalQualityStateV1;
  current_share: number | null;
  previous_share: number | null;
  share_delta: number | null;
  similarity: number | null;
};

export function evaluateTbComparisonCompatibilityV1(
  current: TbRunScopeV1,
  previous: TbRunScopeV1
): TbComparisonCompatibilityV1 {
  const dimensions = {
    subject: current.workspace_subject_key === previous.workspace_subject_key,
    methodology:
      current.methodology_slug === previous.methodology_slug
      && current.methodology_version === previous.methodology_version,
    pipeline: current.pipeline_version === previous.pipeline_version,
    prompt: current.prompt_version === previous.prompt_version,
    model: current.model_version === previous.model_version,
    non_overlapping_periods: previous.period_end < current.period_start,
    snapshots_distinct:
      current.snapshot_id !== previous.snapshot_id
      && current.snapshot_digest !== previous.snapshot_digest
  };
  const reasons = Object.entries(dimensions)
    .filter(([, compatible]) => !compatible)
    .map(([dimension]) => `incompatible_${dimension}`);
  return {
    compatible: reasons.length === 0,
    reasons,
    dimensions
  };
}

export function buildTbTemporalSemanticKeyV1(input: {
  polarity: string;
  layer: string;
  title: string;
  member_tags?: string[];
}) {
  const tagPart = Array.from(new Set((input.member_tags ?? [])
    .map((tag) => slugifyTemporalToken(tag))
    .filter(Boolean)))
    .sort()
    .slice(0, 6)
    .join(" ");
  return slugifyTemporalToken(`${input.polarity} ${input.layer} ${input.title} ${tagPart}`);
}

export function compareTbTemporalFindingV1(args: {
  current: TbTemporalFindingV1 | null;
  previous: TbTemporalFindingV1 | null;
  mutated?: boolean;
  similarity?: number | null;
}): TbTemporalMovementResultV1 {
  const currentShare = share(args.current);
  const previousShare = share(args.previous);
  const similarity = args.similarity ?? null;
  if (!args.previous && args.current) {
    return result("emerging", "No compatible previous finding exists.", currentShare, null, similarity, args.current);
  }
  if (args.previous && !args.current) {
    return result("disappeared", "The previous finding has no current compatible match.", null, previousShare, similarity, args.previous);
  }
  if (!args.current || !args.previous) {
    return {
      movement: "persistent",
      reason: "Finding comparison is unavailable.",
      quality_state: "not_available",
      current_share: currentShare,
      previous_share: previousShare,
      share_delta: null,
      similarity
    };
  }
  const delta = (currentShare ?? 0) - (previousShare ?? 0);
  if (args.mutated) {
    return result(
      "mutated",
      `Semantic identity changed with similarity ${round(similarity ?? 0)}.`,
      currentShare,
      previousShare,
      similarity,
      args.current
    );
  }
  const relative = previousShare && previousShare > 0 ? delta / previousShare : null;
  if (relative !== null && relative >= 0.2) {
    return result("growing", `Share increased ${round(relative * 100)}%.`, currentShare, previousShare, similarity, args.current);
  }
  if (relative !== null && relative <= -0.2) {
    return result("declining", `Share decreased ${round(Math.abs(relative) * 100)}%.`, currentShare, previousShare, similarity, args.current);
  }
  return result(
    "persistent",
    "Share stayed within the ±20% persistence band.",
    currentShare,
    previousShare,
    similarity,
    args.current
  );
}

export function matchTbTemporalFindingsV1(
  current: TbTemporalFindingV1[],
  previous: TbTemporalFindingV1[]
) {
  const previousByKey = new Map(previous.map((finding) => [finding.semantic_key, finding]));
  const usedPrevious = new Set<string>();
  const matches: Array<{
    current: TbTemporalFindingV1 | null;
    previous: TbTemporalFindingV1 | null;
    mutated: boolean;
    similarity: number | null;
  }> = [];

  for (const finding of [...current].sort(bySemanticKey)) {
    const exact = previousByKey.get(finding.semantic_key);
    if (exact) {
      usedPrevious.add(exact.id);
      matches.push({ current: finding, previous: exact, mutated: false, similarity: 1 });
      continue;
    }
    const candidate = previous
      .filter((item) =>
        !usedPrevious.has(item.id)
        && item.polarity === finding.polarity
        && item.layer === finding.layer)
      .map((item) => ({ item, similarity: tokenSimilarity(finding.semantic_key, item.semantic_key) }))
      .filter((item) => item.similarity >= 0.6)
      .sort((a, b) => b.similarity - a.similarity || bySemanticKey(a.item, b.item))[0];
    if (candidate) {
      usedPrevious.add(candidate.item.id);
      matches.push({
        current: finding,
        previous: candidate.item,
        mutated: true,
        similarity: candidate.similarity
      });
    } else {
      matches.push({ current: finding, previous: null, mutated: false, similarity: null });
    }
  }
  for (const finding of [...previous].sort(bySemanticKey)) {
    if (!usedPrevious.has(finding.id)) {
      matches.push({ current: null, previous: finding, mutated: false, similarity: null });
    }
  }
  return matches;
}

function result(
  movement: TbTemporalMovementV1,
  reason: string,
  currentShare: number | null,
  previousShare: number | null,
  similarity: number | null,
  evidence: TbTemporalFindingV1
): TbTemporalMovementResultV1 {
  return {
    movement,
    reason,
    quality_state:
      evidence.denominator <= 0 || evidence.evidence_count <= 0
        ? "not_available"
        : evidence.evidence_count < 3
          ? "partial"
          : "pass",
    current_share: currentShare,
    previous_share: previousShare,
    share_delta:
      currentShare === null || previousShare === null
        ? null
        : round(currentShare - previousShare),
    similarity
  };
}

function share(finding: TbTemporalFindingV1 | null) {
  if (!finding || finding.denominator <= 0) return null;
  return round(finding.frequency / finding.denominator);
}

function tokenSimilarity(left: string, right: string) {
  const a = new Set(left.split("-").filter(Boolean));
  const b = new Set(right.split("-").filter(Boolean));
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : round(intersection / union);
}

function slugifyTemporalToken(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 200);
}

function bySemanticKey(left: TbTemporalFindingV1, right: TbTemporalFindingV1) {
  return left.semantic_key.localeCompare(right.semantic_key);
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
