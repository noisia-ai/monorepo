# Noisia Monorepo — Estructura y setup

> Guía concreta para convertir `noisia-ai/website` en un monorepo que aloje el website actual + Noisia Studio + paquetes compartidos.

---

## 1. Estructura final propuesta

```
noisia-ai/                                  # el repo actual, root
│
├── apps/
│   ├── website/                            # el actual src/, public/, etc. movido aquí
│   │   ├── src/
│   │   ├── public/
│   │   ├── next.config.mjs
│   │   ├── package.json                    # name: "@noisia/website"
│   │   └── tsconfig.json
│   │
│   └── studio/                             # NUEVA: la plataforma Noisia Studio
│       ├── src/
│       │   ├── app/                        # Next.js App Router
│       │   │   ├── (auth)/                 # rutas autenticadas
│       │   │   │   ├── studio/             # vista interno (Insights Manager, KAM)
│       │   │   │   │   ├── corpora/
│       │   │   │   │   ├── methodologies/
│       │   │   │   │   ├── analysis-runs/
│       │   │   │   │   └── brands/
│       │   │   │   └── portal/             # vista cliente (Brand Manager, Agency)
│       │   │   │       ├── dashboards/
│       │   │   │       └── notifications/
│       │   │   ├── api/                    # Route Handlers
│       │   │   │   ├── corpora/
│       │   │   │   ├── mentions/
│       │   │   │   ├── findings/
│       │   │   │   ├── dashboards/
│       │   │   │   ├── webhooks/
│       │   │   │   └── integrations/
│       │   │   └── (public)/               # landing del studio, login
│       │   ├── components/                 # studio-specific (no en banco compartido)
│       │   ├── lib/
│       │   │   ├── supabase/
│       │   │   ├── kinde/
│       │   │   ├── ai/                     # Vercel AI SDK wrappers
│       │   │   └── queue/                  # BullMQ client
│       │   └── server/
│       │       ├── ingestor/               # SentiOne, Datashake, CSV
│       │       ├── engine/                 # Query Validation Engine
│       │       ├── pipeline/               # análisis end-to-end
│       │       └── humanizer/              # wrapper del skill
│       ├── next.config.mjs
│       ├── package.json                    # name: "@noisia/studio"
│       └── tsconfig.json
│
├── services/
│   ├── workers/                            # BullMQ workers, Node 20
│   │   ├── src/
│   │   │   ├── workers/
│   │   │   │   ├── ingest-sentione.ts
│   │   │   │   ├── ingest-datashake.ts
│   │   │   │   ├── ingest-csv.ts
│   │   │   │   ├── validate-query.ts       # Engine de Validación
│   │   │   │   ├── classify-mentions.ts    # contra protocolo metodología
│   │   │   │   ├── jerarquizar-findings.ts
│   │   │   │   ├── generate-output.ts
│   │   │   │   ├── humanize-copy.ts
│   │   │   │   ├── render-pdf.ts
│   │   │   │   └── detect-anomaly.ts
│   │   │   ├── queues/                     # definición de colas
│   │   │   └── index.ts                    # entry point worker
│   │   ├── package.json                    # name: "@noisia/workers"
│   │   └── tsconfig.json
│   │
│   └── api/                                # OPCIONAL: API separada si MVP escala
│       └── (vacío por ahora — Next.js Route Handlers cubren MVP)
│
├── packages/
│   ├── kb/                                 # knowledge-base actual (movido aquí)
│   │   ├── 00-overview/
│   │   ├── 01-methodologies/
│   │   ├── 03-process/
│   │   ├── 05-ai-playbooks/
│   │   ├── (resto del KB)
│   │   ├── package.json                    # name: "@noisia/kb"
│   │   └── index.ts                        # exports: loadMethodology, loadPrinciple, etc.
│   │
│   ├── methodologies/                      # YAMLs parseables de cada metodología
│   │   ├── seeds/
│   │   │   ├── triggers-barriers.yaml
│   │   │   ├── value-perception-matrix.yaml
│   │   │   ├── journey-friction-mapping.yaml
│   │   │   ├── cultural-codes-decoding.yaml
│   │   │   ├── influence-architecture.yaml
│   │   │   └── decision-velocity.yaml
│   │   ├── src/
│   │   │   ├── loader.ts                   # parse YAML → MethodologyManifest type
│   │   │   └── types.ts
│   │   └── package.json                    # name: "@noisia/methodologies"
│   │
│   ├── types/                              # TypeScript types compartidos
│   │   ├── src/
│   │   │   ├── domain/
│   │   │   │   ├── mention.ts
│   │   │   │   ├── finding.ts
│   │   │   │   ├── corpus.ts
│   │   │   │   ├── brand.ts
│   │   │   │   ├── methodology.ts
│   │   │   │   └── theme.ts
│   │   │   ├── api/                        # request/response types
│   │   │   └── index.ts
│   │   ├── package.json                    # name: "@noisia/types"
│   │   └── tsconfig.json
│   │
│   ├── ui/                                 # componentes shared website + studio
│   │   ├── src/
│   │   │   ├── primitives/                 # Button, Card, Input, etc.
│   │   │   ├── data/                       # tablas, listas con filtros
│   │   │   └── motion/                     # GSAP/Motion wrappers
│   │   ├── package.json                    # name: "@noisia/ui"
│   │   └── tailwind-preset.ts              # tokens compartidos
│   │
│   ├── blocks/                             # banco de bloques del dashboard
│   │   ├── src/
│   │   │   ├── universal/
│   │   │   │   ├── HeroStats/
│   │   │   │   ├── MethodologyNote/
│   │   │   │   ├── BrandPills/
│   │   │   │   ├── EvidenceList/
│   │   │   │   ├── CulturalTensionCards/
│   │   │   │   ├── MaturityBadges/
│   │   │   │   ├── MonthlyPulse/
│   │   │   │   ├── ActionMap/
│   │   │   │   └── ComparativeBlock/
│   │   │   ├── tb/                         # bloques específicos T&B
│   │   │   │   ├── TbMatrix4Layers/
│   │   │   │   └── TbLayerWalkthrough/
│   │   │   ├── vpm/                        # bloques específicos VPM
│   │   │   ├── jfm/                        # bloques específicos JFM
│   │   │   ├── cultural-codes/
│   │   │   ├── influence/
│   │   │   ├── catalog.ts                  # registro central de bloques
│   │   │   └── index.ts
│   │   ├── package.json                    # name: "@noisia/blocks"
│   │   └── tsconfig.json
│   │
│   ├── humanizer/                          # skill humanizer importable
│   │   ├── src/
│   │   │   ├── patterns.ts                 # 24 patrones AI writing
│   │   │   ├── humanize.ts                 # función principal
│   │   │   └── tests/
│   │   ├── package.json                    # name: "@noisia/humanizer"
│   │   └── tsconfig.json
│   │
│   ├── query-engine/                       # Query Validation Engine (lógica compartida)
│   │   ├── src/
│   │   │   ├── prompts/                    # prompts IA por paso
│   │   │   ├── validators/                 # criterios de calidad
│   │   │   ├── seeds/                      # brand_seeds catalog loader
│   │   │   └── index.ts
│   │   └── package.json                    # name: "@noisia/query-engine"
│   │
│   └── humanizer-skill/                    # acceso al skill original como package
│       └── README.md                       # link al github del skill
│
├── infrastructure/
│   ├── db/
│   │   ├── migrations/                     # Drizzle migrations
│   │   ├── seeds/
│   │   │   ├── methodologies.ts            # carga los 6 YAMLs
│   │   │   ├── brand_seeds.ts              # carga el catálogo inicial
│   │   │   ├── industries.ts
│   │   │   └── demo_data.ts                # data de demo: Seguros El Potosí
│   │   ├── schema/                         # Drizzle schema files
│   │   │   ├── organizations.ts
│   │   │   ├── brands.ts
│   │   │   ├── themes.ts
│   │   │   ├── methodologies.ts
│   │   │   ├── study_corpora.ts
│   │   │   ├── mentions.ts
│   │   │   ├── findings.ts
│   │   │   ├── evidence_quotes.ts
│   │   │   └── (resto)
│   │   ├── drizzle.config.ts
│   │   └── package.json                    # name: "@noisia/db"
│   │
│   ├── docker/
│   │   ├── docker-compose.yml              # postgres + redis local
│   │   └── Dockerfile.workers
│   │
│   └── deploy/
│       ├── railway/
│       │   ├── studio.json
│       │   └── workers.json
│       └── vercel/                         # backup hosting config
│
├── docs/
│   ├── product/                            # este paquete
│   │   ├── 00_README.md
│   │   ├── 01_PRODUCT_SPEC_MASTER.md
│   │   ├── (resto del paquete)
│   ├── api/                                # OpenAPI specs (ver 08_API_CONTRACTS.md)
│   ├── adr/                                # Architecture Decision Records
│   │   └── 001-monorepo-structure.md
│   └── runbooks/                           # operación en producción
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                          # lint, typecheck, test
│   │   ├── deploy-website.yml
│   │   ├── deploy-studio.yml
│   │   └── deploy-workers.yml
│   └── PULL_REQUEST_TEMPLATE.md
│
├── knowledge-base/                         # mover a packages/kb/ — symlink durante transición
│
├── .env.example                            # placeholder visible
├── .gitignore
├── turbo.json                              # config Turborepo
├── pnpm-workspace.yaml                     # define workspaces
├── package.json                            # root, scripts globales
├── tsconfig.base.json                      # config TS base
└── README.md                               # del repo, actualizado
```

