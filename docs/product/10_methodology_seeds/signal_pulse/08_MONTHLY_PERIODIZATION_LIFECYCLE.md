# 08 — Monthly periodization and signal lifecycle

## Principio

Signal Pulse debe analizar la historia temporal de las señales. Si la ventana inicial tiene 12 meses, el primer output debe construir 12 cortes comparables. Si tiene 6, seis cortes. Si tiene 3, tres cortes.

Nunca generar solo una lectura agregada del total.

## Periodización

Cada periodo mensual debe tener:

- period id;
- start/end;
- label;
- source coverage;
- conversation evidence count;
- performance evidence count;
- entities covered;
- signals observed;
- missing sources;
- comparability status;
- confidence;
- notes.

## Comparabilidad

Un periodo es comparable si:

- tiene fuentes clave activas;
- no hay cambio extremo de cobertura sin normalización;
- los filtros aplicados son consistentes;
- el volumen mínimo se cumple;
- la fuente principal no domina de forma nueva y no explicada.

Si no es comparable, el chart debe mostrar warning.

## Métricas por señal/periodo

Cada señal debe tener por periodo:

- volume;
- weighted impact;
- engagement;
- sentiment score;
- polarity bucket;
- dominant emotion;
- emotion distribution;
- source mix;
- evidence count;
- confidence;
- delta vs previous period;
- delta vs rolling average;
- rank;
- marketing relevance;
- risk level;
- opportunity level.

## Lifecycle states

| Estado | Definición | Decisión de marketing |
|---|---|---|
| New | primera aparición con evidencia mínima | observar o test pequeño |
| Emerging | crece durante 2–3 periodos | probar contenido/claim |
| Accelerating | crecimiento fuerte y reciente | activar rápido |
| Mature | sostenida varios meses | integrar a always-on |
| Saturated | alta presencia pero bajo diferencial | evitar usar igual que todos |
| Peaking | pico alto de corto plazo | activar si timing importa |
| Declining | pierde fuerza | bajar prioridad |
| Dormant | desaparece | archivar o monitorear |
| Reactivated | vuelve tras caer | identificar detonador |
| Volatile | sube/baja sin patrón | no sobrerreaccionar |

## Birth month

El mes de nacimiento de una señal no es necesariamente el primer registro. Debe ser el primer periodo donde cumple umbral mínimo de evidencia y relevancia.

Umbrales sugeridos:

- evidencia mínima;
- impacto mínimo;
- source confidence;
- semántica coherente;
- no ser ruido de una sola mención viral aislada.

## Longevidad

Longevidad = número de periodos donde la señal mantiene evidencia suficiente.

Mostrar:

- edad en meses;
- meses activos / ventana total;
- racha actual;
- última aparición;
- periodo de pico.

## Persistencia

Una señal persistente aparece en varios meses con variación moderada.

Debe distinguirse de:

- un pico viral;
- una crisis de corto plazo;
- ruido repetido por una fuente;
- un tema estacional.

## Reactivación

Una señal reactivada desaparece o baja bajo umbral y luego vuelve.

El sistema debe intentar explicar el detonador:

- campaña;
- evento externo;
- trend;
- creator;
- cambio de producto;
- noticia;
- temporada;
- pauta.

## Saturación

Una señal puede ser grande pero poco útil si ya está saturada.

Indicadores:

- alta frecuencia, baja diferenciación;
- varios competidores usan el mismo territorio;
- baja respuesta incremental;
- alta presencia en categoría;
- copy genérico.

## Mes actual vs historia

Cada lectura debe contextualizar el mes actual:

- ¿es nuevo o viene creciendo?
- ¿es pico o patrón?
- ¿es más fuerte que promedio de ventana?
- ¿el cambio viene por volumen, engagement o emoción?
- ¿la fuente de evidencia cambió?

## Visualización de lifecycle

Usar:

- Signal Momentum Stream;
- lifecycle badges;
- sparklines por señal;
- markers de birth/peak/decay/reactivation;
- heatmap de presencia mensual;
- matrix estado × marketing move.

## Quality gates temporales

1. No llamar tendencia a una señal de un solo periodo salvo que se marque como `pico` o `emergente` con baja confianza.
2. No comparar meses con cobertura incompatible sin warning.
3. No recomendar always-on desde señales nuevas.
4. No recomendar activación inmediata desde señales maduras pero saturadas.
5. No ocultar que una señal está basada en una sola fuente.
6. No presentar delta si no hay baseline comparable.

## Copy recomendado

Bueno:

> Esta señal no nació este mes. Aparece desde marzo, aceleró en julio y se mantiene estable desde septiembre. Conviene tratarla como patrón de comunicación, no como trend pasajero.

Malo:

> La conversación muestra una tendencia relevante que debe ser aprovechada por la marca.

## Regla final

La riqueza de Signal Pulse está en contar la vida de las señales, no solo su tamaño acumulado.
