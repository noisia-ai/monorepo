# Noisia Studio — Diagramas (Mermaid)

> Diagramas visuales en Mermaid. Renderizan nativos en GitHub y en VS Code con extensión. Copy-paste en cualquier .md y se ven.

---

## 1. ER Diagram — entidades principales

```mermaid
erDiagram
  organizations ||--o{ brands : "tiene"
  organizations ||--o{ users : "emplea"
  organizations ||--o{ themes : "puede crear (NULL = themes de Noisia)"
  brands ||--o{ competitors : "tiene como competidores"
  brands ||--o{ study_corpora : "tiene corpus"
  themes ||--o{ study_corpora : "tiene corpus"
  methodologies ||--o{ study_corpora : "aplica en"
  users ||--o{ user_brand_access : "tiene acceso a"
  brands ||--o{ user_brand_access : "es accedida por"
  study_corpora ||--o{ mentions : "contiene"
  study_corpora ||--o{ query_iterations : "tiene iteraciones de Engine"
  study_corpora ||--o{ analysis_runs : "tiene corridas"
  study_corpora ||--o{ findings : "produce"
  study_corpora ||--o{ dashboards : "publica"
  mentions ||--o{ mention_codings : "codificada como"
  mentions ||--o{ mention_brands : "menciona marcas"
  mentions }|--|| authors : "escrita por"
  findings ||--o{ evidence_quotes : "sostiene con citas"
  evidence_quotes }|--|| mentions : "referencia"
  dashboards ||--o{ dashboard_block_instances : "compone con bloques"
  dashboard_block_instances }|--|| dashboard_blocks_catalog : "es instancia de"
  dashboards ||--o{ dashboard_comments : "recibe comentarios"
  dashboards ||--o{ dashboard_change_requests : "recibe solicitudes"

  organizations {
    uuid id PK
    text slug UK
    text legal_name
    text status
    uuid account_owner_kam_id FK
  }

  brands {
    uuid id PK
    uuid organization_id FK
    text slug UK
    text name
    text industry
    char2_array countries
  }

  themes {
    uuid id PK
    uuid organization_id FK "nullable"
    text slug UK
    text name
    bool is_public
  }

  methodologies {
    uuid id PK
    text slug UK
    text version
    text status
    jsonb manifest_yaml
  }

  study_corpora {
    uuid id PK
    uuid brand_id FK "nullable"
    uuid theme_id FK "nullable"
    uuid methodology_id FK
    text status
    text business_question
  }

  mentions {
    uuid id PK
    uuid corpus_id FK
    text external_id
    text text_clean
    timestamptz published_at
    text platform
    text inclusion_status
  }

  findings {
    uuid id PK
    uuid corpus_id FK
    text finding_code
    text commercial_name
    jsonb metrics
    text confidence_level
  }

  evidence_quotes {
    uuid id PK
    uuid finding_id FK
    uuid mention_id FK
    int ordered_position
    bool is_lead_quote
  }

  dashboards {
    uuid id PK
    uuid corpus_id FK
    text status
    text client_url_slug UK
  }

  users {
    uuid id PK
    text email UK
    text user_type
    text primary_role
    uuid organization_id FK
  }
```

---

## 2. Sequence Diagram — Engine de Validación de Queries

Flujo end-to-end de cómo el Insights Manager + IA construyen un corpus.

