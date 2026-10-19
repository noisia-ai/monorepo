# Noisia Studio — Glosario y Referencias

> Términos del dominio que el equipo y los devs deben usar consistentemente. Si una palabra no está aquí y aparece en código o docs, agregarla.

---

## 1. Términos del dominio Noisia

### Brand seed
Marca o entidad reconocible que se busca explícitamente en una query. Caso: "Seguros El Potosí", "Inmuebles24", "Infonavit". El catálogo de brand seeds es global, no por estudio.

### Brand pill
Etiqueta visual que aparece junto a una cita cuando esa cita menciona una marca específica. Se renderiza en el dashboard.

### Brand_methodology_corpus
Unidad actual de ejecución metodológica en Noisia Studio. Combinación de
`(sujeto × metodología)` con criterios, codificaciones, análisis y revisiones propias.
En el North Star de Signal deja de equivaler a un dashboard cliente separado: una Signal
home puede componer Social Listening y varias revisiones metodológicas, mientras la
ingesta canónica se reutiliza mediante vistas gobernadas.

### Codificación
Proceso de etiquetar cada mención del corpus contra la tipología propia de una metodología. Para T&B: codificar significa asignar polaridad (trigger/barrier) y layer (psicológico/personal/social/cultural).

### Corpus
Conjunto gobernado y versionado de menciones, registros y observaciones que sostiene la
inteligencia de un sujeto. `study_corpora` sigue siendo la unidad operativa durante la
transición, pero el destino es separar la ingesta canónica reutilizable de las vistas y
cortes específicos de cada metodología.

### Engine de Validación de Queries
Componente central de Noisia Studio. Combina IA con seeds de metodología y memoria por industria para construir y refinar queries iterativamente hasta obtener un corpus accionable. Lo opera el Insights Manager con asistencia visual de progreso.

### Evidence quote
Cita textual del corpus seleccionada manualmente (decisión editorial del Insights Manager) para aparecer en el dashboard final. No es cualquier mención: es una mención curada.

### Finding
Hallazgo específico que emerge del análisis. Para T&B: cada trigger o barrier identificado y jerarquizado es un finding. Tiene métricas, evidencia, movilidad, confianza.

### Insights Manager
Analista interno de Noisia. Persona crítica del sistema. Opera la plataforma, cura el corpus, ejecuta metodologías con asistencia de IA, presenta outputs al cliente. El reviewer humano por default.

### KAM (Key Account Manager)
Persona interna de Noisia responsable de la relación comercial con la organización contratante. Acompaña al Insights Manager en presentaciones; no opera el análisis. Es el dueño comercial; el Insights Manager es el dueño técnico.

### Layer
Tipología de codificación específica de la metodología T&B. Cuatro niveles: psicológico, personal, social, cultural. Cada layer responde a una pregunta diagnóstica distinta.

### Maturity (madurez)
Clasificación de un finding o de un código cultural. Tres niveles: emergente (vocabulario en formación), acelerando (vocabulario consolidado, frecuencia creciente), mainstreaming (omnipresente). Originalmente del workflow Cultural Codes pero reusable en otras metodologías.

### Memoria (de plataforma)
Conocimiento acumulado que la plataforma consulta antes de operar. 5 capas: industria, marca, metodología, cliente, output.

### Methodology
Sistema interpretativo estructurado que se aplica sobre un corpus. Las 6 Noisia: Triggers & Barriers, Value Perception Matrix, Journey Friction Mapping, Cultural Codes Decoding, Influence Architecture, Decision Velocity.

### Movilidad
Atributo de un finding que indica si la marca puede actuar sobre él. Tres valores: `movible_por_marca`, `influenciable_parcialmente`, `estructural`.

### Output
Revisión identificable publicada dentro de Signal: por ejemplo, una corrida estratégica
T&B aprobada o un export derivado. No es la identidad permanente del dashboard. Signal
es el producto vivo; el output conserva exactamente qué se aprobó o presentó.

### Pipeline_version
Identificador de la versión del pipeline (ingesta + clasificación + análisis) que produjo una decisión. Cada decisión (clasificación de mención, exclusión, codificación) lleva su versión. Permite mejorar el pipeline sin perder histórico.

### Quality gate
Check obligatorio antes de pasar a la siguiente fase. La plataforma corre quality gates antes de publicar un output al cliente. Si falla cualquiera, bloquea publicación.

### Scrollytelling
Vista vertical narrativa de un dashboard. Misma data que la vista Dashboard normal, distinta presentación. Diseñada para consumo lineal estilo TikTok pero con narrativa de data pre-curada.

### Signal phrase
Frase del lenguaje del consumidor que la metodología busca en el corpus. Para T&B: "vale la pena el seguro" (trigger), "letra chica del seguro" (barrier). Las signal phrases son específicas por metodología.

