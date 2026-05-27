# Triggers & Barriers — Spec build-ready

> La primera metodología que la plataforma debe ejecutar end-to-end. Este archivo es a nivel de implementación: prompts exactos, schemas JSON, layouts de UI, criterios de validación.

---

## 1. Resumen ejecutivo de la metodología

T&B responde una pregunta: **¿qué motiva y qué frena la decisión del consumidor en una categoría, y dónde tiene la marca permiso real para actuar?**

El protocolo codifica cada pieza del corpus contra **dos ejes simultáneos**:

1. **Polaridad:** trigger (impulso hacia la decisión) o barrier (freno).
2. **Layer:** psicológico / personal / social / cultural.

Sin esta doble codificación, el output colapsa motivaciones distintas y borra patrones accionables. Una marca puede mover triggers psicológicos y personales casi por completo, parcialmente los sociales, y rara vez los culturales. Confundir un barrier cultural con uno psicológico lleva a campañas que invierten millones tratando de mover algo que no se mueve.

---

## 2. Flujo en la plataforma

```
Insights Manager crea estudio
  → selecciona marca: "Seguros El Potosí"
  → selecciona metodología: "Triggers & Barriers"
  → la plataforma carga manifest T&B
  → llena formulario de contexto
       (competidores, audiencia, decisión de negocio, exclusiones iniciales)
  → confirma
        ↓
Engine de Validación de Queries
  → genera primer query con brand_seeds + signal_phrases T&B + memoria industria seguros
  → corre contra SentiOne API
  → IA evalúa: densidad, balance, ruido
  → Insights Manager confirma o ajusta en puntos críticos
  → loop hasta corpus aprobado (~12 meses de historia)
        ↓
Pre-flight check (5 puntos)
  → si falla, NO procede
        ↓
Paso 1 — Pase abierto (clasificación emergente)
  → IA produce 40-90 tags emergentes
  → criterio de éxito visible al Insights Manager
        ↓
Paso 2 — Codificación 4 layers
  → cada pieza recibe polaridad + layer
  → <5% ambiguos
        ↓
Paso 3 — Jerarquización tridimensional
  → frecuencia + intensidad lingüística + capacidad predictiva por combinación
        ↓
Paso 4 — Marcar movible vs estructural
  → cada T/B clasificado
        ↓
Paso 5 — Comparativo (si aplica)
  → repite 1-4 para cada competidor
  → genera tabla cruzada
        ↓
Paso 6 — Síntesis JSON
  → produce 3 (o 4) entregables
  → aplica skill humanizer a todos los copys
        ↓
Quality gates automatizados
  → 7 checks; si falla cualquiera, marca para revisión
        ↓
Curación humana del Insights Manager
  → revisa hallazgos, citas, jerarquización
  → puede editar corpus, re-disparar
  → aprueba output
        ↓
KAM da visto bueno
        ↓
Publicar al cliente
  → dashboard normal disponible
  → scrollytelling disponible
  → notificación WhatsApp programada según patrones
```

---

## 3. Inputs requeridos

### 3.1 Configuración inicial (formulario)

Campos obligatorios al iniciar un estudio T&B:

```yaml
study_setup:
  brand:
    name: "Seguros El Potosí"
    competitors:
      - "Allianz"
      - "AXA"
      - "GNP"
      - "Qualitas"
    industry: "seguros"
    industry_sub: "auto"
    audience_segment: "Hombres y mujeres 28-55, NSE B/C+, dueños de auto en MX"
    geo: ["MX"]

  business_question: |
    ¿Qué motiva la contratación de un seguro de auto y qué la frena,
    y dónde tiene Seguros El Potosí permiso para actuar frente a Allianz/GNP/AXA?

  decision_to_inform: |
    Diseño de la campaña de aniversario Q3 2026 y ajuste a la
    propuesta de cobertura para nuevos contratantes.

  context_uploads:
    - prior_research_files: []  # PDFs/MDs previos si existen
    - brand_guidelines_url: ""
    - kpi_dashboard_url: ""

  exclusions_initial:
    - "casas de empeño Potosí"  # ambiguidad de nombre
    - "Potosí municipio"
    - "Potosí turismo"

  corpus_target:
    window_months: 12
    minimum_mentions: 1500
    ideal_mentions: 4000
```

### 3.2 Validación pre-corrida (gates automáticos)

La plataforma no permite pasar a Engine si:

- `business_question` está vacío.
- `competitors` tiene <1 entrada.
- `audience_segment` está vacío.
- `corpus_target.window_months` >18 o <3.

---

## 4. Engine de Validación de Queries para T&B

### 4.1 Primer query — composición

El Engine combina 4 fuentes de seeds:

