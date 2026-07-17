# 09 — Copy, UI, charts y quality gates

## Copy humanizado

Las cards deben ser breves. No escribir como consultor ni como IA.

### Reglas

- Una card tiene un headline, una lectura corta y una acción.
- Evitar párrafos largos.
- Usar lenguaje de Marketing: claim, contenido, pauta, creator, narrativa, presupuesto, riesgo.
- No usar jerga metodológica.
- No usar frases tipo “optimizar la experiencia” sin acción concreta.
- No usar “no es X, es Y” como muletilla.
- No usar “landscape”, “pivotal”, “tapestry”, “underscore” ni equivalentes inflados.
- No cerrar con generic positive conclusion.
- Aceptar complejidad cuando exista.
- Si falta evidencia, decirlo.
- Si la señal es débil, no venderla como verdad.

### Formato de Signal Card

```text
Título: Beneficio concreto sobre aspiración
Lectura: La conversación premia mensajes que explican el beneficio en uso real.
Movimiento: Testear tres claims prácticos en Meta y TikTok.
Confianza: Media-alta · presente en 8 de 12 meses.
```

## UI direction Noisia

El diseño debe seguir el lenguaje actual de Noisia Signal, no parecer dashboard SaaS genérico.

Principios visuales:

- oscuro/premium cuando el sistema lo use;
- alto contraste controlado;
- cards con densidad respirable;
- charts como protagonistas, no adornos;
- navegación lateral agrupada;
- microcopy útil;
- menos texto en cards;
- drawers para profundidad;
- estado live/published visible;
- motion sutil;
- interacción inmersiva solo donde aporta.

## Charts

Usar `shadcn/ui Chart` para charts cartesianos y series:

- LineChart;
- AreaChart;
- BarChart;
- ComposedChart;
- ScatterChart;
- stacked bars;
- small multiples.

Usar custom visualization para:

- Semantic Signal Galaxy;
- Emotional Density overlay;
- clusters semánticos;
- network/force layout;
- auras emocionales;
- interacción inmersiva.

## Tooltip estándar

Todo tooltip debe incluir:

- nombre;
- periodo;
- métrica principal;
- delta;
- fuente principal o source mix;
- confidence;
- click action.

Ejemplo:

```text
Beneficio concreto
Impacto: 78
Delta: +31% vs mes anterior
Emoción dominante: confianza
Fuente principal: TikTok comments
Confianza: media-alta
Click para ver evidencia
```

## Quality gates

### Publicación bloqueada si

- hay números inventados;
- falta evidencia en una señal promovida;
- hay marketing move sin evidence refs;
- hay delta con periodos no comparables;
- chart crítico no tiene data_ref;
- fuente domina sin warning;
- señal de baja confianza se presenta como alta;
- copy viola reglas humanizer;
- se filtra metodología estratégica al cliente;
- role visibility expone data sensible.

### Publicación con warning si

- fuente parcial;
- performance data incompleta;
- baja cobertura en un mes;
- señal relevante pero con evidencia limitada;
- competitive/category no configurado;
- author data limitada;
- source stale no crítica.

## Quality checklist por señal

Cada señal publicada debe tener:

- título humano;
- interpretación corta;
- lifecycle status;
- métricas refs;
- chart refs;
- evidence refs;
- source mix;
- confidence;
- limitation si aplica;
- marketing move o reason para solo monitorear;
- fecha/periodo;
- estado live/published.

## Quality checklist por marketing move

Cada movimiento debe tener:

- tipo;
- acción concreta;
- señal que lo soporta;
- evidencia;
- dueño probable;
- métrica para medir;
- prioridad;
- confidence;
- caveat si hay riesgo.

## Regla final

El reporte debe sentirse bonito, justificable y accionable. Si una card no ayuda a decidir, se recorta. Si un chart no cuenta una historia del dato, se elimina.