### Signal
Dashboard vivo y permanente de inteligencia de una marca o tema. En una URL estable
reúne Social Listening casi always-on, interpretaciones de grupos de métricas, corridas
estratégicas revisadas, evidencia e histórico. Ver
`31_SIGNAL_PRODUCT_NORTH_STAR.md`.

### Metric group
Familia gobernada de métricas que comparte pregunta, dimensiones, denominadores y
política de refresh. Sus números se calculan de forma determinística; Claude interpreta
un paquete versionado del grupo.

### Metric interpretation
Artefacto versionado producido por Claude para un metric group, periodo, filtros y
watermark específicos. Explica significado e incertidumbre, pero no calcula los valores
del dashboard.

### Strategic release
Revisión aprobada e inmutable de una corrida metodológica, como Triggers & Barriers
mensual. Convive con la data operativa viva sin ser reescrita por cada import nuevo.

### Tag emergente
Etiqueta en lenguaje del consumidor (no en jerga de marketing) que la IA asigna en el Paso 1 abierto de una metodología. Antes de codificar contra la tipología formal.

### Trigger / Barrier
Específico de la metodología T&B. Trigger = expresión que empuja hacia la decisión. Barrier = expresión que la frena.

---

## 2. Términos del producto

### Banco de bloques
Catálogo central de componentes visuales reusables para los dashboards. Cada bloque es un componente versionado. Las metodologías tienen bloques default; el cliente puede activar/desactivar; el UX Data Specialist puede agregar nuevos.

### Comments
Mecanismo por el cual el cliente comenta sobre un bloque o finding específico del dashboard. Mensaje + reacción opcional. Genera notificación al Insights Manager.

### Change request
Solicitud formal del cliente para que el Insights Manager modifique algo del análisis. Mayor escala que un comment. Se trackea en plataforma con status.

### Notification (WhatsApp)
Mensaje curado por IA + firmado por Insights Manager que se envía al cliente vía WhatsApp Business API cuando emerge un patrón importante entre presentaciones. Mensaje humanizado, no auto-generado plano.

### Integración
Conexión configurada a una fuente de datos externa (SentiOne, Datashake, Apify, API custom, webhook). Las integraciones se pueden agregar desde la UI sin tocar código, mapeando campos del response al schema canónico Noisia.

---

## 3. Roles del sistema

| Rol | Tier | Quién opera la plataforma |
|---|---|---|
| Founder / Admin Global | Noisia | Configura plataforma, gestiona equipo |
| KAM (Key Account Manager) | Noisia | Acompaña al cliente, no opera análisis |
| Insights Manager | Noisia | El analista. Opera Engine + cura + presenta |
| UX Data Specialist | Noisia | Diseña componentes visuales custom |
| Cliente Owner | Cliente | Firma contrato, gestiona usuarios cliente |
| Brand Manager | Cliente | Persona responsable de la marca |
| Agency Insights | Cliente (agencia) | Acceso solo lectura sobre marcas autorizadas |

---

## 4. Workflow del estudio (referencia)

```
[Workshop offline] (opcional)
    → [Propuesta KAM]
        → [Aprobación KAM]
            → [Configuración Insights Manager]
                → [Engine de Validación de Queries]
                    → [Corpus aprobado]
                        → [Análisis IA contra protocolo]
                            → [Curación del Insights Manager]
                                → [Revisión KAM]
                                    → [Presentación al cliente]
                                        → [Comments y change requests]
                                            → [Ciclos siguientes]
```

---

## 5. Conventions del schema

| Tipo de campo | Convención |
|---|---|
| IDs | UUID v4, gen_random_uuid() |
| Fechas absolutas | TIMESTAMPTZ |
| Fechas calendario | DATE |
| Texto corto | TEXT |
| Texto largo | TEXT (sin VARCHAR) |
| Booleans | BOOLEAN, default FALSE explícito |
| Enums | TEXT con CHECK constraint o jsonb si varían |
| Metadata flexible | JSONB |
| Tags | TEXT[] |
| Audit | created_at, updated_at, created_by_user_id obligatorios en tablas de dominio |

---

## 6. Referencias externas

### KB público de Noisia

Repositorio: https://github.com/noisia-ai/website/tree/main/knowledge-base

Estructura referenciada en este paquete:

- `00-overview/positioning.md` — qué es Noisia y qué no
- `00-overview/principles.md` — los 10 principios operativos (P1-P10)
- `01-methodologies/triggers-barriers.md` — definición conceptual T&B
- `01-methodologies/value-perception-matrix.md` — VPM
- `01-methodologies/journey-friction-mapping.md` — JFM
- `01-methodologies/cultural-codes-decoding.md` — Cultural Codes
- `01-methodologies/influence-architecture.md` — IA
- `01-methodologies/decision-velocity.md` — DV
- `02-services/foundation.md`, `intelligence.md`, `strategy.md` — tiers comerciales
- `03-process/corpus-construction.md` — construcción de corpus
- `03-process/diagnostic-protocol.md` — diagnóstico
- `03-process/delivery-format.md` — formato de entrega
- `03-process/evidence-traceability.md` — trazabilidad
- `04-cases/use-cases.md` — casos de uso por metodología
- `05-ai-playbooks/run-triggers-barriers.md` — playbook ejecutable T&B
- `05-ai-playbooks/run-value-perception-matrix.md` — VPM ejecutable
- (resto de playbooks)

