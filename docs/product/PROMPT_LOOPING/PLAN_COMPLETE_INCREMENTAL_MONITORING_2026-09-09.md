# Completar monitoreo incremental self-service

Continuación del Compass y del plan del 7 septiembre, con entregas verificadas hasta el 9 septiembre. No sustituye el historial, no reinicia el proyecto ni reabre gates. UAT actual c8f05b9/SQL0147; base y consumidor editorial b6da353/f35d78c son locales. Este documento especifica lo que falta, no lo declara implementado.

## Resultado que debe ver el usuario

Importa otra tanda real, ve cuántas menciones nuevas llegaron y puede continuar el análisis. Las conversaciones conocidas conservan sus Topics; las nuevas reciben nombres y evidencia, se pueden editar y elegir para Signal. Si una etapa se interrumpe, la UI retoma el trabajo guardado sin repetir cálculo o gasto. No necesita ingeniería, formularios por grupo ni consolas para terminarlo.

National sigue siendo un caso descartable. La aceptación posterior usa archivos reales adicionales por UI; no se modifican los archivos existentes para fabricar otra carga.

## Orden de desarrollo y aceptación

1. **Preparar evidencia de temas nuevos.** Reusar numeric ready, banco completo, raíces/fragmentos y almacenamiento existentes. Una intención «Interpretar temas nuevos» puede pedir preparación gratuita; GET y polling sólo leen. El proceso debe ser recuperable en el outbox existente, separado del recibo de proyección para no bloquear el Signal ya disponible. No hay otro engine, tabla de jobs o lease numérico ficticio. El nuevo tipo de despacho/operación necesita una migración focal todavía no asignada.
2. **Confirmar interpretación y ejecutarla.** Después de la preparación, la misma sección de Topics muestra importe máximo y vencimiento para una sola confirmación monetaria. El servidor valida el plan y hace begin + enqueue atómicos con los contratos0148/0149. No aceptar refs, censo, actor presupuestal o configuración del modelo desde el navegador. El consumidor f35d78c ya ejecuta y recupera esos planes localmente. Ninguna llamada nueva por montar una pantalla, polling o reintento de entrega.
3. **Convertir resultados en Topics.** Leer resultados ready con claims, llamadas settled y bytes verificados. Mantener separadas la ejecución que creó el grupo numérico y la que interpretó su evidencia. Reusar el merge de catálogo y las identidades de unidad/term_key; preservar nombre, significado, archivo y selección editados por el usuario. Los nuevos Topics quedan borrador y sin seleccionar. No llamar el materializador full-fit con un lease o packet artificial.
4. **Actualizar clasificación y Signal.** Reusar derivación, proyector de todas las raíces, correcciones, selección y lector nativo. La nueva cobertura es la unión de unidades interpretadas del banco actual, no el porcentaje de solicitudes de un solo owner. Conservar el Signal anterior mientras se entrega la nueva generación. Completar el módulo Menciones de Signal sobre el mismo universo/generación: QA final detectó que la navegación desde el resumen nativo aún solicita el endpoint anterior y falla. No reemplazarlo por cero, un estudio puente o una redirección que oculte la falta de integración; el detalle por Topic disponible no sustituye la lista global. NOI-34/20 conserva esta costura. Un recibo de catálogo permite refrescar Topics por el GET existente sin pisar borradores; no hace falta otro formulario, ruta principal o control de publicación.
5. **Probar la siguiente importación real.** Verificar recepción → preparación/embeddings de la nueva revisión → cómputo incremental automático → temas conocidos/emergentes → interpretación → edición/selección → Signal. Hoy preparar y obtener embeddings de revisiones nuevas todavía requiere una acción y el permiso correspondiente; automatizarlo dentro de límites autorizados sigue siendo parte del primer monitoreo completo. Faltar archivos de un ámbito no bloquea los datos presentes. Comprobar antes/después, conteos, evidencia, no duplicados y recuperación desde UI.

## Decisión de procedencia que evita invalidar el propio trabajo

La admisión editorial conserva el corte histórico con el que fue autorizada. Publicar su propio resultado no puede cambiar ese corte y volver obsoletos sus permisos o generar recursión en la validación. El corte de serving compuesto agrega resultados incrementales verificados únicamente para catálogo, bindings y generación de clasificación. No modifica snapshots de admisión, request digests, recibos o modelos.

`model_origin` siempre nombra el origen numérico real. `proposal.owner_execution_id` siempre nombra el intérprete real. Los claims0148 prueban la correspondencia exacta de componente/unidad/nacimiento/origen y owner; ningún booleano «verified» o cambio artificial de owner sustituye esa prueba. La rama full-fit mantiene sus reglas y hashes existentes. El resolver puro de esta variante quedó cerrado LOCAL en070c94e (DELIVERY_INCREMENTAL_EDITORIAL_PROVENANCE_LOCAL_2026-09-09.md); la lectura/autorización DB y su activación siguen pendientes.

## Criterios imprescindibles de cierre

