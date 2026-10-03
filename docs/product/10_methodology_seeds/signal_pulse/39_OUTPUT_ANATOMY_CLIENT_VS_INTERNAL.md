# 39 — Output anatomy: client vs internal

## Propósito

Definir qué compone el output final del reporte, separando la experiencia cliente de la experiencia interna Noisia.

## Output cliente

El cliente debe recibir un dashboard claro y publicable. Debe poder usarlo en una reunión de Marketing sin explicación técnica.

### Cliente ve

- Overview publicado.
- Signals promovidas.
- Marketing Moves aprobados.
- Content & Creative aprobado.
- Paid / Organic si tiene permiso.
- Competitive & Category si aplica.
- Evidence curada.
- Limitaciones visibles.
- Confidence comprensible.

### Cliente no ve por default

- Composer.
- Raw source mappings.
- Query packs completos.
- Errores técnicos de ingestión.
- Raw metadata sensible.
- Quality gate internals.
- Prompts/model versions.
- Señales ocultas por ruido.
- Cost ledger.

## Output interno Noisia

Noisia ve la maquinaria completa:

- todas las pantallas;
- live/draft/published;
- fuentes;
- composer;
- quality;
- corpus view;
- raw/provenance;
- warnings;
- overrides;
- history.

## Published cut

El published cut es el contrato visible. Incluye:

- report metadata;
- periodo;
- filtros publicados;
- executive read;
- señales promovidas;
- marketing moves;
- chart specs versionadas o data refs del corte;
- evidence refs visibles;
- limitations;
- confidence;
- timestamp;
- published by;
- source coverage summary.

## Live output

Live output puede diferir del published cut. Debe mostrar:

- nuevo data since publish;
- señales nuevas;
- deltas posteriores;
- warnings;
- si requiere nuevo análisis;
- si el published cut quedó stale.

## Draft output

Draft output es interno. Puede contener:

- señales candidatas;
- señales ocultas;
- copy no aprobado;
- evidence no curada;
- warnings técnicos;
- suggestions de Claude;
- composer edits.

## Export

Tipos de export posibles:

| Export | Contenido |
|---|---|
| Executive PDF/Deck | Overview + top signals + moves + charts clave |
| Evidence pack | evidencias curadas de señales seleccionadas |
| CSV filtered evidence | solo si permisos aplican |
| Creative brief | hooks, claims, formatos, creators, do/don't |
| Budget defense | paid/organic gaps + evidence + recommended tests |

## Regla final

El cliente compra claridad y decisión. Noisia conserva profundidad y control. El output final debe exponer suficiente evidencia para confianza, sin exponer complejidad interna innecesaria.
