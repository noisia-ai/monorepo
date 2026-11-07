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
- [ ] Hito 1 · Perfil nuevo de BERTopic con prueba
- [ ] Hito 2 · Clasificador JEV, tablas y lectores de Signal
- [x] Hito 3 · Vectores del corpus completos en dev-test. En 14 min 17.739 s terminaron 83,962/83,962 raíces y 127,122/127,122 fragmentos. De éstos, 125,049 requirieron vectores y 2,073 usaron caché. Ledger de 999 llamadas liquidadas HTTP 200, 25,592,964 tokens y USD 3.071635 a tarifa. El primer panel posterior aún tenía 128,581,139 tokens gratis. Conciliar el delta final antes del recibo.
- [ ] Hito 3 · BERTopic con ≤ 200 tópicos
- [ ] Hito 3 · Claude por grupo
- [ ] Hito 3 · Prueba de humo de JEV con 1,000 raíces
- [ ] Hito 3 · JEV sobre todo el corte
- [ ] Hito 3 · Signal del piloto
- [ ] Hito 4 · Recibo, anexo privado y muestras

## Sorpresas y descubrimientos

- 2026-11-07 · El perfil se valida tanto en TypeScript como en Python. La interpretación anterior limita la muestra a diez raíces y el lector de Signal pagina por UUID. El piloto necesita pruebas de ambos extremos.

- La ejecución anterior dejó credenciales activas en el worker y la preparación vigente. La consola del modelo mostró 149,664,510 tokens gratis. La estimación R10 fue de 15,203,162 tokens.

- El consumo de vectores superó la estimación R10 en 68.3%. El panel continuó por encima de 120 millones de tokens gratis al cierre y actualiza con retraso respecto del ledger.

## Registro de decisiones

| Fecha | Decisión | Razón | Autor |
|---|---|---|---|
| 2026-11-07 | Pertenencia positiva con p > 0.7, negativa con p < 0.3 y sin clasificar en [0.3, 0.7]. | La aceptación dice «sobre 0.7». Un mismo criterio sirve al worker, Signal y el recibo. | Orquestador |
| 2026-11-07 | Iniciar vectores sobre el runtime ya validado mientras se implementan H1 y H2. | El cálculo y la admisión por el worker existente son independientes de los dos cambios. El panel superó el mínimo de 30,406,324 tokens gratis. | Orquestador |
| 2026-11-07 | Usar la misma identidad de raíz y solicitud para el humo y su continuación. Congelar los candidatos y centroides del mapa editorial antes del humo. | Evita reenviar solicitudes pagadas y permite comparar probabilidades. | Orquestador |
| 2026-11-07 | Ruta canónica ADR 015 con JEV como clasificador por mención; Claude sólo por grupo | Costo < USD 100 por estudio y alcance sobre el corpus completo | Fundador y auditor |

## Resultado y retrospectiva

(Al cerrar: qué se logró, qué faltó y qué sigue.)
