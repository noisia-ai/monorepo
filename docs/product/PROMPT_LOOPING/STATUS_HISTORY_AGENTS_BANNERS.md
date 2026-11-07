# Historial de avisos de estado del AGENTS.md raíz

Movidos aquí sin cambios el 7 de noviembre de 2026, desde las líneas 7–240 del `AGENTS.md` raíz. El archivo superaba el límite de 32 KiB que Codex carga, y estos avisos eran historia, no instrucciones vigentes. No los trates como estado actual: el trabajo vigente está en `PLAN_PILOTO_ETIQUETADO_MASIVO.md`.

> **REANUDADO POR EL FUNDADOR (2026-10-04) — Noisia V02 / MFP.**
> Ejecutar Fases A y B según [la auditoría](docs/product/PROMPT_LOOPING/AUDIT_MFP_2026-10-04.md); sólo la fusión a `develop` espera revisión del auditor. Fase C espera el gold revisado y los intereses confirmados.
> Rige [el spec canónico v1.3](docs/product/PROMPT_LOOPING/SPEC_FICHA_Y_PERTENENCIA_2026-10-04.md), especialmente §§6–9.
> Política de ramas y worktrees: §7; cada WS usa `feat/mfp-ws<N>-<slug>` y PR a `develop`.
> PostgreSQL, Redis, Worker, integración y suites pesadas corren remotos; no Docker en la Mac.
> Presupuestos orientativos superables con coste registrado; máximo estricto sólo si se configura explícitamente.
> JEV requiere verificación técnica y de datos; UAT admite cortes coherentes verificados y recuperables.
> Producción exige aceptación integral y revisión. V2/V3 de interest decision permanecen congelados.
> Accesos: [MFP_ACCESS_AND_ENV](docs/product/PROMPT_LOOPING/MFP_ACCESS_AND_ENV_2026-10-04.md).
> Todos los banners anteriores de septiembre/octubre que siguen son historia, no tareas, pausas ni autorizaciones actuales.

> **Integración de producción en curso — 3 octubre 2026.** Esta rama de release
> integra `main` con el producto UAT, pero aún no está publicada ni acreditada
> como self-service completo. La ejecución de interés Alexa+ y sus recibos viven
> en `docs/product/PROMPT_LOOPING/PLAN_DEFINED_INTEREST_TO_PRODUCTION_2026-10-02.md`
> y `DELIVERY_INTEREST_DECISION_SCHEMA_POLICY_UAT_2026-10-03.md`. Los encabezados
> fechados de septiembre que siguen son historia, no permisos ni pausas vigentes.
> No ejecutar migraciones UAT ya aplicadas ni entregar producción antes del
> recorrido de una marca nueva y una segunda carga real.

> **REANUDADO — 2026-09-12, Topics consolidados y Signal común.** La pausa anterior queda como historia: el operador pidió revisar Laika, recuperar su calidad visual para todas las marcas y continuar estudio anterior. Leer `docs/product/PROMPT_LOOPING/PLAN_TOPIC_CONSOLIDATION_SIGNAL_PARITY_2026-09-12.md`. Decisión: los 1,652 grupos BERTopic son linaje técnico; el producto debe consolidarlos en Topics/Narratives/Noise manejables con Sonnet4.6 y centroides existentes, sin repetir imports, Voyage ni fit. Primeros cortes: conciliación append-only del terminal USD1.192104→costo observado USD0.118404, excepción durable `repair_invalid`, después dossiers/consolidación y portada Signal con los componentes de Laika. Presupuesto comunicado: USD32 disponibles; corte de consolidación tendrá cap≤USD20. UAT sigue `1dd6882`/SQL0167–0169 aplicados una vez. No producción/main, Opus, SQL repetido, datos borrados ni clasificador Claude por mención.

