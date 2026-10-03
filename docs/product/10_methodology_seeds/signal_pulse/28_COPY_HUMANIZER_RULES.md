# 28 — Copy humanizer rules

## Propósito

Definir reglas de copy para Signal Pulse. El reporte debe ser humano, breve, claro y útil para Marketing. El humanizer no es maquillaje final; es una regla de diseño desde el prompt y la UI.

## Estilo base

- Directo.
- Específico.
- Seguro sin exagerar.
- Breve.
- Con dato cuando hay dato.
- Con limitación cuando hay limitación.
- Orientado a decisión.

## Prohibido

Evitar:

- prosa larga;
- frases genéricas;
- lenguaje de consultor;
- slogans vacíos;
- “No es X, es Y” como muletilla;
- em dash ornamental;
- palabras como pivotal, landscape, tapestry, underscore;
- “unlockear insights accionables”;
- “ecosistema conversacional” salvo en documentación interna;
- conclusiones positivas genéricas.

## Tamaños de copy

| Elemento | Longitud |
|---|---:|
| Card title | 3–9 palabras |
| Signal description | 1–2 frases |
| Executive headline | 1 frase |
| Marketing move | 1 acción + 1 razón |
| Tooltip | 3–6 líneas cortas |
| Drawer intro | 2–3 frases |
| Limitation | 1 frase honesta |
| Chart reading | 1–3 frases |

## Estructura de Signal Card

```text
[Estado] Título de señal
Qué está pasando: 1 frase.
Movimiento: 1 acción concreta.
Footer: evidencia + confianza + delta.
```

## Ejemplos

### Bueno

> La conversación está premiando explicaciones simples. La señal creció cuatro meses seguidos y aparece también en orgánico. Probar claims prácticos antes de escalar más pauta aspiracional.

### Malo

> La audiencia está redefiniendo el landscape de comunicación hacia un paradigma de claridad que subraya la necesidad de optimizar el ecosistema narrativo de la marca.

## Voice para Marketing

Usar palabras que Marketing mueve:

- claim;
- hook;
- pauta;
- creator;
- contenido;
- narrativa;
- territorio;
- presupuesto;
- test;
- campaña;
- orgánico;
- performance;
- riesgo;
- evidencia.

## Voice para warnings

Debe ser honesto:

- “Este mes no es totalmente comparable porque falta Meta Organic.”
- “La señal viene casi completa de TikTok; úsala como señal cualitativa.”
- “Hay evidencia positiva, pero todavía no alcanza para mover presupuesto fuerte.”

## Prompting

Los prompts de Claude deben pedir:

- no inventar números;
- usar los nombres de métricas entregadas;
- escribir para Marketing;
- máximo de caracteres por bloque;
- incluir limitaciones cuando aplique;
- separar lectura de acción;
- no explicar metodología;
- no usar claims absolutos si confidence no es alta.

## Humanizer QA

Antes de publicar:

- detectar palabras prohibidas;
- detectar párrafos largos;
- detectar frases genéricas;
- detectar repetición de estructura;
- detectar recomendaciones sin verbo accionable;
- detectar claims absolutos;
- detectar números sin data_ref;
- detectar tono demasiado académico.

## Regla final

El copy debe ayudar a decidir. Si solo suena inteligente, pero no mueve una acción, se reescribe.
