# 34 — Prompt for Claude/Codex implementation

Usa este prompt como entrada para Claude o Codex cuando se continúe la rama.

---

Necesito implementar **Signal Pulse** en Noisia Studio siguiendo este paquete de especificaciones. Antes de escribir código, lee todos los `.md` de este directorio y haz un gap analysis contra la rama local.

## Contexto crítico

Signal Pulse es un reporte táctico de marketing, vivo y mensual-comparable. No es un reporte estratégico, no es Triggers & Barriers, no es un adapter de metodologías existentes y no debe convertir JSON de T&B en UI táctica.

El usuario primario es Marketing, agencia, social/content, performance, brand o data intelligence. Las acciones deben ser de marketing: claims, contenido, pauta, creators, narrativa, presupuesto, riesgos y tendencias.

## Instrucciones no negociables

1. No usar outputs de Triggers & Barriers como fuente primaria.
2. Reusar infraestructura común solo cuando sea infraestructura: corpus, evidence, provenance, signals, composer, workers, aggregates.
3. Diseñar pipeline propio Signal Pulse.
4. Mantener corpus vivo; no crear snapshot pesado del dataset.
5. Periodizar por mes: 12 meses = 12 cortes comparables; 6 = 6; 3 = 3.
6. SQL/agregados calculan números. Claude interpreta. Renderer grafica.
7. Cada chart debe tener data_ref, tooltip, empty state, error state, filters y drill-down.
8. Cada señal debe tener evidence pack, confidence, lifecycle y marketing relevance.
9. Cada marketing move debe ser accionable por Marketing.
10. Las cards deben ser cortas y humanizadas.
11. Usar navegación real del dashboard:

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

## Tarea inicial

Primero inspecciona la rama local y responde:

1. Qué tablas/migraciones existen para canonical_signals, signal_observations, evidence y composer.
2. Qué APIs existen para monthly-analysis, overview, history, composer, corpus view y sources.
3. Qué parte del pipeline multimétodo puede reutilizarse como infraestructura y qué debe separarse.
4. Qué componentes UI existentes se pueden adaptar al nuevo navigation model.
5. Qué gaps bloquean Signal Pulse.
6. Qué cambios son seguros sin romper reportes estratégicos existentes.

No escribas implementación hasta entregar ese plan.

## Prioridad de implementación

Pausar expansión de otras metodologías. No borrarlas. No romperlas. Pero enfocar la rama en Signal Pulse.

Secuencia:

1. Audit/gap.
2. Data foundation mensual.
3. Source Wizard base.
4. Signal Pulse pipeline propio.
5. Overview chart-first.
6. Resto de pantallas.
7. Composer/publish.
8. Quality/permissions/production hardening.

## UI

Usar el diseño actual de Noisia Signal como base. El sidebar debe tener agrupadores. No heredar labels de T&B. Las pantallas deben sentirse premium, oscuras, visuales, compactas, con charts fuertes y drawers de profundidad.

## Charts

Usar shadcn/ui Chart con Recharts para cartesianos. Usar custom SVG/Canvas para Semantic Signal Galaxy y Emotional Density Map si Recharts no alcanza.

Overview debe incluir:

- Executive Signal Read.
- Source/coverage/confidence strip.
- Semantic Signal Galaxy.
- Emotional Density Map.
- Impact × Polarity Priority Map.
- Signal Momentum Stream.
- Top Signals compactas.
- Marketing Moves resumen.

## Copy

Aplicar reglas del humanizer. No usar prosa de IA, no párrafos largos, no consultoría genérica. Cada card debe decir qué cambió, por qué importa y qué mover.

## Definition of done

No estará listo hasta que:

- todas las pantallas tengan estados;
- published/live/compare estén claros;
- no haya números inventados;
- charts críticos tengan data_ref;
- evidence drawer funcione;
- Source Wizard clasifique fuentes;
- Composer pueda publicar corte mensual;
- Quality gates bloqueen publicación insegura;
- roles oculten fuentes sensibles;
- el Overview sea útil para una reunión de Marketing.