### Estudios reales que alimentaron este paquete

Cuatro estudios completados en mayo 2026 que aportaron el schema real y la validación del flujo:

1. **Cultural Foresight México 2026** — 8 señales culturales sobre cansancio de performance. Trabajado en `/Users/brandhon_o/Downloads/foresight_2026/`. Corpus: +1.18M menciones, principalmente SentiOne + Datashake.
2. **Future is Human** — humanidad de marca en entornos automatizados. Trabajado en `/Users/brandhon_o/Downloads/future_is_human/`. Validó el patrón Brand Pills para citas con marca etiquetada.
3. **The Mexican Home** — qué significa hogar para México hoy. Trabajado en `/Users/brandhon_o/Downloads/what_home_means/`. Validó el patrón Big Finding para señal dominante.
4. **Foundation Snapshots** (estudios menores como demos).

Cada uno terminó con un master JSON, un análisis MD, y un handoff para Codex (desarrollador de HTML). Toda la lógica de outputs viene de ahí.

### Referencias académicas que entran a las metodologías

| Metodología | Autor principal | Aporte |
|---|---|---|
| Triggers & Barriers | Kahneman, Christensen, Nordgren & Schonthal, Deci & Ryan | Dual-process, JTBD, Friction Theory, SDT |
| Cultural Codes | Geertz, Alexander, Sewell | Densidad cultural, semiótica, sociología cultural |
| Influence Architecture | Granovetter, Watts | Strength of weak ties, network theory |
| Journey Friction Mapping | Nordgren & Schonthal | 4 tipos de fricción |
| Value Perception Matrix | Aaker, Kapferer | Equidad de marca, posicionamiento perceptual |
| Decision Velocity | Kahneman, Thaler | Sistema 1/2, choice architecture |

### Skill humanizer

Repositorio: https://github.com/alexdcd/Mafia-Claude-Skills/tree/main/skills/humanizer

Aplicable a todos los copys generados por IA antes de mostrarlos al cliente. Basado en Wikipedia "Signs of AI writing". 24 patrones a eliminar + guía de cómo agregar voz humana.

---

## 7. Naming conventions

### En base de datos
- snake_case
- Plurales: `mentions`, `brand_seeds`, `findings`
- Junction tables: orden alfabético, `<a>_<b>` (`mention_codings`, `user_brand_access`)
- IDs externos: `external_id` (no `source_id` que es ambiguo)
- Foreign keys: `<tabla_singular>_id`
- Booleans: `is_*` o `has_*` o nombre afirmativo (`active`)

### En código (Python pipeline)
- snake_case para variables y funciones
- PascalCase para clases
- Módulos: `ingestor_sentione.py`, `engine_query_validator.py`

### En código (Next.js frontend)
- camelCase para variables
- PascalCase para componentes
- Componentes de banco: prefijo por tipo `BlockHeroStats`, `BlockTbMatrix4Layers`, `BlockCulturalTensionCard`

### En slugs (URLs)
- kebab-case
- Methodology slug: `triggers-barriers`, `value-perception-matrix`
- Brand slug: `seguros-el-potosi`, `banco-azteca`

---

## 8. Anti-patterns a evitar

1. **No mezclar metodologías en el mismo corpus.** Decisión central. Un corpus = 1 metodología.
2. **No exponer cocina al cliente.** Reglas: cero "ruido %", "registros limpios", "señal degradada" en el dashboard del cliente. Eso es interno.
3. **No usar IDs internos en UI.** `mi_casita_identidad` es ID técnico, no se muestra al cliente. Se muestra el `commercial_name`.
4. **No saltar quality gates.** La plataforma no permite publicar si gates fallan.
5. **No reutilizar dashboards genéricos.** Cada metodología tiene su layout. Cada cliente puede ajustar dentro del banco, no reinventar.
6. **No mostrar visualizaciones decorativas.** Si una visualización no responde una pregunta específica, se quita. Esto viene del principio F2 del KB Noisia.
7. **No usar em dashes mid-sentence en copys del cliente.** El skill humanizer los flag.
8. **No registrar findings sin evidencia.** Cada finding debe apuntar a evidence_quotes con citas reales. Esto viene del principio P5 del KB.

---

## Cierre

Este glosario debe vivir en `/docs` del repo de código. Cualquier término nuevo que se introduzca debe agregarse acá antes de propagarse.
