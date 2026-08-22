# Signal — Context-Aware Discovery and Brand OS Readiness

| Campo | Valor |
|---|---|
| Estado | `decision_canonized` |
| Registrado | `2026-08-21` (`America/Mexico_City`) |
| Packet diagnóstico | 115 proposals, preservado como baseline |
| Revisión operatoria | pausada antes de revisión masiva |
| Holdout / 10D | `sealed / false` |

## Veredicto

El Brand OS de Preview/UAT era suficiente para crear identidad, aliases, mercados y
slots de Acquisition, pero insuficiente para interpretar Topics & Narratives con calidad
estratégica. No fue, sin embargo, la causa directa del packet de 115 proposals: el run
10C.2C/10C.3A produjo embeddings exclusivamente desde el texto normalizado de cada
mención y ejecutó BERTopic/UMAP/HDBSCAN sin inyectar Brand OS, Knowledge Base o Study OS
en los vectores o en el objetivo de clustering.

El defecto de producto es una separación incompleta entre cuatro funciones diferentes:

1. **Acquisition truth:** qué scope, entidad, mercado, periodo y query evidence originan
   cada mención.
2. **Semantic shape:** qué estructuras conversacionales descubre un algoritmo local sin
   autoridad de producto.
3. **Strategic relevance:** por qué una estructura importa para la marca, su categoría,
   productos, audiencias y objetivos.
4. **Human expression:** cómo se nombra y explica un cluster a un operador.

Noisia debe mantener esas funciones separadas y conectarlas mediante contratos
versionados. Un cluster nunca se vuelve verdadero porque coincide con Brand OS, y Brand
OS nunca se vuelve decoración que sólo aparece al final.

## Evidencia observada en Amazon Alexa Preview/UAT

El perfil inspeccionado contenía:

- identidad primaria `Amazon Alexa`;
- aliases `Alexa`, `Alexa Plus` y `Alexa+`;
- mercados México y Estados Unidos;
- seis relaciones competitivas alineadas al corpus congelado;
- industria `Technology` y subindustria `Consumer Tech`;
- una descripción de una línea;
- un único bloque de Knowledge Base que declaraba categoría y competidores;
- Echo mencionado en texto libre, no como una jerarquía de productos gobernada.

Los gaps relevantes eran:

- categoría y subcategoría demasiado amplias;
- products y superficies Alexa/Echo no estructuradas;
- posicionamiento, jobs, necesidades, beneficios y fricciones ausentes;
- inclusiones, exclusiones y ambigüedades de identidad no declaradas;
- mercados sin una política explícita de variante lingüística y code-switching;
- Knowledge Base sin preguntas estratégicas ni frontera entre servicio Alexa,
  dispositivos Echo, dispositivos compatibles, Amazon genérico y homónimos;
- cero atributos estratégicos aprobados para orientar relevancia o naming.

Fuentes oficiales usadas para el perfil operativo:

