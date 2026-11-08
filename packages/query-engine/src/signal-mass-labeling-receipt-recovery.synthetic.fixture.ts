import { createHash } from "node:crypto";
import {
  buildMassLabelingConsolidationRequestV1,
  type MassLabelingConsolidationRecoveryDecisionV1,
  type MassLabelingSourceGroupV1,
} from "./signal-mass-labeling-consolidation-v1";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const syntheticReceiptShaV1 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function massLabelingReceiptRecoveryFixtureV1() {
  const source: MassLabelingSourceGroupV1[] = Array.from({ length: 144 }, (_, index) => ({
    group_id: `guided:synthetic-${index}`, cluster_digest: syntheticReceiptShaV1(`source ${index}`),
    source_artifact_id: id(index + 10), status: index > 141 ? "insufficient" : "coherent",
    name: index > 141 ? null : `Fonte ${index}`, definition: index > 141 ? null : `Resumo sintético ${index}`,
  }));
  source[0]!.status = "mixed";
  source[0]!.definition = "p".repeat(98) + "m".repeat(37) + "s".repeat(207);
  source[1]!.definition = "r".repeat(352);
  const batch = buildMassLabelingConsolidationRequestV1({ workspace_id: id(1), source_engine_execution_id: id(2), source_groups: source });
  const keys = ["café", "ocasião", "preço"];
  const topics = Array.from({ length: 98 }, (_, index) => ({
    topic_key: keys[index] ?? `topico_${index}`, name: source[index]!.name!,
    definition: index === 0 ? "p".repeat(98) + "s".repeat(207) : source[index]!.definition!,
    group_ids: [source[index]!.group_id],
  }));
  topics[1]!.group_ids.unshift(source[0]!.group_id);
  for (let index = 0; index < 18; index++) topics[index + 2]!.group_ids.push(source[index + 98]!.group_id);
  const output = { topics, excluded_groups: source.slice(116).map(group => ({ group_id: group.group_id,
    reason: group.status === "insufficient" ? "Evidência insuficiente" : "Exclusão editorial" })) };
  const envelope = { model: batch.configuration.model, type: "message", role: "assistant", stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 80 }, content: [{ type: "text", text: JSON.stringify(output) }] };
  const raw = JSON.stringify(envelope);
  const decision: MassLabelingConsolidationRecoveryDecisionV1 = {
    contract_version: "workspace-mass-labeling-receipt-recovery-v1", workspace_id: batch.workspace_id,
    execution_id: batch.source_engine_execution_id, call_id: id(3), request_digest: batch.request_digest,
    response_sha256: syntheticReceiptShaV1(raw), source_groups_digest: batch.source_groups_digest,
    topic_key_changes: keys.map(from => ({ from, to: from.normalize("NFKD").replace(/\p{M}/gu, "") })),
    assignment_resolution: { method: "source_segments_and_exact_remaining_summary", group_id: source[0]!.group_id,
      keep_topic_key: keys[0]!, remove_topic_key: keys[1]!,
      definition_omission: { unit: "unicode_code_points", prefix_length: 98, removed_length: 37, suffix_length: 207 } },
  };
  return { batch, raw, decision, output, envelope };
}
