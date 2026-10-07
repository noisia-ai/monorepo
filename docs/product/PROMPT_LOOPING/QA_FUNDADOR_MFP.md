# QA del fundador — MFP

Fecha: 7 de octubre de 2026. Frente 5 de la revisión 4. Canon: spec MFP v1.3,
§§4, 6 y 9.8; `AUDIT_MFP_2026-10-04.md` §10.5. Esta guía describe el recorrido
esperado. La evidencia de ejecución al final acredita los pasos efectivamente recorridos.

## Preparación

- Abrir [Studio MFP dev-test](https://mfp-studio-dev-test.up.railway.app).
  Usar la sesión habitual de Kinde y comprobar el dominio antes de escribir.
- Corte base: PR #38, `9bc7ff9d3e6a4c6aa2491c31313a5f6b81efd142`.
  H1 #39 requiere un despliegue posterior coordinado; no está incluido en ese corte.
- Usar una marca nueva desechable y una organización de desarrollo. No reutilizar
  marcas históricas ni presentar esta prueba como evaluación semántica acreditada.
- Corpus privado existente: `load1.csv` y `load2.csv` en
  `/Users/brandhon_o/Downloads/noisia-website/.data/dev-corpus/`.
  Conservar identidad y procedencia de las menciones; no versionar el corpus.
- El operador técnico verifica previamente: Studio y un único Worker con el mismo
  corte, base y cola MFP privadas, migraciones pendientes aplicadas una sola vez,
  proveedores/derechos habilitados, y ausencia de ejecuciones inciertas por reconciliar.
- Registrar estimación antes de ejecutar y coste real después. El presupuesto es
  orientativo; un máximo estricto sólo rige si fue configurado expresamente.

## Recorrido y resultado esperado

| Paso | Acción en la interfaz | Resultado esperado y evidencia que conservar |
|---|---|---|
| 1. Acceso | Abrir Studio, entrar a **Marcas / Brands** y **Crear marca / Create brand**. | Sesión autenticada, rol visible y formulario de marca. Un error de callback o de permisos bloquea; no usar un bypass. El cambio de idioma está en Settings / Configuración. |
| 2. Alta | Crear «Marca QA MFP Oct07 R4» con slug exclusivo y organización de desarrollo nueva, mercado y zona horaria. Con el corpus privado National se permiten esos alias sólo para matching, sin importar a ninguna marca existente. Activar ficha/discovery/pertenencia. Completar alias, competidores y descripción. Guardar. | Una marca y un workspace propios; Brand OS y permisos operativos disponibles. Registrar URL y hora. No duplicar el alta por una respuesta lenta. |
| 3. Brand OS | Abrir la marca y comprobar nombre, alias, competidores y contexto guardados. Anotar los alias y entidades iniciales. | Los campos persisten tras recargar. Marca y competidor son entidades distintas; una comparación puede mencionar ambas. |
| 4. Intereses | Crear 2–3 intereses con nombre, ámbito, definición, inclusiones, exclusiones y ejemplos positivos/negativos. | El catálogo guarda definiciones editables. Definir un interés distinto de activación/consentimiento. Guardar no ejecuta proveedores. |
| 5. Primera carga | En Datos de la marca, importar `load1.csv`; revisar procedencia, fechas, licencia y permisos de procesamiento. Confirmar una vez. | Importación con estado terminal y conteos de filas recibidas, únicas, duplicadas/excluidas. Conservar el recibo, no sólo el toast. |
| 6. Preparación y vectores | Solicitar preparación y embeddings desde los controles del workspace; esperar cada estado terminal. La ficha puede ejecutarse en paralelo a los vectores tras preparar el texto. | Toda raíz queda contabilizada; se muestran elegibles, excluidas y vectores pendientes/listos. No confundir vectores con pertenencia. |
| 7. Ficha | Revisar estimación, ejecutar ficha y esperar. Abrir varias menciones, incluida una comparación marca–competidor. | Estados `labeled`, abstención, rechazo o error explícitos; entidades/voz/acto/relevancia visibles. Conteos suman elegibles y coste real queda asentado. No convertir error en «ajena». |
| 8. Probar definición | En un interés, pulsar **Probar definición** y revisar veredicto/cita de las raíces de muestra. | Preview con coste y evidencia por raíz; no se publica como pertenencia vigente. La cita debe existir literalmente en el original. |
| 9. Discovery | Ejecutar discovery y consolidación. Comparar su población de entrada con las fichas relevantes. | Sólo entran relevantes; ajenas no aparecen como «Sin grupo estable». Conservar conteos, tiempos y versión del resultado. |
| 10. Adopción | Adoptar hasta dos conceptos descubiertos válidos y revisar/editar sus definiciones; registrar cobertura menor si no hay dos candidatos reales. | Se incorporan al catálogo como conceptos adoptados. Su pertenencia se resolverá por mención, no por herencia del grupo. |
| 11. Pertenencia | Revisar estimación y lanzar pertenencia completa; esperar estado terminal. | Todos los pares relevantes × conceptos compatibles tienen estado. `belongs` lleva cita literal; insuficiente/rechazo/error permanecen diferenciados. |
| 12. Tres excepciones H1 | Sólo tras desplegar #39 verificado y seleccionar explícitamente H1 para este workspace, abrir su cola. Revisar tres desacuerdos reales; aceptar/rechazar según el original. | `review_required` no se publica automáticamente. Cada lado muestra su resultado; cada decisión humana queda como override y persiste tras recargar/recalcular. Si no hay tres casos reales, registrar la cobertura faltante; no fabricarlos ni usar mocks. |
| 13. Signal ES | Seleccionar los intereses y conceptos adoptados en Signal. Cambiar idioma a español en el control de idioma disponible. Abrir un concepto y su mención original. | Conteos concordantes, cita resaltada en el original, sin dobles conteos por adopción; etiquetas y estados en español. Anotar filtros/fechas usados. |
| 14. Signal EN | Repetir la misma selección, filtros y detalle en inglés. | Mismos datos y conteos, textos en inglés, navegación a la misma evidencia. Registrar defectos de traducción sin corregirlos en este frente. |
| 15. Cambio narrativo | Antes de la segunda carga, modificar sólo la descripción narrativa de Brand OS. Consultar estado. | No se invalidan fichas por un cambio narrativo. Guardar conteos antes/después. |
| 16. Alias y competidor | Agregar un alias de al menos tres caracteres y un competidor presente en el corpus; consultar estado antes de relanzar. | Se señalan únicamente raíces afectadas por el cambio de entidades. Las fichas obsoletas no se sirven como vigentes. Un alias corto exige alcance completo explícito; no usarlo para esta prueba selectiva. |
| 17. Editar concepto | Modificar una definición de interés; conservar las demás. | Sólo ese concepto invalida sus decisiones. Conservar definición antes/después y conteo de pares pendientes. |
| 18. Segunda carga | Importar `load2.csv`, revisar duplicados y cambios de contenido; preparar, actualizar ficha, discovery incremental y pertenencia. | Se reutilizan claves vigentes; sólo se procesa lo nuevo/cambiado, raíces afectadas por CE y el concepto editado. Registrar llamadas/coste por etapa frente a carga 1. |
| 19. Cierre | Abrir Signal en ES y EN con iguales filtros, revisar cita y correcciones humanas. Recargar. | Segunda carga visible, overrides preservados, sumas coherentes y ningún trabajo incierto tratado como completado. La ejecución dev-test no acredita entrega UAT ni producción. |

## Cómo registrar un fallo

Anotar: fecha/hora, corte y despliegue, paso, idioma, URL de workspace, precondiciones,
clics exactos, resultado observado, resultado esperado, frecuencia y captura sin secretos.
Añadir estado de ejecución/recibo y si se creó trabajo pagado. No pulsar de nuevo si
el envío quedó incierto. Clasificar el bloqueo y coordinar una corrección con el
orquestador; los defectos no bloqueantes sólo se documentan.

## Evidencia de ejecución

**En curso; sin aceptación integral.** Resumen operativo:
[recibo frente 5](RECEIPT_MFP_FRONT5_AUDIT_R4_2026-10-07.md).
IDs completos, textos originales y capturas permanecen en `.data/front5-qa/`,
fuera de Git. No se alteraron marcas históricas, UAT, producción ni `main`.

### Código, entorno y atribución

Base #38 `9bc7ff9d`; [PR #40](https://github.com/noisia-ai/monorepo/pull/40),
HEAD de producto `3a1f546e`, corrige F5-06 y F5-08. CI `37595736324` y PG17
`37595736358` SUCCESS; typecheck remoto monorepo 10/10. Las pruebas PG usan una
base desechable. Una fixture se negó a ejecutarse sobre dev-test poblado antes
de escribir; no se trató ese rechazo como un test superado.

Studio `562dcfd9` verificó #40 y la primera prueba Signal ES/EN. El cambio de
configuración posterior disparó el autodeploy de la rama conectada `develop`:
`3859dd3c` sirvió `4bbd2e`, aunque inicialmente se atribuyó a #40. SSH y hashes
corrigieron la atribución. Editorial/adopción/cambios de Brand OS/carga 2 tienen
recibos reales, pero su UI en ese intervalo no acredita #40. Otro build de
`develop`, `8e2394de`, fue cancelado antes de activarse.

Studio actual `6980f50d` se restauró con archive exacto de `3a1f546e`: 2793 blobs
sin diferencias, hashes de ambos archivos corregidos iguales en runtime y health
profundo HTTP 200. Batch 3 y la ficha correctiva ocurrieron después de esa
verificación. Para futuros cambios de variables usar `--skip-deploys` y desplegar
el archive verificado. Worker `74ad8524` sigue en #38, sin redeploy por #40.

Guard confirmó PostgreSQL17/pgvector, rol/base/DNS privados y Redis MFP. Censo
inicial: 340 tablas/235 migraciones. 0252/0254/0257/0258 aplicadas una vez,
239 migraciones finales; no repetir. Infraestructura, workers y suites pesadas
remotos. El ajuste autorizado `NOISIA_MFP_IN_FLIGHT_PAGES=4` conservó los IDs y
batches en vuelo; cero llamadas inciertas. Editorial batch/global permanece
apagado globalmente: se ejecutaron sólo jobs nativos por IDs propios, con huella
histórica intacta antes/después. Modelo/esfuerzo efectivo del agente no expuesto.

### Alta y primera carga

Alta UI autenticada en organización y marca nuevas; Brand OS persistió contexto,
alias National/National Car Rental y competidores Hertz/Avis. Dos intereses
manuales: «Cobros y depósitos en la renta» y «Atención durante la entrega y
devolución», ambos de marca principal. Guardarlos no lanzó proveedores.

| Etapa | Resultado terminal |
|---|---|
| Importar carga 1 | 1000 filas → 977 raíces; 23 duplicadas; 905 elegibles/72 excluidas. |
| Vectores | 905 raíces/3158 fragmentos; 3144 nuevos/14 cache hits; USD 0.097130. |
| Ficha | 905 raíces/226 llamadas; 377 relevantes, 402 ajenas, 27 spam, 99 indeterminadas (88 abstenciones/11 errores); USD 2.595856. |
| Preview cobros | 10 raíces compatibles de hasta 30, 4 llamadas, 10 no pertenecen; USD 0.051516; no publicado. |
| Discovery | Sólo 377 relevantes → 12 grupos interpretados; USD 0.274848. |
| Consolidación editorial | Numérica 12/12; 1 Topic, 0 Narrativas, 7 Noise y 4 insuficientes. Screening USD 0.100889 + global USD 0.061989. |
| Adopción | Sólo Emerald Aisle/estatus élite era candidato válido: **1/2**. No se adoptaron grupos insuficientes ni Noise. |
| Pertenencia manual | 114 pares/20 llamadas, USD 0.247660. Atención 6 pertenecen/51 no; cobros 4/53; 8 raíces positivas únicas. |
| Pertenencia adoptada | 57 pares/21 llamadas incluida una reparación; 15/42, USD 0.251994. |

Sonnet 5.5 en ficha/pertenencia; Sonnet 4.6 en interpretación; Voyage en vectores.
Las citas literales se contrastaron con el texto, pero F5-07 impide acreditar
calidad semántica global. Una comparación National–Hertz mostró ambas entidades,
prominencia diferenciada, voz individual y acto experiencia, sin perder original.

Signal ES/EN en `562dcfd9` mostró atención 6/cobros 4 y 8 únicas con iguales
fechas (1 enero–23 agosto 2026) y población `all_conversations`. Evidencia abrió
seis menciones de atención con fragmentos resaltados; el enlace a Menciones enfocó
la raíz tras la carga asíncrona. El enlace externo de procedencia se conservó.
La vista posterior con adoptado mostró tres Topics y 17 únicas durante una fase
parcial; no se presenta ese censo como terminal ni como verificación de #40.

### Selectividad y segunda carga

- Cambiar sólo narrativa de Brand OS conservó CE/digest/fichas/decisiones, sin
  nuevas llamadas. El inspector nativo indicó `changed=false`.
- Editar sólo cobros exigió atribución explícita a National y excluyó cargos de
  otra rentadora. Cambió sólo su digest e invalidó exactamente 57 pares. Las
  otras dos definiciones y el CE conservaron resultados. No acredita arreglar F5-07.
- Agregar alias NationalCarRental produjo alcance targeted/0 raíces. Agregar
  Sixt afectó 62 raíces antiguas; la UI dejó de contarlas como fichas vigentes.
  Tras la segunda carga, CE v2 registró 70 afectadas (62 anteriores + 8 nuevas).
- Carga 2 única: 250 filas → 199 raíces nuevas, 46 existentes y 5 duplicadas
  internas. Nuevas: 181 elegibles/18 excluidas. Total: **1176 raíces**.
- Vectores incrementales: 1086 raíces, 3634 fragmentos; 475 nuevos/3159 cache hits,
  USD 0.013297. Ficha: **254 enviadas = 181 nuevas + 62 afectadas + 11 errores**;
  las 832 vigentes no se reenviaron. 65/65 llamadas, USD 0.850967; quedaron tres
  errores técnicos recuperables.
- La carga 2 fue append-only porque Studio ocultaba la revisión de contenido
  (F5-10). Se habilitó `NOISIA_MFP_ENABLED` sólo Studio, se verificó el archive
  #40 y se importó por UI un archivo correctivo de 23 IDs existentes, sin alterar
  sus valores: 19 revisiones reales, 4 duplicadas, 0 inserciones. Las 250 filas
  no se repitieron; total 1176 intacto y snapshots anteriores conservados.
- Vectores correctivos: 19 nuevos/3614 cache hits, USD 0.000428. Ficha correctiva:
  **22 raíces = 19 revisadas + 3 errores**, 17/17 llamadas, USD 0.134326. Las
  1064 restantes no se reenviaron.

Censo comprobado: **1086 fichas actuales**, 468 relevantes, 481 ajenas, 30 spam y
107 indeterminadas; cero pendientes técnicos/error. Las 19 revisiones sirven
texto nuevo 19/19; cero `input_digest` anteriores servidos; todas usan CE v2.
Los 612 pares de pertenencia finales coinciden con su ficha en
`entity_context_digest`, `effective_entities_digest` y fingerprint. El CE v1
sigue siendo válido para raíces no afectadas. Una consulta diagnóstica propia
lenta fue cancelada; la comparación separada terminó con timeout de 25 segundos.

Discovery final: UI POST 202 una vez, 468 raíces/1494 chunks, estimación
USD 1.230690; terminal 13/13 grupos interpretados, USD 0.276342 settled y
reserva cero. Preparación numérica nueva solicitada por UI una vez y terminada 13/13 por
Worker. Editorial: intent UI único, ejecución y lote nativos acotados a ese
recibo, 13 unidades enviadas; histórico intacto. Pertenencia:
UI POST 202 una vez, USD 0.430596 orientativos, 121 pares pendientes/34 llamadas,
86 pares actuales conservados. Pertenencia terminal: 36/36 settled, USD 0.357144, pendiente 0. Atención:
5 pertenecen/63 no/1 error; cobros: 2/65/1 insuficiente/1 error; Emerald:
18/50/1 error. Los tres errores son membership_evidence_invalid, separados
de la abstención. Consolidación global materializada: 5 Topics, 0 Narrativas, 4 Noise y
4 insuficientes; cribado 13/13 USD 0.093035 + global USD 0.081039. Se volvió a seleccionar Cobros con su digest vigente.

### Signal después de la segunda carga

Studio verificado #40 `6980f50d`: ES y EN coinciden en periodo 1 enero–23 agosto,
población `all_conversations`, 1086 totales = 468 relevantes + 481 ajenas +
30 spam + 107 indeterminadas. Tres conceptos: atención 5, cobros 2 y Emerald 18;
21 raíces únicas seleccionadas, 447 relevantes sin concepto. Cobros fue
seleccionado de nuevo con su digest editado. F5-04 persiste en ambos idiomas:
badge 134 frente a KPI/panel 447.

Evidencia de atención: HTTP 200, cinco ítems y cinco citas resaltadas; abrir una
reseña enfocó la mención correcta y conservó el enlace externo National. Capturas
privadas 18 (ES), 19 (citas) y 20 (EN). Esta comprobación precede a una eventual
segunda adopción y H1; no los acredita.

### Segunda adopción real

La revisión final contiene cinco Topics. «Explorar grupos» mostró dos
representantes del candidato de integración de plataformas; «View mention»
abrió el artículo completo de Southwest sobre reservas de autos y su enlace
original. Adoptado exclusivamente por UI: **Integración de renta de autos en
plataformas de viaje**, ámbito Categoría. Emerald previo se conserva sin
readoptar ni reescribir. Cobertura de adopción: **2/2**. La pertenencia evalúa
su definición por mención; no hereda las 15 raíces del grupo de origen.

Solicitud UI única para completar pertenencia: 405 raíces compatibles con
Categoría, estimación USD 1.177746. 58/58 llamadas settled (53 iniciales +
5 reparaciones), USD 0.996055. Resultado
terminal: 24 pertenecen, 378 no pertenecen, 1 insuficiente y 2 errores;
pendiente 0. Los tres errores anteriores se conservan. Selección guardada por UI.
Signal ES/EN final muestra cuatro conceptos (5/2/24/18), 45 raíces únicas seleccionadas
y 423 relevantes sin concepto; evidencia HTTP 200 con 24 ítems y 24 citas
resaltadas. El badge F5-04 sigue en 134 frente al KPI de 423.
La ruta de outcomes fallida no se usó
para mutar/adoptar por SQL: la evidencia y adopción se verificaron por UI.

### Defectos reproducidos y recuperación

| ID | Reproducción y resultado | Estado |
|---|---|---|
| F5-01 | Guardar interés devolvía 503 por tres flags de serving ausentes en Studio. | Configuración autorizada; HTTP 200 y guardado comprobados. |
| F5-02 | Importación terminó, pero el contador recibido mostró 0 hasta refrescar. | Documentado; refresco recupera el recibo. |
| F5-03 | Progreso de ficha avanzó mientras lista/resumen quedaron antiguos. | Documentado; Actualizar recupera los estados. |
| F5-04 | Badge sin concepto mostró 11 frente a KPI/panel 369; usa coverage.unresolved frente a membership_population.without_concept. En otro estado ambos coincidieron en 360. | Defecto dependiente del estado; pendiente. |
| F5-05 | Preview → cambiar idioma en Configuración → volver: desaparece panel aunque run sigue. previewRun sólo vive en React; la API requiere run_id. | Guardar recibo y permanecer hasta terminal; historial UI pendiente. No se repitió preview. |
| F5-06 | Prepare Topics review fallaba antes del POST; fetch nativo recibió args como receptor y lanzó Illegal invocation. | #40 usa fetcher.call(globalThis,…). Test remoto rojo 4/5 → verde 5/5; UI y numérica 12/12 verificadas. |
| F5-07 | La guía de lealtad sigue positiva pese a que la cita del cargo especifica una reserva Enterprise, incluso tras exigir National en la definición. Se había señalado también una disputa Enterprise; al revisar su contexto completo, el texto dice que el vehículo se devolvió a National. | Mantener el primer caso como defecto de atribución. El segundo no acredita por sí solo un falso positivo: existe vínculo explícito con National. Originales preservados; no son excepciones H1 ni se corrigieron con lógica del corpus. |
| F5-08 | Dos selecciones MFP vigentes en SQL, Signal mostraba Topics 0. Catálogo computado ocultaba definiciones manuales/adoptadas. | #40 corrige sólo generaciones MFP; legacy/V2 intactos. Test remoto 2/3 → 3/3; PG real 0 → 2 conceptos y 0 → 8 únicas, sin escrituras. PG17 CI y UI ES/EN verdes. |
| F5-09 | Tarjeta editorial muestra sólo screening USD 0.100889 y omite global USD 0.061989. | Recibo suma ambos ledgers; UI pendiente. |
| F5-10 | Sin NOISIA_MFP_ENABLED en Studio, importador oculta opt-in de revisiones y carga 2 conserva contenido anterior. | Flag autorizado sólo Studio + batch correctivo por UI: 19 revisiones verificadas. |
| F5-11 | View saved outcomes del nuevo editorial devuelve HTTP 409/SQL 42601. EXPLAIN en PG17 reproduce error cerca de candidate en outcomes_read; owner_read/citations_read parsean. Faltan comillas finales de label/definition/locale en workspace-topic-editorial-outcomes-v2.ts:139–141. | Documentado sin editar módulo. Explore groups → View mention permite revisar el original completo; adopción sólo por UI. |

Un error transitorio al consultar análisis se recuperó con un refresco HTTP 200.
El botón pudo quedar temporalmente deshabilitado por polling; se comprobó un
único POST aceptado, sin reenviar una solicitud pendiente.

### Costes y trabajo restante

Acumulado settled antes de H1: **USD 6.484515**.
Vectores 0.110855; fichas 3.581149; preview 0.051516; interpretación 0.551190;
editorial 0.336952; pertenencia 1.852853. Railway/CI no cuantificados. Presupuesto
orientativo sin máximo estricto. Reservas de nuevas ejecuciones no son coste settled.

Pertenencia final cerrada: 612 pares sin pendientes, cinco errores y dos
insuficientes conservados como tales. El censo remoto acredita 1086 fichas
actuales y cero discrepancias de CE, entidades efectivas o fingerprint en los
612 pares. Todos los jobs del recorrido están terminales. Signal final ES/EN
tiene las mismas fechas y conteos (capturas privadas 21–23).
Ventana H1 abierta al coordinador tras liberar Runner; el suplemento siguiente registra
el despliegue posterior y las tres excepciones, con atribución separada.


## Suplemento H1: tres excepciones y recarga

Studio dev-test `320993fc` sirvió el corte combinado #39 `5eae0ef1` con #40.
Este tramo usa el workspace National de la fixture H1 coordinada; es distinto de
la marca nueva del recorrido anterior. No se inició procesamiento desde este frente.

En **Pertenencia al concepto → Filtrar → Revisión necesaria**, se leyó el texto
completo y la definición antes de aplicar cada decisión por UI. Tres PATCH respondieron
HTTP 200 con `updated: 1`:

| Concepto | Evidencia revisada | Decisión y motivo |
|---|---|---|
| Atención y resolución de reclamaciones | Comentario sobre los tuits creativos de Jericho contra varias empresas. | No pertenece: no relata una atención o reclamación concreta de renta de autos. |
| Cobros, depósitos y devoluciones | Comparación de tarifas National.com.mx y National.com para el mismo itinerario. | No pertenece: la definición excluye comparar precios/canales sin cargo adicional. |
| Cobros, depósitos y devoluciones | Comparación de rentadoras en un puerto; Auro Ice Rental cobra EUR 50 por recoger/entregar en crucero. | Pertenece: práctica concreta de cargo adicional atribuida a un proveedor. |

Dos ejemplos ambiguos de queja sin detalle quedaron sin corregir; no se forzó una
respuesta binaria para alcanzar tres. Frente 4 verificó por lectura DB **una fila
activa por par** y la vista vigente `source=human` con los tres veredictos anteriores.
Esto acredita persistencia después de las escrituras; no se ejecutó otro cálculo.
La revisión fue **asistida por agente bajo la sesión del operador**. La etiqueta
`human` del producto no acredita una nueva adjudicación manual del fundador ni la
aceptación de calidad del etiquetador. El censo H1 comunicado por frente 4 registra
32 `review_required` y 260/260 citas válidas; coste/cierre global H1 pertenecen a #39.

**F5-12, bloqueo de recarga:** el catálogo aparece y luego desaparece con “Tu usuario
no puede gestionar tópicos en este workspace”. Network registra
`incremental-candidates` 404. La ruta devuelve ese estado cuando `mfp_discovery`
está deshabilitado y el hook compartido dispara la revocación de toda la pantalla.
El arreglo de #40 devuelve un catálogo vacío con contrato válido HTTP 200 después
del guard existente cuando la función opcional está apagada. No lee candidatos ni
modifica grants. Los 401/403/404 reales conservan su respuesta; un error técnico de
bandera sigue siendo 503. Cuatro pruebas focales pasan; sobre el código anterior
fallan los casos de bandera apagada y error técnico. Falta validar la recarga en el
despliegue combinado que integre este arreglo; no atribuirlo a `320993fc`.

El 503 observado en `topics/computation` corresponde a la lectura del panel de
cómputo anterior. Su hook conserva un error local, no ejecuta `clearAccess` por 503,
y no impidió las tres correcciones ni su persistencia DB. Se conserva como incidencia
técnica sin resolver, fuera del cierre de las excepciones H1. No se modifica esa ruta.
Evidencia privada: respuestas antes/después y capturas 24–26 en `.data/front5-qa/`.
