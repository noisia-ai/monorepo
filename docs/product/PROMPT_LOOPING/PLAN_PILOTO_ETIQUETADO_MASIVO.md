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

### Hito 5 · Ronda 13 de auditoría (dev-test)

La revisión privada R13, sección 7, fija diez entregables. La fase A cubre los puntos 1, 2, 3, 6 y 9. La fase B arranca después y cubre 4, 5 y 10. El punto 7 corrige la validación editorial y el 8 gobierna toda la operación.

- **1–2.** Reconsultar las 83,962 raíces sobre motivación o barrera de consumo nombrando la categoría (cerveza). Conservar la respuesta original y la revisada. Para el indicador usar sólo voz individual de consumidor, con promoción ≤0.7 y texto que no consista únicamente en hashtags. Retirar del nuevo cuestionario la relevancia genérica y publicar su distribución histórica.
- **3.** Signal distingue conversación, publicidad (promoción >0.7) y publicaciones que son sólo hashtags mediante una regla determinista. Documentar los denominadores y comprobar el comportamiento autenticado.
- **6.** Corregir el recibo y la comparación: mostrar relevancia histórica, cruces de motivación y promoción, coste por etapa y proyección con Voyage a tarifa, JEV por raíz y Claude por número de grupos. La comparación anterior acreditaba la presencia de dimensiones, no la recuperación de causas concretas. Entregar 100 nuevas muestras ciegas de motivadores y barreras de consumidor, con clave sellada aparte.
- **9.** Guardar nombre y definición originales, ingleses y españoles como ampliación del mapa. El producto muestra inglés por omisión y deja visible el original. El selector conserva el español. Los mapas futuros generan inglés canónico junto al original. Traducir el mapa congelado con una única solicitud editorial, sin modificar ninguno de los 98 tópicos, su digest, los vectores ni las asignaciones.
- **4.** Registrar Apostas y Racismo como intereses del analista, clasificar ambas dimensiones sobre todas las raíces y cuantificar la cobertura incremental sobre el corte anterior.
- **5.** Comparar 13 y 6–7 preguntas sobre las mismas 1,000 raíces y el mismo texto. Medir uso facturado por raíz y cambios de probabilidades en las preguntas compartidas frente al corte histórico; documentar qué muestra la prueba sobre la sobrecarga por pregunta.
- **10.** En las 597 raíces ciegas originales, comparar definiciones en portugués e inglés con la categoría nombrada. Entregar probabilidades por raíz y variante en el JSONL privado previsto por el auditor, sin clave. El auditor decide el idioma tras calificar.
- **7–8.** Emitir advertencias ante referencias editoriales faltantes o en exceso. Mantener comprobaciones de integridad y aislamiento. Operar únicamente en dev-test, con URLs introducidas directamente. Datos, autoridad de acceso, juicios ciegos y claves quedan en custodia privada.

### Hito 6 · Configuración de producto y QA del fundador (R14)

La sección 6 del informe privado R14 fija ocho entregables. Se usa el mapa congelado de 98 tópicos.

1. Un estudio nuevo toma de Brand OS su categoría y usa una solicitud JEV por raíz con preguntas en inglés de promoción, voz, motivador o barrera de esa categoría, los cuatro candidatos más próximos y los intereses activos. Los posts compuestos sólo por hashtags se reconocen de forma determinista.
2. Comparar definiciones de candidatos en inglés y en el original sobre las mismas 597 raíces, candidatos, preguntas y veredictos ciegos. En las cohortes etiquetadas de tópicos, seleccionar inglés si su precisión a probabilidad estrictamente superior a 0.7 queda a un máximo de tres puntos porcentuales por debajo de la del original. Conservar numeradores, denominadores y diferencia.
3. Generar una propuesta de léxico en la etapa editorial desde categoría, sinónimos, jerga y marcas de Brand OS. El analista puede editarla por estudio. Signal exige una coincidencia con el texto para contar motivadores y barreras. Recalcular el piloto con los resultados ya pagados.
4. Ajustar las definiciones de los dos intereses solicitados, reclasificar únicamente esos intereses y aplicar al conteo un umbral por estudio editable, inicialmente 0.85.
5. Retirar el lote obsoleto de dev-test y verificar la configuración activa y la versión de Studio. Conservar la alternativa Docker documentada.
6. Entregar una guía española de 10 a 15 pasos para QA en Signal, con resultados esperados y qué comunicar ante cada discrepancia.
7. Incorporar al recibo la proyección por millón con siete preguntas y el costo incremental de los intereses dentro de la misma solicitud.
8. Operar en dev-test con las cuentas autorizadas, custodia privada y URLs introducidas directamente. Verificar el recorrido normal de un estudio nuevo y los resultados del piloto en el dominio autenticado. Cerrar con revisión y CI/PostgreSQL sobre cada fusión.

### Hito 7 · Traslado a UAT (R15)

El fundador autorizó UAT para esta ronda. R14 es la referencia aceptada de dev-test. La entrega requiere una marca y un estudio nuevos por la interfaz, con CSV de la carpeta fuente en lectura, Brand OS, vectores, mapa nuevo, consolidación editorial, léxico, clasificación con dos intereses y Signal. Se compararán las dos poblaciones y se conservará el recibo de cada etapa en un paquete privado con SHA256SUMS. El presupuesto orientativo es USD 15–25.

Antes del estudio se revisan los commits exclusivos de UAT y se verifican tres cambios en develop: coincidencia de léxico materializada por raíz y revisión, propuestas de palabras y bigramas a partir de las voces con probabilidad ≥0.9 y muestras reproducibles por indicador. Las metas en el estudio de dev-test son ≤3 segundos para la vista general y ≤2 segundos para evidencia. Antes de migrar UAT se restaura un respaldo completo en una copia temporal y se compara el resultado de Signal de tres marcas históricas antes y después del ensayo. Studio y workers deben quedar en la misma cabeza de develop con Railpack y cero cambios preparados. Para workers-uat se selecciona el archivo Railway `/services/workers/railway.uat.json` y se fija `RAILPACK_CONFIG_FILE=services/workers/railpack.uat.json` en ese servicio. El plan de imagen incluye Python 3.12, libgomp1, el entorno virtual y las fuentes del motor. Studio usa `/apps/studio/railway.json`. La guía del fundador tendrá enlace al nuevo estudio. La salida a producción se limita a un plan escrito con verificación en lectura.

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

**Prueba en vivo de la ronda 15 en UAT.** Abrir el Signal del estudio desde una sesión autenticada. Contrastar los tópicos y volúmenes del mapa nuevo en Contenido total, Conversación, Publicidad y Hashtags. Verificar el inglés inicial, la vista de originales en portugués, ambos intereses, las muestras reproducibles y las sugerencias de motivadores y barreras. Registrar en el paquete privado el resultado de cada comprobación tras completar la clasificación.

**Calidad.** Se mide por muestreo; no es requisito de aceptación.

## Idempotencia y recuperación

- Las respuestas pagadas se guardan y nunca se reenvían.
- Las corridas tienen clave idempotente; repetir una corrida terminada no tiene efecto.
- Repetir BERTopic es gratis y crea una ejecución nueva sin borrar las anteriores.
- Si una etapa falla a medias, se reanuda desde lo guardado.

## Progreso

- [ ] Restauración de Monitoreo completo (2026-11-13): conectar sentimiento, estructura, plataformas, atención, drivers y destacados con la misma población nativa autorizada, y restablecer el carrusel y la generación de insights del workspace. Aceptación mediante datos reales y widgets visibles en UAT.
- Restauración · La lectura real confirma cobertura de sentimiento, roles, conversaciones, plataformas e interacciones en la población nativa. Los agregados pasan pruebas con PostgreSQL. El adaptador y los componentes pasan las pruebas focales en español e inglés y distinguen valores ausentes de ceros observados. PR181 permanece en revisión; no se ha desplegado este cambio. El ledger editorial y la comparación mensual siguen en construcción. Se preparó un PostgreSQL 17 sintético aislado, migrado hasta 0293, para ensayar 0294 sin afectar UAT.
- Restauración · El revisor aprobó PR181 en 0c7b0156, PR182 en 1a645ea8 y el corte integrado PR183 en 950772ac, sin P0/P1 pendientes. El corte integrado conserva las ramas revisadas y añade un gate de lectura para no consultar una API editorial todavía ausente. PR181 tiene CI y PostgreSQL verdes; las comprobaciones de PR183 siguen en curso. Los perfiles privados verificaron paridad de widgets a 33.930 s y ambas ventanas mensuales a 30.725 s, sin leer textos. La entrega de gráficos se separa de la posterior activación editorial; aún no hay despliegue ni aceptación de este corte en UAT.
- Restauración · PR183 se fusionó en da75d4b1 tras CI y PostgreSQL verdes; PR181 y PR182 también tienen ambos checks verdes. Se comprobó que la fusión tiene el mismo árbol que el head integrado revisado. Se inició únicamente Studio UAT en ese commit y se actualizó sólo su pin de fuente, sin cambios pendientes ni variables modificadas. La repetición de CI y PostgreSQL sobre develop continúa mientras se construye y se comprueba el runtime. Falta aceptación visual de los gráficos y la entrega editorial.
- Restauración · Studio UAT sirve da75d4b1 con health 200 y ambos workflows posteriores a la fusión verdes. El recorrido real Dashboard → estudio → Monitoreo → Menciones → ficha completó sin recargar; la lista conservó el segmento de conversación y sus 61,975 raíces. La prueba visual encontró un conteo erróneo en el donut, por lo que no se acepta todavía el dashboard completo. El revisor aprobó el hotfix PR187 en 1db9f043: conserva cobertura y muestra cada categoría real, con encabezados de destacados calculados de sus filas. La integración editorial reúne ese hotfix, el worker de PR184 y el owner de PR186; faltan el último ajuste de vigencia, la revisión final, CI y el despliegue conjunto.