```python
query_seeds = {
  "brand_seeds": [
    "Seguros El Potosí",
    "Seguro El Potosí",
    "El Potosí Seguros",
    "@SegurosElPotosi",
  ],
  "competitor_seeds": [
    "Allianz seguro auto", "AXA seguro auto",
    "GNP seguro auto", "Qualitas seguro auto"
  ],
  "category_seeds": [
    "seguro auto", "seguro de auto", "seguro coche",
    "póliza auto", "póliza coche", "aseguradora auto"
  ],
  "trigger_phrases_tb": [
    # Triggers de adopción genéricos T&B en categoría seguros
    "vale la pena el seguro", "me sirvió el seguro",
    "el seguro me cubrió", "me salvó el seguro",
    "ya tengo seguro porque", "tomé el seguro por",
    "recomiendo este seguro", "el mejor seguro auto"
  ],
  "barrier_phrases_tb": [
    # Barriers de adopción genéricos T&B en categoría seguros
    "no me quieren pagar", "seguro carísimo", "no sirve el seguro",
    "estafa de seguro", "cancelaron mi seguro",
    "letra chica seguro", "no me alcanza para el seguro",
    "ni vale la pena pagar seguro", "me cobraron sin avisar el seguro"
  ],
  "global_exclusions": [
    "casas de empeño Potosí", "Potosí municipio",
    "Potosí turismo", "Potosí estado",
    # + standard noise exclusions
  ]
}
```

### 4.2 Loop de validación

```
ITER 1: corre query → SentiOne devuelve N menciones + muestra
        ↓
IA evalúa la muestra (50 menciones aleatorias):
  - Densidad temática (¿hablan de seguros realmente? o aparece "El Potosí" en otros contextos?)
  - Balance triggers/barriers (¿hay ambos polos?)
  - Cobertura de fuentes (¿>=3 plataformas distintas?)
  - Balance brand vs competitors (¿se mencionan los competidores también?)
  - Idioma consistente (¿todo ES?)
  - Geo MX (¿es conversación mexicana?)
        ↓
Si calidad >75% → corpus pre-aprobado, mostrar al Insights Manager
Si calidad 50-75% → IA propone 2-3 ajustes (agregar phrase X, excluir phrase Y, sumar fuente Z)
                    Insights Manager confirma cuáles aplicar
Si calidad <50% → Replantear: tal vez el nombre de marca tiene problema de ambigüedad sistemático,
                  o falta brand handle, o competidor mal definido.
                  Solicita al Insights Manager rediseñar antes de iterar más
        ↓
ITER 2-N: repite con ajustes
        ↓
Corpus aprobado cuando calidad >85% AND volumen >= corpus_target.minimum
```

### 4.3 Output del Engine al final

```yaml
corpus_approved:
  total_mentions: 3247
  sources:
    - { name: "tiktok", count: 824, pct: 25.4 }
    - { name: "facebook", count: 612, pct: 18.8 }
    - { name: "youtube", count: 589, pct: 18.1 }
    - { name: "x", count: 511, pct: 15.7 }
    - { name: "reddit", count: 287, pct: 8.8 }
    - { name: "reviews", count: 424, pct: 13.0 }
  iterations: 4
  pipeline_version: "tb-engine-2026.05.20"
  approved_by: "insights_manager_id"
  approved_at: "2026-05-22T10:34:00Z"
  notes_from_manager: |
    Iter 3 ajustamos para excluir comentarios sobre "seguro de vida"
    que aparecían por keyword "vale la pena seguro" mal interpretado.
```

---

## 5. Prompts IA para cada paso del protocolo

### 5.1 Prompt — Pre-flight check

```
Rol: Eres un analista Noisia ejecutando pre-flight check de Triggers & Barriers
sobre un corpus capturado.

Contexto:
- Marca: {brand_name}
- Metodología: Triggers & Barriers
- Pregunta de negocio: {business_question}
- Tamaño del corpus: {total_mentions}
- Fuentes: {sources_list}
- Window temporal: {window_months} meses

Tu tarea: validar 5 puntos. Por cada uno responde PASS o FAIL con razón breve
(<25 palabras). Al final da decisión: PROCEDER o ABORTAR.

Puntos:
1. ¿Existe la pregunta de negocio en una frase explícita? (no genérica)
2. ¿El corpus cubre ≥3 fuentes distintas con balance razonable (ninguna >60%)?
3. ¿La window temporal es ≤9 meses? (>9 meses = advertir explícitamente)
4. ¿Hay balance mínimo visible entre triggers (lenguaje positivo) y
   barriers (quejas, frustración, abandono)?
5. ¿Idioma del corpus es uniformemente español? (mezcla = separar)

Si CUALQUIERA falla, decisión = ABORTAR. Output formato JSON:

{
  "checks": [
    { "id": "business_question", "result": "PASS", "reason": "..." },
    ...
  ],
  "decision": "PROCEDER",
  "blockers": []
}
```

### 5.2 Prompt — Paso 1: Pase abierto

