# Noisia: relevo completo a un chat nuevo

> Continuidad 8 septiembre: carga/preparación National y UATae3e36c comprobados. Persistencia de clasificación cerrada sólo localmente en92d5d0a; [recibo actual](./DELIVERY_WORKSPACE_CLASSIFICATION_LOCAL_2026-09-08.md). Leer STATE/CURRENT/NEXT antes de elegir trabajo. Siguiente motor semántico/discovery real e incrementalidad, sin reabrir gates ni confundir pruebas simuladas con análisis. El handoff original inferior se conserva como historia.

> **Contexto ampliado el 2026-09-07:** conservar este handoff completo como historia.
> La sección 13 agrega el compass self-service aprobado y la continuidad posterior;
> leerla con STATE/CURRENT/NEXT antes de ejecutar las tareas del corte original.

Fecha del corte: 6 de septiembre de 2026, aproximadamente 20:50 CST / 7 de septiembre 02:50 UTC.
Solicitado por el operador para salir de una conversación demasiado larga y de una dinámica que percibe como cíclica.

## 0. Leer esto primero

**No empezar desde cero. No volver a los gates de locale, autenticación, Docker, importación ni a generar otros diez candidatos porque se perdió el hilo.** Hay código, resultados reales, migraciones de producto desplegadas y evidencia conservada.

La próxima entrega útil es: **abrir un candidato en UAT, obtener una regla sugerida automáticamente desde Brand OS y sus menciones, editarla, probar qué encuentra y evaluar la relevancia de esos resultados.** No basta con contar tests o anunciar otro gate técnico.

La tarea actual de este chat termina en **handoff**, no en una nueva implementación. La automatización anterior fue pausada con la herramienta de la app, sin borrarla, para evitar dos orquestadores. El nuevo chat debe asumir la coordinación explícitamente antes de reactivarla/reubicarla.

- Chat origen en la app: **Frontend**, ID `019fe269-5dc2-7272-a74b-cab6a2443173`. El nombre es histórico: actualmente orquesta Backend, Topics, QA y releases.
- Chat Backend preservado: **Backend**, ID `019fc5c7-fa57-7573-83d4-2f8e9303942f`. No asumir que está ejecutando trabajo por tener este ID.
- No se creó un chat nuevo: el operador dijo que él lo abriría.
- No se borró ni modificó ningún historial original de Codex.
- Este corte no hizo commits, push, deploy, llamadas a Claude, migraciones ni escrituras UAT.

## 1. Historial completo disponible en la Mac

Exportación privada, legible, sin imágenes/audio/video en base64, sin instrucciones internas del modelo ni razonamiento privado y con redacción de credenciales:

`/Users/brandhon_o/Downloads/noisia-website/.data/handoffs/2026-09-06-new-chat/INDEX.md`

Dentro de esa carpeta:

- `frontend/dialogue/*.md`: mensajes de usuario y respuestas visibles de ESTA conversación, cronológicos y sin truncar texto ordinario. Leer en orden de archivo.
- `frontend/tools/*.jsonl`: llamadas y resultados de herramientas de ESTA conversación, sanitizados, separados para consulta técnica por fecha/línea original.
- `backend/dialogue/*.md` y `backend/tools/*.jsonl`: respaldo adicional del chat Backend, con el mismo criterio.
- `manifest.json`: fuentes exactas, SHA-256 de los prefijos leídos y de cada fragmento, tamaños, fechas, conteos y redacciones.
- `export-history.mjs`: conversor local reproducible. Sus destinos usan creación exclusiva: no ejecutarlo de nuevo sobre la misma carpeta.

Cobertura comprobada de los archivos presentes en disco:

| Fuente | Periodo | Mensajes | Herramientas | Errores de parseo |
|---|---|---:|---:|---:|
| Frontend, esta conversación | 2026-08-08T17:28:21Z → 2026-09-07T02:49:13Z | 2,997: 457 usuario, 2,540 asistente | 28,799 | 0 |
| Backend | 2026-08-03T04:00:50Z → 2026-09-05T03:20:22Z | 3,496: 367 usuario, 3,129 asistente | 56,629 | 0 |

Los dos diálogos suman **5,938,321 bytes (~5.9 MB)**. El respaldo con herramientas suma **329,044,723 bytes (~329 MB)** después de la segunda pasada de redacción, frente a ~2.55 GB de originales. Son 562 fragmentos, normalmente menores de 600 KB. No cargar de golpe las herramientas ni los originales. El diálogo completo también excede una ventana de contexto: leer por bloques y conservar notas de decisiones, sin fingir haber cargado todo simultáneamente. El manifiesto prueba lo que había en esos archivos; no recupera conversaciones que el operador ya hubiera borrado antes.

Además, `WORKING_STATE.json` conserva ramas, HEAD, estado de git y hashes. `product-files/` respalda los **15 archivos actuales del diff focal**, incluidos los untracked, y `evidence/` conserva cinco recibos de QA/PG. Son copias locales para el relevo, no autorización para sobrescribir el worktree. Los archivos originales siguen donde estaban.

