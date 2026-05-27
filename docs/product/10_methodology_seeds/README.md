# Methodology Seeds — YAMLs cargables

> Cada metodología Noisia es un manifest YAML. Codex carga estos archivos en la tabla `methodologies` durante `pnpm db:seed`.

---

## Archivos en esta carpeta

| Archivo | Metodología | Status MVP |
|---|---|---|
| `triggers-barriers.yaml` | Triggers & Barriers | **Activa en MVP** |
| `value-perception-matrix.yaml` | Value Perception Matrix | Activa post-MVP fase 6 |
| `journey-friction-mapping.yaml` | Journey Friction Mapping | Activa post-MVP fase 7 |
| `cultural-codes-decoding.yaml` | Cultural Codes Decoding | Activa post-MVP fase 8 |
| `influence-architecture.yaml` | Influence Architecture | Activa post-MVP fase 9 |
| `decision-velocity.yaml` | Decision Velocity | Beta — evaluar continuidad |

---

## Cómo se cargan

El script `infrastructure/db/seeds/methodologies.ts`:

1. Lee todos los `.yaml` de esta carpeta.
2. Para cada uno, valida el shape con un Zod schema (`MethodologyManifest`).
3. Inserta o actualiza en la tabla `methodologies` con `slug` como key.

```typescript
// infrastructure/db/seeds/methodologies.ts
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { MethodologyManifestSchema } from '@noisia/methodologies';
import { db } from '@/lib/db';
import { methodologies } from '../schema';

const seedsDir = path.resolve(__dirname, '../../../docs/product/10_methodology_seeds');
const files = fs.readdirSync(seedsDir).filter(f => f.endsWith('.yaml'));

for (const file of files) {
  const raw = fs.readFileSync(path.join(seedsDir, file), 'utf-8');
  const parsed = yaml.parse(raw);
  const manifest = MethodologyManifestSchema.parse(parsed);  // valida

  await db.insert(methodologies).values({
    slug: manifest.slug,
    name: manifest.name,
    version: manifest.version,
    status: manifest.status,
    manifest_yaml: manifest,
    default_blocks: manifest.default_dashboard_blocks,
    scrollytelling_template: manifest.scrollytelling_narrative_template,
    ai_prompts: manifest.ai_prompts,
    quality_gates: manifest.quality_gates,
  }).onConflictDoUpdate({
    target: [methodologies.slug, methodologies.version],
    set: { /* misma data */ }
  });
}
```

---

## Shape esperado (Zod schema)

Ver `packages/methodologies/src/types.ts`. Resumen:

```typescript
export const MethodologyManifestSchema = z.object({
  slug: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.enum(['active', 'beta', 'deprecated']),
  business_question: z.string(),
  when_applies: z.array(z.string()),
  when_not_applies: z.array(z.string()),
  theoretical_foundations: z.array(z.object({
    author: z.string(),
    year: z.number(),
    contribution: z.string(),
  })),
  coding_dimensions: z.record(z.string(), z.any()),
  inputs: z.object({ ... }),
  outputs: z.array(z.object({ ... })),
  default_dashboard_blocks: z.array(z.object({ ... })),
  scrollytelling_narrative_template: z.object({ ... }),
  quality_gates: z.array(z.object({ ... })),
  failure_modes: z.array(z.object({ ... })),
  ai_prompts: z.record(z.string(), z.string()),
  memory_consultation: z.object({ ... }),
});
```

Si un YAML falla validación, `pnpm db:seed` falla con mensaje claro. Cero seed parcial.

---

## Cómo agregar una metodología nueva

1. Crear `nueva-metodologia.yaml` siguiendo el shape del schema.
2. Crear los componentes visuales nuevos (si aplica) en `packages/blocks/src/<methodology>/`.
3. Registrar los bloques nuevos en `dashboard_blocks_catalog` (otro seed).
4. Correr `pnpm db:seed` para que entre.
5. Validar con un corpus de prueba.
