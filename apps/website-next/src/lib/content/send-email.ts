import "server-only";

/**
 * Sends one email through Resend. The sender must be on a domain verified in Resend: today that is
 * hey.noisia.ai (noisia.ai itself is not). Returns false when there is no API key or Resend says no.
 */

export const FROM_EMAIL = () => process.env.STUDY_FROM_EMAIL || "Noisia <estudios@hey.noisia.ai>";
export const TEAM_EMAIL = () => process.env.WORKSHOP_TO_EMAIL || "hola@noisia.ai";
/** Where a reader's reply to a study email lands. Its own variable, so the workshop form keeps its address. */
export const STUDY_REPLY_TO = () => process.env.STUDY_REPLY_TO || TEAM_EMAIL();
/** Who gets the "Registro: …" note when someone opens a study. */
export const STUDY_NOTIFY_TO = () => process.env.STUDY_NOTIFY_TO || STUDY_REPLY_TO();

/** An image sent inside the email (`<img src="cid:<id>">`), so clients that block remote images still show it. */
export type InlineImage = { id: string; filename: string; bytes: Buffer | string; contentType: string };

/** Resend attachments for inline images. */
export function inlineAttachments(images: InlineImage[]) {
  return images.map((image) => ({
    filename: image.filename,
    content: typeof image.bytes === "string" ? image.bytes : image.bytes.toString("base64"),
    content_type: image.contentType,
    content_id: image.id
  }));
}

export async function sendEmail(message: Record<string, unknown>): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL(), ...message }),
    signal: AbortSignal.timeout(8000)
  }).catch(() => null);
  if (response && !response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[email] Resend answered ${response.status}: ${body.slice(0, 300)}`);
  }
  return Boolean(response?.ok);
}

/** A per-process limit by IP: true when this IP went over `max` requests in `windowMs`. */
export function rateLimiter(max: number, windowMs: number) {
  const recent = new Map<string, number[]>();
  return (ip: string) => {
    const now = Date.now();
    const hits = (recent.get(ip) ?? []).filter((t) => now - t < windowMs);
    hits.push(now);
    recent.set(ip, hits);
    if (recent.size > 5000) for (const [key, times] of recent) if (now - times[times.length - 1]! > windowMs) recent.delete(key);
    return hits.length > max;
  };
}

export function clientIp(request: Request): string {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
}
