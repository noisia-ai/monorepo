import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { summarizeR16BenchmarkV1, type R16BenchmarkEvidenceV1 } from "./benchmark-contract";

const evidencePath = process.argv[2];
if (!evidencePath) {
  console.error("Usage: pnpm exec tsx scripts/r16/summarize-benchmark.ts <private .data/piloto-masivo/r16 evidence.json>");
  process.exit(2);
}

const absolutePath = resolve(evidencePath);
if (!absolutePath.includes("/.data/piloto-masivo/r16/")) {
  console.error("R16 evidence must stay under the private .data/piloto-masivo/r16 directory.");
  process.exit(2);
}

async function main() {
  try {
    const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as R16BenchmarkEvidenceV1 | { evidence?: R16BenchmarkEvidenceV1 };
    const evidence = "evidence" in parsed && parsed.evidence ? parsed.evidence : parsed as R16BenchmarkEvidenceV1;
    const summary = summarizeR16BenchmarkV1(evidence);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.accepted) process.exitCode = 1;
  } catch (error) {
    console.error(`Unable to summarize benchmark evidence: ${error instanceof Error ? error.message : "invalid input"}`);
    process.exitCode = 1;
  }
}
void main();