- [x] Corrección posterior a R15 · En UAT `2c2f688e`, el recorrido autenticado Dashboard → estudio → Menciones mostró las 83,962 raíces y abrió una ficha sin recargar el documento. La navegación atrás y adelante y la entrada a Monitoreo desde la barra lateral mostraron el segmento de conversación de 61,975 raíces. La primera apertura directa de Monitoreo continúa pendiente de verificación tras la recuperación de red.

- [x] Corrección posterior a R15 (2026-11-12): verificado en UAT el recorrido Dashboard → estudio → Menciones → ficha, sin recargar ni reintentar manualmente. Verificada también una visita nueva al enlace directo de Monitoreo con filtros, con navegación funcional y volumen visible. Corte de producto ea0c6e38 (PR175 y PR177); evidencia privada de aceptación bajo studio-uat-navigation/first-load. Los checks posteriores a la fusión se registran en el recibo privado de integración.

- [x] H7 · Los once archivos de origen coincidieron por SHA-256. Con 83,962 raíces en cada entorno, dev-test y UAT comparten 83,958 identidades. Sus textos exactos coincidieron en todos los casos comunes. El anexo conserva los cruces entre los cuatro segmentos y la comparación del léxico, los intereses y las poblaciones de consumidores.

- [x] H7 · Se sellaron 600 casos ciegos para el auditor. Las diez cohortes de tópicos aportan 50 cada una y las de motivadores y barreras aportan otras 100. Son 598 raíces distintas por el solapamiento entre cohortes. Para cotejar las 22 causas del estudio de referencia se obtuvieron otras 100 raíces distintas, 50 por dirección, sin compartir raíz ni texto normalizado con las muestras ciegas. Las claves permanecen bajo custodia separada.

- [x] H7 · Studio y workers sirven `e043ffe4` en UAT, ambos con Railpack, salud verificada y cero cambios preparados. Desde el enlace habitual, los cuatro filtros mostraron 61,975 raíces de conversación, 21,716 de publicidad, 271 de sólo hashtags y 83,962 de contenido total. La acción «View details and examples» cargó 25 ejemplos. El nombre y la definición en inglés aparecieron junto a su fuente portuguesa.

- [x] H7 · El lector revisado del PR #166, integrado en `6c7e83c9` con CI y PostgreSQL verdes, reprodujo en dev-test los conteos y las etiquetas de R14 en los cuatro segmentos. En la primera serie, la primera consulta de conversación tardó 4.827 s. En la repetición registrada, tres pasadas por segmento dieron máximos de 1.437 s para el resumen y 0.754 s para evidencia. El anexo conserva ambas series.

- [x] H7 · El cotejo independiente terminó el 11 de noviembre a las 20:03 de Ciudad de México. Verificó los 83,962 cuerpos originales de JEV contra los recibos y las solicitudes por raíz en el mismo mapa. Coincidieron los 83,962 resultados y USD 5.796879, con cero discrepancias. La huella del ledger se mantuvo entre la primera y la última lectura.

- [x] H7 · Se ensayó el lector del PR #166 con el estudio terminado y el operador autorizado, en transacciones de sólo lectura de UAT. La consulta de resumen tardó 32.309 s para las 21,716 raíces de publicidad y 33.691 s para las 61,975 de conversación. La consulta de evidencia de motivadores tardó 30.160 s y entregó 30 filas.

- [x] H7 · La conversación mostró 61,975 raíces y ambos intereses. En la interfaz se obtuvieron 30 motivadores y 30 barreras. La segunda consulta de cada muestra reprodujo sus 30 filas en el mismo orden. La herramienta gratuita presentó 100 sugerencias de palabras o bigramas a partir de los resultados guardados, con umbral de 0.90.

- [x] H7 · Studio confirmó el cierre de JEV en UAT el 11 de noviembre a las 18:48 de Ciudad de México. Se liquidaron 83,962 solicitudes distintas por USD 5.796879 y se aplicaron 83,962 resultados a otras tantas raíces. El saldo de JEV pasó de USD 14.53 a USD 8.77 entre las observaciones de cuenta. La revisión independiente de cuerpos completos continúa.

- [x] H7 · El 11 de noviembre a las 17:24 UTC el worker recuperó la llamada original por USD 0.000067. El cotejo posterior conservó los hashes de las 27,399 llamadas y resultados anteriores y del error archivado. La misma ejecución alcanzó USD 1.892233 en las primeras 27,400 raíces. Studio confirmó la reanudación con 56,562 pendientes.

- [x] H7 · Se integró el PR #165 en `b2a81a0c` tras la revisión de `95aabe7c`. Pasaron CI y PostgreSQL del PR, 29 pruebas focales y las seis pruebas de PostgreSQL de esta corrección. El worker conserva el turno de una raíz hasta persistir su resultado. CI y PostgreSQL pasaron también sobre el commit fusionado. Studio y workers quedaron saludables en esa revisión con Railpack y cero cambios preparados.

- [x] H7 · La continuación alcanzó 27,400 solicitudes. Se liquidaron 27,399 por USD 1.892166 y una quedó pendiente de conciliación. La respuesta y su manifiesto se verificaron frente a la solicitud de nueve preguntas. El analizador confirmó 1,588 tokens de entrada, 294 de salida y USD 0.000067 de uso. Se sellaron las huellas del resto de la corrida antes de la recuperación.

- [x] H7 · La prueba nativa de UAT terminó con 1,000 raíces, 1,000 solicitudes distintas y 1,000 resultados válidos por USD 0.068894. La lectura independiente cotejó los 1,000 cuerpos completos con el registro de llamadas. Studio registró la continuación de la misma corrida el 11 de noviembre a las 13:05 UTC. Quedan 82,962 raíces en esta etapa.

- [x] H7 · CI y PostgreSQL pasaron también sobre el commit fusionado `df4c81d9`. UAT aplicó 0293 una sola vez y conservó el catálogo y los lectores de la copia ensayada. El worker recuperó la solicitud original y liquidó USD 0.000069. Las 199 llamadas y resultados hermanos mantuvieron sus huellas. El registro inmutable conservó la llamada incierta y el resultado de error originales. La primera página reúne 200 resultados y USD 0.013777 en uso tarifario.

- [x] H7 · El PR #164 se integró en `df4c81d9` tras revisión independiente de `444a60d6`. CI y PostgreSQL del PR pasaron. En la copia restaurada se aplicó 0293 una vez; una segunda aplicación reconoció las 61 migraciones del ledger. National, Alexa+ y Laika conservaron sus lecturas. El ensayo aislado comprobó una primera página de 199 liquidaciones y una respuesta incierta, dos intereses y tres sesiones concurrentes. Tras la recuperación, la misma ejecución completó la prueba de 1,000 y necesitó continuación explícita para las últimas dos raíces del ensayo.

- [x] H7 · Studio admitió la prueba inicial con una sola ejecución. De sus primeras 200 solicitudes, 199 quedaron liquidadas por USD 0.013708. La restante detuvo el worker. En lectura privada se verificaron los 948 bytes de la respuesta frente a su huella, las nueve preguntas congeladas y el analizador nativo. La liquidación de ese recibo y las otras 800 raíces de la prueba siguen pendientes.

- [x] H7 · El worker de UAT confirmó el mapa el 11 de noviembre. Studio mostró 83,962 raíces y 111 tópicos. La comprobación privada encontró los mismos 138 grupos incluidos, 20 exclusiones, textos localizados y huellas que en el catálogo editorial. Los 57 recibos pagados permanecieron idénticos. Se completaron los 84 lotes con un promedio de 43.06 s y un máximo de 51.05 s por inserción.

- [x] H7 · El PR #163 se integró en `50bf8f44` tras revisión independiente del código y de las pruebas. CI y PostgreSQL quedaron verdes en el PR y en el commit fusionado. En PostgreSQL 17, con 83,962 raíces y 129 términos, el cálculo y la escritura de los candidatos en 84 lotes tardaron 127.731 s con estadísticas representativas y 170.428 s con estadísticas frías. Las sentencias más largas tardaron 2.502 s y 3.239 s, respectivamente. Las nueve pruebas de la ruta nativa pasaron. Queda por medir la adopción real en UAT.

- [x] H7 · Studio y workers de UAT sirven `004e4331` con Railpack. Se verificaron ambos procesos, el avance del heartbeat, HTTP 200 y cero cambios preparados. El cálculo de puntuaciones terminó en el octavo intento sobre el corpus real. La consulta que prepara los paquetes de candidatos agotó 120 s. PostgreSQL revirtió la transacción y los recibos editoriales siguen sumando USD 8.412135.

- [x] H7 · En PostgreSQL 17, el cambio de adopción del PR #162 conservó los ocho candidatos de cada raíz, el orden de desempate, los fragmentos y sus huellas. Con 83,962 raíces, 127,117 fragmentos y 111 tópicos sintéticos, la puntuación tardó 6.568 s y la escritura con índices y proyecciones tardó 45.331 s. El revisor aceptó el SQL y el ajuste posterior de las pruebas en `7a34dca4`. CI y PostgreSQL pasaron en el PR y en la fusión `004e4331`. La adopción real en UAT sigue pendiente.

