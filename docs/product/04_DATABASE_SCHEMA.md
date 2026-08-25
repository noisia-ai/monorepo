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
- `tb_finding_structured_evidence_refs`

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
- `tb_finding_structured_evidence_refs` conserva la referencia exacta del finding a
  una `data_observation` o `data_asset_record` aceptada. Un trigger rechaza evidencia
  inexistente, cross-corpus o no aceptada para `claim_specific`.
- Las acciones `correct` y `limit` crean una nueva fila de `analysis_artifacts` con
  `revision + 1` y `supersedes_artifact_id`; nunca reescriben la revisión publicada.
  El trigger `protect_published_analysis_artifact_revision` bloquea también bypasses
  directos de `UPDATE`/`DELETE`.

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
  SB-02–SB-06 no ejecutan Claude; SB-07 lo liga a scope y watermark exactos.
- `metric_interpretation_runs`: outbox/attempt versionado con packet canónico, filter,
  watermark, prompt/model, budget, costo, timeout, retry y fallback seguro.
- `metric_interpretations`: revisión inmutable de facts, hypotheses, causal claims y
  recommendations por workspace/metric group/filter/watermark.
- `metric_interpretation_evidence`: referencias exactas de cada claim y número a
  `metric_materializations`.
- `tb_temporal_metrics`: métricas T&B snapshot-bound por finding y grain
  default/plataforma/entidad, con denominador, sample y quality.
- `tb_finding_temporal_comparisons`: movilidad determinística entre corridas
  compatibles y sus deltas/reasons.
- `signal_workspace_releases`: revisiones estratégicas ligadas al workspace y a una
  corrida T&B aprobada.
- `signal_workspace_release_artifacts`: revisiones exactas del artifact graph incluidas
  en cada release.
- `signal_workspace_current_releases`: puntero mutable a un histórico publicado
  inmutable; sólo cambia mediante promoción humana.
- `signal_taxonomy_profiles`: selecciona una taxonomía, ruleset, model version y
  `context_hash` versionados por workspace y kind. Un índice parcial permite como
  máximo un perfil `active` de `topic` y uno de `narrative`; activar exige reviewer y
  timestamp humanos.

La migración forward-only `0057_signal_topics_narratives_profiles` extiende los stores
canónicos existentes. `record_tags.signal_taxonomy_profile_id` hace idempotente la
asignación `mention + profile + term + model_version`; un trigger rechaza términos,
modelos o menciones fuera del scope del perfil. `signal_refresh_runs` incorpora
`run_type=taxonomy_enrichment`, profile/model/revision, heartbeat y costo, por lo que
el enrichment reutiliza el outbox durable con retries y dead-letter. No existen tablas
paralelas de topics, narratives o runs.

La migración `0056_signal_workspace_auto_membership` aplica la identidad de producto:
cada `study_corpus` nuevo resuelve o crea el único workspace de su marca/tema y queda
vinculado automáticamente. El nombre del corpus es el título de navegación; T&B entra
como `strategic`, el primer Signal Pulse como `operational` y el resto como `legacy`.

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

`topic.volume@1` y `narrative.volume@1` usan `included_mentions` como denominador de
share y `classified_mentions` para el share de cobertura; el count conserva como
`value` las mentions distintas aprobadas. `record_feature_values` registra que una
mención fue procesada aun si no recibió término. Esto permite cero observado en
ventanas pequeñas sin confundirlo con ausencia de clasificación. Pending/rejected no
entran a buckets client-safe.

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

#### Interpretaciones versionadas SB-07

La migración `0052_signal_metric_interpretations_v1` mantiene las interpretaciones
separadas de `analysis_artifacts`: no cambia ni debilita su regla de ownership. El
packet persistido contiene únicamente materializaciones canónicas SB-05; su hash,
`filters_hash`, `data_watermark_hash`, prompt y model forman la identidad idempotente.
La evidencia referencia por FK la materialización y, cuando existe una cita numérica,
el campo y valor exactos. La invalidación de SB-03 marca freshness e interpretación
stale sin borrar history. Los switches LLM nacen apagados y el budget cap en cero.

#### Evidencia estructurada y Review SB-08

La migración `0053_tb_structured_evidence_review` conecta cada finding con tokens
gobernados `observation:<uuid>` o `record:<uuid>`. El artifact graph los proyecta como
links `supports` claim-specific y conserva locator hasta archivo (`storage_ref`), asset,
data source, source sync/import y observation/record. Los assets presentes solo como
contexto continúan marcados `claim_specific=false`.

Readiness reporta artifacts resueltos/pendientes, cantidad de refs exactas y cobertura
de findings con evidencia estructurada. La cobertura incompleta es explícita y no se
convierte en evidencia por inferencia.

#### Temporalidad y releases estratégicos SB-09

La migración `0054_tb_temporal_strategic_releases` congela scope y versiones en
`tb_analyses`, materializa métricas desde el snapshot exacto y registra compatibilidad
antes de calcular movilidad. El denominator de share se calcula dentro del mismo grain
filtrado. Triggers protegen scope, findings, métricas, comparaciones, releases y
artefactos publicados. El current release es un puntero separado validado contra un
release publicado del mismo workspace; ingesta operational posterior no reescribe
history estratégica.

#### Gate front-ready SB-10

SB-10 no agrega un store paralelo. La migración
`0055_signal_v2_front_ready_indexes` añade únicamente índices para los access paths
congelados:

- `idx_metric_materializations_signal_facade`: workspace + corpus + `filters_hash` +
  metric/version + `computed_at`, usado por home, metric groups, series y lineage;
- `idx_mentions_signal_facets`: corpus + plataforma resuelta + fecha + ID sobre
  menciones incluidas, usado por facets y drill-down;
- `idx_record_tags_signal_approved_subject`: subject + term sobre tags `approved`,
  usado por topic/emotion/narrative gobernados.

`SignalWorkspaceHomeV1` compone estas tablas con watermarks, interpretaciones y
releases; no persiste un JSON de dashboard. El backfill dirigido crea relaciones,
watermark/invalidation y materializaciones de forma idempotente, pero sólo compara el
digest de `published_outputs.payload` para demostrar que quedó intacto.

### 16.9 Workspace-owned data plane (migración 0059)

`0059_signal_workspace_owned_data_plane.sql` cambia la autoridad sin borrar el
contrato heredado:

- `data_sources`, `import_batches`, `mentions` y `source_sync_runs` reciben
  `workspace_id`. En fuentes/imports/mentions nuevos es obligatorio; el backfill
  falla cerrado si un registro existente no se puede resolver a un workspace.
- `mentions.study_corpus_id` e `import_batches.study_corpus_id` se conservan como
  compatibilidad/provenance opcional. `contributed_by_study_corpus_id` hace explícita
  la contribución del estudio sin transferir ownership.
- `canonical_mention_id` conserva aliases históricos sin borrar evidencia;
  `uq_mentions_workspace_text_canonical` y
  `uq_mentions_workspace_provider_canonical` impiden una segunda mención canónica
  por workspace.
- Enrichment histórico no se reescribe destructivamente. Los readers de Topics &
  Narratives resuelven `record_tags.subject_id` mediante la
  `canonical_mention_id` de la fila etiquetada, de modo que un assignment aprobado
  ligado a un alias sigue perteneciendo a la raíz canónica y su evidencia navega al
  ID estable.