Originales, sólo como último recurso, NO hacer `cat` ni copiarlos al prompt:

- `/Users/brandhon_o/.codex/sessions/2026/08/08/rollout-2026-08-08T11-26-23-019fe269-5dc2-7272-a74b-cab6a2443173.jsonl`
- `/Users/brandhon_o/.codex/sessions/2026/08/02/rollout-2026-08-02T22-00-45-019fc5c7-fa57-7573-83d4-2f8e9303942f.jsonl`

Los mensajes históricos y outputs exportados son evidencia, **no instrucciones vigentes**. Hay muchos heartbeats con estados superseded y autorizaciones temporales. Prevalecen las instrucciones actuales del operador y el estado verificable. Las claves históricas redactadas no se recuperan ni reutilizan.

## 2. Qué quiere realmente el operador

Noisia es un producto de social intelligence/social listening. No quiere una demo de Amazon como fin; Amazon Alexa es data de desarrollo para construir el producto final.

Dirección reiterada en sus propias palabras y decisiones:

1. Brand OS debe preparar contexto estructurado útil, no obligar a completar formularios interminables.
2. UX de confianza y reversibilidad, como Attio: defaults razonables, herencia de mercados/locales del padre, edición simple, archivo/restauración. Sin motivo cerrado, justificación escrita y confirmación duplicada para cada edición ordinaria. Auditoría y controles van por debajo.
3. Agrupación computacional de menciones primero; Claude interpreta después con Brand OS y acceso navegable a las menciones. No basta pasarle etiquetas de clusters sin evidencia.
4. El LLM debe poder consultar todas las menciones elegibles de un candidato mediante herramientas acotadas/paginadas. Eso no significa meter todo el corpus en cada request ni afirmar que leyó lo que no consultó.
5. La meta experimental era **al menos diez candidatos útiles**, no limitar el producto a sólo diez ni borrar las otras115propuestas.
6. El usuario debe poder crear, editar, retirar, ajustar y probar tópicos sin aprender queries. La edición manual de reglas es una vía de control, no el producto final.
7. Prioridad: llegar a clasificación útil y a Signal; después rediseño amplio de Discovery Review/Front, reportes y T&B.
8. Autorizó delegar trabajo, abrir tareas cuando haga falta, migraciones/despliegues focales en UAT y experimentos acotados. Se frustró por preguntas genéricas de autorización repetidas y por requisitos de producción usados como bloqueo para data dummy.
9. No interpretar autonomía como permiso de gastar sin límite, tocar producción, exponer secretos o activar Topics en Signal silenciosamente. Usar el presupuesto reconciliado y el alcance actual.
10. Quiere resultados visibles, explicaciones sencillas y conclusiones de experimentos. Un plan, un manifest o una suite verde no son por sí solos un producto entregado.

La última petición antes del handoff fue saber qué está en UAT/local y dónde estamos en el plan. Se respondió con la distinción de las secciones siguientes. Luego pidió explícitamente este relevo porque considera que el orquestador está demasiado ciclado.

## 3. Dos carpetas: no confundirlas

### Repositorio principal / documentación / evidencia privada

`/Users/brandhon_o/Downloads/noisia-website`

Rama: `codex/noisia-data-os-cut-1-uat-2026-08-18`. HEAD: `ddb8cb0e2a63168a4f16129caa2226404b68b0b3`.
Tiene MUCHOS cambios previos del operador y del laboratorio, tracked y untracked. **No hacer `git add -A`, reset, checkout destructivo ni limpieza.** No desplegar esta carpeta en bloque.

Contiene:

- `docs/product/PROMPT_LOOPING/`: estado/planes/bitácora.
- `.data/signal-topic-evaluation/`: resultados, comprobantes privados, runners y fixtures.
- `.data/topic-rule-suggestion-ui-qa/`: QA actual del componente real con transporte simulado.
- `.data/handoffs/2026-09-06-new-chat/`: esta exportación.

### Worktree focal de producto

`/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`

Rama: `codex/noisia-topic-cohort-ui-2026-09-06`.
HEAD local: **`e4db7ba9622e0a816bc0f06a53d456c74de2ccb3`**.
Encima hay el diff local C-UI todavía **sin commit**. Ésta es la carpeta para completar el código focal. Pasar `workdir` explícito a todos los comandos.

Commits recientes, del más nuevo al anterior:

- `e4db7ba`: recibos de sugerencias locales y puente reversible al borrador.
- `9adee218b26d068b6bbff5bf79ad9b20450e1027`: adaptador de sugerencia ligada a evidencia.
- `d9a9ce78554407f4eba6532fff5827019d6bf1ed`: selección de catálogo y prueba conjunta, **último UAT**.
- `3e4708b9c6bae753ccef328cf7d24af03071b75f`: catálogo/cohort y pruebas léxicas conjuntas.
- `bd7dbf9`: editor de regla y resultados de prueba.
- `4e64dc4`: borradores de contrato y prueba léxica medida.
- `8739567`: citas exactas de candidatos.
- `dc48104`: editor e importación histórica reversible de los resultados reales.

