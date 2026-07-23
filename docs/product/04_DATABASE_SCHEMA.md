# Noisia Studio — Database Schema

> Schema relacional completo para PostgreSQL. Construido sobre lo aprendido en cuatro estudios reales y refinado contra el modelo de negocio definido en `01_PRODUCT_SPEC_MASTER.md`.

---

## 1. Decisiones de diseño rectoras

1. **PostgreSQL 15+ con `jsonb`.** Suficiente para 50M filas con índices correctos. `jsonb` cubre el caos (engagement variable, raw_metadata, custom fields por integración nueva).
2. **Unidad atómica de trabajo: `study_corpora`** (anteriormente nombrada `brand_methodology_corpora` en versiones tempranas de este doc — Codex debe usar `study_corpora` como nombre final de tabla). Sujeto polimórfico: `brand_id` O `theme_id`, nunca ambos. Una marca con tres metodologías tiene tres corpora; un theme con dos metodologías tiene dos corpora. Decisión central que arrastra todo el schema. **Cambio respecto a versión previa:** el corpus ya no es solo brand-bound; soporta también themes (Cultural Foresight 2026, etc.).
3. **Particionado por `brand_methodology_corpus_id`.** Cada corpus en su partición. Borrar un corpus = drop partition. Queries dentro de un corpus no escanean los demás.
4. **Versionado del pipeline en cada decisión.** No sobrescribir. Cada clasificación, exclusión, codificación lleva `pipeline_version`. Permite mejorar el pipeline sin perder histórico.
5. **`brand_seeds` global cross-cliente.** Inmuebles24 es Inmuebles24 en cualquier estudio. Catálogo central.
6. **Junction tables para todo many-to-many.** Nunca `is_signal_1`, `is_signal_2` como columnas.
7. **`evidence_quotes` separada de `mentions`.** La cita que va al dashboard es decisión editorial, no cualquier mención.

---

## 2. Tablas del dominio de negocio

### 2.1 `organizations`

La organización contratante. Caso real: Grupo Salinas, Church & Dwight.