> **PARADA SEGURA ESTUDIO ANTERIOR E2E — 2026-09-12 14:14 UTC.** El loop
> `noisia-topics-to-signal-uat-loop` quedó `PAUSED` y verificado en este chat. Studio y Worker UAT
> ejecutan `1dd6882337ce15f9ec72894df566316f954c0b3b`; SQL0167–0169 se aplicó una sola vez y no se
> repite. Alexa+ quedó comprobada desde alta UI hasta Signal: 9 CSV, 57,334 filas recibidas,
> 47,285 únicas, 43,159 elegibles, 1,652 grupos BERTopic, 36 Topics parciales, clasificación
> 43,159/43,159 y «Acceso anticipado a Alexa+» seleccionado con 67 menciones. Menciones visible en
> 5.9 s tras el digest exacto de 217,526 filas; snapshots de negocio intactos. Claude Sonnet 4.6:
> USD1.192527 settled y USD1.192104 terminal pendiente; no nuevas llamadas. Leer
> `docs/product/PROMPT_LOOPING/SAFE_PAUSE_ALEXA_PLUS_E2E_2026-09-12.md` y
> `DELIVERY_ALEXA_PLUS_E2E_2026-09-12.md`. Siguen pendientes segunda carga incremental real,
> calidad/locale, cuarentena durable de `repair_invalid`, reserva terminal, SLO, reportes y MCP.
> No declarar producción completa, no reanudar loop/proveedores sin instrucción nueva, no repetir
> SQL0167–0169/imports/Voyage/BERTopic ni tocar producción/main.

> **VENTANA ESTUDIO ANTERIOR E2E ACTIVA — 2026-09-12 07:00–15:00 UTC.** El operador autorizó
> ocho horas para crear **estudio anterior** desde la interfaz UAT y llevarla por alta → ayuda Claude
> para contexto → Brand OS/contexto semántico → Topics/intereses → importación UI de los CSV en
> `área privada local - estudio anterior CSVs` → procesamiento completo → interpretación
> Sonnet 4.6 → Topics editables → selección/publicación → Signal. Loop
> `noisia-topics-to-signal-uat-loop` ACTIVE sobre este chat hasta el corte seguro. Los agentes de
> interfaz/QA/insight sólo observan y reportan; Root decide y hace cualquier cambio. Auditar y
> corregir deuda reusable: consistencia con el Admin tipo Shopify, controles obsoletos, fallos y
> rendimiento. Excluir `_descartar`; `_rename_map.csv` es contexto. Gasto Voyage/Claude autorizado
> para esta ejecución con topes y recibos; **Sonnet 4.6, nunca Opus**. No producción/main, secretos,
> limpieza destructiva, Laika/National/Alexa histórica ni repetición de SQL0153–0161, imports,
> fits o gates cerrados. Leer `PLAN_ALEXA_PLUS_E2E_2026-09-12.md`. Si no termina antes de las
> 15:00 UTC, conservar el trabajo recuperable, documentar el punto exacto y pausar el loop.

> **CORRECCIÓN FOCAL UAT — 2026-09-12 06:56 UTC.** El operador detectó que la ayuda
> «Investigar marca» había desaparecido del alta de marca. La regresión provenía de `44eeab5`,
> que confundió el borrador previo al guardado con la preparación semántica gobernada posterior.
> Restaurado en producto `b557bfd8aaed78b91b57b64480d91562a65f3027` y Studio UAT
> `[identificador privado]`: Claude Sonnet 4.6 fijo, 4,096 tokens y hasta dos
> búsquedas, propuestas por campo con aceptar/descartar, ES/EN y acceso de admin interno/cliente.
> UI real verificó que aparece y se habilita con el contexto mínimo; no se pulsó y el corte gastó
> cero proveedor. Leer `docs/product/PROMPT_LOOPING/DELIVERY_BRAND_INTAKE_CLAUDE_RESTORATION_2026-09-12.md`.
> El loop general sigue `PAUSED`; no reanudar el desarrollo amplio por esta corrección.

> **PARADA SEGURA EXPRESA — 2026-09-12 05:11 UTC / 11 septiembre México.** El operador
> pidió detener el desarrollo y el loop `noisia-topics-to-signal-uat-loop` quedó confirmado
> `PAUSED` en este chat. No reanudar automatización, desarrollo, SQL, imports, fit ni proveedores
> hasta una nueva instrucción explícita. UAT sigue sano sobre producto `5ab45c5`; Worker
> `[identificador privado]`, Studio `[identificador privado]` y
> SQL0161 aplicado una sola vez. El worktree focal está limpio en `bdf98b8` antes de este recibo.
> El tramo reutilizable marca nueva → Brand OS/KB → preparación semántica → Topics/import está
> entregado; el siguiente input legítimo es una marca/prospecto y menciones reales cargadas por el
> operador. Después faltan full-corpus, calidad, Signal y segunda carga incremental. Cero llamadas
> o gasto nuevos; National permanece sólo como regresión. Leer
> `SAFE_PAUSE_NEW_BRAND_SEMANTIC_ENTRY_2026-09-11.md`. No repetir SQL0153–0161, imports, Voyage,
> BERTopic fit ni gates cerrados; no producción/main ni drafts del checkout raíz.

