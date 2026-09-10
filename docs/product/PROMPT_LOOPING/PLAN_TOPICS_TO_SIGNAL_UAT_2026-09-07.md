# Topics → Signal: siguiente entrega de producto

**Fecha:** 2026-09-07. **Estado:** CATÁLOGO Y PUBLICACIÓN ENTREGADOS EN UAT; ALCANCE DE DISCOVERY CORREGIDO POR AUDITORÍA. Studio y Workers sirven `907d485a9cde309c98fe2c157b539f11a4c0d995`; esquema 0127/0128 aplicado y verificado. Recorrido manual + incorporación histórica → búsqueda/corrección → publicación → Signal, recuperación y archivo/restauración comprobados. Producción no fue tocada.

**Corrección posterior comprobada:** `Entrega y logística de pedidos` proviene de una taxonomía histórica de Claude sobre una muestra de menciones de Laika, no de una corrida nueva de BERTopic. Por tanto, esta aceptación conserva el logro del catálogo y su efecto en Signal, pero no demuestra descubrimiento repetible de un corpus nuevo. Ver [auditoría de Admin y descubrimiento](./AUDIT_ADMIN_AND_DISCOVERY_2026-09-07.md). Se conservan los recibos y pruebas válidas; no repetir gates para corregir esta descripción.

## Cierre comprobado

- Casos: `Fricciones posteriores a la compra` (manual, 9 asignaciones) y `Entrega y logística de pedidos` (descubierto, 4 asignaciones).
- Publicación final `d12c0c49-91eb-4a48-aaf4-69374410c8f9`; generación `a3bb8bdf-2a16-43b8-9549-28c43bee2431`; perfil v7; población Signal `5ab81f83-2bb8-46d9-bb41-93b84079d8fa` v1.
- Denominador 192; 12 raíces aprobadas; 13 asignaciones proyectadas; una raíz multilabel; cero pares raíz+tópico duplicados.
- Las 13 asignaciones son humanas. La automatización se abstiene hasta disponer de al menos dos positivos y dos negativos no vistos por tópico; los candidatos semánticos restantes quedan como duda y no se sirven como falsos positivos.
- Archivo retiró únicamente el tópico descubierto y dejó 9/192; restauración lo devolvió como borrador, exigió búsqueda vigente y terminó otra vez con ambos tópicos y 12/192 en Signal.
- Una llamada `voyage-4-large`, cuatro embeddings, USD 0.001157; siguientes búsquedas y publicaciones reutilizaron caché a costo cero. Saldo mínimo: USD 11.362961. Sin Claude.
- QA ES/EN en 390 px, 740 px y escritorio; sin overflow ni errores de consola. Typecheck, lint, suites tocadas y build Studio pasan. Revisión independiente P0/P1/P2 = 0.

## Decisión y resultado

El siguiente desarrollo es **una sección Topics propia y su efecto real en Signal UAT**. El reporte de un prospecto, el agente Claude y el MCP siguen siendo el horizonte posterior; no se incorporan como requisitos de esta entrega.

Al terminar, un operador podrá crear un tópico o incorporar una propuesta descubierta, comprobar qué menciones incluye, corregir su definición y usarlo para ver resultados en Signal. Podrá retirarlo del seguimiento. Estas dos entradas comparten un mismo objeto y una misma ejecución. «Dos tópicos» son dos casos de aceptación, no temas seleccionados ni límite del catálogo.

La entrega no se considera completa por mover paneles, guardar reglas o mostrar coincidencias. Se demuestra una clasificación persistente, relevante y reconciliada con lo que lee Signal.

## Premisas que gobiernan este plan

- No hay clientes que obliguen a conservar compatibilidad con producción antigua. No construir lectores paralelos, backfills o migración de datos viejos para mantenerla.
- Alexa y sus snapshots sirven si aceleran una comprobación, pero no son dependencia de la función. Crear un tópico debe funcionar en un workspace sin candidatos históricos.
- Se puede cambiar el esquema para resolver la función; eso no implica un proyecto de conservación/migración de producción. Tampoco una reconstrucción de toda la base de datos.
- Reutilizar componentes, colas, modelos medidos y autoridad de datos que sirvan al producto nuevo. Retirar el acoplamiento experimental cuando impida uso normal.
- La población de origen, la atribución de entidad y el tópico son conceptos diferentes. No confundir una búsqueda de competidor con prueba de a quién menciona un registro.
- El cierre de esta entrega es UAT. No incluye despliegue de producción ni publicación externa de reportes.

## Experiencia que se implementará

