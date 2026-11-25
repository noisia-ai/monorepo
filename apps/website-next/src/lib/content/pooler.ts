/** True when the pooler turned the connection away because it is full, so a retry can succeed. */
export function poolerBusy(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  return code === "53300" || /EMAXCONNSESSION|max clients reached|too many (clients|connections)|remaining connection slots/i.test(message ?? "");
}
