# 07 — Signal Pulse pipeline: own process, not methodology adapter

## Principio

Signal Pulse tiene pipeline propio. No se genera adaptando un JSON de Triggers & Barriers ni reciclando outputs de metodologías estratégicas.

Puede reutilizar infraestructura común, pero su proceso, prompts, contrato, charts y quality gates son propios.

## Pipeline conceptual

```text
1. Source readiness
2. Period materialization
3. Evidence retrieval
4. Signal candidate detection
5. Canonical signal deduplication
6. Period metrics aggregation
7. Marketing interpretation
8. Chart spec assembly
9. Marketing moves generation
10. Quality gates
11. Composer review
12. Publish monthly cut
```

## 1. Source readiness

Antes de analizar, el sistema valida:

- fuentes disponibles;
- rango temporal;
- cobertura por periodo;
- mapping status;
- freshness;
- source type mix;
- permisos;
- comparabilidad.

Output: readiness report.

## 2. Period materialization

Crear buckets mensuales para la ventana configurada. Para cada mes:

- period start/end;
- source coverage;
- record counts;
- conversation counts;
- performance records;
- entities covered;
- confidence;
- known gaps.

## 3. Evidence retrieval

Recuperar evidencia relevante por:

- señales candidatas;
- temas semánticos;
- emociones;
- campañas;
- entidades;
- performance outliers;
- spikes de conversación;
- cambios vs periodo anterior.

## 4. Signal candidate detection

Detectar señales candidatas desde conversación, performance y contexto.

Una señal candidata debe tener:

- nombre preliminar;
- descripción;
- periodo(s) donde aparece;
- evidencia;
- relación con marketing;
- emoción/polaridad;
- momentum;
- source mix.

## 5. Canonical signal deduplication

Fusionar señales parecidas. Ejemplo:

- “beneficio concreto”;
- “prueba real”;
- “explicación práctica”;
- “no promesas vagas”.

Pueden terminar como una señal canónica:

> “Beneficio concreto sobre promesa aspiracional.”

No mostrar duplicados al usuario.

## 6. Period metrics aggregation

SQL/agregados calculan:

- volumen por señal/periodo;
- impacto ponderado;
- engagement;
- sentiment/polarity;
- emoción dominante;
- source mix;
- evidence count;
- confidence;
- delta vs mes anterior;
- delta vs promedio ventana;
- birth month;
- age;
- persistence;
- peak;
- decay;
- reactivation.

## 7. Marketing interpretation

Claude interpreta agregados y evidencia. Debe producir:

- executive read;
- signal interpretation;
- marketing implication;
- recommended moves;
- what to avoid;
- limitations;
- evidence summary;
- chart reading text.

Claude no calcula números. Solo interpreta datos ya entregados.

## 8. Chart spec assembly

El sistema arma chart specs con:

- chart id;
- chart type;
- data reference;
- filters;
- labels;
- tooltip config;
- click behavior;
- drawer target;
- empty state;
- role visibility.

El chart spec no debe contener data pesada duplicada.

## 9. Marketing moves generation

Cada señal puede generar uno o más movimientos:

- amplify;
- test claim;
- create content;
- adjust paid;
- brief creators;
- avoid territory;
- defend budget;
- monitor;
- contain risk.

Cada movimiento debe tener:

- signal ref;
- evidence refs;
- expected owner;
- timing;
- confidence;
- suggested measurement;
- copy brief if relevant;
- no-go notes.

## 10. Quality gates

Validar:

- no invented numbers;
- evidence minimum;
- source coverage;
- period comparability;
- actionability;
- copy quality;
- role visibility;
- chart data availability;
- limitations;
- live/published consistency.

## 11. Composer review

El equipo Noisia puede:

- promover señales;
- fusionar señales;
- ocultar ruido;
- editar copy;
- cambiar prioridad;
- cambiar movimiento recomendado;
- agregar counter evidence;
- publicar.

## 12. Publish monthly cut

El publish guarda:

- corte editorial;
- periodo;
- filtros publicados;
- señales promovidas;
- orden y copy;
- chart refs;
- evidence refs;
- confidence;
- limitations;
- published by / at;
- live data version.

## Prompt role split

| Actor | Responsabilidad |
|---|---|
| SQL/materializations | conteos, deltas, rankings, periodos, charts data |
| Embeddings/retrieval | evidencia y similitud semántica |
| Claude | interpretación, naming, implications, copy, moves |
| Composer humano | curaduría, publicación, criterio editorial |
| Renderer | UI y charts |

## Errores prohibidos

- Claude contando menciones manualmente.
- Usar un JSON estratégico como fuente primaria.
- Recomendar una acción sin señal y evidencia.
- Publicar un chart sin data_ref válido.
- Ocultar warnings de comparabilidad.
- Mezclar live y published sin avisar.

## Output conceptual

Signal Pulse produce:

- report config;
- periodized signal metrics;
- signal cards;
- executive read;
- marketing moves;
- chart specs;
- evidence packs;
- quality state;
- composer state;
- published cut.

No produce una foto completa del corpus.