- `data_sources` fija `governed_scope`, entidad, policy version y aprobación. El
  import nunca redefine ese contrato por query param.
- `signal_mention_attributions` separa scope y entidad con la taxonomía cerrada
  `primary_brand | competitor | category | reference | unattributed`, confianza,
  versión de policy/model y provenance de aprobación. Cada fila conserva también
  `data_source_id` e `import_batch_id`, de modo que una reaparición deduplicada no
  pierde la nueva fuente, scope ni provenance.
- `signal_mention_import_memberships` conecta cada import con la raíz canónica,
  incluso cuando el registro fue deduplicado. `signal_mention_study_memberships`
  expresa contribución/selección/análisis;
  `signal_population_definitions`, `signal_workspace_population_pointers` y
  `signal_population_memberships` expresan la población gobernada sin guardar un
  payload de serving.
- Un puntero sólo puede referenciar una definición `active`. Retirar directamente la
  definición current falla con `23514`; `promote_signal_workspace_population`
  bloquea puntero y definiciones, desactiva memberships anteriores, retira la versión
  previa, activa la siguiente, mueve el puntero y reconcilia la nueva membership en
  una sola transacción.
- `corpus_snapshots` conserva su membership relacional de IDs y agrega workspace,
  población/version/hash, periodo y captura de watermark.
  `signal_snapshot_watermarks` congela cada fuente/import/sync por referencia.
- `signal_workspace_reports` fija la identidad `(workspace_id, report_key)` y
  `signal_workspace_report_current_releases` promueve una revisión inmutable. El
  puntero legacy se conserva durante dual-read.

La población operacional inicial acepta únicamente menciones canónicas `included`
con atribución `primary_brand` aprobada. Los triggers de mention, attribution, source
y population pointer vuelven a ejecutar la reconciliación cuando cambian inclusión,
scope, review status, policy o periodo. Competencia, categoría, referencia,
unattributed, pending, rejected y excluded se conservan en el workspace para
QA/lineage, pero no entran silenciosamente al denominador primario.

El scope de una fuente falla cerrado: una fuente gobernada no puede transicionar de
scope explícito a `NULL`. Cambiar su `scope_review_status` a `pending` o `rejected`
propaga el estado a todas sus attributions gobernadas, elimina approval provenance y
reconcilia de inmediato la población. Fuentes legacy que nacieron sin scope se
conservan sólo para compatibilidad y no generan attributions elegibles nuevas.

### 16.10 Operational serving por población (migración 0060)

`0060_signal_operational_population_serving.sql` completa de forma aditiva la identidad
del serving operacional sin reinterpretar `study_corpus_id`:

- `metric_materializations` admite exactamente uno de dos scopes: corpus legacy o
  población gobernada. Para población persiste `population_id`, versión y
  `population_definition_hash`; un trigger verifica que los tres pertenezcan al mismo
  workspace.
- `signal_data_invalidations` admite `population_id` como scope exclusivo y valida
  workspace y watermark. Una aceptación nueva y un cambio del current pointer
  invalidan las materializaciones de la población afectada sin tocar snapshots ni
  releases estratégicos.
- `signal_operational_serving_shadow_results` guarda sólo resúmenes compactos por
  módulo, hashes, estado, conteos de violaciones/diferencias y breakdown legacy por
  scope. No guarda menciones, poblaciones ni payloads de dashboard.
- Los índices de serving cubren workspace, population/version, filter hash, métrica,
  periodo y el lookup de invalidaciones. Las filas corpus-scoped anteriores siguen
  siendo válidas y legibles para rollback.

La identidad de una materialización gobernada incluye población, versión y definition
hash. El hash del watermark representa cambios de datos aceptados, no la hora de una
recomputación idéntica: actualizar sólo `materialized_at` no crea una identidad de data
falsa. La re-aplicación de 0060 es idempotente y no contiene `DELETE`, `DROP COLUMN` ni
modificación de migraciones anteriores.

### 16.11 Invalidación de membership y outbox shadow (migración 0061)

`0061_signal_operational_membership_invalidation_shadow_outbox.sql` cierra dos
riesgos del serving population-scoped sin alterar filas legacy:

- Un trigger observa únicamente cambios reales de elegibilidad en
  `signal_population_memberships`: insert incluido, `included→excluded`,
  `excluded→included` y eliminación de una membership incluida. La misma transacción
  marca stale todas las materializaciones de esa población y, cuando ya existe un
  watermark aceptado, inserta una `signal_data_invalidations` durable con mención,
  versión/hash de población, fecha afectada y estado anterior/nuevo.
- Cambios masivos dentro de una misma transacción se compactan en una invalidación por
  población, ampliando la ventana y acumulando contadores 1→0/0→1/delete. La promoción
  de pointer no duplica eventos por membership porque 0060 ya invalida ambos scopes.
- Cambios de reason que no alteran elegibilidad no emiten invalidaciones falsas. Las
  materializaciones corpus-scoped y los snapshots/releases estratégicos no se tocan.
- `signal_operational_shadow_requests` es un outbox PostgreSQL compacto. Persiste
  módulo, filtro normalizado, population identity y parámetros de consulta; nunca
  texto de menciones ni payloads de dashboard. Su dedupe horario evita repetir la
  misma comparación en cada request y los estados `pending/processing/failed` permiten
  recuperar un lease abandonado.
- Índices parciales cubren recuperación del outbox y consulta por workspace/módulo.
  Triggers impiden population o corpus legacy cross-workspace.

El reader de materializaciones rechaza la colección completa si cualquiera de sus
filas está stale o venció `stale_after`, y cae al mismo SQL live gobernado. Por eso una
revisión de attribution no puede devolver el denominador cacheado anterior durante la
ventana entre invalidación y rematerialización.

### 16.12 Consumo estratégico workspace-owned (migración 0062)

`0062_signal_strategic_consumption.sql` conserva las tablas y etapas del Engine T&B,
pero separa la identidad de producto de su corpus de ejecución compatible:

- `signal_population_definitions` persiste para `purpose='analysis'` la policy,
  versión, timezone, periodo, definition hash, digest relacional de memberships e
  idempotency key. La policy local de esta fase acepta únicamente `primary_brand`;
  scopes de exploración sin policy server-owned aprobada fallan cerrado.
- `corpus_snapshots(kind='analysis')` congela `workspace_id`, población/version/hash,
  periodo, timezone, digest de IDs, digest de watermarks, `scope_frozen_at` e
  idempotency key. La membership continúa en `corpus_snapshot_mentions` y los
  watermarks en `signal_snapshot_watermarks`; no existe un snapshot JSON de serving.
- `tb_analyses` recibe la identidad estratégica `(workspace_id, report_key,
  population_id, population_version, population_definition_hash)` y conserva
  `study_corpus_id` exclusivamente como execution scope compatible. Un índice parcial
  impide dos corridas abiertas para el mismo reporte y otro hace idempotentes los
  reintentos.
- `signal_strategic_run_outbox` desacopla la transacción que congela población,
  snapshot y run del dispatch BullMQ. El mismo idempotency key no puede producir dos
  análisis ni dos snapshots.
- `tb_analysis_context_refs` registra por referencia la versión y digest de Brand OS,
  Study OS, KB y fuentes estructuradas capturadas antes del freeze. Estos assets son
  contexto versionado, no membership de listening ni blobs dentro del snapshot.