> **Entrada semántica de marca nueva entregada UAT — 2026-09-12 01:55 UTC.** Producto
> `5ab45c5`; Worker `[identificador privado]` y Studio
> `[identificador privado]` activos. SQL0161 SHA `e4519724…24bf9` aplicado una
> sola vez a las 01:42:19Z; no reaplicar. Alta cliente, slug server-owned, grant sólo de marca,
> política inicial acotada, preparación gratis desacoplada y refresco explícito de guías con caché
> quedan conectados antes de importar. QA real ES/EN: National conserva 7,396/16, 6,826 preparadas,
> 32 Topics de357 y142 asociaciones Signal; revisión P0/P1/P2=0. Recibo posterior01:52:32Z:
> grants públicos0, políticas/admisiones/trabajos/incertidumbre/recibos0; proveedores/gasto0. Leer
> `DELIVERY_NEW_BRAND_SEMANTIC_ENTRY_UAT_2026-09-11.md`. Siguiente: marca real hasta que la UI pida
> menciones reales; luego cómputo full e incremental acotado. No repetir SQL0153–0161 ni gates.

> **Entrada semántica de marca nueva cerrada LOCAL — 2026-09-12 01:25 UTC.** Checkout
> `noisia-brand-context-e2e-2026-09-10`, base UAT/docs `82f0e0f`; SQL0161 todavía no UAT. Alta
> cliente deriva slug y grant admin de marca, la preparación gratuita no depende de proveedor/cola,
> el servidor provisiona una política inicial sólo con creador financiero interno configurado y el
> refresco explícito de guías reutiliza caché sin repetir Claude. PG compuesto SQL0141–0161:10PASS,
> incluye `outcome_unknown`, rollback/base temporal/269 censos exactos y0transportes. Studio1001/7,
> Worker564/42, DB suite, TC/lint/build y revisión0P0/P1/P2 cerrados. Leer
> `DELIVERY_NEW_BRAND_SEMANTIC_ENTRY_LOCAL_2026-09-11.md`. Siguiente: preflight UAT, aplicar0161 una
> vez, Worker→Studio→QA interfaz. No repetir SQL0153–0160/imports/Voyage/fit; no Opus ni producción.

> **Renovación semántica vencida entregada UAT — 2026-09-12 00:40 UTC.** Producto `ce5f0c1`,
> marcador Studio `7ad767e`; Worker `[identificador privado]` y Studio
> `[identificador privado]` activos, anteriores retirados y autodeploy restaurado.
> SQL0160 SHA `4e7596e3…73592` aplicado una sola vez a las 00:29:22Z; no reaplicar. Stage1 vencido y
> definitivamente no enviado se renueva explícitamente sobre ejecución/recibo/admisión/reserva
> originales, con replay, fuente/política/cap/ledger y límite combinado cerrados. PG11 grupos,
> interfaz33, Studio985/7, DBfocal28, Worker/TC/lint/build y revisión 0P0/P1/P2 cerrados; no repetir.
> Recibo posterior: RLS activo, grants públicos0 y cero renovaciones, políticas, acciones,
> admisiones, trabajos, incertidumbre u outbox. QA real conserva Brand OS/32 Topics de357 y Signal
> 6,826/142; cero imports o proveedores. Leer
> `DELIVERY_BRAND_CONTEXT_EXPIRED_RETRY_RENEWAL_UAT_2026-09-11.md`. Siguiente: marca nueva hasta
> preparación semántica y detenerse para menciones reales del operador. Loop ACTIVE en este chat.

