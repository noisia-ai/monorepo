import crypto from "node:crypto";

export type EmbeddingProvider = "voyage" | "openai";

export const DEFAULT_VOYAGE_EMBEDDING_MODEL = "voyage-4-large";
export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_MODEL = DEFAULT_VOYAGE_EMBEDDING_MODEL;
export const EMBEDDING_DIMENSIONS = Number.parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1024", 10) || 1024;

export type EmbeddingInput = {
  id: string;
  text: string;
};

export type EmbeddingOutput = EmbeddingInput & {
  embedding: number[];
};

type OpenAIEmbeddingResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string };
};

type VoyageEmbeddingResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  embeddings?: number[][];
  detail?: string;
  message?: string;
};

export function chunkForEmbedding(
  text: string,
  options: { maxChars?: number; overlapChars?: number } = {}
): string[] {
  const maxChars = options.maxChars ?? 1400;
  const overlapChars = options.overlapChars ?? 160;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < 80) {
    const targetEnd = Math.min(clean.length, start + maxChars);
    const sentenceEnd = findSoftBreak(clean, start, targetEnd);
    const end = sentenceEnd > start + Math.floor(maxChars * 0.55) ? sentenceEnd : targetEnd;
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks.filter(Boolean);
}

export function hashEmbeddingChunk(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function vectorLiteral(values: number[]) {
  return `[${values.map((value) => sanitizeVectorNumber(value)).join(",")}]`;
}

export async function embedTextsWithOpenAI(args: {
  inputs: EmbeddingInput[];
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
}): Promise<EmbeddingOutput[]> {
  return embedTexts({ ...args, provider: "openai" });
}

export async function embedTexts(args: {
  inputs: EmbeddingInput[];
  provider?: EmbeddingProvider;
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  inputType?: "query" | "document" | null;
}): Promise<EmbeddingOutput[]> {
  const provider = args.provider ?? getEmbeddingProvider();
  if (!provider) {
    throw new Error("VOYAGE_API_KEY or OPENAI_API_KEY is required for semantic embeddings.");
  }
  if (provider === "voyage") return embedTextsWithVoyage(args);
  return embedTextsWithOpenAIProvider(args);
}

export function hasEmbeddingProvider() {
  return Boolean(getEmbeddingProvider());
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  const configured = (process.env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase();
  if (configured === "voyage" || configured === "openai") return configured;
  if (process.env.VOYAGE_API_KEY) return "voyage";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

export function getEmbeddingModel(provider: EmbeddingProvider | null = getEmbeddingProvider()) {
  if (process.env.EMBEDDING_MODEL) return process.env.EMBEDDING_MODEL;
  if (provider === "openai") return process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
  return process.env.VOYAGE_EMBEDDING_MODEL ?? DEFAULT_VOYAGE_EMBEDDING_MODEL;
}

async function embedTextsWithOpenAIProvider(args: {
  inputs: EmbeddingInput[];
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
}): Promise<EmbeddingOutput[]> {
  const apiKey = args.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for semantic embeddings.");
  }

  const model = args.model ?? getEmbeddingModel("openai");
  const dimensions = args.dimensions ?? EMBEDDING_DIMENSIONS;
  const batchSize = Math.min(Math.max(args.batchSize ?? 64, 1), 128);
  const outputs: EmbeddingOutput[] = [];

  for (let i = 0; i < args.inputs.length; i += batchSize) {
    const batch = args.inputs.slice(i, i + batchSize);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        dimensions,
        input: batch.map((item) => item.text)
      })
    });

    const json = (await response.json().catch(() => ({}))) as OpenAIEmbeddingResponse;
    if (!response.ok) {
      throw new Error(json.error?.message || `OpenAI embeddings failed with ${response.status}`);
    }

    const data = json.data ?? [];
    for (const item of data) {
      const source = batch[item.index ?? outputs.length - i];
      if (!source || !Array.isArray(item.embedding)) continue;
      outputs.push({ ...source, embedding: item.embedding });
    }
  }

  return outputs;
}

async function embedTextsWithVoyage(args: {
  inputs: EmbeddingInput[];
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  inputType?: "query" | "document" | null;
}): Promise<EmbeddingOutput[]> {
  const apiKey = args.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is required for semantic embeddings.");
  }

  const model = args.model ?? getEmbeddingModel("voyage");
  const dimensions = args.dimensions ?? EMBEDDING_DIMENSIONS;
  const batchSize = Math.min(Math.max(args.batchSize ?? 64, 1), 128);
  const outputs: EmbeddingOutput[] = [];

  for (let i = 0; i < args.inputs.length; i += batchSize) {
    const batch = args.inputs.slice(i, i + batchSize);
    const body: Record<string, unknown> = {
      model,
      input: batch.map((item) => item.text),
      truncation: true
    };
    if (args.inputType) body.input_type = args.inputType;
    if (dimensions > 0) body.output_dimension = dimensions;

    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const json = (await response.json().catch(() => ({}))) as VoyageEmbeddingResponse;
    if (!response.ok) {
      throw new Error(json.detail || json.message || `Voyage embeddings failed with ${response.status}`);
    }

    if (Array.isArray(json.data)) {
      for (const item of json.data) {
        const source = batch[item.index ?? outputs.length - i];
        if (!source || !Array.isArray(item.embedding)) continue;
        outputs.push({ ...source, embedding: item.embedding });
      }
      continue;
    }

    if (Array.isArray(json.embeddings)) {
      json.embeddings.forEach((embedding, index) => {
        const source = batch[index];
        if (!source || !Array.isArray(embedding)) return;
        outputs.push({ ...source, embedding });
      });
    }
  }

  return outputs;
}

function findSoftBreak(text: string, start: number, targetEnd: number) {
  const window = text.slice(start, targetEnd);
  const breaks = [". ", "? ", "! ", "; ", "\n"];
  let best = -1;
  for (const marker of breaks) {
    best = Math.max(best, window.lastIndexOf(marker));
  }
  return best > -1 ? start + best + 1 : targetEnd;
}

function sanitizeVectorNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(8)) : 0;
}
