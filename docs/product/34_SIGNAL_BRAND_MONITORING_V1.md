# 34 · Signal V2 — Monitoreo de marca V1

> **Estado:** build slice activo, 2026-07-24.
> **Pregunta:** ¿Qué se está diciendo de mi marca y de qué depende?
> **Audiencia:** marketing, comunicación y brand; especialmente quien reporta hacia
> arriba semanal o mensualmente.

Esta vista es la primera superficie almost-always-on de Signal V2. Vive en el shell
definido por `33_SIGNAL_V2_SHOPIFY_UI_REFERENCE.md` y consume el backend canónico
`signal-backend-v1`. No reemplaza Triggers & Barriers: primero explica el pulso vivo de
la conversación y después enlaza releases estratégicos menos frecuentes.

## Principio de producto

Los números salen de Data OS. Claude recibe paquetes métricos gobernados para interpretar
qué cambió, por qué puede importar y qué conviene revisar. Claude no vuelve a contar
menciones, no inventa denominadores y no sustituye el acceso al corpus.

Cada visual debe poder abrir las menciones que lo sostienen. `unknown`, `partial`,
`stale` y `not_available` son estados visibles; nunca se convierten en cero.

## Orden de lectura del dashboard

1. **Lo esencial del periodo.** Cambio principal, fecha de corte, cobertura y link a la
   evidencia.
2. **Unidades de conversación.** KPI strip de menciones, conversaciones/thread,
   publicaciones raíz y comentarios. No se suman ni se usan como sinónimos.
3. **Volumen de conversación.** Serie actual contra periodo anterior de igual duración,
   con selector de unidad. Un punto abre la evidencia del intervalo.
4. **Sentimiento.** Distribución positiva, neutral, negativa y sin clasificar; el net
   sentiment es secundario y nunca oculta el denominador clasificado.
5. **Composición.** Publicaciones raíz y comentarios a lo largo del tiempo para distinguir
   actividad editorial de conversación derivada.
6. **Origen de la conversación.** Plataformas y tipos de fuente gobernados, expresados
   como menciones y share; nunca como ratios `0–1` sin unidad.
7. **Engagement y atención.** Total, mediana, percentil 90, actividad y views calculados
   sólo sobre publicaciones raíz.
8. **Emociones.** Distribución multi-label entre menciones clasificadas; no usar un donut
   que fuerce exclusividad donde no existe.
9. **Tópicos y narrativas activas.** Share, cambio contra periodo anterior, sentimiento,
   engagement y evidencia. Una word cloud puede ser exploratoria, nunca la lectura
   principal.
10. **Concentración por thread.** Ranking de conversaciones que agrupa la publicación
    original y sus comentarios; explica qué conversaciones forman el volumen.
11. **Picos y anomalías.** Los tres movimientos más relevantes, su concentración de
   fuentes y las conversaciones que los explican.
12. **Conversaciones destacadas.** Tres positivas y tres negativas, priorizadas por
   impacto observado y explicadas sin perder el vínculo a la mención.
13. **Cobertura y frescura.** Menciones incluidas, ventana, fuentes con datos, último
    watermark y limitaciones.

## Métricas canónicas

| Componente | Contrato Data OS | Definición |
|---|---|---|
| Volumen | `conversation.volume@1` | Conteo de menciones canónicas incluidas |
| Conversaciones | `Signal Brand Monitoring read-through` | Conteo distinto de `thread id`; fallback a mention id cuando el proveedor no trae thread |
| Publicaciones / comentarios | `Signal Brand Monitoring read-through` | Clasificación determinista por `content_type`; `comment` es respuesta y el resto es publicación raíz |
| Velocidad | `conversation.velocity@1` | Cambio relativo contra ventana anterior de igual número de días |
| Sentimiento | `sentiment.share@1` | Share por polaridad entre menciones con clasificación gobernada |
| Emoción | `emotion.share@1` | Share multi-label de aserciones de emoción aceptadas |
| Plataforma | `platform.share@1` | Distribución de menciones con plataforma canónica |
| Tipo de fuente | `source_type.share@1` | Distribución gobernada; detalles internos pueden ocultarse al cliente |
| Atención de publicaciones | `Signal Brand Monitoring read-through` | Total, mediana, p90 y actividad sólo entre publicaciones raíz; usa total reportado y cae a componentes observados |
| Views | `Signal Brand Monitoring read-through` | Suma sólo entre publicaciones raíz y reporta cuántas tienen views positivas |
| Concentración | `Signal Brand Monitoring read-through` | Top threads por menciones; conserva publicación representativa, comentarios, engagement y views |
| Tópicos | `topic.volume@1` | Conteos de tags de tópico aceptados |
| Narrativas | `narrative.volume@1` | Conteos de taxonomía narrativa aceptada |

