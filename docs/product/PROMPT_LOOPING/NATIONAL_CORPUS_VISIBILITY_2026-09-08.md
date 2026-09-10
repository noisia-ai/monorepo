# National: corpus recibido visible y salida del ciclo de importación

## Resultado vigente — aceptado en UAT, 8 septiembre 2026

Studio y Worker activos con el mismo commit **65926c02d7b008b32b2faad21b22e2c4e903c113**; referencias exactas verificadas en Railway. Studio `fd98f69c-b929-4258-b2f5-8111b2fbafca`; Worker `9f2b99f7-7afa-4831-956a-587c7905b6d2`. El P2 de latencia de este resumen queda cerrado: GET desde **Actualizar** HTTP200 en **937.204 ms** hasta cabeceras, Server-Timing acceso 435.4 ms y corpus 397.7 ms. Antes: 33,102.285 ms, corpus 32,774.4 ms. No es un SLA ni una medición de carga completa de todas las pantallas.

La UI conserva **16 archivos, 9,131 filas, 7,396 menciones únicas y 7,395 con texto disponible**. Desglose: 6,826 incluidas, 570 excluidas y 1,735 duplicadas; 7,648 observaciones; 6,826 con derechos de análisis externo, 0 con atribución semántica verificada. Las raíces únicas incluyen las excluidas. No hubo nuevas cargas, reparaciones ni clasificación. Los ocho contadores de inconsistencia permanecen en 0.

Recarga final: panel recibido, botón libre, conteos conservados, sin nuevos errores de consola; viewport normal restaurado. La UI del corte conserva pruebas de fallo 503/403, navegación Topics→Datos#corpus-readiness, espaciado en escritorio y DOM responsive 390/740 sin overflow. ES/EN se comprobó en SSR local; no se presenta como screenshot EN remoto. Interceptaciones y override retirados, consola UAT cerrada tras ROLLBACK.

Validación final: typecheck/lint raíz 11/11 (15 warnings existentes, 0 errores), DB 223 pass/30 skip; los opt-in PG de contrato y rendimiento sí se ejecutaron y pasaron por separado. Studio 592 pass/5 skip y build verdes en 222d204, retenidos después del cambio exclusivamente SQL; Railway compiló el corte final. No DDL, ANALYZE remoto, datos modificados, proveedores ni gasto. Los tres contract-drafts ajenos conservan hashes y están fuera de todos los commits. Secuencia focal: 2e81a47→c08005e→222d204→65926c0; recepción y gates históricos no se reabrieron.

**Siguiente resultado de producto:** preparación workspace-native completa y reanudable, después clasificación/descubrimiento incremental según Compass (NOI-31/78). Este GET sólo acredita recepción y disponibilidad. No crear corpus legacy artificial ni llamar BERTopic/Claude a una pantalla de conteos. La pregunta de zona SentiOne sigue pendiente; no repetirla ni reparar fechas por suposición. Producto USD 11.362961 y Advisor USD 1.343826 conservados. Linear y loop mantienen el trabajo restante abierto.

## Integración y diagnóstico — historia conservada

## Corte focal y corrección de rendimiento en entrega

Commit `2e81a475d54b22812ee6d040f132223d2fc7cd0e`,16archivos focales sobre UAT2c2e3f4. Push exclusivo a codex/noisia-topic-results-uat-2026-09-06. Studio y Worker activos con HEAD exacto comprobado; la aceptación remota detectó una demora material en la consulta del resumen. El operador ya puede acreditar16archivos/9,131registros, pero Topics devuelve «Importar menciones» incluso cuando su estado es needs_preparation. Datos, a su vez, devuelve a Topics. La cantidad de menciones gobernadas de la cabecera no demuestra cuántas menciones canónicas se recibieron.

Este corte añade una consulta agregada por workspace y una vista compacta del corpus recibido en Datos. Topics apunta a esa vista cuando necesita preparación; sólo pide archivos cuando no recibió ninguno. Los conteos distinguen filas de archivo, disposiciones y raíces actuales. No crea un estudio legacy, no publica ni ejecuta modelos.

## Contrato que se implementa

GET `/api/data-os/signal/{workspaceId}/corpus/readiness`, respuesta privada no-store y permisos DB-owned can_view después de resolver el acceso al workspace. Una consulta SQL agregada usa un único snapshot, sin devolver texto de menciones ni IDs de originales. Sólo las importaciones aceptadas contribuyen al universo, no los intentos fallidos o duplicados terminales.

La igualdad de los contadores de archivo (leídos = incluidos + excluidos + duplicados) es diferente de la cantidad de observaciones y raíces. Los duplicados internos pueden existir sólo en el original y en contadores; una diferencia frente a observaciones no se etiqueta como pérdida. La intención de captura no se convierte en aprobación semántica.

Derechos: el conteo de análisis externo evalúa una ruta completa vigente para llm-processing, con fuente/licencia/retención compatibles y precedencia de binding por import. No acredita derechos de serving. Texto disponible significa texto almacenado no vacío; no acredita lectura computacional completa ni fidelidad contra el archivo raw.