```sql
CREATE TABLE organizations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,
  legal_name            TEXT NOT NULL,
  display_name          TEXT,
  hq_country            CHAR(2) DEFAULT 'MX',
  industry_primary      TEXT,
  is_holding            BOOLEAN DEFAULT FALSE,   -- true si Grupo Salinas
  status                TEXT NOT NULL,           -- prospect | active | paused | churned
  contract_started_at   DATE,
  account_owner_kam_id  UUID REFERENCES users(id),  -- KAM responsable
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.2 `brands`

Una organización puede tener varias marcas. Caso real: Grupo Salinas → Elektra, Banco Azteca, Coppel, Italika.

```sql
CREATE TABLE brands (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID REFERENCES organizations(id) NOT NULL,
  slug                  TEXT UNIQUE NOT NULL,    -- elektra | banco_azteca | seguros_el_potosi
  name                  TEXT NOT NULL,
  display_name          TEXT,
  industry              TEXT,                    -- retail | banca | seguros | cpg_bebidas
  industry_sub          TEXT,                    -- seguros_auto | bebidas_carbonadas
  countries             CHAR(2)[] DEFAULT ARRAY['MX'],  -- multi-país LATAM hispanohablante
  description           TEXT,
  brand_seed_handles    TEXT[],                  -- ['@SegurosElPotosi','Seguros El Potosí']
  status                TEXT NOT NULL,           -- active | paused | archived
  primary_brand_manager_user_id UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
CREATE INDEX idx_brands_org ON brands(organization_id);
CREATE INDEX idx_brands_industry ON brands(industry);
```

### 2.3 `competitors`

Competidores configurados a nivel marca (por decisión del usuario).

```sql
CREATE TABLE competitors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id              UUID REFERENCES brands(id) NOT NULL,
  competitor_brand_seed_id  UUID REFERENCES brand_seeds(id) NOT NULL,
  priority              INTEGER,                 -- 1 = primario, 2 = secundario...
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, competitor_brand_seed_id)
);
```

### 2.4 `users`

Usuarios del sistema. Internos (Noisia) + Externos (cliente).

```sql
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT UNIQUE NOT NULL,
  full_name             TEXT,
  user_type             TEXT NOT NULL,           -- noisia_internal | client | agency
  primary_role          TEXT NOT NULL,           -- founder | kam | insights_manager | ux_data | client_owner | brand_manager | agency_insights
  organization_id       UUID REFERENCES organizations(id),  -- null para internos
  status                TEXT NOT NULL,           -- active | invited | paused | revoked
  whatsapp_number       TEXT,                    -- para notificaciones
  preferences           JSONB DEFAULT '{}',      -- lenguaje preferido, cadencia, etc.
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by_user_id    UUID REFERENCES users(id)
);
CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_role ON users(primary_role);
```

### 2.4b `themes` — estudios temáticos sin marca específica

Nueva entidad. Permite corpora que no están bound a una marca: Cultural Foresight 2026, Future is Human, The Mexican Home — todos son ejemplos de themes.

```sql
CREATE TABLE themes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID REFERENCES organizations(id),  -- nullable: themes internos de Noisia
  slug                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT,
  industry_focus        TEXT[],
  geo_focus             CHAR(2)[] DEFAULT ARRAY['MX'],
  status                TEXT NOT NULL,           -- draft | active | published | archived
  is_public             BOOLEAN DEFAULT FALSE,   -- true para freebies tipo Cultural Foresight
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_themes_org ON themes(organization_id);
CREATE INDEX idx_themes_public ON themes(is_public) WHERE is_public = true;
```

**Reglas:**
- `organization_id = NULL` significa theme interno de Noisia (default para freebies).
- `organization_id != NULL` cuando un cliente "compra" un theme como base para su análisis brand-specific (caso futuro).
- `is_public = true` permite mostrar el theme en website público (Cultural Foresight 2026 como showcase comercial).

### 2.5 `user_brand_access`

Junction table: quién tiene acceso a qué marca y con qué nivel.

```sql
CREATE TABLE user_brand_access (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES users(id) NOT NULL,
  brand_id              UUID REFERENCES brands(id) NOT NULL,
  access_level          TEXT NOT NULL,           -- read | comment | edit (solo Insights Manager) | admin
  granted_by_user_id    UUID REFERENCES users(id),
  granted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  UNIQUE (user_id, brand_id)
);
CREATE INDEX idx_uba_user ON user_brand_access(user_id);
CREATE INDEX idx_uba_brand ON user_brand_access(brand_id);
```

---

## 3. Tablas del dominio metodológico

### 3.1 `methodologies`

Catálogo central. Las 6 metodologías Noisia (ver `02_METHODOLOGIES_CATALOG.md`).

```sql
CREATE TABLE methodologies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,    -- triggers-barriers | value-perception-matrix | ...
  name                  TEXT NOT NULL,
  version               TEXT NOT NULL,           -- "1.0", "1.1", etc.
  status                TEXT NOT NULL,           -- active | beta | deprecated
  manifest_yaml         JSONB NOT NULL,          -- el manifest completo de la metodología
  default_blocks        JSONB,                   -- IDs de bloques default del dashboard
  scrollytelling_template JSONB,
  ai_prompts            JSONB,                   -- prompts por paso del protocolo
  quality_gates         JSONB,                   -- gates automatizados
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);
```

### 3.2 `study_corpora` — LA UNIDAD ATÓMICA

Nombre final de tabla: **`study_corpora`** (renombrado desde `brand_methodology_corpora` para soportar sujeto polimórfico).

Sujeto: `brand_id` O `theme_id`. Check constraint garantiza exactamente uno.

```sql
CREATE TABLE study_corpora (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sujeto polimórfico: marca O tema, nunca ambos, nunca ninguno
  brand_id              UUID REFERENCES brands(id),
  theme_id              UUID REFERENCES themes(id),
  CONSTRAINT corpus_has_exactly_one_subject
    CHECK ((brand_id IS NOT NULL)::int + (theme_id IS NOT NULL)::int = 1),

  methodology_id        UUID REFERENCES methodologies(id) NOT NULL,
  methodology_version_at_creation TEXT NOT NULL,

  -- Configuración del corpus
  business_question     TEXT,
  decision_to_inform    TEXT,
  audience_segment      TEXT,
  geo_focus             CHAR(2)[] DEFAULT ARRAY['MX'],
  target_window_months  INTEGER DEFAULT 12,

  -- Contexto inicial (memoria por marca/tema)
  context_form          JSONB,

  -- Estado operacional
  status                TEXT NOT NULL,
  current_pipeline_version TEXT,
  insights_manager_user_id UUID REFERENCES users(id),
  kam_user_id           UUID REFERENCES users(id),

  -- Metadata
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  corpus_first_approved_at TIMESTAMPTZ,
  first_published_at    TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique por sujeto (no se puede crear dos corpora idénticos)
CREATE UNIQUE INDEX uq_corpus_brand_method ON study_corpora(brand_id, methodology_id) WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX uq_corpus_theme_method ON study_corpora(theme_id, methodology_id) WHERE theme_id IS NOT NULL;

CREATE INDEX idx_sc_brand ON study_corpora(brand_id);
CREATE INDEX idx_sc_theme ON study_corpora(theme_id);
CREATE INDEX idx_sc_method ON study_corpora(methodology_id);
CREATE INDEX idx_sc_status ON study_corpora(status);
```

**Nota para Codex:** todas las referencias a `brand_methodology_corpora` o `brand_methodology_corpus_id` en el resto de este documento deben renombrarse a `study_corpora` y `study_corpus_id` respectivamente. Es un find-and-replace mecánico.

---

## 4. Mentions y data table

### 4.1 `mentions` — la tabla central

```sql
CREATE TABLE mentions (
  -- ── IDENTIDAD ──────────────────────────────────────────────
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id) NOT NULL,
  external_id           TEXT NOT NULL,
  source_system         TEXT NOT NULL,           -- sentione | datashake | apify_<actor> | csv_manual | api_custom_<id>
  source_file_id        UUID REFERENCES import_batches(id),
  text_hash             TEXT NOT NULL,

  -- ── CONTENIDO ──────────────────────────────────────────────
  text_raw              TEXT,
  text_clean            TEXT NOT NULL,
  text_snippet          TEXT,
  title                 TEXT,
  text_length           INTEGER NOT NULL,
  text_tokens           INTEGER,
  language              CHAR(2),
  language_confidence   NUMERIC(3,2),

  -- ── TEMPORAL ───────────────────────────────────────────────
  published_at          TIMESTAMPTZ NOT NULL,
  month_key             CHAR(7) GENERATED ALWAYS AS (to_char(published_at, 'YYYY-MM')) STORED,
  ingested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── PLATAFORMA Y URL ───────────────────────────────────────
  platform              TEXT NOT NULL,
  platform_category     TEXT,
  mention_type          TEXT,
  url                   TEXT,
  parent_url            TEXT,
  thread_id             TEXT,
  parent_id             TEXT,

  -- ── AUTOR ──────────────────────────────────────────────────
  author_id             UUID REFERENCES authors(id),
  author_external_id    TEXT,
  author_handle         TEXT,
  author_display_name   TEXT,

  -- ── GEO ────────────────────────────────────────────────────
  country               CHAR(2),
  region                TEXT,
  geo_source            TEXT,
  mx_leaning            BOOLEAN DEFAULT FALSE,

  -- ── ENGAGEMENT ─────────────────────────────────────────────
  engagement            JSONB,

  -- ── SENTIMENT DE LA FUENTE ─────────────────────────────────
  sentiment_source      TEXT,
  sentiment_score       NUMERIC(4,3),
  sentiment_origin      TEXT,

  -- ── INFLUENCIA ─────────────────────────────────────────────
  influence_score       NUMERIC(6,2),
  author_followers      INTEGER,
  total_interactions    INTEGER,

  -- ── QUALITY GATES ──────────────────────────────────────────
  quality_score         INTEGER,                 -- 1-10
  inclusion_status      TEXT NOT NULL DEFAULT 'pending',
  exclusion_reason      TEXT,
  quality_flags         JSONB,

  -- ── RAW METADATA (todo lo que la fuente trae) ──────────────
  raw_metadata          JSONB,

  -- ── AUDITORÍA ──────────────────────────────────────────────
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── CONSTRAINTS ────────────────────────────────────────────
  UNIQUE (brand_methodology_corpus_id, text_hash),
  UNIQUE (source_system, external_id)
)
PARTITION BY LIST (brand_methodology_corpus_id);

-- Crear partición por cada corpus operativo
-- (esto se hace via migration al crear un brand_methodology_corpus nuevo)