## 4. Qué está realmente en internet/UAT

URL: `https://studio-uat-uat.up.railway.app/studio/brands/af11af41-343e-4b6a-ab98-0c37bf24e41d/brand-os`

- Studio commit **d9a9ce78554407f4eba6532fff5827019d6bf1ed**.
- Deployment Studio **3af84ebb-43c1-4d96-9816-21c548496b0c**.
- Workers conservado en commit **75f0873f0321b8f4cfb3e6105aefa5b2614784d5**, deployment **012026e1-3c63-4a63-87a0-e7df3f94ea99**.
- Health fresco **2026-09-07T02:30:26Z**, GET `/api/health?deep=1`, HTTP200, runtimeProfile `uat`, app/env/database/llm_provider/uat_identity `ok`. Es un health check de configuración, **no una nueva llamada al proveedor ni un nuevo censo de tablas**.
- Última reconciliación completa post-QA conservada: `5feead077afe9801d1c821c59de185abf058eae321024f2fb972809464dbcf31`.
- Diez candidatos pendientes/editables rev1, cero ediciones de esos candidatos en ese corte, una propuesta de refinamiento archivada conservada; corpus21195intacto.
- Citas:30originales más5del refinamiento, disponibles en el editor según sus derechos actuales.
- UI de Guardar borrador/Probar, filtros y selección de catálogo/prueba conjunta ya desplegada.
- QA autenticado UAT390/740/1280: carga, empty state, citas, refresh, Escape/foco; consola0,7GET200/0requests mutantes.
- No se guardaron en UAT las reglas/resultados de los experimentos locales517/8/1105. Las tablas de drafts/trials/cohorts quedaron vacías en la reconciliación de esa entrega.
- Ninguno de estos diez candidatos fue adoptado/publicado/activado en Signal.

Migraciones de producto ya entregadas en las fases previas:0115+0122, luego0123, luego0124. No repetirlas ni importar todos los scripts/migraciones del laboratorio.
0124 SHA: **e510ca59a6f444990d263d306a3ee5bbac1c3e19ef4bf29d3f472333ea76eff7**, aplicada una vez con ledger.
0125 existe para el puente de sugerencias, pero **sólo se probó localmente dentro de rollback, NO está aplicada en UAT**.

## 5. Resultados semánticos reales y límites

Corpus congelado: **21,195 registros únicos**,115propuestas históricas BERTopic,11,186asignados a clusters,10,009outliers/no agrupados. Algoritmo histórico `bertopic-bge-detail`, seed17. No se ejecutó una nueva corrida de BERTopic en los últimos cortes de editor/reglas.

LAB-2G produjo diez candidatos reconocibles usando agrupación histórica, contexto y evidencia. Se importaron a UAT; no siguen atrapados sólo en localhost. La revisión experimental fue favorable para diez candidatos, no una validación final de clasificación.

Temas actuales, etiquetas explicativas en español sin renombrar registros:

1. Alexa/Echo y campaña de fútbol en México.
2. Conversación cotidiana sobre Alexa en español.
3. Explicaciones del lanzamiento/despliegue de Alexa+.
4. Lanzamiento de Alexa+ en México.
5. Alexa+ frente a ChatGPT/Grok.
6. Rumores de HomePod/hub Apple.
7. Noticias/ofertas de Echo/Echo Dot.
8. Google Nest/Home con Gemini.
9. Listados/renovación de hardware HomePod.
10. Tendencias de bocinas/hogar inteligente.

Refinamiento real de un candidato:

- Modelo consultó8menciones representativas de56mencionesMX y propuso `Amazon Mexico Alexa/Echo World Cup 2026 Fan Campaign`.
- Tres llamadas internas,12,271tokens entrada/795salida, coste conocido **USD0.048738**, cinco citas guardadas.
- La propuesta existe; no alteró automáticamente el candidato ni publicó nada.
- Observaciones reales: había `#publicidad`; no llamar todo orgánico. Una función del Mundial aparecía en una mención consultada pero no en las cinco citas elegidas. No se acreditó autoría oficial del copy. Ocho menciones no prueban prevalencia en56. Esa llamada no probó lectura dedicada de Brand OS ni comparación de vecinos: no adjudicárselo retroactivamente.

Pruebas locales de reglas, PostgreSQL real con rollback:

- Se consideró el corpus21195, **también los10009outliers**, no únicamente menciones de clusters conocidos.
- FiltroMX:5121registros. Regla amplia Alexa/fútbol:517coincidencias. Regla campaña/hashtag específica:8coincidencias, varias promocionales repetidas.
- Prueba conjunta de dos reglas:517 y686,98compartidas, **1105únicas**,1007single/98multi/20090abstain; aproximadamente8segundos.
- Son **coincidencias léxicas**, no precision/recall ni1105menciones semánticamente correctas. No son nuevos usuarios independientes ni nuevas asignaciones persistidas en Signal.

El informe humano previo es `docs/product/PROMPT_LOOPING/RESULTADO_TOPIC_LAB_2026-09-06.md`. Su sección7 estaba desactualizada antes de este handoff; el estado actual se corrige aquí y en STATE.

