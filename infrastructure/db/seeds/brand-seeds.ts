import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

import { db } from "./client.js";
import { brandSeeds } from "../schema/index.js";

type BrandSeedInput = {
  canonical_name: string;
  aliases?: string[];
  detection_patterns?: string[];
  vertical?: string;
  sub_vertical?: string;
  country?: string;
  is_institution?: boolean;
  notes?: string;
};

export async function seedBrandSeeds() {
  const file = resolve(process.cwd(), "../../docs/product/11_BRAND_SEEDS_CATALOG.yaml");
  const raw = await readFile(file, "utf8");
  const parsed = parse(quoteUnquotedHandles(raw)) as { brand_seeds: BrandSeedInput[] };

  if (!Array.isArray(parsed.brand_seeds) || parsed.brand_seeds.length < 60) {
    throw new Error("Brand seeds catalog must contain at least 60 entries.");
  }

  for (const seed of parsed.brand_seeds) {
    await db
      .insert(brandSeeds)
      .values({
        canonicalName: seed.canonical_name,
        aliases: seed.aliases ?? [],
        detectionPatterns: seed.detection_patterns ?? [],
        vertical: seed.vertical ?? null,
        subVertical: seed.sub_vertical ?? null,
        country: seed.country ?? null,
        isInstitution: seed.is_institution ?? false,
        notes: seed.notes ?? null,
        active: true
      })
      .onConflictDoUpdate({
        target: brandSeeds.canonicalName,
        set: {
          aliases: seed.aliases ?? [],
          detectionPatterns: seed.detection_patterns ?? [],
          vertical: seed.vertical ?? null,
          subVertical: seed.sub_vertical ?? null,
          country: seed.country ?? null,
          isInstitution: seed.is_institution ?? false,
          notes: seed.notes ?? null,
          active: true
        }
      });
  }

  return { loaded: parsed.brand_seeds.length };
}

function quoteUnquotedHandles(raw: string) {
  // TODO mejora-futura: corregir el YAML fuente para que los handles @*
  // vengan citados y quitar esta normalizacion tolerante del seed loader.
  return raw.replace(/([,[\s])(@[A-Za-z0-9_./-]+)/g, '$1"$2"');
}