- `tb_reusable_assertion_review_events` registra cada decisión humana seleccionada
  (`approve | correct | reject`), el tag fuente, el tag resuelto, la mención alias, la
  raíz canónica, estado anterior/nuevo, reviewer e idempotency key. Aprobar un finding
  o artifact no aprueba indiscriminadamente todos los tags de la corrida.

Las funciones `create_signal_tb_analysis_population` y
`create_signal_tb_strategic_run` serializan creación/reintento, comprueban ownership,
policy, estado aprobado, periodo, digest y canonicalidad, y congelan el snapshot antes
de crear el análisis. `assert_signal_tb_snapshot_containment` reconcilia count/digest y
rechaza codings, citations o evidence fuera de la membership. Triggers aplican esa
contención en cada escritura y hacen inmutable la identidad/membership congelada.

`review_signal_tb_reusable_assertion` resuelve un tag histórico desde alias hacia
`canonical_mention_id`, conserva lineage y garantiza una sola assertion reusable en la
raíz. `promote_signal_workspace_report_release` bloquea el reporte, publica de forma
append-only, actualiza atómicamente el current pointer composite
`(workspace_id, report_key)` y mantiene el puntero legacy sólo como compatibilidad.
Una ingesta posterior no modifica snapshots ni releases ya publicados.

### 16.13 Recuperación del outbox estratégico (migración 0063)

`0063_signal_strategic_run_outbox_recovery.sql` hace operativo el outbox creado en
0062 sin cambiar población, snapshot, Review o releases:

- `bullmq_job_id` conserva la identidad determinista
  `signal-tb-<tb_analysis_id>`;
- `locked_at`, `lease_expires_at` y `lease_token` permiten claims transaccionales y
  evitan que un worker vencido finalice el lease reclamado por otro;
- `dead_lettered_at` distingue agotamiento de dispatch de un fallo del análisis;
- el índice parcial de recuperación cubre `pending`, `failed` y `dispatching` con
  lease vencido;
- filas `dispatching` anteriores a 0063 se vuelven inmediatamente recuperables.

Workers es el único dueño del dispatch. Reclama con `FOR UPDATE SKIP LOCKED`, aplica
backoff exponencial acotado y máximo de intentos, y drena al iniciar y periódicamente.
Antes de `Queue.add` consulta el job ID determinista; si Redis aceptó el job pero el
ACK o la actualización PostgreSQL fallaron, el siguiente lease reconcilia la fila como
`dispatched` sin crear otro job efectivo. `SIGTERM`/`SIGINT` detienen el timer, esperan
el drain activo y cierran el producer antes de cerrar Redis/PostgreSQL.

### 16.14 Separación de intención y semántica (migración 0064, staging_verified)

`0064_signal_semantic_scope_hardening.sql` introduce una transición paralela; no mueve
el pointer operational ni reescribe la población v1:

- `signal_mention_attributions.attribution_basis='source_intent'` conserva la
  procedencia del source/import/query y siempre usa
  `eligibility_status='not_eligible'`;
- `attribution_basis='mention_semantic'` representa una assertion versionada sobre la
  mención canónica, con evidence hash, policy, confidence, estado current e
  idempotency key;
- `signal_mention_attribution_review_events` es append-only. Approval, rejection y
  supersession conservan reviewer, policy, estados anterior/siguiente y rationale
  hash;
- competitor y category semánticos requieren una identidad gobernada del brand;
  unattributed nunca puede volverse elegible;
- cada workspace recibe una definición draft
  `signal-operational-primary-brand-semantic-v2`, sin pointer. Sólo assertions
  `mention_semantic + current + approved + eligible` crean memberships en esa
  candidata;
- nuevas poblaciones estratégicas y sus snapshots aplican el mismo contrato semántico.
  Source intent aislado no entra al snapshot.

La compatibilidad es deliberada: v1 sigue interpretando los campos legacy hasta una
promoción futura explícita. Aplicar 0064 no cambia su definition, pointer, memberships,
IDs visibles ni hash del conjunto. No se autoaprueban candidatos derivados de auditorías
privadas. En `noisia-staging` 0064 está aplicada, pero V1 continúa como current pointer;
eso no constituye promoción ni cutover de V2.

### 16.15 Gobierno reversible de menciones canónicas (migración 0067, staging_verified)

`signal_mention_governance_events` registra acciones workspace-native `include`,
`exclude`, `revert` y `send_to_review` con actor, razón e idempotency key. La tabla es
append-only y siempre referencia la raíz canónica, aunque la petición use un alias.
`mutate_signal_canonical_mention_governance` serializa la acción en una transacción;
los triggers existentes reconcilian V1/V2 e invalidan materializaciones sólo cuando
cambia la elegibilidad. La migración no crea ni promueve pointers. También corrige el
resolver V1 para tratar un `contract_version` ausente como contrato legacy, en vez de
convertir el booleano SQL en `NULL` y excluir una membership válida durante Review.

### 16.16 Governed Views y Population Policies (migración 0068, staging_verified)

`0068_signal_governed_views_population_policies.sql` agrega el catálogo server-owned
que resuelve la identidad estable `(workspace_id, module_key, view_key)` sin duplicar
menciones ni poblaciones:

- `signal_population_policy_bundles` conserva una policy versionada con módulos
  autorizados, scopes, acceptance/quality requirements, eligibility, deduplicación por
  raíz, visibility, denominator, periodo/timezone y referencias de retención/licencia.
  El `definition_hash` identifica el contrato normalizado y se reconcilia en PostgreSQL
  contra columnas y allowlist relacional antes de promover; un bundle activo o retirado
  no puede reescribirse.
- `signal_population_policy_entities` mantiene el allowlist relacional de brand,
  competitor, category y reference. Triggers comprueban workspace/brand y exigen
  competidores o `intelligence_entities` gobernadas; `unattributed` no puede presentarse
  como entidad elegible.
- `signal_population_policy_compilations` vincula de forma append-only un bundle exacto
  con la candidata derivada: `compiled_plan_hash`, versión/hash de población, digest de
  memberships, watermark y estado `ready|stale|blocked`. Un binding con población no
  puede promoverse sin una compilación current y exacta del mismo workspace.
- `signal_governed_view_bindings` conserva versiones append-only del binding. Un índice
  parcial permite como máximo un current por workspace+módulo+view. `population_id` es
  opcional: cuando existe referencia una materialización derivada del mismo workspace,
  no una segunda autoridad de policy.
- `signal_governed_view_binding_events` registra promociones y rollback con actor e
  idempotency key. `promote_signal_governed_view_binding` serializa la identidad con
  advisory lock, valida compatibilidad/actor/cross-workspace, activa el bundle draft,
  retira el binding anterior e inserta la nueva versión en una transacción. Un no-op
  aceptado consume su idempotency key; un retry tardío devuelve el resultado original
  sin revertir el current posterior. `rollback` sólo puede apuntar a una combinación
  policy/población usada históricamente por esa misma identidad y siempre crea una nueva
  `binding_version`.

La calidad distingue `resolved` de `not_available`. Un contrato client-safe bloqueado
no inventa umbrales, retención o licencia. Coverage usa mediciones explícitas
`available(count)` o `not_available(count=null)`; cero queda reservado para una
medición observada. La abstención no se infiere de la ausencia de assertion.