```mermaid
sequenceDiagram
  autonumber
  actor IM as Insights Manager
  participant UI as Studio UI
  participant API as Studio API
  participant Queue as BullMQ
  participant Worker as Engine Worker
  participant LLM as Claude (via Vercel AI SDK)
  participant SentiOne as SentiOne API
  participant DB as Supabase Postgres

  IM->>UI: Crear corpus (brand + methodology + business_question)
  UI->>API: POST /api/corpora
  API->>DB: INSERT study_corpora (status=draft)
  API-->>UI: corpus_id

  IM->>UI: Llenar formulario de contexto
  UI->>API: PATCH /api/corpora/:id
  API->>DB: UPDATE study_corpora context_form
  API-->>UI: ok

  IM->>UI: "Iniciar Engine de Validación"
  UI->>API: POST /api/corpora/:id/run-engine
  API->>DB: UPDATE study_corpora status=corpus_building
  API->>Queue: enqueue("engine_validation", {corpus_id})
  API-->>UI: job_id (polling)

  loop hasta corpus aprobado (max 5 iteraciones)
    Queue->>Worker: pick job
    Worker->>DB: SELECT context_form, methodology manifest
    Worker->>DB: SELECT memory_industry, memory_brand
    Worker->>LLM: prompt: "compose initial query"
    LLM-->>Worker: query_text + query_components
    Worker->>SentiOne: search(query_text, sample=50)
    SentiOne-->>Worker: 50 mentions sample
    Worker->>LLM: prompt: "evaluate sample quality"
    LLM-->>Worker: {density, balance, noise, score}
    Worker->>DB: INSERT query_iteration

    alt score >= 85
      Worker->>SentiOne: search(query_text, full)
      SentiOne-->>Worker: full mentions corpus
      Worker->>DB: bulk INSERT mentions (status=pending)
      Worker->>UI: notify "corpus ready for review"
    else score < 85
      Worker->>LLM: prompt: "propose query adjustments"
      LLM-->>Worker: ajustes
      Worker->>UI: notify "needs analyst input on adjustments"
      UI->>IM: muestra ajustes propuestos
      IM->>UI: confirma/edita ajustes
      UI->>API: PATCH iteration with analyst input
    end
  end

  IM->>UI: revisa corpus (browser de mentions)
  UI->>API: GET /api/corpora/:id/mentions?inclusion_status=pending
  API->>DB: SELECT mentions
  API-->>UI: paginated mentions

  IM->>UI: aprueba corpus
  UI->>API: POST /api/corpora/:id/approve-corpus
  API->>DB: UPDATE study_corpora status=corpus_approved
  API->>DB: UPDATE mentions inclusion_status=included
  API-->>UI: ok
```

---

## 3. Sequence Diagram — Análisis Triggers & Barriers end-to-end

```mermaid
sequenceDiagram
  autonumber
  actor IM as Insights Manager
  participant UI as Studio UI
  participant API as Studio API
  participant Queue as BullMQ
  participant Worker as Analysis Worker
  participant LLM as Claude
  participant Hum as Humanizer
  participant DB as Supabase Postgres

  IM->>UI: "Correr análisis"
  UI->>API: POST /api/corpora/:id/run-analysis
  API->>DB: INSERT analysis_runs (status=queued)
  API->>Queue: enqueue("run_analysis_tb", {corpus_id, run_id})
  API-->>UI: job_id

  Queue->>Worker: pick job
  Worker->>DB: SELECT methodology manifest, corpus mentions

  Note over Worker,LLM: Paso 0 — Pre-flight check (5 puntos)
  Worker->>LLM: prompt: pre_flight_check
  LLM-->>Worker: {decision, blockers}

  alt blockers != []
    Worker->>DB: UPDATE run status=failed, save blockers
    Worker->>UI: notify "pre-flight failed"
  else PROCEDER
    Note over Worker,LLM: Paso 1 — Pase abierto (tags emergentes)
    Worker->>LLM: prompt: tb_paso1 con muestra de 200 mentions
    LLM-->>Worker: tagged_mentions + unique_tags
    Worker->>DB: UPDATE mentions con emergent_tags

    alt < 40 tags emergentes
      Worker->>LLM: retry con prompt refinado
    end

    Note over Worker,LLM: Paso 2 — Codificación 4 layers
    Worker->>LLM: prompt: tb_paso2 con tagged_mentions
    LLM-->>Worker: coded_mentions con polarity + layer
    Worker->>DB: INSERT mention_codings

    Note over Worker,LLM: Paso 3 — Jerarquización 3D
    Worker->>LLM: prompt: tb_paso3 (freq + intensidad + predictiva)
    LLM-->>Worker: jerarquia per (polarity x layer)
    Worker->>DB: INSERT findings con metrics

    Note over Worker,LLM: Paso 4 — Marcar movilidad
    Worker->>LLM: prompt: tb_paso4
    LLM-->>Worker: movilidad + razon per finding
    Worker->>DB: UPDATE findings

    Note over Worker,LLM: Paso 5 — Comparativo (opcional)
    alt has_competitive_corpus
      loop por competidor
        Worker->>LLM: ejecuta pasos 1-4 sobre competitor corpus
      end
      Worker->>DB: INSERT comparative_analysis
    end

    Note over Worker,LLM,Hum: Paso 6 — Síntesis + Humanizer
    Worker->>LLM: prompt: tb_paso6 (narrativos)
    LLM-->>Worker: activation_playbook + friction_removal + comparative_brief
    Worker->>Hum: humanize(all narrative outputs)
    Hum-->>Worker: copy humanizado
    Worker->>DB: UPDATE findings con narrative + cultural_reading

    Note over Worker: Quality gates automatizados
    Worker->>Worker: run 7 quality gates
    alt todos pasan
      Worker->>DB: UPDATE analysis_runs status=approved_for_review
    else algún gate falla
      Worker->>DB: UPDATE analysis_runs status=requires_review
    end

    Worker->>UI: notify "analysis ready for curation"
  end

  IM->>UI: revisa output completo
  UI->>API: GET /api/corpora/:id/findings
  API->>DB: SELECT findings + evidence_quotes
  API-->>UI: paginated

  IM->>UI: edita findings, agrega/quita evidence quotes
  UI->>API: PATCH /api/findings/:id, POST /api/findings/:id/evidence-quotes
  API->>DB: UPDATE/INSERT

  IM->>UI: aprueba output
  UI->>API: POST /api/corpora/:id/approve-output
  API->>DB: UPDATE findings status=published
  API->>DB: UPDATE dashboards status=published, generate client_url_slug
  API-->>UI: ok + client_url

  IM->>UI: presenta al cliente (con KAM)
```

