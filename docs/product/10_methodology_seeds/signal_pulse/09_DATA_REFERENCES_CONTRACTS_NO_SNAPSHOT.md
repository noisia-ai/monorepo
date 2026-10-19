# 09 — Data references and contracts: no snapshot output

## Propósito

Definir qué debe guardar Signal Pulse y qué debe referenciar. El objetivo es evitar que el reporte sea una foto pesada, frágil y rápidamente obsoleta.

## Principio

El output de Signal Pulse guarda estructura, interpretación, referencias y decisiones. Los datos viven en el corpus, evidence store, materializaciones y agregados.

## Objetos conceptuales

### Signal Pulse Report

Guarda:

- id;
- organization/brand/theme refs;
- window configured;
- period granularity;
- active filters;
- status: draft, live, published, archived;
- generated at;
- published at/by;
- report confidence;
- source health summary;
- navigation config;
- visibility config.

### Signal Pulse Period

Guarda o referencia:

- period id;
- start/end;
- coverage summary;
- comparable flag;
- source count summary;
- warnings.

### Canonical Signal Reference

Guarda:

- signal id;
- title;
- short description;
- lifecycle state;
- priority;
- marketing relevance;
- primary emotion;
- polarity;
- confidence;
- current period metrics ref;
- evidence pack ref.

### Signal Period Metrics

Materializado o referenciado:

- signal id;
- period id;
- impact;
- volume;
- sentiment;
- emotion distribution;
- engagement;
- source mix;
- deltas;
- rank;
- confidence.

### Chart Spec

Guarda:

- chart id;
- screen;
- chart family;
- data_ref;
- filters;
- display config;
- tooltip config;
- click behavior;
- fallback/empty state;
- role visibility.

No guarda todo el dataset del chart si es grande.

### Evidence Ref

Guarda:

- evidence id;
- evidence type;
- normalized source ref;
- period id;
- signal id;
- visibility;
- snippet ref or curated excerpt;
- source provenance.

### Marketing Move

Guarda:

- move id;
- move type;
- related signal refs;
- action text;
- owner suggestion;
- timing;
- evidence refs;
- measurement suggestion;
- confidence;
- status in composer.

### Composer Edit

Guarda:

- edit id;
- target type;
- before/after summary;
- user;
- timestamp;
- reason;
- publish impact.

## Qué no guardar como snapshot

No guardar en el report payload:

- todas las filas de menciones;
- todos los registros de performance;
- todas las evidencias completas;
- todos los raw payloads;
- todos los puntos de chart grandes;
- cálculos que pueden refrescarse por `data_ref`;
- archivos o payloads fuente.

## Excepciones válidas

Se puede guardar una copia pequeña cuando:

- es copy editorial publicado;
- es un excerpt curado;
- es un número de resumen necesario para auditoría;
- es un chart tiny inline para preservar un corte publicado;
- es una limitación o warning editorial.

Incluso en esos casos, conservar referencias al origen.

## Live, draft y published

| Modo | Datos | Copy | Charts |
|---|---|---|---|
| Live | refs a agregados actuales | lectura generada o latest draft | data_refs actuales |
| Draft | refs actuales + edits | copy editado | data_refs actuales con warnings |
| Published | refs del corte publicado | copy aprobado | data_refs versionados o materializados al corte |

## Versionado

Versionar:

- source mappings;
- period aggregates;
- signal dedup decisions;
- chart specs;
- composer edits;
- published cuts;
- prompt versions;
- quality gate versions.

## Data freshness en UI

Cada pantalla debe mostrar o poder exponer:

- data last updated;
- analysis last run;
- publish timestamp;
- stale status;
- source coverage;
- warnings.

## Consistencia de filters

Cuando el usuario cambia filtros, los chart data_refs deben recalcular o recuperar agregados filtrados.

El UI debe mostrar:

- filtros aplicados;
- si el filtro afecta todos los charts;
- si algún chart no soporta ese filtro;
- si el filtro vuelve el periodo no comparable.

## Regla final

Signal Pulse no es un archivo. Es una vista curada, trazable y versionada sobre un sistema vivo de señales y evidencia.