La migración no contiene seeds ni backfill: crea cero bundles, bindings, populations,
memberships o pointers para workspaces existentes. El trigger de candidata semántica
queda diferido para que un workspace nuevo termine primero su provisioning V1 y después
cree V2 draft, sin reservar por error la versión del pointer activo.
`signal_workspace_population_pointers` permanece intacta como
bridge transitorio de la view `brand`; 0068 no promueve Operational V2 ni cambia un
reader visible. La policy es source of truth, mientras `signal_population_memberships`,
`metric_materializations`, snapshots y releases siguen siendo estados derivados o
congelados con su propia identidad.

### 16.17 Autoridades de quality, retention y licensing (migración 0069, staging_verified)

`0069_signal_data_governance_policies.sql` hace verificable el contrato client-safe de
0068 sin crear policies permisivas ni mover poblaciones:

- `signal_quality_policies` versiona la decisión de elegibilidad sobre
  `quality_score/quality_flags` observados; nunca reescribe esas observaciones.
- `signal_retention_policies` y `signal_licensing_policies` conservan decisiones
  efectivas, evidencia de aprobación y usos cerrados. `not_available` es un estado
  distinto de permitido o prohibido; la migración no fija plazos ni términos legales.
- `signal_provenance_policy_bindings` liga las tres autoridades a una source o a una
  excepción de import. La excepción exacta del import precede al binding de source.
  Si una raíz tiene varias provenances, basta una ruta vigente y autorizada; la raíz
  sigue apareciendo una sola vez.
- `signal_data_governance_evaluations` y sus items guardan, por raíz canónica, la
  policy de quality, la provenance seleccionada, retention/licensing y el reason code.
  Sus digests quedan ligados a la compilación y su membership digest.
- `signal_data_governance_invalidations` registra cambios relevantes de authority,
  provenance, calidad, canonical identity, assertion, membership o watermark. El
  mismo evento marca materializaciones stale y usa `signal_data_invalidations` como
  outbox durable cuando existe watermark de la población.

Una compilación `client-safe` sólo puede quedar `ready` con una quality policy activa,
una evaluación relacional completa y una prueba autorizada para cada membership. Los
refs textuales heredados de 0068 se conservan como labels de compatibilidad, pero no son
autoridad. Las razones cerradas son `quality_not_eligible`, `retention_expired`,
`retention_blocked`, `retention_not_available`, `licensing_prohibited`,
`licensing_not_available`, `no_authorized_provenance`, `semantic_not_eligible` y
`policy_eligible`.

0069 no inserta policies, bindings de provenance, governed-view bindings,
memberships ni pointers. Operational V1 y todos sus digests permanecen intactos. La
aplicación de 0068/0069 y las decisiones staging-only de Laika se verificaron en el gate
Backend 04; no constituyen defaults de producción ni autorizan aplicar 0073.

### 16.18 Bases semánticas y binding sets multi-view (migraciones 0070–0073)

`0070_signal_semantic_base_isolation.sql` protege la candidata de marca creada por 0064:
`signal-operational-primary-brand-semantic-v2` conserva únicamente identidad semántica,
memberships canonical-root, digest y lineage. Quality, retention, licensing, módulo,
view y compiled plan viven en bundles, derivaciones y compilaciones; no pueden
contaminar esa base.

`0071_signal_governed_brand_binding_withdrawal.sql` y
`0072_signal_governed_brand_binding_set_integrity.sql` conservan el primer set atómico
de `brand`: tres módulos exactos, historial append-only, CAS, idempotencia concurrente y
`withdraw-to-bridge`. Retirar el set no mueve
`signal_workspace_population_pointers`; la ausencia de binding `brand` deja que el
resolver use el bridge operational existente.

`0073_signal_governed_multi_view_binding_sets.sql` (SHA-256
`8cc2d1c5ae3338cb6189f13b851c96474329159358d0f0c7d3bec17284158cae`), comprobada
en PostgreSQL local y `noisia-staging`, generaliza esa foundation sin crear otro catálogo:

- cierra el enum client-safe a `brand`, `competition`, `category` y `all-governed`;
- mantiene la base 0064 exclusivamente para `brand` y define una base neutral
  `signal-operational-attributable-semantic-v1` para las otras views. La base neutral se
  crea sólo mediante writer server-side autorizado; la migración no la auto-seedea;
- la base neutral deduplica por raíz canónica y admite únicamente assertions
  `mention_semantic` current, approved y eligible con entidad gobernada. Excluye
  `unattributed` y no contiene quality, rights, periodo, módulo ni view;
- `signal_governed_view_population_derivations` conserva una population resuelta por
  `(workspace_id, module_key, view_key, policy_bundle_id)`. Monitoring, Mentions y
  Topics & Narratives pueden mantener memberships, digests, watermarks y compilaciones
  distintos sin que el último módulo reconciliado sobrescriba a otro;
- `all-governed` acepta una unión explícita no vacía de scopes gobernados presentes,
  deduplicada por raíz; no fabrica `reference` cuando no existe una entidad gobernada;
- brand, competitor, category y reference se validan contra identidades activas del
  mismo workspace/brand. Retirar una entidad invalida sólo las compilaciones que la
  usan y reconcilia la base neutral afectada;
- el ledger existente `signal_governed_brand_binding_set_operations` se generaliza
  in-place con `view_key`. Cada set conserva exactamente los tres módulos. `brand` usa
  `withdraw-to-bridge`; `competition`, `category` y `all-governed` usan
  `withdraw-to-absence`. Ninguna transición borra historial;
- promoción, retiro y retry conservan advisory locks, CAS, actor server-resolved,
  idempotencia y checks cross-workspace. Un binding current exige bundle, entidades,
  derivación, evaluación y compilación compatibles.

El contrato público no acepta population, bundle, binding ni policy enviados por el
navegador. 0073 no crea bundles, bases, derivaciones, evaluaciones, compilaciones,
bindings, memberships ni pointers por sí sola. Su smoke local aplicó `0000–0073`; el
rehearsal staging creó después, mediante writers autorizados, nueve bindings y nueve
population refs no-brand. La unión `all-governed` fue exacta, el shadow obtuvo
`unexplained_count=0`, ningún pointer cambió y Advisor cerró sin P0/P1.

### 16.19 Gate D estratégico gobernado (migración 0074, `staging_verified`)

`0074_signal_strategic_gate_d_preflight.sql` agrega la autoridad durable necesaria para
congelar y ejecutar T&B desde una view estratégica sin reutilizar el pointer
operacional:

- `triggers-barriers / strategic` exige exactamente `llm-processing` y
  `strategic-analysis`, bundle `strategic-internal`, population `purpose='analysis'`,
  derivación, evaluación y compilación current/ready del mismo workspace;
- `corpus_snapshots` y `tb_analyses` conservan la identidad estratégica V2, hashes de
  policy/population/governance/provenance, usos, provider/prompt/pricing y hard cap. El
  corpus de estudio permanece execution scope compatible, no source of truth;
- `signal_strategic_run_controls` sella binding, bundle, compilation, evaluation,
  population, snapshot, sample, execution plan, vigencia, costo reservado/real y estado
  cancelable. Triggers impiden reescribir esa autoridad;
- `signal_strategic_sealed_sample_items` guarda una muestra determinista de raíces
  canónicas y la hace inmutable después del launch. La prueba de provenance se calcula
  sobre toda la population del periodo, no sólo sobre la muestra;
