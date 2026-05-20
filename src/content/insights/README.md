# New Insight Content Contract

Para publicar un nuevo insight se agregan tres piezas:

1. Un handoff JSON con la misma forma que `noisia_future_is_human_master_handoff.json`.
2. Un archivo TypeScript de evolución mensual con la misma forma que `noisia_future_is_human_signal_evolution.ts`.
3. Un asset cuadrado de hero en `public/assets/insights`.

## Handoff JSON

Campos raíz requeridos:

- `meta`
- `hero_numbers`
- `narrative_umbrella`
- `report_structure`
- `signals`
- `brand_action_map`
- `methodology`

Cada señal en `signals` requiere:

- `id`
- `order`
- `commercial_name`
- `color`
- `one_liner`
- `tension.left`
- `tension.right`
- `lead_quote.text`
- `lead_quote.platform`
- `lead_quote.attribution`
- `cultural_reading`
- `cultural_headlines`
- `brand_implications.do`
- `brand_implications.avoid`
- `brand_implications.categories_exposed`
- `brand_implications.categories_opportunity`
- `monitor_next`
- `maturity`
- `maturity_note`
- `volume_indicator.records_analyzed`
- `volume_indicator.mx_evidence_estimated`
- `volume_indicator.sources_count`
- `volume_indicator.framing`
- `evidence`

`maturity` solo acepta `emergente`, `acelerando` o `mainstreaming`.

## Color y Charts

La paleta canónica para señales y charts viene de `brand/DESIGN.md` y `knowledge-base/Design.md`. Para reportes Noisia, usar primero esta secuencia:

1. `#007E89` — cyan ink
2. `#01535F` — deep teal
3. `#D81B60` — magenta ink
4. `#D91441` — glitch red
5. `#4B1D95` — electric purple
6. `#261447` — deep violet
7. `#070113` — black
8. `#12001F` — void plum

No usar amarillo/naranja como color funcional de charts salvo que el brief pida explícitamente el token limitado `#A76700`.

## Evidence

Cada evidencia requiere:

- `text`
- `platform`
- `date`
- `mx`

Campos opcionales:

- `url`
- `source`
- `polarity`
- `phrase`

`polarity` solo se usa si la señal necesita dividir evidencia positiva y negativa.

## reports.ts

Importar el JSON y la evolución mensual, crear un `InsightReport` y agregarlo a `insightsReports`.

Campos editoriales opcionales por reporte:

- `heroVisual`: `{ src, alt }`
- `pageCopy`: textos de apertura, contrato de lectura, radar, charts, CTA y etiquetas de print.

Si `pageCopy` no existe, la página usa el copy base de `Cultural Foresight` o `Future is Human`.