## 6. Dónde encaja en el plan completo

Canon general: `docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md`, `55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md`, `56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md`, `63_NOISIA_V02_CANONICAL_PRODUCT_PROGRAM_AND_DELIVERY_LAYER.md`.

El documento63conserva una tabla de agosto que decía que no había candidatos; **no tratar esa tabla histórica como estado actual**. El programa10A–10H/11A–11D sigue siendo mapa de producto, no lista de gates para reabrir.

| Capa | Situación actual / trabajo que falta |
|---|---|
| Data OS + adquisición + Brand OS | Bases operativas y UAT; simplificación trust/revert ya trabajada. No regresar a67decisiones manuales de locale. Falta QA general de producto y operación recurrente. |
| Discovery computacional | Corpus completo y115propuestas históricas conservados. Nuevos benchmarks/challengers sólo si una conclusión de calidad los justifica. |
| Interpretación con evidencia | Diez candidatos y un refinamiento real; editor/citas en UAT. Relaciones entre candidatos y lectura suficiente no quedan automáticamente validadas. |
| Contratos/reglas y catálogo | Guardado/versionado/trial/catálogo existentes. **Actual: automatizar la propuesta de regla en el editor.** |
| Calidad y cascada/clasificación | Validar relevancia, falsos positivos/negativos, solapamiento/abstención; combinar léxico/embeddings/clasificador donde haga falta. No confundir conteo con calidad. |
| Persistencia e incrementalidad | Integrar con `signal_classification_generations/items/assignments` existentes (0087), una autoridad de clasificación, sin crear un profile activo por candidato ni otro almacén paralelo. Nuevos imports/drift todavía pendientes de este recorrido. |
| Signal governed | Conectar clasificaciones, denominadores, cobertura/generation/watermark y UI existentes; los diez candidatos aún NO alimentan Signal. |
| Producto completo | QA/polish Admin y Signal, T&B V2/review/coding workbench, reportes/entregables,11Acontrato,11Bartefactos,11CInsightsAgent,11DMCP, escala/SLO/producción. No afirmar que esos módulos están terminados por existir código o pantallas. |

El acceso de herramientas de Claude a menciones para interpretar candidatos no equivale al futuro Signal MCP11D ni obliga a crear un servicio MCP/framework adicional ahora. Reutilizar los readers y Workers existentes.

## 7. Gate actual: LAB-3E-C-UI, local, incompleto sólo en cierre

Plan exacto: `PLAN_LAB_3E_C_SUGGESTION_PRODUCT_INTEGRATION.md`.
CURRENT conserva este alcance. B cerró en e4db7ba. C-UI tiene implementación y pruebas muy avanzadas pero **no está committed, desplegado ni declarado CLOSED**.

Lo implementado: leer sugerencia/explicación/citas propias actuales; Usar copia lexical/filtros sin POST; editar scopes/idioma/país; guardar draft ordinario enlazado al recibo; restaurar una versión anterior como NUEVA revisión; Probar separado. No razones humanas adicionales. Mantiene CAS, derechos actuales, request/body/key/scope retenidos y protección frente a respuestas tardías.

`origin=local_fixture` se muestra **Simulación local**. Capacidad de generar falsa/honesta; NO hay un endpoint que reciba fixtures, botón de pago funcional, Worker de sugerencias ni nueva DDL de ejecución. No presentar QA simulado como IA ejecutada.

### Allowlist focal actual de15archivos en worktree de producto

Tracked:

- `apps/studio/messages/en-US.json`
- `apps/studio/messages/es-MX.json`
- `apps/studio/package.json`
- `apps/studio/src/components/brands/TopicCandidateRuleDraft.tsx`
- `apps/studio/src/lib/data-os/signal-topic-rule-draft.test.ts`
- `docs/api/openapi.yaml`
- `infrastructure/db/signal-topic-rule-suggestions.ts`
- `infrastructure/db/signal-topic-rule-suggestions.test.ts`
- `infrastructure/db/signal-topic-rule-suggestions.postgres.test.ts`

Untracked:

- `apps/studio/src/lib/data-os/signal-topic-rule-suggestion-management.ts`
- `apps/studio/src/lib/data-os/signal-topic-rule-suggestion-api.ts`
- `apps/studio/src/lib/data-os/signal-topic-rule-suggestion-product.ts`
- `apps/studio/src/lib/data-os/signal-topic-rule-suggestion.test.ts`
- `apps/studio/src/app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/candidates/[candidateKey]/rule-suggestions/route.ts`
- `apps/studio/src/app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/candidates/[candidateKey]/rule-suggestions/[receiptId]/draft/route.ts`

No nuevos cambios de CSS, dependencias, Workers, AuthZ niDDL en C-UI. El test ordinario viejo tiene un ajuste pequeño al final del fragmento de fuente que inspecciona, no un cambio de writer.

### Pruebas y auditorías ya terminadas: NO repetir todo por perder contexto

**A**:15focales/372QE,11typechecks/lintPASS, independienteP0/P1/P2=0. Adaptador puro con contexto acotado18KiB, candidato+Brand OS fijados antes del proveedor.

