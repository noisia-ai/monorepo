> Plan del siguiente corte, aprobado técnicamente por el orquestador tras NOI-82. Base UAT `1a609cb`; desarrollo aún no iniciado. Este alcance complementa el Compass y la historia, no sustituye el objetivo E2E ni declara completos derechos cliente, alta, Brand OS o procesamiento autónomo.

# NOI-19: entrada cliente a una marca ya asignada

Propuesta local, sólo lectura, 10 septiembre 2026. Base verificada: `1a609cb0cd1b24c661818e37bc65dcdfb3303b59`. Reutiliza el memo del 9 de septiembre: `/Users/brandhon_o/Downloads/noisia-incremental-editorial-runtime-2026-09-09/.data/workspace-incremental-editorial-projection-pure-2026-09-09/CLIENT_ADMIN_JOURNEY_READONLY.md`. No repite la auditoría general ni considera esta nota un gate ejecutado.

**Resultado del primer corte:** un cliente administrador entra a su marca asignada, incluso sin `published_outputs`, consulta y reutiliza sus Topics/Datos y decide qué Topics disponibles seleccionar o quitar de Signal. No obtiene acceso a Admin global ni permiso para ejecutar modelos o gastar.

## Qué sigue igual y qué cambió desde el memo

El diff focal `070c94e..1a609cb` conserva los guards/roles, layout Studio, páginas Topics/Datos, capability resolver, store de selección, DTO de selección y TopicsManager. Cambió SignalV2WorkspacePage por la lista nativa de Menciones; todavía omite gestionar Topics para clientes (`:71`). NOI-82 ya permite renovar el permiso incremental de un owner interno existente, pero **no amplió la autoridad cliente**.

Tres bloqueos concretos permanecen:

1. `/portal` redirige a `/signal`; `apps/studio/src/app/signal/page.tsx:15–16` lista sólo outputs publicados. Una marca asignada sin reporte no tiene entrada, aunque tenga workspace/corpus/Topics.
2. `/studio` exige `requireStudioUser` en layout y páginas. `getAdminBrandWorkspace` rechaza clientes (`lib/data/admin-workspace.ts:183–185`) y carga información administrativa innecesaria. Una ruta nueva que lo reuse seguiría bloqueada o tentaría a abrir Admin.
3. `signal-workspace-topic-selection.ts:21–24,47–58` exige ejecución para seleccionar/quitar; el DTO `signal-workspace-topics-native.ts:67` deriva `can_select` de `can_execute_topics`. La operación no envía modelos. **Precisión frente al memo previo:** SQL0140 sólo impone forma/inmutabilidad del receipt y retirada al archivar; no encontré un guard SQL de selección que obligue a conceder ejecución. No se propone DDL ni ampliar `signal_workspace_classification_actor_v1` por defecto.

## Delta mínimo implementable

| Seam / archivos | Cambio concreto |
| --- | --- |
| `apps/studio/src/app/signal/page.tsx`; `lib/data-os/signal-workspace.ts:123–177` | Añadir acceso a workspaces de **marca** asignados, separado de reportes publicados. Reusar listado bulk scoped a actor/organización/grant; filtrar marca/workspace/actor activos y grants válidos mediante autoridad DB. No depender de outputs ni importar el listado Admin. El texto de entrada debe distinguir workspace vivo de reporte publicado. |
| Nuevas `app/signal/[outputId]/manage/topics/page.tsx` y `manage/data/page.tsx`; un loader de página compartido en `lib/data-os/workspace-management-entry.ts` | `requirePortalUser` → resolver del workspace **por slug explícito** → capabilities DB. Resolver brandId desde el workspace autorizado; no aceptarlo como autoridad cliente ni caer a legacyOutput. Devolver sólo identidad/capacidades/datos necesarios. `dynamic`, no-store y Links sin prefetch; mantener `/studio` y su layout intactos. |
| `components/signal-v2/SignalV2WorkspacePage.tsx`; `components/brands/BrandMonitoringJourney.tsx`, `TopicsManager.tsx`; `components/admin/SelfServiceImportManager.tsx` | Enlace a gestión scoped y destinos Topics/Datos/Signal. Parametrizar los href actuales `/studio/brands/...` con destinos calculados por servidor, conservando defaults internos. Reusar TopicsManager, TopicSignalControls, SelfServiceImportManager y WorkspaceCorpusReadinessPanel; no copiar una segunda implementación de esos flujos. No mostrar Brand OS como paso editable de este corte. |
| `lib/data-os/workspace-management-entry.ts`; stores existentes de recepción | Datos usa `loadWorkspaceCorpusReadinessForActorV1` y `loadAdminWorkspaceCorpusSummariesV1` **con actor y IDs autorizados**: este último ya filtra `can_view` y hace dos consultas batch, pese a su nombre. Conservar únicos recibidos/duplicados/pendientes/fechas observadas y desconocido; nunca sustituirlos por menciones gobernadas. No cargar team/org/profile/access counts del loader Admin. |
| `infrastructure/db/signal-workspace-capabilities.ts` + tests; `signal-workspace-topic-selection.ts`; `lib/data-os/signal-workspace-topics-native.ts` + tests | Añadir `can_select_signal` específico: internos autorizados conservan su capacidad; cliente admin/aliases activo, misma organización y grant comment/admin puede seleccionar/quitar. Read-only y viewers no. Aplicar capability antes de mutation y nuevamente bajo lock, y reflejarla en `can_select`. **No modificar `can_execute_topics` ni `can_adopt_topics`.** |
| APIs existentes `api/data-os/signal/[workspaceId]/topics/_lib.ts`, `topics/[termKey]/commands/route.ts`; `_lib/load-import.ts`; servicios `signal-topics-management.ts`, `workspace-corpus-preparation.ts` | Reutilizar identidad autenticada + resolver tenant + capability específica, no `requireInternalActor` global. Topics GET/edición permitida usan can_view/can_edit; import/setup y preparación de texto usan can_import. La rama `select_signal` mantiene su schema/key y usa la nueva capability. Las ramas begin/análisis/retry/embeddings/permisos monetarios conservan sus guards actuales. No pasar por revisión/adopción legacy interna para mostrar catálogo nativo. |
| Componentes reutilizados + mensajes ES/EN y pruebas focales | El montaje hace GET. Inputs y acciones responden a capacidades del servidor, sin client_admin hardcodeado en UI. Renderizar import sólo si autorizado; viewers tienen recepción de sólo lectura. Cerrar datos/intent al cambiar actor/workspace o recibir 401/403/404, abortar respuestas tardías. En particular SelfServiceImportManager hoy conserva setup al fallar `load` (`:30–40`): acotar su estado/epoch al reutilizarlo en navegación cliente. |