-- Índices críticos
CREATE INDEX idx_mentions_corpus_month ON mentions(brand_methodology_corpus_id, month_key);
CREATE INDEX idx_mentions_corpus_platform ON mentions(brand_methodology_corpus_id, platform);
CREATE INDEX idx_mentions_corpus_inclusion ON mentions(brand_methodology_corpus_id, inclusion_status);
CREATE INDEX idx_mentions_published ON mentions(published_at);
CREATE INDEX idx_mentions_text_fts ON mentions USING GIN (to_tsvector('spanish', text_clean));
CREATE INDEX idx_mentions_text_hash ON mentions(text_hash);
CREATE INDEX idx_mentions_engagement ON mentions USING GIN (engagement);
```

### 4.2 `authors`

Tabla separada para análisis cross-corpus de autores.

```sql
CREATE TABLE authors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform              TEXT NOT NULL,
  external_id           TEXT,
  handle                TEXT,
  display_name          TEXT,
  profile_url           TEXT,
  follower_count_last_seen INTEGER,
  inferred_gender       CHAR(1),
  inferred_country      CHAR(2),
  is_verified           BOOLEAN,
  is_business           BOOLEAN,
  first_seen            TIMESTAMPTZ,
  last_seen             TIMESTAMPTZ,
  UNIQUE (platform, external_id)
);
```

### 4.3 `brand_seeds` — catálogo global

```sql
CREATE TABLE brand_seeds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name        TEXT UNIQUE NOT NULL,
  aliases               TEXT[],
  detection_patterns    TEXT[],                  -- regex
  vertical              TEXT,                    -- banking | telco | retail | platforms | finance | realtors | seguros | etc.
  sub_vertical          TEXT,
  country               CHAR(2),
  is_institution        BOOLEAN DEFAULT FALSE,   -- Infonavit, Condusef, Profeco
  notes                 TEXT,
  active                BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 5. Coding y análisis

### 5.1 `mention_codings`

La tabla puente donde vive la codificación contra la metodología. Es el corazón del análisis.

```sql
CREATE TABLE mention_codings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mention_id            UUID REFERENCES mentions(id) ON DELETE CASCADE,
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id),

  -- Codificación genérica
  emergent_tags         TEXT[],                  -- del Paso 1 abierto
  primary_finding_id    UUID REFERENCES findings(id),  -- el hallazgo principal al que apunta
  secondary_finding_ids UUID[],
  polarity              TEXT,                    -- T&B: trigger/barrier; VPM: high/low value; etc.
  layer                 TEXT,                    -- T&B: psicológico/personal/social/cultural; varía por metodología

  -- Codificación específica de metodología (jsonb para flexibilidad)
  methodology_specific  JSONB,
  -- Ejemplo T&B: { "intensity": 4.2, "predictive_signal": true, "decision_marker": "compré" }
  -- Ejemplo VPM:  { "value_dimension": "tiempo", "perceived_high_low": "high" }

  -- Auditoría
  classified_by         TEXT,                    -- ai | manual | hybrid
  classifier_version    TEXT,
  confidence_score      NUMERIC(3,2),
  ambiguous             BOOLEAN DEFAULT FALSE,
  classified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (mention_id, classifier_version)
);
CREATE INDEX idx_mc_corpus ON mention_codings(brand_methodology_corpus_id);
CREATE INDEX idx_mc_finding ON mention_codings(primary_finding_id);
CREATE INDEX idx_mc_polarity_layer ON mention_codings(polarity, layer);
```

### 5.2 `findings` — los hallazgos del análisis

```sql
CREATE TABLE findings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id) NOT NULL,
  finding_code          TEXT,                    -- T-PSI-01, B-CUL-03 (legible)
  commercial_name       TEXT NOT NULL,
  one_liner             TEXT,
  polarity              TEXT,                    -- según metodología
  layer                 TEXT,                    -- según metodología

  -- Métricas (varían por metodología)
  metrics               JSONB,
  -- T&B: { "frecuencia": 312, "intensidad": 3.8, "predictiva": 0.62, "score_compuesto": 4.7 }

  -- Movilidad (T&B-specific pero compatible con otras)
  movilidad             TEXT,                    -- movible_por_marca | influenciable | estructural
  movilidad_razon       TEXT,

  -- Narrativa
  cultural_reading      TEXT,
  tension_left          TEXT,
  tension_right         TEXT,
  lead_quote_mention_id UUID REFERENCES mentions(id),

  -- Madurez (Cultural Codes-specific pero reusable)
  maturity              TEXT,                    -- emergente | acelerando | mainstreaming

  -- Brand implications
  brand_implications    JSONB,
  -- { "do": [...], "avoid": [...], "categories_exposed": [...], "categories_opportunity": [...] }

  -- Monitor next
  monitor_keywords      TEXT[],

  -- Quality
  confidence_level      TEXT,                    -- alta | media | baja_direccional

  -- Estado
  status                TEXT NOT NULL,           -- candidate | validated | published | discarded

  -- Auditoría
  created_by_analysis_run_id UUID REFERENCES analysis_runs(id),
  approved_by_user_id   UUID REFERENCES users(id),
  approved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_findings_corpus ON findings(brand_methodology_corpus_id);
CREATE INDEX idx_findings_status ON findings(status);
```

### 5.3 `evidence_quotes` — citas curadas para el dashboard

Decisión editorial. No cualquier mención.

```sql
CREATE TABLE evidence_quotes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id) NOT NULL,
  finding_id            UUID REFERENCES findings(id) NOT NULL,
  mention_id            UUID REFERENCES mentions(id) NOT NULL,

  ordered_position      INTEGER NOT NULL,
  is_lead_quote         BOOLEAN DEFAULT FALSE,
  used_in_dashboard     BOOLEAN DEFAULT TRUE,
  used_in_scrollytelling BOOLEAN DEFAULT TRUE,
  used_in_pdf           BOOLEAN DEFAULT TRUE,

  display_text          TEXT,                    -- excerpt curado del text_clean (opcional)
  attribution_override  TEXT,                    -- "@psic.jasminguzman" curado
  editor_note           TEXT,

  curated_by_user_id    UUID REFERENCES users(id),
  curated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (finding_id, ordered_position)
);
CREATE INDEX idx_eq_finding ON evidence_quotes(finding_id);
```

---

## 6. Pipeline operacional

### 6.1 `import_batches`

Cada carga de menciones queda versionada.

```sql
CREATE TABLE import_batches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id) NOT NULL,
  source_integration_id UUID REFERENCES integrations(id),  -- si vino de integración configurada
  source_system         TEXT NOT NULL,
  source_file_name      TEXT,
  source_file_size_bytes BIGINT,
  source_file_hash      TEXT,
  source_export_at      TIMESTAMPTZ,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by_user_id   UUID REFERENCES users(id),
  record_count          INTEGER,
  included_count        INTEGER,
  excluded_count        INTEGER,
  duplicate_count       INTEGER,
  error_count           INTEGER,
  pipeline_version      TEXT,
  notes                 TEXT
);
```

### 6.2 `integrations` — fuentes configurables por UI

Lo que permite agregar Apify, LinkedIn API, otras sin tocar código.

```sql
CREATE TABLE integrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id),  -- nullable: integraciones pueden ser globales
  organization_id       UUID REFERENCES organizations(id),  -- nullable: integraciones pueden ser globales Noisia
  name                  TEXT NOT NULL,           -- "LinkedIn Apify Actor para Seguros El Potosí"
  integration_type      TEXT NOT NULL,           -- sentione_api | datashake_api | apify_actor | webhook | custom_api | csv_upload
  config                JSONB NOT NULL,          -- credenciales encriptadas, endpoint, headers, mapping de campos
  field_mapping         JSONB NOT NULL,          -- cómo se mapea response → schema canónico Noisia
  validation_test_passed BOOLEAN DEFAULT FALSE,  -- pasó la validación de 10 menciones
  validation_test_at    TIMESTAMPTZ,
  active                BOOLEAN DEFAULT FALSE,
  created_by_user_id    UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at          TIMESTAMPTZ
);
```

