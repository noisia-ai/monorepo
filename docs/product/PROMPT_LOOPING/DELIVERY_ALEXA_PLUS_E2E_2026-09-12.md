# Alexa Plus: recorrido real de marca nueva a Signal en UAT

Fecha: 12 septiembre 2026.

Estado: **recorrido comprobado en UAT con interpretación parcial y reserva terminal pendiente**.
La clasificación cubre todo el corpus elegible; la interpretación semántica no cubre todos los
grupos. Este recibo no declara el producto completo ni listo para producción.

## Identidad y entrega

| Referencia | Valor |
| --- | --- |
| Marca | Alexa Plus / ALEXA+ |
| Brand ID | `5894a799-7609-4395-9e01-89770051b75f` |
| Workspace ID | `979b8f96-3366-463d-8ee8-8c0cce460a71` |
| Slug | `alexa-plus-e2e-2026-09-12` |
| Ejecución de análisis | `46c735c7-dcb0-4fa4-aa42-2ef0b0b7a93d` |
| Commit UAT | `1dd6882337ce15f9ec72894df566316f954c0b3b` |

La marca se creó desde la interfaz, con Brand OS, Knowledge Base y competidores editables.
Brand Context v2 quedó preparado como autoridad semántica para el recorrido. Las llamadas de
Claude y Voyage utilizaron sus controles de admisión, topes y recibos; guardar la marca o editar un
tópico no equivale a autorizar gasto nuevo.

Alexa Plus es un workspace nuevo y aislado. Esta entrega no depende de National ni de la marca
AMAZON ALEXA histórica.

## Corpus recibido y preparación

Los nueve CSV se cargaron desde la UI. El inventario y los nombres de origen están en el
[plan del experimento](PLAN_ALEXA_PLUS_E2E_2026-09-12.md). `_rename_map.csv` y los archivos de
`_descartar` no forman parte de la importación.

| Medida | Resultado comprobado |
| --- | ---: |
| Archivos CSV importados desde UI | 9 |
| Filas originales recibidas | 57,334 |
| Menciones únicas | 47,285 |
| Filas duplicadas | 10,049 |
| Raíces elegibles para análisis | 43,159 |
| Menciones excluidas de la preparación | 4,126 |
| Fragmentos preparados | 124,867 |

Los recuentos concilian: `57,334 = 47,285 + 10,049` y `47,285 = 43,159 + 4,126`.
Las exclusiones de preparación no se presentan como pérdida de filas importadas. Los duplicados,
las menciones únicas y los fragmentos representan unidades distintas.

## Resultado computacional, Topics y Signal

1. **Voyage del corpus completo.** Se prepararon los embeddings de las 43,159 raíces elegibles
   y sus 124,867 fragmentos, con 1,156 llamadas registradas.
2. **BERTopic completo.** El cómputo numérico terminó y produjo 1,652 grupos. Los artefactos y
   checkpoints quedaron persistidos; una reanudación editorial conserva esta ejecución.
3. **Interpretación parcial con Sonnet 4.6.** El resultado disponible contiene 36 tópicos. No son
   1,652 grupos interpretados ni 36 tópicos cuya calidad haya quedado validada exhaustivamente.
4. **Clasificación completa del corpus elegible.** La generación terminó con 43,159 de 43,159
   raíces y 2,161 asociaciones. Una raíz puede tener ninguna o varias asociaciones; por eso el
   contador de assignments no mide el avance del trabajo. La cobertura de raíces no elimina la
   cobertura semántica parcial.
5. **Edición y selección reales.** Se renombró y seleccionó el tópico **«Acceso anticipado a
   Alexa+»**. Signal muestra **67 menciones** para esa selección, con evidencia original. El
   cambio de nombre conserva la selección y las asociaciones; no inicia otro análisis.

Este cierre acredita una selección real sobre resultados derivados del corpus nuevo. No acredita
todavía un ciclo de monitoreo incremental tras una segunda carga real ni la calidad de todos los
descubrimientos.

## Costos y reserva pendiente

Todos los importes siguientes están expresados en USD. La reserva terminal se mantiene separada
del gasto confirmado; `terminal_confirmed` no significa costo liquidado ni permiso para liberar
esa reserva.

| Proveedor y etapa | Llamadas / estado | Costo confirmado | Reserva pendiente |
| --- | --- | ---: | ---: |
| Voyage, corpus | 1,156 llamadas | 3.709153 | — |
| Voyage, Brand Context | Preparación semántica | 0.000650 | — |
| Claude Sonnet 4.6, interpretación | 14 llamadas registradas; 12 settled | 1.192527 | 1.192104, terminal_confirmed |
| Claude Sonnet 4.6, Brand Context | Preparación semántica | 0.249657 | — |