---

## 2. Archivos de configuración del monorepo

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'services/*'
  - 'packages/*'
  - 'infrastructure/db'
```

### `turbo.json`

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "db:migrate": {
      "cache": false
    },
    "db:seed": {
      "cache": false,
      "dependsOn": ["db:migrate"]
    }
  }
}
```

### `package.json` (root)

```json
{
  "name": "noisia-ai",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "db:migrate": "pnpm --filter @noisia/db db:migrate",
    "db:seed": "pnpm --filter @noisia/db db:seed",
    "dev:studio": "pnpm --filter @noisia/studio dev",
    "dev:website": "pnpm --filter @noisia/website dev",
    "dev:workers": "pnpm --filter @noisia/workers dev"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.5.4",
    "@types/node": "^20.14.10"
  }
}
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "incremental": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "paths": {
      "@noisia/types": ["./packages/types/src"],
      "@noisia/ui": ["./packages/ui/src"],
      "@noisia/blocks": ["./packages/blocks/src"],
      "@noisia/humanizer": ["./packages/humanizer/src"],
      "@noisia/methodologies": ["./packages/methodologies/src"],
      "@noisia/query-engine": ["./packages/query-engine/src"],
      "@noisia/kb": ["./packages/kb"]
    }
  },
  "exclude": ["node_modules", ".next", "dist", "build"]
}
```

