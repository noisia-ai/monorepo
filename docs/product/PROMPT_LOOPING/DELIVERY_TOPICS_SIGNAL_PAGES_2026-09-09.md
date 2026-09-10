# Topics, asociaciones y Signal — entrega focal 9 septiembre2026

Corte LOCAL cerrado `147b0fb91d29f035c556ab427460196c68d743fa`, sobre8b14383. UAT todavía8b14383 al escribir esta sección; el recibo remoto posterior determinará qué quedó activo. Continúa el Compass y la ventana de ocho horas; no repite importación, embeddings, fit ni SQL0144.

## Resultado de producto

Los Topics descubiertos presentan las asociaciones verificadas por el análisis y el acceso a Signal después de una selección confirmada. Conservan edición, archivo, recuperación de solicitud y guardas de significado; no exigen el flujo de búsqueda de un interés manual. El número de menciones sólo aparece con generación y definición vigentes. Resumen y Topics en Signal leen la misma selección, generación, conteos y cobertura editorial;32/357 permanece parcial.

La proyección guarda prefijos completos de hasta128 raíces en una transacción, con fragmentos paginados y un CAS de cursor. Se conservan operaciones/recibos por raíz, fuente computada, correcciones humanas y las guardas SQL existentes. Una respuesta de commit perdida se recupera desde el cursor durable. Ningún fragmento, Topic o decisión se trunca para caber:8MiB limita cada transporte y una raíz individual que excede falla explícitamente. La lectura de correcciones aplica ese presupuesto en SQL antes de hidratar Node.

El export conserva un centinela adicional cuando el cursor pertenece a una raíz ya terminada; evita que una página llena de menciones cortas se marque falsamente como EOF. La prueba focal demuestra exactamente esa frontera, limit1 y EOF real, sin afirmar un benchmark de exportación completa.

## Código y verificación

- `0b2d2c8`: Resumen/Topics nativos, nueve archivos ya cerrados en DELIVERY_SIGNAL_NATIVE_SUMMARY_LOCAL_2026-09-09.md.
- `aa4d4a12463a41f21eed0d52beabdd6ef64b4f88`: cinco archivos de UX de descubiertos.35tests focales,18 comprobaciones Chromium, ES1280/EN390 sin overflow; Root inspeccionó las capturas.
- `cfe58feb8f0ba0d903cba13442431c4ad890b3dd`: cuatro archivos del adapter incremental numérico real. Tres oleadas completas locales;11PythonPASS,444QueryPASS, revisión independiente sinP0/P1/P2. Todavía sin consumidor DB/colas/Signal: no declarar monitoreo automático entregado desde estos archivos. Recibo `.data/workspace-incremental-2026-09-09/RECEIPT.md`.
- `147b0fb91d29f035c556ab427460196c68d743fa`: nueve archivos DB/Worker/tests de proyección paginada y centinela del export.

Snapshot exacto de los18 archivos nuevos en `/Users/brandhon_o/Downloads/noisia-e2e-projection-pages-check-2026-09-09`, base0b2d2c8. Typecheck11/11 y lint11/11 PASS;13warningsprevios. DB235PASS/72SKIP, Studio739PASS/6SKIP, Worker377PASS/5SKIP, QueryEngine444PASS/0SKIP. Los dos errores iniciales de pruebas por DATABASE_URL ausente en el snapshot se resolvieron con configuración local ficticia; no fue cambio de producto. BuildPASS con DB local y credenciales ficticias de construcción; la primera pasada descubrió que faltaban variables Kinde de build. Ninguna credencial real se copió al snapshot.

PG focal:4casos PASS, incluyendo3raíces/133fragmentos, humana aprobada+5membresías computadas pendientes, dos páginas de chunks/un commit, cierre y replay; compare exacto contra escritor anterior excluyendo IDs/tiempos aleatorios. Prefijo, presupuesto, autoridad, correcciones, asignación inválida al final de página y ACK perdido conservan atomicidad. Regresión EOF focalPASS con384fragmentos, frontera demostrada de128raíces cortas tras cursor terminado, limit1 y EOF desde metadata real. Revisión independiente helper/DB/Worker:0P0/P1/P2 pendientes. SQLsin cambios.

Medición local sobre las mismas1,024raíces/2,048membresías/32Topics sintéticos:77.43s→8.04s y61,337→3,293consultas, incluyendo comprobación de censo completo de50,002raíces/55,519fragmentos; la proyección del benchmark se corta intencionalmente en1,024 y revierte.456consultas corresponden a las ocho páginas; el resto incluye preflight/heartbeats. La medición precede el último límite SQL de hidratación, cuyo gate final es PGtiny. No se promete esa tasa en UAT.