---

## 4. Sequence Diagram — Cliente accede al dashboard

```mermaid
sequenceDiagram
  actor BM as Brand Manager (cliente)
  participant Kinde
  participant UI as Studio UI (portal)
  participant API as Studio API
  participant DB as Supabase

  BM->>Kinde: login
  Kinde-->>BM: session cookie
  BM->>UI: visita /portal
  UI->>API: GET /api/auth/me
  API->>Kinde: validate session
  Kinde-->>API: user info
  API->>DB: SELECT user_brand_access WHERE user_id
  DB-->>API: brands accessible
  API-->>UI: user + accessible_brands

  alt 1 brand accessible
    UI->>UI: redirect to /portal/dashboards/<slug>
  else multiple
    UI->>BM: muestra lista de dashboards
    BM->>UI: click en uno
  end

  UI->>API: GET /api/dashboards/:slug
  API->>DB: SELECT dashboard + findings + evidence + blocks
  API-->>UI: dashboard data
  UI->>BM: renderiza dashboard normal

  BM->>UI: switch to Scrollytelling
  UI->>API: GET /api/dashboards/:slug/scrollytelling
  API-->>UI: misma data, layout scrollytelling
  UI->>BM: renderiza Scrollytelling

  BM->>UI: comenta sobre un finding
  UI->>API: POST /api/dashboards/:slug/comments
  API->>DB: INSERT dashboard_comments
  API-->>UI: ok
  API->>API: notificar a Insights Manager (email + in-app)

  BM->>UI: exporta PDF
  UI->>API: GET /api/dashboards/:slug/export.pdf
  API->>Queue: enqueue("render_pdf", {dashboard_id})
  Note over API,Queue: Async job — UI muestra "generando..."
  Queue-->>UI: PDF ready, descarga
```

---

## 5. State Diagram — lifecycle de un study_corpora

```mermaid
stateDiagram-v2
  [*] --> draft: Insights Manager crea
  draft --> corpus_building: dispara Engine de Validación

  corpus_building --> corpus_building: itera (max 5)
  corpus_building --> corpus_approved: Insights Manager aprueba

  corpus_approved --> analyzing: Insights Manager dispara análisis

  analyzing --> requires_review: quality gates fallan
  analyzing --> approved_for_publication: quality gates pasan

  requires_review --> approved_for_publication: Insights Manager edita y aprueba
  requires_review --> analyzing: Insights Manager dispara re-análisis

  approved_for_publication --> published: KAM da visto bueno, publicado al cliente

  published --> updating: nuevas menciones / edición corpus
  updating --> analyzing: re-análisis

  published --> archived: contrato terminado
  archived --> [*]
```