Ruta de gestión: `/studio/brands/[brandId]/topics`, dentro del workspace de marca, al mismo nivel que Brand OS y Datos. Es una ruta propuesta. Las APIs usarán el workspace resuelto por el servidor; brandId y workspaceId no se intercambian.

**Vista Topics.** Lista de tópicos seguidos y borradores, buscador simple y botón **Crear tópico**. Una pestaña **Descubiertos** contiene propuestas del análisis disponible. Archivados en un filtro secundario. Cada tópico muestra nombre, estado, menciones de la última clasificación y fecha de actualización; un resultado pendiente nunca se representa como cero.

**Crear tópico.** Nombre y una descripción de lo que se busca. Idioma, mercado y contexto se heredan de Brand OS. Ejemplos positivos/negativos y restricciones de alcance son opcionales; se sugieren desde las menciones cuando sea posible. No requiere run, cluster, candidato, rúbrica, motivo ni query escrita a mano. ANY/ALL/NOT es un control avanzado, no el formulario principal.

Si Brand OS todavía no aporta idioma, mercado o contexto, se permite guardar el borrador. Para ejecutar la búsqueda sí debe existir una población y un alcance resueltos; la UI explica lo que falta sin inventar contexto ni exigir completar otro formulario de marca para simplemente crear el tópico.

**Incorporar un descubierto.** Abrir propuesta con nombre, significado y menciones que la sustentan. **Usar como tópico** inicia el mismo editor con esos valores. El vínculo al análisis queda como procedencia; la vida posterior del tópico no depende del snapshot. Esta entrega reutiliza descubrimientos disponibles: no añade un botón de nueva corrida que dependa de scripts manuales o que todavía no funcione.

**Buscar menciones.** La definición se guarda y un trabajo asíncrono busca y evalúa pertenencia. Se muestran resultados relevantes, dudosos y exclusiones; el usuario puede marcar «pertenece/no pertenece» y ajustar. Progreso, error y recuperación se conservan al recargar. No se mantiene abierta una transacción HTTP durante toda la búsqueda.

**Seguir en Signal.** Acción explícita sobre una definición que ya tiene un resultado válido. Usa esa versión de clasificación y la población compatible; puede encolar su materialización si hace falta. No vuelve a llamar al proveedor por el simple hecho de seguir un tópico. La UI muestra **Actualizando** hasta que Signal puede leer el resultado. Sólo entonces muestra **En Signal**.

**Editar y retirar.** Editar antes de seguir vuelve a evaluar la definición. Renombrar no cambia pertenencia. Para un tópico ya seguido, un cambio de significado guarda una nueva versión y recalcula su alcance; la versión anterior permanece visible con estado **Actualizando** hasta completar el reemplazo. No mezclar dos definiciones silenciosamente en una comparación. **Archivar** retira ese tópico de la vista activa y de futuras clasificaciones, conservando el historial sin borrar un perfil compartido. Restaurarlo lo devuelve como borrador si no tiene resultado vigente. No se exige recomputación incremental optimizada de toda revisión en este corte: un recálculo completo de la población declarada del tópico es válido si se informa su alcance.

Estados cotidianos: **Borrador, Buscando, Listo para seguir, Actualizando, En Signal, Archivado**. Un error es recuperable desde la acción correspondiente; no se traduce a «sin datos». Los registros internos de generaciones, hashes, policies y recibos no agregan pasos humanos.

## Arreglos alrededor de Topics incluidos

| Superficie | Cambio del corte |
|---|---|
| Brand OS | Conserva marca, competidores, Knowledge y contexto. Sale `BrandTopicEvaluationPanels` como sección operativa. Enlace directo a Topics. |
| Evidencia completa | Se integra como evidencia y detalle técnico del análisis/candidato, colapsado. No requiere página nueva. |
| Revisión de descubrimiento | Sale de la navegación cotidiana. Queda accesible como historial técnico; completar 115 rúbricas no habilita nada del flujo nuevo. |
| Revisión semántica | Conserva su función de atribuir entidad/alcance. Copy y enlaces distinguen esa corrección de corregir pertenencia a un tópico. No se rediseña toda la cola. |
| Signal / Tópicos y narrativas | Muestra los tópicos seguidos, volumen/evolución y evidencia usando componentes existentes. Para usuarios autorizados, enlace **Gestionar tópicos**. |
| Overview y estados vacíos de Signal | Distinguen fuente ausente, datos importados pendientes de clasificación, población no disponible, trabajo en curso y resultado vacío real. |
| Competencia/categoría | Alcance explícito en gestión y pruebas, heredado/configurable sin formularios duplicados. No mezclar esos registros en el denominador de Monitoreo de marca. Comparativas completas de competencia/industria quedan en el siguiente corte. |