### Reglas temporales

- La comparación usa la ventana inmediatamente anterior con la misma cantidad de días y
  la misma zona horaria.
- Un mes se presenta por día. Hasta 90 días el default también es diario; después el
  usuario puede cambiar a semana o mes para conservar legibilidad.
- La UI no afirma comparación si cambió la definición, watermark o cobertura de forma
  material. En ese caso muestra `partial`.
- Un periodo sin medición es `not_available`; sólo un periodo medido sin eventos vale
  cero.

### Engagement y views

No mezclar reach con engagement. Reach es exposición potencial; engagement son
interacciones observadas. Los comentarios no son unidades válidas para sumar nuevamente
el engagement o las views de la publicación original. Por eso el primer slice calcula
total, mediana, p90 y porcentaje activo exclusivamente sobre publicaciones raíz.

`total interactions` reportado por SentiOne tiene prioridad. Cuando falta, el read-through
suma sólo componentes observados (`likes`, `comments`, `shares`, `reposts`, `saves`); no
imputa campos ausentes. Views se presenta aparte y siempre acompañada por el número de
publicaciones con views positivas.

El componente futuro de “qué se movió y qué pasó desapercibido” podrá ser un cuadrante
por tópico o narrativa:

- x: volumen;
- y: engagement promedio por mención medida;
- tamaño: reach sólo cuando exista cobertura comparable;
- color: sentimiento;
- click: menciones.

Si un proveedor no entrega los mismos componentes de engagement, el estado es `partial`
y la UI declara cobertura.

### Conversaciones destacadas

El ranking V1 usa interacción observada, intensidad de sentimiento y recencia. El
renderer muestra los componentes usados y no lo llama “impacto” cuando no existe reach
gobernado. La siguiente versión moverá este ranking a un contrato materializado con
lineage propio.

## Propuestas deliberadamente fuera de este slice

- **Selector earned / owned / all:** requiere un catálogo gobernado de identidades propias
  por marca. Inferir ownership desde coincidencias libres de `author` contaminaría todos
  los totales y comparaciones.
- **Waterfall de drivers:** sólo entra cuando exista una taxonomía exhaustiva y
  mutuamente excluyente cuyos componentes sumen exactamente el delta total.
- **Mapa geográfico, género, reach global e influence score:** se omiten porque el export
  actual no tiene cobertura semántica suficiente para comparaciones honestas.
- **Emociones vacías:** el bloque no se renderiza hasta que exista enrichment revisado.
  Reactions del proveedor no se renombran como emociones.
- **Word cloud y red de influencia:** no son lecturas principales; podrán vivir en
  exploración cuando tengan granularidad, lineage y una decisión explícita que apoyar.

## Charts y renderer

Signal V2 usa Apache ECharts como renderer del primer slice, con imports modulares,
`ResizeObserver`, altura estable antes del mount y tablas/labels accesibles. La API de
Data OS sigue siendo independiente del renderer.

No se adopta Polaris Viz: Shopify lo marcó deprecated y su analytics actual depende de
componentes privados/ShopifyQL. La traducción arquitectónica es:

```text
ShopifyQL → Shopify metric card → renderer Shopify
Data OS metric contract → Noisia metric card → ECharts
```

El grid es CSS Grid responsive, no drag-and-drop:

- `≥ 1200px`: 3 columnas;
- `900–1199px`: 2 columnas;
- `< 900px`: 1 columna y sidebar colapsable.

## Estados y aceptación del primer slice

- Shell fijo de `56px + 240px`, main con scroll aislado.
- Sólo Monitoreo de marca se monta; T&B y Corpus son links, no árboles ocultos.
- Filtros de periodo y comparación actualizan URL/request canónico.
- Volumen, sentimiento, plataformas y drill-down salen de Laika/Data OS.
- Menciones, threads, raíces, comentarios, atención y concentración usan el mismo
  predicado canónico de fecha, timezone y dimensiones que el resto de Data OS.
- Emoción o tópicos faltantes se omiten hasta tener clasificación gobernada; nunca se
  rellenan con datos demo ni se confunden reactions con emotions.
- Cero charts montados con ancho/alto cero.
- Cero warnings runtime.
- Desktop y mobile conservan jerarquía, foco y lectura.
- La ruta legacy `/signal/{outputId}` no cambia durante este slice.
