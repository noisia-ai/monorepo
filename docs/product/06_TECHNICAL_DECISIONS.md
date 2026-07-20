# Noisia Studio — Decisiones técnicas firmadas

> Decisiones tomadas el 20 mayo 2026. Si una de éstas se reabre, debe documentarse en un ADR (Architecture Decision Record) en `/docs/adr/` con razón y consecuencias.

---

## 1. Stack core

| Capa | Decisión | Razón | Mejora futura |
|---|---|---|---|
| **Database** | **Supabase managed (Postgres 15+)** | Auth incluido, RLS nativo, storage, dashboard admin, costo previsible | Migrar a Postgres self-hosted si pasamos 100GB o 50M filas |
| **Data foundation** | **Noisia Data OS Cut 1 sobre Postgres/Drizzle** | Signal Pulse necesita una base viva por cliente: catálogos de fuentes, Brand OS, Knowledge, taxonomías, tags, calidad, lineage y serving APIs. Ver ADR 007. | Evaluar lakehouse externo/dbt formal cuando el volumen o el equipo de datos lo justifique |
| **Auth** | **Kinde** | Multi-org nativo (Org → Brand → User), soporta organizaciones múltiples por usuario, free hasta 7.5K MAU, $25/mes después | Evaluar SuperTokens self-hosted si Kinde sube precios |
| **LLM provider** | **Anthropic Claude** vía **Vercel AI SDK** | Streaming, fallbacks gratis, switching de proveedor sin reescribir | Agregar OpenAI como fallback cuando llegue contrato grande |
| **Pipeline workers** | **BullMQ + Redis** sobre Node 20 TypeScript | Mismo stack que website y studio (cero polyglot), Codex es senior TS, BullMQ tiene UI gratuita | Migrar a Temporal cuando pasen 50 jobs concurrentes o se necesiten workflows largos con state machines |
| **Frontend studio** | **Next.js 15 App Router + Tailwind + shadcn/ui** | Mismo que website, share components, server components reducen JS | — |
| **PDF export** | **Puppeteer server-side** | Renderiza el dashboard real, no una reconstrucción react-pdf | Cachear PDF generados en Supabase Storage; regenerar solo si analysis_run cambia |
| **Charts** | **Recharts** (ya en el website) + custom D3 para visualizaciones signature | Recharts cubre 80%, custom para el 20% diferenciador | — |
| **Email** | **Resend** | API minimal, pricing claro, deliverability decente | — |
| **WhatsApp** | **POSTPUESTO post-MVP** | El usuario lo pausó. Notificaciones por email + in-app | Implementar Twilio o Meta Business API directo cuando tengamos primer cliente firmado pidiéndolo |
| **Hosting** | **Railway** (mismo que website) | Consistencia, deploy preview, pricing predecible | Vercel para frontend si Railway tiene problemas de cold start |
| **Object storage** | **Supabase Storage** | Incluido en Supabase, integrado con auth, política RLS | S3 directo si crecemos más allá del free tier |
| **Queue/cache** | **Upstash Redis** (managed) o **Railway Redis** | $0-10/mes inicial, escala bien | Redis Cluster self-hosted cuando pasen 10GB |
| **Search libre** | **Postgres FTS nativo (tsvector)** | Cero infra adicional, alcanza para 5M rows | OpenSearch si necesitamos semantic search avanzado |
| **Monorepo tool** | **Turborepo + pnpm 10** | El website ya usa pnpm 10, Turborepo paraleliza builds | Nx si necesitamos generators custom complejos |
| **Error tracking** | **Sentry** (free tier) | Estándar de industria | — |
| **Product analytics** | **PostHog self-hosted** (Railway) | Data sensitiva propia, no SaaS de terceros | PostHog Cloud si self-hosted da problemas |
| **CI/CD** | **GitHub Actions** | Free para repos privados, conocido | — |
| **Migrations** | **Drizzle ORM** | TypeScript end-to-end, mejor DX que Prisma para queries complejos | Prisma si Codex prefiere y el equipo crece |

---

## 2. Decisión: NO se cobra al cliente en MVP

El producto es **0 USD** durante todo el MVP y hasta validación con primer cliente productivo.

- No hay flow de billing.
- No hay límites por seat.
- No hay tier diferenciado.
- El cliente paga consultoría a Noisia mediante contrato fuera de plataforma.
- Stripe, Mercado Pago, facturación: TODO postpuesto.

**Implicación para el dev:** no construir billing UI, ni paywall, ni seats counter. El sistema asume que los usuarios autorizados ya pagaron por fuera.

---

## 3. Decisión: NUEVA FEATURE — Estudios temáticos sin marca

El usuario pidió esto explícitamente. Cambia el schema:

