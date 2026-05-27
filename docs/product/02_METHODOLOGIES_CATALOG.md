# Noisia — Catálogo de Metodologías como Sistema

> **Cómo se modelan las 6 metodologías Noisia en la plataforma.** Una metodología es un módulo declarativo, no código hardcoded. Este archivo define el template común y especifica las 6 metodologías que la plataforma debe soportar.

---

## 1. Filosofía

Una metodología Noisia es un **sistema interpretativo estructurado** que se aplica sobre un corpus para producir lecturas accionables. No es un dashboard ni un set de gráficas. Es una lente.

Cada metodología tiene:

- **Pregunta de negocio** que responde (singular, clara).
- **Tipología propia** de codificación (los 4 layers de T&B, los 3 niveles + binarias de Cultural Codes, las 6 funciones de nodo + ties de Influence Architecture, etc.).
- **Fundamentos teóricos** referenciables (Kahneman, Christensen, Nordgren, Geertz, etc.).
- **Inputs típicos** (tamaño de corpus, cobertura de fuentes, ventana temporal).
- **Outputs estandarizados** (matriz/playbook/plan, según metodología).
- **Quality gates** propios.
- **Failure modes conocidos** documentados.

**En la plataforma**, una metodología se representa como un objeto declarativo: prompts para la IA, banco de componentes visuales asociados, formato esperado del output JSON, criterios de validación.

---

## 2. Template común de metodología

Cada metodología registrada en plataforma debe tener este shape:

```yaml
methodology:
  slug: triggers-barriers
  name: Triggers & Barriers
  version: "1.0"
  status: active                    # active | beta | deprecated

  # ── DEFINICIÓN CONCEPTUAL ────────────────────────────────
  business_question: |
    ¿Qué motiva y qué frena la decisión del consumidor en esta categoría
    y dónde tiene tu marca permiso real para actuar?

  when_applies:
    - Lanzamiento de producto con hipótesis de adopción no validada
    - Optimización de funnel cuando la conversión cae sin causa atribuible
    - Defensa competitiva cuando la migración no es de precio
    - Comunicación que busca activar comportamiento

  when_not_applies:
    - Cuando la pregunta es tamaño de mercado / forecasting
    - Cuando no existe categoría establecida
    - Cuando el problema es awareness puro

  theoretical_foundations:
    - author: Kahneman
      year: 2011
      contribution: Dual-Process Theory — distingue sistema 1 vs 2
    - author: Christensen
      year: 2016
      contribution: Jobs-to-be-Done — tipología funcional/emocional/social
    - author: Nordgren_Schonthal
      year: 2021
      contribution: Friction Theory — los 4 tipos de barrier

  # ── ESTRUCTURA INTERNA DE CODIFICACIÓN ───────────────────
  coding_dimensions:
    # Las dimensiones contra las que se codifica cada pieza del corpus
    polarity:
      type: enum
      values: [trigger, barrier]
      required: true
    layer:
      type: enum
      values: [psicologico, personal, social, cultural]
      required: true
      diagnostic_questions:
        psicologico: ¿Pasaría aunque el consumidor estuviera solo, sin presupuesto, sin contexto?
        personal: ¿Cambia si tiene más dinero / tiempo / hábito distinto?
        social: ¿Cambia si nadie va a enterarse jamás que lo usa?
        cultural: ¿Sería cierto solo por lo que la categoría significa en este mercado?

  # ── INPUTS REQUERIDOS ────────────────────────────────────
  inputs:
    corpus:
      minimum_viable: 800
      ideal: 3000
      maximum_useful: 5000
    sources:
      minimum_count: 3
      required_types: [reviews, foro, social]
      ideal_count: 5
    business_question_required: true
    competitive_corpus:
      required: false
      ideal: true
      max_competitors: 3
    time_window:
      maximum_age_months: 9
      ideal_age_months: 6

  # ── OUTPUTS ESPERADOS ────────────────────────────────────
  outputs:
    - id: tb_map
      name: Triggers & Barriers Map
      type: structured_matrix
      format: json
      schema_ref: "schemas/tb_map.json"
    - id: activation_playbook
      name: Activation Playbook
      type: narrative
      length_pages: "1-2"
      sections: [top_triggers_movibles, activation_per_trigger, triggers_a_evitar]
    - id: friction_removal_plan
      name: Friction Removal Plan
      type: narrative
      length_pages: "1-2"
      sections: [top_barriers_movibles, intervention_per_barrier, barriers_estructurales]
    - id: comparative_brief
      name: Comparative Brief
      type: comparative_table
      conditional: requires_competitive_corpus

  # ── COMPONENTES VISUALES (del banco de blocks) ───────────
  default_dashboard_blocks:
    - block_id: hero_stats
      props: { fields: [corpus_size, sources_count, period, layer_distribution] }
    - block_id: tb_matrix_4layers
      props: { layout: "grid_2x4", show_intensity: true }
    - block_id: maturity_per_finding
    - block_id: cultural_tension_cards
      props: { per_layer: true }
    - block_id: evidence_list_top
      props: { per_trigger_barrier: 3 }
    - block_id: brand_pills
    - block_id: action_map
      props: { for: [activation, friction_removal] }
    - block_id: comparative_block
      conditional: requires_competitive_corpus
    - block_id: methodology_note

  scrollytelling_narrative_template:
    sections:
      - intro_business_question
      - corpus_scope
      - per_layer_walkthrough        # los 4 layers como capítulos
      - top_movible_triggers
      - top_movible_barriers
      - structural_warnings
      - methodology_note

  # ── QUALITY GATES ─────────────────────────────────────────
  quality_gates:
    - id: traceability
      description: Cada hallazgo apunta a evidencia en corpus (cita o ID)
      automated: true
    - id: layer_coverage
      description: Los 4 layers están representados o se justifica si alguno está vacío
      automated: true
    - id: 3d_jerarquia
      description: Cada T/B tiene frecuencia + intensidad + capacidad predictiva
      automated: true
    - id: movible_vs_structural
      description: La sección movible/estructural está completa
      automated: true
    - id: limitations_section
      description: Sección "lo que esta corrida no respondió" presente
      automated: true
    - id: confidence_calibrated
      description: Cada hallazgo tiene nivel de confianza
      automated: true
    - id: no_future_projection
      description: Cero proyecciones futuras sin evidencia presente
      automated: false  # human review

  # ── FAILURE MODES CONOCIDOS ──────────────────────────────
  failure_modes:
    - symptom: El layer cultural sale vacío
      cause: Corpus puramente transaccional (solo reviews)
      remediation: Sumar fuentes editoriales / foros / podcasts
    - symptom: Todo se codifica como "psicológico emocional"
      cause: Pase abierto (paso 1) fue superficial
      remediation: Repetir paso 1 con tags más finos
    - symptom: Muchos triggers, pocos barriers
      cause: Corpus sesgado a reviews positivas
      remediation: Sumar foros de queja, reviews 1-3★

  # ── PROMPTS BASE PARA IA ─────────────────────────────────
  ai_prompts:
    pre_flight_check: |
      Eres un analista Noisia ejecutando pre-flight de Triggers & Barriers.
      Valida estos 5 puntos: pregunta de negocio existe, ≥3 fuentes distintas,
      window ≤9 meses, balance triggers/barriers, idioma uniforme.
      Devuelve PASS/FAIL por punto + decisión final.
    paso_1_pase_abierto: |
      Eres un analista Noisia. Aplica Paso 1 del protocolo T&B sobre el
      corpus que sigue. Etiqueta cada pieza con 1-3 tags emergentes en
      lenguaje del corpus mismo. NO uses la tipología de 4 layers todavía.
      Debes producir entre 40-90 tags emergentes.
    paso_2_codificacion: |
      Toma cada tag emergente del paso 1 y aplica dos clasificaciones:
      eje 1 (trigger/barrier) y eje 2 (psicologico/personal/social/cultural).
      Usa los diagnósticos clínicos para asignar layer. <5% del corpus puede
      quedar ambiguo.
    paso_3_jerarquizacion: |
      Para cada combinación T-B × layer, calcula frecuencia, intensidad
      lingüística (1-5) y capacidad predictiva. Reporta las tres, no solo
      frecuencia.
    paso_4_movible_estructural: |
      Para cada hallazgo jerarquizado, marca: movible_por_marca,
      influenciable_parcialmente, estructural.
    paso_5_comparativo: |
      Si hay corpus competitivo, repite pasos 1-4 para cada competidor.
      Construye tabla: triggers compartidos vs diferenciales, barriers
      compartidos vs diferenciales.
    paso_6_sintesis: |
      Con paso 4 completo, redacta los 3 entregables en el JSON spec.
      Aplica el skill humanizer en todos los copys del output.

  # ── MEMORIA QUE DEBE CONSULTAR ───────────────────────────
  memory_consultation:
    industry_memory:
      consulted_at: [pre_flight, paso_1, paso_2]
      query: "Triggers/barriers conocidos en industria {industry} y excepciones a la regla 3-strikes"
    brand_memory:
      consulted_at: [pre_flight, paso_5]
      query: "Análisis previos de {brand} con sus T&B documentados"
    methodology_memory:
      consulted_at: [paso_1, paso_2]
      query: "Tags emergentes que han funcionado en categorías similares, failure modes recientes"
    client_memory:
      consulted_at: [paso_6]
      query: "Preferencias de lenguaje y nivel de detalle de cliente {client}"
```