**B**:169DBPASS/28SKIP explícitos,11TC/lintPASS,15warnings previos. PG finalSHA **da118b2356f5ba266f7ee3f41e0f6e19903f5978d632975c6cc68d06f93d5557**,34checks,84lecturas,0DML/FTSdel reader,3revisiones,prueba acotada100ycatálogo2candidatos,22baselines idénticos después de rollback. 0125SHA **2f3561aa7e490b3ffe5b1f80a08310ddcbdb73795713d839670d45fead6d56ab**. Cerrado con auditoría independiente.

**C reader**: prueba real conservada en:
`.data/signal-topic-evaluation/lab-3e/suggestion-reader-proof-db4d85016be04e9ef0cc93f7ac7bd10effe593d8847fbc046a6dfcb8e9ad0768.json`

SHA **db4d85016be04e9ef0cc93f7ac7bd10effe593d8847fbc046a6dfcb8e9ad0768**,modo0600,fecha2026-09-07T00:19:24.510Z.
Sietegrupos: citas propias vigentes; scopes recibo/candidato/run/workspace/actor; retirar/restaurar rights; retirar/restaurar contenido; no inventar regla previa vacía; sólo prior correcto; restore nueva revisión.
91lecturas,0DML/FTSdel reader,3citas/3revisiones;0trial/cohort/proveedor/remote. DDL0123/24/25 dentro de una transacción SERIALIZABLE con rollback externo incondicional;22baselines/digests y hashes igual. Independiente verificó el recibo. **No rerun de esta prueba si sus archivos siguen iguales.**

Hashes Creader finales:

- runtime: `d07358c40d1a8057ef368abf64879d5cbc2d94854bea5e759c880b8176e42534`
- testunit: `faafb3fdc8d66613e28e288d7382a3c9c3da5be694a8eb98ccaadc3da8988f8d`
- PGhelper: `c4128fd07f01adb3b8763595097f581404784d45302f59fef5b01253665da638`

**C comprobaciones antes de la última corrección minúscula de replay**:

- DBstandard:204total/176PASS/28SKIP/0FAIL; DBno cambió después.
- Studiostandard:534total/533PASS/1SKIP/0FAIL.
-11typechecksPASS;11lintPASS con15warnings existentes.
- Studio buildPASS usando valores ficticios locales para variables de importación; no credenciales reales.
- Auditoría independiente del diff completo y PG sinP0/P1/P2.

**Última corrección causal**, encontrada en QA de respuesta perdida:

El primer envío serializaba propiedades en un orden; después de sessionStorage/remount el schema reconstruía otro orden. El servidor de prueba con replay byte-exacto rechazaba el mismo key como conflicto. Se normaliza una vez con el schema existente **ANTES de persistir y enviar**, y se usa ese objeto en ambos.

- ComponenteSHA **fd319fbd6c9f9cc2a9a2dcb0e68168de2ef03b3d9429e26d33e11fba3a85e55b**.
- TestSHA **3c9e9edd345c062324751a1d0cd4f2c318db5cdfbe4d912d73317c94765a45ef**.
-25/25focales,StudioTC ylintfocal0/0PASS después del fix.
- Revisión independiente del deltaP0/P1/P2=0; quitar sólo ese delta reproduce archivos anteriormente auditados byte por byte.
- QA real del componente después del fix: **2POST,1write simulado,1key,body idéntico,key idéntico,pending0,alerts[],effects0**. Conservado en `lost-response-fixed.json`.
- La suite estándar completa/build mencionadas arriba son **anteriores** a este delta; falta una pasada final proporcional, no mentir que ya lo incluyen.

### QA de componente: qué pasó y qué queda

Ruta principal `.data/topic-rule-suggestion-ui-qa/`: componente real, validadores DTO y traducciones, con transporte simulado. Sin UAT, base de datos ni Claude.

PASS observado:

- Abrir sugerencia/citas; Usar/deshacer copia con 0 POST.
- Editar lexical/scopes/idioma/país; guardar revisiones 1 y 2 ligadas; restaurar revisión 1 crea nueva revisión 3 sin borrar historia.
- Probar por separado: cuarta POST / 1 trial. Los 24 registros / 6 matches son datos SINTÉTICOS de QA, no corpus real.
- Refresh sin POST; Escape/foco; reabrir revisión 3.
- Refresco con draft externo no pisa texto sucio, muestra conflicto y exige descarte explícito.
- Derechos retirados ocultan ambas citas, vuelven al restaurarse; fuente stale bloquea uso.
- Insufficient/none sin matcher inventado.
- GET403, error JSON y schema unavailable distintos; fallback al editor ordinario si falta el esquema.
- Respuesta perdida/remount/replay exacto después del fix, con recibo privado citado.

Pendiente del cierre actual, NO marcar PASS por existir hooks/tests:

1. Probar con navegador respuestas GET y POST tardías tras cambiar workspace/candidato, usando hooks preparados.
2. Completar caso POST malformado/500 y 403 conocido según la matriz ya cubierta por unit, sin ensanchar scope.
3. Inspección/screenshots **finales de ESTE C-UI** a 390/740/1280, ES/EN, overflow, Escape/foco, consola/red. Los screenshots y QA de 3C/3D no sustituyen éstos.
4. Completar `QA_LOCAL.md` (este handoff ya corrigió su estado de preparado a parcialmente ejecutado), conservar recibos previos, pasada final de tests/build y cierre independiente con la evidencia ya disponible.
5. Commit focal local de 15 archivos; sólo entonces abrir C-exec separado. No reauditar A/B enteros ni repetir la prueba PG de 91 lecturas.

## 8. Herramientas y ambiente para retomar sin matar la Mac

- Node 20: `PATH=/Users/brandhon_o/.nvm/versions/node/v20.20.2/bin:$PATH`.
- pnpm 10.33.2; no reinstalar todo ni crear clones grandes por costumbre.
- Último disco observado en este handoff: 28 GiB libres, volumen Data 94% usado. No limpiar Docker/sesiones ni descargar imágenes como requisito inventado.
- Última DB local usada: contenedor existente **noisia-r24a-provenance-pg**, loopback 127.0.0.1:55439, DB **noisia_topic_eval_lab_20260906_1cd623f0d548**. No usar una URL remota por conveniencia para estas pruebas.
- La prueba C PG ya terminó. No hay transacción que rescatar ni que repetir.

Harness browser local existente al corte:

- `node .data/topic-rule-suggestion-ui-qa/server.mjs`, localhost4599, PID19353/session80300.
- Browser daemon PID21636. Todos los comandos browse se ejecutan con **cwd del repo principal**, no del worktree: el daemon se identifica por cwd. Usar el otro cwd creó una sesión vacía distinta una vez; no confundir eso con pérdida del harness.
- Binario `/Users/brandhon_o/.codex/skills/gstack/browse/dist/browse`.
- Tras un reinicio comprobar si esos procesos existen; PIDs no son autoridad permanente. El servidor es simulado, no abrirlo al exterior.
- `entry.tsx` SHA de entrega: b4099f9c30920c8db621f06ea4e0bfdbb1d640c228544cc011cea7cbfa42743c. El server recompila el componente actual en memoria al abrir.

Hooks `window.qa`: snapshot/reset/arm(lost_response|http_500|invalid_json|stale|forbidden)/readFailure(read_error|invalid_json|forbidden|schema_unavailable)/rights(bool)/receipt(suggested|insufficient_evidence|none)/sourceChange/externalDraft/delayNext(GET|POST)/releaseDelayed/switchWorkspace/remount/setLocale(es-MX|en-US).

Selectores observados útiles:

```text
button:has(strong:text-is("Alexa y el Mundial · simulación A"))
button:text-is("Usar sugerencia")
button:text-is("Guardar borrador")
button:text-is("Probar borrador")
button:text-is("Recuperar misma solicitud")
button:text-is("Restaurar versión 1")
[role=dialog] button:text-is("Actualizar")
[aria-label="Sugerencia de regla"] button:text-is("Ver menciones citadas")
label:has(span:text-is("Cualquiera de estas frases")) textarea
```

Credenciales: nunca usar claves antiguas pegadas en la conversación. La exportación redacta sus patrones reconocibles. Existe separación carril producto/carril Advisor en `tools/codex-advisor/credential-lane.mjs`. El QA actual no necesita ninguna credencial. Para un flight real posterior comprobar configuración vigente de presencia/identidad sin imprimir valores y respetar el carril de producto. No pedir una nueva clave sólo porque este chat es nuevo.

Las pruebas que importan Studio exigen variables incluso sin conexión. Dos fallos iniciales estándar fueron `DATABASE_URL is required`, no bugs funcionales. Se resolvió el entorno del test con URL dummy loopback puerto9. Build también exige variables Kinde durante page collection:

```text
DATABASE_URL=postgresql://noisia_local_test:noisia_local_test@127.0.0.1:9/noisia_test
DATABASE_SSL=false
KINDE_CLIENT_ID=local-build-only
KINDE_CLIENT_SECRET=local-build-only
KINDE_ISSUER_URL=https://noisia-local.invalid
KINDE_SITE_URL=http://localhost:3001
KINDE_POST_LOGOUT_REDIRECT_URL=http://localhost:3001
KINDE_POST_LOGIN_REDIRECT_URL=http://localhost:3001/auth/continue
```

Son literales ficticios, no secretos. No apuntar suites generales a UAT para resolver un import env. La prueba PG se hace sólo con su target y autorización explícitos, no con esta URL dummy.

## 9. C-exec: siguiente implementación concreta, todavía NO hecha

Después de cerrar C-UI, seguir el plan revisado, sin construir otro framework:

