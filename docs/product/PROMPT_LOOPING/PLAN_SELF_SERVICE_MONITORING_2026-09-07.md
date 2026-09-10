# Plan de entrega — Noisia self-service, corpus completo y monitorización incremental

## Continuidad 8 septiembre — persistencia de clasificación local comprobada

Commit local `92d5d0ade818061bd51c4fd009caae0e6bbbcd21`; UAT permanece ae3e36c. [Recibo](./DELIVERY_WORKSPACE_CLASSIFICATION_LOCAL_2026-09-08.md). SQL0136 y consumidores nativos reutilizan autoridad0087/ejecución existente; multilabel, correcciones, recuperación y última completa comprobados en PG.1,001 asignaciones guardadas/copias; PG/BullMQ3raíces/133fragmentos, recuperación y copia sin releer/invocar motor. Revisión y checks cerrados. Sin API/UI/productor/motor por defecto, proveedor, push o UAT. No confundir este consumidor local con clasificación semántica disponible ni con una segunda carga real PG.

Siguiente: integrar motor guiado/discovery real existente sobre workspace completo, incluyendo descubrimiento sin intereses y conversaciones ya asignadas; comprobar Brand OS efectivo, artefactos/identidad y nueva carga incremental, primero local sin proveedor. Después Topics/Claude/selección/Signal. NOI-31/78 siguen abiertos; no repetir gates cerrados ni otro diseño general. National y presupuestos intactos, zona SentiOne ya pendiente. Agentes finalizados, loop actual activo. Esta actualización nutre el Compass y conserva toda la historia inferior.


## Continuidad 8 septiembre — preparación de intereses entregada

Studio/Worker UATae3e36c y SQL0135 verificados; [recibo](./DELIVERY_WORKSPACE_TOPIC_PROTOTYPES_2026-09-08.md). Topics prepara intereses/Brand OS con el ledger, caché, costos y recuperación existentes, antes o después de importar. PG/BullMQ y UI local probaron deduplicación, fallos/recibos y reutilización por menciones. Proveedorfalse, cero gasto. National conserva sus datos y catálogo vacío; sin fixtures UAT. Siguiente: clasificación persistente/versionada e incremental con motores existentes, descubrimiento abierto, Claude y Signal del Compass, primero local sin proveedores. Top32 sigue sin ser clasificación final; NOI-31/78 abiertos. NOI-81 conciliación completa/presupuesto, NOI-19 cliente y NOI-80 retención siguen abiertos. No repetir gates ni SQL0131–0135. Root entregó; agentes finalizados y loop en este chat. Historia inferior conservada.

## Continuidad 8 septiembre — búsqueda workspace entregada

Studio/Worker UAT919fd35 y SQL0134 verificados; [recibo](./DELIVERY_WORKSPACE_TOPIC_SEARCH_2026-09-08.md). El trabajo de root, Backend, Worker y Frontend terminó y los agentes están cerrados. Reutilizar nombres sólo para subtareas acotadas; no otro orquestador. Siguiente integración: preparación de prototipos con costo/recibos desde Topics, primero transporte local simulado. Clasificación persistente, descubrimiento/Claude, incrementalidad y Signal aún obligatorios. Top32 es recuperación no calibrada, nunca cierre de NOI-31/78. National conserva archivos/preparación, sin embeddings reales ni Topics; zona SentiOne ya preguntada. Presupuesto intacto, proveedoresfalse. Leer STATE/CURRENT/NEXT antes de trabajo; no repetir gates de este corte. Esta actualización nutre el plan y no reemplaza su alcance.

> Continuidad 8 septiembre: el operador ya autorizó e inició la implementación. Alta/contexto/intereses/import están entregados en UAT, National tiene16CSV/9,131registros aceptados y el contrato temporal70604a4 está activo. El plan original y sus condiciones de preparación se conservan abajo como historia; no vuelven a impedir código autorizado. P1 aún no cierra: faltan preparación, clasificación, descubrimiento e interpretación reales del corpus. Véanse [aceptación](./NATIONAL_IMPORT_ACCEPTANCE_2026-09-08.md), [recibo temporal](./NATIONAL_TIMESTAMP_NORMALIZATION_2026-09-08.md) y STATE para el punto activo.