- Nuevas unidades heredadas de oleadas anteriores se encuentran incluso si la última oleada no creó otros grupos. EOF/SHA, todas las raíces y todos los componentes se verifican; ningún muestreo sustituye el cómputo del corpus.
- El plan gratuito, la confirmación y los resultados tienen recibos durables; ACK perdido no crea otro job, permiso, Topic o envío. Transporte e integridad tienen respuestas distintas. El costo de una llamada incierta no se libera por intuición.
- Leer una respuesta ya pagada no requiere un permiso vigente de nuevos envíos. Revocar gasto conserva esa recuperación; perder derechos de acceso sigue bloqueando la lectura.
- Cambiar contexto, corpus, claims o significado de un Topic detecta obsolescencia antes de aplicar asociaciones. Un Topic archivado no revive y sus ediciones no se sobrescriben.
- Marcas, Overview, Datos, Topics y Signal comparten denominadores trazables. Ámbito de archivo, relevancia semántica, unidades interpretadas, raíces clasificadas y selección en Signal son cantidades diferentes.
- Pruebas locales con DB/Worker/archivos y HTTP falso preceden la entrega focal. Después viene la comprobación real por UI con datos y gasto autorizados. No certificar dos millones de menciones ni precisión semántica sin evidencia propia.

## Implementación acotada sobre lo existente

La preparación requiere un pequeño módulo DB y job de evidencia, lectores de orígenes incrementales y fragmentos actuales, y extensión focal del outbox/operation_kind. Reutiliza streamEvidence, storeEvidence y persist0148; el cierre y recibo del trabajo ocurren en una transacción. El censo ya lo persiste el derivador existente. No acoplar un fallo de evidencia a la fila completed de serving.

La entrega de resultados requiere la variante de propuesta en el resolver compartido, lector/guard de procedencia en DB, materialización dentro de signal-topic-catalog y corte de serving compuesto en incremental-projection. Reutiliza el Worker derivador y el root projector; sólo el DTO/refresh de análisis de Studio necesita comunicar el recibo de catálogo. No cambiar el consumidor monetario para materializar ni modificar selección automáticamente.

Asignar migraciones nuevas al componer los dos cambios, evitando que dos tareas reserven el mismo número. SQL0148/0149 siguen locales y deben llegar junto con un recorrido usable y comprobado, no mediante una admisión manual UAT que lo simule.

## Aceptación de cliente y utilidad, pendientes vigentes

El recorrido UAT se ha probado con cuenta operadora Admin Noisia. NOI-19 ya advertía desde el 7 septiembre que el shell Studio, alta y Brand OS seguían internos; comprobar el recorrido como operadora no cierra el autoservicio de un cliente. Antes de llamar a esto lanzamiento, un administrador cliente con grant de su workspace debe crear/configurar/importar/procesar/editar/seguir desde la UI, conservando denegación entre organizaciones y para cuentas suspendidas. Las APIs de importación y preparación de texto ya admiten capacidades scoped; no sustituirlas por permiso global ni abrir todas las herramientas administrativas. La comprobación actual de rutas y las extensiones necesarias se conservan en NOI-19/20/81; no repetir los gates de autorización anteriores sin un cambio nuevo.

La aceptación de utilidad es distinta de completar transportes. El catálogo actual contiene32 nombres/definiciones, pero sólo32de357unidades interpretadas. QA cualitativa del catálogo y primera página de25/63 evidencias del Topic seleccionado encuentra intenciones útiles, temas adyacentes o ajenos, candidatos a consolidación, dos insuficientes y mezcla de idiomas. No es medida de precisión. NOI-75 conserva la prioridad: organización editorial explicable, nombres localizados y excepciones útiles resueltas con evidencia, sin rúbrica humana porgrupo. Claude puede proponer, pero la evaluación independiente y el censo determinístico no se sustituyen por su autoevaluación.

## Composición de código pendiente

UAT/focal está en c8f05b9. El worktree editorial parte de0a80532 y contiene b6da353→f35d78c→070c94e; NO sustituir la rama UAT con ese HEAD porque perdería las entregas posteriores de Dashboard/Topics/Overview. Integrar los cortes focales sobre el HEAD UAT vigente en un checkout limpio cuando exista el recorrido completo, resolver la composición y comprobarla. Los tres drafts ajenos permanecen excluidos. SQL0148/0149 nunca fue aplicado UAT.

## Fuentes de detalle

- DELIVERY_INCREMENTAL_EDITORIAL_FOUNDATION_LOCAL_2026-09-09.md y DELIVERY_INCREMENTAL_EDITORIAL_CONSUMER_LOCAL_2026-09-09.md: evidencia cerrada local.
- Memo Backend: worktree runtime `.data/workspace-incremental-editorial-runtime-2026-09-09/EVIDENCE_PRODUCER_ADMISSION_NEXT_CUT.md`; APIs, fuentes, siete archivos por origen y cinco pruebas de aceptación.
- Memo Frontend: mismo worktree `.data/workspace-incremental-editorial-consumer-2026-09-09/EDITORIAL_TO_SIGNAL_NEXT_CUT.md`; bloqueos concretos, archivos, corte de serving y cinco pruebas de aceptación.
- NOI-78 conserva monitoreo y ambas conexiones; NOI-81, permisos/costos y política de usuario cliente. No cerrar con una prueba parcial.

Reportes con agente y MCP permanecen en el Compass después de este recorrido. No se descartan; tampoco justifican abrir otro frente antes del monitoreo completo.
