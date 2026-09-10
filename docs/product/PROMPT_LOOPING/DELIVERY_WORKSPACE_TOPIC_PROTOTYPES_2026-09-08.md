# Entrega UAT — preparación de intereses y Brand OS

**8 septiembre 2026. Studio y Worker ejecutan `ae3e36c1e8e2f7b9e2159b699acc08ebcf4c5848`, comprobado dentro de ambas instancias.** El proveedor permanece deshabilitado. Los 32 archivos focales se publicaron en la rama UAT; tres contract-drafts ajenos conservan sus hashes y quedan fuera del commit. Producción no se tocó.

## Resultado disponible

Topics permite cotizar y preparar intereses guardados con su contexto de Brand OS antes o después de importar. Reutiliza la ejecución de embeddings, reservas, recibos y caché existentes. Textos repetidos entre intereses, roles y menciones comparten el vector físico; cada definición/contexto conserva su propia referencia semántica.

La recuperación conserva solicitud, tope y checkpoint. Caché completa y respuestas ya recibidas pueden terminar sin habilitar proveedor. La interfaz distingue resultado incierto, respuesta inutilizable y preparación anterior pendiente; no supone que toda reserva representa un envío. Un cambio de permisos/contexto impide usar resultados nuevos, mientras una respuesta ya enviada conserva costo y recibo.

No hay otro panel de Brand OS ni búsqueda/publicación automática. La clasificación persistente e incremental, descubrimiento abierto, interpretación con Claude y Signal del corpus nuevo permanecen pendientes en el Compass. Top32 del corte anterior continúa siendo recuperación no calibrada, no clasificación final.

## Release y SQL

- Studio: `94dbe357-d6ff-44f1-b341-9ad9a1b33759`.
- Worker: `b74ae8c2-c95d-4441-af2c-f11f44e5a082`.
- SQL0135 aplicado transaccionalmente a las `2026-09-08T14:52:33.155Z`; SHA256 `0a57447aa200be31e678151c4f2f1ae052c57a94b45219837f5ba2ec02e6f457`.
- Verificación remota: cuatro tablas conservan RLS, dos triggers y dos contratos añadidos; las ejecuciones anteriores mantienen tipo corpus y los recibos anteriores no se inventaron.
- Rama publicada: `codex/noisia-topic-results-uat-2026-09-06` en `noisia-ai/monorepo`. Worktree de trabajo: `/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`.

SQL0135 es aditivo y distingue los intereses del corpus dentro del ledger existente. No reaplicar ni revertir datos como operación de continuidad. Una retirada de código requeriría revisar el uso de los tipos nuevos; conservar historial y reservas. El flag del proveedor sigue en false.

## Evidencia cerrada

- Root typecheck/lint: 11/11 tareas; cero errores y 15 advertencias previas de lint. Studio build verde.
- QueryEngine:416 PASS. DB:231 PASS/48 SKIP estándar; PG opt-in nuevo4/4 ejecutado sin skips. Studio:659 PASS/6 SKIP estándar; PG de servicio1/1 ejecutado. Worker:254 PASS/3 SKIP.
- PG/BullMQ con transporte simulado: tres intereses antes de cualquier import,202 referencias/187 textos únicos y dos lotes128+59. Fallo después de recibir la segunda respuesta; recuperación con proveedor deshabilitado y cero llamadas adicionales. Segundo recorrido de caché sin llamadas. Una mención local posterior reutiliza un vector y permite búsqueda lista/vigente.
- Negativos PG: presupuesto inferior/superior y proveedor deshabilitado crean cero intenciones; unknown conserva reserva y bloquea solapamientos entre corpus/intereses; definitely_not_sent libera reserva; contexto/permisos retirados conservan recibos pagados sin publicar aliases. Fuentes KB ajenas, retiradas, expiradas/futuras y aliases falsificados rechazados.
- Servicio PG: aislamiento por workspace/actor, lector readonly, request_run propio, datos privados ausentes, catálogo vacío, separación de corpus/intereses y estado pendiente conocido distinto de unknown.
- Revisión independiente cerró un P2: el sello de estado debe representar el inicio del snapshot, no el final de una lectura lenta. Corregido con transaction_timestamp y comprobado con dos lectores PG fuera de orden. Sin P0/P1/P2 pendientes en la superficie revisada.
- UI:14 pruebas focales;25 escenarios de navegador local, incluyendo transporte perdido, recuperación, cambio de workspace, respuestas tardías,403,409 con recibo y422 sin intención. Capturas ES1280/EN390 y estado pendiente390 revisadas sin overflow. Son pruebas del componente real aislado con transporte simulado, no una ejecución pagada ni el recorrido entero en UAT.

## National y comprobación remota

National conserva16CSV/9,131 filas;6,826 menciones preparadas/20,821 fragmentos. Aún no tiene intereses ni embeddings reales. Topics abre con la sesión del operador, catálogo0 y consola sin errores. No se crearon datos ficticios para probar el control.

El lector nuevo, ejecutado dentro del Studio desplegado con el actor real del operador y su autorización, devolvió `no_topics`, plan null, sin runs ni bloqueos a las15:02:19.964Z. La cotización respondió `workspace_topic_catalog_required`, coherente con ausencia de catálogo. La navegación directa al JSON desde el navegador integrado fue bloqueada por el cliente del navegador; no se presenta como un GET autenticado HTTP200 del endpoint. Rutas/servicio se verificaron localmente y el lector remoto sí se ejecutó sobre el código/DB de UAT. La interacción de preparar intereses reales en UAT sigue pendiente de que existan esos intereses y de una ejecución pagada autorizada cuando haga falta.

Cero llamadas externas en este corte. ProductoUSD11.362961 y AdvisorUSD1.343826 intactos. Cotización conservadora previa del corpusUSD8.328543 frente al máximo remotoUSD5; no se elevó. La pregunta ya hecha sobre zona de exportación SentiOne sigue pendiente; no repetir ni reparar fechas por intuición.

## Continuidad

Retomar clasificación persistente/versionada e incremental del workspace con los motores existentes, separando pertenencia aprobada, dudas y conversaciones sin tema. No convertir el top32 en precisión semántica ni relabelar SQL0087 por atajo. Diseñar y probar primero con transporte local: consumo de todo el corpus, conservación de correcciones, incorporación de nuevas menciones y detección de conversaciones emergentes también entre las que tengan candidatos guiados.

NOI-31/78 permanecen abiertos y obligatorios. NOI-81 conserva resolución integral de respuestas inciertas y presupuesto self-service; NOI-19 acceso cliente integral y NOI-80 retención/retirada física. La nueva preparación cierra su implementación focal, no esos tickets completos. No repetir los gates de recepción/preparación/embeddings/búsqueda ni SQL0131–0135 sin una nueva causa.

Referencias: [plan del corte](./WORKSPACE_TOPIC_PROTOTYPE_PREPARATION_2026-09-08.md), [ADR023](../../adr/023-workspace-topic-prototype-preparation.md), [Compass](./COMPASS_SELF_SERVICE_2026-09-07.md). Recibos de root/backend/Worker en `.data/workspace-topic-prototypes-2026-09-08/` del worktree focal; frontend en `.data/workspace-topic-preparation-ui-2026-09-08/` del repo documental. El historial anterior permanece conservado.
