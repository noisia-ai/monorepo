import { eq } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

import { db } from "./client.js";
import { methodologies } from "../schema/index.js";

type MethodologyManifest = {
  slug: string;
  name: string;
  version: string;
  status: string;
  default_dashboard_blocks?: unknown;
  scrollytelling_narrative_template?: unknown;
  ai_prompts?: unknown;
  quality_gates?: unknown;
};

export async function seedMethodologies() {
  const seedsDir = resolve(process.cwd(), "../../docs/product/10_methodology_seeds");
  const files = (await readdir(seedsDir)).filter((file) => file.endsWith(".yaml")).sort();

  for (const file of files) {
    const raw = await readFile(resolve(seedsDir, file), "utf8");
    const manifest = parse(raw) as MethodologyManifest;

    if (!manifest.slug || !manifest.name || !manifest.version || !manifest.status) {
      throw new Error(`Invalid methodology manifest: ${file}`);
    }

    await db
      .insert(methodologies)
      .values({
        slug: manifest.slug,
        name: manifest.name,
        version: manifest.version,
        status: manifest.status,
        manifestYaml: manifest,
        defaultBlocks: manifest.default_dashboard_blocks ?? null,
        scrollytellingTemplate: manifest.scrollytelling_narrative_template ?? null,
        aiPrompts: manifest.ai_prompts ?? null,
        qualityGates: manifest.quality_gates ?? null
      })
      .onConflictDoUpdate({
        target: [methodologies.slug, methodologies.version],
        set: {
          name: manifest.name,
          status: manifest.status,
          manifestYaml: manifest,
          defaultBlocks: manifest.default_dashboard_blocks ?? null,
          scrollytellingTemplate: manifest.scrollytelling_narrative_template ?? null,
          aiPrompts: manifest.ai_prompts ?? null,
          qualityGates: manifest.quality_gates ?? null,
          updatedAt: new Date()
        }
      });
  }

  const rows = await db.select().from(methodologies).where(eq(methodologies.status, "active"));
  return { loaded: files.length, active: rows.length };
}
