# ExecPlan · Piloto de etiquetado masivo con el estudio real A

Plan vivo. Codex lo mantiene al día mientras trabaja: marca el progreso, anota sorpresas y decisiones, y debe poder retomar el trabajo leyendo sólo este archivo. Fuente de las decisiones: `AUDIT_MFP_2026-10-04.md` §21 y `docs/adr/015-signal-semantic-cascade-and-topic-contracts.md`. Si algo choca con documentos anteriores (spec v1.3, §19.6 o §20.3), manda este plan.

## Propósito

Etiquetar **todo** el corpus de un estudio por menos de USD 100. Así Signal, el agente de Insights y los estudios de triggers y barriers trabajan sobre el corpus completo, no sobre unas cientos de menciones.

El piloto prueba la ruta sobre el corte 1 del estudio real A (cerveza, Brasil, portugués), que ya está importado y preparado en dev-test, y compara su resultado con el estudio que ya se entregó.

**Terminado significa:**
- el corte quedó etiquetado con la ruta de abajo;
- el costo real se midió y se proyectó a un millón de menciones;
- el Signal del workspace del piloto muestra los tópicos;
- se entregaron el recibo, la comparación y las muestras para el auditor (ver «Validación y aceptación»).

## Contexto y orientación

**Entorno.** Sólo dev-test de Railway: PostgreSQL 17 con pgvector, Redis, Runner y Studio en `mfp-studio-dev-test.up.railway.app`. Los accesos están en `MFP_ACCESS_AND_ENV_2026-10-04.md`. El estado del estudio, en una nota privada bajo `.data/`, y el estado al 18 de octubre, en `HANDOFF_MFP_REVISION_12_2026-10-18.md`. No se toca UAT ni producción.

**El corte 1:**
- 11 archivos, 113,338 filas, 96,150 menciones únicas;
- 83,962 elegibles y 127,122 fragmentos;
- costo de importación y preparación: USD 0.

**Confidencialidad.** El repo es público. En todo lo versionado el estudio se llama «Estudio real A (cerveza, Brasil)». Nombres, CSV, textos, IDs y rutas reales van sólo en `.data/` privado. La carpeta de origen es de sólo lectura.

**Piezas existentes que se reutilizan:**

| Pieza | Dónde |
|---|---|
| Preparación y vectores Voyage | ya existen |
| Motor BERTopic guiado | `packages/query-engine/src/signal-workspace-engine-v1.ts`, perfil `workspace-bertopic-guided-open-v1` |
| Consolidación editorial con Claude por grupo | ya existe |
| Adaptador JEV | `services/workers/src/providers/typesafe-jev.ts` |
| Ledger común de llamadas | ya existe |
| Correcciones humanas | ya existen |
| Lectores de Signal | ya existen |

**Qué NO se usa en esta ruta:**
- Claude por mención, ni para la ficha ni para la pertenencia;
- la cita literal obligatoria;
- la meta de 90% como requisito;
- los experimentos del juez (v2, v3, H1).

Se quedan en el repo, apagados.

**JEV, en una línea.** Es un clasificador, no un modelo generativo: responde muchas preguntas en paralelo sobre el mismo texto y cobra el texto una sola vez por llamada (USD 0.042 por millón de tokens de entrada; la salida es gratis). Detalles:
- No hace vectores, no se afina con datos propios y no tiene campo de ejemplos.
- Lee de forma literal, y el contexto irrelevante lo confunde.
- No publica calidad en portugués.
- Su contrato (MCA §2.3b) prohíbe entrenar otro modelo con sus salidas.

## Plan de trabajo

### Hito 0 · Base

- Versionar en un PR documental desde `develop` los cambios locales de documentación del checkout:
  - este plan;
  - `AUDIT_MFP_2026-10-04.md` (§19–§21);
  - `QA_FUNDADOR_MFP.md`;
  - el `AGENTS.md` raíz recortado;
  - `STATUS_HISTORY_AGENTS_BANNERS.md`;
  - `.codex/agents/*.toml`. `.codex/` está en `.gitignore`, así que el `revisor.toml` nuevo se agrega con `git add -f`, igual que los otros tres.
- Fusionar #57 a `develop` con CI y PostgreSQL verdes; no tiene bloqueantes (AUDIT §19.2). Trabajar desde ahí.

### Hito 1 · Perfil nuevo de BERTopic