En particular, `SignalV2WorkspacePage` transforma hoy ciertos errores de población/compatibilidad en `emptyWorkspace`. Se corrige esa traducción para no volver a pedir una fuente que ya existe.

## Diseño técnico elegido

### Un tópico estable, un catálogo, una autoridad de resultados

Reutilizar `taxonomy_terms`, `signal_taxonomy_profiles`, sus reglas y la autoridad de clasificación 0087. El tópico tiene una clave lógica estable dentro del workspace; las versiones del catálogo y de su definición no deben crear una identidad distinta para el usuario. El origen manual/descubierto se guarda como procedencia opcional. Si el almacenamiento actual no permite identidad estable, añadir sólo el vínculo necesario, no otro catálogo con asignaciones paralelas.

`insertSignalTaxonomyDraftCoreV1` permite reutilizar el escritor de catálogos. No crear un perfil activo por candidato. Al añadir/editar/archivar un tópico se produce el estado del catálogo correspondiente, manteniendo identidad de los demás. La adopción repetida del mismo candidato debe devolver el tópico existente, no duplicarlo.

Hay dos incompatibilidades concretas que resolver en0087 y su integración:

1. El camino viejo de activación exige markers de un backfill retirado, mientras iniciar una clasificación exige un perfil activo. Adaptar la activación a la nueva ejecución para salir de ese ciclo; no revivir el backfill antiguo ni falsificar sus markers.
2. La función de append inserta un item único por raíz. Dos llamadas independientes para dos tópicos de la misma mención chocan. Extender el escritor para un resultado por raíz con múltiples asignaciones, idempotente. Mantener conteos por raíz separados de conteos por asignación.

Persistir resultados con `begin/append/finalize` y proyectarlos a `record_tags`/lectores de Signal. Verificar el procedimiento real completo, no asumir que las funciones SQL existentes ya son un servicio de aplicación. Los resultados válidos necesitan política y modelo apropiados: un score alto solo no concede autoridad. Esa validación se resuelve en la ejecución del sistema, no con otro formulario por tópico.

La proyección actual reemplaza los tags desde una generación completa. **No proyectar únicamente el tópico editado o un delta de imports sobre un catálogo completo:** desaparecerían resultados ajenos. Este corte puede recalcular el catálogo/población declarados completos; después se optimiza reutilizando resultados sin cambios para construir una generación sucesora también completa. Se conserva la versión servida hasta que el catálogo nuevo tenga resultados válidos y el cambio pueda realizarse de forma coherente. Perfil nuevo implica generación nueva y mapeo por `term_key`; el mecanismo `supersedes` actual sólo admite ciertos sucesores del mismo perfil.

Fijar al inicio el resultado por raíz: una raíz evaluada una vez, cero o varias asignaciones y un estado agregado que distingue evaluación completa, dudas y errores. «Asignada a algún tópico» no equivale a «evaluada frente a todo el catálogo». Claves, tamaños de definición y deduplicación se alinean entre DTO/core/serving; no usar candidate keys con guiones como term keys si el lector exige underscores, ni deduplicar ediciones sólo por el hash de Brand OS.

### Clasificación relevante, no sólo reglas léxicas

El matcher actual ANY/ALL/NOT es una señal reutilizable. Crear un tópico en lenguaje natural requiere además recuperación semántica por definición/ejemplos, evaluación de exclusiones y abstención.

La primera implementación se orienta al encoder local BGE ya medido y a una ejecución por lotes en la cola/Worker existente. Reutilizar embeddings únicamente cuando coincidan modelo, revisión, preprocesamiento, texto e identidad de mención. Un vector Voyage, BGE o E5 no es intercambiable con otro. El contexto de marca se usa para resolver el significado y seleccionar evidencia pertinente, no se pega completo a todas las menciones.

Al arrancar se cierra una decisión técnica acotada: cómo ejecutar ese encoder con el runtime de UAT. Hoy BGE está en el laboratorio Python y el Worker de embeddings proveedor opera con referencias de corpus antiguas; ninguno se declara listo por su mera existencia. Elegir el empaquetado mínimo compatible, medir una consulta real y registrar la opción adoptada. No crear una plataforma de agentes, un servicio de modelado general o un benchmark abierto de modelos. Si el candidato local no satisface calidad/capacidad, documentar el fallo concreto y elegir sustituto dentro del mismo contrato; no publicar una clasificación léxica como semántica para cerrar.