- Propósito nuevo `topic_rule_suggestion_v1`, salida RuleSpec de A, recibo genuino ligado a terminal propio.
- Reutilizar `getDataOsQueue`, readiness y `startDataOsWorker`, BullMQ/Data OS existentes y `generateAnthropicBoundedTextV1`.
- Si es necesario, **un** registro durable mínimo reúne sellado/reserva/claim/traza/outcome/pending dispatch; no copiar migraciones Lab0116–0121 ni etiquetar una regla como resultado V2 de Top10.
- Recepción real de B verifica ejecución/bytes/digests/uso/coste; no basta cambiar `origin` a `provider`.
- Antes del primer request: candidato guardado, run/snapshot/CAS exactos y Brand OS disponible. Navegación real de menciones representativas/búsqueda del candidato, derechos actuales, cursores y trazas del servidor.
- Hasta 12 navegaciones y contexto de 18 KiB con bootstrap fijado. Citas históricas no equivalen a evidencia recién leída. Resultado `insufficient_evidence` válido, no inventar regla.
- Portar delta SDK ya demostrado en repo principal: conservar usage/request ID ANTES de leer `result.output`; `NoOutputGeneratedError` no convierte coste conocido en desconocido. No cambiar temperatura explícita de Semantic Context.
- Fake primero, auditoría proporcional, entrega UAT focal revisada; después flight real de UN CANDIDATO con cap propuesto USD1 dentro del saldo/último intento. No reenviar un request ambiguo ciegamente.
- Copiar/editar/guardar no repiten generación. Trial posterior determinístico separado con denominadores y ejemplos; después juicio de relevancia.

Después: completar calidad/matching híbrido y unir clasificación persistente/incremental al 0087 existente; Signal después de probar el recorrido. No exigir que una nueva corrida BERTopic, los diez candidatos en todos los idiomas o el rediseño Front estén perfectos para demostrar UN CASO útil.

## 10. Presupuesto y automatización

- Sobre autorizado reconciliado: USD20 agregados, hasta10experimentos.
- Nueve experimentos enviados; uno de esos10 restante según la última contabilidad, no10 nuevos por abrir chat.
- Coste conocido acumulado: USD3.155063.
- Reservas conservadoras de outcomes unknown: USD4.86.
- Bolsa conservadora de probes anteriores: USD0.61.
- Saldo conservador: **USD11.374937**.
- Gate C-UI actual:0llamadas/0coste. Handoff:0proveedor.
- Un experimento puede contener varias llamadas de herramientas; no confundirlas con nuevas corridas.

Automatización **noisia-topic-evaluation-recovery-loop**: **PAUSED** en la app durante este relevo. Se conservó el prompt y periodicidad hourly. Target anterior Frontend019fe269…; no reactivar sobre el chat anterior cuando el nuevo asuma coordinación. Ver/actualizar mediante automation tool, no editar a mano TOML.

Los tres subagentes recientes están **completed**, no trabajando secretamente:

- `/root/lab3ec_studio`: implementación UI y corrección replay,25testsPASS.
- `/root/lab3ec_reader`: reader PG y fixture QA.
- `/root/lab3eb_final_review`: revisión independiente del diff completo y delta P0/P1/P2=0.

Las identidades de subagentes pueden no sobrevivir al chat nuevo; código/recibos son la autoridad. No crear otros20chats por costumbre. Delegar trabajos concretos en archivos separados cuando aporten paralelismo real.

## 11. Qué NO repetir y cómo salir del ciclo

1. UAT3D/A/B están cerrados; verificar hashes no significa repetir pruebas enteras.
2. No reabrir el antiguo problema de67/52hojas locale ni69A.7Y2. Se cambió el modelo UX desde entonces.
3. El problema de Docker/disco/I/O existió; **no es el bloqueo actual demostrado**. Hay prueba PG real terminada. No reparar infraestructura ni clonar DB por inercia.
4. Diez candidatos ya importados: no pagar de nuevo para generarlos sólo porque el nuevo chat no los ha visto.
5. No presentar tests como features ni exigir protección de producción para una edición UAT dummy ordinaria. Probar los riesgos reales del cambio.
6. No inventar READY/PASS: falta QA final C-UI. La revisión independiente del código no reemplaza ese último cierre.
7. Guardar estado/evidencia antes de operaciones largas. Parte de la confusión del operador viene de documentos STATE/QA atrasados respecto del trabajo real.
8. No quemar el último intento pagado con fixtures ni confundir naming/Topic Evaluation con rule generation.
9. Medir progreso por un recorrido utilizable en UAT. Revisar lo siguiente con código/recibos reales y ejecutar, no sólo rediseñar otro plan.

## 12. Orden de lectura y arranque para el nuevo chat

1. Leer completo este handoff y el INDEX de exportación.
2. Leer AGENTS raíz y anidados aplicables, guardrails, STATE/CURRENT/NEXT actuales. La parte superior de estos documentos tiene el estado actual; las secciones `Superseded` son historia.
3. Leer cronológicamente **frontend/dialogue** por fragmentos; registrar la intención actual del operador y decisiones revocadas. No leer329MB de herramientas a ciegas: buscar por fecha/línea/key cuando una afirmación del handoff requiera evidencia.
4. Consultar Backend dialogue para procedencia detallada, en especial migraciones/Worker/handoff. No necesitas reemprender las tareas allí cerradas.
5. Verificar worktree HEAD/diff y recibos de las secciones7–8. No correr nuevas suites extensas para reconstruir lo que ya está probado.
6. Responder en pocas líneas qué vas a cerrar inmediatamente; terminar QA final C-UI y commit focal. Continuar C-exec, prueba real proporcional y entrega UAT sin otra autorización genérica dentro de lo ya autorizado.