La configuración actual (`signal-workspace-engine-v1.ts:7-14`) produce demasiados grupos chicos: `hdbscan_min_cluster_size: 40`, `cluster_selection_method: "leaf"` y sin reducción. Eso explica los 1,652 grupos de Alexa+.

Crear un perfil nuevo, con identidad nueva:
- **Tamaño mínimo de grupo:** escalarlo al corpus, como punto de partida ≈ 0.1% de las raíces y nunca menos de 40.
- **Selección `eom`.**
- **Reducción a un máximo de ≈ 200 tópicos.**
- **Idioma:** `pt` en `language_families`.

Prueba PostgreSQL de que se selecciona el perfil correcto. Las semillas son sólo marca, competidores y categoría del Brand OS. **Nunca la taxonomía del estudio entregado**, porque contaminaría la comparación.

### Hito 2 · Clasificador JEV por mención

**Una solicitud por raíz.** El `state` es el fragmento más relevante de la mención, elegido con los vectores.

**Preguntas, todas en la misma solicitud:**
- relevancia para el estudio (`noul`);
- promoción o publicidad (`noul`);
- spam o bot (`noul`);
- voz (`choice`);
- trigger, barrier o ninguno (`choice`);
- un `noul` por cada uno de los ≈ 8 tópicos candidatos, los de centroide más cercano.

**Reglas:**
- Cada pregunta, atómica y en positivo.
- Umbrales 0.7 y 0.3. Lo que queda entre ambos es «sin clasificar» y no va a Claude.
- Se guardan todas las probabilidades.
- Usa el ledger común y escribe por lotes.
- Si hacen falta tablas, migración nueva hacia adelante; nunca se modifica una aplicada.
- Los lectores de Signal muestran tópico, volumen y ejemplos, elegidos por mayor probabilidad.

### Hito 3 · Corrida del piloto en dev-test

1. **Vectores** con los tokens gratis de Voyage. Antes, estimar los tokens reales: contador local, o la razón de R10 (227,790 de 4,133,529) aplicada a la cota. Arrancar sólo si caben en la mitad de los tokens gratis. Al terminar, releer el panel.
2. **BERTopic** sobre todo el corte, repetido sin costo hasta lograr ≤ 200 tópicos legibles.
3. **Claude sólo por grupo:** 20–30 menciones representativas por grupo. Nombra, define y fusiona.
4. **Prueba de humo de JEV con 1,000 raíces.** Se continúa salvo un fallo técnico claro:
   - probabilidades casi uniformes;
   - más del 40% en la franja intermedia;
   - más del 2% de errores.
5. **JEV sobre todo el corte.**
6. **Signal** del workspace con los tópicos seleccionados.

### Hito 4 · Entrega

El recibo, la comparación y las muestras de «Validación y aceptación».

## Organización con subagentes

- **El orquestador (el chat principal) es el único que:**
  - mantiene este plan;
  - fusiona;
  - despliega en dev-test;
  - corre etapas pagadas.
- **Quien escribe código trabaja en su propio worktree y rama.** Nunca dos agentes sobre los mismos archivos.

| Subagente | Encargo |
|---|---|
| `explorer` (incluido, sólo lectura) | Al inicio, en paralelo: mapear el motor de BERTopic, el adaptador JEV, los lectores de Signal y el estado del workspace del piloto. |
| `mfp_estandar` | Hito 1 y el worker del Hito 2. |
| `mfp_critico` | Tablas, migración, ledger y lectores de Signal del Hito 2. |
| `mfp_mecanico` | Hito 0 documental; limpieza de las 9 pruebas atadas a `127.0.0.1:55439` (AUDIT §19.5); scripts de métricas y muestras del Hito 4. |
| `revisor` (sólo lectura) | Revisa cada PR antes de fusionarlo. Sus P0 y P1 se corrigen antes de fusionar. |

## Presupuesto y paradas

| Componente | Cómo se paga | Estimado |
|---|---|---|
| Voyage | Tokens gratis | USD 0 |
| JEV, ≈ 84 mil raíces | Saldo de la cuenta | USD 2–5 |
| Claude, por grupo | Saldo de Anthropic | USD 2–10 |

**Total orientativo: ≤ USD 15.** Antes de cada etapa pagada se lee el saldo. Nunca se compran créditos ni se fusiona a `main`.

**Paradas.** Sólo en estos casos se detiene y se pregunta al fundador:
- el saldo no alcanza;
- hay riesgo de dañar datos;
- un formato no entra.