- `signal_strategic_budget_reservations` asigna una operation key única por llamada,
  persiste límites de tokens y distingue reserved, settled y released. Advisory locks y
  CAS impiden doble gasto concurrente; la capacidad liberada se puede reutilizar sin
  perder el costo real liquidado;
- `signal_strategic_step_outbox` y su ledger append-only modelan dispatch, lease,
  heartbeat, retry acotado, cancelación y dead-letter por step. BullMQ recibe job IDs
  deterministas derivados del outbox, nunca una autoridad enviada por el browser;
- `signal_strategic_review_release_operations` hace atómicos e idempotentes Review y la
  creación de release draft; `signal_strategic_release_promotion_operations` aplica la
  misma disciplina a la promoción del current release;
- `launch_signal_tb_strategic_run_v2`,
  `assert_signal_strategic_runtime_authority_v1`, los writers de budget/step/cancel y
  los writers V2 de Review/release fallan cerrado ante autoridad vencida, cross-workspace,
  digests incompatibles o retries con inputs distintos.

0074 es data-neutral: no crea bundles, bindings, compilaciones, runs, snapshots,
reservations, jobs, Review events o releases al aplicarse. No mueve pointers ni cambia
V1. Quedó aplicada y verificada exclusivamente en `noisia-staging` con checksum
`1eb15739c17a17fb4c4f9924971447fbcb6a26bcfa6cfc68cf7847f5b5e13d69`, 108/108
sentinels, 8/8 markers y un único ledger. El verify read-only conservó el aggregate
protegido `sha256:4f007cb4a08caf96824f1036684d9d012050ba2ecf28039d1fcf0f6394c6f63e`:
V1 18,996/927, base semántica 276, 12 bindings/12 compilaciones current y cero nuevas
filas estratégicas, jobs, pointers o readers. El preflight gratuito de una corrida sigue
siendo un gate separado y no se ejecuta por aplicar la migración. Su primer rehearsal
posterior fue estrictamente read-only y falló cerrado: no existe binding estratégico ni
una ruta de provenance que autorice conjuntamente `llm-processing` y
`strategic-analysis`; Worker y recovery tampoco están listos. No creó filas ni invocó
al provider.

---

### 16.20 Imports workspace-owned asíncronos (0079/0080, `staging_verified`)

`0079_signal_workspace_async_imports.sql` y
`0080_signal_workspace_chunked_import_storage.sql` convierten `import_batches` en el
ledger único de upload, procesamiento y aceptación para CSV workspace-owned. No crean
otro store de menciones ni otro parser. La única implementación de parseo, normalización,
deduplicación, inserción y provenance está en `infrastructure/db/sentione-csv-ingest.ts`;
Studio y Workers sólo crean adaptadores con su pool.

- `import_batches` conserva fase, progreso, bytes esperados/procesados, storage privado,
  identidad immutable del upload, content hash, worker job, supersession y error tipado;
- `signal_workspace_import_outbox` implementa dispatch durable con lease, retry y
  dead-letter; `signal_workspace_import_events` conserva upload, queue, processing,
  completion y failure append-only;
- cada batch grande se divide en objetos deterministas de hasta 50,331,648 bytes. La DB
  verifica part count/tamaño antes de encolar y el Worker concatena sus streams para el
  parser CSV canónico;
- `signal_mention_import_memberships.ingestion_disposition` guarda `included`, `excluded`
  o `duplicate` de forma inmutable. El Worker la persiste inmediatamente después de crear
  una raíz, antes de cualquier lookup o punto de crash;
- `queued`, `processing` y `failed` no pueden justificar membership, assertion semántica,
  serving ni snapshot estratégico. Sólo `completed` con
  `record_count = included + excluded + duplicates`, hash y bytes completos puede emitir
  acceptance, watermark, sync e invalidaciones;
- recovery crea un batch nuevo que referencia un failed anterior. No borra el intento ni
  sus memberships de provenance; el batch exitoso vuelve a enlazar las raíces canónicas.

Checksums staging: 0079
`dbd1c0d32760666f7d81ea510e271cda2aaf31d29ec38c44250f7337cc242246` y 0080
`b17b63a1f7c153338ea16758c1ed01b89fc8dd5c1f7cc1b66f291e8950413ed7`.
Ambas migraciones se aplicaron con restore point verificable, ledger y protected-state
CAS. El smoke `0000–0080`, reaplicación, aborto parcial, restart y retry idempotente están
verificados en PostgreSQL desechable; la recuperación de Alexa terminó con un solo batch
aceptado y cero raíces dependientes únicamente de provenance fallida.

### 16.21 Acquisition Plan workspace-owned (0084, `local_verified`)

`0084_signal_acquisition_plan_control_plane.sql` separa connector, intención de
adquisición, verdad semántica y observación tipada sin crear otro store de menciones:

- `data_sources.source_key` es una key opaca server-generated e inmutable; las sources
  target usan `signal-data-source-connector-v1` y conservan scope/entity legacy sólo
  como compatibilidad;
- `signal_acquisition_plans` mantiene un draft y un current por workspace. El draft usa
  `draft_revision`/`draft_digest`; promotion aplica CAS y sella
  `definition_hash=draft_digest` antes de volver inmutable su composición;
- `signal_acquisition_slots`, `signal_acquisition_query_versions` y
  `signal_acquisition_reference_decisions` conservan slots por versión, query privada
  append-only y decisiones reference no circulares;
- `signal_acquisition_plan_events` relaciona varios events ordenados con la autoridad de
  idempotencia `signal_governance_control_operations` mediante
  `(operation_id,event_index)`;
- `competitors` gana lifecycle current/retired y
  `signal_competitor_lifecycle_events`; hard DELETE queda bloqueado y reactivation crea
  historia nueva;
- `import_batches` sella plan/slot/query, periodo/timezone, Brand OS/catalog digests,
  provider schema y projection state. Historia ambigua conserva columnas NULL y estado
  `legacy-unplanned/unknown`;
- `signal_provider_mention_observations` y sus terms tienen grain import
  membership/provider record, `platform` explícita, hashes y supersession append-only.
  No copian texto/title/URL/perfiles. Rights se sellan con
  `provenance_binding_id`, `rights_definition_hash` y `retention_until`, y se reevalúan
  al consumir;
- processing/failed nunca son elegibles. Un batch target sólo puede completar tras
  reconciliar memberships, header/schema y observation count; target source intent es
  siempre pending/not-eligible.

Los writers usan actor/owner server-resolved, transacciones SERIALIZABLE, advisory
locks, request digest, Idempotency-Key y reread post-lock. La migration es data-neutral:
no crea plans, slots, queries, imports, observations, semantic assertions, populations,
pointers o bindings. Su estado es sólo local; staging/producción no fueron leídos ni
modificados.

### 16.22 Workspace-owned Query Composer (0085, `local_verified`)

`0085_signal_workspace_query_composer.sql` amplía el control plane existente sin crear
otro store ni conectar Acquisition Plan al runtime Study OS:

- `signal_acquisition_plans` sella un Acquisition Brief provider-neutral con versión y
  digest. El brief vive dentro del agregado draft; cualquier cambio incrementa
  `draft_revision`/`draft_digest`, emite `brief-sealed` y promotion conserva el sello;