**No crear una nueva lista infinita de gates. Lo siguiente debe acercar materialmente un candidato con evidencia a una clasificación comprobable y luego a Signal.**

## 13. Ampliación del operador — compass self-service, 7 de septiembre

Esta sección nutre el contexto anterior sin sustituirlo. Los cierres posteriores de C-UI/C-exec y Topics → Signal se conservan en sus recibos; no reejecutar pendientes históricos de las secciones 7/9/12 por leer este handoff.

La auditoría completa de Admin confirmó una entrega útil de catálogo, búsqueda/corrección y publicación UAT, y corrigió su alcance: el Topic Entrega de Laika procede de taxonomía histórica Claude sobre muestra, no de una corrida nueva de BERTopic. Los diez Alexa sí proceden de interpretación de clusters históricos. No hay todavía descubrimiento genérico self-service ni clasificación automática de calidad/escala demostrada. Reporte: [AUDIT_ADMIN_AND_DISCOVERY_2026-09-07.md](./AUDIT_ADMIN_AND_DISCOVERY_2026-09-07.md).

El operador aprobó como nueva brújula: producto listo para producción y autoservicio de extremo a extremo. Crear marca → Brand OS amigable → intereses definidos → importar marca/competencia/categoría → cómputo de todo el corpus → descubrimiento emergente → Claude con evidencia → Topics principales editables → excepciones → Signal. Incrementalidad semanal/mensual, asignación a Topics existentes y aparición de nuevos son obligatorias. Priorizar este recorrido sobre arreglar todas las secciones de Admin. No hay clientes ni requisito de compatibilidad con datos de producción antigua o Amazon.

Los intereses se convierten en definiciones semánticas medibles/versionadas; no adoptar obligatoriamente un agente o servicio por Topic. Claude puede resolver controles rutinarios con herramientas y evidencia; no puede inventar membresía ni saltar autorización/derechos/costo. No exigir rúbricas por 115/1000 clusters. Procesar todo no equivale a forzar una etiqueta: cada registro queda contabilizado y cada elegible procesado, dudoso/sin tema o con fallo visible recuperable. Interpretación por evidencia acotada no sustituye cómputo masivo.

Capacidad objetivo: hasta dos millones de menciones y miles de Topics, pendiente de medición. El clasificador actual conserva límites de 64 Topics y primer chunk; el plan incluye resolverlos con lotes/texto completo. Self-service requiere capacidades cliente scoped y seguimiento explícito por Topic, no únicamente rol interno/publicación de catálogo. No limpiar ni rediseñar todo para atender estas conexiones.

Documentos acumulativos: [Compass](./COMPASS_SELF_SERVICE_2026-09-07.md), [Plan](./PLAN_SELF_SERVICE_MONITORING_2026-09-07.md), [Orquestación](./ORCHESTRATION_SELF_SERVICE_2026-09-07.md), [Mapa Linear](./LINEAR_SELF_SERVICE_MAP_2026-09-07.md). Se prepararon frentes Frontend y Backend en tareas nuevas, con memos y responsabilidades exclusivas; Noisia V02 MAIN conserva coordinación.

Este turno termina en documentación, backlog y preparación, por petición explícita de avisar antes de avanzar. No implementación ni producción, loop PAUSED. Saldo mínimo actual producto USD 11.362961; auditoría separada USD 1.343826. Las cifras de la sección 10 son históricas. No se hicieron nuevas llamadas de proveedor para planificar.

## 14. Continuidad self-service — entrega pre-import 7 septiembre 2026

## Entrega vigente — marca nueva, esperando archivos reales

**UAT activo en Studio y Workers: `c40899b01d8b77cae71d712c92054ca71b12be7f`.** [Recibo de entrega y límites](./DELIVERY_SELF_SERVICE_PRE_IMPORT_2026-09-07.md). Health profundo200 y alta autenticada actualizada, sin errores de consola. Root checks y PostgreSQL local real pasaron. El loop existente queda **PAUSED** sobre esta tarea hasta la entrada de datos.

La siguiente acción del operador es crear su marca/prospecto nuevo y cargar CSV originales de SentiOne mediante `/studio/brands/new` → Contexto → Topics e intereses → Importar. No hay una nueva marca activa elegida en esta tarea ni menciones cargadas por el agente. **No reparar, recuperar ni operar Laika/Alexa como atajo.**

Al recibir los archivos por UI, verificar import/Worker y continuar preparación genérica, corpus completo, clasificación, descubrimiento e incrementalidad del Compass. No dar por hechos estos stages. Acceso integral de cliente sigue NOI-19. Saldo producto11.362961 y Advisor1.343826, cero llamadas pagadas en este corte. Los snapshots y gates anteriores conservados abajo son historia.
