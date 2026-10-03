# Sugerencias de reglas para candidatos de tópicos

LAB-3E-A/B, 6 de septiembre de 2026. Adaptador y puente de guardado locales auditados; todavía no es
una nueva acción disponible en UAT ni una llamada ejecutada a IA. El catálogo y
la prueba conjunta ya están desplegados por LAB-3D.

## Para qué sirve

La descripción de un candidato explica el tema, pero no es una regla de búsqueda.
La siguiente automatización propondrá frases y filtros usando el candidato guardado,
el contexto de marca disponible y menciones consultadas. El usuario podrá revisar,
cambiar, guardar y probar esa propuesta con el editor existente.

La edición manual permanece como control, no como requisito para todos los usuarios.
La explicación de la propuesta la genera el modelo; no es otro formulario que el
usuario deba justificar. La IA no inventa cifras de cobertura ni activa Topics.

`Candidato + contexto + evidencia → sugerencia editable → guardar → probar → catálogo`

## Primer corte: funciones sin efectos externos

El módulo `packages/query-engine/src/signal-topic-rule-suggestion-v1.ts` añade:

- `parseSignalTopicRuleSuggestionV1`: acepta una sugerencia cerrada o un resultado
  explícito de evidencia insuficiente.
- `prepareSignalTopicRuleSuggestionContextV1`: prepara un contexto acotado. Mantiene
  candidato y Brand OS separados del historial opcional, e informa sus omisiones.
- `adaptSignalTopicRuleSuggestionToDraftV1`: construye el mismo RuleSpec que ya usa
  el editor, junto con digests de contenido, referencias y versiones esperadas.

No hacen consultas, guardan filas, prueban reglas, abren herramientas ni construyen
un cliente de proveedor. Su validación de consistencia no sustituye autenticación
ni derechos actuales: el futuro servidor carga esa información, no el navegador.

## Qué propone el modelo y qué conserva el servidor

La sugerencia propone sólo frases `any`, `all`, `not`, filtros, referencias de
evidencia y una explicación breve. Reutiliza los límites de
[RuleSpec](75_TOPIC_RULE_DRAFTS_AND_LEXICAL_TRIALS.md), sin SQL, regex o herramientas
libres. Los caracteres especiales de una frase siguen siendo datos parametrizados.

El nombre y descripción salen del candidato ya guardado. Workspace, evaluación,
snapshot, sesión, versiones esperadas y autoridad nunca los elige el modelo.
Un resultado `insufficient_evidence` no crea una regla vacía. Los filtros vacíos
significan «sin restricción»; no declaran autoridad Global ni disponibilidad comercial.

Las referencias históricas del candidato no cuentan como menciones recién leídas.
La sugerencia sólo puede citar evidencia disponible de las trazas suministradas
para ese candidato y sesión. El adaptador rechaza referencias ajenas, duplicadas
en la salida o marcadas como no disponibles.

## Contexto de marca y límites

Brand OS distingue `available`, `empty` y `unavailable`. Una selección vacía es una
limitación visible, no prueba de que se haya leído toda la marca ni una razón para
descartar automáticamente una regla sustentada por menciones. Un error de permisos
no debe convertirse en un estado vacío.

El contexto preparado tiene un máximo de 18 KiB. Con mucho historial, compacta
prosa y omite material opcional explícitamente; no aumenta el presupuesto ni borra
silenciosamente el contexto obligatorio. Si los datos obligatorios no caben, no
se presenta el resultado como un contexto completo. Este corte prueba esa lógica
con datos simulados, no una navegación pagada.

La preparación y aceptación comparten la misma regla de disponibilidad: una cita
marcada como retirada en cualquier traza suministrada deja de mostrarse como
disponible, aunque hubiera aparecido antes. Al recortar historial se conserva al
menos una mención realmente citable cuando existe y cabe con el contexto obligatorio.

Validación A: 15 pruebas focales, 372 del motor, typecheck y lint de los 11 paquetes
pasaron; lint conserva 15 advertencias anteriores sin errores nuevos. La revisión
independiente cerró sin hallazgos pendientes. Esto valida el adaptador, no una
generación, recepción persistente ni pantalla nueva en UAT.

## Segundo corte: recibo y edición reversible

La recepción persistente de sugerencias, su reapertura y vinculación al guardado
ordinario ya pasaron una prueba real local de PostgreSQL en LAB-3E-B. Usa una plantilla
simulada sobre candidato y evidencia reales cargados por el servidor. Está
marcada como `local_fixture`, con cero llamadas y coste; no se presenta como una
respuesta real de IA ni está conectada a una ruta pública o al botón de UAT.

Una edición conserva la propuesta original;
restaurar una regla anterior debe crear otra versión, no borrar historia ni usar
el undo editorial del candidato.

Guardar la propuesta, cambiar sus frases y restaurar una regla guardada reutilizan
el writer ordinario de borradores. El vínculo conserva cuál sugerencia inició esa
versión y cuál fue la regla efectivamente guardada. Leerla no vuelve a generar ni
a medir; las referencias dejan de estar disponibles si cambian sus fuentes.

La prueba conservó tres citas actuales y contexto de marca disponible, guardó tres
revisiones (guardar, editar y restaurar), comprobó la recuperación de la misma
operación y formó un catálogo con reglas de dos candidatos distintos. Una prueba
léxica separada consideró sólo 100 de 21,195 registros: los otros 21,095 se informaron
como no evaluados. No hubo coincidencias en esos 100; no es una conclusión sobre
la calidad o cobertura de la regla en todo el corpus.

Todo se revirtió al terminar y la huella de los datos originales quedó idéntica.
Los controles de permisos, versiones, evidencia cambiada y escritura parcial se
probaron realmente en PostgreSQL; no se simuló concurrencia entre conexiones.
Este resultado todavía no despliega una pantalla ni representa una llamada a IA.

El comprobante final de PostgreSQL cubre 34 controles, incluido el rechazo de
caracteres de control en la explicación. La suite estándar de DB conserva 169
pruebas aprobadas y 28 omisiones explícitas de integración; la prueba real anterior
se ejecutó por separado con cliente local y rollback, no se infiere de esas omisiones.

Después se conecta la acción de sugerir con ejecución presupuestada de propósito
específico. No se reutiliza un recibo viejo de naming como permiso para generar
reglas. Editar y probar no deben regenerar ni cobrar otra llamada.

La medición sigue en el motor determinista descrito en
[Catálogo y prueba conjunta](76_TOPIC_COHORT_CATALOG_AND_JOINT_TRIAL.md). Coincidencias
léxicas no equivalen a relevancia semántica ni a assignments persistidos en Signal.
El estado de implementación, pruebas, despliegue y consumo vive en Prompt Looping;
ninguna parte de este documento declara ejecutada una nueva evaluación.