No basta una ruta accesible: el loader **y cada endpoint utilizado** deben mantener el scope real. Tampoco basta ocultar controles monetarios: POST directo de análisis, preparación semántica, embeddings (incluida caché0), permisos/reanudaciones pagadas y adopción legacy debe seguir denegado para ese cliente. El servicio y DB son la autoridad.

## Reglas que se conservan

Seleccionar exige la generación current/completa, definición/revisión/digest exactos, membresías actuales y derechos. Quitar conserva la semántica existente: permite retirar la selección propia aun si la generación quedó stale; no vuelve a calcular ni rehabilita evidencia. Ambos usan CAS de selección, key/receipt existente y sin model/queue/cost events. No significa aprobar semánticamente un Topic.

Edición de Topics se expone **sólo donde la política ya lo permite**. `signal-topics-management.ts:75–78` y `signal-topic-catalog.ts:1149` aún restringen edición de catálogo activo/búsqueda previa cuando no hay permiso de procesamiento; este corte no elimina esa restricción. El cliente puede reutilizar/seleccionar resultados disponibles y editar borradores autorizados, sin prometer edición universal ni análisis propio.

## Aceptación para la implementación posterior (no ejecutada)

- Matriz local: client_admin con comment/admin puede entrar, importar/preparar texto y seleccionar/quitar; client_admin/read y client_viewer/agency_insights sólo leen; suspendido/inactivo/revocado/workspace ajeno/organización ajena no reciben payload. Rol/grant se leen de DB, no del token/body.
- Marca asignada **sin outputs** aparece y abre Topics/Datos vacíos o pendientes honestos. Sin asignaciones hay un vacío útil, sin lista global ni botón de alta. Internos conservan la entrada actual.
- PG focal de selección: generación current → seleccionar → quitar → replay ACK; stale/CAS/definición/cross-tenant rechazados según operación. Cero nuevos engines, outboxes y cost events; ninguna modificación de assignments/approval. Comprobar POST monetarios denegados con el mismo actor.
- UI local ES/EN desktop/móvil: entrada → Topics → Datos → Signal/Menciones/cita autorizada; href recargables sin Studio, no POST al montar, borrador preservado, selección recuperable por key, permisos distintos visibles. Cambio de workspace/actor y revocación retiran datos, drawer e intenciones del scope anterior; respuesta tardía no los repone.
- Validación de imports/preparación con fixtures locales y transports simulados o PG local controlado; no cuenta como import/cliente UAT real. No repetir gates históricos de modelos o migraciones.

**Fuera del primer corte:** alta/movimiento de marca, edición de Brand OS/organizaciones/equipos, invitaciones/cuentas, concesión de roles reales, permiso de ejecutar/gastar, propietario o cap de presupuesto, embeddings automáticos, aprobación semántica y procesamiento de catálogo activo. No se renueva un grant por visitar la página. NOI-20 conserva la aceptación posterior con cliente real y nueva/segunda carga cuando haya autorización explícita; esta nota no certifica autoservicio E2E total.

Origen: propuesta privada del agente Import; copia canónica preservada para continuidad. No se modificaron producto, roles, datos, UAT ni SQL; no se ejecutaron pruebas, importaciones ni proveedores.