---

## 3. Comandos para inicializar el monorepo

Codex ejecuta esto en el repo actual `noisia-ai/website`:

```bash
# Paso 1: Renombrar y mover el website actual a apps/website
mkdir -p apps/website
mv src apps/website/
mv public apps/website/
mv next.config.mjs apps/website/
mv next-env.d.ts apps/website/
mv postcss.config.cjs apps/website/
mv tailwind.config.ts apps/website/
mv tsconfig.json apps/website/
mv assets apps/website/
mv brand apps/website/

# Paso 2: Mover knowledge-base a packages/kb
mkdir -p packages/kb
mv knowledge-base/* packages/kb/
rmdir knowledge-base

# Paso 3: Limpiar root, dejar configs base
mv package.json apps/website/package.json
# Editar apps/website/package.json: cambiar "name" a "@noisia/website"

# Paso 4: Crear configs root (pnpm-workspace.yaml, turbo.json, package.json root, tsconfig.base.json)
# Ver archivos arriba en este doc

# Paso 5: Instalar Turborepo
pnpm add -D turbo -w

# Paso 6: Crear las apps y packages restantes vacíos como esqueleto
mkdir -p apps/studio/src/app
mkdir -p services/workers/src
mkdir -p packages/{types,ui,blocks,humanizer,methodologies,query-engine}/src
mkdir -p infrastructure/{db,docker,deploy}
mkdir -p docs/{product,api,adr,runbooks}

# Paso 7: Mover este paquete a docs/product/
mv ~/Downloads/noisia_studio_product_spec/* docs/product/

# Paso 8: Verificar
pnpm install
pnpm dev:website  # debe levantar el website actual sin tocar nada
```

**Validación de éxito de la migración:** `pnpm dev:website` levanta el website actual en `localhost:3000` exactamente como antes. Si esto funciona, el split a monorepo está correcto.

---

## 4. Orden de creación de packages (qué primero)

