# Marca nueva → intereses → importación UI

Fecha: 7 septiembre 2026 (hora local). Commit focal `c40899b01d8b77cae71d712c92054ca71b12be7f`, sobre `907d485`. Enviado a `codex/noisia-topic-results-uat-2026-09-06`; Studio y Workers verificados activos en ese commit. No producción, DDL nuevo, datos hardcodeados ni reparaciones de Laika/Alexa.

## Resultado de este corte

Crear una marca lleva a su contexto; desde allí el recorrido señala Topics e intereses y después Importar. Topics es una entrada principal. Permite guardar y editar intereses sin corpus, embeddings o llamadas de proveedor. El vacío indica que faltan menciones reales. Una taxonomía histórica y un candidato con evidencia no se presentan como una nueva corrida BERTopic.

La preparación de importación usa la marca y sus competidores declarados, confirma la categoría y los derechos de una fuente. Crea la configuración transaccionalmente y reutiliza el transporte durable existente. No pide queries ficticias ni convierte el archivo de competencia en prueba de atribución semántica. La declaración de uso de IA es independiente y no dispara gasto.

Formato actual: export CSV original de SentiOne, 47 columnas, encabezados conservados. La UI permite elegir marca, competidor o categoría y declarar cobertura del archivo. El parser acepta separadores coma/punto y coma/tabulación. Otros proveedores y mapeo genérico siguen en el alcance pendiente de NOI-12; no afirmar soporte porque el parser tenga aliases.

## Evidencia

- Root `pnpm typecheck`, `pnpm lint`, Studio build: verdes. Lint conserva 15 advertencias previas; cero errores.
- Studio: 553 pasan / 1 skip; DB: 206 pasan / 29 opt-in skip; query-engine: 383 pasan; Workers: 217 pasan / 3 skip.
- PostgreSQL local desechable real: alta por API, configuración sin corpus ni queries, scopes, derechos por fuente, creación de upload con transporte de storage simulado, replay/409, rollback, permisos cross-org/revocados/viewer y edición concurrente de Topics. Pruebas opt-in específicas ejecutadas, no inferidas de los skips generales.
- Componentes reales en navegador con transporte local aislado: guardar interés categoría antes de corpus, búsqueda deshabilitada, consentimiento requerido, fallo/reintento de preparación, tres ámbitos, formulario CSV y ES/EN. Cero menciones. El harness no es UAT ni una prueba del Worker real.
- Revisión independiente de agentes y root: sin hallazgos P0/P1/P2 pendientes de este corte. Se cerró el retorno de evidencia histórica a clientes sin permiso de adopción.
- Recibos privados: `.data/self-service-implementation-2026-09-07/`, `.data/self-service-import-tests/` y `.data/self-service-topics-tests/` del worktree focal. Tres archivos ajenos de `signal-topic-contract-drafts` conservados, fuera del commit.

## Lo que sigue abierto

**No es todavía lanzamiento self-service completo.** Cliente tiene capacidades acotadas en API, pero el shell, alta, BrandOS completo y ejecución/publicación cliente siguen internos (NOI-19). El operador puede usar este recorrido con su cuenta actual.

BERTopic/cómputo sobre todo el corpus, guiado por contexto e intereses, interpretación de Claude, clasificación masiva, novedad incremental y Signal multiámbito mantienen los pendientes del Compass. Este corte no inicia proveedores al cargar un CSV y no acredita precisión semántica, volumen 2M/1000 ni seguimiento incremental. No levantar límites existentes sin sustituirlos con implementación y evidencia.

Siguiente entrada del operador: crear una marca/prospecto nuevo desde `/studio/brands/new`, guardar contexto e intereses, y aportar sus CSV reales en la sección Importar. Al existir la carga real, continuar preparación/clasificación genérica y descubrimiento; usar esos datos para comprobar el flujo, sin reabrir marcas históricas. No pedir dumps, credenciales ni inserciones por scripts.

## Continuidad

Compass y plan originales se conservan. Tickets actualizados: NOI-12, NOI-15, NOI-19, NOI-27, NOI-55 y NOI-74. Ninguno se cerró por tener sólo esta primera integración. El loop quedó PAUSED al quedar lista la UI y requerir datos del operador. No se hicieron llamadas pagadas: saldo mínimo producto USD 11.362961; Advisor separado USD 1.343826.

## Aceptación UAT de este corte

Studio deployment `c2738572-ad75-4ffd-b16c-e7a345edb32e` y Workers `b8822bb2-d527-448e-a667-59dab3fcbaa8`: Active, commit c40899b verificado en Details/Railway. Health profundo200 con DB/identidad UAT correctas. Alta autenticada muestra copy nueva y botón Crear marca y continuar; consola sin errores. No se creó una marca ficticia para esta verificación. Upload/storage/Worker con un archivo real sigue pendiente de la carga del operador, distinguido de la prueba PG local.
