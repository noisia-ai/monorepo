import { createHash } from "node:crypto";
import { z } from "zod";
import { signalTopicDefinitionSchemaV1, signalTopicDefinitionDigestV1, type SignalTopicDefinitionV1 } from "./signal-topic-catalog-v1";
import { parseSignalWorkspaceInterpretationV1, type SignalWorkspaceInterpretationV1 } from "./signal-workspace-interpretation-v1";

export type SignalWorkspaceTopicMaterializationMappingV1 = {
  unit_key: string; term_key: string; status: SignalWorkspaceInterpretationV1["status"];
  cluster_digest: string; definition_digest: string; proposal_artifact_id: string;
};
export function signalWorkspaceMaterializedTopicKeyV1(unit_key: string): string {
  if (!/^(open|guided):[A-Za-z0-9_.:-]{1,180}$/u.test(unit_key)) throw new Error("workspace_engine_materialization_unit_invalid");
  return `workspace_${createHash("sha256").update(unit_key).digest("hex")}`;
}
/** A locale is source authority, not an ES/EN rendering preference. */
export function canonicalSignalWorkspaceTopicLocaleV1(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) throw new Error("workspace_topic_locale_required");
  try {
    const locale = new Intl.Locale(value);
    if (!locale.language || locale.language === "und") throw new Error();
    return locale.toString();
  } catch { throw new Error("workspace_topic_locale_required"); }
}
function insufficientInterpretationText(locale: string) {
  const language = new Intl.Locale(locale).language;
  const copy: Record<string, { label: string; definition: string }> = {
    es: { label: "Grupo sin interpretación suficiente", definition: "La evidencia disponible todavía no permite definir esta conversación." },
    en: { label: "Group with insufficient interpretation", definition: "The available evidence does not yet support a definition of this conversation." },
    ja: { label: "解釈に十分な情報がないグループ", definition: "利用可能な証拠では、この会話をまだ定義できません。" },
    pt: { label: "Grupo sem interpretação suficiente", definition: "As evidências disponíveis ainda não permitem definir esta conversa." }
  };
  // This is an uncertainty marker, not provider-authored editorial prose.
  // Preserve the source locale even when its presentation copy is unavailable.
  return copy[language] ?? copy.en!;
}
/** Existing definitions are operator-owned, including archived/generated entries.
 * Fresh proposals remain in their execution's artifact and mapping. No labels,
 * guidance, revision or lineage are inferred from the latest naming response.
 */
export function mergeSignalWorkspaceTopicMaterializationV1(args: {
  prior: SignalTopicDefinitionV1[];
  interpretations: Array<{ result: SignalWorkspaceInterpretationV1; artifact_id: string }>;
  execution_id: string; now: string; locale: string;
}): { definitions: SignalTopicDefinitionV1[]; mapping: SignalWorkspaceTopicMaterializationMappingV1[]; topic_count: number; discovered_topic_count: number } {
  const locale = canonicalSignalWorkspaceTopicLocaleV1(args.locale);
  if (!z.string().uuid().safeParse(args.execution_id).success || !z.string().datetime().safeParse(args.now).success) throw new Error("workspace_engine_materialization_context_invalid");
  const definitions = structuredClone(args.prior), keys = new Set<string>(), byUnit = new Map<string, SignalTopicDefinitionV1>();
  for (const definition of definitions) {
    if (!signalTopicDefinitionSchemaV1.safeParse(definition).success || keys.has(definition.term_key)) throw new Error("workspace_engine_materialization_prior_invalid");
    keys.add(definition.term_key);
    if (definition.origin === "workspace_discovery" && definition.source) {
      const key = definition.source.candidate_key;
      if (byUnit.has(key)) throw new Error("workspace_engine_materialization_prior_ambiguous");
      byUnit.set(key, definition);
    }
  }
  const mapping: SignalWorkspaceTopicMaterializationMappingV1[] = [], seen = new Set<string>();
  for (const proposal of args.interpretations) {
    const result = parseSignalWorkspaceInterpretationV1(proposal.result);
    if (!z.string().uuid().safeParse(proposal.artifact_id).success || seen.has(result.cluster_id)) throw new Error("workspace_engine_materialization_proposal_invalid");
    seen.add(result.cluster_id);
    if (result.status !== "insufficient" && (!result.name || !result.definition || !result.citations.length)) throw new Error("workspace_engine_materialization_evidence_missing");
    let definition = byUnit.get(result.cluster_id);
    if (!definition) {
      const term_key = signalWorkspaceMaterializedTopicKeyV1(result.cluster_id);
      if (keys.has(term_key)) throw new Error("workspace_engine_materialization_key_conflict");
      const fallback = result.name === null || result.definition === null ? insufficientInterpretationText(locale) : null;
      const draft = {
        term_key, label: result.name ?? fallback!.label, definition: result.definition ?? fallback!.definition,
        scope: "all_conversations" as const, inclusion: result.inclusion.map(row => row.text), exclusion: result.exclusion.map(row => row.text),
        positive_examples: [], negative_examples: [], lifecycle: "draft" as const, origin: "workspace_discovery" as const,
        discovery_guidance: false, source: { run_key: `workspace-engine:${args.execution_id}`, candidate_key: result.cluster_id, candidate_digest: result.cluster_digest },
      };
      definition = signalTopicDefinitionSchemaV1.parse({ ...draft, definition_revision: 1, definition_digest: signalTopicDefinitionDigestV1(draft),
        created_at: args.now, updated_at: args.now });
      definitions.push(definition); keys.add(term_key); byUnit.set(result.cluster_id, definition);
    }
    mapping.push({ unit_key: result.cluster_id, term_key: definition.term_key, status: result.status,
      cluster_digest: result.cluster_digest, definition_digest: definition.definition_digest, proposal_artifact_id: proposal.artifact_id });
  }
  mapping.sort((a, b) => a.unit_key < b.unit_key ? -1 : a.unit_key > b.unit_key ? 1 : 0);
  const active = definitions.filter(definition => definition.lifecycle !== "archived");
  return { definitions, mapping, topic_count: active.length,
    discovered_topic_count: active.filter(definition => definition.origin === "workspace_discovery").length };
}
