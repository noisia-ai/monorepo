export const STUDY_CONTEXT_MAX_CHARS = 100_000;
export const STUDY_BUSINESS_QUESTION_MAX_CHARS = STUDY_CONTEXT_MAX_CHARS;
export const STUDY_SOURCE_SNAPSHOT_MAX_CHARS = 24_000;

export type StudyIntakeSourceSnapshot = {
  name: string;
  kind?: string;
  text?: string;
  sizeBytes?: number;
};

export function looksLikeStudyContext(value: string | null | undefined) {
  const clean = normalizeWhitespacePreserveLines(value ?? "");
  if (!clean) return false;
  const lines = clean.split("\n").map((line) => line.trim()).filter(Boolean);
  if (clean.length > 900) return true;
  if (lines.length >= 8) return true;
  return lines.some((line) => /^(\d+\.|#{1,4}\s|[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s/()_-]{7,}:)/.test(line));
}

export function buildStudyContextPayload(args: {
  businessQuestion: string;
  studyContext?: string | null;
  sourceSnapshots?: StudyIntakeSourceSnapshot[];
}) {
  const businessQuestion = normalizeWhitespacePreserveLines(args.businessQuestion);
  const explicitContext = compactPreserveLines(args.studyContext ?? "", STUDY_CONTEXT_MAX_CHARS);
  const rawQuestionIsContext = looksLikeStudyContext(businessQuestion);
  const sourceText = (args.sourceSnapshots ?? [])
    .map((source) => {
      const text = compactPreserveLines(source.text ?? "", STUDY_SOURCE_SNAPSHOT_MAX_CHARS);
      if (!text) return "";
      return `Fuente: ${source.name}\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  const contextParts = [
    explicitContext,
    rawQuestionIsContext ? `Contexto pegado originalmente en Business Question:\n${businessQuestion}` : "",
    sourceText
  ].filter(Boolean);

  return {
    businessQuestion,
    questionCandidate: rawQuestionIsContext ? extractQuestionCandidate(businessQuestion) : businessQuestion,
    studyContext: compactPreserveLines(contextParts.join("\n\n---\n\n"), STUDY_CONTEXT_MAX_CHARS),
    rawQuestionIsContext
  };
}

export function mergeContextBlock(existing: string, label: string, value: string) {
  const cleanExisting = normalizeWhitespacePreserveLines(existing);
  const cleanValue = normalizeWhitespacePreserveLines(value);
  if (!cleanValue) return cleanExisting;
  const fingerprint = cleanValue.slice(0, 220);
  if (fingerprint && cleanExisting.includes(fingerprint)) return cleanExisting;
  return compactPreserveLines(
    [cleanExisting, `${label}\n${cleanValue}`].filter(Boolean).join("\n\n---\n\n"),
    STUDY_CONTEXT_MAX_CHARS
  );
}

export function compactPreserveLines(value: string, maxLength: number) {
  const clean = normalizeWhitespacePreserveLines(value);
  if (clean.length <= maxLength) return clean;
  return clean.slice(0, Math.max(0, maxLength - 24)).trimEnd() + "\n[truncated]";
}

function extractQuestionCandidate(value: string) {
  const clean = normalizeWhitespacePreserveLines(value);
  const questionLine = clean
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 10 && line.length <= 360 && /[?¿]/.test(line));
  if (questionLine) return questionLine;

  const inferredQuestion = inferDecisionQuestion(clean);
  if (inferredQuestion) return inferredQuestion;

  const firstMeaningfulLine = clean
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 10 && !isContextHeading(line));
  return compactInline(firstMeaningfulLine || clean, 360);
}

function inferDecisionQuestion(value: string) {
  const subject = inferSubject(value);
  const topicCandidates = [
    { label: "recompra", pattern: /recompra|retenci[oó]n|members?|membres/i },
    { label: "conversión", pattern: /conversi[oó]n|checkout|carrito|pago|bounce/i },
    { label: "unit economics", pattern: /CAC|margen|ROAS|ticket|LTV|rentabilidad/i },
    { label: "notoriedad", pattern: /share of search|notoriedad|b[uú]squedas|marca/i },
    { label: "calidad de datos", pattern: /reconciliar|moneda|calidad de datos|fuentes/i }
  ].filter((topic) => topic.pattern.test(value));

  if (topicCandidates.length === 0) return null;

  const topics = joinSpanish(topicCandidates.slice(0, 3).map((topic) => topic.label));
  const subjectText = subject ? `${subject} ` : "";
  return `¿Qué decisiones debe priorizar ${subjectText}para mejorar ${topics} con base en este diagnóstico previo?`;
}

function inferSubject(value: string) {
  const firstLine = value.split("\n").map((line) => line.trim()).find(Boolean);
  if (!firstLine) return "";
  const beforeDash = firstLine.split(/[—-]/)[0]?.trim() ?? "";
  if (beforeDash.length >= 2 && beforeDash.length <= 80 && !/contexto|documento|diagn[oó]stico/i.test(beforeDash)) {
    return beforeDash;
  }
  return "";
}

function joinSpanish(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} y ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} y ${values[values.length - 1]}`;
}

function isContextHeading(line: string) {
  return /^(\d+\.|fuentes?|documento|contexto|notas de uso|.+contexto de diagn[oó]stico)/i.test(line);
}

function compactInline(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3)}...` : clean;
}

function normalizeWhitespacePreserveLines(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