```
Rol: Eres un analista Noisia ejecutando Paso 1 del protocolo Triggers & Barriers.

Contexto:
- Marca: {brand_name}
- Industria: {industry}
- Pregunta de negocio: {business_question}

Te entrego un corpus de {N} menciones de conversación digital sobre la categoría.

Tu tarea: leer cada pieza y asignarle 1-3 tags emergentes en lenguaje del
corpus mismo (no en lenguaje académico, no en lenguaje de marketing).

Ejemplos de tags emergentes válidos (categoría hipotética skincare):
- "miedo a empeorar la piel"
- "no me cabe en la rutina"
- "todas mis amigas la usan"
- "me da hueva poner crema"

Ejemplos de tags INVÁLIDOS:
- "Trigger emocional" (eso es codificación contra protocolo, no emergente)
- "Layer psicológico" (idem)
- "Sentimiento negativo" (genérico, no en lenguaje del consumidor)

Criterio de éxito al final del paso 1:
- ENTRE 40 Y 90 tags únicos emergentes
- Si terminas con <40 = el pase fue superficial, REPITE
- Si terminas con >90 = faltó agrupación intermedia, AGRUPA antes de entregar

Para cada mención, agrega: id_mencion → array de tags

Output formato JSON:
{
  "tags_emergentes_total": 67,
  "tagged_mentions": [
    { "mention_id": "abc-123", "tags": ["letra chica", "no me cubrió cuando lo necesité"] },
    ...
  ],
  "unique_tags_with_counts": [
    { "tag": "letra chica", "count": 234, "sample_mention_ids": [...] },
    ...
  ]
}
```

### 5.3 Prompt — Paso 2: Codificación 4 layers

```
Rol: Eres un analista Noisia ejecutando Paso 2 del protocolo Triggers & Barriers.

Contexto:
- Paso 1 produjo {N} tags emergentes (ver tagged_mentions adjunto)
- Tu tarea: aplicar DOS clasificaciones simultáneas a cada pieza:

  Eje 1 — Polaridad:
    trigger = empuja hacia la decisión (contratar el seguro)
    barrier = frena la decisión

  Eje 2 — Layer:
    psicologico, personal, social, cultural

Para asignar layer, usa estos diagnósticos clínicos:

  ¿Pasaría aunque el consumidor estuviera solo, sin presupuesto,
  sin contexto social ni cultural?
    → SI = psicologico

  ¿Cambia si tiene más dinero / más tiempo / hábito distinto / autoidentidad distinta?
    → SI = personal

  ¿Cambia si nadie va a enterarse jamás que lo usa?
    → SI = social

  ¿Sería cierto incluso sin amigos ni redes, solo por lo que la categoría significa
  culturalmente en este mercado?
    → SI = cultural

EDGE CASE — overlap entre layers:
  Si una pieza tiene componentes de varios layers, asigna el layer DOMINANTE
  (el que si lo quitas, la fuerza desaparece) y anota el secundario en metadata.

Criterio de éxito:
  - Cada pieza tiene exactamente UNA polaridad + UN layer dominante
  - <5% del corpus puede quedar como "ambiguo"
  - Si >5% ambiguo = el paso 1 fue débil, REGRESA y refina tags

Output formato JSON:
{
  "stats": {
    "total_clasificadas": 3247,
    "pct_ambiguas": 0.034,
    "distribution": {
      "psicologico": { "triggers": 412, "barriers": 287 },
      "personal":    { "triggers": 524, "barriers": 638 },
      "social":      { "triggers": 198, "barriers": 132 },
      "cultural":    { "triggers": 89,  "barriers": 234 }
    }
  },
  "coded_mentions": [
    {
      "mention_id": "abc-123",
      "polarity": "barrier",
      "layer": "personal",
      "secondary_layer": "psicologico",
      "tags_emergentes_pertenece": ["letra chica", "no me cubrió"],
      "ambiguous": false
    },
    ...
  ]
}
```

### 5.4 Prompt — Paso 3: Jerarquización tridimensional

