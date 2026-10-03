/** Split only after validating the closed focus intent; list and focus share one scope. */
export function splitNativeMentionsFocusQuery(params: URLSearchParams) {
  const values = params.getAll("mention");
  const focus = values[0] ?? null;
  if (new Set(values).size > 1 || focus !== null && (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(focus)
    || params.has("cursor"))) {
    throw Object.assign(new Error("The mention focus is invalid."), { code: "workspace_mentions_filter_invalid", status: 422 });
  }
  const list = new URLSearchParams(params);
  list.delete("mention");
  return { list, focus };
}
