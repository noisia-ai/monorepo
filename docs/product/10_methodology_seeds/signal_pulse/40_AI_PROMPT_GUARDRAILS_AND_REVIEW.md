# 40 — AI prompt guardrails and review

## Propósito

Definir cómo debe usarse Claude dentro de Signal Pulse sin convertirlo en fuente de números inventados ni en redactor de consultoría genérica.

## Qué puede hacer Claude

Claude puede:

- nombrar señales;
- resumir evidencia;
- interpretar agregados;
- redactar executive read;
- proponer marketing moves;
- explicar limitaciones;
- convertir señales en hooks;
- proponer claims a testear;
- redactar do/don't;
- agrupar señales similares;
- detectar contradicciones cualitativas;
- redactar copy humanizado.

## Qué no puede hacer Claude

Claude no puede:

- contar menciones;
- calcular porcentajes;
- inventar deltas;
- inferir spend si no hay data;
- decidir comparabilidad sin datos;
- publicar sin quality gates;
- borrar evidencia;
- ocultar limitaciones;
- asignar confidence sin factores;
- convertir una acción de CX en recomendación primaria de Marketing sin traducción.

## Inputs mínimos para Claude

Cada prompt debe recibir:

- periodo;
- ventana temporal;
- filtros aplicados;
- métricas agregadas;
- lista de señales candidatas;
- evidence summaries;
- source coverage;
- confidence factors;
- business/marketing context;
- constraints de copy;
- output shape esperado;
- prohibiciones explícitas.

## Output esperado

Claude debe devolver estructura con:

- signal title;
- interpretation;
- marketing implication;
- recommended move;
- evidence refs usadas;
- limitations;
- confidence rationale;
- copy corto;
- no invented metrics.

## Revisión humana

Todo output destinado a cliente pasa por Composer.

El humano revisa:

- ¿la señal es clara?
- ¿el marketing move es realmente accionable?
- ¿hay evidencia suficiente?
- ¿el copy suena humano?
- ¿hay riesgos legales o de promesa?
- ¿hay fuentes sensibles?
- ¿la señal está duplicada?
- ¿la limitación está bien explicada?

## Prompt style

El prompt debe decir explícitamente:

- escribe para Marketing;
- no expliques metodología;
- no uses jerga;
- no uses párrafos largos;
- no uses números que no estén en input;
- si falta evidencia, dilo;
- si el movimiento no es de Marketing, tradúcelo como riesgo o restricción;
- usa verbos accionables;
- máximo X caracteres por card.

## Red flags automáticas

Detectar:

- “se recomienda optimizar”;
- “aprovechar la tendencia” sin acción;
- números no presentes en input;
- frases largas;
- claims absolutos;
- lenguaje de framework;
- “no es X, es Y”;
- recomendaciones sin evidencia_refs;
- contradicción omitida.

## Regla final

Claude es intérprete y redactor. No es contador, auditor ni publicador final.