```
Rol: Eres un analista Noisia ejecutando Paso 3 del protocolo T&B.

Contexto: tienes el corpus codificado del Paso 2.

Tu tarea: para cada combinación (polaridad × layer), agrupar las piezas
por TAG EMERGENTE y para cada grupo calcular tres métricas:

1. FRECUENCIA = número de piezas en ese grupo
2. INTENSIDAD LINGÜÍSTICA = promedio de intensidad en escala 1-5
   1: Mención neutra ("lo tengo desde hace 2 años")
   2: Preferencia leve ("me gusta más que la otra")
   3: Preferencia clara con razón ("esto sí me cubrió, las otras no")
   4: Afirmación intensa, lenguaje afectivo ("amo a esta aseguradora")
   5: Lenguaje extremo, identitario o catártico
      ("esta aseguradora literalmente me salvó la vida y mi patrimonio")
   Aplica equivalente para barriers.

3. CAPACIDAD PREDICTIVA = % de piezas que coocurren con decisión declarada
   Marcadores de decisión:
   - Contratar/Compra: "lo contraté", "ya lo tengo", "lo voy a pedir"
   - Abandono: "lo cancelé", "ya no lo uso", "cambié a otra"
   - Recomendación: "se lo recomendé a", "todas mis amigas tienen que probarlo"

Para cada grupo, calcula los 3 ejes. REPORTA LOS 3, NO SOLO FRECUENCIA.

Una combinación con frecuencia 12 + intensidad 4.6 + predictiva 78% PESA MÁS
que una con frecuencia 200 + intensidad 2.1 + predictiva 11%.

Output formato JSON:
{
  "jerarquia": {
    "psicologico": {
      "triggers": [
        {
          "id": "T-PSI-01",
          "nombre": "tranquilidad de saber que estás cubierto",
          "frecuencia": 312,
          "intensidad_promedio": 3.8,
          "capacidad_predictiva": 0.62,
          "score_compuesto": 4.7,
          "cita_representativa": "...",
          "mention_ids_sample": [...]
        },
        ...
      ],
      "barriers": [...]
    },
    "personal":   { ... },
    "social":     { ... },
    "cultural":   { ... }
  }
}

(score_compuesto = freq_normalized * 0.4 + intensidad * 0.3 + predictiva * 0.3)
```

### 5.5 Prompt — Paso 4: Movible vs Estructural

```
Rol: Analista Noisia. Paso 4 del protocolo T&B.

Para cada hallazgo jerarquizado del Paso 3, marca uno de:

- movible_por_marca: la marca puede activar/disolver con producto,
  comunicación, formato o precio. Típicamente layers psicologico/personal.

- influenciable_parcialmente: la marca puede mover el dial pero no controlar.
  Típicamente layer social.

- estructural: fuera del control de la marca. Típicamente layer cultural.
  Solo se puede elegir alinearse o salirse.

Esta clasificación alimenta directamente:
- Movibles → Activation Playbook (triggers) y Friction Removal Plan (barriers)
- Estructurales → recomendación de alinearse/salirse

Output formato JSON (extiende el output del paso 3):
{
  "jerarquia": {
    "psicologico": {
      "triggers": [
        {
          "id": "T-PSI-01",
          ...,
          "movilidad": "movible_por_marca",
          "movilidad_razon": "Tranquilidad como argumento se construye con tono
            y testimonio en comunicación; está en la mano de la marca."
        },
        ...
      ]
    },
    ...
  }
}
```

### 5.6 Prompt — Paso 5: Comparativo (si aplica)

```
Rol: Analista Noisia. Paso 5 del protocolo T&B.

Si hay corpus competitivo (Allianz, AXA, GNP, Qualitas), corre Pasos 1-4 sobre
cada uno.

Construye tabla cruzada:

| Hallazgo | Seguros El Potosí | Allianz | AXA | GNP | Qualitas |
|----------|---|---|---|---|---|
| T-PSI-01 tranquilidad | freq 312, intensidad 3.8 | 524, 4.1 | ... | ... | ... |
| B-PER-03 letra chica | freq 287, intensidad 4.3 | 198, 3.9 | ... | ... | ... |

Identifica:
1. TRIGGERS COMPARTIDOS: aparecen en todas las marcas, no diferencian.
2. TRIGGERS DIFERENCIALES: presentes solo en una o dos marcas, son ventaja relativa.
3. BARRIERS COMPARTIDOS: universal de categoría seguros.
4. BARRIERS DIFERENCIALES: específicos de la marca, oportunidad de diferenciación.

Output JSON:
{
  "comparativo": {
    "marcas_analizadas": ["Seguros El Potosí", "Allianz", "AXA", "GNP", "Qualitas"],
    "triggers_compartidos": [...],
    "triggers_diferenciales": [
      { "id": "T-...", "presente_en": ["Seguros El Potosí", "Qualitas"], "ausente_en": [...] }
    ],
    "barriers_compartidos": [...],
    "barriers_diferenciales": [...],
    "lectura_estrategica": "..."
  }
}
```

### 5.7 Prompt — Paso 6: Síntesis con humanizer

```
Rol: Analista Noisia. Paso 6 final del protocolo T&B.

Con todos los outputs de pasos 1-5 disponibles, redacta los 3 entregables
narrativos. APLICA EL SKILL HUMANIZER en todos los copys.

Reglas del humanizer (aplicar antes de escribir, no después):
- Cero "underscore", "pivotal", "landscape", "enduring", "tapestry"
- Cero "no es X, es Y" como construcción retórica
- Cero em dashes mid-sentence
- Cero "rule of three" forzado
- Cero generic positive conclusions
- Variar ritmo de frases
- Usar primera persona cuando aplique
- Acknowledger complejidad

ENTREGABLE 1 — Activation Playbook (1-2 páginas):

Sección 1: Top 3 triggers movibles
  Por cada uno: nombre, layer, evidencia (cita), acción recomendada.

Sección 2: Por cada trigger, medio recomendado, tono, riesgo de saturación.

Sección 3: Triggers a evitar (los agotados en categoría).

ENTREGABLE 2 — Friction Removal Plan (1-2 páginas):

Sección 1: Top 3 barriers movibles
  Por cada uno: nombre, layer, evidencia, hipótesis de remoción.

Sección 2: Por cada barrier, intervención (producto/comunicación/formato/precio),
nivel de inversión, indicador de éxito.

Sección 3: Barriers estructurales. Recomendación: ignorar o salirse.

ENTREGABLE 3 — Comparative Brief (1 página, si aplica)

Tabla + lectura estratégica.

Output JSON: ver schema completo en sección 6.
```