El DTO incluye observed_at, sello UTC de statement_timestamp con seis decimales, para evitar que un SSR tardío sobrescriba un GET más reciente. No es una versión de población ni un manifiesto de análisis. Respuestas401/403/404 retiran el resumen; fallos de red/servidor conservan el último resultado con aviso.

No hay comando de preparación en este endpoint. La UI no inventa queued/running/ready ni un botón que no tenga Worker. Estado de búsqueda del catálogo y editor conservados. Se conserva el último resultado visible ante fallo de lectura; refresco de uploads y reintento usan lecturas reales.

## Siguiente runtime y deuda existente

El clasificador de Topics todavía resuelve un operational study_corpus y excluye las nuevas raíces workspace-owned sin study_corpus_id. El job legacy embed_corpus_semantics limita50k menciones y utiliza el primer chunk900; el helper chunkForEmbedding además limita80chunks. No es una preparación completa. No crear un corpus artificial para aparentar compatibilidad.

NOI-31/NOI-78 conservan procesamiento completo e incrementalidad. La siguiente implementación necesita una ejecución workspace-native con snapshot por import/contenido/derechos, paginación/checkpoint y manifiesto completo de texto, seguida por embeddings y clasificación; cola DataOS existente. Los ledgers actuales de governance/classification no admiten checkpoint mutable y los outboxes tienen FK a sus ejecuciones específicas: no alterar sus invariantes como atajo. Una tabla focal de preparación con su propio estado de dispatch es opción delimitada, no un framework nuevo. Debe verificarse ante reinicio/cambio de corpus antes de habilitar un botón de ejecución.

## Operación y verificación

Backend: reader y pruebas unitarias. Frontend: panel/copy/montaje. Import: regresión PostgreSQL independiente. Root: acceso/API, integración, recibos y entrega focal. Tres contract-drafts previos fuera del corte. Pruebas sintéticas sólo en PostgreSQL local; National se consulta sin mutar. Zona de SentiOne pendiente; no se repite la pregunta ni se corrigen fechas por suposición.

Checks finales: root typecheck y lint11/11 (15 warnings previos, cero errores); Studio592pass/5skip; DB223pass/29skip. La prueba PostgreSQL opt-in específica se ejecutó y pasó1/1 con SQL final y BEGIN READ ONLY; los skips generales no sustituyen ese recibo. Build exit0; verificación UAT pendiente. Una primera pasada detectó una importación directa de pool en la API, contraria al límite arquitectónico comprobado por live-intelligence.test; se movió al servicio de producto manteniendo guardas, sin debilitar el test. La pasada posterior completa ya está verde. No afirmar cómputo, BERTopic, Claude o Signal. Sin gasto nuevo; saldos productoUSD11.362961 y AdvisorUSD1.343826. Canon, Compass, plan y recibos anteriores conservados.

Pruebas PG: dos fuentes sobre misma raíz, raw4=included1+excluded1+duplicates2 con tres observaciones/dos raíces; intento fallido parcial y otro workspace excluidos; source_intent no equivale a semántica; aprobación por funciones canónicas sí; revocar fuente de la assertion retira semántica aun con otra ruta autorizada para el mismo root; retención específica expirada prevalece. Recibo privado corpus-readiness-pg.md y corpus-readiness-run.log. No proveedor, Worker ni fixtures en UAT.

## Corrección de rendimiento — c08005e, aceptación UAT pendiente

QA remoto comprobó los conteos reales pero la carga y el refresco tardaron decenas de segundos; no se obtuvo una medición precisa de esa latencia. El CTE de elegibilidad repetía un cruce de todas las rutas por cada raíz. En PostgreSQL local con 16 imports y 10,000 raíces, EXPLAIN pasó de 2,947 a 94.7 ms y lectura de 1,273 a 55.5 ms; 20 aggregates idénticos comprobados por un segundo agente. Estos tiempos locales no son un SLA remoto ni prueba de millones de registros.

Hotfix c08005e6f648c3e0a097204eeeb362b74cb2b9c9: agrupar las rutas ya autorizadas una vez, manteniendo atribución sobre la misma ruta workspace/root/import/source. Sin DDL, cambios de política, límites o datos. Regresión opt-in PG detecta trabajo cuadrático sin depender del reloj; performance 1/1 y contrato 1/1 ejecutados, 6 unitarias y root typecheck/lint 11/11. DB completa 223 pass/30 skip (la opt-in nueva se ejecutó separadamente). Los tres archivos ajenos conservan hashes originales. Recibo causal privado corpus-readiness-performance-review.md.

QA del componente en navegador: respuestas simuladas 503 conservan el último resumen con aviso; 403 retira los conteos. Interceptación retirada después de cada caso. Esto no sustituye las pruebas reales de autorización de API/PG. Restaurar respuesta real y completar QA tras el despliegue.

### Verificación c08005e: rendimiento todavía no aceptado