> **Source fencing Brand Context entregado UAT — 2026-09-11 23:48 UTC.** Corte de producto
> `f77a316`; Worker `[identificador privado]` y Studio
> `[identificador privado]` activos; marcador Studio `4f4b62c`. SQL0159 reconcilia cambios de Brand OS,
> KB y competidores, exige la cotización opaca exacta y vuelve a validar la fuente antes del envío.
> Stage1 DNC rearma el mismo Claude; Stage2 DNC usa sucesor Voyage y puede completar desde caché.
> PG28/28, Studio978/7, Worker564/42, DB502/93, focales, TC/lint/build e interfaz cerrados; revisión
> sin bloqueadores UAT. SQL0159 SHA `0be97f5b…bfc8e7` aplicado y verificado una sola vez; no
> reaplicar. QA real conserva National 7,396/16 y Topics 32/357; recibo posterior: cero políticas,
> admisiones, reconciliaciones, trabajos activos, outbox o llamadas inciertas. Leer
> `DELIVERY_BRAND_CONTEXT_SOURCE_FENCING_UAT_2026-09-11.md`. Gate preproducción: renovación explícita
> de una admisión Stage1 vencida y recuperación de polling largo. No repetir SQL0156–0159 ni gates
> cerrados. Loop ACTIVE en este chat; proveedores inactivos.

> **Cotización Brand Context visible en UAT — 2026-09-11 20:06 UTC.** Studio ejecuta
> `5b22d606c707998f55b12acdcf6823eef034619b`, deployment
> `[identificador privado]`; Worker conserva `cdd93bd` porque Railway saltó el corte
> sin cambios de Worker. El cliente ve la preparación semántica de marca separada de los vectores del
> corpus, con DTO allowlist, errores saneados, actualización coordinada y `can_start:false`; no hay POST,
> reserva, ejecución ni proveedor. QA real conserva 7,396/6,826/570, 32 Topics de 357 y costos históricos
> USD1.918865 + USD1.6818. Suite Studio959, focal18, TC/lint/build y revisión 0P0/P1/P2 cerrados. Leer
> `docs/product/PROMPT_LOOPING/DELIVERY_BRAND_CONTEXT_QUOTE_UAT_2026-09-11.md` y
> `PLAN_BRAND_CONTEXT_COMPOSED_ADMISSION_2026-09-11.md`. SQL0156 está LOCAL: cerrar PG IANA/DST,
> concurrencia monetaria, replay/CAS y rollback antes de POST o UAT. No repetir SQL0153–0155 ni activar
> proveedores desde cableado parcial. Loop continúa ACTIVE en este chat.

> **Preparación cliente activa en UAT — 2026-09-11 19:22 UTC.** Studio ejecuta
> `276c2f7edfe56904eb7b92859d6d0836486e24ef`, deployment
> `[identificador privado]`; Worker conserva `485aed8`/
> `[identificador privado]`. El cliente ya consulta y solicita la preparación gratuita
> del corpus con autoridad de importación, idempotencia y recuperación; Claude/Voyage siguen
> deshabilitados. QA real mostró 7,396 menciones, 6,826 preparadas y 570 excluidas, sin duplicar trabajo
> ni crear gasto. Suite Studio 953, focal25, typecheck/lint/build y revisión cerrados; el P2 de estado
> entre workspaces quedó corregido. Leer
> `docs/product/PROMPT_LOOPING/DELIVERY_CLIENT_CORPUS_PREPARATION_UAT_2026-09-11.md`. Siguiente:
> quote Brand Context de sólo lectura y SQL0156 para admisión Claude+Voyage compuesta; la cotización no
> concede autoridad. No repetir SQL0153–0155 ni activar proveedores desde una conexión parcial.

> **REANUDADO POR EL OPERADOR — 2026-09-11.** La pausa inmediatamente inferior queda como
> historia: el operador pidió continuar, reactivar el agente de interfaz y el loop. Heartbeat
> `noisia-topics-to-signal-uat-loop` ACTIVE sobre este chat hasta que el operador vuelva a pedir
> una pausa; el límite histórico de las 18:35 UTC ya venció y fue retirado al reanudar. Retomar el árbol local descrito en
> `SAFE_PAUSE_CLIENT_CORPUS_PREPARATION_2026-09-11.md`: cerrar preparación gratuita del corpus,
> luego Brand Context workspace-scoped con admisiones Claude+Voyage atómicas. No repetir
> SQL0153–0155 ni gates cerrados, no activar proveedores desde una conexión parcial.