### 6.3 `query_iterations` — historial del Engine de Validación

```sql
CREATE TABLE query_iterations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id) NOT NULL,
  iteration_number      INTEGER NOT NULL,
  query_text            TEXT NOT NULL,
  query_components      JSONB,                   -- brand_seeds, signal_phrases, exclusions, etc.
  mentions_returned     INTEGER,
  quality_score         NUMERIC(3,2),            -- 0-100 según evaluación IA
  density_score         NUMERIC(3,2),
  noise_score           NUMERIC(3,2),
  ai_evaluation_notes   TEXT,
  insights_manager_decision TEXT,                -- accept | adjust | reject
  insights_manager_user_id UUID REFERENCES users(id),
  decision_at           TIMESTAMPTZ,
  pipeline_version      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qi_corpus ON query_iterations(brand_methodology_corpus_id);
```

### 6.4 `quality_filter_logs`

Por qué cada mención se excluyó o flagged.

```sql
CREATE TABLE quality_filter_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mention_id            UUID REFERENCES mentions(id),
  filter_name           TEXT NOT NULL,
  action                TEXT NOT NULL,           -- excluded | flagged | scored
  reason                TEXT,
  pipeline_version      TEXT,
  evaluated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qfl_mention ON quality_filter_logs(mention_id);
```

### 6.5 `analysis_runs`

Cada corrida del análisis end-to-end.

```sql
CREATE TABLE analysis_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id) NOT NULL,
  triggered_by          TEXT,                    -- scheduled | corpus_updated | manual_insights_manager
  triggered_by_user_id  UUID REFERENCES users(id),
  status                TEXT NOT NULL,           -- queued | running | quality_gates | requires_review | approved | published | failed
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  duration_seconds      INTEGER,
  pipeline_version      TEXT,

  -- Inputs snapshot
  corpus_snapshot_size  INTEGER,
  corpus_snapshot_hash  TEXT,

  -- Outputs
  findings_count        INTEGER,
  output_json           JSONB,                   -- el output completo de la corrida
  quality_gates_results JSONB,                   -- pass/fail por cada gate

  -- Aprobación humana
  reviewed_by_user_id   UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,
  approved_for_publication BOOLEAN DEFAULT FALSE,
  approved_at           TIMESTAMPTZ
);
CREATE INDEX idx_ar_corpus ON analysis_runs(brand_methodology_corpus_id);
```

---

## 7. Dashboard y outputs

### 7.1 `dashboard_blocks_catalog`

El banco de componentes visuales.

```sql
CREATE TABLE dashboard_blocks_catalog (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id              TEXT UNIQUE NOT NULL,    -- tb_matrix_4layers | hero_stats | etc.
  name                  TEXT NOT NULL,
  description           TEXT,
  category              TEXT,                    -- universal | tb_specific | vpm_specific | etc.
  methodologies_compatible TEXT[],              -- ['triggers-barriers'] o ['*']
  component_path        TEXT,                    -- ruta al componente React/Vue
  props_schema          JSONB,                   -- jsonschema de props aceptados
  preview_screenshot_url TEXT,
  status                TEXT NOT NULL,           -- active | deprecated | beta
  created_by_user_id    UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 7.2 `dashboards`

El dashboard publicado de un corpus.

```sql
CREATE TABLE dashboards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id) NOT NULL,
  current_analysis_run_id UUID REFERENCES analysis_runs(id),

  -- Configuración del dashboard
  layout_config         JSONB,                   -- qué bloques activos, qué orden, qué props
  scrollytelling_config JSONB,

  -- Estado
  status                TEXT NOT NULL,           -- draft | published | archived
  first_published_at    TIMESTAMPTZ,
  last_updated_at       TIMESTAMPTZ,

  -- Acceso del cliente
  client_url_slug       TEXT UNIQUE,            -- para URL pública con auth: noisia.studio/dashboard/<slug>

  UNIQUE (brand_methodology_corpus_id)
);
```

### 7.3 `dashboard_block_instances`

Instancias activas de bloques en un dashboard particular.

```sql
CREATE TABLE dashboard_block_instances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id          UUID REFERENCES dashboards(id) ON DELETE CASCADE,
  block_catalog_id      UUID REFERENCES dashboard_blocks_catalog(id),
  ordered_position      INTEGER NOT NULL,
  props_override        JSONB,                   -- overrides específicos para esta instancia
  visible               BOOLEAN DEFAULT TRUE,
  added_by_user_id      UUID REFERENCES users(id),
  added_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dbi_dashboard ON dashboard_block_instances(dashboard_id);
```

### 7.4 `dashboard_comments`

Comentarios del cliente.

```sql
CREATE TABLE dashboard_comments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id          UUID REFERENCES dashboards(id),
  block_instance_id     UUID REFERENCES dashboard_block_instances(id),  -- nullable: comment global
  finding_id            UUID REFERENCES findings(id),                    -- nullable: comment sobre un finding
  user_id               UUID REFERENCES users(id) NOT NULL,
  comment_text          TEXT NOT NULL,
  reaction              TEXT,                    -- like | important | addressed | concerned
  parent_comment_id     UUID REFERENCES dashboard_comments(id),  -- para threading
  status                TEXT,                    -- open | addressed | wont_address
  addressed_by_user_id  UUID REFERENCES users(id),
  addressed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dc_dashboard ON dashboard_comments(dashboard_id);