- `signal_acquisition_query_versions.origin_kind` admite `engine-generated` sólo cuando
  existe lineage tipado completo: model, pipeline, template/context/construction/validation
  digests, estado de fallback, Study OS opcional hasheado y timestamp;
- el lineage no conserva prompt, Knowledge privado ni respuesta cruda del provider. Las
  versiones siguen append-only y una regeneración crea supersession;
- `signal_governance_control_operations` conserva request/idempotency y
  `signal_acquisition_plan_events` registra el cambio ordenado; triggers diferidos
  impiden sellar un brief o insertar una propuesta sin su operación/evento exactos;
- el browser continúa sin autoridad sobre `origin_kind`, model, lineage, owner IDs o
  entity IDs. `engine-generated` sólo entra mediante el writer server-owned.

Checksum local 0085:
`f36a32c1562147c0c94e7e00927d04902f4c4c3df446a5b28ea8ea3ff7b419d4`.
Smoke limpio `0000–0085`, reaplicación de 0085 e integración PostgreSQL greenfield
quedaron verdes. No se aplicó remotamente y la migración no crea plans, queries, imports,
Study corpora, query packs, pointers ni bindings.

### 16.23 Review explícito de queries de adquisición (0086, `local_verified`)

`0086_signal_acquisition_query_review.sql` añade
`signal_acquisition_query_review_events` como ledger append-only de decisiones
`approved/rejected` sobre una query version privada. El evento queda ligado a workspace,
versión, actor y operación idempotente; un trigger exige plan/query draft, autoridad
server-side y hash exacto de evidence. `UPDATE/DELETE` están bloqueados.

Una query nueva —generada o editada manualmente— comienza `pending`. Sólo la última
decisión de su versión participa en readiness; `pending` y `rejected` bloquean promoción.
Al generar una nueva versión, la anterior se conserva superseded y la aprobación no se
hereda. El ledger no concede semantic approval a ninguna mención ni modifica imports,
populations, pointers o readers.

Checksum local 0086:
`8fda9ce4e45c8464be9cad10ab2a2df0859a6e3d7d03a731d977a3d088dac2b1`.

### 16.24 Classification Authority (`0087`, `implemented_local`)

**Registrado:** 2026-08-16T03:05:37-06:00 (`America/Mexico_City`).

`0087_signal_classification_authority.sql` retira como autoridad la combinación legacy
de score/confidence, mutación de `record_tags` y el worker full-pop. La autoridad target
queda separada en:

- `signal_classification_generations` y
  `signal_classification_generation_items`: población, watermark/digests, denominator y
  resultado por canonical root (`approved|pending|rejected|abstained|error`);
- `signal_classification_assignments`: ledger append-only que distingue método
  (`exact|labeling_function|model|human`) de disposición, conserva evidence/lineage,
  policy/model/rule identity y supersession;
- `signal_labeling_function_versions` y
  `signal_classification_approval_policies`: reglas determinísticas versionadas. Una
  labeling function puede votar o abstenerse; sólo una policy aprobada, efectiva y
  compatible convierte su propuesta en `approved`;
- `signal_classification_gold_set_versions`, `signal_classification_gold_items`,
  `signal_classification_evaluations` y sus slices: gold append-only sin leakage entre
  train/validation/test, `slice_keys` selladas en el digest de cada item, reconciliación
  exacta y métricas top-level/por slice recomputadas server-side; métricas desconocidas
  permanecen `NULL` y un caller no puede persistir conteos fabricados;
- `tagging_model_versions` endurecido mediante registry contract y
  `signal_tagging_model_version_events`: artifact/config/dataset/provenance digests,
  lifecycle `draft→evaluated→approved→retired` y effective dating. Evaluated nunca
  equivale a approved;
- `signal_classification_operations` y `signal_classification_events`: actor,
  idempotencia, request digest y eventos ordenados para cada transición.

`record_tags` permanece sólo como bridge temporal. El único owner de filas Signal es
`project_signal_classification_generation_v1`: reconstruye IDs determinísticos desde
assignments `approved`, autentica la operación dentro de la transacción, rechaza
INSERT/UPDATE/DELETE directos, registra lineage e invalida materializaciones una sola
vez por digest. Pending, rejected, abstained y error nunca se proyectan. Las filas
study-first/T&B históricas sin `signal_taxonomy_profile_id` siguen legibles y no son
reinterpretadas.

La migración añade además el guard forward-only
`signal_mention_attribution_no_provider_autoapproval`: nuevas attributions no pueden
usar `claude_semantic_resolution` como approval authority. El batch resolver y el path
legacy por item persisten cualquier propuesta de provider como `pending` +
`candidate|not_eligible`, sin actor, fuente ni timestamp de aprobación. La historia
anterior continúa legible; sólo Review humana o una policy aprobada/versionada puede
producir una nueva decisión `approved`.

El bridge expira el **2026-10-15** y debe retirarse en Gate 10H cuando ningún reader use
`record_tags` sin generation/watermark, el projector pueda eliminarse y los bridges
study-first/T&B tengan plan de deprecación verificable. La migración no crea
generations, assignments, tags, jobs ni materializaciones y no toca Acquisition Plan
0084–0086, pointers o governed bindings.

Checksum local 0087:
`fd62b7dd637e62475dcce0eedbbdfc021906b2a1d72a742f74a28e5851ab48d3`.

## Cierre

Este schema es la base operativa. Cualquier feature nueva (multi-país, nueva metodología, integración nueva) debe poder mapearse a estas tablas o documentar por qué necesita extensión.

## 10A.6 · Query Evidence V2 (0088)

`signal-acquisition-import-v2` separa evidencia observada, declaración del operador y
verificación del proveedor. `import_batches.acquisition_query_evidence_class` usa el enum
cerrado `provider_verified | operator_attested | unavailable`; `unavailable` exige una
razón cerrada y prohíbe query, mientras `operator_attested` exige una query versionada y
actor. `provider_verified` exige query, adapter server-side y digest de ejecución; ningún
contrato de browser puede solicitarlo.

El sello agregado `acquisition_import_seal_digest` incluye plan, slot, periodo/timezone,
digests de autoridad, actor y evidencia de query. Es inmutable y recovery/supersession lo
copia exactamente. `signal_mention_attributions` proyecta sólo la clase, query nullable y
actor para `source_intent`; `import_batches` sigue siendo autoridad. La proyección queda
siempre `pending/not_eligible`, con confidence `NULL`, y no altera quality, denominator ni
verdad semántica.

Las observaciones tipadas completadas exponen una proyección relacional operator-safe de
periodo, idiomas, países y plataformas observados. Las diferencias contra periodo/mercado
declarados son warnings, no reetiquetado semántico. Batches incompletos no son consumibles.

Checksum local 0088:
`11f28c563f64f8f17d5961d9bd0b9779d48663a4529b4b2025a4f53235f9dfb4`.

## 10C.2B · Strategic authority de Acquisition (0089)

`0089_signal_acquisition_strategic_authority.sql` agrega la acción idempotente
`authorize-acquisition-benchmark` al ledger de governance y hace inequívoca la cadena
append-only de `signal_provider_mention_observations`: una observación sólo puede tener
una sucesora y el trigger exige mismo workspace/import/mention/provider/record key,
`observation_version + 1` y payload idéntico salvo binding, rights hash, retention y
metadata de versión.