Lo demás se resuelve de forma autónoma y se anota en el registro de decisiones.

## Validación y aceptación

**Recibo público de una página**, `DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_<fecha>.md`, con el alias del estudio. Debe incluir:
- **Costo:** por etapa, por 1,000 menciones y proyectado a un millón.
- **Tiempo:** de reloj, por etapa.
- **Cobertura:**
  - % de raíces con al menos un tópico sobre 0.7;
  - % en la franja intermedia;
  - % sin tópico;
  - % de promoción y spam;
  - distribución de triggers y barriers.
- **El mapa:** número de grupos y de tópicos finales, con nombre, definición y volumen.

**Anexo privado en `.data/`:**
- **La comparación con el estudio entregado:**
  - temas que encontraron ambos, sólo el producto y sólo el estudio;
  - triggers y barriers del estudio encontrados o no;
  - lo nuevo.
- **Muestras para el auditor, sin la clave:** 50 raíces por tópico en los 10 tópicos más grandes y 100 raíces de triggers y barriers. La clave va aparte, sellada con SHA.

**Prueba en vivo.** Signal del workspace del piloto, abierto en dev-test, con los tópicos y sus volúmenes.

**Calidad.** Se mide por muestreo; no es requisito de aceptación.

## Idempotencia y recuperación

- Las respuestas pagadas se guardan y nunca se reenvían.
- Las corridas tienen clave idempotente; repetir una corrida terminada no tiene efecto.
- Repetir BERTopic es gratis y crea una ejecución nueva sin borrar las anteriores.
- Si una etapa falla a medias, se reanuda desde lo guardado.

## Progreso