CREATE INDEX idx_dc_finding ON dashboard_comments(finding_id);
```

### 7.5 `dashboard_change_requests`

Cuando el cliente pide cambios formales.

```sql
CREATE TABLE dashboard_change_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id          UUID REFERENCES dashboards(id),
  requested_by_user_id  UUID REFERENCES users(id),
  related_finding_id    UUID REFERENCES findings(id),
  request_text          TEXT NOT NULL,
  request_type          TEXT,                    -- new_block | edit_finding | add_segment | other
  status                TEXT NOT NULL,           -- new | in_progress | completed | rejected
  assigned_to_user_id   UUID REFERENCES users(id),
  resolution_notes      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ
);
```

---

## 8. Memoria e inteligencia acumulada

### 8.1 `memory_industry`

Aprendizajes por industria. Cross-cliente.

```sql
CREATE TABLE memory_industry (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry              TEXT NOT NULL,           -- seguros | banca | cpg_bebidas | etc.
  industry_sub          TEXT,
  methodology_slug      TEXT,                    -- a veces el aprendizaje es methodology+industry
  memory_type           TEXT NOT NULL,           -- query_pattern | exclusion | tag_emergente_efectivo | failure_mode
  content               JSONB NOT NULL,          -- estructura varía por type
  evidence_count        INTEGER,                 -- en cuántos estudios se confirmó
  shareable             BOOLEAN DEFAULT TRUE,    -- false si vino de un cliente sensible
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_consulted_at     TIMESTAMPTZ
);
CREATE INDEX idx_mi_industry ON memory_industry(industry);
CREATE INDEX idx_mi_method ON memory_industry(methodology_slug);
```

### 8.2 `memory_brand`

Aprendizajes por marca específica.

```sql
CREATE TABLE memory_brand (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id              UUID REFERENCES brands(id) NOT NULL,
  memory_type           TEXT NOT NULL,           -- exclusion_brand_specific | context_form_data | historical_finding
  content               JSONB NOT NULL,
  source_corpus_id      UUID REFERENCES brand_methodology_corpora(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mb_brand ON memory_brand(brand_id);
```

### 8.3 `memory_methodology`

Aprendizajes operativos por metodología.

```sql
CREATE TABLE memory_methodology (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  methodology_slug      TEXT NOT NULL,
  memory_type           TEXT NOT NULL,           -- success_case | failure_mode_observed | prompt_refinement
  content               JSONB NOT NULL,
  evidence_count        INTEGER,
  active                BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 8.4 `memory_client`

Preferencias del cliente.

```sql
CREATE TABLE memory_client (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID REFERENCES organizations(id),
  user_id               UUID REFERENCES users(id),
  preference_type       TEXT NOT NULL,           -- language_style | notification_cadence | preferred_blocks | etc.
  content               JSONB NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 9. Evolución temporal y notificaciones

### 9.1 `signal_evolution`

Pulse mensual pre-calculado.

```sql
CREATE TABLE signal_evolution (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id) NOT NULL,
  finding_id            UUID REFERENCES findings(id) NOT NULL,
  month_key             CHAR(7) NOT NULL,
  mention_count         INTEGER,
  intensity_avg         NUMERIC(3,2),
  generated_by_analysis_run_id UUID REFERENCES analysis_runs(id),
  UNIQUE (finding_id, month_key)
);
CREATE INDEX idx_se_corpus_month ON signal_evolution(brand_methodology_corpus_id, month_key);
```

### 9.2 `pattern_alerts`

Anomalías detectadas que disparan notificaciones.

```sql
CREATE TABLE pattern_alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_methodology_corpus_id UUID REFERENCES brand_methodology_corpora(id),
  finding_id            UUID REFERENCES findings(id),
  alert_type            TEXT NOT NULL,           -- spike | new_emergent | sentiment_shift | competitor_movement
  severity              TEXT NOT NULL,           -- info | warning | critical
  description           TEXT,
  evidence_mention_ids  UUID[],
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ai_summary            TEXT,                    -- texto humanizado para WhatsApp
  reviewed_by_user_id   UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  pushed_to_whatsapp_at TIMESTAMPTZ
);
```

### 9.3 `whatsapp_notifications_log`

```sql
CREATE TABLE whatsapp_notifications_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_alert_id      UUID REFERENCES pattern_alerts(id),
  recipient_user_id     UUID REFERENCES users(id),
  whatsapp_number       TEXT,
  message_text          TEXT,
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_status       TEXT,                    -- sent | delivered | read | failed
  client_clicked_link   BOOLEAN DEFAULT FALSE,
  click_at              TIMESTAMPTZ
);
```

---

## 10. Mapeo SentiOne/Datashake → schema

Ver `noisia_mentions_schema.md` original (sección 6) para mapeo campo por campo. Lo aquí presentado es la versión refinada del schema, pero el mapeo desde fuentes externas no cambia.

---

## 11. Queries operativas típicas

```sql
-- 1. Dashboard del cliente: cargar findings actuales de su brand+methodology
SELECT f.id, f.commercial_name, f.one_liner, f.polarity, f.layer,
       f.metrics, f.cultural_reading, f.brand_implications
FROM findings f
JOIN brand_methodology_corpora bmc ON bmc.id = f.brand_methodology_corpus_id
WHERE bmc.brand_id = $1
  AND bmc.methodology_id = $2
  AND f.status = 'published'
ORDER BY (f.metrics->>'score_compuesto')::numeric DESC;

-- 2. Evidence list para un finding (las top 8 citas curadas)
SELECT eq.ordered_position, eq.is_lead_quote,
       m.text_clean, m.platform, m.published_at, m.url, m.mx_leaning,
       m.author_handle
FROM evidence_quotes eq
JOIN mentions m ON m.id = eq.mention_id
WHERE eq.finding_id = $1
ORDER BY eq.ordered_position;

-- 3. Volumen mensual por finding (chart de evolución)
SELECT month_key, mention_count, intensity_avg
FROM signal_evolution
WHERE finding_id = $1
ORDER BY month_key;

-- 4. Top brands mencionadas en un corpus
SELECT bs.canonical_name, count(*) as freq
FROM mention_brands mb
JOIN brand_seeds bs ON bs.id = mb.brand_id
JOIN mentions m ON m.id = mb.mention_id
WHERE m.brand_methodology_corpus_id = $1
GROUP BY bs.canonical_name
ORDER BY freq DESC LIMIT 20;

-- 5. Quality audit: por qué tantos excluidos
SELECT exclusion_reason, count(*) as count
FROM mentions
WHERE brand_methodology_corpus_id = $1 AND inclusion_status = 'excluded'
GROUP BY exclusion_reason
ORDER BY count DESC;

-- 6. Memory query: ¿hay aprendizajes de industria seguros para T&B?
SELECT memory_type, content
FROM memory_industry
WHERE industry = 'seguros'
  AND methodology_slug = 'triggers-barriers'
  AND shareable = true
ORDER BY evidence_count DESC LIMIT 20;

-- 7. Cliente comments abiertos que necesitan respuesta
SELECT dc.id, dc.comment_text, u.full_name, dc.created_at,
       f.commercial_name as finding_name
FROM dashboard_comments dc
JOIN users u ON u.id = dc.user_id
LEFT JOIN findings f ON f.id = dc.finding_id
WHERE dc.dashboard_id = $1
  AND dc.status = 'open'
  AND u.user_type != 'noisia_internal'
ORDER BY dc.created_at DESC;

-- 8. KAM dashboard: estado de todos los corpora de sus organizaciones
SELECT b.name as brand,
       m.name as methodology,
       bmc.status,
       COUNT(f.id) as findings_count,
       MAX(ar.completed_at) as last_run