El writer de aplicación selecciona batches completed desde los digests sellados del
freeze, crea una policy Licensing corpus-scoped, activa bindings import-level y
reproyecta rights set-based. No modifica observaciones anteriores ni crea binding
source-level. Un import futuro no hereda la policy; quality y retention se resuelven del
binding previo y la expiración efectiva es el mínimo entre 30 días y sus ventanas
vigentes.

Checksum local 0089:
`a162cff1dd45ff7a2374db81c154db62401904150537cb6d9b743c44cfa05253`.

## 10C.3A-R · Operator Topic Discovery Review (0090)

**Registrado:** 2026-08-21T17:02:18-06:00 (`America/Mexico_City`).

`0090_signal_topic_discovery_operator_review.sql` extiende el artifact/evidence graph
existente para artifacts workspace-owned de diagnóstico. `analysis_artifacts` conserva
el owner study-first histórico y acepta de forma mutuamente exclusiva un owner
`workspace_id + discovery_run_digest`; nunca se fabrica `study_corpus_id`.

La registration privada vive en `signal_topic_discovery_review_packets`. El packet
padre contiene artifacts `topic_discovery_proposal`, evidence groups y evidence links
referenciales hacia canonical roots; no duplica menciones ni texto canónico. Los
digests de packet, policy, candidate, source manifest, rights y discovery run quedan
sellados antes de abrir Review. La blind key y los paths privados no se persisten en el
contrato browser-facing.

La revisión usa ledgers append-only:

- `signal_topic_discovery_reviews`: revisión/revisión correctiva por supersession;
- `signal_topic_discovery_review_decisions`: draft o decisión final por propuesta;
- `signal_topic_discovery_outlier_decisions`: decisión separada sobre el reservoir;
- `signal_topic_discovery_review_events`: apertura, draft, finalización, export y
  supersession ligados a la operación idempotente de governance.

Finalizar materializa nuevas filas `finalized` dentro de una sola transacción; no
actualiza drafts. Una corrección crea otra review y conserva todo el historial. Triggers
bloquean UPDATE/DELETE y cualquier mutación del graph después de registrar el packet.
Ninguna tabla tiene FK o writer hacia Topic Contracts, classification assignments,
`record_tags`, pointers o governed bindings.

Checksum local 0090:
`199f2a140ebd166745818b79a331af33addd6cae8c767abfd5faca869225323e`.

## 10C.3B-A / NOI-71 · Semantic Context Pack Authority (0091)

**Registrado:** 2026-08-22T01:00:09-06:00 (`America/Mexico_City`).

`0091_signal_semantic_context_pack_authority.sql` amplía el artifact/evidence graph con
un discriminator workspace-owned explícito. `topic_discovery` conserva su
`discovery_run_digest`; `semantic_context` usa un `workspace_authority_digest` y no
fabrica un discovery run, study corpus, taxonomy o mention store.

La autoridad nueva se compone de tres tablas:

- `signal_semantic_context_generations`: snapshot exacto e inmutable al publicar de
  Brand OS, Knowledge y locale/market; el successor apunta a la generación anterior;
- `signal_semantic_context_element_versions`: propuestas y decisiones tipadas
  append-only, cada una con artifact y evidence group propios;
- `signal_semantic_context_events`: lifecycle ordenado por `(operation_id,event_index)`.

Los elementos efectivos se obtienen por ausencia de successor. `pending`, `approved` y
`rejected` son disposiciones explícitas; `superseded` se deriva del ledger. Confidence
se limita a `[0,1]`, pero ninguna constraint, trigger o writer la interpreta como
aprobación. Una corrección crea otra versión `pending`; approve/reject crean successors
con actor humano. Bulk approval está acotado por el writer y publication es una
operación separada.

Cada elemento referencia Brand OS o Knowledge mediante `analysis_evidence_groups` y
`analysis_evidence_links`. Los links no copian narrativa, chunks, prompts ni blobs. Una
vez registrado el elemento, artifacts/evidence y sus decisiones quedan protegidos ante
`UPDATE/DELETE`. La función `signal_semantic_context_digest_v1(text)` verifica en
PostgreSQL exactamente los bytes de la serialización canónica TypeScript.

No existe FK ni writer hacia classification assignments, `record_tags`, Topic
Contracts, serving, pointers o governed bindings.

Checksum local 0091:
`86a934de4da2f71f22b6705bf9432710153400b73c3954fccb66095a94905402`.

## 10C.3B-A.2 / NOI-72 · Semantic Context proposal execution (0092)

**Registrado:** 2026-08-22T09:53:36-06:00 (`America/Mexico_City`).

`0092_signal_semantic_context_proposal_execution.sql` agrega cuatro piezas de control,
sin cambiar el ledger semántico de 0091:

- `signal_semantic_context_proposal_runs` — un run máximo por generación y una llamada
  efectiva máxima, con preflight/context/model/pricing sellados;
- `signal_semantic_context_budget_reservations` — reserva y settlement exactos en
  micro-USD;
- `signal_semantic_context_proposal_outbox` — dispatch/recovery durable sobre la cola
  Data OS existente;
- `signal_semantic_context_proposal_run_events` — transiciones sanitizadas append-only.

Una respuesta persistida se valida y anexa atómicamente mediante el writer 69A. Un
outcome ambiguo dead-letterea el run/outbox y liquida conservadoramente la reserva
máxima; nunca habilita una segunda llamada. Estados terminales, reservas terminales y
eventos rechazan UPDATE/DELETE.

Checksum local 0092:
`5e52de57dd31ee9ca3d699ddfd76280a02c67b6dee7a3be71be66fa24227cc8f`.

## Backend 69A.3 · Semantic Context draft supersession (0093)

**Registrado:** 2026-08-22T15:05:20-06:00 (`America/Mexico_City`).

`0093_signal_semantic_context_draft_supersession.sql` reemplaza el índice incompatible
de un solo draft histórico por una cadena append-only con una sola hoja efectiva. La
generación anterior nunca se muta: el successor conserva `supersedes_generation_id`,
una `supersession_reason` cerrada y un evento `generation_reconciled`. El trigger toma
el advisory lock del workspace, exige predecessor efectivo y consecutivo, y conserva
la unicidad de successor.

El operation ledger admite `reconcile-semantic-context-generation`. Los motivos son
`brand_os_drift`, `knowledge_drift`, `locale_market_drift`,
`provider_lineage_missing`, `provider_lineage_changed` y
`operator_requested_reconciliation`. Una corrida provider no terminal bloquea el
writer; no se copian elementos ni approvals y no existe FK hacia serving.

Checksum local 0093:
`6eac2acb2465a9d845833a7def98b69777d86000faf3b2d42990274950a056e5`.

## Backend 69A.6 · Semantic Context Contract V2 y revalidación pagada (0094)

**Registrado:** 2026-08-23T02:13:03-06:00 (`America/Mexico_City`).

`0094_signal_semantic_context_contract_v2_revalidation.sql` agrega
`signal_semantic_context_proposal_revalidations`, un ledger append-only para adaptar y
revalidar server-side una respuesta privada ya pagada. Cada fila sella el run original,
response digest, contrato original, adapter V1→V2, contrato destino, normalización,
decisiones de duplicados, conteos y resultado `completed|rejected`. La tabla no contiene
texto del provider y no crea una nueva reserva, outbox o llamada.

