# Noisia Studio — Product Spec Package v2

Paquete completo de definición de producto para Noisia Studio. Listo para entregar a Codex y arrancar desarrollo.

**Fecha:** 20 mayo 2026
**Versión:** 2.0 (decisiones técnicas firmadas + Codex-ready)

---

## Cómo entregarlo a Codex

Mándale el ZIP `noisia_studio_product_spec.zip` y este mensaje:

> Codex — paquete completo de Noisia Studio. Abre `00_README.md` y lee en orden. Las decisiones técnicas están firmadas (`06_TECHNICAL_DECISIONS.md`). Empieza por el setup (`09_DEV_SETUP_GUIDE.md`) y después la Fase 1 del roadmap (`01_PRODUCT_SPEC_MASTER.md` sección 10 + AC en `14_ACCEPTANCE_CRITERIA.md`). Regla transversal: cada función / módulo / decisión técnica nueva lleva un comentario `// TODO mejora-futura:` cuando hay shortcut MVP — ver `06_TECHNICAL_DECISIONS.md` sección 4.

---

## Orden de lectura

| # | Archivo | Para qué |
|---|---|---|
| 00 | `00_README.md` | Este archivo — entry point |
| 01 | `01_PRODUCT_SPEC_MASTER.md` | Master spec. Las 8 dimensiones del producto. **Empieza aquí.** |
| 02 | `02_METHODOLOGIES_CATALOG.md` | Las 6 metodologías Noisia como sistema |
| 03 | `03_TRIGGERS_BARRIERS_DEEPDIVE.md` | T&B build-ready (primera metodología MVP) |
| 04 | `04_DATABASE_SCHEMA.md` | Schema PostgreSQL completo |
| 05 | `05_GLOSSARY_AND_REFERENCES.md` | Términos, roles, referencias |
| 06 | `06_TECHNICAL_DECISIONS.md` | **Stack firmado** + decisiones técnicas + decisión "estudios temáticos" + regla "TODO mejora-futura" |
| 07 | `07_REPO_STRUCTURE.md` | Monorepo con Turborepo + comandos de migración |
| 08 | `08_API_CONTRACTS.md` | Endpoints MVP (request/response/auth) |
| 09 | `09_DEV_SETUP_GUIDE.md` | Setup paso a paso: cuentas a crear, .env, docker, validación |
| 10 | `10_methodology_seeds/` | 6 YAMLs cargables al seed de DB + README |
| 11 | `11_BRAND_SEEDS_CATALOG.yaml` | 60+ brand_seeds iniciales (MX) |
| 12 | `12_TEST_STRATEGY.md` | Unit + integration + contract + E2E + AI quality |
| 13 | `13_DIAGRAMS.md` | ER + sequence + state + flow (todos Mermaid) |
| 14 | `14_ACCEPTANCE_CRITERIA.md` | AC por feature de las 6 fases del MVP |
| 15 | `15_ACCESS_GATEWAY_WORKSPACE_SWITCHER.md` | Gateway de acceso y workspace switcher |
| 16 | `16_STUDIO_I18N_ROLLOUT.md` | Rollout i18n de Studio |
| 17 | `17_REPORTING_API_LOOKER_CONTRACT.md` | Contrato Reporting API / Looker |
| 18 | `18_REPORTING_API_V2_PUBLIC_CONTRACT.md` | Contrato público Reporting API v2 |
| 19 | `19_STUDIO_SPRINT_BACKLOG.md` | Backlog de sprint Studio |
| 20 | `20_ENGINE_HARDENING_HANDOFF.md` | Handoff de hardening del Engine |
| 21 | `21_LIVE_INTELLIGENCE_PLAN.md` | Plan para pasar de reportes JSON a inteligencia viva |
| 22 | `22_NOISIA_DATA_OS_CUT_1.md` | Spec productivo de Data OS: catálogos, taxonomías, tags, calidad, lineage y serving APIs |
| 23 | `23_NOISIA_DATA_OS_STAGING_RUNBOOK.md` | Runbook corto para staging, shadow run, evidencia PR y rollback Data OS |
| 24 | `24_NOISIA_DATA_OS_TECH_BENCHMARK.md` | Benchmark de tecnologia/proceso: lakehouse, CDP-like, catalogo, semantic layer, orquestacion y criterios de adopcion |
| 25 | `25_NOISIA_DATA_OS_STAGING_HANDOFF.md` | Checklist de operador para pasar del corte local verificado al evidence pack staging/preview |
| 26 | `26_NOISIA_DATA_OS_COMPLETION_AUDIT.md` | Matriz de cierre para decidir si el Goal Data OS puede marcarse completo |
| 27 | `27_BRAND_OS_DATA_OS_PERSISTENCE_AUDIT.md` | Auditoría de persistencia Brand OS: campos, catálogos, seeds, KB, Data OS lineage y gaps de sincronización |
| 28 | `28_CORPUS_ENGINE_VALIDATION_CONTRACT.md` | Contrato que separa evaluación post-ingesta por query pack y certificación revisionada del corpus |
| 29 | `29_STUDY_TO_DECK_FEATURE.md` | Especificación del flujo de Study a presentación editable |
| 30 | `30_QUERY_CONSTRUCTION_V2.md` | Compilador gobernado de queries: modos, identidad, ambigüedad, configuración, tags y lineage |

