# Competitive & Category screen specification

## Propósito

Explica si una señal pertenece a la marca, a competidores, a la categoría o a un whitespace accionable.

## Preguntas de usuario

- ¿Quién posee esta narrativa?
- ¿Qué territorio está saturado?
- ¿Qué señal es de categoría?
- ¿Dónde hay whitespace?
- ¿Qué no conviene copiar?

## Lugar en navegación

Esta es una pantalla navegable del dashboard Signal Pulse, no un componente suelto. Puede contener drawers y componentes internos, pero tiene URL/estado propio dentro del reporte.

## Layout recomendado

1. Header de pantalla con título, periodo activo, live/published state y filtros principales.
2. Área superior con resumen corto o KPI strip.
3. Área central con los charts o tablas principales.
4. Columna o fila secundaria con cards accionables.
5. Drawers para evidencia y detalle, evitando navegar de más.
6. Footer opcional con warnings, source coverage o quality notes.

## Componentes principales

- Ownership overview
- Whitespace map
- Saturation table
- Brand vs competitor signal cards
- Category-wide signals
- Competitive evidence drawer
- Narrative do/dont

## Charts sugeridos

- Ownership share chart
- Whitespace matrix
- Brand vs competitor bubble map
- Saturation trend
- Category signal timeline

## Filtros

- competitor
- category
- signal
- ownership
- saturation
- period
- confidence
- source

## Interacciones

- Click competitor filtra
- Click whitespace crea move
- Open comparative evidence
- Toggle brand/category/competitor

## Conexión al corpus vivo

Competitive & Category consume corpus_entities, competitor query/source provenance, signal observations by entity, category baselines and source coverage.

## Drawers mínimos

- Signal detail drawer.
- Evidence drawer.
- Source provenance drawer.
- Chart detail drawer.
- Composer action drawer, si el rol es interno.

## Copy rules

- Cards con máximo 1 headline, 1 lectura corta y 1 acción.
- Evitar párrafos largos en tarjetas.
- No mostrar metodología al frente.
- Usar lenguaje de Marketing: claim, contenido, pauta, creator, narrativa, presupuesto, riesgo.
- Si hay limitación, decirla claro y corto.

## Empty states

- Sin fuentes conectadas: explicar qué fuente falta y llevar a Sources.
- Sin datos para filtro: mostrar cómo ampliar periodo/fuente.
- Sin evidencia suficiente: no esconder; marcar confianza baja.
- Sin permiso: explicar que la pantalla es interna o requiere fuente autorizada.

## Loading states

- Skeletons de charts.
- Badge `Refreshing live data` si la data está recalculando.
- No bloquear toda la pantalla si un chart falla.
- Mostrar `partial data` cuando algunas fuentes siguen sincronizando.

## Error states

- Chart aggregate missing.
- Source stale.
- Period not comparable.
- Evidence refs unavailable.
- Quality gate failed.
- Permission issue.


## Criterios de aceptación de pantalla

Una pantalla está lista para producción cuando:

1. Su propósito es claro sin leer documentación externa.
2. Cada card, chart y tabla tiene un estado con datos, empty state, loading state y error state.
3. Los números visibles provienen de agregados o referencias de datos; ningún texto generado puede inventar cifras.
4. Todo insight accionable abre evidencia o explica por qué no hay evidencia suficiente.
5. Los filtros globales afectan los componentes de forma consistente y muestran qué está filtrado.
6. El copy es corto, humano y útil para Marketing; no usa jerga metodológica salvo en tooltips internos.
7. La pantalla funciona en modo `live`, `published cut` y `compare` cuando aplique.
8. El usuario puede volver al Overview sin perder el contexto del filtro.
9. La pantalla respeta roles: cliente, agencia, interno Noisia, admin.
10. La pantalla no hereda nombres, bloques ni estructura de Triggers & Barriers.