**Concepto:** un corpus puede tener como sujeto **una marca** o **un tema**. No solo marcas.

Casos reales:
- **Brand-based:** "Seguros El Potosí × Triggers & Barriers" (el caso comercial típico).
- **Theme-based:** "Cultural Foresight México 2026 × Cultural Codes Decoding" (estudio interno, freebie, demo, content marketing).

**Implementación en schema:**

```sql
-- Nueva tabla
CREATE TABLE themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),  -- nullable: themes internos de Noisia
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  industry_focus TEXT[],
  geo_focus CHAR(2)[] DEFAULT ARRAY['MX'],
  status TEXT NOT NULL,  -- draft | active | published | archived
  is_public BOOLEAN DEFAULT FALSE,  -- true para freebies tipo Cultural Foresight
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Renombrar brand_methodology_corpora → study_corpora
-- Agregar referencia polimórfica
ALTER TABLE study_corpora
  ADD COLUMN theme_id UUID REFERENCES themes(id),
  ALTER COLUMN brand_id DROP NOT NULL,
  ADD CONSTRAINT corpus_has_exactly_one_subject
    CHECK ((brand_id IS NOT NULL)::int + (theme_id IS NOT NULL)::int = 1);

-- UNIQUE deja de ser (brand_id, methodology_id)
DROP CONSTRAINT brand_methodology_corpora_brand_id_methodology_id_key;
CREATE UNIQUE INDEX uq_brand_method ON study_corpora(brand_id, methodology_id) WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX uq_theme_method ON study_corpora(theme_id, methodology_id) WHERE theme_id IS NOT NULL;
```

**UI impact:** al crear un estudio nuevo, el Insights Manager elige primero el **tipo de sujeto**: marca o tema. Después elige metodología.

**Detalle a documentar:** los estudios temáticos pueden migrar después a marca (cuando un cliente compra el insight como base de su estudio brand-specific). El schema soporta esto con un `morphed_into_brand_corpus_id` opcional.

---

## 4. Decisión: Instrucción transversal para Codex

**Toda función / componente / módulo nuevo debe incluir un comentario `// TODO mejora-futura:` cuando hay shortcut o decisión de MVP que merece refactor.**

Ejemplos:

```typescript
// TODO mejora-futura: BullMQ es suficiente para MVP (<10 jobs concurrentes).
// Migrar a Temporal cuando workflow tenga >5 pasos con state machines o duración >1h.
async function runAnalysisPipeline(corpusId: string) { ... }

// TODO mejora-futura: este matching de keywords es regex puro. Cuando la
// biblioteca de brand_seeds pase 500 entries, evaluar Aho-Corasick o
// tokenizer-based matching para perf.
function detectBrandMentions(text: string) { ... }

// TODO mejora-futura: la cola Redis es single-instance. Cuando lleguen
// múltiples clientes con periodos quincenales coincidentes, sumar Redis
// Cluster o cambiar a SQS.
```

Esto le da al equipo trazabilidad de la deuda técnica desde el día uno. Cuando llegue el momento de refactor, ya hay un mapa.

**Adicional:** los archivos `.md` también pueden tener bloques `## Mejora futura` cuando aplique.

---

## 5. Decisión: Política de secretos

**MVP:**
- Secrets en variables de entorno (Vercel/Railway environment).
- `.env.example` versionado en git con placeholders.
- `.env.local` git-ignored.
- Solo el founder tiene acceso a production secrets.

**Mejora futura cuando entre segundo dev:**
- Doppler ($0-19/mes) para gestión central.
- Rotación trimestral de API keys.
- Audit log de quién accedió a qué secret cuándo.

---

## 6. Decisión: Compliance baseline

LFPDPPP (México) aplica desde día uno porque guardamos data personal de autores de menciones (handles, follower count, profile URLs).

**MVP:**
- Política de retención: 24 meses default sobre `authors`.
- Aviso de privacidad publicado en website antes de capturar mención #1 de cliente real.
- Endpoint de takedown: `DELETE /api/authors/:external_id` con auth admin.

**No-MVP (pero documentado):**
- Cookie banner del website.
- DPO designado (cuando facturación > $X/año).
- Auditoría externa de compliance.

---

## 7. Decisión: Versionado del producto

Semver sobre el monorepo completo. Cada release queda en GitHub Release con changelog.

- `0.x` durante MVP (rompimos contratos si hay que romperlos).
- `1.0` cuando Seguros El Potosí firme y use producción.
- `1.x` rompe nada del schema sin migration path.
- `2.0` solo si reescritura mayor.

---

## 8. Decisiones explícitamente postpuestas