Este shape debe ser cargable desde un archivo YAML/JSON. Cada metodología nueva = un archivo nuevo. La plataforma lee, registra, y la metodología queda disponible.

---

## 3. Las 6 metodologías

### 3.1 Triggers & Barriers (`triggers-barriers`)

**Estado en plataforma:** PRIMERA A IMPLEMENTAR EN MVP.

| Campo | Detalle |
|---|---|
| **Nombre** | Triggers & Barriers |
| **Objetivo** | Diagnosticar qué motiva y qué frena la decisión del consumidor en una categoría, jerarquizar por layer y por movilidad de marca |
| **Pregunta** | ¿Qué motiva y qué frena la decisión del consumidor en esta categoría — y dónde tiene tu marca permiso real para actuar? |
| **Inputs** | Corpus 800-5000 menciones, ≥3 fuentes, window ≤9 meses, pregunta de negocio explícita, opcional corpus competitivo |
| **Outputs** | T&B Map (matriz 4 layers × T/B), Activation Playbook, Friction Removal Plan, Comparative Brief (si aplica) |
| **Componentes visuales** | Hero stats, T&B Matrix 4 layers, Maturity badges, Cultural Tension Cards, Evidence list top, Brand pills, Action map, Comparative block, Methodology note |
| **Criterios de calidad** | Traceability, layer coverage, 3D jerarquía, movible/estructural marcado, limitaciones explícitas, confianza calibrada, sin proyecciones futuras |
| **Prompts base** | 6 prompts (pre-flight, pase abierto, codificación 4 layers, jerarquización 3D, movible/estructural, síntesis con humanizer) |
| **Memoria** | Industry (T/B conocidos en vertical), brand (análisis previos), methodology (tags exitosos), client (preferencias lenguaje) |
| **Estructura JSON** | Ver `03_TRIGGERS_BARRIERS_DEEPDIVE.md` |

**Spec completa build-ready:** ver archivo dedicado `03_TRIGGERS_BARRIERS_DEEPDIVE.md`.

---

### 3.2 Value Perception Matrix (`value-perception-matrix`)

**Estado en plataforma:** Segunda prioridad. Implementar después de T&B.

| Campo | Detalle |
|---|---|
| **Nombre** | Value Perception Matrix |
| **Objetivo** | Mapear qué dimensión de valor capitaliza una marca vs. competidores, dónde abandona terreno y dónde hay whitespace que ningún competidor ocupa |
| **Pregunta** | ¿Qué dimensión de valor capitaliza tu marca, cuál está abandonando, y dónde hay whitespace que ningún competidor ocupa? |
| **Inputs** | Corpus 1,800 mínimo (600/marca × 3 marcas), ideal 4,500+, requiere ≥2 competidores comparables, window 6-12 meses |
| **Outputs** | Value Perception Matrix (matriz 4 dimensiones costo × 3 dimensiones beneficio), Brand Position Cards (una por marca analizada), Whitespace Map (dónde ningún competidor opera), Defense Brief (qué proteger antes que un competidor lo ocupe) |
| **Componentes visuales** | Hero stats, 4x3 Value Matrix (chart custom), Brand Position Cards radial, Whitespace overlay, Comparative table dimensiones, Evidence list por dimensión, Brand pills, Defense recommendations |
| **Criterios de calidad** | Balance ≥30% del corpus por cada marca, evidencia per cuadrante, valor declarado vs valor percibido distinguidos, gap analysis con cita |
| **Prompts base** | Pre-flight (verifica balance entre marcas), codificación por dimensión, asignación de marca por cuadrante, identificación de whitespace, redacción de Defense Brief |
| **Memoria** | Industry (dimensiones de valor relevantes por vertical), brand (posición histórica), methodology (whitespaces detectados en categorías análogas), competitive set (positioning histórico de cada competidor) |
| **Estructura JSON** | Matriz 4×3 (Costo: monetario/tiempo/cognitivo/social × Beneficio: funcional/emocional/social) con conteos, citas, intensidad por cuadrante por marca |

