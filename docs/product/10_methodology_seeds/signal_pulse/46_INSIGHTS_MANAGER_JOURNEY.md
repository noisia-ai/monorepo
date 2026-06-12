# 46 — User journey del Insights Manager (end-to-end) y gaps de journey

> Validado simulando la creación de un reporte nuevo contra el paquete (00-45) Y contra el código real de la rama. Cierra los 4 gaps de journey que ningún doc anterior cubría. Mismo nivel de precedencia que 43-45.

## El journey completo

```text
0. Setup        org/marca existen                              [código ✓]
1. Brief        crear el reporte SP con contexto de marketing   [GAP → §A]
2. Corpus       componer queries SentiOne para SP               [GAP → §B]
3. Fuentes      subir/conectar data real                        [parcial → §C]
4. Curaduría    revisar corpus, excluir ruido                   [código ✓, decisión → §D]
5. Run          correr pipeline SP con costo visible            [spec 44 ✓, botón → §E]
6. Review       Composer: promover/fusionar/editar/gates        [spec 20/31 ✓ + código ✓]
7. Publish      corte mensual → /pulse/[outputId]               [spec 44 ✓]
8. Presentar    deck/PDF mensual para la reunión                [GAP → §F]
9. Ciclo        mes nuevo → ingest → draft → review → publish   [spec 08 ✓]
```

## §A — Brief configurator de Signal Pulse (nuevo, Cut 1)

El brief de SP NO es el de T&B. El flujo "New Pulse Report" (puede vivir en el wizard actual como tipo de estudio) captura:

| Campo | Uso downstream |
|---|---|
| Marca + competidores a vigilar | scope de corpus y Competitive & Category |
| Ventana (3/6/12 meses) + granularidad | report_periods |
| Objetivos de marketing del periodo (texto corto) | input de `sp_interpret` (contexto, doc 40) |
| Campañas/territorios activos | matching campaña↔señal (fase 2) y lectura de moves |
| Claims permitidos / prohibidos / legal | gate `no_overclaiming` + Content & Creative do/don't |
| Audiencias prioritarias | filtros + reframe_audience moves |
| Presupuesto de corrida (USD) | cost cap del pipeline (43 G7) |

Persistencia: `study_corpora` (reusar) + `analysis_plan` con `{report_kind:'signal_pulse', marketing_brief:{...}}`. Sin tabla nueva.

## §B — Corpus Engine: query template `signal-pulse`

El paquete omitía que el corpus nace de queries SentiOne. El query de SP difiere de T&B: busca conversación de categoría, tendencias, contenido, creators y comparación — no solo lenguaje de decisión.

**Resolución:** agregar entrada `signal-pulse` al registry existente `LENS_QUERY_PACK_TEMPLATES` (3 scopes: brand/competitors/category) con phrase hints de marketing: trends, formatos, "vi un video de", "está de moda", referencias a creators, comparaciones culturales. El resto del flujo (iterations → packs → CSV → provenance → fan-out) se reusa sin cambios. El test de regresión de scopes ya cubre la nueva entrada automáticamente.

## §C — Fuentes reales: estado honesto

| Fuente | Hoy | Cut 1 | Cut 2 |
|---|---|---|---|
| SentiOne CSV | ✅ funciona (ingest + provenance) | ✅ | ✅ |
| CSV genérico (Apify TikTok, reviews, etc.) | ❌ el ingest asume formato SentiOne | ✅ construir mapping configurable del wizard (doc 05 pasos 3-5) sobre el ingest existente | ✅ |
| Performance (Meta/TikTok/GA4) | ❌ | 🔒 gated `Needs data` | conectores |
| Entity / Knowledge | ❌ (knowledge sources de marca existen parcialmente) | manual mínimo | wizard completo |

El "Source Wizard" del Cut 1 = clasificación de tipo + mapping de columnas configurable + preview + validación, montado sobre `mentions-csv-ingest`. No es el wizard OAuth completo del doc 05.

## §D — Curaduría de corpus: decisión

El flujo existente tiene aprobación humana de corpus (explorer + inclusión + diagnóstico). El paquete la omite (confía en source health). **Decisión Cut 1:** mantener la curaduría ligera con las herramientas existentes (Corpus View ya la incluye: inclusion controls, bulk review) pero SIN bloquear el pipeline en un approve formal — el gate es `source_presence` + `period_coverage`, y el Composer es el control editorial final. Si el ruido resulta alto en la práctica, se endurece en Cut 2.

## §E — Dónde vive el botón de correr

Header del reporte (interno) + Quality/Settings. El botón SIEMPRE muestra antes de encolar: menciones elegibles por periodo, costo estimado (impact del cluster-first: <$5), presupuesto configurado y última corrida. Patrón anti-trampa de dinero del Issue #2: sin confirmación con costo visible, no hay corrida.

## §F — Monthly Deck / PDF (spec mínima, Cut 1 ligero)

La reunión mensual es el momento de consumo #1 del KAM/agencia. Reusar la infra del Signal Press Deck (viewer 16:9 + export PDF ya existentes) con un manifest de slides SP:

1. **Portada** — marca, periodo, confidence badge.
2. **Executive Signal Read** — headline + 3 bullets (copy del corte publicado, humanizado).
3. **El mapa del mes** — Impact × Polarity (snapshot SVG del aggregate publicado).
4. **Momentum** — stream con 3-5 señales anotadas (birth/peak/reactivation markers).
5. **Top 3-5 señales** — una card por señal: lectura + verbatim protagonista + fuente.
6. **Marketing Moves** — tabla por tipo con owner sugerido y timing.
7. **Riesgos / evitar** — territorios no-go con evidencia.
8. **Cobertura y límites** — fuentes, meses comparables, limitaciones (honestidad = marca Noisia).

Reglas: solo contenido del corte publicado (jamás live), charts como SVG estático versionado al corte, branding Noisia, es-MX. Cut 1 puede salir con 1/2/5/6/8 si el tiempo aprieta; 3/4 entran apenas los aggregates estén estables.

## Impacto en Production Cut 1 (actualiza doc 45)

La secuencia de PRs absorbe esto sin PR nuevo:
- **PR-1** suma: brief SP en wizard (§A) + query template `signal-pulse` (§B).
- **PR-5** suma: mapping CSV configurable (§C) + deck slides 1/2/5/6/8 (§F).