FROM brand_methodology_corpora bmc
JOIN brands b ON b.id = bmc.brand_id
JOIN methodologies m ON m.id = bmc.methodology_id
JOIN organizations o ON o.id = b.organization_id
LEFT JOIN findings f ON f.brand_methodology_corpus_id = bmc.id
LEFT JOIN analysis_runs ar ON ar.brand_methodology_corpus_id = bmc.id
WHERE o.account_owner_kam_id = $1
GROUP BY b.name, m.name, bmc.status;
```

---

## 12. Roadmap de implementación del schema

### Fase 1 — Core MVP (semanas 1-3)

Tablas mínimas para arrancar:

- organizations, brands, users, user_brand_access
- methodologies, brand_methodology_corpora
- mentions (con particionado), authors, brand_seeds
- import_batches

### Fase 2 — Pipeline y análisis (semanas 4-6)

- query_iterations, integrations
- mention_codings, findings
- quality_filter_logs, analysis_runs

### Fase 3 — Curación y outputs (semanas 7-9)

- evidence_quotes
- dashboard_blocks_catalog, dashboards, dashboard_block_instances
- dashboard_comments, dashboard_change_requests

### Fase 4 — Memoria evolutiva (semanas 10-12)

- memory_industry, memory_brand, memory_methodology, memory_client
- signal_evolution, pattern_alerts, whatsapp_notifications_log

### Fase 5 — Optimización y particionado (semana 13+)

- Particionar mentions por brand_methodology_corpus_id
- Índices adicionales según queries reales
- Vista materializada para signal_evolution
- Backup strategy con point-in-time recovery

---

## 13. Stack tecnológico recomendado

```yaml
database:
  primary: PostgreSQL 15+
  managed_option: Supabase (incluye RLS para acceso multi-tenant)
  search_extension: pg_trgm + tsvector nativo
  if_scale_exceeds_50M_rows: considerar OpenSearch para FTS

pipeline:
  language: Python 3.11+
  orchestration: Prefect o Airflow
  llm_calls: Anthropic Claude (primary) + OpenAI (fallback)

api:
  framework: FastAPI o Hono
  auth: Clerk o Auth0
  realtime: Supabase Realtime para comentarios en vivo

frontend:
  framework: Next.js 14+ (App Router)
  ui: Tailwind + shadcn/ui base + componentes Noisia custom
  charts: Tremor, Recharts, o D3 custom para visualizaciones signature
  scrollytelling: Framer Motion + scroll triggers
  pdf_export: react-pdf o weasyprint server-side

infra:
  hosting: Vercel (frontend) + Railway/Fly.io (backend)
  storage: Supabase Storage para archivos grandes
  whatsapp: Twilio o Meta Business API directo

monitoring:
  errors: Sentry
  analytics: PostHog (self-hosted preferible para data sensitiva)
  uptime: Better Uptime o similar
