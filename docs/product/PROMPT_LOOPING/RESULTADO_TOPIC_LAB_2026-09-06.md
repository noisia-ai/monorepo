# Noisia · Resultado del laboratorio de tópicos

Actualizado durante el relevo de la noche del 6 de septiembre de 2026.

Contexto completo y siguiente acción: [handoff al chat nuevo](HANDOFF_2026-09-06_NEW_CHAT.md).

## Qué ya funciona

Hay **10 candidatos editables, ya visibles en Preview/UAT**, además de sus originales conservados
en el laboratorio local. La evaluación LAB-2G
los produjo usando propuestas computacionales históricas, contexto de marca y evidencia de
menciones. Una prueba posterior ya guardó **una propuesta de nombre y descripción más específica**
después de consultar las menciones de un candidato. No se perdió el trabajo al congelarse la app.

La distinción importante es ésta:

`Corpus → agrupación computacional → candidatos interpretados → propuesta de mejora → revisión/edición → Topic activo`

Estamos en **prueba de reglas de clasificación y automatización de sus sugerencias**. El editor,
la propuesta, Guardar/Probar borrador y el catálogo conjunto ya están en UAT;
no hemos activado estos candidatos en Signal. Tampoco hemos vuelto a ejecutar BERTopic en
esta última prueba: usamos su agrupación congelada como insumo.

Ya puedes abrir cada candidato y leer sus menciones citadas: **30 citas originales y cinco del
refinamiento**, separadas. El experimento viejo aparece cerrado como histórico, no como si el
resultado nuevo hubiera fallado. Despliegue `d9a9ce7` verificado en UAT; Workers y datos previos sin cambios.

## Los 10 candidatos actuales

Los nombres en español de esta tabla son etiquetas de lectura; no cambian los registros originales.

| Candidato | Para qué puede servir | Observación de revisión |
| --- | --- | --- |
| Alexa/Echo y la campaña de fútbol en México | Seguir campaña, dispositivos temáticos y conversación asociada | Separar contenido patrocinado de conversación orgánica |
| Conversación cotidiana sobre Alexa en español | Detectar experiencias, bromas y fricciones | Es amplio; no equivale todavía a una medición de sentimiento |
| Explicaciones del lanzamiento y despliegue de Alexa+ | Entender cómo se explican sus capacidades y disponibilidad | Puede solaparse con el lanzamiento mexicano |
| Lanzamiento de Alexa+ en México | Observar comunicación de entrada al mercado | Revisar solapamiento antes de fusionar |
| Alexa+ frente a ChatGPT/Grok | Entender comparaciones y expectativas sobre asistentes | Comparación temática, no evaluación objetiva de rendimiento |
| Rumores sobre HomePod y el hub de Apple | Vigilar movimientos de un competidor | Separar rumor de anuncio confirmado |
| Noticias y ofertas de Echo/Echo Dot | Seguir productos, precios y promociones | Es amplio; puede convenir dividirlo después |
| Google Nest/Home con Gemini | Vigilar lanzamientos competitivos | No confundir relevancia competitiva con mención directa de Alexa |
| HomePod: listados y renovación de hardware | Seguir oferta comercial y conversación sobre antigüedad | Requiere distinguir listados de opiniones |
| Tendencias de bocinas y hogar inteligente | Dar contexto de categoría | Tema macro, no indicador específico de la marca |

LAB-2G tuvo revisión independiente favorable para el objetivo experimental de diez candidatos
reconocibles y fundamentados. Eso no significa que sean diez Topics definitivos, que todos tengan
igual valor, ni que deban eliminarse las otras propuestas del catálogo.

## La prueba nueva, con resultado real

Se seleccionó el candidato de fútbol en México. El modelo consultó el contexto del candidato y
**8 menciones representativas de un conjunto de 56 menciones MX**, y propuso:

> Amazon Mexico Alexa/Echo World Cup 2026 Fan Campaign

La descripción concreta habla de la campaña “Entregamos Todo por el Fútbol”, dispositivos Echo
temáticos y contenido asociado a la afición mexicana. Guardó cinco referencias de evidencia.

- Estado del intento: **completado**, una propuesta guardada.
- Consumo: **USD0.048738**, tres llamadas, 12,271 tokens de entrada y 795 de salida.
- La propuesta no editó el candidato ni creó una publicación.
- Se mantienen diez candidatos pendientes/editables; cero adopciones, publicaciones o activaciones.

### Lo que la revisión independiente corrigió en nuestra lectura

La propuesta sirve como borrador, **no está lista para presentarse sin revisión**:

1. Un ejemplo de unboxing incluye `#publicidad`; no debe describirse simplemente como reacción
   orgánica de un usuario.
2. Una función de seguimiento del Mundial aparece en una mención consultada, pero no en las cinco
   citas elegidas. Hay que añadir esa referencia o quitar el detalle.
3. La procedencia de “copy oficial” no quedó acreditada por los datos devueltos. No se debe afirmar
   autoría oficial sólo porque el texto suene promocional.