## Límites y continuidad

El intento adicional de export completo de la fixture grande alcanzó40,800raíces/40,960fragmentos antes de entrar en un documento individual enorme con extracción UTF16 costosa (>64s por consulta). Root canceló sólo su consulta local y confirmó rollback. No se declara PASS de ese benchmark ni se cambia la función SQL de extracción en este corte. La limitación se conserva como pendiente de escala en NOI-78; no es razón para recortar textos o usar muestras en producto.

El ledger Claude sigue USD1.918865 confirmado +USD1.6818 reserva histórica; nuevo gasto0. VoyageUSD0.594449 intacto. Permiso Claude del8sept vencido, sin nueva respuesta monetaria; Sonnet4.6 elegido, sin Opus. UATmantiene la misma engine4c55af5c y proyección dc8758ed. El siguiente paso remoto es comprobar despliegue, continuidad de esa proyección y selección UI→Signal/citas. No iniciar otro análisis ni cambiar fechas de admisión.

Backend e Import continúan el consumidor incremental con padre/modelos autorizados, descriptor sellado, artefactos de universo actual y checkpoint numérico separado. `relations_status=none` de una oleada sólo significa que no nacieron relaciones nuevas ahí; no resuelve el backlog editorial heredado. Scheduler durable, política de monitoreo, interpretación nueva y nueva carga real siguen pendientes.

## Envío08:56UTC

Push exacto147b0fb confirmado a `codex/noisia-topic-results-uat-2026-09-06`; ambos servicios se verifican a continuación. Recibo UATantes:08:53:34.508, misma proyecciónrunning1804/6826,317membresías/312raíces/30Topicsconmembresía; ledger15calls intacto. NoSQLnuevo. La siguiente evidencia debe probar mismoID/generación y cursor conservado, seguido de UI→Signal.

## UAT runtime and recovery — 09:08 UTC

Studio147b0fb deployed and verified by read-only runtime observer. Worker147b0fb built but restart preflight still had first-release `empty-cut`, which rejects the preserved pending projection. This is a runtime configuration diagnosis, not a failed batch computation. Exactly one executable job exists across the five isolated UAT queues: the same projection dc8758ed, now1,975/6,826 roots,353 memberships/348 roots/30 Topics. No new provider calls;15 total, USD1.918865confirmed plusUSD1.6818terminalreserve.

Using the operator's current autonomous UAT authorization, the existing reviewed recovery startup mode was selected: `NOISIA_UAT_STARTUP_MODE=recovery` and `NOISIA_UAT_RECOVERY_APPROVED=true`. Only these two variables are being deployed; isolated DB/Redis identities, namespaces, per-job authorization and provider expiry remain enforced. No queue deletion, new analysis, manual lease mutation or data change. Pending verification of the new runtime and continuation from the saved cursor. Private receipt: `.data/workspace-projection-performance-2026-09-09/uat-runtime-recovery-receipt.json`.

## Real E2E acceptance — 09:10–09:18 UTC

Worker recovery8a61006b is active on147b0fb, runtime variables verified; Studio4c3bcba6 also147b0fb. The SAME projection dc8758ed/generation8de2a60d reached ready6,826/6,826 roots at09:10:13UTC:1,231 memberships across1,203 roots and30 Topics. No analysis restart, corpus import, Voyage, fit or Claude send. Paid totals and expired admission are intact.

Root selected **Quejas de servicio al cliente en renta de autos** explicitly through Topics UI. The original request briefly showed pending ACK, then confirmed without a duplicate selection. Its63 calculated members appear in native Signal Topics and Summary, with6,826 period denominator,0.9%,1,283 without stable group and5,333 with unresolved conversations. The latter is a multilabel state and can overlap selected memberships. Evidence opens original texts with date/source links. Semantic precision is explicitly uncalibrated; Signal visibly reports32/357 interpreted groups. This is a real partial result, not complete interpretation, narratives, insights or autonomous incremental monitoring.

Private receipt `.data/workspace-projection-performance-2026-09-09/uat-signal-real-receipt.json`. Next implementation remains the frozen-model incremental consumer and automatic new-input orchestration. Do not repeat this acceptance,0144, imports, embeddings or fit. New provider usage remains unauthorized after the old daily expiry.