Fecha: 7 de septiembre de 2026. Basado en el [compass aprobado](./COMPASS_SELF_SERVICE_2026-09-07.md) y la [auditoría verificada](./AUDIT_ADMIN_AND_DISCOVERY_2026-09-07.md). Estado: plan y memos de frentes preparados; backlog registrado en Linear. Implementación aún no iniciada.

## 1. Qué se entrega

Un operador completa desde UI una marca nueva, su contexto, intereses, importación, descubrimiento e interpretación, edición/selección de Topics y Signal. Una segunda carga se procesa automáticamente, mantiene Topics existentes, encuentra temas emergentes y actualiza Signal sin scripts ni republicación manual de cada lote. La calidad y la operación deben sostenerse al volumen declarado de lanzamiento.

La unidad de entrega es ese recorrido. Frontend y backend trabajan en paralelo por contratos, pero no cierran por separado una pantalla o endpoint como si fuera el producto. Los hitos intermedios son puntos de integración, no nuevos formularios/gates del operador.

## 2. Base reutilizable y correcciones de alcance

Código focal UAT: `907d485a9cde309c98fe2c157b539f11a4c0d995`, Studio/Workers. Catálogo, creación manual, incorporación, búsqueda, correcciones humanas, publicación y archivo/restauración ya probados. Mantener esos recibos; probar sólo los cambios y regresiones pertinentes.

Persistencia, modelos de población, embeddings, evidencia, colas y laboratorio existen. Faltan: ejecución genérica de descubrimiento, integración efectiva de intereses/contexto, proceso incremental con novedad, UX de autoservicio, automatización medida y lanzamiento. Laika no demuestra BERTopic nuevo; sus 13 asignaciones son humanas. El contexto de Brand OS no guía hoy el fit de BERTopic. Los diez candidatos Alexa son un resultado histórico importado.

## 3. Hitos por resultado visible

| Hito | Resultado | Cierre verificable | Dependencia |
|---|---|---|---|
| P0 — Preparación | Compass, inventario de deuda, contratos de frontera y responsables | Documentos enlazados a Linear; frontend/backend saben archivos y límites; sin producto modificado | Auditoría existente |
| P1 — Primera carga completa | Marca nueva → contexto/intereses → corpus completo → Topics → Signal | El operador lo hace desde UI, con una corrida nueva y procedencia correcta; todo registro reconciliado; errores recuperables | P0 |
| P2 — Monitorización real | Segunda y tercera cargas automáticas; temas existentes y emergentes | Sin scripts ni duplicados; nuevo tema recuperado del residual; menciones tardías/correcciones y cambios de definición se procesan; series y generaciones coherentes | P1 y contrato incremental desde el inicio |
| P3 — Lanzamiento del núcleo | Calidad, escala objetivo y operación listas para producción | Prueba 2M/1000 Topics, SLO/costo definidos y medidos, tenant isolation, recuperación/restore y E2E self-service | P1 + P2; instrumentación se construye desde P1 |
| P4 — Entrega y agentes | Reportes con agente, componentes Noisia y MCP | Mismas consultas/evidencia de Signal, entregables útiles y acceso autorizado | Núcleo estable; no bloquea P1/P2 |

**P1 sin P2 no es la versión self-service completa ni el lanzamiento.** El recorrido reducido de desarrollo sirve para integrar; no cambia el alcance de procesamiento ni permite afirmar capacidad de dos millones sin medirla. Mil Topics es una capacidad de interacción/interpretación, no cantidad obligatoria del descubrimiento.

## 4. Frentes y cortes de implementación

### Frontend