El proceso combina recuperación léxica y semántica, contrastes positivos/negativos y reglas de alcance. Se calibra con ejemplos reales del tópico y se evalúa con ejemplos distintos. Se acepta automáticamente sólo lo cubierto por una política validada; lo ambiguo permanece como duda/abstención. Esto no presupone que proximidad vectorial sea precisión.

Claude puede ayudar a proponer definición/reglas con contexto y menciones. Se reutiliza su Worker y navegación, adaptando la dependencia de candidato congelado. El cupo de un experimento no se elimina para permitir gasto ilimitado: se sustituye en el flujo general por límites de ejecución explícitos cuando se habilite esa capacidad. El flujo manual funciona aunque no se solicite generación con Claude.

### Búsqueda y aplicación usan la misma semántica

La prueba y la clasificación aplicada comparten definición, población y clasificador. El trabajo de prueba produce un resultado trazable, con alcance/cobertura explícitos; **Seguir** no convierte una muestra en clasificación de toda la población. Si sólo se probó una muestra, la aplicación completa el resto y mantiene el estado pendiente hasta finalizar.

Usar la cola existente para timeout, progreso, reintentos e idempotencia. Evaluar los tres archivos locales del antiguo arreglo de rendimiento como una optimización opcional del matcher; no reanudar su plan separado ni ampliar el timeout como solución a toda la ejecución.

## Secuencia de implementación y entregas revisables

Son cuatro tramos de una misma entrega. Cada tramo deja algo comprobable; ninguno se llama producto terminado por separado.

| Orden | Trabajo y resultado revisable |
|---|---|
| **1. Topics como objeto y entrada propia** | Fijar identidad/definición sobre el catálogo reutilizado, crear APIs de gestión y montar página/lista/editor con dos entradas. Crear manual sin candidato; adoptar sin duplicar; editar y archivar. Retirar paneles operativos de Brand OS. Comprobar la viabilidad del encoder y el plan de activación mientras se implementa esta base. |
| **2. Buscar y corregir sobre menciones reales** | Trabajo durable con el clasificador elegido, contexto pertinente, ejemplos y estados. Calibración/validación separadas y correcciones con efecto real. La regla avanzada deja de ser la única forma de definir el tópico. |
| **3. Seguir y ver el resultado en Signal** | Resolver activación, escritura multilabel por raíz, proyección y población servida. Conectar volumen/evolución/evidencia y estados vacíos. Edición aplicada reemplaza una generación sólo al completar; archivo afecta sólo al tópico. |
| **4. Recorrido completo en UAT** | Entrega focal del código del corte; demostrar tópico manual y descubierto, edición/corrección, recarga, recuperación y archivo. Contrastar métricas con asignaciones. QA ES/EN y responsive de las superficies modificadas; informe breve de lo que ya puede hacer el operador. |

El reparto técnico puede ser paralelo: frontend/lista/editor; backend de catálogo/clasificación; integración de Worker/Signal y revisión. Las decisiones de identidad y contratos se acuerdan una vez al inicio para no generar implementaciones divergentes. No hacen falta nuevos chats de producto para cada subpaso.

## Matriz de aceptación

| Caso | Qué debe demostrar |
|---|---|
| Tópico manual | Se crea sin snapshot/run/candidato histórico, encuentra menciones relevantes y llega a Signal. |
| Tópico descubierto | Conserva procedencia y evidencia, se edita y llega por el mismo mecanismo. Repetir incorporación no duplica. |
| Relevancia | Ejemplos positivos, negativos verdaderos y dudas; análisis de errores y abstención. Muestra de validación distinta a calibración, con criterio fijado antes de evaluarla. No exigir 115 revisiones humanas. |
| Contexto | Un caso ambiguo/homónimo y uno de paráfrasis demuestran el efecto de definición/contexto y de recuperación semántica, sin depender sólo de una palabra coincidente. |
| Multilabel y dedup | Una mención puede pertenecer a dos tópicos sin duplicar el denominador; replay no crea items/asignaciones repetidos. |
| Alcance | El tópico consulta sólo la población declarada. Cambiar marca/competencia/categoría no contamina métricas de marca ni se deduce del nombre del archivo. |
| Edición | Renombre no reclasifica; cambio semántico genera nuevo resultado y no mezcla versiones silenciosamente. Error mantiene último resultado estable. |
| Archivo | Retira un tópico y detiene su seguimiento sin borrar otros, las menciones ni el perfil compartido. Restauración muestra vigencia real. |
| Signal | Conteo y evolución reconciliados con las asignaciones de la misma versión/población; evidencia navegable. Datos pendientes no se presentan como inexistentes. |
| Operación | Recargar, interrumpir y reintentar no pierde borradores ni duplica trabajo/costo. Un resultado parcial no se presenta completo. |
| UI | ES/EN, mobile/tablet/desktop; teclado, foco, estado de carga/error y consola. Sin nuevos formularios obligatorios ni terminología de laboratorio en la tarea principal. |