- [x] 2026-11-07 · Leídos plan, accesos, handoff y nota privada. Exploración inicial de motor, JEV, Signal y workspace iniciada.
- [x] Hito 0 · [#76](https://github.com/noisia-ai/monorepo/pull/76) fusionado a `develop` en `d8b48b43`. Revisión sin P0/P1/P2, CI y PostgreSQL verdes en `f1122578`.
- [x] Hito 0 · [#57](https://github.com/noisia-ai/monorepo/pull/57) fusionado a `develop` en `120b94c1`. Revisor sin P0/P1/P2. CI y PostgreSQL verdes en `042032ed`.
- [x] Hito 1 · [#78](https://github.com/noisia-ai/monorepo/pull/78) fusionado a develop en f59e97cf. PostgreSQL, imagen y CI verdes en 6bf06c38. Revisor sin bloqueantes. Prueba integrada de guías derivadas, fit gratuito, tope de tópicos y materialización pt-BR. Studio y Runner de dev-test saludables en ese mismo commit, 12 hashes de fuentes verificados. Migración 0270 aplicada una sola vez. Las 96,150 identidades de raíz conservaron su hash.
- [x] Hito 0 · Las nueve suites usan fixtures sintéticos del PostgreSQL migrado. [#81](https://github.com/noisia-ai/monorepo/pull/81) se fusionó en `a813a81a` con revisión de `3195e66a`, CI y PostgreSQL verdes en el PR y en `develop`. El job de PostgreSQL ejecutó 60 pruebas sin omisiones.
- [x] Hito 2 · [#77](https://github.com/noisia-ai/monorepo/pull/77) fusionado a develop en 12332658 con revisor, CI y PostgreSQL verdes en f1156232. En dev-test se aplicó sólo 0271. Las 252 migraciones coinciden con sus hashes y se conservó el hash de las 96,150 raíces. Ya se corrigieron el bloqueo de trabajo activo en un workspace hermano y el filtro de exclusión en Signal. La verificación del contenido de cada resumen y del conjunto completo de grupos pasó la segunda revisión y PostgreSQL en f1156232. El worker de [#82](https://github.com/noisia-ai/monorepo/pull/82) se fusionó en 6672e7b3 después de cerrar los P1 y verificar CI y PostgreSQL en 9a37a147. Hito de implementación completo. La aceptación sobre el corpus real se mide en Hito 3.
- [x] Hito 3 · Vectores del corpus completos en dev-test. En 14 min 17.739 s terminaron 83,962/83,962 raíces y 127,122/127,122 fragmentos. De éstos, 125,049 requirieron vectores y 2,073 usaron caché. Ledger de 999 llamadas liquidadas HTTP 200, 25,592,964 tokens y USD 3.071635 a tarifa. Saldo gratuito conciliado de 149,664,510 a 124,071,546 tokens. El delta coincide con el ledger al token. Cargo real USD 0.
- [x] Hito 3 · BERTopic. El preflight del corte confirmó tres guías, ninguna faltante, cero intereses definidos, EOM, mínimo de 84 raíces, máximo de 200 tópicos y salida pt-BR. El primer fit gratuito terminó en 26 min 0.128 s. El manifiesto y los grupos verificados por SHA confirman 200 grupos y 61,293 fragmentos atípicos. En 20 grupos sólo quedaron 9–19 raíces distintas; 180 sí admiten 20–30 representantes. La corrección [#84](https://github.com/noisia-ai/monorepo/pull/84) se fusionó en 6667c6ca después de revisión, CI, imagen y PostgreSQL verdes en 3e59d946. La migración 0272 elevó el contador a 253 sin diferencias de hash. El ajuste gratuito v2 con centroide por raíz y tres guías terminó en 15 min 38.010 s. Produjo 142 grupos de 88–4,745 raíces, todos con 30 representantes distintos. De las 83,962 raíces, 44,584 entraron a grupos y 39,378 quedaron atípicas. JEV mantiene como denominador las 83,962. En 66 grupos la lista de términos sólo contenía cadenas vacías. Se confirmó que max_df entero 1 descarta cualquier término presente en dos grupos. La corrección se sigue en [#86](https://github.com/noisia-ai/monorepo/pull/86), con máximo como proporción 1.0 y mínimo como conteo 1. Studio y Runner de dev-test están en 6667c6ca con 28 hashes de fuentes verificados.
- El ajuste v3 de [#86](https://github.com/noisia-ai/monorepo/pull/86) terminó en 16 min 12.372 s, con 153 grupos de 84–2,082 raíces. Cada grupo tiene 30 representantes distintos y 15 términos no vacíos. Se agruparon 42,603 raíces y quedaron 41,359 atípicas. En 127,122 fragmentos hubo 54,721 atípicos. Se verificaron los artefactos y la cobertura de 83,962 raíces. Studio y Runner sirvieron el mismo código c6e0ac40 en dev-test.
- [ ] Hito 3 · Claude por grupo. El fit de esta ejecución selló 144 grupos con 30 representantes y términos en los 144. Quedaron 45,840 raíces agrupadas y 38,122 atípicas. La etapa editorial se detuvo el 7 de noviembre a las 21:49:53 UTC por el límite de referencias del formato. Se conservaron nueve respuestas HTTP 200 liquidadas por USD 0.990810 con exposición pendiente cero. Seis grupos tienen checkpoint válido y otros seis quedaron en cuarentena tras la reparación. El fundador autorizó hasta 30 referencias internas verificadas por campo en el piloto y la recuperación de las respuestas pagadas antes de nuevos envíos.
- [x] Recuperación editorial, base de datos · [#90](https://github.com/noisia-ai/monorepo/pull/90) fusionado a `develop` en `62340071`. El revisor aprobó `ef6b8f05` y ambos checks del PR pasaron. La migración 0274 añade evidencia de revisión sin modificar los recibos históricos. Se aplicó sólo 0274 en dev-test con runner y Studio en el merge de [#91](https://github.com/noisia-ai/monorepo/pull/91), `63e2d142`, verificado por archivos y health. Las 255 migraciones coinciden con sus hashes. No cambiaron las identidades de las 96,150 raíces ni las nueve filas completas del ledger. En dos ejecuciones sin proveedor se validaron los mismos 12 grupos: quedaron cuatro checkpoints válidos, dos resoluciones anexas a las dos excepciones históricas y una revisión que pide reparar un lote de cuatro grupos. Los hashes de las nueve filas completas del ledger, el fit y los registros recuperados coincidieron; costo adicional USD 0. El 7 de noviembre a las 23:34 UTC se reanudó la ejecución editorial con saldo USD 21.86 y el mismo tope total de USD 10. El primer envío nuevo, a las 23:36:53 UTC, fue la reparación pendiente; se liquidó por USD 0.128931. Las nueve filas anteriores siguieron intactas.
- [ ] Hito 3 · Segunda parada editorial a las 23:56:57 UTC del 7 de noviembre. El worker cerró la ejecución tras una respuesta inválida y una única reparación. Hay 73/144 grupos validados en 24 checkpoints, un lote de dos grupos en cuarentena y 69 grupos aún sin reclamar. Las 36 llamadas están liquidadas (HTTP 200, USD 4.184205); exposición pendiente cero. No se ha consolidado el mapa ni enviado ninguna raíz a JEV.
- [x] Recuperación de la segunda parada · [#96](https://github.com/noisia-ai/monorepo/pull/96) se fusionó en `451c9311` tras revisión de `2d96b155` y CI verde. PostgreSQL ejecutó 68 pruebas sin omisiones. Ambos checks pasaron también en la fusión. Studio y el runner de dev-test sirven ese commit, con 21 y 32 archivos verificados y health HTTP 200. Se aplicó únicamente 0275. Las 256 migraciones coinciden con sus hashes y se conservó el censo de 96,150 raíces. La decisión quedó ligada a la excepción, al operador y a los dos recibos. Ambos se verificaron por SHA. El grupo de 84 raíces quedó insuficiente y el hermano de 115 conservó exactamente la interpretación de la reparación. Dos recuperaciones sin proveedor produjeron los mismos 25 checkpoints para 75 grupos y tres resoluciones. Las 36 filas completas del ledger siguieron idénticas, por USD 4.184205. A las 06:04 UTC del 8 de noviembre se reanudó la misma ejecución para los 69 grupos pendientes y la consolidación. El saldo era USD 18.67 y quedaban USD 5.815795 dentro del tope original.
- [ ] Tercera parada de formato · A las 06:17:51 UTC del 8 de noviembre la misma ejecución llegó a 113/144 grupos resueltos en 38 checkpoints. Hay dos grupos en un lote en cuarentena y 29 por procesar. Las 53 llamadas están liquidadas por USD 6.110664, con exposición pendiente cero. Las 36 filas anteriores a la reanudación conservan sus hashes completos. El grupo afectado quedó mixto en el original y coherente en la reparación, en ambos casos con el campo general de referencias vacío. El hermano tiene una interpretación válida. La prueba local con los dos raws sellados comprobó que la ampliación propuesta conserva al hermano. La decisión sobre el alcance está pendiente.
- [ ] Hito 3 · Prueba de humo de JEV con 1,000 raíces
- [ ] Hito 3 · JEV sobre todo el corte
- [ ] Hito 3 · Signal del piloto
- [x] Hito 4 · Herramienta de auditoría [#80](https://github.com/noisia-ai/monorepo/pull/80) fusionada a `develop` en `d2f81802`. Revisor sin P0/P1/P2, CI y PostgreSQL verdes en `7c55787f`. La prueba recorre el contrato de H2 con datos sintéticos. La corrección [#85](https://github.com/noisia-ai/monorepo/pull/85), fusionada en 1990cfdc con revisión, CI y PostgreSQL verdes en 29d6f953, mezcla los 600 casos después del muestreo para que el orden del recibo no revele sus etiquetas. [#94](https://github.com/noisia-ai/monorepo/pull/94), fusionado en `90a032c2`, eliminó una búsqueda cuadrática al contar raíces únicas y redujo los cálculos de HMAC al ordenar la muestra. Los resultados reales esperan el mapa congelado y la clasificación.
- [ ] Hito 4 · Recibo, anexo privado y muestras

## Sorpresas y descubrimientos

- En un segundo lote con referencias generales vacías, el proveedor cambió el estado del grupo durante la reparación. La regla que se verificó y desplegó para el grupo anterior exige «mixto» en ambas respuestas. El decodificador desplegado rechaza el nuevo par.

- La primera versión del validador de consolidación aceptaba asignar un grupo insuficiente a un tópico. PostgreSQL reprodujo la adopción incluso con un recibo final ya liquidado. La versión desplegada exige que cada grupo insuficiente figure en la lista de exclusiones y comprueba la misma regla al adoptar un mapa.

- En el nuevo lote, un grupo mixto dejó vacía la lista general de referencias en ambas respuestas. Sus criterios de inclusión sí remitían a la muestra: 15 referencias distintas en el original y 14 en la reparación. Una prueba local sobre copias validó ambos grupos tomando sólo esas referencias de inclusión para el campo vacío. No se aplicó esa regla ni se modificaron los recibos.

- 2026-11-07 · El validador ampliado aceptó ocho de las nueve respuestas ya liquidadas al cotejar sus referencias con las muestras selladas. La novena omitió las referencias obligatorias de un grupo; ampliar el límite no las crea. Esa solicitud conserva una sola reparación posible. La recuperación en dev-test se verifica contra el fit y el registro de cobros antes de nuevos envíos.

- 2026-11-07 · El perfil se valida tanto en TypeScript como en Python. La interpretación anterior limita la muestra a diez raíces y el lector de Signal pagina por UUID. El piloto necesita pruebas de ambos extremos.

- La ejecución anterior dejó credenciales activas en el worker y la preparación vigente. La consola del modelo mostró 149,664,510 tokens gratis. La estimación R10 fue de 15,203,162 tokens.

- El consumo de vectores superó la estimación R10 en 68.3%. El panel continuó por encima de 120 millones de tokens gratis al cierre y actualiza con retraso respecto del ledger.

- El primer fit ajustó HDBSCAN sobre fragmentos. Un grupo podía superar 84 fragmentos con sólo 9 raíces. En 89 grupos había menos de 84 raíces distintas. El primer recuento de términos incluyó posiciones vacías de BERTopic. Al contar sólo texto no vacío, 45 de 200 grupos carecían de términos y 20 no cumplían el tamaño mínimo de muestra.

- El worker automático y el CLI del operador pueden competir por una misma ejecución pagada. Una clave caducada en el worker puede dejar una llamada incierta aun cuando el CLI tiene acceso. La corrección reserva la ejecución editorial de este piloto al operador y conserva la exposición contable de envíos concurrentes.

- En la lectura previa a editorial, las credenciales documentadas de Anthropic devolvieron HTTP 401 en la consulta gratuita de modelos. El saldo preliminar mostrado por la consola sí cubría la estimación. Una credencial dedicada autorizada restableció el acceso. El listado de modelos respondió HTTP 200 y la consola confirmó USD 22.85 de saldo.

- Las asignaciones reales v2 y v3 tienen distintos SHA. El fit v3 produjo 153 grupos frente a los 142 anteriores. En el último corte hubo 2,295 términos, de los cuales 1,522 fueron distintos.

- Dos lotes devolvieron referencias válidas dentro de la muestra de 30 pero superaron el máximo de diez referencias por campo. La comprobación privada de las respuestas originales y de reparación encontró entre 11 y 30 referencias en los campos rechazados.

## Registro de decisiones

| Fecha | Decisión | Razón | Autor |
|---|---|---|---|
| 2026-11-08 UTC | Mantener la nueva excepción en cuarentena y pedir al fundador el alcance de la calificación insuficiente cuando el estado cambia entre mixto y coherente. | La decisión anterior se limitó a un grupo. La nueva reparación está fuera del formato autorizado. Los dos recibos y el resto del lote se pudieron verificar por SHA antes de la consulta. | Orquestador |
| 2026-11-08 UTC | Validar la exclusión en la consolidación y al adoptar el mapa. Mantener las 83,962 raíces elegibles para JEV. | La decisión califica la evidencia del grupo. Sus 84 raíces siguen perteneciendo al corpus y pueden recibir probabilidades de otros tópicos. | Orquestador |
| 2026-11-08 UTC | Registrar el grupo afectado como insuficiente y conservar la interpretación válida del otro grupo del lote. | El original y su reparación omitieron las referencias generales. Se conservarán las respuestas originales y la decisión del operador con su procedencia. | Fundador |
| 2026-11-07 | Detener nuevos envíos y consultar sobre el campo general vacío. Preservar en su forma original los campos de inclusión, exclusión y referencias generales mientras se decide. | La autorización de hasta 30 referencias limita la cantidad; no establece que la evidencia de un criterio de inclusión sustituya la evidencia general. | Orquestador |
| 2026-11-07 | Mantener los lotes originales, registrar las resoluciones por adición y comprobar dos recuperaciones sin proveedor antes de reanudar. | La lectura de muestras selladas corrige las excepciones válidas sin inventar la evidencia que faltaba en otro lote. La doble ejecución demostró que no cambia los cobros ni el ajuste sellado. | Orquestador |
| 2026-11-07 | Autorizar hasta 30 referencias verificadas por campo en el piloto. Recuperar los recibos liquidados antes de reanudar envíos y conservar el linaje de las excepciones. | La muestra admite 30 raíces y se verificó que los campos rechazados citaban identificadores de esa muestra. | Fundador |
| 2026-11-07 | Aplicar la parada por formato. Conservar los recibos y cerrar la ejecución después de liquidar los envíos en curso. Consultar al fundador sobre la ampliación a 30 referencias verificadas. | El protocolo actual impide consolidar grupos en cuarentena. El conteo de referencias explica el rechazo y la recuperación puede evaluarse sobre respuestas ya pagadas. | Orquestador |
| 2026-11-07 | Usar una clave dedicada con vencimiento a 30 días y un tope editorial de USD 10, incluida la consolidación. Verificar el manifiesto del fit editorial antes de adoptar su mapa. | La cuenta confirmó USD 22.85 y los refits reales pueden cambiar la partición. El ledger y las muestras corresponden a la ejecución editorial que efectivamente las produjo. | Orquestador |
| 2026-11-07 | Repetir el ajuste gratuito con una política léxica explícita. Mantener el mínimo como conteo y el máximo como proporción. | El contador de vocabulario opera sobre documentos por grupo. La forma entera de max_df descartaba términos compartidos y dejó 66 grupos sin descriptores. Las ejecuciones terminadas tienen artefactos inmutables. | Orquestador |
| 2026-11-07 | Ajustar la variante corregida de BERTopic sobre un vector por raíz, con el centroide normalizado de sus fragmentos, y propagar la asignación a todos sus fragmentos. Guardar identidad de perfil nueva y comprobar 20–30 raíces distintas por grupo antes de Claude. | El corte real mostró que un mínimo por fragmento permitía grupos dominados por unas pocas menciones largas. | Orquestador |
| 2026-11-07 | Comprobar contenido y cobertura completa de los checkpoints individuales antes de consolidar y adoptar. | Un identificador de artefacto válido por sí solo permite sustituir el texto de un resumen. | Orquestador |
| 2026-11-07 | Derivar los centroides guía de los fragmentos que contienen identidades de Brand OS. Sellar pt-BR en el perfil editorial. | La ruta de prototipos requería una propuesta adicional y el estudio carece de primary_locale heredada. El mercado y el idioma están definidos en este plan. | Orquestador |
| 2026-11-07 | Mostrar el volumen por tópico con correcciones humanas vigentes. Relevancia, promoción y spam se miden por separado. | El plan define las preguntas y sus porcentajes sin excluir automáticamente raíces por esas probabilidades. | Orquestador |
| 2026-11-07 | Pertenencia positiva con p > 0.7, negativa con p < 0.3 y sin clasificar en [0.3, 0.7]. | La aceptación dice «sobre 0.7». Un mismo criterio sirve al worker, Signal y el recibo. | Orquestador |
| 2026-11-07 | Iniciar vectores sobre el runtime ya validado mientras se implementan H1 y H2. | El cálculo y la admisión por el worker existente son independientes de los dos cambios. El panel superó el mínimo de 30,406,324 tokens gratis. | Orquestador |
| 2026-11-07 | Usar la misma identidad de raíz y solicitud para el humo y su continuación. Congelar los candidatos y centroides del mapa editorial antes del humo. | Evita reenviar solicitudes pagadas y permite comparar probabilidades. | Orquestador |
| 2026-11-07 | Ruta canónica ADR 015 con JEV como clasificador por mención; Claude sólo por grupo | Costo < USD 100 por estudio y alcance sobre el corpus completo | Fundador y auditor |

## Resultado y retrospectiva

La importación y preparación del corte están verificadas. Se completaron los vectores de todas las raíces elegibles con cargo real de USD 0. El primer ajuste expuso grupos con pocas menciones distintas. El ajuste v3 produjo 153 grupos con 30 raíces de muestra y términos legibles en cada grupo. La ejecución editorial posterior agrupó el mismo corte en 144 grupos. Dos recuperaciones sin proveedor validaron 12 grupos sobre el mismo fit sin alterar los nueve cobros. La interpretación por grupo se reanudó dentro del tope original y volvió a detenerse con 73 grupos válidos por una omisión distinta en el formato. En dev-test se registró el grupo afectado como insuficiente y se recuperó el hermano. La doble verificación dejó 75 grupos resueltos sin aumentar el gasto. Tras reanudar se resolvieron otros 38 grupos. La ejecución se detuvo con 113 resueltos al recibir un nuevo par fuera del formato autorizado. El mapa consolidado, las probabilidades por raíz, Signal y los entregables del auditor siguen pendientes.