- Completar alta existente: defaults claros de identidad/idioma/mercado/zona horaria, creación idempotente de workspace y siguiente acción. No copiar antiguos experimentos a la nueva marca.
- Brand OS conserva identidad, competidores, Knowledge y contexto editable. Corregir carga/errores; reducir campos obligatorios y copy técnico. Mostrar contexto utilizado, no exigir aprobar cada término.
- Topics en el menú principal de marca. Intereses definidos antes de importar y descubrimientos posteriores comparten editor; procedencia, ámbito y efecto de edición son explícitos.
- Import multiarchivo, mapeo y ámbito de captura comprensibles, validación por fila/lote, progreso persistente, cancelación/reintento sin recargar manualmente ni repetir costo.
- Descubrimiento con progreso de etapas y resultados parciales claramente no finales; selección/edición a escala, búsqueda y paginación/virtualización según medición. Ningún formulario de 1000 rúbricas.
- Excepciones por impacto; explicar qué resolvió automáticamente Claude y qué requiere decisión. Corregir contradicciones de salud y de pendientes.
- Signal refleja población, versión, frescura, incertidumbre y efectos de selección/edición. No mezclar las 14 narrativas históricas con un catálogo recién generado.

### Backend y procesamiento

- Reutilizar el workspace y la importación durables. Detectar cierre de import y registrar un evento de avance/invalidation recuperable; usar secuencia de ingesta/versiones, no sólo fecha de publicación de las menciones.
- Compilar intereses en representación semántica medible, versionada con contexto relevante y ámbito. Separar lenguaje común de marca de señales discriminantes; corregir el truncamiento ciego de contexto y medir efecto. Un worker por lote, no una nueva infraestructura por Topic.
- Ejecutar embeddings y clasificación sobre toda la población elegible por lotes con checkpoints. Registrar cobertura de cada registro original/canónico y la razón de toda exclusión.
- Convertir el laboratorio en trabajo invocable desde el producto. Quitar dependencia de `SOURCE_RUN_KEY`/hashes/rutas Alexa para corridas nuevas, sin borrar su evidencia histórica. Run recibe workspace, población/versiones, estrategia, modelos y contexto autorizado; produce candidatos y evidencia consultable.
- Descubrimiento abierto de toda la población aplicable, con estrategia de partición/agrupamiento medida; preservar cruces de temas entre lotes/idiomas/ámbitos. No reemplazar clustering por nombres generados desde una muestra.
- Incrementalidad separa asignación a temas existentes de detección de novedad. `transform/predict` por sí solo no satisface descubrimiento de nuevos clusters. Persistir y procesar todo residual pendiente, con corrida periódica/umbral configurado y reconciliación global; ningún límite de tamaño omite silenciosamente el resto.
- IDs estables de Topics, revisiones de definición, membresías por versión y linaje de clusters. Merge/split tienen efecto de reclasificación, fechas y explicación de continuidad; nunca son sólo casillas de diagnóstico.
- Claude nombra, describe, ordena y resuelve controles semánticos rutinarios con herramientas acotadas; acceso paginado a evidencia elegible, conteos calculados en DB, trazabilidad de citas, costo y uso. Los errores se aíslan por lote; se conserva el progreso y no se repite todo el trabajo.
- Publicación de generaciones completas y actualización incremental automática para Topics seguidos. Autorización y políticas se resuelven en servidor; una duda local no bloquea todo el catálogo. No hacer que un borrador competitor bloquee el seguimiento primary.

## 5. Contratos compartidos antes del primer cambio de runtime

Se reutilizarán y extenderán DTOs/entidades actuales donde encajen. Este inventario define significado; no obliga a crear tablas nuevas.