**Dimensiones de costo percibido (eje 1):** Monetario, Tiempo, Cognitivo, Social.
**Dimensiones de beneficio percibido (eje 2):** Funcional, Emocional, Social.

**Componente visual signature:** Matriz 4×3 con tres marcas superpuestas, cada una mostrando su área de fortaleza.

---

### 3.3 Journey Friction Mapping (`journey-friction-mapping`)

**Estado en plataforma:** Tercera prioridad.

| Campo | Detalle |
|---|---|
| **Nombre** | Journey Friction Mapping |
| **Objetivo** | Mapear dónde se rompe el camino entre intención y acción del consumidor, qué tipo de fricción lo está rompiendo, y qué piezas removerla |
| **Pregunta** | ¿Dónde se rompe el camino entre la intención y la acción — y qué tipo de fricción lo está rompiendo? |
| **Inputs** | Corpus 1,500-4,000 menciones de journey real (no journey idealizado), foros de troubleshooting + reviews + Q&A de marketplaces + soporte transcript si existe, window 6-9 meses |
| **Outputs** | Journey Map (fases × tipos de fricción), Top 5 Choke Points (los puntos donde más se cae el journey), Friction Removal Recommendations (acción por punto crítico), Quick Wins List (fricciones de bajo costo de remoción) |
| **Componentes visuales** | Hero stats, Journey Timeline horizontal con phases, Friction Heatmap (fase × tipo), Choke point cards, Evidence list por choke point, Effort/Impact scatter (4 cuadrantes de removibilidad), Brand pills |
| **Criterios de calidad** | Cada friction codificada con tipo (Inertia/Effort/Emotion/Reactance) Y fase del journey, identificación clara de articulable vs invisible, recommendations con esfuerzo estimado |
| **Prompts base** | Pre-flight (¿journey suficientemente largo?), pase abierto sobre puntos articulados, codificación 4 tipos de fricción × fases, identificación de top choke points, redacción de recommendations |
| **Memoria** | Industry (journeys típicos por vertical), brand (fricciones históricas), methodology (failure modes de JFM), client (qué fricciones ya intentó remover) |
| **Estructura JSON** | Array de fases del journey, por cada fase array de fricciones con tipo, frecuencia, intensidad, impacto en conversión declarado |

**Los 4 tipos de fricción (Nordgren & Schonthal):** Inertia, Effort, Emotion, Reactance.
**Fases del journey:** definibles por industria; default a 5 (Awareness, Consideration, Decision, Purchase, Post-purchase).

---

### 3.4 Cultural Codes Decoding (`cultural-codes-decoding`)

**Estado en plataforma:** Cuarta prioridad. La que ya hemos ejecutado más veces en estudios manuales (Cultural Foresight 2026, The Mexican Home).

