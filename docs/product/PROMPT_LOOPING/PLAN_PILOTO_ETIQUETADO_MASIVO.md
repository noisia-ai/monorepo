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

- [x] Checkpoint histórico de las 12:49 UTC: 2,400/83,962 raíces liquidadas (1,000 del humo y 1,400 de continuación), USD 0.252198 de uso JEV y cero errores o exposición incierta. En esa fecha estaban verdes los 40 PR previamente integrados, antes y después de cada fusión. La clasificación y las verificaciones finales que allí quedaban pendientes se registran en hitos posteriores.

- [x] Permiso JEV acotado al mapa congelado: [#111](https://github.com/noisia-ai/monorepo/pull/111), revisado sin P0/P1/P2 en `0577bad3`. En el SHA final pasaron 26/26 pruebas PostgreSQL específicas con 259 migraciones desde cero, además de 641 pruebas de DB y 870 del worker. La [suite PostgreSQL del PR](https://github.com/noisia-ai/monorepo/actions/runs/42474184344) pasó 71/71, sin omisiones. El fixture conserva íntegros la ejecución y el permiso del workspace hermano; el tope incluye tanto el humo como la continuación. Fusionado como `4a916c4c` tras CI y PostgreSQL verdes; a las 11:19 UTC Railway comenzó a construir exclusivamente el runner en ese commit. La propuesta de Studio permaneció pendiente. A las 11:23 UTC se aplicó sólo 0278 con el runner en ese SHA (40 hashes verificados) y Studio estable en `8cf28943`: 259 migraciones sin diferencias ni pendientes, mismo censo de 96,150 raíces, nueve huellas de aislamiento iguales y 66 filas editoriales intactas. El permiso y su repetición devolvieron la misma extensión; tras la admisión existe una sola ejecución para el mapa. Se releyó el saldo de USD 30.00 antes del humo (tope USD 6.97). Al cierre del humo (11:28 UTC) quedaron selladas las huellas de las 1,000 llamadas, sus raíces y resultados. En ese punto la continuación todavía no estaba autorizada; el estado del permiso cambió después, como registra el checkpoint de las 12:49 UTC.

- [x] 2026-11-07 · Leídos plan, accesos, handoff y nota privada. Exploración inicial de motor, JEV, Signal y workspace iniciada.
- [x] Hito 0 · [#76](https://github.com/noisia-ai/monorepo/pull/76) fusionado a `develop` en `d8b48b43`. Revisión sin P0/P1/P2, CI y PostgreSQL verdes en `f1122578`.
- [x] Hito 0 · [#57](https://github.com/noisia-ai/monorepo/pull/57) fusionado a `develop` en `120b94c1`. Revisor sin P0/P1/P2. CI y PostgreSQL verdes en `042032ed`.
- [x] Hito 1 · [#78](https://github.com/noisia-ai/monorepo/pull/78) fusionado a develop en f59e97cf. PostgreSQL, imagen y CI verdes en 6bf06c38. Revisor sin bloqueantes. Prueba integrada de guías derivadas, fit gratuito, tope de tópicos y materialización pt-BR. Studio y Runner de dev-test saludables en ese mismo commit, 12 hashes de fuentes verificados. Migración 0270 aplicada una sola vez. Las 96,150 identidades de raíz conservaron su hash.
- [x] Hito 0 · Las nueve suites usan fixtures sintéticos del PostgreSQL migrado. [#81](https://github.com/noisia-ai/monorepo/pull/81) se fusionó en `a813a81a` con revisión de `3195e66a`, CI y PostgreSQL verdes en el PR y en `develop`. El job de PostgreSQL ejecutó 60 pruebas sin omisiones.
- [x] Hito 2 · [#77](https://github.com/noisia-ai/monorepo/pull/77) fusionado a develop en 12332658 con revisor, CI y PostgreSQL verdes en f1156232. En dev-test se aplicó sólo 0271. Las 252 migraciones coinciden con sus hashes y se conservó el hash de las 96,150 raíces. Ya se corrigieron el bloqueo de trabajo activo en un workspace hermano y el filtro de exclusión en Signal. La verificación del contenido de cada resumen y del conjunto completo de grupos pasó la segunda revisión y PostgreSQL en f1156232. El worker de [#82](https://github.com/noisia-ai/monorepo/pull/82) se fusionó en 6672e7b3 después de cerrar los P1 y verificar CI y PostgreSQL en 9a37a147. Hito de implementación completo. La aceptación sobre el corpus real se mide en Hito 3.
- [x] Hito 3 · Vectores del corpus completos en dev-test. En 14 min 17.739 s terminaron 83,962/83,962 raíces y 127,122/127,122 fragmentos. De éstos, 125,049 requirieron vectores y 2,073 usaron caché. Ledger de 999 llamadas liquidadas HTTP 200, 25,592,964 tokens y USD 3.071635 a tarifa. Saldo gratuito conciliado de 149,664,510 a 124,071,546 tokens. El delta coincide con el ledger al token. Cargo real USD 0.
- [x] Hito 3 · BERTopic. El preflight del corte confirmó tres guías, ninguna faltante, cero intereses definidos, EOM, mínimo de 84 raíces, máximo de 200 tópicos y salida pt-BR. El primer fit gratuito terminó en 26 min 0.128 s. El manifiesto y los grupos verificados por SHA confirman 200 grupos y 61,293 fragmentos atípicos. En 20 grupos sólo quedaron 9–19 raíces distintas; 180 sí admiten 20–30 representantes. La corrección [#84](https://github.com/noisia-ai/monorepo/pull/84) se fusionó en 6667c6ca después de revisión, CI, imagen y PostgreSQL verdes en 3e59d946. La migración 0272 elevó el contador a 253 sin diferencias de hash. El ajuste gratuito v2 con centroide por raíz y tres guías terminó en 15 min 38.010 s. Produjo 142 grupos de 88–4,745 raíces, todos con 30 representantes distintos. De las 83,962 raíces, 44,584 entraron a grupos y 39,378 quedaron atípicas. JEV mantiene como denominador las 83,962. En 66 grupos la lista de términos sólo contenía cadenas vacías. Se confirmó que max_df entero 1 descarta cualquier término presente en dos grupos. La corrección se sigue en [#86](https://github.com/noisia-ai/monorepo/pull/86), con máximo como proporción 1.0 y mínimo como conteo 1. Studio y Runner de dev-test están en 6667c6ca con 28 hashes de fuentes verificados.
- El ajuste v3 de [#86](https://github.com/noisia-ai/monorepo/pull/86) terminó en 16 min 12.372 s, con 153 grupos de 84–2,082 raíces. Cada grupo tiene 30 representantes distintos y 15 términos no vacíos. Se agruparon 42,603 raíces y quedaron 41,359 atípicas. En 127,122 fragmentos hubo 54,721 atípicos. Se verificaron los artefactos y la cobertura de 83,962 raíces. Studio y Runner sirvieron el mismo código c6e0ac40 en dev-test.
- [x] Hito 3 · Claude por grupo. El fit de esta ejecución selló 144 grupos con 30 representantes y términos en los 144. Quedaron 45,840 raíces agrupadas y 38,122 atípicas. La etapa editorial se detuvo el 7 de noviembre a las 21:49:53 UTC por el límite de referencias del formato. Se conservaron nueve respuestas HTTP 200 liquidadas por USD 0.990810 con exposición pendiente cero. Seis grupos tienen checkpoint válido y otros seis quedaron en cuarentena tras la reparación. El fundador autorizó hasta 30 referencias internas verificadas por campo en el piloto y la recuperación de las respuestas pagadas antes de nuevos envíos.
- [x] Recuperación editorial, base de datos · [#90](https://github.com/noisia-ai/monorepo/pull/90) fusionado a `develop` en `62340071`. El revisor aprobó `ef6b8f05` y ambos checks del PR pasaron. La migración 0274 añade evidencia de revisión sin modificar los recibos históricos. Se aplicó sólo 0274 en dev-test con runner y Studio en el merge de [#91](https://github.com/noisia-ai/monorepo/pull/91), `63e2d142`, verificado por archivos y health. Las 255 migraciones coinciden con sus hashes. No cambiaron las identidades de las 96,150 raíces ni las nueve filas completas del ledger. En dos ejecuciones sin proveedor se validaron los mismos 12 grupos: quedaron cuatro checkpoints válidos, dos resoluciones anexas a las dos excepciones históricas y una revisión que pide reparar un lote de cuatro grupos. Los hashes de las nueve filas completas del ledger, el fit y los registros recuperados coincidieron; costo adicional USD 0. El 7 de noviembre a las 23:34 UTC se reanudó la ejecución editorial con saldo USD 21.86 y el mismo tope total de USD 10. El primer envío nuevo, a las 23:36:53 UTC, fue la reparación pendiente; se liquidó por USD 0.128931. Las nueve filas anteriores siguieron intactas.
- [x] Hito 3 · Segunda parada editorial (resuelta en el hito siguiente) a las 23:56:57 UTC del 7 de noviembre. El worker cerró la ejecución tras una respuesta inválida y una única reparación. Hay 73/144 grupos validados en 24 checkpoints, un lote de dos grupos en cuarentena y 69 grupos aún sin reclamar. Las 36 llamadas están liquidadas (HTTP 200, USD 4.184205); exposición pendiente cero. No se ha consolidado el mapa ni enviado ninguna raíz a JEV.
- [x] Recuperación de la segunda parada · [#96](https://github.com/noisia-ai/monorepo/pull/96) se fusionó en `451c9311` tras revisión de `2d96b155` y CI verde. PostgreSQL ejecutó 68 pruebas sin omisiones. Ambos checks pasaron también en la fusión. Studio y el runner de dev-test sirven ese commit, con 21 y 32 archivos verificados y health HTTP 200. Se aplicó únicamente 0275. Las 256 migraciones coinciden con sus hashes y se conservó el censo de 96,150 raíces. La decisión quedó ligada a la excepción, al operador y a los dos recibos. Ambos se verificaron por SHA. El grupo de 84 raíces quedó insuficiente y el hermano de 115 conservó exactamente la interpretación de la reparación. Dos recuperaciones sin proveedor produjeron los mismos 25 checkpoints para 75 grupos y tres resoluciones. Las 36 filas completas del ledger siguieron idénticas, por USD 4.184205. A las 06:04 UTC del 8 de noviembre se reanudó la misma ejecución para los 69 grupos pendientes y la consolidación. El saldo era USD 18.67 y quedaban USD 5.815795 dentro del tope original.
- [x] Recuperación de la tercera parada de formato · A las 06:17:51 UTC del 8 de noviembre la misma ejecución llegó a 113/144 grupos resueltos en 38 checkpoints. Hay dos grupos en un lote en cuarentena y 29 por procesar. Las 53 llamadas están liquidadas por USD 6.110664, con exposición pendiente cero. Las 36 filas anteriores a la reanudación conservan sus hashes completos. El grupo afectado quedó mixto en el original y coherente en la reparación, en ambos casos con el campo general de referencias vacío. El hermano tiene una interpretación válida. La prueba local con los dos raws sellados comprobó que la ampliación propuesta conserva al hermano. El fundador decidió registrar sólo este grupo como insuficiente. [#99](https://github.com/noisia-ai/monorepo/pull/99) se fusionó en `f474fba7` tras la revisión de `79e4502c`, con CI y PostgreSQL verdes. Studio y el runner sirven el mismo commit en dev-test: 21 y 32 archivos verificados, health HTTP 200, 256 migraciones sin pendientes ni diferencias y el mismo censo de 96,150 raíces. La primera recuperación sin proveedor dejó 115/144 grupos en 39 checkpoints. El hermano coincidió con la interpretación válida de la reparación y los 53 recibos permanecieron intactos. La segunda recuperación devolvió los mismos 39 checkpoints y cuatro resoluciones. Ambas decisiones individuales siguieron ligadas a los bytes originales y a sus reparaciones. Costo de recuperación USD 0. CI y PostgreSQL pasaron también sobre el commit fusionado. A las 07:28 UTC del 8 de noviembre se reanudó la misma ejecución para los 29 grupos restantes y la consolidación. Saldo observado USD 16.74; margen de gasto USD 3.889336 bajo el tope editorial total de USD 10.
- [x] Recuperación de la cuarta parada · El 8 de noviembre a las 07:36:04 UTC, con 127 de 144 grupos en 43 checkpoints, se detuvo un lote de cuatro. Quedan 13 grupos sin procesar. Las 59 llamadas están liquidadas por USD 6.842181, con exposición cero. En el original había cinco interpretaciones: cuatro distintas y una repetición exacta. La reparación omitió referencias obligatorias de un grupo. Reconstruidas ambas solicitudes sobre sus 120 representantes, el validador ordinario acepta los cuatro originales al quitar sólo la copia idéntica. [#101](https://github.com/noisia-ai/monorepo/pull/101) se fusionó en `67c1c28d` con revisión de `d802799a`, CI y PostgreSQL verdes. Studio y el runner sirven ese commit en dev-test: 21 y 33 archivos cotejados, health HTTP 200, 256 migraciones sin diferencias y censo de 96,150 raíces intacto. La primera pasada sin proveedor recuperó los cuatro grupos desde su recibo original: 131/144, 44 checkpoints y cinco resoluciones. El contenido y la procedencia coinciden con el original; los 59 cobros conservan sus hashes. La segunda pasada produjo los mismos 44 checkpoints y las cinco resoluciones, sin débitos nuevos. El 8 de noviembre a las 08:07 UTC se reanudó la misma ejecución con 13 grupos pendientes y margen de USD 3.157819 bajo el tope de USD 10. El panel seguía mostrando USD 16.74, aún sin reflejar los seis últimos cobros.
- [x] Interpretaciones de grupo completas: 144/144 con las cinco excepciones resueltas. Las 64 respuestas de grupo se liquidaron por USD 7.369779.
- [x] Consolidación · La primera solicitud global se envió el 8 de noviembre a las 08:13:30 UTC y se interrumpió antes de recibir cabeceras. Anthropic Console confirmó HTTP 499 por desconexión del cliente a las 08:18:31 UTC, con 298.777 s de latencia, 32,808 tokens de entrada y 13,083 de salida. Se cotejaron los identificadores e importes de las cuatro solicitudes anteriores; el cierre del proveedor y el del runner difieren en 45 ms. No hay cuerpo de respuesta. A tarifa son USD 0.294669. La fuente, los identificadores y sus hashes se conservan en privado. Se registró el 499 en la misma fila y se liquidó mediante el uso auditado a tarifa, sin atribuirle un cuerpo de respuesta. Se verificaron los 144 grupos en 48 checkpoints y las 64 filas anteriores por hash después de ambas operaciones. Total confirmado USD 7.664448 y exposición pendiente cero. El saldo visible cayó de USD 22.85 a USD 15.19; el débito al centavo coincide con el ledger. Restan USD 2.335552 bajo el tope, suficientes para la reserva de USD 1.650324 de un único sucesor. El mapa y JEV siguen pendientes.
- [#103](https://github.com/noisia-ai/monorepo/pull/103), revisado en `9e5bad06`, se fusionó en `b3a849d3` tras CI y PostgreSQL verdes. Añade 0276 para exigir conciliación del intento global y el mismo origen antes de admitir su único sucesor. El revisor aprobó [#105](https://github.com/noisia-ai/monorepo/pull/105) en `4fa01e27` (transporte) y [#104](https://github.com/noisia-ai/monorepo/pull/104) en `183f8b03` (recibo). Se corrigió una diferencia entre el formato del snapshot y el exportador: las 65 filas reales pasaron su validación de uso y costo en una prueba privada sin proveedor. La fusión de #103 también pasó CI y las 68 pruebas de PostgreSQL, sin omisiones. #105 se fusionó en `8cf28943` tras ambos checks verdes. A las 09:04 UTC se inició el despliegue de ese mismo commit en los dos servicios de dev-test. El saldo editorial seguía en USD 15.19 a las 09:05. Studio y runner sirvieron ese commit con 22 y 34 archivos verificados, health HTTP 200. A las 09:09 UTC se aplicó sólo 0276: 257 migraciones sin diferencias ni pendientes, censo de 96,150 raíces y las 65 filas previas intactos. La misma ejecución se reanudó a las 09:09 UTC con saldo USD 15.19 y una sola reserva permitida por USD 1.650324. A las 09:12 UTC apareció un único envío global en curso. Se verificaron su vínculo al intento terminal, el mismo digest, configuración, importe reservado y lote de origen; las primeras 65 filas siguieron idénticas. CI y PostgreSQL pasaron sobre la fusión de #105. #104 se fusionó en `e048d9e9` tras ambos checks; en el checkout fusionado pasaron tanto el paquete sintético completo como la prueba privada de los 65 cargos ya liquidados. El sucesor terminó con HTTP 200 a las 09:18:53 UTC; costo USD 0.365034, 32,808 tokens de entrada y 17,774 de salida. Se sellaron las 66 filas completas y se verificó un total de USD 8.029482, sin reserva pendiente. El panel pasó de USD 22.85 a USD 14.82. El raw permanece intacto. Emitió 98 tópicos y 28 exclusiones; tres claves tenían una marca diacrítica y un grupo aparecía en dos tópicos. Se reconstruyó el digest de la solicitud desde los 48 checkpoints. Una proyección privada y sin proveedor pasó el validador ordinario: conserva los 98 textos editoriales, 116 grupos incluidos, 28 excluidos y los dos insuficientes en exclusiones. Falta registrarla como decisión específica, recuperarla por la ruta del producto y adoptar el mapa.
- Recuperación global en [#108](https://github.com/noisia-ai/monorepo/pull/108). El código sobre los mismos bytes pagados reproduce el digest de la proyección independiente de 98 tópicos; si se altera un carácter de la regla de adjudicación, rechaza la operación. Pruebas PostgreSQL sintéticas: 24/24 con las 258 migraciones. [#107](https://github.com/noisia-ai/monorepo/pull/107) prepara la auditoría del mapa y lee archivos grandes por partes; la prueba sintética de 576,732,664 bytes reprodujo el digest y produjo el recibo privado. El revisor aprobó #108 en `6563bf2e` y #107 en `ae5d6728`. #107 se fusionó en `1d453006` después de CI y PostgreSQL verdes, y #108 pasó ambos sobre su fusión. La prueba del archivo sintético de 576,732,664 bytes pasó en el checkout integrado. El exportador comprueba también que el autor y la ejecución coincidan con la decisión registrada. #106 pasó ambos checks sobre la fusión. #108 se fusionó en `31de0e8a` tras CI y PostgreSQL verdes; Railway inició el despliegue del mismo commit en ambos servicios de dev-test. A las 10:02 UTC se aplicó únicamente 0277: 258 migraciones, cero diferencias o pendientes, 96,150 raíces, ninguna ejecución activa y los 66 cobros intactos. El runner en `31de0e8a` reprodujo el catálogo de 98 tópicos desde los 48 checkpoints antes de la escritura. A las 10:06 UTC la ejecución quedó `ready`: 98 tópicos con 116 grupos incluidos y 28 excluidos. La repetición devolvió el mismo identificador de decisión, el mismo digest de salida y las 66 filas intactas, sin proveedor. El mapa se adoptó en dev-test: 98 tópicos y 83,962 raíces; su digest y la hora de congelación se verificaron en PostgreSQL. Sólo después de esa evidencia se abrió la comparación privada.
- [x] Hito 3 · Humo de JEV: 1,000 raíces únicas aplicadas, 666 positivas, 220 intermedias, 114 sin tópico, cero errores y cero exposición incierta. Uso a tarifa USD 0.104857. Las dos lecturas del saldo para el humo fueron USD 30.00. La estimación temprana de USD 8.804004 guió un tope acumulado revisado y no se presenta como costo real.
- [x] Hito 3 · JEV sobre todo el corte en dev-test: la misma ejecución continuó a las 12:47:41.801 UTC y liquidó la última raíz a las 14:31:51.262 UTC. Se aplicaron 83,962/83,962 raíces únicas: 1,000 bajo la autoridad original del humo y 82,962 bajo el permiso nuevo. Errores técnicos, fallos, resultados sin aplicar y exposición incierta: cero. Uso a tarifa JEV USD 8.821096 (humo USD 0.104857; corte completo USD 8.716239), bajo el tope acumulado USD 9.50. El uso no se equipara con caja: la cuenta mostró USD 30.00 antes y después del humo y USD 29.89/21.57 antes/después del corte; el cambio interetapas de USD 0.11 queda sin atribución. En las métricas agregadas de la credencial hubo exactamente 82,962 solicitudes adicionales y sus tokens coincidieron con el ledger; el indicador de gasto del panel se trata como estimación y no prueba un cargo. Voyage: USD 0 efectivo; Claude: USD 8.029482 a tarifa. Los 41 PR previos tienen CI y PostgreSQL verdes antes y después de integrar.
- [x] Hito 3 · Signal del piloto verificado en el Studio estable de dev-test. Los 98 tópicos y volúmenes de la pantalla coinciden con el lector de PostgreSQL; también coinciden los cinco ejemplos visibles del tópico principal en orden de probabilidad. El tópico de mayor volumen muestra 7,529 raíces. Studio sigue en el despliegue estable; el runner usa el commit `e79c63ee`. Los dos cambios propuestos a Studio permanecieron sin aplicar.
- [x] Hito 4 · Herramienta de auditoría [#80](https://github.com/noisia-ai/monorepo/pull/80) fusionada a `develop` en `d2f81802`. Revisor sin P0/P1/P2, CI y PostgreSQL verdes en `7c55787f`. La prueba recorre el contrato de H2 con datos sintéticos. La corrección [#85](https://github.com/noisia-ai/monorepo/pull/85), fusionada en 1990cfdc con revisión, CI y PostgreSQL verdes en 29d6f953, mezcla los 600 casos después del muestreo para que el orden del recibo no revele sus etiquetas. [#94](https://github.com/noisia-ai/monorepo/pull/94), fusionado en `90a032c2`, eliminó una búsqueda cuadrática al contar raíces únicas y redujo los cálculos de HMAC al ordenar la muestra. Los resultados reales esperan el mapa congelado y la clasificación.
- [x] Hito 4 · Cruce privado preparado después de congelar el mapa; los 98 alias y definiciones del recibo pasaron la comprobación de confidencialidad. La fuente privada conserva referencias, denominadores y criterios. El exportador validó contra el mapa real la decisión editorial y los 66 cargos.
- [x] Hito 4 · Recibo, comparación y muestras ciegas verificados. Se entregan el recibo público de una página y, en custodia privada, el anexo comparativo, método/fuentes, 600 casos en 11 cohortes y la clave sellada por separado. Son 597 raíces distintas por los solapamientos entre cohortes; cada cohorte cumple sus cuotas de 50 raíces por tópico para los 10 tópicos mayores y 100 de triggers/barriers. Las cohortes no representan evaluación de precisión humana.

## Sorpresas y descubrimientos

- La prueba de sustitución de políticas usaba dos relojes distintos. Tras una preparación larga, la política sintética aparecía como futura para la transacción aunque ya estaba vigente en el reloj real. La fixture se ancló a la hora transaccional y se verificaron ambos relojes; después pasaron 72/72 pruebas, sin omisiones. No cambió la guarda de concurrencia.

- La ejecución completa de JEV registró USD 8.821096 de uso tarifario bajo un límite acumulado de USD 9.50. El saldo de la cuenta disminuyó USD 0.11 entre las lecturas del humo y el corte; ese movimiento no puede atribuirse a una etapa. El contador de la credencial agregó 82,962 solicitudes y su volumen de tokens coincidió con el ledger; el gasto estimado del panel se conserva como una señal separada de la caja.

- La cotización previa de JEV (USD 6.188680) aproxima los tokens del texto y de los candidatos, más una constante por raíz. Las primeras 200 respuestas reales informaron 2,481 tokens por raíz: a la tarifa configurada proyectan aproximadamente USD 8.79 para el corte. Al cerrar el humo, el texto más candidatos promedió 4,137 bytes en las 1,000 raíces frente a 4,153 en todo el corte. Ajustar la proyección al tamaño medio del corpus da USD 8.82 (R² 0.883 sobre el humo), próximo a los USD 8.80 de la extrapolación directa. Es una estimación; el techo real se aplica sobre la exposición. Durante la pausa anterior al corte completo el saldo pasó de USD 30.00 a USD 29.89. En el panel de uso agregado aparecieron exactamente 1,000 solicitudes y 2,788,946 tokens adicionales: coinciden con los 2,484,406 de entrada y 304,540 de salida del humo. El indicador de gasto agregado no había variado todavía. Se conserva el movimiento de saldo como observado entre etapas. Una cotización de uso no sustituye la conciliación con el panel.

- La prueba de escala del permiso acotado reservó 200 raíces y las pasó a envío en 136 ms en PostgreSQL sintético. Hubo dos sumas completas de gasto, una por sentencia. En la revisión se detectó que mover directamente una llamada a otro dueño podía sustraerla del tope original; el SHA `0577bad3` bloquea moverla o volver a enviar una solicitud de estado incierto. El revisor verificó ambos negativos SQL y no dejó P0/P1/P2 abiertos. Un cargo ya incurrido sigue siendo conciliable aunque caduque la autorización.

- Railway dejó pendientes sólo la ruta de Dockerfile y el comando inicial de Studio; no hay otro servicio en esa propuesta. La cancelación conserva la versión estable que comparte el contrato de lectura del piloto.

- La guarda de política detectó una ejecución editorial en cola de otro workspace, aunque el piloto ya no tenía trabajos activos. La admisión de ese otro trabajo sigue vigente. Su antigüedad no es prueba de abandono.

- Railway devolvió HTTP 504 descargando las herramientas de compilación de Studio, antes de compilar la aplicación. El servicio anterior siguió sano (HTTP 200); el runner sí desplegó el nuevo commit.

- El grupo duplicado no requería escoger por similitud: el tópico con un solo grupo conservó su nombre exacto y su definición salvo una omisión interna; el otro tópico conservó íntegros el nombre y la definición de su otro grupo. Esto permite retirar sólo la pertenencia sobrante y conservar los dos tópicos.

- El plazo total del cliente era de diez minutos, pero su biblioteca de red tiene otro plazo para recibir cabeceras. Una prueba local reprodujo un corte antes del plazo total. El proveedor confirmó la desconexión del envío global; el runner no guardó el código de causa interno de esa llamada.

- Un rechazo por cantidad de registros puede conservar toda la evidencia. En el cuarto lote en cuarentena, las dos apariciones de un grupo eran idénticas, incluso en la serialización del objeto. La reparación posterior sí perdió información.

- La clasificación editorial cambió entre las dos respuestas, pero ninguna aportó referencias generales. El hermano se puede recuperar íntegramente sin interpretar de nuevo las muestras ni hacer otro envío.

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

- 2026-11-08 · Autorizar la continuación de la misma ejecución con techo JEV acumulado de USD 9.50 tras verde de CI/PostgreSQL, permiso prospectivo idempotente y nueva lectura del saldo por USD 29.89. Preservar las 1,000 raíces del humo bajo la primera autorización.
- 2026-11-08 · Mantener sin atribución por etapa la disminución interetapas de USD 0.11; cotejar los contadores de uso autenticados con las raíces y tokens del ledger y no presentar el gasto estimado como cargo en efectivo.
- 2026-11-08 · Cerrar los entregables públicos y privados tras verificar el export real, los 600 casos y el testigo de Signal en dev-test. Mantener separada y sellada la clave de respuesta.

- 2026-11-08 12:16 UTC · Separar el orden de integración: #113 puede avanzar con sus controles verdes mientras se diagnostica el rechazo de política en #114. La continuación pagada sigue cerrada.

- 2026-11-08 11:28 UTC · El humo pasó las tres puertas técnicas. Su uso medido supera el techo inicial si se extrapola. Para completar el corte con los mismos criterios, fijar un nuevo techo **acumulado** de USD 9.50 JEV: incluye los USD 0.104857 consumidos y las reservas pendientes; no se suma al techo previo de USD 6.97. Se proyectan USD 16.83 por uso en todo el piloto, frente a los USD 15 orientativos; el máximo combinado es USD 17.53. El saldo de JEV observado cubre el nuevo límite. El operador selló esta decisión. El permiso prospectivo, la revisión, PostgreSQL y una lectura nueva del saldo precedieron la continuación del mismo run. Se conservan exactamente los 1,000 recibos y el permiso previo; no se cambia el modelo, la metodología ni se compran créditos.

- 2026-11-08 · Conservar Studio estable en dev-test. No reintentar ni aplicar por otra vía los ajustes cancelados. El nuevo permiso de gasto requiere actualizar únicamente el runner y comprobar el servicio y el commit exactos.

- 2026-11-08 · El paquete privado conservará, junto al anexo, la metodología y las fuentes del cruce con un SHA verificable. Las etiquetas históricas por estrato no se presentan como prevalencia de menciones únicas. La clave de las muestras queda en custodia separada.

- 2026-11-08 10:10 UTC · Conservar la autorización, la cola y los datos del otro workspace. El intento de aprovisionamiento se revirtió íntegramente. No se autoriza saltar la guarda de rotación ni enviar al proveedor fuera del registro común. La comparación privada puede avanzar porque el mapa ya está congelado.

- 2026-11-08 10:09 UTC · La cotización con los ocho candidatos reales por raíz supera la estimación preliminar de USD 2–5. Se limitó JEV a USD 6.97 para conservar el total orientativo de USD 15. Se comprobarán las probabilidades, los errores y el débito observado tras 1,000 raíces antes de ampliar.

- 2026-11-08 10:02 UTC · Tras revisar el diff con un explorer, se conservó el Studio sano `8cf28943` como lector durante la recuperación. #108 no cambia sus rutas ni sus consultas de servicio. Sólo el runner `31de0e8a` registra la decisión, adopta el mapa o inicia JEV; se verificaron 22 archivos de Studio y 36 del runner antes de la migración.

| Fecha | Decisión | Razón | Autor |
|---|---|---|---|
| 2026-11-08 | Normalizar las tres claves técnicas retirando únicamente las marcas diacríticas. Conservar el grupo disputado en el tópico de un grupo y retirar sólo su copia del tópico de dos. Vincularlo mediante una decisión autorizada a los bytes y a las fuentes de esta respuesta. | Las 98 claves quedan válidas y distintas. Los nombres y definiciones de los 98 tópicos se conservan. La decisión se verifica contra los resúmenes sellados sin estimar afinidades ni hacer otro envío. | Orquestador |
| 2026-11-08 | Dar a la consolidación global hasta 20 minutos de transporte, manteniendo el modelo, solicitud, máximo de tokens, presupuesto y un solo sucesor. | Al ritmo observado en el envío interrumpido, generar los 32,768 tokens permitidos tomaría unos 12.5 minutos. Los diez minutos previstos podían cortar otra respuesta ya facturada. | Orquestador |
| 2026-11-08 UTC | Conciliar el intento global confirmado como terminal mediante su uso auditado; permitir como máximo un sucesor bajo el mismo tope y sólo después de cerrar la incertidumbre, con linaje y nueva reserva. | El proveedor demuestra que la conexión terminó antes de entregar un resultado. Esa llamada tiene coste, pero no produce un mapa. La reserva y el cargo deben quedar ligados al intento correcto. | Orquestador |
| 2026-11-08 UTC | Recuperar este lote desde el original sellado suprimiendo exclusivamente la copia idéntica. Exigir el mismo conjunto completo, el validador ordinario y el vínculo con los dos recibos de la excepción. | Los cuatro originales ya contienen referencias válidas de sus muestras. No hay que elegir entre registros diferentes ni declarar un tercer grupo insuficiente. Decisión individual bajo la delegación del fundador. | Orquestador |
| 2026-11-08 UTC | Declarar insuficiente sólo este grupo de la tercera parada. Evaluar por separado cualquier excepción posterior bajo la delegación del fundador. | Cada resolución exige comprobar los recibos sellados y conservar los grupos válidos. Ninguna decisión habilita una exclusión automática. | Fundador y orquestador |
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

El mapa del Estudio real A (cerveza, Brasil) quedó congelado en dev-test antes de abrir la comparación con el estudio entregado. Hay ocho candidatos para cada una de las 83,962 raíces elegibles. Los vectores tuvieron un cargo real de USD 0. BERTopic produjo 144 grupos; la consolidación asignó 116 a 98 tópicos y excluyó 28. Dos grupos insuficientes quedaron entre los excluidos. La etapa editorial registró 66 llamadas liquidadas por USD 8.029482, sin reservas pendientes. Repetir la recuperación produjo el mismo mapa sin llamadas adicionales.

El mapa quedó congelado en dev-test antes de abrir la comparación. Para las 83,962 raíces elegibles se conservaron ocho candidatos por raíz; BERTopic consolidó 144 grupos en 98 tópicos, con 116 grupos incluidos y 28 excluidos. El uso de Voyage tuvo cargo efectivo USD 0. La etapa editorial registró USD 8.029482 a tarifa y la recuperación no reenvió respuestas ya pagadas.

JEV procesó la misma ejecución desde las 12:47:41.801 UTC hasta la última liquidación a las 14:31:51.262 UTC. Las 83,962 raíces únicas quedaron etiquetadas, 1,000 bajo la autorización inicial y 82,962 bajo el permiso prospectivo de USD 9.50 acumulados. El uso tarifario total fue USD 8.821096, sin fallos, errores ni exposición incierta. La cuenta mostró USD 30.00 antes/después del humo y USD 29.89/21.57 alrededor del corte completo. La caída de USD 0.11 entre las dos etapas no tiene atribución; el gasto estimado del panel no se reporta como caja. El contador de la credencial sumó exactamente las 82,962 solicitudes y coincidió en tokens con el ledger.

En el Studio estable de dev-test, los 98 tópicos y sus volúmenes coinciden con PostgreSQL y los cinco ejemplos visibles del tópico de mayor volumen siguen el orden de probabilidad; ese tópico reúne 7,529 raíces. El recibo público es de una página. El anexo, método y 600 muestras en 11 cohortes, con 597 raíces distintas debido a sus solapamientos, fueron verificados en privado; la clave está sellada aparte. El plan y los artefactos presentan las muestras para revisión del auditor, sin atribuirles una validación de precisión humana.