| Contrato | Datos y comportamiento exigidos |
|---|---|
| Preparación de marca | `workspace`, contexto actual/versionado, estados y siguiente acción. Diferenciar desconocido, listo, necesita atención y en proceso; no traducir ausencia de error a listo. |
| Definición de Topic | ID estable, revisión, nombre/intención, procedencia real, ámbito(s), contexto heredado, ejemplos, estado de seguimiento y versión clasificada. Lenguaje técnico opcional. |
| Importación | ID, fuentes, ámbito de captura, originales/canónicos/deduplicados/elegibles/rechazados, errores recuperables, watermark de ingesta y evento de cierre durable. |
| Ejecución | Etapa, estado, procesados/total, versión de población/contexto/modelo, error con acción, presupuesto/uso, checkpoint y resultado actual. Estados operativos coherentes: queued/running/needs_attention/failed/canceled/completed; nunca success con cola residual ocultada. |
| Candidato | Run y población de origen, cluster/linaje, evidencia, nombre/descripción sugeridos, ranking explicable, cobertura e incertidumbre. Taxonomía histórica no se etiqueta BERTopic. |
| Asignación | Raíz/registro, Topic/revisión, motor/modelo/regla, evidencia de decisión, estado semántico y generación. Idempotencia, multilabel y abstención explícitos. |
| Novedad | Residual pendiente/procesado, última detección, agrupaciones nuevas y relación con Topics existentes; retry completo sin pérdida o duplicado. |
| Signal | Generación completa y watermark por población, cobertura de procesamiento y de Topics, dudas, errores, fuera de ámbito, seleccionado y frescura. Comparaciones de períodos con definición temporal explícita. |

Primero frontend/backend acuerdan estos significados y errores; después cada uno implementa con ejemplos de contrato. El orquestador integra el mínimo slice real y prueba el recorrido, evitando meses de trabajo aislado por capas.

## 6. Controles automáticos y excepciones

| Control | Resolución ordinaria | Excepción útil |
|---|---|---|
| Contexto incompleto | Sugerir/heredar datos conocidos y registrar su origen | Falta identidad mínima o contexto contradictorio que cambia el análisis |
| Nombre/descripción redundantes | Claude propone consolidación y valida referencias/evidencia | Dos Topics con sentidos diferentes que se solapan y requieren intención del usuario |
| Atribución y pertenencia | Reglas/modelo medidos + herramientas Claude en casos acotados | Ambigüedad material, baja evidencia, drift o desacuerdo |
| Calidad de corrida | Métricas calculadas, validación de schema/citas y comparación por segmentos | Degradación real o insuficiencia de evidencia; no puntuar todo manualmente |
| Selección en Signal | Sugerir Topics ordenados, permitir selección por lotes y edición | Decisión editorial sobre qué seguir; no selección silenciosa de emergentes |
| Acceso/derechos/costo | Validaciones determinísticas y límites de cuenta/configuración | Identidad no autorizada, derechos no resueltos o presupuesto insuficiente: error claro, sin bypass LLM |

Claude puede resolver una acción permitida; no desactivar el control. Un resultado incierto conserva estado y explicación, no se licua en una aprobación masiva sin medición. La evaluación semántica independiente no usa al mismo generador como única verdad.

## 7. Prueba de aceptación del recorrido

Se prepara un corpus representativo nuevo, sin depender de Laika/Alexa, con universo de filas conocido y pertenencias de referencia independientes para evaluar calidad. El cómputo siempre procesa todo ese universo elegible; evaluar calidad con una muestra de referencia es una tarea distinta.

1. Usuario crea marca y contexto; define dos o más intereses, incluido un negativo difícil; no accede a una consola de ingeniería.
2. Import A contiene marca, competencia y categoría, dos idiomas si aplican, duplicados y filas problemáticas conocidas. Toda fila tiene destino/estado y los tres ámbitos se conservan.
3. Ejecuta análisis desde UI. Se comprueban clasificación guiada y emergente, Brand OS efectivamente utilizado, candidatos editables, evidencia y costo. No se importan resultados a mano.
4. Selecciona Topics para Signal, corrige un caso y modifica una definición. Las asignaciones y el denominador se reconcilian; no se sirven falsos positivos promocionales por coincidencia de palabras.
5. Import B añade conversaciones de Topics existentes y un tema nuevo; incluye registros tardíos y duplicados. El sistema actualiza los seguidos y detecta el emergente sin SQL, scripts ni reconfigurar el cliente. No exige publicar otra vez lo ya seguido.
6. Repite el evento/lote y provoca un reinicio de Worker: no hay doble asignación ni doble gasto; progreso recuperable y último Signal completo utilizable.
7. Import C/corrección cambia contenido y una definición; archivar/restaurar y merge/split alteran lo debido. Las fechas de evento y de ingesta no se confunden.
8. Comprueba aislamiento de otra marca y otro rol, citas válidas y datos retirados; no se debilita AuthZ para pasar el flujo.
9. Capturas/QA ES/EN, móvil/tablet/escritorio, teclado y 1000 Topics; coherencia UI/API/DB, errores, vacíos y reintento. Reutilizar QA anterior para superficies sin cambios.