La reserva terminal de interpretación requiere resolución mediante el protocolo existente y su
evidencia de proveedor. No debe sumarse a settled, liberarse por conveniencia ni eludirse abriendo
otra ejecución. Esta tabla identifica las partidas comprobadas del recorrido; no sustituye los
ledgers ni atribuye importes a otras ayudas de intake.

Durante la recuperación, `95d0765` fijó el contrato de contexto editorial acotado
`workspace-engine-brand-context-v2` sin cambiar los digests de solicitudes históricas. El intento
con permiso diario vencido quedó definitivamente no enviado; la continuación exigió una admisión
explícita sobre la misma ejecución. Una respuesta ya pagada se conserva para recuperación, no se
reemplaza con otra llamada por perder el estado del navegador.

## Rendimiento y estado de la interfaz

- **Marcas:** shell de aproximadamente **134 ms** y carga de métricas de aproximadamente
  **7.1 s**. Son mediciones de esta entrega UAT, no un SLA ni un benchmark de producción.
- **Proyección:** el Worker ya procesa páginas de 128 raíces y confirma cada página de forma
  atómica. La observación de 3,328 generation_items en unos dos minutos era aproximadamente
  1,664 raíces/minuto; la lectura inicial de assignments/minuto no representaba el rendimiento.
  El cierre posterior confirma las 43,159 raíces.
- **Menciones:** el foco de evidencia dejó de ejecutar dos lecturas HTTP secuenciales y cuatro
  reconstrucciones del corpus. El commit UAT `7ac8644` resuelve lista, resumen y foco con una
  petición y una población materializada. La navegación real con el corpus de Alexa Plus pasó de
  no completar en más de 80 s a mostrar 50 de 43,159 y abrir la mención enfocada en **18.3 s**.
  La evidencia y su enlace original quedaron comprobados. La reducción es material, aunque la
  lectura completa de aproximadamente 16 s sigue siendo deuda de escala del backend y no un SLO
  aceptado para producción. Un `EXPLAIN ANALYZE` de sólo lectura atribuyó aproximadamente 12.8 s
  a recalcular `sha256(text_clean)` sobre 43,159 raíces y 134 MB de texto; raíces, preparación y
  membresías terminaron por debajo de 0.8 s. No es Redis ni la búsqueda vectorial. El corte seguro
  siguiente quedó entregado en `1dd6882`: `mentions.text_clean_sha256` persiste el digest
  byte-exacto, el trigger lo mantiene en inserts y cambios reales de texto, y el lector lo reutiliza
  sin alterar la semántica de `mentions.text_hash`. SQL0167–0169 hizo backfill de 217,526 filas en
  44 lotes con trabajo y un lote terminal, validó cero nulos y cero divergencias, volvió la columna
  `NOT NULL` y retiró el helper/estado transitorios. Los snapshots de negocio antes y después son
  idénticos (`sha256:94de43e3f80f799a21caae5298e6cf4017dffd52d225d41c3037e837dd050b7a`).
  La medición DB posterior, de sólo lectura y con conexión remota, bajó el loader de 16.3 s a
  **8.4 s** y la consulta principal de aproximadamente 13.7 s a **5.8 s**; conserva 43,159 totales,
  50 filas, cursor y foco exacto. Con Studio y Worker activos en `1dd6882`, una navegación limpia
  mostró la página, el foco y la evidencia en **5.9 s**, con «1–50 de 43,159» y «Abrir original».
  Es una medición UAT, no un SLO de producción.
- **Capacidad transitoria:** el Worker se amplió temporalmente a dos réplicas durante la
  clasificación y volvió a una réplica después de comprobar cero jobs reclamables. Studio y
  Worker quedaron activos primero en `7ac8644` y finalmente en `1dd6882`; el ajuste no reinició el
  análisis ni alteró su generación.
- **Catálogo parcial:** `a110216` mantiene visibles los Topics materializados cuando la reparación
  editorial termina inválida y explica que siguen editables y seleccionables con cobertura parcial.
  Durante la consulta inicial del estado ya no aparece el falso bloqueo «Las menciones necesitan
  preparación»; los casos realmente sin corpus, legacy y de sólo lectura conservan su acción. QA
  real posterior al despliegue, a las 13:13 UTC, comprobó ambos estados y la selección de 67
  menciones intacta.

## Evidencia y comprobación

Las referencias de navegación del caso son:

- [Overview de Alexa Plus en UAT](https://studio-uat-uat.up.railway.app/studio/brands/5894a799-7609-4395-9e01-89770051b75f).
- [Brand OS](https://studio-uat-uat.up.railway.app/studio/brands/5894a799-7609-4395-9e01-89770051b75f/brand-os).
- [Datos y fuentes](https://studio-uat-uat.up.railway.app/studio/brands/5894a799-7609-4395-9e01-89770051b75f/data).
- [Topics y selección hacia Signal](https://studio-uat-uat.up.railway.app/studio/brands/5894a799-7609-4395-9e01-89770051b75f/topics).

Los recibos privados de la entrega se conservan bajo
`.data/alexa-plus-e2e-2026-09-12/release/`; las observaciones de UI anteriores están bajo
`.data/alexa-plus-ui-qa-2026-09-12/`. Esos artefactos están ignorados por Git y los checkpoints
anteriores no sustituyen el estado final descrito aquí. No se incorporan credenciales, respuestas
crudas de proveedor ni contenido del corpus a este documento.

Para contrastar el cierre, las lecturas deben quedar acotadas al workspace y a la ejecución
identificados arriba: imports/preparación para el censo, `engine_cost_events` para estados
monetarios, `signal_topic_catalog_executions` para progreso, y la generación vinculada en
`signal_classification_generations`, `signal_classification_generation_items` y
`signal_classification_assignments` para cobertura y asociaciones. No se debe elegir una
generación distinta por un contador global ni confundir la ejecución de análisis con su
proyección de clasificación.

La revisión focal de páginas/proyección pasó **27/27 pruebas**, incluidos cursor durable,
acknowledgement perdido, integridad de fragmentos, revocación, correcciones humanas y cobertura
parcial. La corrección de Menciones pasó **23/23 pruebas Studio**, dos unitarias DB, typecheck DB y
Studio, ESLint focal, `git diff --check` y revisión independiente sin P0/P1/P2. La integración PG
local no se repitió sin su entorno; la lectura real contra UAT verificó el contrato y la UI remota
confirmó el resultado. La corrección de catálogo parcial pasó **32/32 pruebas focales**, typecheck,
ESLint, `git diff --check` y otra revisión independiente sin P0/P1/P2. Estas pruebas respaldan los
contratos afectados; no certifican el producto completo.

El corte del digest pasó typecheck DB, **7/7 pruebas focales**, una integración PostgreSQL real bajo
rollback, `git diff --check` y revisión independiente sin P0/P1/P2. La migración UAT tardó
1,501,940 ms entre preparación, backfill y validación. El recibo privado
`uat-0167-0169-migration-receipt.json` registra hashes de cada SQL, runner y journal; SQL0167–0169
ya se aplicó una sola vez y no debe repetirse.

## Deudas y siguiente aceptación

| Pendiente | Aceptación necesaria |
| --- | --- |
| Latencia de Menciones | El digest exacto, su backfill y la validación UI de 5.9 s ya están en UAT. Continuar el perfilado de los ~5.8 s de consulta restantes y definir un SLO, manteniendo filtros, derechos, cursor, snapshot, foco e integridad withheld. |
| Segunda carga incremental real | Cargar datos legítimamente nuevos por UI; verificar deduplicación, admisión, actualización y continuidad de la selección sin repetir el primer corpus. |
| Calidad y locale | Revisar relevancia, límites de marca/competencia/categoría, idioma y nombres de tópicos con evidencia. No equiparar agrupación numérica con validación semántica. |
| Recuperación del checkpoint | Reducir la reexportación de chunks y la descarga/validación completa de modelos cuando sólo falta interpretación; conservar identidad, hashes y checkpoints. Hoy los dos modelos de este caso suman aproximadamente 3.60 GB. |
| `repair_invalid` | Resolver la recuperación editorial cuando el único repair permitido tampoco valida; conservar respuesta, gasto y reserva históricos, sin reintentos pagados ilimitados. El [diagnóstico y contrato propuesto](PLAN_INTERPRETATION_REPAIR_EXCEPTIONS_2026-09-12.md) documentan la ausencia de citas superiores y una continuación explícita con excepciones; todavía no está implementada. |
| Reserva terminal | Resolver los USD 1.192104 mediante evidencia y protocolo monetario; no declararlos settled ni liberados mientras sigan pendientes. |
| Reportes y MCP | Completar y validar la entrega reutilizable de reportes y herramientas sobre resultados gobernados. Este experimento no prueba esos recorridos. |

El siguiente corte debe conservar corpus, artefactos, selección, recibos y costos de este cierre.
No repetir SQL, imports, Voyage o BERTopic ya completados para fabricar una prueba nueva. La
continuación pagada requiere su autoridad vigente y el mismo protocolo de recuperación. Esta
entrega se limita a UAT; no autoriza producción ni amplía permisos o presupuestos.