---

## Decisiones críticas firmadas (resumen)

| Decisión | Valor |
|---|---|
| Repo | Monorepo en `noisia-ai/website` (renombrado mentalmente a `noisia-ai`) con Turborepo + pnpm workspaces |
| Database | Supabase managed Postgres + Drizzle ORM |
| Auth | **Kinde** (multi-org nativo, free hasta 7.5K MAU) |
| LLM | Anthropic Claude vía Vercel AI SDK |
| Workers | Node 20 TypeScript + **BullMQ + Redis** (no Python) |
| Frontend | Next.js 15 App Router + Tailwind + shadcn/ui |
| PDF | Puppeteer server-side |
| Hosting | Railway (consistente con website) |
| Pricing | **$0 al cliente** en MVP. Stripe y billing postpuestos. |
| WhatsApp | **Postpuesto**. Notificaciones por email en MVP. |
| Primer cliente | Seguros El Potosí (con fallback a industria seguros) |
| Primera metodología | Triggers & Barriers |
| Outputs MVP | Dashboard Narrativo + Scrollytelling + PDF + CSV + MD |

---

## Cambios respecto a versión anterior del paquete

1. **Estudios temáticos sin marca** (Cultural Foresight 2026, Future is Human, etc.). El corpus tiene sujeto polimórfico: `brand_id` O `theme_id`. Tabla `themes` nueva.
2. **Stack 100% TypeScript** (no Python). Workers en Node con BullMQ.
3. **Auth con Kinde** (no Supabase Auth).
4. **WhatsApp postpuesto.** Notificaciones por email.
5. **Pricing $0** durante MVP.
6. **Instrucción transversal:** Codex debe dejar `// TODO mejora-futura:` en cada shortcut.

---

## Lo que NO está en este paquete (pendiente / postpuesto / fuera de scope MVP)

Lista honesta de lo que Codex va a necesitar y todavía no está aquí:

### Pendiente — Codex puede arrancar sin esto pero conviene resolverlo en semana 1-2

1. **Prompts completos de los 6 pasos de T&B en archivos separados.** Los prompts están definidos textualmente en `03_TRIGGERS_BARRIERS_DEEPDIVE.md` sección 5, pero deberían vivir en `packages/methodologies/src/prompts/tb/*.txt` para versionarse independientes del manifest YAML. Codex los extrae al implementar Fase 3.

2. **OpenAPI YAML auto-generado.** `08_API_CONTRACTS.md` describe endpoints en markdown. Codex genera el OpenAPI formal con `zod-to-openapi` cuando construya los endpoints. Output: `docs/api/openapi.yaml`.

3. **Drizzle schema files concretos.** El schema en `04_DATABASE_SCHEMA.md` está en SQL DDL. Codex traduce a Drizzle TypeScript en `infrastructure/db/schema/*.ts` durante Fase 1.

4. **Script de migración de los 4 estudios pasados.** `12_TEST_STRATEGY.md` sección 5 describe el plan. Falta el script `.ts` que convierte los CSVs de Foresight 2026 / FIH / Mexican Home a fixtures cargables.

5. **Componentes React de los bloques.** El banco está catalogado pero los componentes no están escritos. Codex los construye durante Fase 4.

### Postpuesto explícitamente (no MVP)

- WhatsApp Business integration
- Multi-país: UI de selección (schema soporta, UI espera)
- Self-service signup cliente
- Billing / Stripe
- App móvil nativa
- Decision Velocity como metodología activa
- Registro de activaciones del cliente para correlación
- ML para pattern anomaly (heurística en MVP)