4. Ocho menciones no demuestran prevalencia ni cobertura de las 56. La propuesta no es un censo.
5. Este intento no consultó Brand OS mediante la herramienta dedicada ni comparó candidatos
   relacionados. No podemos afirmar que esas dos partes se hayan validado en esta llamada.

Versión editorial sugerida para revisión, todavía **no aplicada**:

**Alexa/Echo y la campaña del Mundial 2026 en México.** Conversación y contenido promocional
relacionados con dispositivos Echo de edición temática y la afición mexicana al fútbol. Incluye
material patrocinado, publicaciones sobre dispositivos y comentarios asociados; estas categorías
deben distinguirse antes de interpretar la respuesta orgánica a la campaña.

## Qué se arregló al reanudar

- El intento que quedó preparado antes del cierre de la app nunca se había enviado. Su sesión
  vencida se archivó como evidencia; no se duplicó la llamada.
- La paginación perdía el cursor y su formato excedía el límite de la base de datos. Se corrigió
  sin cambiar migraciones: una prueba real de PostgreSQL recorrió 20 + 20 menciones distintas y
  revirtió todos sus cambios al terminar.
- El contexto mostraba referencias heredadas como si acabaran de leerse. Ahora están separadas.
- El SDK podía devolver consumo conocido y después lanzar un error al leer una salida incompleta.
  Se corrigió para conservar el consumo y marcar salida inválida, no perderlo como “desconocido”.
  La causa exacta de las respuestas históricas no retenidas no se inventó ni se reescribió.

## Lo siguiente

1. **Hecho y auditado localmente:** contexto del candidato y Brand OS llega antes de la primera
   llamada pagada. No depende de que el modelo lo pida;15/15pruebas, cero llamadas adicionales.
2. **Hecho, desplegado y revisado en UAT:** el editor existente muestra la propuesta, su fundamento y
   cantidad de referencias. “Usar propuesta” copia nombre/descripción sin guardar ni alterar
   incluye/excluye. Guardar y deshacer pasan contra PostgreSQL real con rollback; la propuesta
   original queda intacta. Ocultarla no rechaza al candidato ni borra la propuesta.
3. Completar navegación acotada de candidatos relacionados. El campo existe, pero esta prueba no
   demostró la búsqueda/comparación necesaria para usarlo bien.
4. **Importación y despliegue terminados:** los diez candidatos y la sugerencia
   caben en un paquete de59KB que conserva sus referencias y el resultado original. PostgreSQL
   ya probó importarlo, impedir duplicados, guardar/deshacer y revertir toda la prueba. La auditoría
   independiente quedó sin hallazgos pendientes. UAT recibió sólo el editor y dos migraciones
   de producto (0115 y0122), no las herramientas/migraciones del laboratorio. No hace falta pagar
   otra evaluación para mostrar el resultado.
5. **Motor probado localmente y editor desplegado en UAT:** guardar una regla ligada a un candidato y medir cuántas
   menciones encuentra. La prueba recorrió las **21,195 menciones congeladas**, incluidas las
   10,009 que BERTopic no agrupó. Con filtro México quedaron 5,121: una regla amplia de Alexa y
   fútbol encontró **517 coincidencias**; otra del nombre/hashtag de campaña encontró **8**.
   Los ejemplos específicos sí hablan de la campaña; varios son contenido promocional repetido,
   no ocho consumidores independientes. La regla amplia también alcanza artículos largos y ruido:
   **más coincidencias no significa mejor tópico**. No se pagó otra llamada a Claude.
   Ya pasó guardar/versionar/repetir sin duplicar, proteger citas no disponibles y 18 pruebas
   adversariales en PostgreSQL. **Guardar borrador / Probar** ya está integrado en el panel existente,
   con ejemplos y población probada visibles. Ya pasó la prueba visual local de guardar/probar,
   refrescar sin repetir la medición, recuperar una respuesta perdida con la misma solicitud y
   resolver conflictos de versión. La revisión independiente, build y despliegue focal terminaron.
   En UAT comprobé carga, campos vacíos sin reglas inferidas, filtros opcionales, edición sin guardar,
   refresh, Escape y reapertura, en390/740/1280px. No ejecuté una prueba ni guardé reglas en UAT:
   los resultados517/8 siguen siendo pruebas reales locales con rollback.
6. **Núcleo auditado y UI desplegada en UAT:** reunir varios candidatos en un catálogo
   en borrador y probar sus reglas juntas. Dos reglas sobre las21,195 menciones encontraron
   **1,105 coincidencias únicas**:517 de Alexa/fútbol y686 de comparación con otros asistentes,
   con98 compartidas. Por eso no sumamos517+686 como si todas fueran distintas. El recorrido
   tardó unos ocho segundos; siguen siendo coincidencias léxicas, no calidad semántica garantizada.
   Pasaron33 comprobaciones adversariales, cap explícito y ocultar/restaurar ejemplos según
   disponibilidad, sin recalcular el resultado. Todo terminó en rollback: aún no hay un catálogo
   de esta prueba guardado en UAT. Commit local3e4708b y revisión independiente sin pendientes.
   La selección mínima y Guardar catálogo/Probar ya están desplegadas y revisadas en móvil y
   escritorio; la reconciliación posterior mantuvo diez candidatos y cero cambios editoriales.
   Las reglas vacías no se inventan ni muestran resultados falsos. La clasificación híbrida y activación en
   Signal vienen después. Editar reglas a mano es una vía de control, no la intención de exigir
   que todos los usuarios redacten consultas; la automatización posterior usará este mismo contrato.
