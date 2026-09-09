/** Selection is editorial visibility, never semantic approval or execution. */
export type TopicSignalSelectionV1 = {
  workspace_id: string; term_key: string; request_scope: string; observed_at: string;
  can_select: boolean; selection_revision: number; selected: boolean;
  definition_revision: number; definition_digest: string;
  generation_id: string | null; is_current: boolean; is_processing: boolean; mention_count: number | null;
  request_receipt: { idempotency_key: string; selected: boolean } | null;
};
export type TopicSignalSelectionIntentV1 = {
  key: string; request_scope: string; workspace_id: string; term_key: string;
  body: { action: "select_signal"; selected: boolean; expected_definition_revision: number;
    expected_definition_digest: string; expected_selection_revision: number;
    generation_id: string | null; idempotency_key: string };
};
export const topicSignalSelectionStorageKeyV1 = (workspace: string, term: string, scope: string) =>
  `noisia:topic-signal-selection:v1:${workspace}:${term}:${scope}`;

export function parseTopicSignalSelectionV1(input: unknown): TopicSignalSelectionV1 {
  const value = input as TopicSignalSelectionV1;
  if (!value || typeof value.workspace_id !== "string" || typeof value.term_key !== "string"
    || typeof value.request_scope !== "string" || !/^[0-9a-f]{64}$/.test(value.request_scope)
    || typeof value.observed_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.observed_at)
    || typeof value.is_processing !== "boolean" || typeof value.can_select !== "boolean" || typeof value.selected !== "boolean" || typeof value.is_current !== "boolean"
    || !Number.isSafeInteger(value.selection_revision) || value.selection_revision < 0
    || !Number.isSafeInteger(value.definition_revision) || value.definition_revision < 1
    || !/^sha256:[0-9a-f]{64}$/.test(value.definition_digest)
    || !(value.generation_id === null || typeof value.generation_id === "string")
    || !(value.mention_count === null || Number.isSafeInteger(value.mention_count) && value.mention_count >= 0)
    || !(value.request_receipt === null || value.request_receipt && typeof value.request_receipt.idempotency_key === "string"
      && typeof value.request_receipt.selected === "boolean")) throw new Error("load");
  return value;
}

export function acceptTopicSignalSelectionV1(current: TopicSignalSelectionV1 | null, next: TopicSignalSelectionV1,
  workspaceId: string, termKey: string): TopicSignalSelectionV1 | null {
  if (next.workspace_id !== workspaceId || next.term_key !== termKey) return current;
  if (current?.workspace_id === workspaceId && current.term_key === termKey
    && current.request_scope === next.request_scope && next.observed_at < current.observed_at) return current;
  return next;
}
export function canSelectTopicSignalV1(state: TopicSignalSelectionV1 | null, dirty: boolean, pending: boolean) {
  return Boolean(state?.can_select && !dirty && !pending && (state.selected || state.is_current && state.generation_id && (state.mention_count ?? 0) > 0));
}
export function parseTopicSignalSelectionIntentV1(raw: string | null, state: TopicSignalSelectionV1) {
  try {
    const value = JSON.parse(raw ?? "null") as TopicSignalSelectionIntentV1 | null;
    if (!value || value.workspace_id !== state.workspace_id || value.term_key !== state.term_key
      || value.request_scope !== state.request_scope || typeof value.key !== "string" || value.key.length < 8
      || value.body?.action !== "select_signal" || value.body.idempotency_key !== value.key
      || typeof value.body.selected !== "boolean" || !Number.isSafeInteger(value.body.expected_selection_revision)
      || !Number.isSafeInteger(value.body.expected_definition_revision) || typeof value.body.expected_definition_digest !== "string"
      || !(value.body.generation_id === null || typeof value.body.generation_id === "string")) return null;
    return value;
  } catch { return null; }
}

export function shouldPollTopicSignalV1(state: TopicSignalSelectionV1 | null, blocked: boolean, visible: boolean) {
  return Boolean(state?.is_processing && !blocked && visible);
}
