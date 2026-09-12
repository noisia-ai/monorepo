# Topics consolidados y Signal con paridad visual

Fecha: 12 septiembre 2026. Estado: **plan de ejecución activo en UAT**.

Este plan continúa el recorrido Alexa Plus ya comprobado. Conserva su corpus, embeddings,
fit, 1,652 grupos atómicos, 36 Topics materializados, clasificación completa, selección de 67
menciones y recibos. No repite imports, Voyage del corpus, BERTopic ni SQL0167–0169.

## Decisión de producto

Los grupos de BERTopic son unidades computacionales de linaje. No son el catálogo que administra
un cliente. El catálogo cliente tendrá conceptos editoriales más amplios, legibles y editables:

```text
43,159 raíces y 124,867 fragmentos
  → 1,652 grupos atómicos de BERTopic, preservados
  → dossiers compactos con Brand OS, tamaño, términos y evidencia
  → familias semánticas propuestas desde centroides existentes
  → revisión completa de Sonnet 4.6
  → Topics / Narratives / Noise / sin resolver
  → selección editable
  → un Signal común para todas las marcas
```

`Noise` es una disposición visible y reversible. No borra menciones. Cada concepto editorial
conserva una relación muchos-a-uno con sus grupos atómicos; éstos conservan la relación con raíces,
fragmentos y evidencia original. Un Topic representa un asunto estable. Una Narrative representa
una afirmación o marco recurrente sobre ese asunto.

## Lo que se reutiliza

- Los embeddings de las menciones y los centroides derivados del fit actual. Voyage no se vuelve a
  ejecutar sobre el corpus completo.
- Brand Context v2 y sus anchors/exclusiones como contexto de relevancia y fronteras, no como una
  taxonomía que obligue a cada conversación a encajar.
- Los representantes diversos de cada grupo y sus referencias selladas.
- La cola, ledger, admisión, presupuesto, recibos, checkpoints y productor progresivo existentes.
- El shell, cards, charts, evidence drawer, filtros y jerarquía visual del Signal de Laika.

## Qué hacía el runtime anterior

La implementación histórica `signal-taxonomy-enrichment` recorría menciones pendientes en batches,
recuperaba contexto RAG con Voyage y pedía a Claude clasificar cada mención contra términos activos.
Ese camino era costoso para 100K–2M registros y quedó retirado en Gate 10B. La muestra de hasta 10K
se usaba para comprensión editorial/insights; no acreditaba clasificación completa. El pipeline
actual corrige esa debilidad: BERTopic y la propagación determinística/local cubren la población;
Claude interpreta grupos compactos y resuelve decisiones editoriales.

## Dossier de grupo

Cada uno de los 1,652 grupos se presenta al modelo mediante un objeto acotado:

- identidad estable y digest del grupo;
- lane y tamaño en raíces/fragmentos;
- términos representativos;
- hasta diez evidencias diversas con referencias, idioma, plataforma y fecha;
- distribución por scope de archivo: marca, competencia y categoría;
- distribución de idioma/plataforma/tiempo;
- afinidad con guías positivas, negativas y de abstención de Brand OS;
- vecinos de grupo por similitud de centroide;
- métricas de cohesión/outlier cuando estén disponibles.

No se envían todas las menciones ni SQL generado por el modelo. Los dossiers se versionan y su
digest forma parte del request. El modelo sólo puede referirse a grupos y evidencias presentes.

## Dos pasos de consolidación

1. **Propuesta numérica gratuita.** Reutilizar centroides para construir un grafo k-NN de grupos y
   comunidades candidatas. Los thresholds son configuración versionada; ninguna comunidad se
   publica por el score por sí solo.
2. **Revisión editorial completa.** Sonnet 4.6 revisa todos los dossiers en batches, decide
   relevancia, idioma y disposición, y propone fusiones/nombres/definiciones. Una validación global
   posterior impide grupos omitidos, duplicados o asignados a conceptos incompatibles.

El presupuesto del corte tendrá tope explícito de USD 20 para consolidación, dentro de los USD 32
disponibles comunicados por el operador. El preflight mostrará máximo, reserva y saldo. Una respuesta
pagada nunca se descarta por un error de UI; cada request conserva recibo y recuperación.

## Signal común

La causa comprobada de la diferencia visual es un branch en `SignalV2WorkspacePage`: cuando existe
`signal-workspace-topics-serving-v1`, tanto `monitoring` como `topics` se sustituyen por
`SignalV2WorkspaceTopics`. Laika sigue el contrato completo `signal-brand-monitoring-v1`.

El corte elimina esa sustitución para `monitoring`. La portada de cualquier workspace compone el
mismo sistema visual de Laika con módulos independientes:

- volumen y estructura conversacional determinísticos;
- plataformas y fuentes;
- sentimiento únicamente cuando exista cobertura real;
- Topics y Narratives seleccionados;
- Noise y sin resolver con cobertura explícita;
- evidencia positiva/negativa sólo cuando exista la dimensión correspondiente;
- insights editoriales versionados, o un estado parcial dentro de su card.

Una dimensión ausente deja su módulo en `not_available`; no convierte toda la portada en una tabla
técnica ni inventa datos. Topics conserva su página de exploración y detalle, pero adopta el mismo
lenguaje visual.

## Cortes de ejecución

### C1 · Dinero y recuperación

