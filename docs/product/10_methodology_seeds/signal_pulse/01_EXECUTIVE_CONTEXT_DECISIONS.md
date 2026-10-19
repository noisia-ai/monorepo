# 01 — Executive context and decision log

## Origen de la decisión

La conversación inició explorando cómo conectar fuentes vivas para entender experiencia de consumidores en tienda. Esa exploración fue útil para pensar conectores, Google Reviews, TikTok comments, Apify, SentiOne, Datashake y futuras APIs. Sin embargo, el diseño del producto táctico no debe quedar sesgado a retail ni a una marca vertical.

El aprendizaje clave fue que Noisia necesita dos capas de entrega claramente separadas:

- **Reportes estratégicos:** profundos, metodológicos, útiles para estrategia, investigación y dirección.
- **Reportes tácticos de Marketing:** claros, visuales, vivos, orientados a decisiones de contenido, pauta, narrativa, claims, creators y presupuesto.

Signal Pulse nace como la segunda capa.

## Problema detectado

Los reportes existentes de Noisia son metodológicamente potentes, pero difíciles de consumir para usuarios de Marketing que buscan decisiones inmediatas. Pueden ser buenos para una sesión estratégica, pero no para una reunión semanal o mensual donde se decide:

- qué contenido producir;
- qué trend activar;
- qué narrativa evitar;
- qué pauta testear;
- qué creator briefear;
- qué señal ayuda a defender presupuesto;
- qué riesgo creativo o reputacional está creciendo.

El problema no es solo UX. Es arquitectura de producto: se estaba intentando que un mismo tipo de output sirviera para estrategia, análisis táctico y operación. Signal Pulse corrige eso.

## Decisión principal

Construir **Signal Pulse** como reporte táctico vivo para Marketing, no como derivado de Triggers & Barriers ni como dashboard genérico de social listening.

Signal Pulse debe tener pipeline propio, contrato propio, navegación propia, charts propios y reglas propias de publicación.

## Qué se mantiene de la arquitectura existente

Se puede reutilizar infraestructura común:

- organizaciones;
- marcas;
- corpus;
- import batches;
- mentions;
- query provenance;
- evidence store;
- canonical signals;
- signal observations;
- workers;
- embeddings;
- SQL aggregates;
- quality gates;
- live composer;
- published outputs o sistema equivalente de publicación.

Pero no se debe reutilizar como fuente primaria el output narrativo de metodologías estratégicas.

## Qué se pausa

Durante la implementación de Signal Pulse, poner en pausa la expansión de nuevas metodologías estratégicas visibles al usuario. La rama puede conservar infraestructura multimétodo, pero la prioridad de producto cambia:

1. estabilizar corpus vivo;
2. conectar fuentes;
3. materializar periodos mensuales;
4. generar señales canónicas;
5. construir Signal Pulse;
6. publicar cortes mensuales vivos;
7. después retomar metodologías estratégicas.

## Qué no debe pasar

No hacer estas cosas:

- No convertir JSON de Triggers & Barriers a Signal Pulse.
- No meter todas las secciones como tabs.
- No diseñar Signal Pulse alrededor de una marca o vertical específica.
- No mostrar metodología al frente.
- No escribir cards largas con lenguaje de consultor.
- No usar charts como decoración.
- No permitir recomendaciones sin evidencia.
- No tratar un CSV de tiendas o campañas como menciones conversacionales.
- No analizar 12 meses como una sola bolsa.
- No permitir que Claude invente porcentajes, conteos, deltas o rankings.

## Decisiones registradas

| Decisión | Resultado |
|---|---|
| El usuario primario es Marketing | Las acciones son de contenido, pauta, claims, creators, narrativa y presupuesto |
| El reporte es vivo | Los datos se conectan al corpus y agregados por periodo |
| El análisis es mensual-comparable | 3, 6 o 12 meses se analizan como cortes discretos |
| El Overview incorpora charts social listening reinventados | Familiaridad visual para marketers + inteligencia Noisia |
| La navegación son pantallas reales | 11 pantallas navegables agrupadas por función |
| Las fuentes se tipifican | Conversation, performance, entity/reference, knowledge/context |
| Claude interpreta, SQL calcula | Evita números inventados y mantiene trazabilidad |
| El composer es parte central | La IA detecta; Noisia cura; el reporte se publica como corte editorial |

## Frase de alineación

Signal Pulse es un reporte táctico de marketing, vivo y mensual-comparable, compuesto por pantallas específicas. El Overview introduce la historia con charts familiares de social listening reinventados por Noisia; el resto de pantallas profundiza en señales, decisiones, contenido, pauta, competencia, evidencia, corpus, fuentes y publicación.