- [Amazon México — Descubre Alexa](https://www.amazon.com.mx/b?node=19091372011), que
  distingue el servicio Alexa de los dispositivos Echo y enumera casa inteligente,
  productividad, compras, entretenimiento, comunicaciones y rutinas;
- [About Amazon — Alexa+](https://www.aboutamazon.com/news/devices/new-alexa-generative-artificial-intelligence),
  que define la evolución conversacional, personalizada y agentic de Alexa+;
- [Alexa en web](https://alexa.amazon.com/about), que confirma continuidad entre web,
  app y dispositivos compatibles.

## Causa del resultado 10C.3A

La ruta ejecutada fue:

```text
mention.text
  -> normalización local
  -> BGE-M3
  -> UMAP 8D
  -> HDBSCAN leaf
  -> BERTopic representation
  -> 115 discovery proposals pending
```

Scope, entity, market y locale se conservaron como memberships tipadas y se usaron para
slices, métricas y evidence. No restringieron el espacio de clustering. El corpus mezcló
primary brand, category y competidores en español e inglés dentro de una sola geometría
global. La explicación causal que debe contrastar 10C.3B es esa heterogeneidad combinada
con un density clustering global, no la calidad del Brand OS.

El packet actual conserva valor como baseline diagnóstico y no debe sobrescribirse,
relabelarse ni reinterpretarse después de editar Brand OS.

## Principio de diseño: algorítmico no significa context-free

El challenger context-aware permanece local y provider-free para memberships:

1. discovery por partición `scope + entity + market + language`;
2. alineación posterior entre clusters de distintas particiones;
3. features estructuradas derivadas sólo de Brand OS aprobado: identity, aliases,
   products, category, competitors, markets y exclusions;
4. labeling functions que votan o se abstienen;
5. score separado de `semantic_coherence` y `strategic_relevance`;
6. detección de novelty que no penalice conversaciones emergentes sólo por no aparecer
   en Brand OS;
7. comparación shadow contra el baseline global antes de adoptar un engine.

Queda prohibido concatenar el Brand OS completo a cada mención como pseudo-prompt o usar
sus términos para forzar todos los clusters. Eso produciría leakage, confirmation bias y
una falsa mejora de coherencia.

## Contextual naming acotado

Claude puede participar después de que exista un cluster coherente y sellado. Recibe:

- snapshot versionado de Brand OS y Knowledge Base;
- locale y mercado gobernados;
- distribución por scope y entidad;
- medoids, evidencia diversa, boundary examples y counterexamples;
- términos y limitaciones calculadas server-side.

Devuelve sólo una propuesta `pending` de nombre, descripción, utilidad estratégica y
posible Topic Contract. No calcula counts, no decide memberships, no genera SQL, no
aprueba contratos y no escribe serving. El costo se acota por cluster, no por mención.

## Semantic Context Pack aprobado

Knowledge Base conserva evidencia y narrativa humana; no se vectoriza como un bloque
monolítico ni se usa como pseudo-prompt por mención. Después de procesar los bloques KB,
Claude puede proponer un `Semantic Context Pack` estructurado y versionado con:

- términos de identidad, aliases, productos, features y surfaces;
- términos de categoría, necesidades, beneficios, fricciones y ocasiones de uso;
- términos competitivos agrupados por entidad canónica;
- variantes por locale, idioma, escritura y code-switching;
- exclusiones, homónimos, términos ambiguos y reglas de abstención;
- relaciones tipadas como `is_a`, `part_of`, `surface_of`, `competes_with` y
  `associated_with`;
- frases ancla positivas, negativas y boundary examples;
- source refs hacia Brand OS y Knowledge Base, nunca una autoridad sin lineage.

Cada propuesta inicia `draft/pending`. El operador puede aprobar, editar o rechazar cada
elemento y publicar una generación inmutable. Confidence, similitud o procedencia Claude
no conceden aprobación. Discovery consume únicamente generaciones approved y registra su
digest; un cambio posterior crea drift y nunca reinterpreta runs históricos.

El pack alimenta exact matching, labeling functions, anchor embeddings y relevancia
estratégica. No fuerza memberships ni sustituye la evidencia emergente: un concepto nuevo
puede seguir siendo novelty aunque no exista en el pack.

## Brand OS readiness gate

Antes de iniciar discovery estratégico, el workspace debe sellar una revisión de Brand
OS que compruebe:

- identidad primaria y aliases no ambiguos;
- categoría y subcategoría operativas;
- products y surfaces estructurados;
- competidores current alineados a Acquisition slots;
- mercados y locales explícitos;
- positioning y value proposition;
- inclusiones, exclusiones y homónimos conocidos;
- Knowledge Base con evidencia, preguntas estratégicas y limitaciones;
- digest reconciliado con Acquisition Plan;
- decisión explícita ante drift después del freeze de un run.

La edición de Brand OS crea una nueva versión. Nunca muta el contexto de un run histórico.
Un rerun debe declarar el nuevo `brand_os_digest`, comparar contra baseline y conservar
ambas generaciones.

## Secuencia de ejecución aprobada

1. Pausar la revisión masiva de las 115 proposals; se permite calibración pequeña sin
   finalizar el packet.
2. Completar y sellar Brand OS de Amazon Alexa en Preview/UAT.
3. Conservar el packet actual como baseline global context-free.
4. Preregistrar 10C.3B con estrategias `global`, `partition-aware` y `hybrid`.
5. Ejecutar challengers locales sin abrir holdout ni habilitar 10D.
6. Comparar utilidad humana, coherence, distinction, redundancy, outliers y proposal
   yield por partición.
7. Ejecutar naming contextual sólo sobre clusters que pasen el gate técnico y con hard
   cap explícito.
8. Reanudar el workbench sobre la generación seleccionada; ningún resultado se adopta
   automáticamente.

## Gates de implementación

La secuencia anterior se entrega en tres gates independientes. No se permite saltar del
Brand OS narrativo directamente al challenger de clustering:

### Gate 69A — Semantic Context Authority

- reutilizar Brand OS, Knowledge Base, taxonomías, artifact/evidence graph y autoridad
  append-only existentes;
- crear generaciones draft del Semantic Context Pack ligadas a
  `brand_os_digest + knowledge_digest`;
- aceptar propuestas server-owned de Claude únicamente como `pending`;
- permitir approve, edit, reject y supersession por elemento, con AuthZ, actor,
  idempotencia y lineage;
- publicar una generación inmutable y calcular `semantic_context_pack_digest`;
- fallar cerrado ante drift o ausencia de una generación approved;
- no ejecutar clustering, propagation, holdout ni serving.

### Gate 69A.2 — Bounded proposal adapter

- construir un adapter provider server-owned que lea el snapshot exacto de Brand OS y
  Knowledge ligado al draft;
- ejecutar como máximo una llamada por generación y sólo después de un preflight
  gratuito con confirmación humana y hard cap explícito;
- producir exclusivamente propuestas `pending` compatibles con los 20 tipos y cinco
  relaciones cerradas de 69A;
- validar schema, evidence refs, locale, entity y lineage antes de llamar al writer
  server-only de 69A;
- persistir operación, costo observado, usage, respuesta validada y fallo/recovery de
  forma auditable e idempotente;
- no crear una segunda autoridad, no autoaprobar y no enviar menciones al provider.

### Gate 69B — Admin operator workbench

- añadir el Semantic Context Pack después de Knowledge Base en Brand OS;
- agrupar por identidad, producto/surface, categoría, necesidad, beneficio, fricción,
  competidor, locale, exclusión, relación y anchor phrase;
- mostrar fuente, locale, confidence no autoritativa, estado y diferencia contra la
  generación anterior;
- ofrecer filtros y acciones explícitas de approve, edit, reject y bulk approval seguro;
- mantener generación y publicación como pasos diferentes;
- reutilizar componentes canónicos de Admin; no crear otro drawer, tabla o sistema de
  badges standalone.

### Gate 68 — Context-aware discovery challenger

- resolver server-side los digests approved de Brand OS y Semantic Context Pack;
- preregistrar estrategias global, partition-aware e hybrid;
- usar términos, relaciones y anchor phrases sólo como features, labeling functions y
  relevancia estratégica; nunca como verdad de membership;
- preservar novelty, abstención y el packet baseline de 115 proposals;
- producir únicamente discovery proposals pending;
- mantener holdout sellado y `SIGNAL_10D_READY=false`.

La salida de 69A habilita 69A.2. El adapter validado habilita el frontend 69B con una
generación real; sólo una generación revisada y publicada desde 69B habilita el preflight
de 68. Esta dependencia evita construir un workbench vacío y evita que un benchmark
vuelva a interpretar texto libre no gobernado como autoridad semántica.

## Checkpoint UAT · 2026-08-21

El Brand OS de Amazon Alexa se curó desde la interfaz de Preview/UAT sin modificar la
generación 10C.3A:

- descripción estratégica que separa servicio Alexa, dispositivos Echo, superficies y
  ecosistema;
- identidad, categoría y arquitectura del producto;
- fronteras semánticas, inclusiones, exclusiones y reglas de ambigüedad;
- mercados MX/US, locale y code-switching;
- preguntas estratégicas, lentes de análisis y protección de novelty;
- tres fuentes de Knowledge Base con referencias oficiales.

La verificación posterior mostró `3 aliases`, `6 competidores` y `3 fuentes de
conocimiento`. Acquisition Plan v2 permaneció activo y sin drift; Discovery Review
conservó `115 proposals`, `0 reviewed`, denominator `21,195`, coverage `52.8%`, outliers
`47.2%` y holdout sellado.

Este checkpoint completa la curación operativa de UAT, pero no convierte la prosa de
Knowledge Base en autoridad estructurada. Linear [NOI-69](https://linear.app/noisia/issue/NOI-69/adm-01a-productize-structured-brand-os-fields-and-readiness-contract)
canoniza esa deuda de producto; [NOI-68](https://linear.app/noisia/issue/NOI-68/tn-01a-add-brand-os-readiness-gate-and-partition-aware-discovery)
conserva la implementación del readiness digest y el challenger context-aware.

Durante el mismo QA se confirmó que `Relaciones base` no tenía estado colapsable: el
formulario se renderizaba abierto de forma incondicional. La corrección frontend reutiliza
el disclosure canónico del workspace, inicia cerrado y mantiene las acciones de guardado
fuera del panel.

## Criterios de salida

El bloque termina cuando:

- Brand OS de Amazon Alexa está estructurado, versionado y rehidratable;
- Acquisition Plan reporta explícitamente cualquier drift, sin cambiar imports
  congelados;
- existe un preregistro 10C.3B con baseline y challengers context-aware;
- el benchmark distingue calidad de discovery de relevancia estratégica;
- Claude, si se autoriza, opera cluster-level y produce sólo proposals pending;
- las 115 proposals originales siguen intactas y auditables;
- `SIGNAL_10D_READY=false` hasta una decisión posterior separada.

## Dependency update · 69A.3

**Registrado:** 2026-08-22T15:05:20-06:00 (`America/Mexico_City`).

El readiness de contexto ya no deja al operador atrapado ante drift. La reconciliación
crea una nueva generación draft append-only con Brand OS, Knowledge, locale/market y
provider lineage vigentes. No copia decisiones anteriores y no habilita discovery:
`ready_for_context_aware_discovery` permanece false hasta publicar explícitamente una
generación totalmente revisada y sin drift.
