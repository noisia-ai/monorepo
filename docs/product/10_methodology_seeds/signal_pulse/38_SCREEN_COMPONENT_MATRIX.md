# 38 — Screen component matrix

## Propósito

Esta matriz evita ambigüedad entre pantalla, componente, chart, drawer y capability. Es la guía para construir el dashboard sin convertir cada bloque en una tab.

## Leyenda

- **Screen:** sección navegable.
- **Component:** bloque visible dentro de la pantalla.
- **Chart:** visualización con data.
- **Drawer:** detalle contextual.
- **Internal:** visible solo a Noisia/admin.
- **Client:** visible al cliente si el reporte está publicado y permisos aplican.

## Overview

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Executive Signal Read | Narrative card | Sí | published/live signal summary | Ir a Signals |
| Live Corpus Strip | KPI strip | Sí | source coverage, confidence | Ver Sources/Quality según rol |
| Semantic Signal Galaxy | Custom chart | Sí | semantic clusters, signal metrics | Abrir cluster/signal drawer |
| Emotional Density Map | Custom overlay | Sí | emotion metrics by cluster | Filtrar por emoción |
| Impact × Polarity Map | Chart | Sí | signal impact/polarity | Abrir Signal/Move |
| Signal Momentum Stream | Chart | Sí | monthly signal metrics | Filtrar mes/señal |
| Top Signals Compact | Cards | Sí | promoted signals | Abrir Signals |
| Marketing Moves Summary | Cards | Sí | top moves | Abrir Marketing Moves |
| Coverage Warnings | Alert strip | Sí | quality/source warnings | Abrir detalle si rol |

## Signals

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Signal Library | Card grid/table | Sí | canonical_signals | Abrir detalle |
| Lifecycle Board | Board | Sí | lifecycle state | Filtrar por estado |
| Signal Momentum Detail | Chart | Sí | signal_period_metrics | Cambiar periodo |
| Signal Relationship Map | Custom/chart | Sí/limitado | signal similarity | Explorar relaciones |
| Merge/Promote/Hide Controls | Controls | Interno | composer state | Curar señales |
| Evidence launcher | Drawer trigger | Sí | evidence refs | Abrir Evidence |

## Marketing Moves

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Move Board | Board | Sí | marketing_moves | Explorar acciones |
| Priority Matrix | Chart | Sí | impact/actionability | Priorizar |
| Action Cards | Cards | Sí | move + signal refs | Abrir evidencia |
| Owner/Timing Tags | Metadata | Sí | move fields | Filtrar |
| Status Workflow | Workflow | Interno/limitado | composer state | Aprobar/editar |

## Content & Creative

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Hook Library | Cards/table | Sí | signal-derived hooks | Abrir brief |
| Claim Candidates | Cards | Sí | claims + evidence | Testear |
| Format Recommendations | Cards/chart | Sí | performance + signals | Filtrar formato |
| Tone Do/Don't | Cards | Sí | risk/evidence | Añadir a brief |
| Creator Angle Cards | Cards | Sí si aplica | author/community refs | Abrir Evidence |
| Mini Brief Builder | Composer-like | Interno/Agencia | selected hooks | Exportar brief |

## Paid / Organic

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Conversation vs Spend | Chart | Según permiso | signal + spend metrics | Identificar gap |
| Paid/Organic Gap Cards | Cards | Según permiso | performance + signal | Crear move |
| Campaign Alignment Table | Table | Según permiso | campaign entities | Abrir detalle |
| Organic-to-Paid Candidates | Cards | Según permiso | organic posts | Defender budget |
| Spend by Narrative | Chart | Según permiso | spend mapped to signals | Rebalancear |

## Competitive & Category

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Ownership Overview | Chart | Sí si aplica | signal by entity | Ver ownership |
| Whitespace Map | Chart | Sí si aplica | saturation + momentum | Crear move |
| Saturation Table | Table | Sí | territory metrics | Evitar/copiar |
| Competitor Signal Cards | Cards | Sí si aplica | competitor signals | Abrir evidence |

## Evidence

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Evidence Search | Search/table | Sí/limitado | evidence items | Buscar |
| Evidence Packs | Cards | Sí | curated evidence | Abrir detalle |
| Counter Evidence | Cards | Sí si publicado | counter refs | Leer matiz |
| Top Authors | Table | Sí/limitado | author metrics | Explorar autores |
| Provenance Panel | Drawer | Interno | source refs | Auditar |

## Corpus View

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Corpus Table | Table | Limitado/No | mentions/evidence | Revisar registros |
| Facets Sidebar | Filters | Interno/limitado | materialized facets | Filtrar |
| Raw Metadata Drawer | Drawer | Interno | raw refs | Auditar |
| Inclusion Status | Controls | Interno | inclusion flags | Limpiar ruido |

## Sources

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Connected Sources | Table | Interno | source datasets | Ver estado |
| Source Wizard | Wizard | Interno/Admin | mappings | Conectar fuente |
| Mapping Preview | Table | Interno | schema detection | Aprobar mapping |
| Sync Health | Chart/table | Interno | source runs | Resolver errores |
| Source Quality | Cards | Interno | validation report | Reparar |

## Composer

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Monthly Cut Editor | Editor | Interno | draft/published refs | Editar corte |
| Promoted Signals | List | Interno | composer decisions | Ordenar/promover |
| Hidden Signals | List | Interno | hidden state | Restaurar |
| Copy Editor | Editor | Interno | curated copy | Humanizar |
| Live vs Published Diff | Diff | Interno | data refs + edits | Revisar cambios |
| Publish Checklist | Checklist | Interno | gates | Publicar |

## Quality / Settings

| Componente | Tipo | Visible cliente | Data principal | Acción |
|---|---|---:|---|---|
| Quality Gates Table | Table | Interno | gate results | Resolver blockers |
| Readiness Summary | Cards | Interno | readiness | Re-run |
| Coverage Warnings | Alerts | Interno/Resumen cliente | coverage | Ver fuente |
| Visibility Settings | Settings | Admin | permissions | Configurar |
| Override Log | Audit | Admin | overrides | Auditar |

## Regla final

Si un elemento no está en esta matriz, no se construye como pantalla nueva sin actualizar `03_NAVIGATION_MODEL_DASHBOARD_SECTIONS.md`.
