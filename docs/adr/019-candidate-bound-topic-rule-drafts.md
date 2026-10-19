# ADR 019: Borradores de reglas ligados a candidatos antes de clasificar

## Estado

Decisión del corte local LAB-2Y, 6 de septiembre de 2026. No autoriza adopción,
publicación ni serving de Topics. Contrato implementado en
[Topic Rule Drafts y pruebas léxicas](../product/75_TOPIC_RULE_DRAFTS_AND_LEXICAL_TRIALS.md).

## Contexto

El experimento ya produjo diez candidatos con explicación y citas, visibles en UAT.
Eso prueba que podemos inspeccionar y editar una propuesta; todavía no demuestra
que una definición pueda detectar correctamente todas sus menciones.

Una descripción redactada por un modelo no debe convertirse silenciosamente en
una expresión ejecutable. Tampoco debemos exigir que un usuario justifique cada
edición ordinaria: el producto necesita guardar, probar y revisar resultados de
forma simple, conservando versiones anteriores en backend.

El writer existente `createSignalTaxonomyDraftStoreV1` prepara un perfil completo,
resuelve contexto y posee su propia transacción. Usarlo una vez por candidato
fragmentaría el catálogo y mezclaría la prueba de una regla con la creación de
perfil, términos, ruleset y modelo. La autoridad de clasificación de 0087, por
su parte, se liga a perfiles y funciones/políticas aprobadas. No es almacenamiento
genérico de ensayos experimentales.

## Decisión

Separar dos operaciones pequeñas: guardar un borrador ligado a la versión exacta
del candidato y probarlo contra la población congelada. El backend conserva la
historia; el operador no ingresa motivos, justificaciones ni confirmaciones dobles
para este trabajo ordinario. El primer corte acepta únicamente frases explícitas
`any/all/not` y filtros conocidos, compilados a SQL parametrizado con FTS `simple`.

La prueba conserva cap, conteos, ejemplos y hashes reproducibles. Incluye la reserva
de menciones no agrupadas por BERTopic cuando forma parte del snapshot. No permite
que el número de coincidencias lo invente un LLM y no interpreta “sin coincidencia”
como ausencia semántica del tópico.

Cada revisión se liga a su predecessor y al candidato/run/snapshot originales.
Editar el candidato no reinterpreta en silencio una regla antigua: la vuelve
obsoleta. La UI posterior recuperará borrador y último resultado sin ejecutar otra
prueba al recargar. Las escrituras usarán una transacción del caller y control de
concurrencia, sin una segunda cadena de assignments.

## Consecuencias y límites

- Podemos comparar rápidamente una regla amplia con otra específica, sobre el
  mismo denominador y sin gasto de provider.
- FTS `simple` aporta tokenización y frases, no semántica, stemming por idioma,
  traducción ni cobertura garantizada. Los resultados requieren inspección.
- El cap determinístico controla tiempo y costo computacional; no constituye
  muestreo estadístico. Las filas no probadas permanecen explícitas.
- Una propuesta asistida por IA puede producir en el futuro un borrador dentro
  del mismo schema. Sigue siendo una propuesta validable y editable; no SQL o
  código arbitrario. Este corte no introduce otra llamada a Claude.
- La vía manual es un escape hatch, no una promesa de que el usuario final deba
  aprender consultas complejas para cada tópico. La automatización posterior debe
  conservar el mismo contrato medible y permitir corregirlo.

## Camino siguiente

Después de probar calidad y resolver solapamientos, reunir los candidatos elegidos
en un catálogo/cohort coherente. Adaptar el writer de catálogo para composición en
la transacción del caller y conectar las funciones/políticas a la autoridad real
`signal_classification_generations/items/assignments`. Mantener las guardas de 0087;
no relajarlas para insertar resultados experimentales. La clasificación aprobada
y su consumo por Signal son pasos posteriores, no efectos de “Probar borrador”.

## Alternativas descartadas

**Un perfil activo por candidato:** fragmenta el catálogo, adelanta autoridad y no
resuelve la evaluación conjunta de tópicos.

**Guardar coincidencias como assignments pendientes:** confunde un ensayo léxico
con una decisión del sistema de clasificación y evade sus dependencias reales.

**Inferir la regla desde la prosa editorial sin mostrarla:** impide saber qué cambió
entre pruebas. Una futura sugerencia automática debe quedar explícita y versionada.