```

---

## 14. Migración de datos existentes

Lo que ya hay generado en mayo 2026:

- 4 estudios completados (Foresight 2026, FIH, Mexican Home, Foundation Snapshots).
- Corpus de SentiOne en CSV, JSONs de Datashake, queries de SentiOne.
- JSONs maestros de cada handoff.

Plan de migración:

1. Cargar los corpus históricos como `brand_methodology_corpora` retroactivos, marca `historical = true`.
2. Importar las mentions con `source_system='sentione_historical'` o equivalente.
3. Convertir los findings de cada estudio a registros en `findings`.
4. Mapear las citas curadas a `evidence_quotes`.
5. Esto da a Noisia un baseline de aprendizaje para `memory_industry` y `memory_methodology` desde el día 1.

Estimación: 1-2 semanas con un Insights Manager dedicado y un dev de pipeline.

---

## 15. Compliance y privacidad

### 15.1 Datos personales

`authors` guarda handle, display_name, follower_count, profile_url. En México aplica LFPDPPP. Decisiones:

- **Política de retención:** 24 meses default. Configurable por organización si necesitan más corto.
- **Takedown requests:** UI para borrar todos los registros asociados a un author_external_id (mention + author).
- **Anonimización:** opción de anonimizar todas las authors antes de compartir memoria entre estudios.

### 15.2 NDAs con cliente

Cada `brand_methodology_corpora` puede tener flag `nda_strict = true`. Cuando está activo:

- Memoria de esa marca no se comparte cross-cliente.
- Findings no alimentan `memory_industry` shareable.
- Backups con encriptación específica de tenant.

---

## 16. Data OS Cut 1 - esquema vivo por cliente

Data OS es una extensión aditiva del schema actual. No borra `published_outputs.payload`
ni reemplaza las tablas live de Signal Pulse; las gobierna como una base viva por
cliente, marca/tema y corpus. La migración canónica es
`infrastructure/db/migrations/0035_data_os_foundation.sql`; la especificación completa
vive en `22_NOISIA_DATA_OS_CUT_1.md`.

### 16.1 Data Catalog

Registra fuentes, assets, contratos, calidad y lineage. Es el punto donde un CSV,
conector, upload o materialización deja de ser "archivo usado por Claude" y se vuelve
dataset auditable.

Tablas:

- `data_assets`
- `data_asset_fields`
- `data_observations`
- `data_contracts`
- `data_quality_rules`
- `data_quality_results`
- `lineage_edges`

Relaciones principales:

- `data_sources` y `source_sync_runs` siguen describiendo la fuente operacional y sus
  ejecuciones.
- `data_assets` describe datasets lógicos o físicos por `organization_id`, `brand_id`,
  `theme_id`, `study_corpus_id` y `data_source_id`.
- `data_asset_fields` describe campos críticos por asset: tipo físico, semantic type,
  nulabilidad, ejemplos y metadata de catálogo.
- `data_observations` es la tabla fact canónica para uploads y fuentes
  estructuradas. Guarda observaciones normalizadas por `study_corpus_id`,
  `data_source_id`, `data_asset_id`, `dataset_key`, `period_start`,
  `period_grain`, `entity_*`, `metric_key`, `metric_value`, `dimensions`,
  `raw_record` y `lineage`. Esta es la unión que permite cruzar
  `mentions_monthly` contra `sales_monthly` en Signal sin convertir archivos en
  texto muerto.
- La prioridad de fuentes para Data OS no es "ventas únicamente": ventas ecomm y
  catálogo de producto son la primera ancla de negocio, pero el mismo contrato
  materializa GA4/web analytics, search demand, customer service, Meta organic,
  paid media, CRM/email/SMS/WhatsApp, reviews & ratings, pricing/promos/stock e
  inteligencia competitiva. Todas esas fuentes deben llegar como observaciones
  con periodo, entidad, métrica, dimensión, `raw_record` y lineage para que
  Signal pueda cruzar negocio, demanda, conversación y fricción operativa.
- Familias iniciales de métricas normalizadas: `sales`, `units`, `orders`,
  `average_order_value`, `discount`, `returns`, `margin`, `mentions`,
  `sentiment`, `sessions`, `product_views`, `add_to_cart`, `checkout`,
  `conversion_rate`, `search_volume`, `search_position`, `support_tickets`,
  `spend`, `impressions`, `clicks`, `likes`, `comments`, `shares`, `saves`,
  `engagement`, `conversions`, `email_opens`, `unsubscribes`, `reviews`,
  `score`, `price`, `stock`, `share_of_voice` y `share_of_search`.
- `data_quality_results` se liga a `data_assets` y permite bloquear live serving si hay
  resultados `failed`.
- `lineage_edges` registra cómo un source/sync/import/knowledge asset alimenta
  datasets, cómo esos datasets alimentan materializaciones, y cómo las
  `dashboard_data_refs` alimentan `published_outputs`.

### 16.2 Brand OS Catalog

Convierte Brand OS de texto contextual a catálogo consultable. Cut 1 debe guardar al
menos perfil, objetivos, audiencias y seeds; productos, claims, campañas, competidores
y eventos quedan listos para el siguiente corte.

Tablas:

- `brand_os_profiles`
- `brand_os_objectives`
- `brand_os_briefs`
- `brand_os_audiences`
- `brand_os_products`
- `brand_os_claims`
- `brand_os_campaigns`
- `brand_os_competitors`
- `brand_os_events`
- `brand_os_seed_sets`
- `brand_os_seed_terms`
- `brand_os_links`

Regla: un brief, objetivo, audiencia o seed importante no debe vivir solo dentro de
`study_corpora.context_form`, `analysis_plan` o un prompt. Debe poder ligarse a corpus,
fuentes, knowledge, entidades, taxonomías y outputs. `brand_os_briefs` guarda el intake
del estudio y los briefs subidos como `brand_knowledge_sources` para poder analizar
después qué tipo de brief produjo qué queries, ruido, tags, assertions y outputs.

### 16.3 Knowledge Catalog

Separa documento, chunk, assertion y uso. La Knowledge Base deja de ser solo contexto
para el LLM y se vuelve memoria citada, versionable y reusable.

Tablas:

- `knowledge_chunks`
- `knowledge_assertions`
- `knowledge_assertion_links`
- `knowledge_assertion_review_events`
- `knowledge_usage_events`

Relaciones principales:

- `brand_knowledge_sources` sigue siendo el documento/upload fuente.
- `knowledge_chunks` guarda unidades recuperables.
- `knowledge_assertions` guarda claims estructurados con confidence y vigencia.
- `knowledge_assertion_links` conecta assertions con Brand OS, entidades, taxonomías o
  records analíticos.
- `knowledge_assertion_review_events` registra aprobaciones, rechazos o solicitudes de
  nueva revisión humana sobre assertions antes de activación cliente-visible.
- `knowledge_usage_events` registra cuándo un chunk/assertion fue usado por un run,
  output o serving flow.

### 16.4 Taxonomy, Entity y Feature Store

No se agregan columnas infinitas a `mentions`. Las dimensiones como triggers,
barriers, journey, value perception, audiencias, demográficos, emotion, lifecycle y
marketing moves viven en vocabularios controlados y tags versionados.

Tablas:

- `taxonomies`
- `taxonomy_terms`
- `taxonomy_term_edges`
- `methodology_taxonomy_bindings`
- `tagging_rule_sets`
- `tagging_model_versions`
- `intelligence_entities`
- `entity_aliases`
- `entity_links`
- `record_entity_links`
- `record_tags`
- `record_feature_values`
- `tag_review_events`

Reglas:

- `record_tags.subject_type` permite etiquetar `mention`, `performance_record`,
  `knowledge_chunk`, `canonical_signal`, `signal_observation` u otros records.
- `tagging_rule_sets` versiona los diccionarios/reglas determinísticas o asistidas por
  modelo que producen tags. En Cut 1 existe `data_os_cut_1_deterministic_mentions`
  v1 y debe estar ligado desde `tagging_model_versions.tagging_rule_set_id`.
- Cada tag guarda `taxonomy_term_id`, `value`, `score`, `confidence`, `evidence`,
  `source`, `model_version_id` y `review_status`.
- Cut 1 escribe tags determinísticos de mención para `trigger`, `barrier`,
  `journey_stage`, `value_perception`, `audience`, `emotion`, `sentiment_polarity`,
  `source_type` y `content_format`; esos tags nacen `unreviewed` y con evidencia de
  keyword/regla. No dependen de LLM.
- `record_feature_values` guarda contexto operacional por mención, incluyendo fuente,
  formato, plataforma, inclusion status, scores y resumen de tags.
- `intelligence_entities` resuelve entidades de marketing e inteligencia, no identidad
  personal de consumidor final en Cut 1.

### 16.5 Semantic Layer y Dashboard Refs

El dashboard no debe inventar métricas ni depender solamente del JSON publicado. Lee
métricas y refs gobernadas, manteniendo fallback al snapshot publicado durante shadow
mode.

Tablas:

- `metric_definitions`
- `semantic_models`
- `metric_materializations`
- `dashboard_data_refs`
- `tb_strategic_opportunities`
- `tb_opportunity_findings`
- `tb_action_studio`
- `tb_action_findings`
- `analysis_artifacts`
- `analysis_evidence_groups`
- `analysis_evidence_links`
- `analysis_artifact_relations`
- `analysis_artifact_review_events`
- `published_output_artifacts`

Reglas:

- `metric_definitions` define cálculo, grain, unidad y dimensiones.
- `semantic_models` define entidades, dimensiones y medidas.
- `metric_materializations` guarda agregados listos para serving.
- `dashboard_data_refs` conecta un output publicado con datasets vivos como `sources`,
  `metrics`, `corpus` y `chart_aggregates`.
- Cada `dashboard_data_ref.source_id` debe apuntar al `data_asset` que sirve esa
  sección para que el dashboard tenga lineage auditable.
- Las oportunidades estrategicas no son aliases de `tb_recommendations`:
  `tb_strategic_opportunities` conserva decision, nivel, confidence y orden;
  `tb_opportunity_findings` conserva su evidencia por finding.
- Action Studio vive en `tb_action_studio` y `tb_action_findings`, separado del
  playbook operacional. Step 6 reemplaza ambas colecciones dentro de la misma
  transaccion que actualiza la sintesis.
- Review y Signal consultan estas mismas entidades. Review puede aprobarlas solo
  cuando cada entidad tiene evidencia dentro del snapshot; Signal consume la version
  aprobada y no recalcula oportunidades o acciones.
- Un `published_output` con contrato `signal-serving-v2` es una revision inmutable.
  Para cambiar contenido se crea una nueva revision del analisis; el backfill
  controlado solo puede agregar refs/manifiesto preservando payload, status, version y
  `published_at`.
- `analysis_artifacts` registra unidades direccionables y tipadas sin reemplazar las
  tablas de dominio. Su `content` flexible pertenece a una fila/version concreta; no es
  un payload monolitico de reporte.
- `analysis_evidence_groups` y `analysis_evidence_links` separan evidencia protagonista,
  de soporte, contraria, contextual, denominador y limitaciones. Un link apunta a una
  fuente gobernada por `source_type` + `source_id`.
- `analysis_artifact_relations` conecta oportunidades, acciones, insights, señales
  futuras, lectura de mercado y deep dives con los findings que los soportan.
- Los assets estructurados disponibles para Claude se conectan al artefacto
  `analysis_context` con `claim_specific=false`. No se ligan a un finding concreto hasta
  que el pipeline devuelva una referencia explicita a `data_observation` o
  `data_asset_record`.
- `analysis_artifact_review_events` conserva decisiones editoriales y
  `published_output_artifacts` congela el `artifact_revision` exacto consumido por
  Signal. Solo estados `accepted`, `corrected` o `limited` son publicables.

### 16.6 Serving y rollout

Las APIs internas de Cut 1 viven bajo `/api/data-os/*` y requieren flags:

- `NOISIA_DATA_OS_ENABLED=true`
- `NOISIA_DATA_OS_SERVING_ENABLED=true`
- `NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=true` para rutas `/pulse/*`
- `NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false` durante el primer shadow rollout
- `NOISIA_DATA_OS_SHADOW_MODE=true` durante el rollout

Rutas por corpus incluyen fuentes, health, Data Catalog, lineage, taxonomías, tags,
Brand OS y Knowledge Catalog. Data Catalog expone assets/fields/contracts/quality;
lineage expone edges filtrables por tipo de nodo o relación. Brand OS y Knowledge deben
poder alimentar UI/engine como datos estructurados; Knowledge no expone `raw_text`
completo por default.

Si las flags están apagadas, las rutas responden con fallback explícito a
`published_outputs.payload`. La publicación legacy sigue siendo el rollback lógico.

Compuertas operativas:

- `corepack pnpm data-os:verify`
- `corepack pnpm data-os:candidates`
- `corepack pnpm data-os:shadow-run`
- `corepack pnpm data-os:serving-smoke`
- `corepack pnpm data-os:evidence`
- `corepack pnpm data-os:release-gate` para producción/cliente-visible, con
  `database_format_postgres_url`

No activar live API para clientes hasta que `data-os:shadow-run`,
`data-os:serving-smoke`, `data-os:evidence` y `data-os:release-gate` estén verdes
contra un corpus/output real de staging o prod-shadow.
El render live de Signal Pulse requiere un segundo switch interno explícito con
`NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=true`; el primer corte productivo debe dejarlo
apagado y conservar fallback a `published_outputs.payload`.

### 16.7 Engine validation lineage

La validación del Engine se divide en dos familias de evidencia:

- `query_validation_runs`, `query_validation_attempts` y
  `query_validation_mentions` guardan la prueba pre-extracción de cada query pack en
  SentiOne.
- `corpus_assessments` y `corpus_assessment_mentions` guardan la certificación del
  corpus importado.
- `study_corpora.corpus_revision` cambia con cada mutación de menciones y
  `latest_assessed_revision` identifica la revisión certificada.

Un score de query no puede actualizar `latest_assessed_revision`; una evaluación de
corpus no puede cerrar queries. Ver `28_CORPUS_ENGINE_VALIDATION_CONTRACT.md`.

### 16.8 Signal workspace, refresh y métricas vivas

Signal usa una identidad estable y stores relacionales gobernados; `outputId` queda
como mapping transitorio y no como identidad del dashboard vivo.

Tablas nuevas:

- `signal_workspaces`: workspace único por organización y slug, con exactamente un
  subject entre `brand_id` y `theme_id`, timezone, status y metadata.
- `signal_workspace_corpora`: relación temporal con corpora `operational`,
  `strategic` o `legacy`; sólo una relación activa por corpus/rol y workspace.
- `signal_refresh_policies`: cadence, timezone, owner y siguiente ejecución; nace
  deshabilitada.
- `signal_data_watermarks`: revisión de corpus, import/sync aceptado, máxima fecha
  observada, materialización y freshness por workspace/corpus/source.
- `signal_refresh_runs`: intentos idempotentes, locks, errores seguros y estados de
  retry/dead-letter.
- `signal_data_invalidations`: invalidación selectiva por workspace, corpus, source,
  revisión y rango afectado.
- `signal_interpretation_freshness`: estado separado para interpretaciones futuras;
  SB-02–SB-06 no ejecutan Claude.

El catálogo V1 reutiliza `metric_definitions` y `semantic_models`; no existe un
catálogo paralelo. La migración `0049_signal_metric_catalog_v1` agrega versión,
formula hash, denominator, dimensions, null semantics, comparability, quality rules,
drill-down subject y visibility. Un cambio de fórmula requiere una nueva versión.

`metric_materializations`, extendida por
`0050_signal_metric_materializations_v1`, persiste workspace/corpus, definition y
versión, periodo, filtro canónico, `filters_hash`, payload tipado, value, denominator,
sample size, quality/materialization state, watermark, timestamps y cache scope. Sus
índices cubren series por workspace/hash/grain, freshness, periodos por corpus y
expiración ad hoc. Los faltantes permanecen `NULL`/`not_available`; nunca se convierten
en cero.

Las APIs `/api/data-os/signal/:workspaceId/*` leen estas tablas y `mentions` bajo el
mismo predicate de `SignalFilterV1`. No leen `published_outputs.payload` como source of
truth. Las rutas Pulse y `/signal/{outputId}` conservan su comportamiento legacy.

#### Hardening de Conversation Following

La migración `0051_signal_backend_foundation_hardening` agrega tres invariantes:

- `signal_refresh_runs` funciona como outbox durable. La corrida programada existe en
  Postgres antes de BullMQ y puede reconciliarse si Redis o un deploy interrumpen el
  enqueue; la policy avanza sólo después de confirmación de cola.
- `signal_data_watermarks.stale_after` deriva de `cadence`, timezone,
  `expected_next_run` y tolerancia explícita. Manual no recibe TTL automático; hourly,
  daily, weekly y monthly tienen tolerancias distintas. Source, data y
  materialization freshness no se colapsan.
- el índice parcial `uq_signal_workspace_corpora_one_operational` permite como máximo
  un corpus `operational` activo por workspace. La migración cierra duplicados de forma
  determinística antes de crear el índice.

Las métricas gobernadas por taxonomías sólo consideran `record_tags.review_status =
'approved'`. Tags pendientes o no revisados no son evidencia aceptada: producen estado
`partial` y una razón de calidad. `conversation.velocity` conserva el bucket precedente
real y su invalidación incluye el siguiente bucket dependiente.

---

## Cierre

Este schema es la base operativa. Cualquier feature nueva (multi-país, nueva metodología, integración nueva) debe poder mapearse a estas tablas o documentar por qué necesita extensión.