Pruebas: typecheck/lint y tests de paquetes tocados, build Studio, integración real de las funciones/esquema que cambien y Worker real para el recorrido. Reutilizar evidencia anterior para funciones sin cambios; no repetir A/B/C-UI/PG cerradas por rutina. Una comprobación nueva de multilabel/activación es relevante porque esas transiciones no estaban cubiertas por los ensayos sin serving.

## Qué queda inmediatamente después

El siguiente corte será el nuevo import que actualiza los tópicos seguidos, descubrimiento repetible sobre datos nuevos y comparativas completas de marca/competencia/industria. Luego el primer reporte con el agente y los componentes de Noisia, y MCP sobre las mismas consultas de Signal. No se posterga su diseño de datos: este corte expone resultados consultables y evidencia reutilizable, sin construir ya el agente o los formatos de reporte.

No se incluyen ahora un nuevo BERTopic guiado, rediseño general de Admin/Signal, T&B, plataforma de reportes, nuevo orquestador ni prueba de 1M. La promesa de descubrimiento contextual pendiente no se declara satisfecha por nombrar los clusters históricos; se aborda al convertir discovery en una operación repetible.

## Base de trabajo, presupuesto y continuidad

- Repo documental: `/Users/brandhon_o/Downloads/noisia-website`.
- Base focal de producto: `/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`, HEAD `8be57093ce6ee21a7c2d5aebca176e512117ef0c`; tres archivos locales de trial preservados, a evaluar dentro del nuevo alcance.
- No requiere conservar datos de producción ni Alexa. Tampoco necesita borrarlos antes de empezar a programar. Una base de prueba limpia es válida si simplifica una prueba concreta.
- Este turno de planificación no genera gasto. Experimentos anteriores: 10/10; saldo mínimo del sobre anterior USD 11.364118. Auditoría de rumbo aparte: USD 1.204804 gastados de USD 3. Ninguno se convierte por inferencia en autorización para nuevas corridas de producto.
- Empezar implementación y pruebas locales sin proveedor. Si hace falta una nueva corrida pagada, concretar modelo, caso y tope cuando la función esté lista; el cupo anterior agotado no bloquea crear Topics ni preparar su integración.
- Loop verificado **PAUSED**, apuntando a este task. No se reanuda como efecto de escribir el plan. CURRENT/NEXT deben apuntar a este documento, dejando sus órdenes antiguas como historia.

## Referencias verificadas

- Auditoría: `.data/product-direction-audit-2026-09-07/AUDITORIA_DE_RUMBO.md` y aclaraciones posteriores en esa carpeta.
- `apps/studio/src/app/studio/brands/[id]/brand-os/page.tsx`: composición de marca y paneles Topic.
- `apps/studio/src/components/brands/FullEvidenceTopicCandidateManager.tsx`, `TopicCandidateRuleDraft.tsx` y `BrandTopicEvaluationPanels.tsx`: piezas de interfaz a reutilizar y desacoplar.
- `infrastructure/db/signal-taxonomy-profile.ts`: escritor de catálogo; loaders antiguos de corpus no son la entrada del flujo nuevo.
- `infrastructure/db/migrations/0087_signal_classification_authority.sql` y `packages/query-engine/src/signal-classification-authority-v1.ts`: autoridad, estados, generación y métricas.
- `tools/signal-semantic-lab/src/signal_semantic_lab/embeddings.py` y `services/workers/src/workers/semantic-embeddings.ts`: caminos de embeddings existentes y límites de reutilización.
- `apps/studio/src/components/signal-v2/SignalV2WorkspacePage.tsx` y `apps/studio/src/lib/data-os/signal-topics-narratives-serving.ts`: resolución de población y lectores actuales.
- `docs/product/63_NOISIA_V02_CANONICAL_PRODUCT_PROGRAM_AND_DELIVERY_LAYER.md`: reportes/agente/MCP como horizonte posterior; tablas antiguas de avance no sustituyen recibos actuales.
- `.data/product-direction-audit-2026-09-07/topics-plan-data-feasibility.md`: revisión independiente de representación y diez límites concretos del código, incluidos activación, multilabel y proyección completa.
