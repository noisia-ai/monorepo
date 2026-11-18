/**
 * Noisia's public contact addresses, in one place.
 *
 * hola@noisia.ai stopped receiving mail in November 2026 and is being restored in Google
 * Workspace. Until then, leads and general contact go to CONTACT_EMAIL, administrative matters
 * (privacy requests) go to ADMIN_EMAIL, and COPY_EMAIL is copied on both. When hola@ works again,
 * point CONTACT_EMAIL and ADMIN_EMAIL back to it and set the server variables in Railway the same
 * way (content-db/STUDY_EMAIL.md).
 */
export const CONTACT_EMAIL = "ferdi@noisia.ai";
export const ADMIN_EMAIL = "david@noisia.ai";
export const COPY_EMAIL = "brandhon@noisia.ai";

/** A mailto link with COPY_EMAIL in copy. */
export function mailto(to: string, fields: { subject?: string; body?: string } = {}): string {
  const params = [`cc=${encodeURIComponent(COPY_EMAIL)}`];
  if (fields.subject) params.push(`subject=${encodeURIComponent(fields.subject)}`);
  if (fields.body) params.push(`body=${encodeURIComponent(fields.body)}`);
  return `mailto:${to}?${params.join("&")}`;
}