| Campo | Detalle |
|---|---|
| **Nombre** | Cultural Codes Decoding |
| **Objetivo** | Detectar qué se legitima, qué se ridiculiza, qué se transgrede en una categoría — los sistemas simbólicos que estructuran qué es deseable o tabú en el mercado |
| **Pregunta** | ¿Qué significa tu categoría en el sistema simbólico de tu consumidor — qué se legitima, qué se ridiculiza, qué se transgrede? |
| **Inputs** | Corpus 1,200-3,000+ de texto largo (foros, blogs, ensayos personales, podcasts transcritos, video transcrito), evitar puramente transaccional, window 6-18 meses para detectar movimientos generacionales |
| **Outputs** | Cultural Codes Map (3 niveles + oposiciones binarias), Tensiones Activas (qué se está moviendo), Whitespace Narrativo (códigos abandonados o no ocupados), Recommendations of Voice (qué tono adoptar/evitar) |
| **Componentes visuales** | Hero stats, 3-niveles waterfall (Superficial → Estructural → Mítico), Oposiciones binarias visualizadas (Frescura/Tradición, etc.), Cultural Tension Cards, Maturity badges (emergente/acelerando/mainstreaming) por código, Evidence list curada por código, Brand pills |
| **Criterios de calidad** | Lectura de los 3 niveles no superficial, oposiciones binarias identificadas explícitamente, distinción entre código vigente vs emergente, evidencia de texto largo (no fragmentos), trazabilidad |
| **Prompts base** | Pre-flight (¿corpus con densidad cultural suficiente?), pase abierto sobre niveles superficiales, ascenso a niveles estructurales, identificación de oposiciones binarias, codificación de madurez por código, síntesis con humanizer |
| **Memoria** | Industry (códigos vigentes en vertical), country/cultural region (códigos de México específicos, registro Cultural Foresight previo), methodology (códigos clásicos en tipos análogos de categorías), brand (posición simbólica histórica) |
| **Estructura JSON** | Array de códigos con: nivel (superficial/estructural/mítico), oposición binaria asociada, madurez, vocabulario representativo, citas, marcas que lo ocupan, marcas que lo abandonaron |

**Los 3 niveles de significación:** Superficial (lo que se ve), Estructural (lo que organiza la categoría), Mítico (la narrativa profunda).

**Componente visual signature:** Cultural Tension Cards de los 4 estudios previos. Ya están validados.

---

### 3.5 Influence Architecture (`influence-architecture`)

**Estado en plataforma:** Quinta prioridad. Requiere más infraestructura (análisis de red, metadata de autores).

| Campo | Detalle |
|---|---|
| **Nombre** | Influence Architecture |
| **Objetivo** | Mapear quiénes diseñan, sin saberlo, el imaginario de una categoría — y cómo se mueve realmente la influencia entre comunidades |
| **Pregunta** | ¿Quiénes diseñan, sin saberlo, el imaginario de tu categoría — y cómo se mueve realmente la influencia entre comunidades? |
| **Inputs** | Corpus 2,000-10,000+ con metadata robusta de autores (handle, comunidad, historial), Discord públicos + subreddits + foros + Twitter/X gaming/specialized, window 6-12 meses |
| **Outputs** | Influence Network Map (nodos + ties), Top 6 Tipos de Nodo identificados, Translation Points (nodos que mueven entre comunidades), Activation Strategy (qué nodos invitar, qué comunidad cultivar) |
| **Componentes visuales** | Hero stats, Network Graph custom (force-directed, color por tipo de nodo), Top Nodes Cards (perfil + función + comunidad), Tie Type Distribution, Cross-community translation flow, Evidence list por nodo, Brand pills |
| **Criterios de calidad** | ≥6 tipos de nodo representados o justificado por qué falta, ties tipificados (mentoría/validación/translación/etc.), distinguir influencer mediático vs nodo arquitectónico, evidencia de cross-community |
| **Prompts base** | Pre-flight (¿hay metadata suficiente de autores?), identificación de nodos por función, codificación de ties entre nodos, detección de translation points, recommendations de activación |
| **Memoria** | Industry (tipos de nodo comunes en vertical), brand (qué nodos ya conoce/contrató), methodology (failure modes IA), community map (comunidades activas en MX por vertical) |
| **Estructura JSON** | Nodes array (con función, tipo, comunidad, métricas) + Edges array (entre nodos, tipo de tie, intensidad), + Top recomendaciones de activación |

**Los 6 tipos de nodo:** Architect (define vocabulary), Translator (mueve entre comunidades), Amplifier (eleva volumen), Validator (otorga credibilidad), Practitioner (prueba y reporta), Critic (defiende estándares).

**Componente visual signature:** Network Graph interactivo con clustering por comunidad.

---

### 3.6 Decision Velocity (`decision-velocity`)