---

## 6. Schema del output JSON final

```json
{
  "meta": {
    "study_id": "uuid",
    "brand": "Seguros El Potosí",
    "methodology": "triggers-barriers",
    "methodology_version": "1.0",
    "pipeline_version": "tb-engine-2026.05.20",
    "executed_at": "2026-05-22T15:00:00Z",
    "approved_by_insights_manager": "user_id",
    "approved_at": "2026-05-23T11:00:00Z"
  },

  "corpus_snapshot": {
    "total_mentions": 3247,
    "sources": [
      { "name": "tiktok", "count": 824, "pct": 25.4 },
      ...
    ],
    "window": {
      "start": "2025-05-01",
      "end": "2026-04-30",
      "months": 12
    },
    "language": "es",
    "geo": ["MX"]
  },

  "business_question": "...",
  "decision_to_inform": "...",

  "matriz_tb_layers": {
    "psicologico": {
      "triggers": [
        {
          "id": "T-PSI-01",
          "nombre_comercial": "Tranquilidad de saber que estás cubierto",
          "evidence": {
            "frecuencia": 312,
            "intensidad_promedio": 3.8,
            "capacidad_predictiva": 0.62
          },
          "score_compuesto": 4.7,
          "movilidad": "movible_por_marca",
          "movilidad_razon": "...",
          "cita_protagonista": {
            "text": "...",
            "platform": "tiktok",
            "date": "2026-03",
            "url": "...",
            "mx": true
          },
          "citas_apoyo": [...3-5 más...],
          "mention_ids_sample": [...]
        },
        ...
      ],
      "barriers": [...]
    },
    "personal":   { "triggers": [...], "barriers": [...] },
    "social":     { "triggers": [...], "barriers": [...] },
    "cultural":   { "triggers": [...], "barriers": [...] }
  },

  "activation_playbook": {
    "top_triggers_movibles": [...3 items],
    "por_trigger_recomendacion": [
      {
        "trigger_id": "T-PSI-01",
        "medio_recomendado": "video corto + testimonial",
        "tono_recomendado": "cercano, sin solemnidad, con cita real de cliente",
        "riesgo_saturacion": "bajo",
        "categoria_donde_aplica": ["digital", "OOH selectivo"]
      },
      ...
    ],
    "triggers_a_evitar": [
      {
        "trigger_id": "T-PER-04",
        "razon": "Agotado en categoría — todos los competidores lo usan",
        "evidencia_competitiva": "..."
      }
    ]
  },

  "friction_removal_plan": {
    "top_barriers_movibles": [...3 items],
    "por_barrier_intervencion": [
      {
        "barrier_id": "B-PER-03",
        "intervencion_sugerida": "Rediseñar comunicación de letra chica con resumen visual de 3 puntos clave en cada poliza",
        "tipo_intervencion": "comunicacion",
        "inversion_estimada": "media",
        "indicador_exito": "Reducción de mentions 'letra chica' en próximo trimestre, monitoreado en plataforma",
        "responsable_sugerido": "Equipo de Producto Seguros + Agencia Creativa"
      },
      ...
    ],
    "barriers_estructurales": [
      {
        "barrier_id": "B-CUL-02",
        "nombre": "Desconfianza generalizada a aseguradoras en México",
        "razon_estructural": "Código cultural de la categoría",
        "recomendacion": "No combatir directamente. Alinearse con narrativa de transparencia o construir desde whitespace alternativo."
      }
    ]
  },

  "comparative_brief": {
    "marcas_analizadas": [...],
    "triggers_compartidos": [...],
    "triggers_diferenciales": [...],
    "barriers_compartidos": [...],
    "barriers_diferenciales": [...],
    "lectura_estrategica": "..."
  },

  "limitations_de_esta_corrida": [
    "El layer cultural está sub-representado porque el corpus se concentró en plataformas transaccionales (reviews, comments en video). Para próxima corrida, sumar foros y blogs editoriales de personal finance.",
    "El window temporal no cubre evento de huracán Q4 2025 que pudo activar barriers temporales no representados aquí.",
    "Comparativo con Qualitas es menos robusto (n=287) que con Allianz/AXA. Reportar como dirección, no como conclusión."
  ],

  "confidence_per_finding": {
    "T-PSI-01": "alta",
    "T-PER-02": "media",
    "B-CUL-02": "alta",
    "T-SOC-01": "baja_direccional"
  }
}
```

