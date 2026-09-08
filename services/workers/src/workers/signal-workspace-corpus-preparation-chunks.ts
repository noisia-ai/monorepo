import { createHash } from "node:crypto";

export const WORKSPACE_CORPUS_TEXT_CHUNK_POLICY_V1 = "corpus-text-chunks-v1" as const;
export const WORKSPACE_CORPUS_TEXT_CHUNK_SIZE_V1 = 1_400;

export type WorkspaceCorpusTextChunksV1 = {
  contract_version: typeof WORKSPACE_CORPUS_TEXT_CHUNK_POLICY_V1;
  offset_unit: "utf16";
  max_code_units: typeof WORKSPACE_CORPUS_TEXT_CHUNK_SIZE_V1;
  text_sha256: string;
  code_units: number;
  chunks: Array<{ start: number; end: number; sha256: string }>;
};

/** Offsets reference the immutable asset, preserving whitespace and complete text.
 * No provider tokenizer, overlap, text copies in the result, or total chunk limit. */
export function prepareWorkspaceCorpusTextChunksV1(
  text: string,
  expectedHash: string
): WorkspaceCorpusTextChunksV1 {
  const textHash = sha256(text);
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedHash) || textHash !== expectedHash) {
    throw new Error("corpus_preparation_asset_hash_mismatch");
  }
  const chunks: WorkspaceCorpusTextChunksV1["chunks"] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + WORKSPACE_CORPUS_TEXT_CHUNK_SIZE_V1);
    // PostgreSQL text is valid Unicode; never split a supplementary code point.
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))
      && isLowSurrogate(text.charCodeAt(end))) end -= 1;
    chunks.push({ start, end, sha256: sha256(text.slice(start, end)) });
    start = end;
  }
  return {
    contract_version: WORKSPACE_CORPUS_TEXT_CHUNK_POLICY_V1,
    offset_unit: "utf16",
    max_code_units: WORKSPACE_CORPUS_TEXT_CHUNK_SIZE_V1,
    text_sha256: textHash,
    code_units: text.length,
    chunks
  };
}

function sha256(text: string) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function isHighSurrogate(value: number) { return value >= 0xd800 && value <= 0xdbff; }
function isLowSurrogate(value: number) { return value >= 0xdc00 && value <= 0xdfff; }