> **PAUSA EXPRESA DEL OPERADOR — 2026-09-11 14:57 UTC.** Loop
> `noisia-topics-to-signal-uat-loop` PAUSED por la app y agente UI detenido. No reanudar
> desarrollo, automatización, despliegues, SQL ni proveedores hasta nueva instrucción. UAT
> permanece en `485aed8` con SQL0155 aplicado una vez y cero actividad/costo nuevo; el commit
> documental `4954125` es el HEAD de ambas ramas remotas. La conexión cliente de preparación
> gratuita quedó LOCAL, sin probar ni commit, en siete archivos del Studio; conservarla y leer
> `docs/product/PROMPT_LOOPING/SAFE_PAUSE_CLIENT_CORPUS_PREPARATION_2026-09-11.md` antes de
> continuar. No repetir SQL0153–0155, imports, Voyage, fit ni gates cerrados.

> **Política self-service instalada sin activación — 2026-09-11 14:52 UTC.** Studio y Worker
> ejecutan `485aed831bc5b7212d23383e6f1a5317b50e5ce1`; deployments Studio
> `[identificador privado]` y Worker `[identificador privado]` activos.
> SQL0155 SHA `4e4014f1…20ee9` aplicado/verificado una sola vez; no reaplicar. Hay cero políticas,
> acciones, admisiones, ejecuciones o costos nuevos. El producto separa `can_request_processing` de
> la ejecución interna, agrega exposición Claude/Voyage/interpretación por organización/día y muestra
> `Preparar → Vectores → Analizar` en superficies cliente sin secretos ni mutaciones pagadas. PG20,
> DB513, Studio948, TC/lint/build y revisión 0P0/P1/P2 cerrados. National conserva 16 CSV/7,396
> menciones/6,826 preparadas, 32 Topics de 32/357 y dos seleccionados/98 en Signal. Leer
> `docs/product/PROMPT_LOOPING/DELIVERY_CLIENT_PROCESSING_POLICY_UAT_2026-09-11.md`. Siguiente:
> conectar preparación gratuita; después Brand Context workspace-scoped con admisiones Claude+Voyage
> atómicas. No activar proveedores, repetir SQL0155/imports/Voyage/fit/gates ni usar National como fin.

> **Catálogo editorial de Topics separado de Signal activo en UAT — 2026-09-11 13:39 UTC.**
> Worker ejecuta `3782be7` y Studio `7b49a00`; SQL0154 aplicado/verificado una vez, no reaplicar.
> Create/update/archive/restore guardan catálogo de trabajo con CAS sin ejecución, outbox, gasto o
> proveedor. Signal e incremental conservan el perfil operativo exacto hasta recomputación explícita;
> selección y lifecycle respetan la identidad servida. PG40/40, suites DB497/Worker603/Query473/
> Studio941, typecheck/lint/build y revisión 0P0/P1/P2 cerrados. UI UAT conserva 32 Topics de 32/357,
> dos seleccionados/98 asociaciones y evidencia navegable a 6,826 Menciones; cero actividad o costos
> nuevos. Leer `docs/product/PROMPT_LOOPING/DELIVERY_TOPIC_WORKING_SERVING_SEPARATION_UAT_2026-09-11.md`.
> Siguiente corte: política autoservicio de procesamiento y presupuesto para una marca nueva, sin
> activar proveedores. National sólo valida compatibilidad. No repetir SQL0154/imports/Voyage/fit/gates.

> **Catálogo de trabajo vs. operativo en desarrollo LOCAL — 2026-09-11 11:55 UTC.** Base UAT
> `c1e40d3`, docs `866e0d9`. Objetivo: create/update/archive/restore de Topics guardan versiones
> editoriales sin ejecución, outbox, gasto ni proveedor; Signal e incremental conservan el perfil de
> la última generación válida hasta recomputación explícita. Revalidar actor/org/brand/workspace/grant
> bajo lock y añadir CAS a lifecycle. Leer
> `docs/product/PROMPT_LOOPING/PLAN_TOPIC_WORKING_SERVING_SEPARATION_2026-09-11.md`. Si se requiere
> SQL, usar 0154 nuevo y mantenerlo LOCAL hasta gates compuestos; no modificar ni reaplicar 0148–0153.
> National es compatibilidad, no objetivo. Cero proveedores, imports o fit durante este corte.