7. **Adaptador y guardado auditados localmente; interfaz implementada con QA final pendiente:**
   transformar una sugerencia fundamentada en candidato, Brand OS y menciones en regla editable.
   A/B cerraron en9adee21/e4db7ba. La prueba PostgreSQL del reader también pasó con rollback y
   baselines intactos. En el componente real, con transporte simulado, ya funcionan copiar sin
   guardar, editar, guardar versiones, restaurar una nueva versión y probar por separado.
   Se corrigió y comprobó la recuperación de una respuesta perdida con el mismo body/key.
   Quedan QA de respuestas tardías, errores POST y revisión final responsive/ES-EN/checks antes
   del commit focal. **No está desplegado ni conectado todavía a generación real de reglas.**
   El objetivo sigue siendo que el usuario ajuste lo propuesto, no que aprenda a escribir queries.

Prueba visual del componente real, con transporte simulado **no UAT**:
[escritorio](../../../.data/topic-refinement-ui-qa/desktop.png) y
[móvil390px](../../../.data/topic-refinement-ui-qa/mobile.png). Copiar no envió ninguna escritura;
guardar y deshacer usaron sólo los comandos editoriales existentes. Escape devuelve el foco y
el panel no desborda a390/740/1360px. Revisión independiente P0=0/P1=0.

## Presupuesto y ubicación verificable

Presupuesto agregado autorizado: **USD20**. Consumo conocido acumulado: USD3.155063.
Reservas conservadoras de resultados desconocidos: USD4.86. Bolsa conservadora para pruebas
diagnósticas históricas: USD0.61. **Saldo disponible mínimo: USD11.374937.**

Se han enviado nueve experimentos distintos; las llamadas internas de un experimento y las
copias de su base de datos no son nuevos experimentos ni nuevos cargos.

- Original LAB-2G: `noisia_topic_eval_lab_20260905_20e4b67a137a`.
- Refinamiento completado: `noisia_topic_eval_lab_20260906_1cd623f0d548`.
- Flight: `topic-refinement-flight-6e2f5f94cdbaf922`.
- Propuesta: `sha256:85854b9ab4c12dee9396dc2ef05d24729281b31da2943bae561d14d7418d236c`.
- Recibo terminal: `sha256:99bf6a2cd8af2f7ebabcf4b50882964985c7015c5f734ff3aac5e2d932416335`.

La automatización anterior está pausada para el handoff al nuevo chat. Front permanece pausado. Este reporte no declara
cobertura completa del corpus por el LLM ni Topics activos en producción.

### Estado comprobado del despliegue

El último corte UAT verificado es `d9a9ce78554407f4eba6532fff5827019d6bf1ed`,
deployment `3af84ebb-43c1-4d96-9816-21c548496b0c`. Sustituye al corte anterior `bd7dbf9`.
Workers conserva su deployment anterior `012026e1-3c63-4a63-87a0-e7df3f94ea99` sin cambios.
Se aplicaron0115+0122 una vez y se importó el resultado; ahora0123 añadió dos tablas vacías
para borradores y recibos de prueba, y 0124 añadió catálogo/ensayo conjunto, también una vez.
Las cuatro tablas siguen vacías tras QA; sin otra llamada pagada.
La revisión autenticada vio diez candidatos pendientes, abrió las 30 citas originales y cinco
citas del refinamiento por separado, sin alterar revisiones. Escritorio,390y740px sin
desbordamiento ni errores de consola observados. Guardar/deshacer se probó con rollback
en PostgreSQL local; la comprobación UAT fue deliberadamente de solo lectura. La reconciliación
independiente de las07:46CST confirmó los datos anteriores y Workers sin cambios, diez candidatos
pendientes, cero borradores/pruebas/catálogos guardados y cero efectos adicionales. El catálogo
se refrescó y abrió el detalle con citas; siete GET observados devolvieron200, sin request mutante.

Puedes verlos en [Brand OS de Amazon Alexa](https://studio-uat-uat.up.railway.app/studio/brands/af11af41-343e-4b6a-ab98-0c37bf24e41d/brand-os),
en **Candidatos de Topic con evidencia completa**. El panel del experimento viejo conserva su
recibo de resultado desconocido, pero ya está presentado como histórico cuando existen estos
candidatos. Las citas ya tienen extractos legibles. Ambas mejoras están desplegadas; no quedan
pendientes ni requieren repetir clustering o pagar otra evaluación.