---

## 7. Layout del Dashboard de T&B

### 7.1 Dashboard normal — estructura

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
│  Seguros El Potosí — Triggers & Barriers                         │
│  Mayo 2026 · 3,247 menciones · 12 meses · 6 plataformas          │
│                                                                  │
│  [Filtros: Marca · Layer · Polaridad · Periodo · Plataforma]    │
└─────────────────────────────────────────────────────────────────┘

┌─── HERO STATS BLOCK ─────────────────────────────────────────────┐
│                                                                  │
│  3,247          12 meses        6 plataformas      4 layers      │
│  menciones      de escucha      observadas          analizados    │
│                                                                  │
│  18%            44%             71%                 4            │
│  cultural       movibles        confianza alta      competidores  │
│  layer          marca puede     hallazgos           comparados    │
└─────────────────────────────────────────────────────────────────┘

┌─── TB MATRIX 4 LAYERS BLOCK ─────────────────────────────────────┐
│                                                                  │
│             TRIGGERS                          BARRIERS           │
│  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │ PSICOLÓGICO             │  │ PSICOLÓGICO             │       │
│  │ T-PSI-01 tranquilidad   │  │ B-PSI-01 miedo letra... │       │
│  │ T-PSI-02 alivio cuando  │  │ B-PSI-02 ansiedad...    │       │
│  │ T-PSI-03 ...            │  │ ...                     │       │
│  └─────────────────────────┘  └─────────────────────────┘       │
│  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │ PERSONAL                │  │ PERSONAL                │       │
│  │ ...                     │  │ ...                     │       │
│  └─────────────────────────┘  └─────────────────────────┘       │
│  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │ SOCIAL                  │  │ SOCIAL                  │       │
│  │ ...                     │  │ ...                     │       │
│  └─────────────────────────┘  └─────────────────────────┘       │
│  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │ CULTURAL                │  │ CULTURAL                │       │
│  │ ...                     │  │ ...                     │       │
│  └─────────────────────────┘  └─────────────────────────┘       │
│                                                                  │
│  Cada celda: ranking de items, score compuesto, badge movilidad │
└─────────────────────────────────────────────────────────────────┘

┌─── CULTURAL TENSION CARDS BLOCK (top 4) ────────────────────────┐
│                                                                  │
│  ┌──── T-PSI-01 ────────────────────────────────────────┐       │
│  │ Layer: Psicológico  ·  Polaridad: Trigger  ·         │       │
│  │ Movilidad: Movible por marca                          │       │
│  │                                                       │       │
│  │ "Si algo le pasa al carro, al menos sé que estoy      │       │
│  │  cubierto. Ya con eso duermo tranquilo."              │       │
│  │  — TikTok · @user_mx · 2026-03                       │       │
│  │                                                       │       │
│  │ Tensión: Seguridad ↔ Costo recurrente                │       │
│  │                                                       │       │
│  │ Implicación: Comunicar tranquilidad post-evento.     │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  [3 cards más similares]                                         │
└─────────────────────────────────────────────────────────────────┘

┌─── ACTIVATION PLAYBOOK BLOCK ────────────────────────────────────┐
│                                                                  │
│  Top 3 triggers movibles + cómo activarlos                       │
│                                                                  │
│  ┌─── T-PSI-01 tranquilidad ─────────────────────────────┐      │
│  │ Hacer: video corto + testimonial real post-claim       │      │
│  │ Evitar: solemnidad, lenguaje corporativo               │      │
│  │ Medio: TikTok, YouTube Shorts, Instagram Reels         │      │
│  │ Categoría: digital + OOH selectivo                     │      │
│  │ Inversión: media · Indicador: lift en consideración    │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
│  [2 cards más]                                                   │
│                                                                  │
│  Triggers a evitar (agotados en categoría):                      │
│  T-PER-04 "respaldo" — todos los competidores ya lo usan         │
└─────────────────────────────────────────────────────────────────┘

┌─── FRICTION REMOVAL PLAN BLOCK ──────────────────────────────────┐
│                                                                  │
│  Top 3 barriers movibles + cómo removerlos                       │
│  [estructura simétrica al Activation Playbook]                   │
└─────────────────────────────────────────────────────────────────┘

┌─── COMPARATIVE BLOCK (si aplica) ────────────────────────────────┐
│                                                                  │
│  Tabla: Hallazgo × 5 marcas (Potosí + 4 competidores)            │
│  Lectura estratégica al pie                                      │
└─────────────────────────────────────────────────────────────────┘

┌─── MONTHLY PULSE BLOCK ──────────────────────────────────────────┐
│                                                                  │
│  Evolución mensual del top 3 triggers + top 3 barriers           │
│  Línea por hallazgo, color del layer                             │
└─────────────────────────────────────────────────────────────────┘