Para que Codex no se atasque en cyclic dependencies:

```
1. packages/types         ← base de todo
2. packages/humanizer     ← independiente
3. infrastructure/db      ← depende de types
4. packages/methodologies ← depende de types
5. packages/query-engine  ← depende de types + methodologies
6. packages/ui            ← depende de tailwind preset
7. packages/blocks        ← depende de ui + types
8. apps/studio            ← depende de todo lo anterior
9. services/workers       ← depende de db + query-engine + methodologies
10. apps/website          ← ya existe, solo migrar
```

---

## 5. Estrategia de deploy

### Website
- Deploy actual en Railway. Mantener.
- CI: cada push a `main` deploya `apps/website`.

### Studio
- Nuevo proyecto en Railway: `noisia-studio`.
- CI: cada push a `main` deploya `apps/studio`.
- Variables de entorno: ver `09_DEV_SETUP_GUIDE.md`.

### Workers
- Nuevo proyecto en Railway: `noisia-workers`.
- CI: cada push a `main` deploya `services/workers`.
- Mismas variables de entorno que studio + acceso a Redis.

### Cómo se separa el deploy

Turborepo + Railway: cada proyecto Railway apunta a un sub-directorio del monorepo. El `railway.json` de cada uno define `pnpm --filter @noisia/<paquete> build` y `pnpm --filter @noisia/<paquete> start`.

Mejora futura: usar GitHub Actions con `turbo run` y solo deployar lo que cambió (`turbo run build --filter=...[HEAD^1]`).

---

## 6. ADR — Architecture Decision Record inicial

Crear `docs/adr/001-monorepo-structure.md` con este contenido:

```markdown
# ADR-001: Monorepo con Turborepo + pnpm workspaces

## Status
Accepted (2026-05-20)

## Context
Necesitamos alojar el website público actual + la plataforma Noisia Studio + workers backend + packages compartidos. Tres alternativas:
1. Repos separados con sincronización manual del KB
2. Monorepo con Nx
3. Monorepo con Turborepo + pnpm workspaces

## Decision
Monorepo con Turborepo + pnpm workspaces.

## Rationale
- El KB (knowledge-base/) se reusa entre website y studio. Sin monorepo, drift garantizado.
- TypeScript types compartidos eliminan duplicación.
- pnpm workspaces ya está en uso (website usa pnpm 10).
- Turborepo es más simple que Nx para nuestro tamaño (5-10 packages).
- Railway deploya sub-directorios de monorepos nativamente.

## Consequences
+ Single source of truth para tipos y KB
+ Refactor cross-package es atómico (un PR)
+ CI puede paralelizar builds con turbo
- Build inicial más lento que single app
- Requiere disciplina de deps entre packages
- Tooling para new devs más complejo
```

---

## 7. Validación de éxito del setup monorepo

Antes de pasar al desarrollo de features, Codex debe poder ejecutar todo esto sin errores:

- [ ] `pnpm install` corre limpio desde root
- [ ] `pnpm dev:website` levanta el website actual en localhost:3000 idéntico a antes
- [ ] `pnpm dev:studio` levanta el studio (página vacía) en localhost:3001
- [ ] `pnpm typecheck` pasa sin errores
- [ ] `pnpm lint` pasa
- [ ] `pnpm build` construye website + studio + packages sin errores
- [ ] Importar `@noisia/types` desde `apps/studio` funciona
- [ ] Importar `@noisia/ui` desde `apps/website` funciona
- [ ] `git status` muestra el monorepo limpio, knowledge-base movido

Si pasan los 8 puntos, el monorepo está listo para desarrollo de Fase 1.

---

## 8. Mejora futura — cosas que NO hacemos hoy pero documentamos

```typescript
// TODO mejora-futura: cuando lleguemos a 15+ packages, evaluar:
// - Nx para generators custom
// - Changesets para versionado independiente de packages
// - Storybook compartido para packages/ui y packages/blocks
// - Build cache remoto (Turborepo + Vercel Remote Cache)

// TODO mejora-futura: separar packages en versionado independiente.
// Hoy todo es 0.x del monorepo. Cuando packages como @noisia/humanizer
// se vuelvan opensource o reusable externo, usar semver propio.

// TODO mejora-futura: docs/api/ debe auto-generarse desde el código
// (con TypeDoc o similar) en CI, no mantenerse a mano.
```