1. Conciliar el request terminal `req_011CeyVmgripksCpPrcf19im`: la consola acredita 25,703 tokens
   de entrada, 2,753 de salida y estado OK. Con las tarifas selladas, el costo es USD 0.118404.
   Registrar conciliación append-only; sustituir la exposición conservadora de USD 1.192104 sin
   borrar el recibo terminal.
2. Implementar la excepción durable para `repair_invalid` descrita en
   `PLAN_INTERPRETATION_REPAIR_EXCEPTIONS_2026-09-12.md`. Aislar el lote es gratuito y separado de
   la autorización de gasto que procesa los grupos restantes.

### C2 · Dossiers y consolidación

1. Materializar descriptores/digests para todos los grupos atómicos sin proveedor.
2. Proponer comunidades por similitud usando embeddings existentes.
3. Mostrar censo, costo máximo y acción de interpretación en Topics.
4. Ejecutar Sonnet 4.6 con tope de USD 20, recibos por batch y cobertura 1,652/1,652 o excepciones
   explícitas.
5. Materializar catálogo consolidado, Noise y linaje; no alterar la generación actual hasta que el
   sucesor valide.

### C3 · Signal y rendimiento

1. Crear el lector nativo de Brand Monitoring sobre la misma generación, derechos y periodo que
   Topics/Menciones.
2. Servir la portada con los componentes de Laika y estados parciales honestos.
3. Perfilar la consulta de Menciones después del digest. SLO inicial: p95 caliente ≤2.5 s y p95
   frío UAT ≤5 s para primera página de 50, con foco ≤5 s. Un corte que no llegue conserva la
   medición y el cuello identificado; no degrada cursor, búsqueda, filtros, derechos o integridad.

## Gates de aceptación

- 1,652 grupos contabilizados exactamente una vez entre concepto editorial, Noise y sin resolver.
- Ninguna mención se borra al marcar Noise; linaje concepto → grupo → raíz → evidencia consultable.
- Nombres/definiciones usan el locale de evidencia y Brand OS; grupos fuera de Alexa+ no se publican
  como Topics relevantes.
- La selección existente y sus 67 menciones sobreviven o tienen una sucesión explícita y trazable.
- La portada de Alexa Plus usa el mismo shell y sistema de cards/charts que Laika.
- Costos confirmados, reservados y conciliados cuadran; no quedan llamadas inciertas en vuelo.
- Segunda carga futura puede asignarse contra conceptos existentes y crear candidatos emergentes sin
  volver a procesar el corpus histórico completo.

## Avance comprobado del corte

Estado al 12 de septiembre, después del inicio de este plan:

- `repair_invalid` ya tiene recuperación durable y fue ejercitado una vez en UAT. El lote inválido
  quedó aislado y la ejecución se detuvo ante la admisión editorial revocada, sin repetir una llamada
  de proveedor.
- La reserva terminal de USD 1.192104 quedó conciliada contra el recibo real de USD 0.118404. La vista
  canónica de presupuesto conserva USD 1.310931 confirmado y cero reservado, ambiguo o terminal.
- Menciones redujo la primera página de 25 a cinco viajes SQL. La medición UAT del lector fue 2.421 s
  fría y 2.270 s caliente; cumple el SLO inicial del plan.
- Alexa Plus ya usa el shell común de Signal. La comparación live con Laika confirma que la brecha
  restante no es otro layout base: faltan catálogo editorial completo y dimensiones reales para
  alimentar presencia temporal, sentimiento, evidencia inline y relaciones.
- SQL0174 y el Worker C2 preparan el censo exacto, centroides y comunidades sin proveedor. El contrato
  editorial revisa los 1,652 grupos en 42 lotes de Sonnet 4.6 y después ejecuta una revisión global
  que fusiona candidatos en un máximo de 500 Topics/Narratives, conservando Noise y sin resolver.
- SQL0175 añade una única acción cliente gratuita para preparar ese censo. La política, admisión,
  outbox, lease, recuperación y ACL se probaron sobre PostgreSQL 17 con pgvector. El ensayo descubrió
  y cerró antes de UAT un decimal que el digest canónico no podía sellar: el umbral ahora se expresa
  como entero en partes por millón. El source binding reutiliza el digest sellado del input completo.
- Los dossiers calculan afinidad positiva, negativa y de abstención contra las guías publicadas de
  Brand OS usando sus embeddings existentes; no vuelven a llamar a Voyage. La ejecución de prueba de
  1,652 grupos, la cola durable, typechecks, build de Studio y suites focales están cerrados localmente.
- La auditoría de legacy confirmó que el corpus grande se recorría en lotes de 30 menciones con
  concurrencia cuatro y que una jerarquización posterior nombraba grupos. También encontró pérdidas
  silenciosas que no se trasladan: el resumen retenía sólo top 60 y una mención tomaba el primer
  cluster coincidente. La taxonomía visual madura de Laika era otro flujo: proponía 5–20 conceptos por
  tipo desde Brand OS y sólo 100 menciones deterministas. Su UI es reutilizable; su muestra no acredita
  cobertura semántica completa.
- La ficha oficial vigente de Sonnet 4.6 confirma USD 3/MTok de entrada, USD 15/MTok de salida, 1M de
  contexto y 128K de salida máxima. El producto mantendrá un límite menor por request y el tope global
  de USD 20 definido arriba.

Pendiente inmediato: terminar la autoridad numérica gratuita y su cola, aplicar SQL0174–0175 una sola
vez en UAT, correr el censo real de Alexa Plus y usar su distribución de comunidades para sellar la
admisión editorial pagada. Ninguna generación actual se sustituye antes de validar el sucesor.