---

## 6. Flow Diagram — qué se ve en cada vista del Studio

```mermaid
flowchart TB
  Login[Login Kinde]
  Login --> Role{¿Qué rol?}

  Role -->|Insights Manager| IMHome[Studio home: lista brands+themes asignadas]
  Role -->|KAM| KAMHome[Lista de cuentas, status por marca]
  Role -->|UX Data Spec| UXHome[Banco de bloques + Componentes pendientes]
  Role -->|Founder/Admin| AdminHome[Stats globales, gestión de usuarios y orgs]

  Role -->|Brand Manager / Agency| ClientPortal[Portal: dashboards accesibles]

  IMHome --> SelectCorpus[Click en una corpus]
  SelectCorpus --> CorpusView[Vista del corpus]
  CorpusView --> EngineUI[Engine de Validación UI]
  CorpusView --> MentionsBrowser[Browser de mentions]
  CorpusView --> FindingsCuration[Curación de findings]
  CorpusView --> DashboardPreview[Preview del dashboard]
  CorpusView --> PublishAction[Publicar al cliente]

  ClientPortal --> DashboardView[Dashboard normal]
  ClientPortal --> ScrollytellingView[Scrollytelling]
  DashboardView --> Comment[Comentar bloque]
  DashboardView --> Export[Exportar PDF/CSV/MD]
  DashboardView --> ChangeRequest[Pedir cambio]
  ScrollytellingView --> Comment
  ScrollytellingView --> Export
```

---

## 7. Component Diagram — packages del monorepo

```mermaid
flowchart LR
  subgraph Apps
    Website[apps/website]
    Studio[apps/studio]
  end

  subgraph Services
    Workers[services/workers]
  end

  subgraph Packages
    Types[@noisia/types]
    UI[@noisia/ui]
    Blocks[@noisia/blocks]
    Humanizer[@noisia/humanizer]
    Methodologies[@noisia/methodologies]
    QueryEngine[@noisia/query-engine]
    KB[@noisia/kb]
    DB[@noisia/db]
  end

  subgraph External
    Supabase[(Supabase)]
    Kinde[(Kinde)]
    Anthropic[(Claude API)]
    Redis[(Upstash Redis)]
    SentiOne[(SentiOne API)]
  end

  Website --> UI
  Website --> KB
  Studio --> UI
  Studio --> Blocks
  Studio --> Types
  Studio --> DB
  Studio --> Humanizer
  Studio --> Methodologies
  Studio --> Kinde

  Workers --> DB
  Workers --> Types
  Workers --> QueryEngine
  Workers --> Methodologies
  Workers --> Humanizer
  Workers --> Anthropic
  Workers --> SentiOne
  Workers --> Redis

  Blocks --> UI
  QueryEngine --> Types
  QueryEngine --> Methodologies
  Methodologies --> Types
  DB --> Supabase
```

---

## 8. Cómo usar estos diagramas

**En GitHub:** se renderizan automáticamente en `.md` files.

**En VS Code:** instalar extensión "Markdown Preview Mermaid Support".

**Para presentaciones / Figma:** exportar como SVG desde https://mermaid.live/ (pegar el código, descargar SVG).

**Para iterar:** editar el código Mermaid de este archivo. Es mantenible como código, no como imagen estática.

---

## 9. Diagramas pendientes (post-MVP)

```typescript
// TODO mejora-futura: agregar diagramas para:
// - Sequence: WhatsApp notification flow (cuando se implemente)
// - Sequence: Integration UI flow (cuando un Insights Manager configura Apify)
// - State: lifecycle de un comment del cliente (open → addressed → wont_address)
// - Class diagram: jerarquía de Block components en packages/blocks
// - Deployment diagram: cómo se distribuyen apps + workers + DB en Railway
```
