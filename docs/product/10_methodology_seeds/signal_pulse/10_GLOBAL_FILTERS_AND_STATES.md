# 10 — Global filters, interactions and states

## Propósito

Definir cómo se filtra Signal Pulse y cómo se comportan los estados live/published/draft/compare en todas las pantallas.

## Filtros globales

| Filtro | Uso |
|---|---|
| Period window | 3, 6, 12 meses o rango custom permitido |
| Active period | mes actual o mes seleccionado |
| Compare mode | vs mes anterior, vs promedio ventana, vs published |
| Source type | conversation, performance, entity, knowledge |
| Source provider | SentiOne, Apify, Meta, reviews, etc. |
| Platform | TikTok, Meta, YouTube, Reddit, X, reviews, etc. |
| Entity | marca, producto, campaña, creator, región, tienda si existe |
| Competitor/category | competidor o categoría |
| Signal status | new, emerging, mature, saturated, declining, reactivated |
| Marketing relevance | alta, media, baja |
| Confidence | alta, media, baja |
| Emotion | confianza, deseo, frustración, enojo, miedo, etc. |
| Polarity | positiva, negativa, ambivalente, neutral |
| Content type | comment, review, post, ad, video, etc. |
| Paid/organic | paid, organic, earned |
| Audience/community | segmento inferido o declarado |
| Language/geo | idioma, país, región |

## Filtros por pantalla

| Pantalla | Filtros adicionales |
|---|---|
| Overview | chart focus, top N signals, show risks/opportunities |
| Signals | lifecycle, impact range, evidence count, source mix |
| Marketing Moves | move type, owner, priority, timing, status |
| Content & Creative | hook type, format, claim, tone, creator type |
| Paid / Organic | spend range, campaign, objective, creative territory |
| Competitive & Category | competitor, ownership, saturation, whitespace |
| Evidence | evidence type, author, query pack, source run |
| Corpus View | text search, inclusion, raw source, hash, entity refs |
| Sources | source health, mapping state, sync status |
| Composer | publish state, edited/unreviewed, promoted/hidden |
| Quality | gate status, severity, owner |

## Filter behavior

1. Los filtros globales deben persistir al navegar entre pantallas.
2. Cada pantalla puede agregar filtros locales sin borrar los globales.
3. Los chips de filtros deben mostrar qué está activo.
4. El usuario puede limpiar filtros por grupo.
5. Si un filtro reduce data bajo umbral, mostrar warning.
6. Si un chart no soporta un filtro, mostrar `not affected` o desactivar el filtro para ese componente.
7. Cambiar periodo debe refrescar todos los charts compatibles.
8. Modo `published` debe mostrar filtros del corte publicado por default.
9. Modo `live` puede permitir filtros exploratorios.
10. Export o share debe incluir filtros activos.

## Estados del reporte

| Estado | Descripción |
|---|---|
| setup_incomplete | faltan fuentes o configuración |
| ingesting | hay fuentes importándose |
| analyzing | pipeline Signal Pulse en ejecución |
| draft_ready | análisis listo, requiere curaduría |
| in_review | composer en edición |
| publish_blocked | quality gates fallan |
| published | corte visible al cliente |
| live_updated | hay live data posterior al publish |
| stale | fuentes o análisis atrasados |
| archived | reporte cerrado |

## Estados de pantalla

Cada pantalla debe tener:

- loading skeleton;
- no data;
- insufficient data;
- source missing;
- filter empty;
- permission denied;
- stale data;
- error with retry;
- partial data with warnings;
- published locked;
- live diff available.

## Live / Published / Compare toggle

Ubicación recomendada: header del reporte.

Opciones:

- `Published cut`: lo que ve cliente.
- `Live data`: datos actualizados no necesariamente publicados.
- `Compare`: diferencias entre published y live.
- `Draft`: visible solo interno.

## Drill-downs

Cada chart o card debe poder abrir:

- signal drawer;
- evidence drawer;
- chart detail;
- corpus filtered view;
- source provenance;
- composer action.

## Keyboard / accessibility

- Las tabs/pantallas deben ser navegables por teclado.
- Charts deben tener resumen textual.
- Tooltips deben tener contenido accesible alternativo.
- Los colores no deben ser la única forma de comunicar polaridad.
- Usar badges, labels y patrones además de color.

## Regla final

Los filtros no son adorno. Son la forma en que Marketing explora si una señal aplica a su periodo, canal, campaña, audiencia o presupuesto.