- [x] H7 · En UAT, la consulta revisada del PR #154 devolvió las tres guías del mapa en 44.145 s. En PostgreSQL, la prueba de 83,962 raíces comprobó la equivalencia de centroides, huellas de entrada y fragmentos. El PR #155 evita una segunda lectura de todas las guías para consultar el tamaño del corpus al iniciar el análisis.

- [x] H7 · La consulta de «Datos recibidos» del PR #153 pasó revisión, CI y PostgreSQL antes y después de la fusión a `develop` en `23dc6f46`. La copia restaurada devolvió los mismos conteos y errores de reconciliación para tres workspaces.

- [x] H7 · Los PR #148 y #149 pasaron CI y PostgreSQL antes y después de la fusión. En UAT, el cotejo de lecturas por lote de 500 candidatos bajó de 10.7–11.8 s a 0.11–1.41 s, con igual número de filas. La prueba sintética verificó igualdad de campos y aislamiento entre workspaces.
- [x] H7 · La migración 0291 se ensayó sobre la copia restaurada y se aplicó una vez en UAT. La repetición verificó los 59 asientos. Cambiaron las definiciones de dos funciones. Los permisos, los resultados históricos y el acceso a su evidencia coincidieron. GitHub midió 19.564 s para cerrar un lote sintético de 95,100 filas con una población semántica en borrador.

- [x] H7 · Los PR #132–#145 pasaron CI y PostgreSQL en la solicitud y tras la fusión a develop. Studio y workers de UAT arrancaron con Railpack en `966528b3`. Se comprobaron la salud de Studio, el latido del worker y que Railway tenía cero cambios preparados.
- [x] H7 · En dev-test, seis lecturas de la vista general tardaron entre 1.516 y 1.704 s. Tres recargas en el navegador tardaron 2.406, 2.035 y 2.938 s. La primera observación dio un límite superior de 3.156 s. Los indicadores mostraron 30 ejemplos en 1.485–1.826 s.
- [x] H7 · La marca y su Brand OS existen en UAT. Studio aceptó once archivos con 113,338 registros. El cotejo privado verificó los once SHA-256, tamaños y conteos contra los originales. El archivo de 95,100 filas tiene un recibo aceptado y conserva sus cuatro intentos fallidos. Studio y workers sirven el commit de integración `b9dbd456` del PR #150, con CI y PostgreSQL verdes antes y después de la fusión.
- [x] H7 · UAT completó la preparación el 9 de noviembre a las 18:01, hora de México. Procesó 96,150 raíces, con 83,962 elegibles y 12,188 excluidas. Generó 127,117 fragmentos, sin raíces pendientes ni bloqueadas por derechos.
- [x] H7 · Studio y el ledger confirmaron los vectores de 83,962 de 83,962 raíces y de 127,117 de 127,117 fragmentos. Se liquidaron 998 respuestas con 25,591,524 tokens y USD 3.071449 a tarifa. Voyage mostraba USD 0.00 de costo en noviembre al cerrar esta etapa.
- [x] H7 · Studio y workers de UAT ejecutan `3217854e`, con Railpack, salud verificada y cero cambios preparados. Los PR #154 y #155 pasaron CI y PostgreSQL en la solicitud y en cada fusión. Topics consultó las guías en 43.332 s. El inicio desde el producto recibió HTTP 202 en 91.249 s con un único recibo para 83,962 raíces.
- [x] H7 · El PR #157 pasó revisión, CI y PostgreSQL en la solicitud y tras fusionar a `3ceb6598`. El predicado del worker se comprobó sobre la cola de UAT en lectura. Coincidió una sola ejecución. Studio y workers arrancaron con Railpack en esa revisión y cero cambios preparados. El mismo recibo pasó de «En cola» a «Preparando conversaciones».
- [x] H7 · El motor exportó 83,962 raíces y 127,117 fragmentos. El ajuste numérico terminó con 158 grupos y dejó un punto de recuperación antes de la interpretación.
- [x] H7 · Los PR #158 y #159 pasaron revisión, CI y PostgreSQL antes y después de integrarse. Studio y workers sirven `57f3544d` con Railpack, salud y cero cambios preparados. «Reanudar análisis» respondió HTTP 202 en 46.250 s. El worker recibió la segunda generación de la misma ejecución con su punto de recuperación.
- [x] H7 · Se completó la interpretación de los 158 grupos. Hay 52 puntos de control y 56 respuestas de grupo liquidadas por USD 7.257105. El recibo global añadió USD 1.155030. La primera reserva sin envío conserva gasto cero.
- [x] H7 · La cabeza revisada del PR #160 pasó CI y PostgreSQL y se integró en `99f8bcff`. En la copia restaurada, la migración 0292 cambió sólo el cuerpo de la función que verifica las decisiones de recuperación. Se conservaron sus permisos y los lectores históricos dieron los mismos resultados. La repetición verificó las 60 entradas del ledger sin aplicar DDL.
- [x] H7 · La migración 0292 se aplicó una sola vez en UAT. El catálogo coincide con la copia, los lectores históricos conservaron sus resultados y CI y PostgreSQL quedaron verdes sobre la integración. Studio y workers sirven `99f8bcff` con Railpack y cero cambios preparados.
- [x] H7 · Studio reanudó la misma ejecución con HTTP 202 en 54.230 s. El motor terminó con la respuesta global original. Los 57 recibos liquidados y su importe permanecieron idénticos. UAT conserva la propuesta editorial de 97 términos distintos y una revisión de analista con 129 términos, dos intereses activos, idioma inglés y umbral 0.85.
- [x] H7 · Se materializaron los candidatos por raíz, se completó JEV, se verificaron los cuatro filtros de Signal y se sellaron la comparación de poblaciones y las muestras ciegas.