┌─── EVIDENCE LIST BLOCK ──────────────────────────────────────────┐
│                                                                  │
│  Selección curada de citas con plataforma/fecha/MX tag/brand pill│
│  Filtrable por layer y polaridad                                 │
└─────────────────────────────────────────────────────────────────┘

┌─── METHODOLOGY NOTE BLOCK ───────────────────────────────────────┐
│                                                                  │
│  Cómo se construyó el corpus, qué se incluyó, qué se excluyó,    │
│  qué no respondió esta corrida.                                  │
│  Pipeline version, fecha de aprobación, responsable.             │
└─────────────────────────────────────────────────────────────────┘

┌─── CTA / SIGUIENTE ──────────────────────────────────────────────┐
│  "¿Qué hallazgo quieres profundizar con tu equipo?"              │
│  [Compartir presentación] [Exportar PDF] [Solicitar siguiente]   │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Scrollytelling — narrativa lineal

```
SCROLL 1 — Hero
  Big stat: "3,247 menciones nos dijeron qué frena y qué empuja la
  decisión de un seguro de auto en México"
  Subtítulo: 12 meses, 6 plataformas, 4 competidores comparados

SCROLL 2 — La pregunta
  Texto: "¿Qué motiva contratar un seguro y qué la frena?
  Y, sobre todo: ¿dónde tiene Seguros El Potosí permiso para actuar?"
  Visual: 2 columnas con iconos minimal (trigger/barrier)

SCROLL 3 — Los 4 layers
  Texto: "T&B codifica cada mención en 4 capas. Es lo que nos permite
  distinguir entre algo que la marca puede mover y algo que no."
  Visual: 4 layers como columnas verticales con número de hallazgos en cada uno

SCROLL 4 — Capítulo: Psicológico
  Top 2 triggers psicológicos + cita protagonista
  Top 2 barriers psicológicos + cita protagonista

SCROLL 5 — Capítulo: Personal
  Misma estructura

SCROLL 6 — Capítulo: Social
  Misma estructura

SCROLL 7 — Capítulo: Cultural
  Misma estructura
  Nota: aquí hay barriers estructurales, vamos a hablar de eso en el siguiente capítulo

SCROLL 8 — Lo que la marca puede mover
  Top 3 activaciones recomendadas
  Card por card

SCROLL 9 — Lo que la marca debe remover
  Top 3 fricciones a quitar
  Card por card

SCROLL 10 — Lo que la marca NO puede mover
  Barriers estructurales
  Recomendación: alinearse o salirse, no luchar

SCROLL 11 — Vs competidores
  Comparativo resumido: dónde Potosí está mejor, dónde peor, dónde igual

SCROLL 12 — Limitaciones
  Lo que esta corrida NO respondió, explícito

SCROLL 13 — Próximo paso
  CTA: "Sigamos con tu equipo"
  Botones de contacto
```

### 7.3 Bloques opcionales

Que el Insights Manager puede activar caso por caso:

- `tb_layer_walkthrough` — versión expandida del Cultural Tension Cards por layer (en lugar de top 4 cross-layer)
- `tb_geo_breakdown` — si hay regiones distintas relevantes (MX no granular pero podría sumarse)
- `tb_sentiment_overlay` — overlay del sentiment de la fuente sobre los hallazgos (con disclaimer de que sentiment es ruido)
- `tb_evolution_compare` — comparativo entre corridas (T1 vs T2) si existe histórico

---

## 8. Quality gates automatizados antes de publicar

La plataforma corre 7 checks. Si CUALQUIERA falla, marca el output como "REQUIRES_REVIEW" y bloquea publicación al cliente.

```yaml
quality_gates:
  - id: traceability_complete
    check: |
      Cada T-* y B-* tiene mention_ids_sample con ≥3 IDs
      Y cita_protagonista con text, platform, date, url
    auto: true

  - id: layer_coverage
    check: |
      Los 4 layers (psicologico/personal/social/cultural) están representados
      O hay justificación en limitations_de_esta_corrida explicando ausencia
    auto: true

  - id: jerarquia_3d_completa
    check: |
      Cada T-* y B-* tiene los 3 ejes (frecuencia, intensidad, capacidad_predictiva)
      Y un score_compuesto > 0
    auto: true

  - id: movilidad_marcada
    check: |
      Cada T-* y B-* tiene movilidad ∈ {movible_por_marca, influenciable_parcialmente, estructural}
      Y movilidad_razon no vacía
    auto: true

  - id: limitations_explicit
    check: |
      Array limitations_de_esta_corrida con ≥1 item específico (no genérico)
    auto: true

  - id: confidence_calibrated
    check: |
      Cada hallazgo tiene entrada en confidence_per_finding
      Con valor ∈ {alta, media, baja_direccional}
    auto: true

  - id: no_future_projections
    check: |
      Texto de activation_playbook y friction_removal_plan no contiene
      frases tipo "va a crecer", "predecimos", "tendencia futura"
    auto: true  # heurística regex + Claude review

  - id: humanizer_applied
    check: |
      Texto de todos los narrativos pasa filtro humanizer:
      cero "underscore", "pivotal", "landscape", em-dash mid-sentence, etc.
    auto: true  # heurística regex
```