### Decisiones que tú tienes que tomar todavía

1. **UX visual del Dashboard de T&B.** Layouts ASCII están en `03_TRIGGERS_BARRIERS_DEEPDIVE.md` sección 7. Falta tu Figma. Necesario antes de Fase 4 (semana 13).
2. **WhatsApp Business API account** cuando decidas activarlo post-MVP.
3. **SentiOne contract** cuando MVP esté validado con CSV.
4. **Política de retención de datos LFPDPPP** — 24 meses default propuesto, confirmar con asesor legal cuando entre cliente real.
5. **Quién es el UX Data Specialist** cuando Codex llegue a Fase 4 (banco de bloques).

### Cosas que descubriremos en el camino

Son normales. Aparecerán cuando:
- Codex ejecute setup y encuentre que un servicio (Supabase, Kinde) tiene constraint no documentado
- Primer corpus real revele edge cases del Engine de Validación
- Insights Manager use la plataforma y pida ajustes
- Cliente real abra el dashboard y comente

Por eso `06_TECHNICAL_DECISIONS.md` sección 4 obliga a comentar `// TODO mejora-futura:` en cada decisión MVP — para que la deuda quede mapeada y se pueda priorizar.

---

## Métricas de éxito del MVP

Al cierre de las 6 fases (semana 24):

- Seguros El Potosí real corriendo T&B mensualmente en plataforma
- Tiempo de corpus: 1-2 horas con Engine (vs 1-2 días manual hoy)
- Tiempo de análisis T&B: 1 hora pipeline + 2 horas curación humana (vs 1 semana manual)
- NPS del cliente >40 en primera presentación
- Insights Manager prefiere plataforma vs flow manual

---

## Estructura del paquete (verificación)

```
noisia_studio_product_spec/
├── 00_README.md                            ← este archivo
├── 01_PRODUCT_SPEC_MASTER.md
├── 02_METHODOLOGIES_CATALOG.md
├── 03_TRIGGERS_BARRIERS_DEEPDIVE.md
├── 04_DATABASE_SCHEMA.md
├── 05_GLOSSARY_AND_REFERENCES.md
├── 06_TECHNICAL_DECISIONS.md
├── 07_REPO_STRUCTURE.md
├── 08_API_CONTRACTS.md
├── 09_DEV_SETUP_GUIDE.md
├── 10_methodology_seeds/
│   ├── README.md
│   ├── triggers-barriers.yaml             ← MVP activa
│   ├── value-perception-matrix.yaml       ← beta
│   ├── journey-friction-mapping.yaml      ← beta
│   ├── cultural-codes-decoding.yaml       ← beta
│   ├── influence-architecture.yaml        ← beta
│   └── decision-velocity.yaml             ← beta
├── 11_BRAND_SEEDS_CATALOG.yaml
├── 12_TEST_STRATEGY.md
├── 13_DIAGRAMS.md
├── 14_ACCEPTANCE_CRITERIA.md
├── 15_ACCESS_GATEWAY_WORKSPACE_SWITCHER.md
├── 16_STUDIO_I18N_ROLLOUT.md
├── 17_REPORTING_API_LOOKER_CONTRACT.md
├── 18_REPORTING_API_V2_PUBLIC_CONTRACT.md
├── 19_STUDIO_SPRINT_BACKLOG.md
├── 20_ENGINE_HARDENING_HANDOFF.md
├── 21_LIVE_INTELLIGENCE_PLAN.md
├── 22_NOISIA_DATA_OS_CUT_1.md
├── 23_NOISIA_DATA_OS_STAGING_RUNBOOK.md
├── 24_NOISIA_DATA_OS_TECH_BENCHMARK.md
├── 25_NOISIA_DATA_OS_STAGING_HANDOFF.md
├── 26_NOISIA_DATA_OS_COMPLETION_AUDIT.md
├── 27_BRAND_OS_DATA_OS_PERSISTENCE_AUDIT.md
├── 28_CORPUS_ENGINE_VALIDATION_CONTRACT.md
├── 29_STUDY_TO_DECK_FEATURE.md
└── 30_QUERY_CONSTRUCTION_V2.md
```

Este índice es un paquete vivo; el canon vigente incluye los documentos 00-30 y los YAMLs de metodología.