- [x] H7 · La lectura optimizada de Signal pasó la comprobación en los cuatro segmentos del estudio de dev-test. En seis mediciones intercaladas, la vista general tardó de 1.570 a 2.570 s y la evidencia de 1.027 a 1.621 s. La medición posterior de la página desplegada figura arriba. [PR de la consulta](https://github.com/noisia-ai/monorepo/pull/142)

- [x] H7 · UAT aplicó las 58 migraciones ensayadas desde 0221 hasta 0290, una vez cada una. La comprobación antes de la primera escritura cubrió 371 tablas y 2,611,029 filas. PostgreSQL confirmó que seguían coincidiendo con el respaldo. Al terminar, la huella del catálogo y las nueve vistas coincidían con la copia ensayada. Los lectores históricos conservaron sus datos y se verificó la repetición del sello de dos generaciones. CI y PostgreSQL pasaron para el PR y la integración 13b6330c.

- [x] H7 · El ensayo final aplicó 58 migraciones en la copia restaurada, verificó los 58 asientos al repetir y selló dos transiciones históricas. Las tres marcas devolvieron los mismos resultados que el UAT original. La comprobación previa al corte volvió a encontrar las 371 tablas y 2,611,029 filas con sus huellas intactas.

- [x] H7 · En dev-test, la migración 0288 conservó las pertenencias de las 83,962 raíces en una comparación SQL en ambos sentidos. Los cuatro segmentos conservaron los 98 tópicos y los dos intereses. La muestra y la página siguiente fueron reproducibles.

- [x] H7 · La [sugerencia gratuita de léxico](https://github.com/noisia-ai/monorepo/pull/134) presentó 100 términos del corpus aceptado de dev-test. Veintidós fueron bigramas y dos de las tres expresiones señaladas por la auditoría aparecieron en el corte. La migración 0287 pasó en la copia de UAT.

- [x] H7 · La [credencial editorial del piloto](https://github.com/noisia-ai/monorepo/pull/137) se resuelve en la comprobación previa de Studio y en las llamadas por grupo y consolidación del worker. El ensayo de la migración 0286 en la copia terminó con un asiento nuevo y su repetición verificó todos los asientos.

- [x] H7 · El respaldo completo de UAT se restauró en una copia con PostgreSQL 17.6, la misma distribución, locale y permisos efectivos. Coincidieron las huellas de datos de las 371 tablas comprobadas (2,611,029 filas). La primera tanda de 53 migraciones pasó en la copia. Una segunda ejecución verificó los 53 recibos sin volver a aplicar DDL.
- [x] H7 · El inventario separó los 17 commits exclusivos del Studio desplegado en UAT del recibo posterior en la rama. El plan de producción documenta 69 commits exclusivos de main y 1,034 de develop al corte R14, además del cotejo del catálogo real en una transacción de sólo lectura. Véase [línea de UAT y plan de producción](R15_UAT_LINEAGE_AND_PRODUCTION_PLAN.md).
- [x] H7 · La migración 0286 ya materializa el léxico en dev-test. En conversación, la evidencia de motivador bajó de 40.280 s a 4.701 s y la de barrera de 39.586 s a 4.352 s. La vista general aún tardó 19.411 s. Las consultas y la página se volvieron a medir después de optimizar el lector.

- [x] H7 · Se leyó la auditoría R15, se identificaron los destinos de Railway y Supabase y se midió la referencia en dev-test. Conversación tardó 18.925 s en la vista, 40.280 s en evidencia de motivador y 39.586 s en barrera. Con todo el contenido tardaron 24.036, 33.646 y 37.632 s respectivamente.
- [x] H7 · Se respaldó UAT y se ensayaron las migraciones en copia. La aplicación y su repetición verificaron el ledger. Se conservaron las lecturas de las tres marcas históricas y se verificaron el producto, la comparación y los recibos.

- [x] H6 · El despliegue de Studio y del worker de dev-test desde `0c33eb05` sirvió los resultados desde el dominio habitual. Se probaron los cuatro filtros, cinco ejemplos por indicador y ambos intereses. Se dio de alta una marca ficticia en su propia organización desde el formulario normal, con el etiquetado activo y umbral inicial de 0.85.

- [x] H6 · Dev-test aplicó las migraciones 0282–0285 tras verificar las 262 huellas anteriores. La importación validó 167,924 puntuaciones contra sus entradas y recibos. Las huellas del mapa, los centroides y las asignaciones históricas volvieron a coincidir con R13.
- [x] H6 · El lector de Signal devolvió los mismos 98 tópicos con sus traducciones y volúmenes en los cuatro filtros. Los primeros cinco ejemplos de cada indicador coincidieron en identidad y orden con la consulta independiente. En conversación, 18,464 de las 50,273 voces elegibles mencionan un término del léxico.

- [x] H6 · Una segunda prueba, con 80 raíces sintéticas en cuatro grupos de 20, ejecutó el worker desde la cola hasta el mapa y el léxico editorial bajo el mismo cliente. La prueba usó PostgreSQL 17 con las 266 migraciones y sustituyó sólo el proceso numérico y los transportes externos. El motor, los permisos y el registro de costos siguieron su ruta de producto.

- [x] H6 · Un cliente administrador creó una marca por la misma función que usa el formulario. En PostgreSQL migrado, el flujo procesó cinco raíces sintéticas mediante cinco solicitudes de nueve preguntas cada una. El mismo actor conservó la autoridad hasta la publicación en Signal. La prueba recuperó dos interrupciones y verificó el conteo de envíos.

- [x] H6 · Se verificaron 83,962 raíces únicas con las dos definiciones ajustadas. A probabilidad ≥0.85 hubo 436 positivas para apuestas, 153 para racismo, una en ambas y 588 en la unión. El costo tarifario de las tres etapas JEV fue USD 2.365666. La única propuesta editorial de léxico costó USD 0.011658. Total medido R14 USD 2.377324.
- [x] H6 · La propuesta de 156 términos se revisó hasta dejar 102. La comprobación independiente del texto completo encontró 18,464 coincidencias y 31,809 exclusiones entre 50,273 voces elegibles. Se conservaron 4,174 motivadores, 842 barreras, 7,889 respuestas negativas y 5,559 intermedias.

- [x] H6 · Prueba pareada de idioma completada sobre las 597 raíces originales. Se verificaron 1,194 recibos con siete preguntas base y dos intereses por solicitud. Las diez cohortes de tópico aportaron 500 casos, de los cuales 333 tenían el tópico nominado entre los cuatro candidatos. A probabilidad >0.7, inglés obtuvo 220 aciertos en 316 positivos (69.62 %) y portugués 222 en 326 (68.10 %). La diferencia fue +1.52 puntos. Se eligió inglés. Los otros 100 casos eran de motivación o barrera.
- [x] H6 · Se descartó el lote antiguo de dev-test. La consulta posterior de Railway devolvió cero recursos pendientes, Railpack activo y el mismo despliegue sano de Studio. La opción Docker sigue documentada en el repositorio.
- [x] H6 · Se completaron los ocho puntos de la sección 6. El worker de dev-test quedó en `0c33eb05` y Studio en `489ea782`. La guía del fundador reúne 13 pasos de QA. El último despliegue se verificó en el dominio habitual con la configuración activa de Railway.

- [x] H5 · Fase B terminada en dev-test. Se cotejaron 171,118 recibos JEV y la única solicitud de traducción. El paquete privado contiene el anexo corregido, 100 nuevas muestras ciegas, las muestras históricas necesarias para interpretar los identificadores, la prueba pareada y 1,194 filas de variantes PT/EN. Cada distribución se verificó contra el cuerpo original del proveedor. La clave sellada se conserva aparte. El recibo y los manifiestos se reprodujeron con el mismo SHA-256. El auditor decide el idioma tras calificar.
- [x] H5 · [#117](https://github.com/noisia-ai/monorepo/pull/117), [#118](https://github.com/noisia-ai/monorepo/pull/118), [#119](https://github.com/noisia-ai/monorepo/pull/119), [#120](https://github.com/noisia-ai/monorepo/pull/120), [#121](https://github.com/noisia-ai/monorepo/pull/121), [#122](https://github.com/noisia-ai/monorepo/pull/122) y [#123](https://github.com/noisia-ai/monorepo/pull/123) se revisaron y fusionaron a develop. En dev-test se verificaron las 262 migraciones, la proyección editorial y dos casos del worker que producen advertencias con una sola llamada simulada y cero reparaciones. PostgreSQL de CI probó las rutas V1/V2 sobre una base vacía.
- [x] H5 · Studio sirve el commit revisado `0495cadd` en la URL habitual de dev-test. Railway confirmó el despliegue y el proceso en ejecución devolvió el SHA completo y salud HTTP 200. Una sesión autenticada abrió en inglés con conversación seleccionada y 98 tópicos. Se cotejaron el nombre y la definición en inglés y en portugués de dos tópicos con sus registros sellados. Los cuatro filtros respondieron. En «All content», los dos intereses mostraron 562 y 304 raíces. El comprobante de la sesión quedó en la custodia privada.

- [x] H5 · Los dos intereses del analista quedaron definidos en dev-test con 167,924 resultados, dos por cada una de las 83,962 raíces. Apuestas tuvo 562 positivas, 290 fuera de la cobertura previa. Racismo tuvo 304 positivas, 169 fuera de esa cobertura. El cruce entre los dos intereses fue cero. El costo conjunto fue USD 2.226360 a tarifa.

- [x] H5 · Se aplicó 0280 en dev-test después de contrastar el inventario y los checksums de las 260 migraciones anteriores. Se importaron 98 localizaciones y 83,962 resultados revisados. El checksum posterior del mapa, sus centroides y los resultados históricos coincide con el obtenido antes de la reconsulta. El exportador del auditor produjo dos veces el mismo recibo y el mismo sello. Las 100 muestras incluyen 50 motivadores y 50 barreras, con cero raíces compartidas con los 597 casos anteriores.

- [x] H5 · El export nativo confirmó 61,524 raíces de conversación, 22,167 de publicidad y 271 compuestas sólo por hashtags. Dentro de conversación hay 50,273 voces individuales elegibles. Las 1,000 solicitudes históricas de la prueba de costo se reconstruyeron con la misma identidad y el mismo contexto. La reconsulta de [#117](https://github.com/noisia-ai/monorepo/pull/117) liquidó las 83,962 solicitudes. El export cotejó cada recibo original y registró 47,449,091 tokens de entrada y 3,529,017 de salida, con USD 2.033079 de uso tarifario redondeado por llamada. El panel JEV mostraba USD 21.22 antes y USD 19.71 al terminar. Entre las 50,273 voces elegibles hubo 4,711 motivadores, 1,163 barreras, 36,061 sin señal y 8,338 en el intervalo intermedio, según la probabilidad de la opción escogida.

- [x] H5 · R13 iniciada el 2026-11-08 desde la entrega aceptada (#116). Informe privado leído completo. El exportador autenticado del runner volvió a materializar las 83,962 raíces desde el mapa congelado, las 1,000 parejas de costo y las 597 raíces de idioma. Una única solicitud editorial tradujo los nombres y definiciones de los 98 tópicos al inglés y español: 10,774 tokens de entrada, 19,526 de salida y USD 0.325212 a tarifa. Se verificaron el catálogo de origen y la correspondencia de las 98 filas. Este fue el punto de partida de la ronda. Los resultados y la comprobación del dominio están registrados arriba.

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

- 2026-11-13: el adaptador nativo sólo llena volumen y tópicos sobre una plantilla vacía, declara estructura no disponible y deja sentimiento, plataformas, atención e insights sin conectar. Los accesos nativos fijan canRefreshInsights=false; la acción anterior depende de un output legado. Los vacíos de la interfaz no demuestran por sí mismos ausencia de datos importados.
- Restauración · Las observaciones del proveedor se repiten entre importaciones; sumarlas directamente inflaría las métricas. La primera consulta completa rozó los 60 segundos. Reutilizar la metadata canónica ya leída y evitar un fallback sin candidatos redujo el tiempo a 36 segundos conservando los valores. La comparación editorial requiere calcular ambas ventanas en una misma población materializada. No existen clasificaciones de emociones ni recibos editoriales mensuales previos de este workspace.
- Restauración · La revisión encontró que el segmento explícito «Contenido total» de Menciones conservaba el camino global recibido. Se corrigió la distinción entre la ausencia del filtro legado y los cuatro segmentos explícitos del mapa; PostgreSQL comprueba una raíz recibida fuera del mapa y una divergencia del SHA preparado. El vocabulario abierto de content_type exigió tratar los roles desconocidos explícitamente.
- Restauración · El donut compartido interpreta sample_size como conteo de la categoría. El adaptador entregaba el total clasificado en los tres buckets, aunque sus valores SQL individuales eran correctos. Las primeras pruebas de componentes no comprobaban esa leyenda. La reproducción montada en español e inglés ahora comprueba números distintos por categoría, su suma, cobertura y desconocidos; también verifica el número real de destacados. La aceptación en UAT se repetirá tras publicar el arreglo.

- Verificación final posterior a R15: las 50 primeras filas de Menciones y su ficha abrieron sin recargar. La visita directa de Monitoreo también completó con métricas. Las interrupciones transitorias exigían una pausa entre intentos; una espera inmediata repetía el fallo durante el cambio de red.

- Corrección posterior a R15 · La apertura directa sufrió `ERR_NETWORK_CHANGED` durante el documento. Dos solicitudes de Monitoreo finalizaron como HTTP 499 en 552 ms y 2,129 ms. Sus duraciones distinguen esa interrupción de una consulta que agota su plazo. La prueba montada también necesitó separar la compilación inicial de los módulos del tiempo dedicado al recorrido.

- 2026-11-12: la pantalla de Monitoreo vacía reportada corresponde al fallback de ruta, con navegación decorativa todavía sin enlaces. Chrome registró ERR_NETWORK_CHANGED en el documento. El flujo SPA de Menciones convierte una excepción de transporte en no disponible y no tiene recuperación automática. El éxito tras recargar documentado anteriormente no satisface la apertura inicial requerida.

- H7 · El total de raíces elegibles coincide entre entornos aunque hay cuatro identidades exclusivas en cada uno. Entre las comunes, 1,005 pasaron de publicidad en dev-test a conversación en UAT y 556 hicieron el recorrido contrario. Los 271 casos de sólo hashtags permanecieron en ese segmento. Para las cuatro identidades exclusivas por entorno, los registros de importación acreditan cuatro pares de versiones de texto que comparten un identificador de proveedor. Los dos entornos cargaron los archivos en orden contrario. El importador conservó la primera versión y registró la posterior como duplicada.

- H7 · El cambio de filtro devolvió HTTP 500. Studio agotó en diez segundos la espera por una conexión mientras consultaba el rol del usuario. La interfaz también solicitaba detalles de tópicos en segundo plano al recibir un resumen nuevo. El cierre de esa petición en el navegador podía dejar la consulta en curso en PostgreSQL.

- H7 · Al cambiar de conversación a publicidad, Signal conservó el segmento anterior y mostró un error. Las tres consultas de resumen observadas en PostgreSQL tardaron entre sí una media de 75.7 s y un máximo de 107.6 s. El plan estimaba una raíz en una etapa que debía atender 83,962. Los lectores esperaban páginas de datos. Las observaciones no mostraron un bloqueo de otra transacción.

- H7 · La primera navegación completa a Signal perdió la conexión mientras cargaba. El enlace de Studio abrió después la conversación con 61,975 raíces, 111 tópicos y dos intereses. La preferencia explícita del operador era español. Con la preferencia en inglés, el detalle mostró el nombre y la definición inglesa junto al original portugués.

- H7 · Con un límite aplicado sólo a las solicitudes del proveedor, las respuestas de una página podían pasar juntas a Storage. La prueba de una página retuvo los turnos hasta completar la persistencia, tanto con dos turnos configurados como con ocho.

- H7 · En la nueva parada, Storage ya tenía tanto la parte como el manifiesto. La lectura de verificación del manifiesto recibió HTTP 429 cuatro veces. En los 32 segundos inspeccionados, Storage registró 90 lecturas y 27 escrituras rechazadas con 429. El límite del proveedor deja de contar una solicitud cuando entrega la respuesta, antes de que termine su guardado.

- H7 · Los registros de Storage de la llamada identifican la operación que se interrumpió. La escritura de la parte devolvió HTTP 200; su lectura de verificación devolvió HTTP 429 antes de crear el manifiesto. Los 199 cuerpos liquidados se verificaron por lectura independiente y sumaron USD 0.013708.

- H7 · El worker marcó una solicitud como incierta aun cuando Storage había guardado los bytes completos. Faltó el manifiesto. El prefijo corresponde a esa llamada y el SHA-256 del objeto coincide con el del contenido completo. La respuesta HTTP 200 contiene uso equivalente a USD 0.000069.

- H7 · En el ensayo de estadísticas frías, el cálculo de coincidencia de categoría generó 83,964,001 filas intermedias para 1,000 raíces. El plan de ejecución atribuyó 38.91 s a ese trigger. El cambio probado redujo el intermedio a 83,965 filas con estadísticas frías y a 1,000 con estadísticas representativas. Se comprobó la restauración de la configuración de la conexión tanto al confirmar como al fallar.

- H7 · En UAT, una vez calculadas las puntuaciones, el servidor identificó `CREATE TEMP TABLE mass_map_items` como la siguiente consulta que excedió el límite. El registro de PostgreSQL a las 07:54:22 UTC contiene el código 57014. Esa consulta todavía reunía en una tabla temporal los textos localizados de las 83,962 raíces antes de empezar las inserciones por lote.

- H7 · La corrida de 83,962 raíces del PR #162 en GitHub superó el límite de 600 s. En una base nueva con las 273 migraciones y las variables de CI, la misma revisión terminó en 84.48 s. La causa específica del tiempo del runner queda abierta. La nueva prueba ordinaria inserta tres lotes y verifica el rollback de cuatro proyecciones después de interrumpir dos lotes. El ensayo completo con 84 lotes sigue disponible y pasó en 85.73 s.

- H7 · Al probar el volumen realista de texto localizado, una única inserción superó 90 s aun con las puntuaciones optimizadas. Con lotes de 1,000 raíces, el mayor tardó 655 ms en PostgreSQL local. Los 84 lotes se confirmaron en una sola transacción.

- H7 · Tras el cierre editorial, la consulta que ordena los ocho tópicos más próximos a cada raíz agotó el límite del servidor. PostgreSQL registró el código 57014 en la creación de la tabla temporal de puntuaciones. La transacción revirtió el mapa incompleto. La propuesta editorial ya estaba guardada en su propia revisión.

- H7 · La revisión del control de recuperación detectó que la cola todavía exigía una admisión financiera vigente para despachar un recibo ya pagado. La prueba cubre ahora todo el recorrido tras revocar esa política. La prueba separada de expiración usa una admisión de corta duración. En la primera ejecución de CI el montaje tardó 57.6 s y agotó su ventana inicial de 30 s.

- H7 · La respuesta global llegó completa y pasó la verificación de integridad. El validador detectó dos grupos mixtos asignados tanto a un tópico individual como a una exclusión justificada. En otro tópico encontró dos versiones inglesas que diferían por tres caracteres. El worker se detuvo antes de materializar el mapa.

- H7 · Tras el ajuste, Studio mostró «0 de 158 grupos» y USD 0.00 confirmados y reservados. La autoridad de procesamiento del estudio seguía vigente; el worker conservaba una fecha global del 9 de septiembre para la ruta histórica.

- H7 · El motor quedó «En cola» con cero intentos de despacho. La guarda del worker para los pilotos privados excluía también la ejecución creada por Studio. El cotejo en UAT encontró un solo trabajo de producto afectado, con admisión y actor vigentes.

- H7 · En «Analizar conversaciones», las dos primeras variantes de la consulta de guías alcanzaron el límite de 55 s en las pruebas de lectura. Calcular una vez por texto los límites UTF-16 y reunir las huellas coincidentes antes de leer los vectores permitió obtener las tres guías dentro del límite. La versión anterior había agotado los 120 s de la ruta normal.

- H7 · La lectura de «Datos recibidos» en UAT devolvió el mismo recibo antes y después del PR #153, con 50.7 s y 51.5 s respectivamente en las dos mediciones directas. El ahorro observado en la copia restaurada no se reprodujo en ese par de lecturas de UAT. La actualización del panel autenticado completó con HTTP 200 en 48.6 s.
- H7 · La consulta que combina los textos de los fragmentos y sus vectores para calcular las guías del mapa seguía activa a los 118.4 s en UAT. Topics no pudo confirmar que el corpus estaba listo después de completar los vectores.

- H7 · En la copia, 131,432 búsquedas por clave de mención consumieron 41 de los 42.5 s de la consulta de preparación. Leer las raíces una vez por workspace redujo la medición a 4.8 s. La lectura original se midió primero, por lo que la diferencia incluye el efecto de caché.

- H7 · Después de aceptar los once archivos, la pantalla de importación mostró las 113,338 filas. El panel «Datos recibidos» falló al cargar en dos intentos y ocultó el botón para preparar el texto.

- H7 · El cuarto intento leyó el CSV completo en unos 26 minutos. PostgreSQL alcanzó el límite de 120 s durante la verificación de una clave foránea al materializar las atribuciones de origen, antes de iniciar la reconciliación de poblaciones. Los cuatro cierres fallidos conservaron su historial.

- H7 · El archivo de mayor tamaño falló dos veces al esperar una conexión. Tras desplegar el PR #144, el worker leyó el archivo completo. Durante el cierre, PostgreSQL devolvió `57014` al reconciliar por raíz la pertenencia a poblaciones semánticas. Studio conservó el archivo y los tres intentos.

- H7 · La ruta autenticada de la versión de referencia tardó 19.537 s en mostrar la lista de tópicos. En los cuatro filtros, las consultas SQL original y optimizada devolvieron los mismos datos dentro de una misma lectura de PostgreSQL. En todo el contenido, la consulta optimizada tardó 2.545 s en la primera medición y entre 1.352 y 1.490 s en tres repeticiones.

- H7 · Entre las 23:30 y las 23:59 de México, una prueba editorial solicitaba treinta minutos de autorización aunque la política vencía al cerrar el día. PostgreSQL rechazó correctamente esa solicitud en cuatro casos del commit integrado. Una lectura experimental en dev-test que reúne población y permisos en una sola pasada devolvió los mismos campos y bajó de 1.78–1.82 s a 1.24–1.46 s en tres pares.

- H7 · Con la migración 0290, cinco de seis lecturas de la vista general quedaron por debajo de 3 s. Una tardó 3.630 s. Las doce lecturas de evidencia tardaron entre 0.982 y 1.204 s. La página de Signal también esperaba la consulta de detalle y de ejemplos del primer tópico. Se seguirá midiendo la ruta autenticada y la lectura del indicador de forma independiente.

- H7 · Con 0288 la vista de conversación llegó a 2.991 s. La de todo el contenido tardó 3.073 s y los ejemplos de motivadores tardaron 2.127 y 2.052 s respectivamente. El plan de ejecución atribuyó unos 0.75 s a contar los candidatos en JSON cada vez que se comprobaba la cobertura.

- H7 · La credencial editorial general de UAT devolvía 401 y había una tarea histórica en cola. La credencial dedicada respondió correctamente. Esto permitió aislar el acceso del piloto y conservar el estado del trabajo editorial histórico.

- H7 · Sobre la misma copia y los mismos datos, una marca histórica perdió el indicador de actualidad y el acceso a la evidencia con el lector de develop. Se localizó una diferencia entre la huella de contexto que sellaba el lector desplegado y la que calcula el compilador actual. La paridad se comprueba tanto en el lector nativo como en el de reportes históricos.

- H7 · El ledger Drizzle de UAT contiene 30 entradas hasta 0029. También existen objetos posteriores y un asiento administrado por Supabase. El número de migraciones pendientes requiere comparar los objetos reales y las operaciones de cada archivo.

- H6 · Al volver a escribir el nombre canónico de T3, Signal recuperó el texto visible pero conservó una personalización redundante. La prueba comprobó el volumen y la huella del mapa y motivó verificar la eliminación del alias desde la interfaz.

- H6 · La primera prueba del estudio nuevo omitía el cuerpo del proceso hijo. Se exigió un marcador posterior a la publicación y cero pruebas omitidas. El recorrido descubrió fallos en el alta de la política, el acceso a embeddings y la validación automática de la muestra inicial.
- H6 · Una prueba histórica de revisión editorial falló a las 23:58 UTC al dar diez minutos de autorización que excedían la medianoche presupuestaria. Se corrigió el huso horario del dato sintético. El contrato de vencimiento conservó sus comprobaciones.

- H6 · La industria amplia del perfil no siempre corresponde a la categoría que debe nombrar la pregunta de consumo. Se usó la categoría específica del estudio y se conservaron los nombres de Brand OS como insumos editoriales. Las exclusiones por léxico quedan visibles en el denominador.

- H6 · Los jueces de R13 coincidieron en 95 de 100 casos nuevos. En barreras, 22 de los 33 textos con término de categoría eran correctos, frente a 1 de 17 entre los que carecían de término. La auditoría motiva el filtro textual y una comprobación de sus ejemplos en Signal.

- H5 · La sesión de prueba conservaba una preferencia explícita de español. Al retirar únicamente la cookie de idioma del navegador de dev-test, Signal abrió en inglés. Una petición nueva con preferencia HTTP de español también recibió el documento en inglés. En la sesión autenticada, publicidad y hashtags mostraron cero consumidores elegibles. Conversación y el total mostraron 50,273.

- H5 · La comparación pareada reprodujo exactamente los 2,489.144 tokens de entrada medios de la solicitud histórica de 13 preguntas. Con siete preguntas fueron 1,411.381, un ahorro de 43.30 %. En las 15,000 probabilidades compartidas, la diferencia absoluta media fue 0.008901 entre los dos brazos. La prueba respalda el costo adicional de esas seis preguntas en este corpus.

- H5 · Una consulta de Signal tardó varios minutos al volver a calcular las pertenencias de cada raíz. En el corpus completo, añadir el filtro de workspace al mismo recorrido tardó 22.9 segundos. Calcular las pertenencias una vez y reutilizarlas tardó 10.0 segundos y devolvió los mismos 98 términos y las mismas cantidades por clase.

- H5 · La prioridad de hashtags cambia la lectura de publicidad. De las 22,254 raíces con promoción superior a 0.7, 87 eran sólo hashtags. La revisión del recibo detectó además que su primera versión agregaba todas las voces al indicador de consumidores. El recibo debe usar los conteos del subconjunto elegible y mostrar su denominador.

- R13: el contraste ciego detectó publicidad y referencias a otras categorías en motivadores históricos. La relevancia genérica correlacionaba con la mención de marca. Se conserva el corte original para medir la diferencia. De las 34,403 decisiones históricas de motivación, 21,201 tenían promoción >0.7 y 13,202 quedaban por debajo o en el umbral; sólo 731 de 83,962 raíces superaban 0.7 en relevancia.

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

- 2026-11-13: restaurar los widgets existentes con agregados del mismo ámbito nativo y sus derechos, evitando unir métricas de una población legada distinta. Medir disponibilidad de cada fuente antes de mostrarla y adaptar la generación editorial al workspace con presupuesto, idempotencia y permisos.
- Restauración · Mantener disponibles por separado las métricas de conversaciones y roles; la ausencia de cobertura produce un valor nulo y «—». Los insights conservarán idioma y segmento, con ventanas reales de treinta días independientes del periodo de página, una sola llamada y un tope visible de USD 2 por paquete. El saldo verificado fue USD 6.07, con recarga automática desactivada. La lectura y el polling no llaman al proveedor ni recalculan toda la población. ADR032 documenta el owner nativo y su contabilidad durable.
- Restauración · Entregar primero los gráficos con el runtime editorial deshabilitado y activar después el owner editorial revisado. Usar NOISIA_MONITORING_INSIGHTS_ANTHROPIC_API_KEY sólo para esta función, sin modificar la credencial general de otros procesos. Delegar el runtime, transporte y drainer de workers al agente de producto en una rama separada; el agente crítico conserva SQL, fuente, owner, rutas y provisión de permisos. El orquestador conserva fusiones, migración real, despliegues y la única etapa pagada.
- Restauración · La aceptación exige contrastar los conteos que ve el usuario, además de la paridad del DTO y el lector. La vista previa editorial publica el paquete determinista de la cotización sin pagar; debe conservar workspace, ámbito, segmento, idioma y hash antes de mostrarlo. La confirmación pagada sigue siendo una acción separada y mantiene la misma identidad ante un resultado incierto.

- Corrección posterior a R15 · Esperar 1.5 s antes del segundo intento permitido para una lectura afectada por un fallo de transporte o HTTP 502, 503 o 504. La espera se cancela al abandonar el recorrido. Cada intento conserva su límite de 60 s y los errores de permisos, alcance o filtros se devuelven inmediatamente. La aceptación de la apertura directa se confirmará desde el navegador de UAT.

- 2026-11-12: entregar primero el shell autorizado para los enlaces explícitos all_conversations y cargar sus datos mediante las APIs existentes. Recuperar lecturas ante interrupciones transitorias con intentos acotados y cancelación por navegación. Verificar montaje real del componente y recorrido autenticado de UAT antes de cerrar.

- H7 · El cotejo usa dos instantáneas de sólo lectura y la procedencia que consulta Signal en cada entorno. Se informa por separado si coincide la identidad de una raíz, el texto exacto y el segmento que el lector le asigna. La comparación de causas mantiene su muestra independiente de la reservada al auditor.

- H7 · El anexo mide la cobertura sobre las 83,962 solicitudes ya cotejadas. Leer el ledger con páginas ordenadas por UUID repetía el recorrido de datos. En una página de 128 llamadas, pedir sus identificadores verificados devolvió exactamente las mismas filas y huellas en 0.396 s frente a 17.827 s. La validación conserva los permisos, los resultados y la huella completa del ledger.

- H7 · Mantener el esquema ya ensayado hasta 0293. Con una proporción de páginas visibles comparable a UAT, la consulta especializada bajó de 148,084 a 43,021 bloques en la prueba local. Añadir un índice de procedencia dio el mismo resultado. Se optó por corregir la lectura y la solicitud automática de detalles.

- H7 · Corregir la consulta que impide cambiar de segmento desde la interfaz. El ensayo local debe conservar los permisos por raíz, el universo de cada segmento, los intereses y el orden de las muestras al reducir las lecturas. Se mantiene el resultado pagado ya liquidado.

- H7 · Conservar las 600 muestras ciegas en su paquete sin clave. Para la comparación de causas, seleccionar otras 100 raíces mediante los lectores paginados de Signal. Verificar que las dos muestras provengan del mismo mapa y que sus raíces y textos normalizados sean disjuntos.

- H7 · Para JEV v2, admitir hasta ocho raíces simultáneas y respetar un límite de proveedor menor cuando esté configurado. En el adaptador nativo de Storage de JEV v2, un HTTP 429 sin `Retry-After` exige una espera mínima de tres segundos. Si llega el encabezado, se utiliza la ventana indicada dentro de los límites de reintento. El tope de gasto, la identidad de la llamada y su autorización se conservan.

- H7 · Mantener detenida la misma ejecución hasta que el worker concilie el recibo. Limitar en el producto el número de solicitudes que pueden estar simultáneamente en evaluación, guardado o verificación. Probar el límite con una página completa y conservar el permiso y la identidad de cada raíz.

- H7 · Continuar las 82,962 raíces restantes con la autorización acumulada de USD 13.50. Las primeras 1,000 dieron 638 raíces con tópico positivo, 221 intermedias, 141 sin tópico positivo ni intermedio y cero errores técnicos. Su uso permite proyectar USD 5.72 adicionales; el saldo visible de JEV era USD 14.53.

- H7 · Reintentar de forma acotada sólo la operación de Storage al recibir 429. La conciliación nativa exige el cuerpo completo, la huella, la raíz, las preguntas y la tarifa originales. Registra el error anterior, liquida el uso medido y actualiza la proyección en una transacción. El botón de reanudar conserva la autorización inicial de 1,000 raíces.

- H7 · Recuperar la respuesta desde la parte privada ya verificada mediante el camino nativo del worker. Mantener la reserva hasta aplicar la liquidación y conservar la ejecución y la identidad de la raíz. Reanudar la prueba desde la interfaz una vez comprobado el comportamiento ante reintentos y respuestas ambiguas.

- H7 · Iniciar la prueba de 1,000 raíces con tope total USD 13.50 y saldo JEV observado de USD 14.53. La estimación nativa de USD 18.303339 incluye el paquete almacenado de ocho candidatos en tres idiomas. JEV recibe cuatro en el idioma elegido. La continuación se decidirá a partir del gasto real y de las métricas de la prueba.

- H7 · Conservar la agregación global de vectores antes de dividir las distancias y los paquetes por rangos. Un ensayo con cancelaciones numéricas detectó cambios en 276 puntuaciones al aplicar antes el filtro de rango. La versión revisada conserva los bits del promedio y de las puntuaciones en los casos de paridad, y calcula el tamaño presupuestable a partir de las filas que se insertan.

- H7 · Preparar y escribir cada lote de candidatos en la misma transacción, conservando un ordinal global por raíz. Se medirá el coste por sentencia además del tiempo total y se compararán los paquetes, huellas y empates con la consulta original.

- H7 · Mantener la comparación exacta, el rollback y la cancelación de la conexión en cada ejecución de PostgreSQL. Ejecutar también el volumen completo en una base desechable y guardar su recibo. El revisor comprobó ambas pruebas en `7a34dca4`.

- H7 · Reutilizar los 111 centroides y dividir por ordinal la escritura de candidatos dentro de la misma transacción. El lector recibirá el mapa completo al confirmar. Se mantienen el límite de tiempo y las reglas de ordenación y de acceso.

- H7 · Curar la propuesta editorial una vez persistida, mientras se resuelve el cálculo de candidatos. Las 98 entradas recibidas contenían 97 términos distintos. La configuración de analista incorpora 27 adiciones frente a los 102 términos de referencia. El catálogo editorial y sus recibos conservan sus huellas.

- H7 · Permitir que el worker reciba una recuperación sin gasto cuando existe la decisión sellada del mismo actor y estudio, con el recibo y la fuente verificados. La ruta que sí puede enviar solicitudes sigue requiriendo autoridad financiera vigente. El recibo privado compara los registros monetarios antes y después.

- H7 · Conservar las dos exclusiones justificadas. En ambos casos el tópico individual repetía el nombre y la definición del grupo mixto. Para la discrepancia inglesa se eligió la definición inglesa del bloque de localización del mismo recibo. La prueba sin proveedor conservó 138 grupos incluidos y 20 excluidos, con 111 tópicos y 98 términos de categoría. La respuesta original queda intacta y la adopción por Studio requiere la misma solicitud y los mismos puntos de control.

- H7 · Recuperar la interpretación sobre la misma ejecución y su recibo de autorización vigente. Se conserva el límite histórico de las otras rutas y el resultado numérico ya calculado.

- H7 · Conservar la ejecución creada en Topics y su recibo. El worker recogerá el asiento pendiente al reconocer el contrato de producto y su admisión. Los pilotos privados siguen su ruta de operador.

- H7 · Para dimensionar el mapa se usa la cantidad de raíces del recibo de vectores que Studio envía al iniciar el estudio. La admisión revalida la revisión vigente, los permisos, la configuración y las guías dentro de la transacción. Las pruebas incluyen una repetición de la solicitud original después de crear otra corrida de vectores.

- H7 · Programar el despliegue de la consulta entre el cierre de vectores y el inicio del mapa. Así el worker que custodia cada respuesta de Voyage termina su ejecución antes del relevo.

- H7 · El tope de vectores se fijó en el mínimo admitido por la cotización, USD 33.229264. Antes del envío, Voyage mostraba 124,071,546 tokens gratuitos disponibles para el modelo. Se contrastarán los tokens y el costo a tarifa del ledger con el uso efectivo de la cuenta al cierre.

- H7 · Conservar la única importación aceptada por archivo. Investigar la consulta del resumen y usar los controles autorizados del producto para preparar el corpus.

- H7 · El PR #150 reserva un cliente de PostgreSQL únicamente para cerrar lotes verificados de al menos 50,000 registros. El tiempo local de ejecución se calcula a 12 ms por registro, con mínimo de 15 min y máximo de 25 min. La espera de locks se limita a 15 s. Si se pierde la confirmación, el worker consulta y reconcilia el resultado durable antes de habilitar la recuperación. Los archivos pequeños siguen la ruta previa. La prueba utiliza la misma autenticación SCRAM que CI.

- H7 · El timeout del worker de UAT es 120 s. La prueba de escala conserva las 95,100 filas, un borrador semántico y los controles de derechos. Se fijó un límite de 90 s para GitHub después de que la primera ejecución agotara su límite sintético de 30 s. El tiempo observado se guarda con el perfil de PostgreSQL. El cierre del archivo real se acredita mediante su propio recibo.

- H7 · Conservar los recibos fallidos y recuperar el archivo desde el historial de Studio. Ensayar el cierre en PostgreSQL con un lote de tamaño comparable, verificar la semántica de la reconciliación y confirmar los once recibos antes de iniciar las etapas con proveedor.

- H7 · El corte de UAT se fijó en el último commit ensayado que incluye DDL. La optimización SQL de lectura pudo integrarse en paralelo una vez verdes los dos checks de ese corte, porque el manifiesto de migraciones permanecía idéntico.

- H7 · Ajustar la solicitud sintética al cierre de la política y probar el borde de medianoche con un reloj controlado. La caducidad que aplica el producto sigue vigente. Antes de desplegar la consulta optimizada se verifican el alcance de permisos, los cuatro segmentos y la página autenticada completa.

- H7 · La cardinalidad de candidatos se puede calcular en el momento de insertarlos. El lector seguirá comprobando las filas físicas antes de servir el estudio. Los archivos de entrada de UAT se cotejarán por digest con las once importaciones aceptadas para conservar su fuente, su zona horaria y el origen declarado de cada consulta.

- H7 · Las proyecciones de lectura deben conservar los candidatos sin puntuación, las correcciones humanas y los permisos vigentes. La comprobación de dev-test compara los cuatro segmentos con los conteos aceptados y repite la muestra para comprobar que sus ejemplos y su paginación son reproducibles.

- H7 · Conservar la credencial editorial histórica de UAT. El servicio tiene trabajo anterior en cola; el perfil de etiquetado masivo usará la credencial dedicada tanto para la comprobación previa de Studio como para los envíos del worker.

- H7 · Ensayar en una copia de PostgreSQL 17.6 con la misma distribución de Supabase que UAT. Mantener los archivos de respaldo, las definiciones de roles y los resultados por marca bajo custodia privada.

- H6 · Aislar los fallos de materialización por ejecución. Un mapa vacío tiene un estado terminal y una lectura fallida se reintenta con espera. El worker recupera la medición de la muestra y la publicación a partir de los recibos del mismo actor y estudio.

- H6 · Cuando el analista restaura ambos nombres canónicos de un tópico, el guardado elimina la personalización. Una prueba autenticada en Studio confirmó el cambio temporal y su restauración. La lectura posterior en PostgreSQL verificó que la personalización quedó vacía y el mapa conservó su huella.
- H6 · Elegir las definiciones canónicas en inglés con la regla preestablecida de diferencia ≥ −3 puntos. El comparativo dio +1.52 puntos. El original sigue disponible para consulta.
- H6 · Conservar como léxico términos de categoría, variantes lingüísticas y nombres inequívocos. Retirar expresiones de consumo genéricas, locales y marcas ambiguas. Contar sólo raíces cuyo texto completo contiene un término y mantener el umbral de interés inclusivo en 0.85.
- H6 · La alternativa Docker usa `apps/studio/Dockerfile.mfp-dev-test` y `apps/studio/start-mfp-dev-test.sh` con el commit revisado. Railpack sigue siendo la configuración activa de dev-test.

- H6 · Para medir idioma y reclasificar intereses se incluyen ambos intereses activos en los dos brazos de las 597 raíces. Se conserva el brazo en inglés para la importación de ese subconjunto. Para las 83,365 raíces restantes sólo se preguntan los dos intereses. Se identifican los recibos por raíz y digest para que la contabilización de intereses cuente una única consulta compartida.
- H6 · Usar inglés para las preguntas JEV de todos los corpus y umbral 0.7 para los tópicos. La comparación pareada determina el idioma de las definiciones. Mantener los vectores, BERTopic y el mapa del piloto congelados.

- H5 · Se publicó `0495cadd` una sola vez en `mfp-studio` de dev-test con la configuración activa. El CLI permite elegir un commit para ese despliegue. Railpack completó la construcción y el lote Docker quedó pendiente. La entrega documental de [#124](https://github.com/noisia-ai/monorepo/pull/124) conserva el recibo cuantitativo.

- H5 · Railway canceló la aplicación del lote de configuración pendiente de dev-test. La base contiene los resultados revisados. Se comprobó el componente real de Signal con datos del lector autorizado en ese entorno y se registró por separado la verificación del dominio en vivo. Se reservó cualquier publicación posterior para una operación limitada al servicio de Studio.

- H5 · El validador SQL utiliza la clase Unicode canónica en PostgreSQL 17 de dev-test. Para que el smoke de PostgreSQL 16 ejecute la misma migración, selecciona la collation ICU disponible en la instalación. Se verificaron casos de espacios y alfabetos no latinos. Las marcas combinantes aisladas pueden diferir entre ambas bibliotecas.

- R13 (2026-11-08): retirar relevancia genérica en el cuestionario revisado y mantener su distribución como diagnóstico histórico. El punto 1 pregunta únicamente por la relación de consumo de cerveza; los filtros de voz y promoción reutilizan las probabilidades existentes. El mapa, los vectores y el ajuste de BERTopic permanecen congelados.

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

- Reparación de apertura inicial posterior a R15: aceptados el recorrido desde Dashboard, ficha de Menciones, historial nativo Atrás/Adelante y enlace directo de Monitoreo. Las lecturas conservan permisos y alcance y tienen reintentos acotados. Las consultas siguen tardando decenas de segundos en UAT; la corrección evita depender de la recarga manual.

En el cotejo R14–R15, los once archivos de entrada coinciden, las 83,958 raíces comunes conservan el mismo texto exacto y hay cuatro exclusivas de cada entorno. El mapa pasó de 98 a 111 tópicos. La configuración curada de UAT conserva los 102 términos previos y suma 27. Los dos intereses conservan su definición y umbral de 0.85. Para contrastar la calidad del resultado se sellaron las 600 muestras ciegas y se reservó una segunda muestra de 100 para contrastar las causas documentadas por el estudio humano.

La clasificación completa de R15 produjo 83,962 resultados en una corrida desde Studio UAT. Las 1,000 raíces iniciales y su continuación sumaron USD 5.796879. El cotejo de los cuerpos originales verificó ese importe y cada resultado. El uso total a tarifa fue USD 17.280463. Signal abrió el mapa de 111 tópicos y mostró los cuatro segmentos. La cobertura, los tiempos y los volúmenes están en el [recibo público de R15](DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_R15_2026-11-11.md).

En la continuación en UAT, una lectura del manifiesto dejó pendiente una de 27,400 solicitudes. Se verificaron los bytes originales y se registró el importe que el worker debe conciliar, USD 0.000067. El worker liquidó ese recibo y Studio reanudó la misma ejecución con las 56,562 raíces restantes. La versión `b2a81a0c` acota la concurrencia hasta persistir cada raíz.

El corte de base de datos de R15 terminó en UAT con el mismo catálogo que la copia ensayada. Los resultados y el acceso a evidencia de las marcas históricas coincidieron antes y después. Studio y workers ya sirven desde la misma revisión. Studio aceptó los once archivos y preparó el texto de 83,962 raíces elegibles. El recibo de preparación registra 127,117 fragmentos. El worker completó los vectores de todo el corpus. Studio y workers pasaron a `3217854e` con Railpack y cero cambios preparados. Topics admitió un único mapa en la ruta normal de UAT. El worker de `3ceb6598` recogió ese asiento y completó el ajuste numérico con 158 grupos. La primera reserva quedó sin envío. En `57f3544d`, la interfaz reanudó la misma ejecución con su admisión vigente y su resultado numérico conservado. La interpretación completó los 158 grupos. Se liquidaron USD 8.412135 en total por la interpretación y la consolidación global. El motor recuperó el catálogo en UAT sin aumentar ese importe. Studio guardó la propuesta y la curación del léxico. En `50bf8f44`, Studio muestra el mapa de las 83,962 raíces. Se comprobaron los candidatos y la configuración de analista y se solicitó la prueba inicial de JEV desde la interfaz. La primera página dejó 199 recibos liquidados y una respuesta guardada cuyo manifiesto quedó pendiente. Se verificaron en privado su huella, su uso y las nueve respuestas contra la solicitud original. En UAT, la recuperación nativa liquidó ese mismo recibo y conservó íntegros sus 199 hermanos.

### Ronda 14

En una marca nueva, el alta crea la configuración de etiquetado por omisión. El clasificador reúne promoción, voz, motivador o barrera de la categoría y cuatro candidatos en una solicitud en inglés por raíz. Los intereses activos se añaden a esa misma solicitud. Si Brand OS ofrece varias categorías posibles, el analista especifica la categoría del estudio en **Labeling settings**. En una organización ficticia creada desde la interfaz se comprobó el umbral inicial de 0.85 y su edición.

Se eligieron las definiciones inglesas por la diferencia observada de +1.52 puntos sobre el original en las diez cohortes de tópico. Con el léxico de 102 términos, los motivadores y las barreras representan 4,174 y 842 de 18,464 raíces con mención de categoría. Las dos definiciones de interés ajustadas cubren 588 raíces distintas a 0.85. Estos conteos describen el piloto y la comparación de idiomas conserva su denominador propio.

El [recibo canónico](DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_2026-11-08.md) enlaza el [detalle de R14](DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_R14_2026-11-08.md). El uso tarifario medido de R14 fue USD 2.377324. La proyección de siete preguntas es USD 107–112 por millón de raíces, más USD 7.50 por interés. Con los dos intereses usados en el piloto, es USD 122–127. El paquete privado conserva la comparación, las huellas de validación y las muestras ciegas de las rondas anteriores.


En R13 el recibo público corrige la proyección histórica a USD 151.17–156.19 por millón de raíces para 180–270 grupos, con USD 153.68 en el escenario de 225. Las 171,118 solicitudes JEV adicionales consumieron USD 4.452242 a tarifa. La traducción consumió USD 0.325212 y la ronda sumó USD 4.777454. El saldo visible JEV pasó de USD 21.22 antes de la ronda a USD 17.04 después de los experimentos. El panel actualizó el saldo con retraso. Los recibos del proveedor sustentan los importes tarifarios por etapa.

Las 100 muestras nuevas quedaron separadas de la custodia y las variantes recuperan las tres probabilidades de JEV para las 597 raíces de la muestra original. El SHA-256 del recibo público final es `9dc789047d57a190e96bc2e9117fc8b23d4846f590c4c054d63040460d220aab`. Los datos históricos, candidatos, mapa y centroides conservaron sus huellas tras las importaciones. El lector de dev-test confirmó 98 tópicos y dos intereses en los cuatro segmentos. La revisión de idioma se hizo sobre el componente real de Signal con ese lector. La verificación autenticada en la URL habitual completó la aceptación de R13. Signal abrió por omisión en inglés, conservó los originales portugueses y aplicó los cuatro filtros con los denominadores del lector. La calificación ciega y la elección entre las variantes de idioma corresponden al auditor.

El mapa del Estudio real A (cerveza, Brasil) quedó congelado en dev-test antes de abrir la comparación con el estudio entregado. Hay ocho candidatos para cada una de las 83,962 raíces elegibles. Los vectores tuvieron un cargo real de USD 0. BERTopic produjo 144 grupos; la consolidación asignó 116 a 98 tópicos y excluyó 28. Dos grupos insuficientes quedaron entre los excluidos. La etapa editorial registró 66 llamadas liquidadas por USD 8.029482, sin reservas pendientes. Repetir la recuperación produjo el mismo mapa sin llamadas adicionales.

El mapa quedó congelado en dev-test antes de abrir la comparación. Para las 83,962 raíces elegibles se conservaron ocho candidatos por raíz; BERTopic consolidó 144 grupos en 98 tópicos, con 116 grupos incluidos y 28 excluidos. El uso de Voyage tuvo cargo efectivo USD 0. La etapa editorial registró USD 8.029482 a tarifa y la recuperación no reenvió respuestas ya pagadas.

JEV procesó la misma ejecución desde las 12:47:41.801 UTC hasta la última liquidación a las 14:31:51.262 UTC. Las 83,962 raíces únicas quedaron etiquetadas, 1,000 bajo la autorización inicial y 82,962 bajo el permiso prospectivo de USD 9.50 acumulados. El uso tarifario total fue USD 8.821096, sin fallos, errores ni exposición incierta. La cuenta mostró USD 30.00 antes/después del humo y USD 29.89/21.57 alrededor del corte completo. La caída de USD 0.11 entre las dos etapas no tiene atribución; el gasto estimado del panel no se reporta como caja. El contador de la credencial sumó exactamente las 82,962 solicitudes y coincidió en tokens con el ledger.

En el Studio estable de dev-test, los 98 tópicos y sus volúmenes coinciden con PostgreSQL y los cinco ejemplos visibles del tópico de mayor volumen siguen el orden de probabilidad; ese tópico reúne 7,529 raíces. El recibo público es de una página. El anexo, método y 600 muestras en 11 cohortes, con 597 raíces distintas debido a sus solapamientos, fueron verificados en privado; la clave está sellada aparte. El plan y los artefactos presentan las muestras para revisión del auditor, sin atribuirles una validación de precisión humana.
