# 02 — Navegación, pantallas y agrupadores

## Definición

En Signal Pulse, una **pantalla** es una sección navegable del dashboard. Aparece como item en el sidebar o navegación lateral del reporte. Un **componente** es un bloque dentro de una pantalla. Un **drawer** es una profundización contextual sin cambiar de pantalla.

No confundir componentes con pantallas. El reporte no debe tener 16 tabs porque hubo 16 ideas. Debe tener las pantallas necesarias y cada una agrupa componentes relacionados.

## Navegación final

```text
SIGNAL PULSE
  Overview
  Signals
  Marketing Moves

MARKETING INTELLIGENCE
  Content & Creative
  Paid / Organic
  Competitive & Category

EVIDENCE & CORPUS
  Evidence
  Corpus View
  Sources

PUBLISHING
  Composer
  Quality / Settings
```

## Pantallas y propósito

| Pantalla | Propósito | Usuario principal |
|---|---|---|
| Overview | Resumen ejecutivo visual del periodo | Todos |
| Signals | Vida, detalle y evidencia de señales | Marketing, Data Intelligence |
| Marketing Moves | Decisiones accionables por señal | Marketing, Agencia, Performance |
| Content & Creative | Hooks, formatos, claims, creators, briefs | Content, Social, Creative |
| Paid / Organic | Cruce entre conversación y performance | Performance, Media, Data |
| Competitive & Category | Ownership, saturación y whitespace | Brand, Strategy, Marketing |
| Evidence | Cuarto de pruebas y trazabilidad | Todos, con profundidad por rol |
| Corpus View | Explorer vivo del corpus | Interno Noisia, Data |
| Sources | Source Wizard, conectores, mappings, sync health | Interno Noisia, Admin |
| Composer | Curaduría editorial y publicación | Interno Noisia |
| Quality / Settings | Gates, readiness, confianza y configuración | Interno Noisia, Admin |

## Visibilidad por rol

| Pantalla | Cliente Marketing | Agencia | Interno Noisia | Admin |
|---|---:|---:|---:|---:|
| Overview | Sí | Sí | Sí | Sí |
| Signals | Sí | Sí | Sí | Sí |
| Marketing Moves | Sí | Sí | Sí | Sí |
| Content & Creative | Sí | Sí | Sí | Sí |
| Paid / Organic | Si hay data/permisos | Si hay data/permisos | Sí | Sí |
| Competitive & Category | Si aplica | Si aplica | Sí | Sí |
| Evidence | Sí, con límites | Sí, con límites | Sí | Sí |
| Corpus View | Limitado o no | Limitado o no | Sí | Sí |
| Sources | No | No | Sí | Sí |
| Composer | No | No | Sí | Sí |
| Quality / Settings | No | No | Sí | Sí |

## Reglas de navegación

1. El usuario siempre puede volver a `Overview` sin perder filtros globales.
2. Cada Signal Card puede abrir evidencia sin abandonar contexto.
3. `Top Opportunities` no es pantalla; es componente de Overview o filtro dentro de Signals/Marketing Moves.
4. Las pantallas no deben usar nombres de metodologías estratégicas.
5. El sidebar debe mostrar estado live/published y periodo activo.
6. Las pantallas con data no disponible aparecen desactivadas con explicación, no desaparecen sin aviso.
7. La navegación debe ser consistente entre brand studies y theme studies.
8. Las secciones internas solo aparecen si hay datos suficientes o rol autorizado.

## Mapeo de capacidades a pantallas

| Capability | Pantalla |
|---|---|
| Executive Signal Read | Overview |
| Semantic Signal Galaxy | Overview, drill-down a Signals/Evidence |
| Emotional Density Map | Overview, filtro global |
| Impact × Polarity Priority Map | Overview y Signals |
| Signal Momentum Stream | Overview y Signals |
| Signal lifecycle | Signals |
| Birth/persistence/decay/reactivation | Signals |
| Acciones de marketing | Marketing Moves |
| Hooks y claims | Content & Creative |
| Creators | Content & Creative |
| Pauta vs conversación | Paid / Organic |
| Orgánico con potencial de paid | Paid / Organic |
| Whitespace competitivo | Competitive & Category |
| Citas, posts, reviews, ads | Evidence |
| Top authors | Evidence |
| Corpus explorer | Corpus View |
| Connected sources | Sources |
| Source Wizard | Sources |
| Publish cut | Composer |
| Diff live vs published | Composer |
| Readiness / quality gates | Quality / Settings |

## Estados de navegación

| Estado | UI |
|---|---|
| Ready | Item normal |
| Needs source | Badge `Needs data` |
| Internal only | Visible solo a Noisia |
| Draft only | Visible en working draft |
| Published | Visible al cliente |
| Warning | Badge de quality warning |
| Failed | Error y camino de resolución |

## Principio final

El dashboard debe sentirse como un producto terminado, no como una colección de módulos metodológicos. La navegación debe responder a cómo Marketing piensa su trabajo: señales, movimientos, contenido, pauta, competencia y evidencia.
