export type BaselineCandidateType = "brand_reuse" | "industry_baseline";

export type BaselineCorpusOption = {
  id: string;
  name: string | null;
  status: string;
  candidateType: BaselineCandidateType;
  subjectLabel: string | null;
  brandId: string | null;
  brandName: string | null;
  themeId: string | null;
  themeName: string | null;
  themeSlug: string | null;
  methodologyId: string;
  methodologySlug: string;
  methodologyName: string;
  methodologyVersion: string;
  industryTags: string[];
  geoFocus: string[];
  includedCount: number;
  targetWindowMonths: number | null;
  updatedAt: string | null;
  corpusFirstApprovedAt: string | null;
};

export type BaselineCompatibilityContext = {
  brandId: string | null;
  methodologySlug: string | null;
  industryTags: string[];
  geoFocus: string[];
};

export type BaselineCompatibility = {
  eligible: boolean;
  score: number;
  reasons: string[];
};

export const MIN_BASELINE_INCLUDED_MENTIONS = 12;

const REUSABLE_CORPUS_STATUSES = new Set([
  "corpus_approved",
  "approved_for_publication",
  "published",
  "ready"
]);

export function isGloballyReusableBaselineCandidate(
  candidate: Pick<BaselineCorpusOption, "name" | "status" | "includedCount" | "corpusFirstApprovedAt" | "themeSlug">
) {
  if (candidate.includedCount < MIN_BASELINE_INCLUDED_MENTIONS) return false;
  if (isTestLikeCorpus(candidate)) return false;
  return REUSABLE_CORPUS_STATUSES.has(candidate.status) || Boolean(candidate.corpusFirstApprovedAt);
}

export function getBaselineCompatibility(
  candidate: BaselineCorpusOption,
  context: BaselineCompatibilityContext
): BaselineCompatibility {
  const reasons: string[] = [];
  let score = 0;

  if (!isGloballyReusableBaselineCandidate(candidate)) {
    return { eligible: false, score: 0, reasons: ["not_reusable"] };
  }
  if (context.methodologySlug && candidate.methodologySlug !== context.methodologySlug) {
    return { eligible: false, score: 0, reasons: ["methodology_mismatch"] };
  }
  reasons.push("methodology_match");
  score += 20;

  if (candidate.candidateType === "brand_reuse") {
    if (!context.brandId) {
      return { eligible: false, score: 0, reasons: ["brand_required"] };
    }
    if (candidate.brandId !== context.brandId) {
      return { eligible: false, score: 0, reasons: ["brand_mismatch"] };
    }
    reasons.push("same_brand");
    score += 60;
  } else {
    if (!hasTermOverlap(candidate.industryTags, context.industryTags)) {
      return { eligible: false, score: 0, reasons: ["industry_mismatch"] };
    }
    reasons.push("industry_match");
    score += 40;
  }

  if (hasGeoOverlap(candidate.geoFocus, context.geoFocus)) {
    reasons.push("market_match");
    score += 20;
  } else {
    return { eligible: false, score: 0, reasons: ["market_mismatch"] };
  }

  if (candidate.includedCount >= 100) score += 10;
  if (candidate.corpusFirstApprovedAt) score += 5;

  return { eligible: true, score, reasons };
}

export function filterCompatibleBaselineCorpora(
  candidates: BaselineCorpusOption[],
  context: BaselineCompatibilityContext
) {
  return candidates
    .map((candidate) => ({
      candidate,
      compatibility: getBaselineCompatibility(candidate, context)
    }))
    .filter((item) => item.compatibility.eligible)
    .sort((a, b) => {
      if (a.candidate.candidateType !== b.candidate.candidateType) {
        return a.candidate.candidateType === "brand_reuse" ? -1 : 1;
      }
      if (a.compatibility.score !== b.compatibility.score) {
        return b.compatibility.score - a.compatibility.score;
      }
      return (b.candidate.updatedAt ?? "").localeCompare(a.candidate.updatedAt ?? "");
    })
    .map((item) => item.candidate);
}

export function baselineOptionKindLabel(candidateType: BaselineCandidateType) {
  return candidateType === "brand_reuse" ? "Brand corpus" : "Industry baseline";
}

export function collectIndustryTags(...values: Array<string | string[] | null | undefined>) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : String(value ?? "").split(/[,/|]/)))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function hasGeoOverlap(left: string[], right: string[]) {
  const leftSet = new Set(left.map((item) => item.toUpperCase()));
  const rightSet = new Set(right.map((item) => item.toUpperCase()));
  if (leftSet.size === 0 || rightSet.size === 0) return true;
  return Array.from(leftSet).some((item) => rightSet.has(item));
}

function hasTermOverlap(left: string[], right: string[]) {
  const normalizedLeft = left.map(normalizeTerm).filter(Boolean);
  const normalizedRight = right.map(normalizeTerm).filter(Boolean);
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return false;
  return normalizedLeft.some((leftTerm) =>
    normalizedRight.some((rightTerm) => leftTerm === rightTerm || leftTerm.includes(rightTerm) || rightTerm.includes(leftTerm))
  );
}

function normalizeTerm(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTestLikeCorpus(candidate: Pick<BaselineCorpusOption, "name" | "themeSlug">) {
  const value = `${candidate.name ?? ""} ${candidate.themeSlug ?? ""}`.toLowerCase();
  return /\b(smoke|test|dummy|sandbox|qa)\b/.test(value) || value.includes("smoke-");
}