| Decisión | Cuándo se retoma |
|---|---|
| WhatsApp Business notifications | Cuando un cliente pague pidiendo esto |
| Multi-país (no solo MX) — UI de selección | Cuando entre primer cliente con marca en otro país LATAM |
| Self-service signup del cliente | Nunca para cliente final; solo onboarding asistido |
| Billing/Stripe | Cuando se decida cobrar por la plataforma (decisión comercial, no técnica) |
| App móvil nativa | Web responsive es suficiente. iOS/Android solo si NPS de mobile <30 |
| Detección de pattern anomaly con ML | Reglas heurísticas en MVP. ML cuando tengamos 6 meses de baseline |
| Registro de activaciones del cliente | Post-MVP. El comparativo antes/después se hace por fechas manuales. |
| Decision Velocity como metodología | Post-MVP (5ta o 6ta en orden) |

---

## 9. Decisión: Data OS Cut 1, no CDP completo

Noisia arranca Data OS como **Customer Intelligence Lakehouse con capacidades CDP-like**,
no como un CDP completo. El benchmark de tecnologia/proceso queda en
`docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md`.

**Por qué:**

- Signal Pulse necesita datos vivos, no solo `published_outputs.payload`.
- Brand OS y Knowledge Base deben ser catálogos consultables, no solo texto de prompt.
- Social listening, performance, briefs, campañas, menciones, señales y evidence deben
  convivir en una misma base gobernada.
- La resolución de identidad personal tipo CDP enterprise no es necesaria en Cut 1 y
  ampliaría el alcance comercial/técnico antes de tiempo.

**Decisión técnica:**

- Mantener Postgres/Supabase + Drizzle como store primario en Cut 1.
- Agregar tablas aditivas de catalog, quality, lineage, taxonomy, tags, feature store,
  semantic layer y dashboard refs.
- Versionar las reglas de tagging en `tagging_rule_sets` y ligar el
  `tagging_model_versions` activo a ese rule set; ningún tag productivo debe quedar
  sin diccionario/regla auditable.
- Mantener `published_outputs.payload` como fallback/rollback lógico.
- Activar serving live solo con flags y shadow mode.
- Usar `data-os:shadow-run`, `data-os:serving-smoke`, `data-os:evidence` y
  `data-os:release-gate` como gates antes de cualquier cambio cliente-visible; el
  release gate productivo debe incluir `database_format_postgres_url`.
- Mantener Postgres/Drizzle en Cut 1 y evaluar dbt, Dagster/Temporal,
  OpenMetadata/DataHub, ClickHouse o Iceberg solo cuando se alcancen los umbrales
  documentados en el benchmark.

**No hacer en Cut 1:**

- No prometer identidad 360 de consumidor final.
- No reescribir el dashboard antes de estabilizar APIs vivas.
- No ejecutar tagging LLM automático en producción sin nueva compuerta de costo/calidad.
- No correr migraciones destructivas ni revertir schema para rollback.

---

## 10. Stack final como tabla copy-paste

Para que Codex tenga la lista clara y ya:

```yaml
runtime:
  language: TypeScript (estrictamente)
  node_version: ">=20.0.0"
  package_manager: pnpm@10

frontend:
  framework: Next.js 15 (App Router)
  ui_library: shadcn/ui + Tailwind (compartido con website)
  animations: Motion (Framer) + GSAP (ya en website)
  charts: Recharts (default) + D3 (custom blocks)
  forms: react-hook-form + zod

backend:
  pattern: Next.js Route Handlers (no FastAPI/Hono separado en MVP)
  reason: "Mismo monorepo, mismo deploy, mismo lang. Separar cuando >50 endpoints o necesitamos Python."

database:
  primary: Supabase Postgres 15
  orm: Drizzle
  migrations: drizzle-kit
  data_foundation: Noisia Data OS Cut 1 (catalogs, quality, lineage, taxonomy, tags, semantic layer)
  rls: enabled (multi-tenant)

auth:
  provider: Kinde
  org_model: Kinde Organizations (mapped 1:1 a tabla organizations)

llm:
  provider_primary: Anthropic Claude (claude-sonnet o claude-opus según task)
  sdk: Vercel AI SDK
  fallback: OpenAI GPT-4 (configurado vía env var, off por default en MVP)

queue:
  broker: Upstash Redis o Railway Redis
  library: BullMQ
  ui: bull-board (admin only)

storage:
  files: Supabase Storage
  cdn: Supabase CDN o Cloudflare R2 si crecemos

monitoring:
  errors: Sentry
  analytics: PostHog self-hosted en Railway
  uptime: BetterStack free tier

deploy:
  studio_frontend: Railway
  workers: Railway (separate service)
  cron: Railway Cron Jobs

dev_tools:
  ci_cd: GitHub Actions
  linting: ESLint (config del website)
  formatting: Prettier
  type_check: tsc strict
  testing: Vitest (unit) + Playwright (e2e)
```