No cerrar P1/P2 con una lista de APIs o una corrida iniciada desde CLI. Los runners de ingeniería sirven para diagnóstico/pruebas; el producto debe producir su resultado por el camino que tiene el usuario.

## 8. Calidad, escala y preparación de producción

Cobertura computacional: 100% de registros contabilizados, 100% elegibles con resultado de la ejecución o error visible. Cobertura temática no tiene meta artificial de 100%; las dudas y temas no asignados se cuentan y analizan.

Calidad: evaluar relevancia de candidatos, coherencia, redundancia, novedad, falsos positivos/negativos, precisión/recall y abstención por Topic, idioma y ámbito. Congelar dataset de evaluación independiente y métricas antes de cambiar umbrales. El mínimo actual de 2 positivos/2 negativos no certifica producción. Los objetivos cuantitativos de calidad se fijarán por uso con una medición inicial; nunca se ajustan retrospectivamente para declarar PASS.

Escala: escalones de integración → 100k → 1M → 2M registros y alrededor de 1000 Topics, sin muestreo como reemplazo. Medir ingestión, embeddings, descubrimiento, interpretación, asignación, serving, cola, RAM/VRAM, almacenamiento, duración, recuperación, costo total y por millón. Medir también reimport pequeño sobre corpus grande y el costo de crecimiento mensual. Los benchmarks grandes se planifican con presupuesto explícito antes de ejecutarse.

Antes del primer benchmark pagado, el responsable Backend declara tamaño de máquina, concurrencia, límite de memoria, costo máximo, objetivo de finalización inicial/incremental y latencia de lecturas. Validar esos valores, no inventar ahora cifras de rendimiento. Estos pendientes son criterios de preparación de capacidad, no un bloqueo para escribir el primer slice.

Lanzamiento: servicio ejecutable en entorno de producción, secretos/configuración administrados, límites de cuenta, colas recuperables, cancelación, jobs estancados, rate limits, evidencias/costos observables, alertas accionables, separación de tenants, restore de datos del producto nuevo y ruta de despliegue/rollback revisada. No requerir migrar datos de producción antigua. Desplegar a producción es un paso posterior explícito, no consecuencia automática de aprobar el plan.

## 9. Pendientes periféricos y decisión

| Hallazgo de auditoría | Decisión |
|---|---|
| Context Pack Laika y plan de adquisición fallan | Corregir el camino genérico; no parche por UUID. Prioridad del flujo. |
| Overview/salud/pendientes/Reportes contradicen bloqueos | Unificar contrato de estado; corregir en las superficies del flujo y registrar el resto. |
| Topics ausente del sidebar, origen incorrecto, herencia primary forzada | Prioridad del flujo. |
| Paneles de reglas/refinamiento/cohortes sin montaje | Inventario de consumidores; integrar acciones útiles en Topic o retirar focalmente. No reconstruir Brand OS gigante. |
| Discovery Review histórico | Diagnóstico avanzado; retirar rúbrica del recorrido normal. Merge/split se ejecutan desde Topics. |
| Revisión semántica | Conservar efecto en atribución, automatizar lo rutinario y concentrar excepciones. |
| Governed views y configuración Legacy | Conservar backend útil; hacer comprensible población/serving efectivo. No activar globalmente por cosmética. |
| Narrativas históricas en Signal | Procedencia/vigencia explícitas; integrarlas sólo con contrato y evidencia, no atribuírselas a la corrida nueva. |
| Equipo/acceso | Conservar; cubrir aislamiento del flujo, no rediseñar gestión por deporte. |
| Estudios/Engine/Themes | Avanzado; 16 lentes pausados. No son requisito de Topics. |
| T&B/reportes/agent/MCP | Backlog enlazado posterior; corregir preflight mentiroso como deuda, sin desarrollar todo antes de monitorización. |
| Readers/bridges de compatibilidad | Retirar si estorban y no hay consumidor necesario; no proyecto de migración de datos viejos ni borrado masivo. |

