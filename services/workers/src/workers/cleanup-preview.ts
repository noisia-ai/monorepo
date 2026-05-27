import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import { pool } from "../db/client";

type CleanupPreviewJobData = {
  corpusId: string;
  instruction: string;
  requestedByUserId: string;
};

type ClaudeCleanupResponse = {
  patterns: string[];
  reasoning: string;
};

const SAMPLE_FOR_CLAUDE = 80;
const MAX_PATTERNS = 20;

export async function cleanupPreviewJob(job: Job<CleanupPreviewJobData>) {
  await job.updateProgress(10);

  const { corpusId, instruction } = job.data;

  // Pull a representative sample of currently-included mentions so Claude
  // can ground the patterns it proposes in real text.
  const sample = await pool.query<{ text_clean: string; platform: string; country: string | null }>(
    `SELECT text_clean, platform, country
     FROM mentions
     WHERE study_corpus_id = $1 AND inclusion_status = 'included'
     ORDER BY random()
     LIMIT $2`,
    [corpusId, SAMPLE_FOR_CLAUDE]
  );

  await job.updateProgress(35);

  const prompt = buildCleanupPrompt(instruction, sample.rows);
  const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";

  let parsed: ClaudeCleanupResponse;
  let rawClaude = "";
  try {
    const r = await generateText({ model: anthropic(model), prompt, temperature: 0.1 });
    rawClaude = r.text;
    console.log(`[cleanup-preview] response first 300: ${r.text.slice(0, 300)}`);
    parsed = parseCleanupResponse(r.text);
  } catch (err) {
    console.error(`[cleanup-preview] Parse failed: ${err instanceof Error ? err.message : err}`);
    // Surface Claude's actual answer so the user can see what happened
    const snippet = rawClaude.slice(0, 240).replace(/\s+/g, " ").trim();
    if (snippet.length > 0) {
      throw new Error(`El motor respondió en prosa, no en JSON: "${snippet}…". Sé más específico (ej: "excluye menciones con la palabra X").`);
    }
    throw new Error("El motor no contestó. Reintenta en unos segundos.");
  }

  await job.updateProgress(65);

  // Count how many currently-included mentions would match
  const patterns = parsed.patterns.slice(0, MAX_PATTERNS).map((p) => p.trim()).filter((p) => p.length >= 2);
  let matchCount = 0;
  const samples: { id: string; snippet: string; matched_pattern: string }[] = [];

  if (patterns.length > 0) {
    const placeholders = patterns.map((_, i) => `$${i + 2}`).join(", ");
    const countResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM mentions
       WHERE study_corpus_id = $1
         AND inclusion_status = 'included'
         AND text_clean ILIKE ANY (ARRAY[${placeholders}])`,
      [corpusId, ...patterns.map(toIlike)]
    );
    matchCount = countResult.rows[0]?.count ?? 0;

    // Grab 5 example matches so the UI can show "esto se va a excluir"
    const examplesResult = await pool.query<{ id: string; text_clean: string }>(
      `SELECT id, text_clean FROM mentions
       WHERE study_corpus_id = $1
         AND inclusion_status = 'included'
         AND text_clean ILIKE ANY (ARRAY[${placeholders}])
       ORDER BY random()
       LIMIT 5`,
      [corpusId, ...patterns.map(toIlike)]
    );
    for (const row of examplesResult.rows) {
      // Find which pattern matched for display
      const matched = patterns.find((p) => row.text_clean.toLowerCase().includes(p.toLowerCase())) ?? patterns[0]!;
      samples.push({ id: row.id, snippet: row.text_clean.slice(0, 200), matched_pattern: matched });
    }
  }

  await job.updateProgress(100);

  return {
    corpus_id: corpusId,
    instruction,
    patterns,
    reasoning: parsed.reasoning,
    match_count: matchCount,
    sample_matches: samples
  };
}

function toIlike(p: string): string {
  // Escape % and _ so a user's literal text isn't interpreted as wildcards,
  // then wrap with % to do a substring match.
  const escaped = p.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `%${escaped}%`;
}

function buildCleanupPrompt(instruction: string, sample: { text_clean: string; platform: string; country: string | null }[]): string {
  return [
    "Eres el limpiador del corpus de Noisia.",
    "Tarea: dada una instruccion + muestra de menciones, devuelve patrones de texto (substrings) para SQL ILIKE.",
    "",
    "CRITICAL OUTPUT RULE: Tu PRIMER caracter de respuesta debe ser '{'. Tu ULTIMO caracter debe ser '}'.",
    "NO escribas preamble (nada como 'Analizando...', 'Aqui esta...', 'Voy a...'). NO uses markdown fences. NO expliques fuera del campo 'reasoning'.",
    "Si escribes una sola palabra antes del JSON, la respuesta sera RECHAZADA.",
    "",
    "REGLAS DE PATRONES:",
    "- SOLO substrings literales que aparezcan en el texto de las menciones (case-insensitive con ILIKE).",
    "- 2 a 40 caracteres cada uno.",
    "- Especificos sobre genericos ('concierto BTS' mejor que 'concierto').",
    "- Si la instruccion menciona varias categorias, devuelve patrones para cada una.",
    "- Maximo 20 patrones.",
    "- Si la muestra no contiene nada relacionado a la instruccion, devuelve patterns: [] y explica en reasoning.",
    "- NO devuelvas regex. NO uses %. El sistema los envuelve automaticamente.",
    "",
    "Schema obligatorio:",
    JSON.stringify(
      {
        patterns: ["BTS", "ARMY", "concierto", "Gobernadora Veracruz", "Estadio GNP"],
        reasoning: "Patrones derivados para excluir farandula musical y politica veracruzana."
      },
      null,
      2
    ),
    "",
    `Instruccion del analista:\n${instruction}`,
    "",
    `Muestra de ${sample.length} menciones del corpus:`,
    sample.slice(0, SAMPLE_FOR_CLAUDE).map((m, i) => `[${i + 1}] ${m.text_clean.slice(0, 180)}`).join("\n"),
    "",
    "Responde AHORA — solo el JSON, empezando con '{':"
  ].join("\n");
}

/**
 * Tolerant JSON extraction: Claude sometimes wraps the JSON in prose
 * ("Aquí están los patrones: { ... }") or markdown fences. We find the
 * first `{` and walk forward counting braces until we close the object.
 */
function parseCleanupResponse(raw: string): ClaudeCleanupResponse {
  // Strip markdown fences if present anywhere
  const noFences = raw.replace(/```(?:json)?/gi, "").trim();

  // Find the first balanced JSON object
  const start = noFences.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON object found in response");
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < noFences.length; i++) {
    const c = noFences[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) {
    throw new Error("Unbalanced JSON object");
  }

  const jsonSlice = noFences.slice(start, end);
  const parsed = JSON.parse(jsonSlice) as Partial<ClaudeCleanupResponse>;
  return {
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns.filter((p) => typeof p === "string") : [],
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : ""
  };
}
