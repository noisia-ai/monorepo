# Clasificación persistente e incremental — integración local

8 septiembre 2026. Base de producto/UAT `ae3e36c`; Compass y plan self-service conservan autoridad. Este corte sigue a la preparación de intereses y no reabre imports, preparación, embeddings, búsqueda ni SQL0131–0135.

## Resultado y límite del corte

Conectar decisiones de un motor con las generaciones, asignaciones y ejecución existentes de Noisia. Probar dos cargas, recuperación y correcciones en PostgreSQL/Worker locales con un motor simulado. No exponer otro botón que llame clasificación al ranking no calibrado. La integración de un productor semántico/discovery real sigue siendo necesaria antes de activar este camino en UAT.

SQL0087 ya tiene las tablas de autoridad necesarias. Sus funciones aún exigen corpus de estudio/perfil activo, igualan el estado de la raíz al de cada asignación y pueden invalidar la última generación completa al crear una sucesora abierta. Se extienden sólo para una entrada workspace nativa: manifiesto preparado, embeddings completos, catálogo/contexto y derechos vigentes. No se crea un corpus de estudio artificial ni otro ledger.

Persistencia dispersa: una resolución por mención y sólo decisiones explícitas por Topic. No almacenar dos mil millones de dudas para dos millones de menciones por mil Topics. La ausencia de una asignación nunca significa rechazo; una raíz puede tener pertenencias confirmadas y una duda o error localizado. Un fallo al evaluar un Topic no borra una corrección humana válida de otro.

La búsqueda top32 permanece como evidencia de recuperación. No alimenta aprobaciones ni se convierte en un conjunto exhaustivo de pertenencias. Scores altos, coincidencias léxicas y calibraciones de un perfil distinto no dan autoridad semántica. Sin motor real no existe un fallback que finja haber clasificado mediante abstenciones.

## Contrato incremental

- Identidad global reutilizable: workspace, motor/artefacto/política, perfil de embeddings, compilador, catálogo y contexto.
- Identidad por raíz: ID estable, fingerprint completo de contenido/procedencia/derechos/ámbitos y correcciones de esa raíz.
- IDs de preparación/embeddings/generación y revisión de ingesta sellan la nueva fotografía, pero no invalidan por sí solos la equivalencia de una mención intacta.
- Nueva mención o cambio de texto/derechos/ámbito/corrección recalcula esa raíz. Cambiar catálogo/contexto/política recalcula conservadoramente todas, incluidas las ya asignadas.
- Copiar una decisión conserva referencia a item/asignación y actor originales, revalidando autoridad. Nunca usar supersession prematura que oculte la generación anterior.
- Toda raíz elegible queda reconciliada. Error, duda y abstención son distintos. El último resultado completo continúa disponible mientras se intenta otro; disponibilidad histórica no equivale a vigencia de derechos o contexto.

El transporte de una respuesta por raíz tiene un límite explícito de 8 MiB. Superarlo falla con código de capacidad, sin recortar Topics ni la población. Las pruebas incluyen mil decisiones en una raíz y decisiones dispersas; esto no certifica capacidad de dos millones de menciones.

## Trabajo distribuido

Root implementa contrato compartido, validadores, claves de equivalencia, tests, documentación y revisión. Backend extiende SQL0087 y la ejecución existente con stores/PG local. Worker integra un motor y stores inyectados sin defaults de proveedor o conexión remota. Frontend revisa compatibilidad y riesgos de producto; no se añade UI en este corte. No nuevo registro de cola, productor automático, scheduler ni publicación.

## Verificación necesaria

Multilabel mixto; error parcial con corrección conservada; ausencia de fila no rechaza; aislamiento de workspace/actor/revisión; lectura de todos los fragmentos; commit raíz/cursor atómico; retry sin duplicación; segunda fotografía con reutilización de raíces intactas y cálculo del delta; corrección local no invalida otras raíces; catálogo nuevo sí invalida las ya asignadas; vencimiento/revocación impide uso vigente; último completo conservado. Primero transporte simulado, sin llamadas externas.

## Pendientes del recorrido completo

Este corte no cierra NOI-31/78. Faltan integrar el motor semántico real, descubrimiento abierto con motores existentes y conversaciones ya asignadas, interpretación Claude con evidencia, operación desde UI, monitorización automática de nuevas cargas, selección y Signal multiámbito. Tampoco resuelve por sí solo medición de calidad/escala, NOI-81 presupuesto/unknown, NOI-19 cliente o NOI-80 retención.

National conserva16CSV/9,131filas y6,826menciones preparadas; no se crean intereses ni embeddings ficticios en UAT. Proveedorfalse, saldo productoUSD11.362961/AdvisorUSD1.343826 intactos. La pregunta de zona SentiOne sigue pendiente sin repetición ni reparación por intuición. Sin producción/main, secretos históricos, limpieza destructiva o despliegue del repositorio documental sucio. Preservar tres archivos ajenos de contract-drafts.

Estado: persistencia local implementada y verificada; [recibo y límites](./DELIVERY_WORKSPACE_CLASSIFICATION_LOCAL_2026-09-08.md). La segunda carga nueva de archivos hacia clasificación todavía debe probarse en PostgreSQL con el motor real; este corte probó ese delta en unitarias y la copia del mismo manifiesto en PG. Ninguna entrega remota nueva.
