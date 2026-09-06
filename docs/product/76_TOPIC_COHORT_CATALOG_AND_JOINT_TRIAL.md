# Catálogo de tópicos en borrador y prueba conjunta

LAB-3B, 6 de septiembre de 2026. Implementación y prueba real local completadas;
el veredicto independiente final se registra en Prompt Looping.
Este documento no declara desplegada la nueva función ni activos los tópicos en Signal.
El corte anterior LAB-3A sí dejó en UAT el editor individual descrito en
[Topic Rule Drafts](75_TOPIC_RULE_DRAFTS_AND_LEXICAL_TRIALS.md).

## Qué añade al proceso

Los candidatos son interpretaciones de los grupos computacionales, apoyadas por menciones.
Una regla guardada expresa qué frases y filtros se van a probar; la descripción editorial
no se convierte silenciosamente en una consulta. Un catálogo agrupa varias reglas actuales
para medirlas **juntas contra una sola población**.

```text
Candidatos interpretados → reglas editables → catálogo en borrador → prueba conjunta
                                                                    ↓
                                               cobertura, solapamientos y huecos
```

No vuelve a correr BERTopic, no llama a un modelo y no guarda asignaciones en Signal.
La edición manual es una vía de control, no la intención de obligar al usuario a escribir
todas sus consultas: una futura sugerencia automática debe producir el mismo contrato cerrado.

## Identidad y almacenamiento

### Uso en la pantalla de candidatos (LAB-3C, validación local)

1. Abre un candidato para ver sus citas y editar o guardar su regla. El checkbox
   y el botón de abrir son controles separados; seleccionar no edita el candidato.
2. Selecciona entre dos y quince candidatos con «Regla lista». «Falta guardar una
   regla», «Regla desactualizada» y «Rechazado» explican por qué otro no puede seleccionarse.
3. Pulsa **Guardar catálogo**. Guarda las versiones seleccionadas; todavía no mide.
   Si esa versión no tiene una prueba, la pantalla lo dice explícitamente.
4. Pulsa **Probar catálogo** para ver cobertura, coincidencias exclusivas/compartidas,
   solapamiento entre pares y ejemplos. **Actualizar** sólo vuelve a leer el resultado.

No hay motivo, justificación escrita ni segunda confirmación para estas acciones ordinarias.
Las selecciones se conservan al cargar más candidatos. Si otro editor cambia una fuente o
guarda otro catálogo mientras lo revisas, la pantalla conserva tu selección original y pide
reconciliar las versiones. Una regla aún desactualizada debe abrirse y guardarse de nuevo,
o quitarse de la selección; el sistema no inventa su reemplazo. Los resultados antiguos
mantienen los nombres de las reglas que realmente se midieron, aun si cambió el título actual.

Si se pierde la respuesta de Guardar/Probar, «Recuperar misma solicitud» reutiliza la
petición y clave guardadas en esa pestaña, incluso tras desmontar el componente. Refrescar
no lanza otra prueba ni da por terminada una petición incierta sólo porque existe un recibo.
Una petición de otro workspace/evaluación nunca se traslada al contexto nuevo.

El lector carga páginas de hasta veinte candidatos del run exacto, junto con el estado
actual de hasta quince seleccionados. La UI ofrece inicialmente 25,000 menciones, diez
ejemplos y quince segundos. No existe una llamada a IA oculta detrás de estos botones.

### Contratos de esta pantalla

- GET `full-evidence/cohorts/[runKey]`: fuentes, último catálogo y último ensayo de
  esa versión en una lectura coherente; no escribe ni ejecuta búsqueda de texto.
- POST en la misma ruta: guarda referencias de candidatos/reglas y revisiones esperadas.
- POST `full-evidence/cohorts/[runKey]/trial`: prueba el catálogo guardado y sus límites.

El servidor determina actor y workspace, valida el run de la ruta y rechaza SQL, RuleSpecs
libres o autoridad enviada por el navegador. Los contratos completos viven en OpenAPI.

### Modelo de catálogo

Una selección contiene entre 2 y 15 candidatos distintos de un único workspace, evaluación
y snapshot congelado. El servidor exige la revisión actual del candidato y la última regla
guardada correspondiente. Un candidato rechazado o una fuente modificada no puede pasar como
la misma versión que ya se probó.

Cada versión de catálogo utiliza la infraestructura existente: **una taxonomía, N términos
candidatos, un conjunto de reglas y un perfil en borrador**. No crea un perfil activo por tópico.
La procedencia del compilador es `operator`/determinista, sin atribuirle consumo o trabajo de IA.

Hay dos números distintos:

- La revisión de la familia del catálogo pertenece al workspace/evaluación.
- La versión del perfil se asigna globalmente por workspace/tipo, compartiendo el bloqueo
  del creador legado. No se calcula a partir de la revisión de la familia.

El digest del catálogo incluye la selección completa, reglas y referencias de fuente. Dos
catálogos con el mismo contexto de marca pero reglas diferentes no son el mismo catálogo.
Las definiciones de 1,500 caracteres se conservan; no se recortan al límite del contrato legado
ni se inventan ejemplos para satisfacerlo. El nuevo camino tampoco sustituye el snapshot por
la muestra de 100 menciones del creador legado.

## Cómo se cuentan las menciones

