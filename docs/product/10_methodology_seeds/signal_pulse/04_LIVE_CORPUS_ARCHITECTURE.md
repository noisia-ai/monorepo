# 04 — Live corpus architecture

## Principio

Signal Pulse no guarda una foto del corpus. El reporte se conecta a un corpus vivo y a agregados/materializaciones por periodo. El corte publicado guarda la interpretación editorial, referencias a señales, chart specs, filtros aplicados y evidence refs, no una copia completa del dataset.

## Mapa conceptual

```text
Organization / Brand / Theme
  ↓
Source Wizard
  ↓
Connectors / Uploads / APIs
  ↓
Source normalization
  ↓
Evidence store + provenance
  ↓
Corpus vivo + period aggregates
  ↓
Canonical signals + observations
  ↓
Signal Pulse analysis pipeline
  ↓
Chart specs + signal cards + marketing moves
  ↓
Composer / Published cut
```

## Qué significa corpus vivo

Un corpus vivo permite:

- cambiar rango temporal y recalcular vista;
- analizar mes a mes;
- conectar nuevas fuentes sin regenerar todo manualmente;
- ver diferencia entre `live data` y `published cut`;
- mantener evidence refs apuntando a registros reales;
- refrescar charts cuando hay datos nuevos;
- mantener trazabilidad de qué fuente alimentó cada señal.

## No snapshot rule

No duplicar todo el dataset dentro del output del reporte.

El reporte puede guardar:

- configuración del análisis;
- ventana temporal;
- periodo activo;
- filtros publicados;
- señal promovida;
- orden editorial;
- copy curado;
- chart specs con `data_ref`;
- evidence refs;
- confidence y limitations;
- estado de publicación.

El reporte no debe guardar:

- todas las menciones;
- todos los comentarios;
- todos los registros de performance;
- todas las filas fuente;
- todos los cálculos de cada chart como JSON plano sin referencia;
- texto largo generado que no sea parte de una decisión editorial.

## Period aggregates

Para Signal Pulse, el corpus debe tener agregados por periodo discreto:

- mes;
- semana si se activa modo crisis o live monitoring;
- día/hora para casos de alerta, no como default del reporte mensual.

El default del reporte es mensual-comparable.

## Entidades principales

### Source records

Registros originales o normalizados de fuentes. Pueden venir de conversación, performance, entity data o knowledge.

### Evidence items

Unidades que pueden sostener un insight. Pueden ser menciones, reviews, comentarios, posts, ads, creativos, métricas de performance, entidades o documentos.

### Signal observations

Apariciones de una señal en una fuente, periodo, entidad, audiencia o campaña.

### Canonical signals

Señales deduplicadas, humanamente entendibles, que agrupan observaciones similares.

### Period metrics

Métricas por señal/periodo/fuente/entidad.

### Published cuts

Interpretación editorial del periodo. Guarda narrativa, orden, decisiones y referencias, no la data completa.

## Corte mensual comparable

Cuando el usuario configura 12 meses, el sistema crea 12 cortes comparables. Cuando configura 6, crea 6. Cuando configura 3, crea 3.

Cada periodo debe tener:

- start date;
- end date;
- source coverage;
- mention count;
- performance record count;
- signal observations count;
- confidence;
- comparable flag;
- known gaps.

## Live vs published

| Modo | Qué muestra |
|---|---|
| Live | Últimos datos y agregados disponibles |
| Published | Corte editorial aprobado para cliente |
| Compare | Diferencia entre live y published |
| Draft | Edición interna antes de publicación |

El usuario debe ver claramente si está mirando live, draft o published. No mezclar silenciosamente.

## Source freshness

Cada pantalla debe mostrar si la data está fresca:

- última ingesta;
- última materialización;
- último análisis Claude;
- último publish;
- fuentes atrasadas;
- periodos incompletos.

## Performance constraints

La lectura del Studio debe evitar queries pesadas en vivo. Si una query de pantalla puede crecer con el corpus, se debe materializar o cachear por periodo/filtro común.

Regla: charts del Overview deben cargar rápido. Si un chart requiere cálculo pesado, precomputarlo como aggregate y usar `data_ref`.

## Failure modes

| Falla | Manejo |
|---|---|
| Fuente faltante en un mes | Mostrar coverage warning y bajar confidence |
| Nueva fuente rompe comparabilidad | Marcar periodo como non-comparable o normalizar por fuente |
| Datos live difieren de published | Mostrar diff, no sobrescribir published |
| Evidence ref ya no disponible | Mantener fallback metadata y marcar stale |
| Chart aggregate caducado | Mostrar stale badge y opción de refresh interno |
| Periodo sin suficiente data | Empty state explicando qué fuente falta |

## Regla final

El reporte es una vista viva y curada sobre un sistema de evidencia. Publicar no congela la verdad; congela la lectura editorial de un corte trazable.