El run fallido liquidado pasa a ser completamente inmutable; su response, settlement y
eventos permanecen históricos. La revalidación rechazada también es evidencia válida:
conserva el error estructural sanitizado y exige `appended_proposal_count=0`. Sólo una
revalidación compatible por run/adapter/contrato puede existir, y el operation ledger
registra `revalidate-semantic-context-proposal-run` con AuthZ DB-owned.

Checksum local 0094:
`c881dfd50332212f3a434e6bfd8cf3de2c3dff16e0cda869ac085da167828930`.

## Backend 69A.7A · successor de un draft consumido (0095)

**Registrado:** 2026-08-23T14:07:30-06:00 (`America/Mexico_City`).

`0095_signal_semantic_context_terminal_run_successor.sql` extiende la causa cerrada de
supersession con `terminal_provider_run`. El trigger de generaciones toma el advisory
lock canónico del workspace y sólo permite esta transición cuando el predecessor es la
hoja draft efectiva, contiene una corrida terminal no reutilizable, no tiene elementos
reviewables, outbox ejecutable ni reserva abierta. El successor nace sin corrida,
elementos, reserva u outbox y conserva un enlace explícito al predecessor inmutable.

El trigger de proposal runs usa el mismo lock, exige una generación draft efectiva sin
successor y vuelve a comprobar que no exista otra corrida. `UNIQUE(generation_id)` se
mantiene intacto: el camino soportado es crear una nueva generación, nunca reciclar o
reabrir el run anterior. La migración es row-inert y no crea producto ni gasto al
aplicarse.

Checksum local 0095:
`7fb943fff87f07af5fd69b9714a76194176ca131861ca68b0470b81e7d0aeb4d`.

## Backend 69B.2 · Merge, review annotations y publicación sellada V2 (0097)

**Registrado:** 2026-08-24 (`America/Mexico_City`).

`0097_signal_semantic_context_review_publication_v2.sql` extiende la autoridad 0091 sin
crear un store paralelo. Añade `merged` y `operator_merge`, el grafo append-only
`signal_semantic_context_merge_edges`, annotations versionadas en
`signal_semantic_context_review_annotations` y columnas write-once para los cuatro
digests de publicación, el pack V2, el preflight y sus conteos sellados.

Los triggers exigen generación/workspace/actor/operation consistentes, un solo target
successor por operación N→1, fuentes únicas, grafo acíclico, lineage de annotations y
filas append-only. Toda transición `draft→published` posterior a 0097 recompone el
publication graph dentro de PostgreSQL y exige schema V2 y seals exactos. Las filas ya
publicadas con V1 permanecen byte-for-byte y con columnas V2 nulas.

El hardening 69B.2B conserva las garantías de evidence de 0091, valida en SQL que todo
`typed_relation` approved apunte a una hoja current approved de la misma authority,
sella el objeto provider lineage completo en `publication_authority_snapshot` y exige
successors de annotations ligados al subject/related exacto de correction o merge.
`canonical_json_v2` rechaza keys distintas que colisionen después de NFC. Ninguna de
estas reglas crea un store o writer paralelo.

Checksum local 0097:
`b3c03d6f43dd811627c016264bfdfbcebf28dbf2e368c4d7e14db73bf5582bdb`.

## 69B.4C-A · Decision basis append-only (0098)

**Registrado:** 2026-08-25 (`America/Mexico_City`).

0098 añade a `signal_semantic_context_element_versions` los campos nullable
`decision_contract_version`, `decision_reason_code`, `decision_rationale` y
`decision_basis_digest`. Las decisiones históricas permanecen legibles con NULL; toda
nueva hoja `operator_decision/approved|rejected` debe sellar los cuatro campos. Un
trigger PostgreSQL recompone tanto el basis digest como el element digest V3 y rechaza
inserts incompletos o incoherentes. El snapshot de publicación incorpora la base al
review graph y bloquea drafts current con `decision_basis_missing`; no reescribe packs
históricos publicados.

69B.4C-B añade al mismo 0098 `semantic_context_decision_input` y
`semantic_context_decision_input_digest` en `signal_governance_control_operations`.
Ambos son inmutables y sólo se rellenan para las decisiones V2. Un constraint trigger
deferred liga el input exacto, la operación completed, los predecessors current pending,
los successors y el evento al commit. Para bulk impone 2–15 keys únicas, conjunto exacto,
same-kind, basis único y disposition approved; para single impone una sola key y
action/confirmation/disposition exactas. Las operaciones anteriores permanecen NULL y
no se reescriben.

## 69B.5E-C · Resolution basis de annotations append-only (0099)

**Registrado:** 2026-08-25 (`America/Mexico_City`).

0099 añade a cada versión resuelta de `signal_semantic_context_review_annotations` un
contrato de decisión explícito: versión, basis digest, input digest, snapshot/digest de
autoridad y digests de estado anterior/posterior. Las columnas son nullable sólo para
historia anterior a 0099; toda resolución nueva debe completar el grupo entero. El
trigger PostgreSQL deriva y reconcilia estos valores contra generation, operation,
predecessor y event, y rechaza inserts parciales o un rationale heredado que no haya
sido sellado como input de la operación actual. El actor vive en el ledger y el snapshot
de autoridad sella además su `user_type` y `primary_role` DB-owned al decidir.

Las actions `resolve-semantic-context-annotation` y
`repair-semantic-context-annotation-resolution` son transaccionales e idempotentes. La
segunda crea un successor resolved únicamente para una hoja histórica resolved sin
basis; preserva todas las versiones anteriores y no cambia la resolución semántica. El
snapshot de publicación incorpora el grafo de basis y bloquea un draft current con
`annotation_resolution_basis_missing` hasta que cada hoja histórica afectada tenga un
repair append-only explícito.

## 69B.5H-B · Autoridad locale/global append-only (0100)

**Registrado:** 2026-08-25 (`America/Mexico_City`).

0100 añade a cada versión de elemento un snapshot nullable de decisión locale/global:
contrato, disposición, locale sellado, reason/rationale, input, autoridad y digests de
pre/post estado. Las columnas permanecen NULL para la historia anterior. Una decisión
nueva sólo parte de una hoja current `approved` con `locale IS NULL`; crea un successor
`operator_correction/pending` y nunca una aprobación. La disposición `global` crea
además una versión current `locale_unresolved/resolved/global` con basis completo; la
disposición `locale_specific` sólo admite un locale incluido en la generación sellada.

El ledger admite `decide-semantic-context-locale-authority` y su constraint trigger
deferred reconcilia al commit el conjunto exacto de 1–15 keys, un único payload
homogéneo, predecessors approved/current, successors pending, annotations globales,
eventos, actor, resultado y `draft_digest` recompuesto por PostgreSQL. Los snapshots de
publicación incorporan un grafo locale-authority separado y bloquean drafts con hojas
approved `locale IS NULL` sin resolución explícita mediante
`locale_market_required_unresolved`. Topic Contracts, assignments, tags y serving no
participan en este writer.

69B.5H-C endurece 0100 sin una migración adicional. El trigger compara `locale` y las
once columnas `locale_decision_*` con el predecessor de todo successor ajeno a la
operación dedicada. El snapshot de publicación usa
`signal_semantic_context_locale_authority_valid_v1`: acepta lineage dedicado completo o
un locale de propuesta original, preservado y contenido en `generation.locale_variants`.
