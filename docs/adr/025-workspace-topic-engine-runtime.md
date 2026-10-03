# ADR 025 — Motor de tópicos sobre el corpus del workspace

Estado: implementado localmente; la entrega UAT y el recorrido hasta Signal tienen recibos separados.

## Decisión

El análisis usa la población preparada del workspace y sus embeddings completos. El Worker Node existente exporta todos los fragmentos y guías mediante páginas estables a JSONL/NumPy; un subprocess Python ejecuta BERTopic/UMAP/HDBSCAN con el perfil fijo. No se crea un estudio legacy, una segunda población ni un servicio de ejecución distinto. Se reutilizan BullMQ, outbox, leases, `signal_topic_catalog_executions`, `analysis_artifacts` y el registro de modelos.

La vía abierta usa todos los vectores originales. La vía guiada incorpora Brand OS e intereses opcionales sin retirar menciones de la vía abierta. Cero intereses es válido. Todas las partes de cada mención participan; las pertenencias se reconcilian por raíz y pueden solaparse. El índice de ejemplos favorece raíces distintas e incluye una frontera de baja afiliación; no modifica el cálculo ni se presenta como prueba de precisión semántica.

El runtime Linux fija versiones y hashes de imagen. El proceso numérico recibe sólo rutas y configuración permitidas, sin credenciales ni red de proveedores. Los archivos de entrada se verifican por cobertura y digest. El almacenamiento privado divide archivos grandes en partes verificables e inmutables; el registro de modelo apunta a un manifiesto que incluye ambos modelos.

Los artefactos completos se suben antes del checkpoint durable. Una recuperación posterior valida y reutiliza ese checkpoint sin repetir el fit. El scheduler existente rescata un lease vencido con una nueva generación de job; las solicitudes y el outbox se escriben atómicamente. El scratch pertenece al intento y se elimina al terminarlo. Una respuesta monetaria incierta conserva su reserva y no habilita otro envío.

La siguiente carga puede reutilizar predicciones del modelo compatible, pero vuelve a descubrir sobre el corpus completo, incluidas menciones previamente asignadas. Un cambio de runtime o contexto omite la deserialización incompatible, recalcula y conserva el linaje JSON verificable. El solapamiento del linaje es una heurística de continuidad, no aprobación de equivalencia semántica.

## Límites y conexión pendiente

Una ejecución completa del motor produce agrupaciones computacionales y un modelo draft. No aprueba clasificaciones ni publica Signal. La interpretación Claude, los Topics editables producidos, su selección editorial y la generación persistente/reader de Signal requieren conectar contratos existentes sin fabricar aprobaciones. Los intereses que guían el análisis deben distinguirse de sus resultados para evitar que el catálogo producido invalide su propia ejecución.

La guarda de memoria por proceso no acredita un pico de memoria ni capacidad de dos millones de menciones. Las pruebas locales usan cientos de raíces; el volumen real de UAT se declara en su recibo. Una población insuficiente conserva el conteo y devuelve un resultado explícito sin inventar modelo o tópicos.

Ver `services/workers/WORKSPACE_ENGINE_RUNTIME.md`, SQL0137 y el Compass self-service del7septiembre. Este ADR añade una decisión de runtime; no reemplaza el canon histórico ni reabre gates cerrados.