La unidad es una membresía del snapshot, no una persona única. Las menciones no agrupadas
por BERTopic se incluyen en la población. Se selecciona una vez un prefijo determinista por
`assignment_index, member_ref`, y se ejecutan sobre él todas las reglas elegidas.

Una regla coincide solamente cuando pasan **sus propios filtros y sus frases**. Que una
mención cumpla los filtros de otro tópico no basta. Una mención disponible queda excluida
globalmente sólo cuando no pasa los filtros de ninguna regla.

```text
total = consideradas + no_probadas
consideradas = no_disponibles + excluidas_por_todos_los_filtros
             + sin_coincidencia + coincidencia_única + coincidencia_múltiple
cobertura = coincidencia_única + coincidencia_múltiple
```

Por regla se muestran coincidencias totales, exclusivas y compartidas. Por cada par se muestra
su intersección. No se suman las intersecciones para obtener cobertura: una mención que coincide
con A, B y C suma **una** mención cubierta, pero aparece en los tres pares A/B, A/C y B/C.

Los límites son 25,000 membresías por defecto, entre 1 y 50,000; hasta 15 segundos y un máximo
de 10 ejemplos **en total**, no diez por regla o por pareja. Cuando hay cap, las no probadas
se muestran expresamente. Un timeout no se presenta como una prueba completa.

Estos números son mediciones léxicas, no precisión, recall, sentimiento, relevancia semántica
ni atribución causal. Un catálogo con más coincidencias puede contener más ruido. Los ejemplos
son una selección determinista acotada para inspección, no una muestra estadística de calidad.

## Repetición, cambios y lecturas

Guardar o probar utiliza una transacción reservada, revisión esperada y clave idempotente.
La misma petición del mismo actor recupera el resultado guardado; una petición distinta con
la misma clave produce conflicto. El núcleo participa en la transacción del caller y no hace
un commit oculto.

Las versiones y recibos conservan su historia. Si cambia una regla, candidato o catálogo,
el resultado anterior se considera obsoleto; no se borra ni se convierte en el resultado de
la nueva versión. Una versión nueva sin ensayo devuelve `latest_trial=null`.

Las lecturas no ejecutan matching ni crean recibos. Conservan los conteos históricos y vuelven
a comprobar únicamente la disponibilidad actual de los ejemplos guardados. Una fuente pausada,
texto modificado o pérdida de autorización no revela el extracto antiguo como si siguiera disponible.

## Qué se valida antes del siguiente corte

Pruebas de reglas idénticas, disjuntas, subconjuntos, tres coincidencias simultáneas y filtros
diferentes; conservación de denominadores; versiones de perfiles sin colisiones; idempotencia,
conflictos y alcance de actor; lectores sin escrituras o matching; ejemplos con derechos actuales.
La prueba real reutiliza el snapshot local de 21,195 membresías e incluye 10,009 outliers. Un
cap de 100 debe dejar 21,095 no probadas. Toda esa prueba local termina en rollback.

El estado de cada validación se registra en Prompt Looping; una lista de pruebas planeadas
no equivale a evidencia de que ya pasaron.

### Resultado local del 6 de septiembre

La prueba real del catálogo combinó reglas explícitas para Alexa/fútbol en México y
Alexa frente a ChatGPT/Grok. Sobre las 21,195 membresías obtuvo **1,105 coincidencias
únicas**: 1,007 de una sola regla y 98 de ambas. Por regla fueron 517 (419 exclusivas,
98 compartidas) y 686 (588 exclusivas, 98 compartidas). Quedaron 20,090 sin coincidencia.
Esto mide coocurrencia léxica; los 98 cruces no demuestran que deban fusionarse los candidatos.

El recorrido conjunto tardó 8,099 ms en ese equipo. Una corrección causal materializa
una sola vez el vector de texto por mención; la prueba PostgreSQL confirma los mismos
resultados que el compilador individual. No se aumentó el límite de 15 segundos.
La huella del perfil incluye explícitamente filas completas del catálogo, evitando
que un alias SQL coincidente con una columna omita metadata de las reglas.

También pasaron cap100→21,095 no probadas, control de tres candidatos con 517
coincidencias comunes contadas una sola vez, 33 comprobaciones adversariales/de
versiones y disponibilidad de ejemplos10→0→10 sin recalcular ni cambiar conteos.
Las versiones globales del perfil se probaron intercaladas con otros borradores;
no se afirma aquí una prueba de transacciones concurrentes.
Recibo privado: `cohort-joint-proof-d2d54d8c2ed200e66a9cd2fc8bbd904f892034f924be4f74dc2058fee5190c6b.json`.
Toda la prueba terminó en rollback y conservó las fuentes. Cero llamadas pagadas,
cambios remotos, asignaciones o activaciones. Estos resultados aún no son datos guardados en UAT.

## Lo que viene después

La UI mínima de selección y prueba conjunta se añade sobre el editor existente una vez que
el núcleo funciona. Después pueden compararse reglas sugeridas e interpretación semántica
acotada, sin repetir automáticamente una llamada pagada.

La clasificación persistente es otro paso: debe usar la autoridad existente de funciones,
políticas, generaciones y asignaciones. El camino de 0087 exige un perfil activo y su append
actual no resuelve múltiples asignaciones solapadas mediante varias llamadas para la misma raíz.
Habrá que definir esa política y reconciliar membresías frente a raíces canónicas; no se crea
un sistema paralelo de asignaciones para saltarla. Eso no impide desarrollar y probar ahora
un catálogo editable en borrador.
