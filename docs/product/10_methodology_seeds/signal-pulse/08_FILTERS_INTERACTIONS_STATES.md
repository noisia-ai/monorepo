# 08 — Filtros, interacciones, estados y permisos

## Filtros globales

Los filtros globales viven en el header o panel superior y afectan las pantallas cuando aplica.

| Filtro | Aplica a | Notas |
|---|---|---|
| Period window | Todas | 3, 6, 12 meses u otro rango permitido |
| Active period | Overview, Signals, Evidence | mes seleccionado |
| Compare mode | Overview, Signals, Composer | live vs published, mes vs mes, periodo vs promedio |
| Source type | Todas | conversation, performance, entity, knowledge |
| Provider/source | Todas | SentiOne, Apify, Meta, Birdeye, etc. |
| Emotion | Overview, Signals, Evidence | ilumina Galaxy/Density |
| Signal status | Signals, Overview | new, emerging, mature, peaking, decaying, reactivated |
| Confidence | Todas | alta, media, baja |
| Marketing relevance | Overview, Signals, Moves | high/medium/low |
| Entity/competitor | Signals, Competitive, Evidence | marca, competidor, producto, campaign, creator |
| Move type | Marketing Moves | amplify, test, avoid, brief, paid, monitor |
| Visibility | Composer/Quality | client/internal |

## Interacciones estándar

### Click en Signal Card

Abre Signal detail drawer con:

- interpretación;
- lifecycle;
- métricas por periodo;
- charts relacionados;
- evidence preview;
- marketing moves;
- confidence;
- limitations;
- provenance;
- acciones de Composer si interno.

### Click en evidencia

Abre evidence drawer con:

- texto original o metric payload;
- fuente;
- periodo;
- author/canal si permitido;
- url/external id;
- source run;
- mapping;
- señales relacionadas;
- uso en reporte.

### Click en chart

No solo hover. Debe abrir detalle o filtrar.

- Click en cluster: cluster drawer.
- Click en burbuja: Signal Card.
- Click en mes: filtra periodo.
- Click en emoción: filtra Overview.
- Brush/zoom: filtra chart o pantalla.

## Estados live/published/compare

| Estado | Definición | UI |
|---|---|---|
| Live | Data y señales calculadas con corpus actual | badge `Live` |
| Draft | Lectura en Composer no publicada | badge `Draft` |
| Published | Corte editorial visible al cliente | badge `Published` |
| Compare | Muestra diferencias entre live y published o periodos | split/diff UI |
| Stale | Alguna fuente/agregado no actualizado | warning |
| Partial | Algunas fuentes aún sync | badge `Partial` |
| Blocked | Quality gate impide publicación | red/blocker state |

## Empty states

| Caso | Mensaje |
|---|---|
| No sources | “Conecta una fuente para construir señales.” CTA a Sources |
| No performance data | Paid / Organic se desactiva con explicación |
| No competitive data | Competitive se muestra como no configurado |
| No evidence | Señal no publicable o baja confianza |
| No comparable periods | Mostrar chart simple y warning |
| Filters too narrow | Sugerir limpiar filtros |

## Loading states

- Skeleton por chart.
- Carga parcial por pantalla.
- Badge `Refreshing live data`.
- No bloquear todo el dashboard si un componente falla.
- Mostrar last updated.

## Error states

- Aggregate missing.
- Evidence refs unavailable.
- Source stale.
- Mapping invalid.
- Period not comparable.
- Permission denied.
- Quality gate failed.
- Chart data_ref missing.

Cada error debe incluir camino de resolución.

## Permisos

| Data | Cliente | Agencia | Interno | Admin |
|---|---|---|---|---|
| Señales publicadas | Sí | Sí | Sí | Sí |
| Evidence curada | Sí | Sí | Sí | Sí |
| Raw corpus | Limitado | Limitado | Sí | Sí |
| Author handles | Según permiso | Según permiso | Sí | Sí |
| Paid spend | Según permiso | Según permiso | Sí | Sí |
| Source mappings | No | No | Sí | Sí |
| Composer | No | No | Sí | Sí |
| Quality gates | Resumen | Resumen | Sí | Sí |

## Accessibility

- Color nunca debe ser el único canal.
- Charts con summary textual.
- Tooltips accesibles con teclado cuando sea posible.
- Tables alternativas para charts críticos.
- Labels claros en ejes y estados.
- Motion suave y no obligatorio.

## Regla final

Cada interacción debe acercar al usuario a una decisión, una evidencia o una explicación de confianza. Si una interacción solo entretiene, se elimina.