---

## 9. Failure modes y cómo la plataforma los maneja

Los del KB original, aplicados a flujo plataforma:

| Síntoma | Causa | Cómo la plataforma lo detecta y resuelve |
|---|---|---|
| Layer cultural vacío | Corpus solo transaccional | Pre-flight check sugiere sumar fuentes editoriales antes de proceder |
| Todo codificado como "psicológico emocional" | Paso 1 superficial | Plataforma detecta tag emergente count <40, fuerza re-ejecución del Paso 1 |
| Muchos triggers, pocos barriers | Corpus sesgado a reviews positivas | Pre-flight check valida balance; si falla, Engine propone sumar foros de queja y reviews 1-3★ |
| Frecuencia inflada por una sola fuente | Una plataforma >60% | Engine de Validación lo detecta antes y propone re-balancear |
| Cliente dice "no encontramos nada nuevo" | Confirmó hipótesis previas | Insights Manager marca insights como "validación" vs "descubrimiento"; ambos tienen valor accionable |
| IA recita teoría de Kahneman | Confundió playbook con metodología | Prompts del playbook tienen anti-instruction: "no expliques teoría, ejecuta protocolo" |

---

## 10. Métricas operativas que la plataforma debe trackear

Para cada estudio de T&B ejecutado:

```yaml
tracked_metrics:
  - id: tiempo_engine_validation
    target: < 2 horas
    formula: timestamp_corpus_aprobado - timestamp_engine_iniciado

  - id: iteraciones_engine
    target: < 5 iteraciones
    formula: count(query_iterations)

  - id: tiempo_paso_1_a_paso_6
    target: < 1 hora (IA pura)
    formula: timestamp_output_borrador - timestamp_paso_1_iniciado

  - id: tiempo_curacion_humana
    target: < 3 horas
    formula: timestamp_aprobado_insights - timestamp_output_borrador

  - id: pct_corpus_recuperado_vs_total_capturado
    target: > 60%
    formula: corpus_aprobado / total_mentions_capturadas_inicialmente

  - id: quality_gates_passing_first_try
    target: > 85%
    formula: count(gates_passed_first) / 7

  - id: comments_cliente_post_publicacion
    target: tracking métrico, no target
    formula: count(comments) groupby semana

  - id: changes_solicitados_post_publicacion
    target: tracking métrico
    formula: count(change_requests)
```

Estos KPIs alimentan la mejora continua del Engine y los prompts.

---

## 11. Plan de validación con Seguros El Potosí

Cómo se prueba que esta spec funciona en el mundo real:

### Sprint A — Manual baseline (semana 0)

- Insights Manager hace el análisis T&B de Seguros El Potosí "a mano" como hoy.
- Documenta tiempo invertido, calidad subjetiva, hallazgos.
- Esto es el baseline contra el cual se compara la plataforma.

### Sprint B — Solo Engine de Validación (semanas 1-4)

- Plataforma genera el corpus con Engine.
- Insights Manager NO hace el análisis (eso lo hace a mano como antes).
- Compara: ¿el corpus generado es de igual o mejor calidad que el manual?
- KPI: tiempo de generación de corpus.

### Sprint C — Análisis IA pero output manual (semanas 5-8)

- Plataforma genera corpus + corre análisis IA hasta Paso 4.
- Insights Manager curan + produce los 3 entregables a mano.
- Compara: ¿los hallazgos de la IA son útiles para el analista?
- KPI: tiempo de curación humana, % de cambios manuales sobre el output IA.

### Sprint D — End-to-end (semanas 9-12)

- Plataforma corre todo. Insights Manager solo curar y aprueba.
- Output se presenta al cliente real (Seguros El Potosí).
- KPI: NPS del cliente, % de comentarios pidiendo cambios, calidad subjetiva del Insights Manager.

### Criterio de éxito del MVP

T&B implementación pasa si:
- Sprint D: el output entregado al cliente tiene calidad ≥ Sprint A baseline.
- Tiempo total (Engine + IA + curación) < 30% del tiempo Sprint A baseline.
- Cliente recomienda el siguiente estudio.
- Insights Manager prefiere la plataforma vs el flow manual.

---

## 12. Cierre

Esta spec es la base para implementar T&B end-to-end en Noisia Studio. Cualquier ambigüedad encontrada durante el build debe resolverse documentando el caso edge en el repo de KB, no improvisando en código.

Si después de implementar surge una metodología distinta a T&B con flujo similar (probablemente VPM), gran parte de esta spec se reusa cambiando los prompts y el schema del output. Eso es lo que hace al sistema modular.