**Estado en plataforma:** ÚLTIMA PRIORIDAD. Considerar posponer 6 meses post-MVP. Requiere journey data más sofisticada.

| Campo | Detalle |
|---|---|
| **Nombre** | Decision Velocity |
| **Objetivo** | Diagnosticar por qué el consumidor decide rápido en una categoría y lento en otra, y qué arquitectura de elección altera esa velocidad |
| **Pregunta** | ¿Por qué el consumidor decide rápido en una categoría y lento en la tuya — y qué arquitectura de elección altera esa velocidad? |
| **Inputs** | Corpus 1,000-3,000 narrativo (incluye descripciones de proceso de decisión), e-commerce reviews + foros de comparación + YouTube comparativas + TikTok decision content, window 3-9 meses, ideal con data de funnel del cliente |
| **Outputs** | Velocity Diagnosis (categoría rápida/lenta/mixta vs benchmark), Slowdown Causes (qué frena), Speedup Levers (qué acelera), Architecture Recommendations (cambios al choice architecture) |
| **Componentes visuales** | Hero stats, Velocity Gauge custom, 3-fases × 2-sistemas matrix, Slowdown causes ranking, Levers map, A/B hypothesis cards (para testear después), Brand pills |
| **Criterios de calidad** | Cada hallazgo codificado con fase del journey × sistema (1/2), velocity declarada vs inferida distinguidas, hypothesis testeable identificada |
| **Prompts base** | Pre-flight (¿hay narrativa suficiente de decisión?), codificación 3 fases × 2 sistemas, identificación de slowdowns, derivación de levers, redacción de A/B hypotheses |
| **Memoria** | Industry (velocity benchmarks por vertical), brand (cambios al funnel históricos), methodology (failure modes DV), client (cambios al UX previos) |
| **Estructura JSON** | Velocity assessment con benchmark, slowdowns array (por fase × sistema), levers array (con effort/impact), hypothesis array (testeable A/B) |

**Las 3 fases del journey de decisión:** Initiation, Evaluation, Commitment.
**Los 2 sistemas (Kahneman):** Sistema 1 (intuitivo), Sistema 2 (deliberativo).

---

## 4. Banco de componentes visuales

Cada metodología hace referencia a bloques del banco. El banco crece con cada metodología nueva.

### 4.1 Bloques universales (cualquier metodología)

| Block ID | Nombre | Para qué sirve | Quién lo usa default |
|---|---|---|---|
| `hero_stats` | Hero Stats | 6 números clave del corpus (volumen, fuentes, periodo, etc.) | Todas |
| `methodology_note` | Methodology Note | Mini explicación de cómo se llegó al output | Todas |
| `brand_pills` | Brand Pills | Detección visual de marca en cita | Todas con corpus |
| `evidence_list_top` | Evidence List Top N | Citas curadas con plataforma/fecha/MX tag | Todas |
| `cultural_tension_cards` | Cultural Tension Cards | Tensión + cita + implicación | T&B, Cultural Codes, JFM |
| `maturity_badges` | Maturity Badges | Emergente / Acelerando / Mainstreaming | Cultural Codes principalmente |
| `comparative_block` | Comparative Block | Comparativo entre marcas o periodos | T&B competitive, VPM, todos con comparativos |
| `monthly_pulse` | Monthly Pulse | Línea de evolución mensual | Todas con histórico |
| `action_map` | Action Map | Tabla Hacer/Evitar/Categorías | T&B, VPM |

### 4.2 Bloques específicos por metodología