> **Alta de marca y entrada cliente activas en UAT — 2026-09-11 11:52 UTC.** Studio y Worker
> ejecutan `c1e40d387c4a3679a67ee01060e509e561dcf0b7` (deployments Studio
> `[identificador privado]`, Worker
> `[identificador privado]`). `client_admin` activo puede crear marca/workspace/contexto/
> KB/concesión en una transacción y gestionar Brand OS, varias KB y competidores dentro de su
> organización. La entrada cliente a Datos usa `can_import_mentions` y oculta configuración, queries,
> promoción y ejecución. Session/org-sync no crean, restauran ni amplían grants; revocación y aislamiento
> siguen fail-closed. 936 tests, typecheck, lint sin errores, build y revisión 0P0/P1/P2 cerrados. QA UAT
> conserva National: 16 archivos, 9,131 filas, 7,396 únicas, 6,826 preparadas, 20,821 fragmentos y 32
> Topics de 32/357; recibo posterior 0/0/0/0 proveedores. Leer
> `docs/product/PROMPT_LOOPING/DELIVERY_CLIENT_BRAND_SETUP_IMPORT_UAT_2026-09-11.md`. No se creó marca
> ficticia ni se alteró un rol real. Siguiente corte: edición manual de Topics separada de recomputación,
> cola y proveedores; después experimento real con marca/corpus elegidos por el operador. No reaplicar
> SQL0153, no repetir imports/Voyage/fit/gates, no Opus ni producción.

> **Recuperación reusable de Topics activa en UAT — 2026-09-11 11:08 UTC.** Studio y Worker
> ejecutan `19e2f321286b4bf578f975bb4db54f5a1270a1ea`. National conserva 32 Topics, 32/357
> grupos y sus recibos; Brand Context faltante/obsoleto ahora aparece como paso reparable y una
> ejecución histórica ya no activa polling ni bloquea sucesoras. Datos conserva 16 archivos,
> 9,131 filas, 7,396 menciones únicas y 6,826 preparadas; el monitor reconcilia una importación
> que terminó antes de su primera lectura sin ciclo de refresh. Checks completos, build y revisión
> cerrados sin P0/P1/P2. Recibo SQL posterior: 0 preparaciones, 0 corridas semánticas, 0 Voyage
> y 0 interpretación. Leer
> `docs/product/PROMPT_LOOPING/DELIVERY_WORKSPACE_RECOVERY_UAT_2026-09-11.md`. SQL0153 ya
> estaba aplicado: no reaplicar. Siguiente corte local: alta de marca propia y Brand OS para
> `client_admin`, con organización derivada de sesión, creación atómica y sin Admin global,
> ejecución Topics ni gasto. No repetir imports, Voyage, fit o gates cerrados.

> **Brand Context → Topics activo en UAT — 2026-09-11 10:31 UTC.** Studio ejecuta
> `9e88bb5ec37e24cc3a592799839e987c1cb77ca4` (deployment
> `[identificador privado]`) y Worker conserva `44eeab5` (deployment
> `[identificador privado]`). SQL0153 se aplicó y verificó una sola vez: no
> reaplicar. Nueva marca tiene zona IANA buscable, KB automática y múltiples KB; Brand OS
> prepara contexto automático y Topics exige su versión vigente. El drift histórico
> `brand_os_snapshot_required/stale` ya es recuperable por UI; auth/red/locale/mercado siguen
> cerrados. Recibo posterior: cero operaciones `prepare-brand-context`, cero corridas Claude y
> cero corridas Voyage vinculadas. Leer
> `docs/product/PROMPT_LOOPING/DELIVERY_BRAND_CONTEXT_E2E_UAT_2026-09-11.md`. Siguiente: un
> experimento real con otra marca por UI hasta Topics/importación/cómputo/Signal. National es
> descartable y no tiene lógica propia. No producción, no Opus y no repetir SQL0153 ni gates.