## 10. Seguimiento y Definition of Done

El [mapa Linear](./LINEAR_SELF_SERVICE_MAP_2026-09-07.md) registra tickets reutilizados y nuevos, fase, dueño funcional, dependencias, aceptación y estado. Los títulos viejos y gates no son instrucciones para repetir experimentos. No marcar todo el backlog Done porque haya partes implementadas; documentar exactamente la parte restante.

Cada entrega: problema/resultante visible, código focal, checks proporcionales, evidencia de UI/API/DB y costos si hubo; limitaciones explícitas; issue actualizado. Orquestador es el único integrador y responsable de sincronizar contexto/Linear. Frentes no despliegan ni gastan independientemente.

Preparación de este turno concluye cuando compass/plan/contexto acumulado están escritos, los pendientes están en Linear con prioridad y las tareas frontend/backend tienen instrucciones y puntos de continuidad. Luego se comunica al operador que estamos listos para iniciar, sin empezar implementación en esta misma preparación.

## 11. Hallazgos adicionales de los frentes, incorporados al backlog

Memos completos: [Frontend](./FRONTEND_SELF_SERVICE_READINESS_2026-09-07.md), [Backend](./BACKEND_SELF_SERVICE_READINESS_2026-09-07.md). Son preparación basada en código, no nuevas ejecuciones UAT.

| Límite actual confirmado | Tratamiento obligatorio | Ticket |
|---|---|---|
| Clasificador limitado a 64 Topics; carga global y comparación raíz × Topic | Procesamiento por bloques, persistencia acotada, medición temprana; elevar el número sin cambiar ejecución no resuelve escala | NOI-31, NOI-56 |
| Usa chunk 0 de hasta 900 caracteres y espera embeddings preparados | Preparación de embeddings de todos los chunks según política, texto largo con evidencia después del carácter 900 en aceptación; no intervención manual | NOI-31 |
| Gestión Topics exige `noisia_internal` | Capacidades cliente por workspace con autorización DB-owned, sin quitar guards ni dar rol interno al cliente | NOI-19, NOI-58 |
| `follow` publica catálogo sin selección persistente por Topic | Seguimiento explícito separado de lifecycle; sólo los elegidos se actualizan en Signal | NOI-37 |
| Candidatos V2 limitados a 50 y resultados a 60 sin paginación; catálogo refetch completo | Paginación/búsqueda estable, detalle bajo demanda, estado compacto de ejecución y selección a escala 1000 | NOI-27, NOI-35 |
| Fit UMAP/HDBSCAN mantiene estructuras en memoria | Medir temprano corpus/residual peor caso y estrategia de escala; exportar chunks no convierte el fit en out-of-core | NOI-68, NOI-56 |
| Novedad puede existir dentro de una mención ya asignada | Evaluar delta completo, conservar residual completo y reagrupación abierta en cadencia; no analizar únicamente `none` ni usar predict como descubrimiento | NOI-78 |
| Modelos BGE/Voyage tienen espacios incompatibles y costo duplicado posible | Cache/versiones por espacio/modelo, medir uso compartido antes de adoptarlo; no comparar vectores de espacios distintos | NOI-30, NOI-31 |

La capacidad de cliente y el seguimiento selectivo son parte del flujo mínimo. La automatización semántica debe poder arrancar sin calibrar manualmente mil Topics uno por uno; reutilizar evaluación de familias/modelo, validación independiente y excepciones fuera de soporte. Eso no autoriza extrapolar calidad a cualquier definición nueva sin medición.


## Continuación concreta — 9 septiembre 2026

El [plan de cierre del monitoreo incremental](PLAN_COMPLETE_INCREMENTAL_MONITORING_2026-09-09.md) integra los recibos locales b6da353/f35d78c y delimita las conexiones que faltan antes de la segunda carga real. Complementa este plan y conserva su alcance; no declara entrega UAT de SQL0148/0149.