| Block ID | Para metodología | Función |
|---|---|---|
| `tb_matrix_4layers` | T&B | Matriz 4 layers × T/B con intensidad |
| `tb_layer_walkthrough` | T&B Scrollytelling | Capítulo por layer |
| `vpm_matrix_4x3` | VPM | Matriz 4 dimensiones costo × 3 beneficio |
| `vpm_brand_position` | VPM | Radial chart de posición de marca |
| `whitespace_overlay` | VPM | Donde ningún competidor opera |
| `journey_timeline` | JFM | Timeline horizontal de fases |
| `friction_heatmap` | JFM | Heatmap fase × tipo de fricción |
| `choke_point_cards` | JFM | Top puntos críticos del journey |
| `effort_impact_scatter` | JFM | 4 cuadrantes de removibilidad |
| `cultural_codes_waterfall` | Cultural Codes | Niveles superficial → estructural → mítico |
| `binary_oppositions` | Cultural Codes | Frescura/Tradición visualizada |
| `network_graph` | IA | Force-directed con clusters |
| `top_nodes_cards` | IA | Cards de nodos arquitectónicos |
| `tie_type_distribution` | IA | Tipos de relación entre nodos |
| `velocity_gauge` | DV | Velocidad de decisión vs benchmark |
| `slowdown_ranking` | DV | Top causas que frenan |
| `lever_map` | DV | Palancas de aceleración |
| `hypothesis_cards` | DV | A/B testeables |

### 4.3 Cómo se registra un bloque nuevo

Cuando el UX Data Specialist diseña un bloque custom para un cliente:

1. Diseña en código (componente React/Vue versionado).
2. Lo registra en el banco con metadata: ID, nombre, props acepta, screenshot demo, casos de uso.
3. Lo etiqueta como `methodology_compatible: [list]` o `universal: true`.
4. Queda disponible para futuros estudios.

Reglas:
- No se puede crear un bloque que duplique uno existente. UX Data Specialist primero busca.
- Bloques deprecated se marcan, no se borran (auditoría).
- Bloques con bugs reportados se desactivan globalmente hasta fix.

---

## 5. Cómo la plataforma usa este catálogo

### 5.1 Cuando el Insights Manager crea un estudio nuevo

1. Selecciona marca (de las que tiene asignadas).
2. Selecciona metodología del catálogo.
3. La plataforma carga el manifest YAML/JSON de esa metodología.
4. Pre-puebla: brand seeds, signal phrases, formulario de contexto, dashboard template, prompts IA.
5. Insights Manager confirma o ajusta.

### 5.2 Cuando la IA ejecuta el análisis

1. Lee el manifest de la metodología.
2. Consulta las memorias indicadas (industry, brand, methodology, client).
3. Ejecuta los prompts en orden.
4. Produce JSON cumpliendo el schema del output.
5. Aplica quality gates automatizados.
6. Marca con flag los que requieren revisión humana.

### 5.3 Cuando se renderiza el dashboard

1. El frontend lee la lista de `default_dashboard_blocks` de la metodología.
2. Renderiza cada bloque del banco con la data del output JSON.
3. El Insights Manager puede activar/desactivar bloques opcionales.
4. La Scrollytelling vista usa el `scrollytelling_narrative_template` para ordenar.

### 5.4 Cuando una metodología se actualiza

1. Edición del manifest YAML/JSON.
2. Versionado en git: nueva versión, motivo del cambio.
3. Estudios existentes mantienen versión anterior hasta que el Insights Manager re-corra.
4. Plataforma muestra "última versión disponible" + opción de re-correr.

---

## 6. Roadmap de implementación

| Sprint | Metodología | Estado |
|---|---|---|
| MVP (Fases 1-5) | T&B | Implementación completa |
| Post-MVP mes 6-8 | VPM | Implementación |
| Post-MVP mes 9-11 | JFM | Implementación |
| Post-MVP mes 12-14 | Cultural Codes | Implementación |
| Post-MVP mes 15-17 | Influence Architecture | Implementación |
| Post-MVP mes 18+ | Decision Velocity | Evaluación si se mantiene o se posterga |

**Por qué este orden:**

1. **T&B** primero porque es el más demandado comercialmente y el mejor documentado en el KB.
2. **VPM** segundo porque comparte estructura de codificación con T&B (eje doble) y permite vender Intelligence tier con dos metodologías cruzadas.
3. **JFM** tercero porque conecta con T&B (barriers de fricción) y permite oferta combinada para clientes de e-commerce/SaaS.
4. **Cultural Codes** cuarto porque ya tenemos experiencia ejecutándolo manualmente (Cultural Foresight 2026, The Mexican Home) — el componente visual ya está validado.
5. **Influence Architecture** quinto porque requiere infraestructura de red más sofisticada (graph database o postgres con plugin).
6. **Decision Velocity** último porque requiere data de funnel del cliente y la oferta para esto puede no madurar hasta tener varios clientes establecidos.
