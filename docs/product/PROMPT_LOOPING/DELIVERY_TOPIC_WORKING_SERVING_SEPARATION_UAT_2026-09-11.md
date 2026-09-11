# Entrega UAT — catálogo editorial de Topics separado de Signal operativo

Fecha del corte: 2026-09-11 13:39 UTC  
Commit de producto: `3782be7d1cf7dee4885351ededa8c09c38eeb818`  
Commit de rollout Studio: `7b49a0096c345e558dbf704ae5de13f4556fa3ab`  
Rama focal: `codex/noisia-brand-context-e2e-2026-09-10`  
Rama UAT: `codex/noisia-topic-results-uat-2026-09-06`

## Resultado de producto

Editar un Topic ya es una operación editorial separada del procesamiento. Crear, renombrar,
describir, cambiar ámbito, archivar o restaurar guarda una nueva revisión del catálogo de trabajo con
CAS de revisión y digest. Estas acciones no crean ejecuciones, outbox, reservas, costos ni llamadas a
proveedores.

Signal, el clasificador incremental y cualquier ejecución ya iniciada continúan fijados al perfil
operativo de la última generación válida. Mientras el catálogo editable tenga cambios pendientes, la
UI lo comunica y mantiene accesible el Signal anterior. La recomputación sigue siendo una acción
explícita y reservada a quien tenga capacidad de ejecución.

La selección usa la identidad exacta de la generación servida. Se puede retirar de Signal un Topic
servido aunque exista una revisión editorial posterior; una revisión nueva no se puede seleccionar
hasta que exista una generación válida para ella. Archivar el borrador no deselecciona por accidente
la versión servida y restaurarlo tampoco revive una selección histórica.

## Despliegue verificado

- SQL0154 se aplicó una sola vez en UAT y se verificaron sus tres triggers. No reaplicar.
- Worker UAT: producto `3782be7`, deployment `dcb76526-83bb-414e-91e1-9587ce781c9b`, activo.
- Studio UAT: rollout `7b49a00`, deployment `99df71e3-0b57-46cd-9ea9-0f1e9c57922d`, activo.
- El Studio se entregó después del Worker y su autodeploy se restauró al terminar.
- `/api/health`: `status=ok` a las 13:39 UTC.

## Evidencia funcional y de datos

La consulta posterior de sólo lectura comprobó para National:

- Perfil de trabajo `131023fd-13d1-45b3-8ae4-5fc3c5a82202` y perfil operativo
  `65a5f3c1-a8e2-478b-bc39-a87d7de1abdb`: la separación está materializada.
- Generación servida `8de2a60d-4106-4e27-9604-fb4032940638` y dos Topics seleccionados intactos.
- Cero ejecuciones activas, cero outbox activo, cero embeddings activos y cero eventos de costo nuevos
  desde el rollout.
- Overview conserva 16 archivos, 9,131 filas, 7,396 menciones únicas, 6,826 preparadas y los ámbitos
  reales: 2 archivos de marca, 13 de competencia y 1 de categoría.
- Topics conserva 32 elementos de catálogo provenientes de 32/357 unidades interpretadas y los costos
  históricos sin cambio.
- Signal conserva 6,826 menciones en el periodo y 98 asociaciones en los dos Topics seleccionados:
  35 sobre viajes en España y 63 sobre quejas de servicio.
- Desde la evidencia de un Topic se abrió la mención original
  `0313b353-86cb-4eab-b538-0b007a8a33fc` en la vista nativa de Menciones, con texto y URL originales.

Una navegación de QA agregó un parámetro arbitrario `verify` a la URL de Signal y recibió el rechazo
422 `workspace_topic_filter_unsupported`. La ruta canónica sin ese parámetro funciona. Es el contrato
de filtros exactos y no un fallo del flujo de producto.

## Verificación local

- PostgreSQL compuesto: 40/40 PASS, incluida la secuencia A servida → edición B → cero efectos de
  cómputo → A permanece en Signal → activación explícita de B.
- Rollback del ensayo: 269 tablas conservadas; SQL0153/0154 ausentes después del rollback.
- Base de datos: 497 totales, 408 PASS, 89 SKIP, 0 FAIL.
- Worker: 603 totales, 561 PASS, 42 SKIP, 0 FAIL.
- Query: 473 PASS.
- Studio: 941 totales, 934 PASS, 7 SKIP, 0 FAIL.
- TypeScript: 11/11 paquetes PASS.
- ESLint: 11/11 paquetes, 0 errores y 13 advertencias históricas.
- Build de producción de Studio: PASS.
- Revisión final: 0 P0/P1/P2.

## Siguiente corte

Cerrar la política autoservicio de procesamiento para una marca nueva: permiso estrecho para solicitar
preparación, vectores y análisis; proveedor/modelo/caps derivados por servidor; exposición diaria
agregada desde los ledgers existentes; y UI cliente que muestre disponibilidad y presupuesto sin
exponer controles internos. La primera activación real se hará con una nueva marca y menciones elegidas
por el operador. Esta entrega no ejecutó imports, Voyage, Claude ni fit.
