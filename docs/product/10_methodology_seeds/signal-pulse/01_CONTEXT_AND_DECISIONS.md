# 01 — Contexto, decisiones y enfoque de producto

## Origen

La exploración inicial partió de una necesidad de conectar fuentes vivas al corpus. Primero se discutieron casos como reseñas, TikTok, Apify, SentiOne, Datashake, Tinyfish, Google Business Profile y otros conectores. Esa conversación sirvió para aterrizar una visión importante: Noisia necesita una capa entre organizaciones/marcas y corpus para integrar fuentes con precisión.

Luego el foco cambió: el problema inmediato no era solo conectar fuentes. Era que los reportes actuales podían ser demasiado complejos para usuarios de Marketing. La conclusión fue separar familias de output.

## Separación de familias

| Familia | Usuario | Pregunta | Output |
|---|---|---|---|
| Estratégica | Dirección, Strategy, Investigación | Qué significa y cómo cambia la estrategia | T&B, Brand Equity, Cultural Listening, Journey |
| Táctica Marketing | Marketing, agencia, Data Intelligence | Qué hago este mes con señales vivas | Signal Pulse |
| Operativa especializada | CX, Producto, Retail Ops | Qué proceso, experiencia o producto corregir | Futuras capas especializadas |

Signal Pulse pertenece a la segunda familia.

## Decisión central

Signal Pulse debe ser un reporte táctico de marketing, vivo y mensual-comparable, compuesto por pantallas específicas. El Overview introduce la historia con charts familiares de social listening reinventados por Noisia; el resto de pantallas profundiza en señales, decisiones, contenido, pauta, competencia, evidencia, corpus, fuentes y publicación.

## Qué se pausa

Durante esta línea de trabajo, pausar expansión visible de nuevas metodologías estratégicas. La infraestructura multimétodo puede permanecer en la rama, pero el objetivo de producto debe cambiar a:

1. corpus vivo;
2. fuentes/conectores;
3. signal store;
4. periodización mensual;
5. Signal Pulse pipeline propio;
6. Overview chart-first;
7. pantallas tácticas de marketing;
8. Composer y publicación.

## Qué se conserva

Se puede reutilizar infraestructura ya pensada o construida localmente:

- `canonical_signals`;
- `signal_observations`;
- evidencia;
- dedup de señales entre lecturas;
- `analysis_plan` si sirve como configuración;
- query packs/provenance;
- `mention_query_sources`;
- fan-out de CSV a varios scopes;
- Signal Live Composer;
- historia de señales;
- overview/monthly-analysis APIs;
- corpus explorer vivo;
- filtros por rango, lente/intent/entidad;
- chat guards y tests.

Pero esos elementos se reorganizan alrededor de Signal Pulse, no alrededor de más metodologías estratégicas.

## Qué no debe pasar

- No derivar Signal Pulse desde JSON de Triggers & Barriers.
- No mostrar metodología al usuario de Marketing.
- No convertir cada componente en pantalla.
- No hacer una bolsa agregada de 12 meses.
- No tratar performance data como conversación.
- No tratar entity/reference data como menciones.
- No permitir recomendaciones sin evidencia.
- No permitir que Claude invente números.
- No escribir cards largas.
- No diseñar solamente para retail o una marca específica.

## Usuario primario

El usuario primario ve presupuestos, campañas, contenido, agencias, pauta, creators, narrativa y performance. Debe sentir que el reporte le ayuda a tomar mejores decisiones de marketing.

Preguntas reales del usuario:

- ¿A qué tendencia me subo?
- ¿Qué contenido conviene producir?
- ¿Qué claim debería testear?
- ¿Qué narrativa debo evitar?
- ¿Qué tema está creciendo?
- ¿Qué está funcionando orgánico y merece paid?
- ¿Qué pauta está desconectada de la conversación?
- ¿Qué evidencia uso para defender presupuesto?
- ¿Qué riesgo puede explotar si lo prometo mal?

## Acciones correctas

Signal Pulse debe recomendar acciones como:

- amplificar narrativa;
- testear claim;
- crear contenido;
- ajustar pauta;
- briefear creators;
- defender presupuesto;
- evitar territorio;
- preparar contención;
- monitorear;
- reencuadrar audiencia;
- convertir orgánico en paid.

Si una recomendación pertenece a CX, Producto u Operaciones, se traduce para Marketing como riesgo, restricción de claim, warning de campaña o nota cross-functional. No se presenta como tarea principal del reporte.

## Frase final de producto

Signal Pulse no es un dashboard de percepción con recomendaciones. Es un sistema de señales para decidir marketing con datos, evidencia, narrativa y charts.
