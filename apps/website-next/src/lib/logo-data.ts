import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** The Noisia logo as a data URI, for generated images (Open Graph) that cannot fetch /public. */
export function logoDataUri(): string {
  cached ??= `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), "public/brand/noisia.svg")).toString("base64")}`;
  return cached;
}
