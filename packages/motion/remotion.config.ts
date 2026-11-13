// Studio settings. Automated renders go through builders/build-video.mjs, which passes the secret
// license key itself. Keys live in the repo root's .env.local (or packages/motion/.env), both ignored
// by git, never in this file.
import { Config } from "@remotion/cli/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// The CLI loads this file as CommonJS: no import.meta. It always runs from packages/motion.
for (const envFile of [join(process.cwd(), ".env"), join(process.cwd(), "..", "..", ".env.local")]) {
  if (!existsSync(envFile)) continue;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
if (process.env.REMOTION_PUBLIC_LICENSE_KEY) Config.setPublicLicenseKey(process.env.REMOTION_PUBLIC_LICENSE_KEY);
if (process.env.CHROME_EXECUTABLE) Config.setBrowserExecutable(process.env.CHROME_EXECUTABLE.replace(/^~/, process.env.HOME ?? "~"));
Config.setVideoImageFormat("jpeg");