Studio f06ef7ac-5e4e-4b3e-a1df-17c7137e2d99 y Worker cc7ca403-cc35-437c-a4d1-0ba044a090c5 activos; enlaces de commit exacto comprobados sin leer variables. El GET real HTTP200 midió 34,379.083 ms hasta cabeceras mediante CDP. Los conteos se conservan, sin errores nuevos de consola, pero la demora sigue siendo P2 abierto. Se restableció la instrumentación CDP que tenía eventos obsoletos; esta medición sí es exacta.

Siguiente diagnóstico: fixture local con una fuente compartida por16imports, raíces incluidas/excluidas y duplicados entre archivos, como National. Root añade Server-Timing con dos duraciones numéricas tras autorización para separar resolución de acceso y lectura del corpus. Frontend corrige espaciado con admin-section__body/admin-drawer-form existentes. No declarar aceptación de velocidad ni hacer cambios por sospecha sin evidencia causal.

Diagnóstico adicional enviado en222d204: Server-Timing privado con access/corpus (sólo duraciones numéricas tras autorización) y padding del panel con primitives existentes. Root typecheck/lint11/11, Studio592pass/5skip y build verdes. La distribución local exacta de National responde en49ms; no se modificó SQL sin una segunda causa. Root accedió a la consola del servicio Studio de Railway UAT para EXPLAIN ANALYZE bajo BEGIN READ ONLY y statement_timeout60s, validando environment/service y brand antes de la consulta. Credenciales permanecen dentro del entorno del servicio; no se extraen ni imprimen. Recoger resultado y cerrar transacción antes de otra acción.

### Causa remota confirmada, sin ANALYZE ni mutaciones

222d204 Studio97eb3485-3fe9-41a6-95fa-262b085cb982 activo y HEAD exacto comprobado. El primer diagnóstico read-only fue interrumpido por sustitución del contenedor; conexión cerrada, transacción descartada. Segundo diagnóstico terminó DIAG_STATUS complete y ROLLBACK: conexión202ms, EXPLAIN46,654.82ms, planning4.394ms, sin JIT reportado. roots37,895.592ms; CTE links7396loops×3823rows; menciones7396loops×3698rows; eligible8,717ms.

EXPLAIN estimado posterior (sin ejecución) confirma uq_mentions_workspace_id filtrando sólo workspace_id, estimación1fila frente a7396reales; links estima2. Estadísticas: mentions170241live/7396modificadas y memberships249711live/9545modificadas, ambos last_autoanalyze20agosto; observaciones58289live/4168modificadas, last_autoanalyze8sept06:00. National nuevo no alcanzó actualización automática. No corregir con una operación manual recurrente: Backend prepara un SQL resistente a estadísticas previas mediante acceso porPK parametrizado, metadatos canónicos en links y agregaciones. Se comprobará propuesta readonly sobre UAT antes de commit.

### Propuesta comprobada en UAT — integración final en curso

SQL candidato SHA256 d77676ec4e48a4be1a2965ba2efc7cfe44e26072ce23d0e2fe4cda28f79e1aeb medido por root desde la consola conectada de Studio UAT, validando environment=uat, service=studio-uat y marca National. Transporte comprimido sólo del SQL revisado, checksum verificado antes de conectar; no credenciales trasladadas. BEGIN READ ONLY, timeout60s, EXPLAIN ANALYZE y SELECT agregado, ROLLBACK completo. Ningún ANALYZE, DDL ni cambio de datos.

Plan anterior46,654.82ms → candidato750.934ms; planning7.452ms; conexión212ms. links651.169ms, roots657.337ms, una pasada. SELECT posterior conserva los20agregados: 16/9131/6826incluidas/570excluidas/1735duplicadas/7648observaciones/7396raíces/7395con texto/6826derechos/0semánticas; ocho códigos de inconsistencia en0. Root autorizó integrar exactamente ese candidato y reforzar la regresión de plan frente a estadísticas previas. Aún falta commit/despliegue y GET final.

222d204 medido aparte por GET: HTTP200, cabeceras33,102.285ms; Server-Timing access259.8ms y corpus32,774.4ms. Acceso no causó la demora. QA visual del padding16px pasó en escritorio; DOM390px (1columna) y740px (2columnas), ancho del documento igual al viewport; override retirado. Topics needs_preparation abre Datos#corpus-readiness. No se afirma captura visual móvil ni render EN remoto; ES/EN están cubiertos por pruebas SSR locales.

### Corte final enviado:65926c0

Commit65926c0 sobre222d204 integra exactamente el SQL candidato comprobado. Root typecheck/lint11/11 (15warnings previos); DB223pass/30skip; Studio592pass/5skip y build de222d204 retenidos al no cambiar UI/tipos/API después. ContratoPG final1/1 y rendimiento10k1/1 + National fresco1/1 ejecutados sin skip; unidades6/6. Fixture nueva local sin ANALYZE no reprodujo la mala estimación remota (baseline78.502ms/candidate71.903ms, conteos idénticos): se declara ese límite; la evidencia causal es el plan real UAT. Regresión ahora mide scans de menciones además de CTE y rechazaría27M frente al techo244736 de National. Tres archivos ajenos conservan hashes. Pendiente solamente confirmar nuevo deployment y GET final para cerrar esta aceptación.
