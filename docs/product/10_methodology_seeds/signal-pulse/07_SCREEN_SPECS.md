# 07 — Especificación de pantallas

Cada pantalla debe tener URL/estado propio dentro del reporte, pero no necesariamente navegación pesada. Debe heredar filtros globales, abrir drawers de evidencia y respetar roles.

## 1. Overview

### Propósito

Entrada ejecutiva. Explica qué cambió, qué señales importan, qué gráficos lo prueban, qué movimientos de Marketing se recomiendan y qué tan confiable es.

### Componentes

- Executive Signal Read.
- KPI strip vivo.
- Semantic Signal Galaxy.
- Emotional Density Map.
- Impact × Polarity Priority Map.
- Signal Momentum Stream.
- Top Signals compactas.
- Marketing Moves resumen.
- Source/coverage/confidence strip.

### Preguntas

- ¿Qué pasó este mes?
- ¿Qué señales importan?
- ¿Qué gráfica lo justifica?
- ¿Qué debería hacer Marketing?
- ¿Qué tan confiable es?

## 2. Signals

### Propósito

Explorar señales canónicas, lifecycle, momentum, evidencia y relación entre periodos.

### Componentes

- Signal cards completas.
- Lifecycle board.
- Monthly momentum table/heatmap.
- Birth/persistence/decay/reactivation markers.
- Signal detail drawer.
- Evidence drawer por señal.
- Related signals.
- Merge/split controls internos.

### Filtros

- status;
- periodo;
- fuente;
- emoción;
- confidence;
- marketing relevance;
- entity/competitor;
- live/published.

## 3. Marketing Moves

### Propósito

Convertir señales en decisiones accionables de Marketing.

### Movimientos

- Amplificar.
- Testear claim.
- Crear contenido.
- Ajustar pauta.
- Briefear creators.
- Evitar territorio.
- Defender presupuesto.
- Preparar contención.
- Monitorear.

### Componentes

- Kanban de movimientos.
- Momentum × actionability matrix.
- Priority list.
- Move detail drawer.
- Evidence and measurement plan.
- Owner/timing/status.

### Regla

Si la acción es de CX/Ops/Producto, convertirla en riesgo, restricción de claim o nota cross-functional.

## 4. Content & Creative

### Propósito

Traducir señales en hooks, formatos, claims, tonos, briefs para agencia/creator y oportunidades de contenido.

### Componentes

- Hook library.
- Claim test suggestions.
- Format recommendations.
- Tone guidance.
- Creator brief starter.
- Organic assets with paid potential.
- No-go claims.

### Charts

- Hook Opportunity Matrix.
- Engagement by format.
- Signal × format fit.

## 5. Paid / Organic

### Propósito

Cruzar conversación con performance para encontrar gaps de inversión y oportunidades de ROI.

### Componentes

- Paid/Organic Gap Matrix.
- Spend by narrative.
- Organic engagement by signal.
- Content-to-paid recommendations.
- Campaign risk flags.
- Creative territory performance.

### Reglas

- Solo visible si hay performance evidence.
- No mostrar spend si el rol no tiene permiso.
- No hacer claims de ROI sin data suficiente.

## 6. Competitive & Category

### Propósito

Entender ownership, saturación, whitespace y señales de categoría.

### Componentes

- Narrative ownership map.
- Brand vs competitor by signal.
- Saturated territories.
- Whitespace opportunities.
- Category-wide signals.
- Competitor evidence drawer.

### Decisiones

- amplificar si la marca posee;
- evitar si está saturado;
- ocupar whitespace;
- no copiar territorio de competencia si no hay permiso real.

## 7. Evidence

### Propósito

Cuarto de pruebas. Toda señal y movimiento debe poder abrir evidencia.

### Componentes

- Evidence table.
- Evidence cards.
- Filters by source/period/signal/type.
- Original text preview.
- Performance record preview.
- Top authors.
- Query/source provenance.
- Export/share pack.

### Regla

La evidencia curada debe ser suficiente para defender una decisión, no solo adornar el insight.

## 8. Corpus View

### Propósito

Explorer vivo del corpus. Principalmente interno, limitado para cliente.

### Componentes

- Live corpus table.
- Facets.
- Date range.
- Source filters.
- Signal/entity/intent filters.
- Raw text/evidence drawer.
- Inclusion/exclusion state.

## 9. Sources

### Propósito

Administrar fuentes, conectores, mappings, sync health y Source Wizard.

### Componentes

- Connected sources list.
- Source Wizard.
- Mapping editor.
- Schema preview.
- Sync runs.
- Source quality panel.
- Coverage by period.
- Error resolution.

## 10. Composer

### Propósito

Curaduría editorial y publicación. La IA detecta; Noisia cura.

### Componentes

- Promoted signals.
- Hidden signals.
- Merge/split decisions.
- Copy editor.
- Marketing move editor.
- Live vs Published diff.
- Monthly cut.
- Publish controls.
- Revision history.

## 11. Quality / Settings

### Propósito

Readiness, gates, confidence, configuración y seguridad de publicación.

### Componentes

- Quality gates list.
- Coverage warnings.
- Source bias.
- Comparable period check.
- Evidence minimums.
- Copy humanizer status.
- Role visibility settings.
- Publish blockers.

## Acceptance criteria por pantalla

1. Propósito claro.
2. Estados con data, empty, loading y error.
3. Filtros consistentes.
4. Evidencia accesible.
5. Números calculados por agregados.
6. Copy corto.
7. Live/published/compare soportado donde aplique.
8. Roles respetados.
9. Sin nombres de metodologías estratégicas.
