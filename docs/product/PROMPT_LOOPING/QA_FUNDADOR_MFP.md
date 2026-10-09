# QA del fundador — MFP

Actualizado el 9 de octubre de 2026. Revisión §11.3 del audit MFP.

**La aceptación del fundador sigue pendiente.** El entorno compartido ejecuta el corte indicado abajo. Las correcciones de [PR #40](https://github.com/noisia-ai/monorepo/pull/40) y el selector experimental de [PR #39](https://github.com/noisia-ai/monorepo/pull/39) requieren revisión y comprobación de interfaz en su propio despliegue antes del recorrido completo.

## Acceso, tiempo y coste

Entrar a [Studio MFP de desarrollo](https://mfp-studio-dev-test.up.railway.app) con la sesión habitual y rol **Admin Noisia**. Éste es el rol usado en la prueba anterior. Un administrador cliente necesita permisos de importación y procesamiento de su marca; ese recorrido no está acreditado todavía.

Reservar 20–30 minutos para revisar resultados existentes: no consume proveedores y cuesta USD 0. Para repetir el recorrido con una marca nueva y dos archivos de 1,000 y 250 filas, reservar 1–2 horas y una estimación orientativa de USD 7. USD 7 corresponde al recorrido estándar; una ejecución H1 adicional requiere revisar su propio presupuesto con el operador antes de iniciarla. La ejecución anterior costó USD 6.484515; no garantiza el coste de otra marca. Revisar cada estimación antes de iniciar procesamiento. Un máximo estricto sólo rige si está configurado expresamente.

## Entorno que se debe comprobar

| Componente | Corte y despliegue compartido |
|---|---|
| Código | `b2667fc5bec37a66414f23b6e6b275ff82dadbeb`, rama develop |
| Studio | `2271084f-3bbc-45dd-9800-1472de995c5d` |
| Runner | `df39c4ee-4b03-4305-ac53-9c9f0ab1b089` |
| Publicación automática | Desactivada en ambos |

Configuración observada en Studio el 9 de octubre; todos los siguientes valores son `true`:

| Función | Variables activas |
|---|---|
| Datos y API de marca | `NOISIA_DATA_OS_ENABLED`, `NOISIA_DATA_OS_SERVING_ENABLED`, `NOISIA_SIGNAL_WORKSPACE_API_ENABLED` |
| Ficha y pertenencia | `NOISIA_MFP_ENABLED`, `NOISIA_MENTION_FACETS_ENABLED`, `NOISIA_MENTION_FACETS_PROVIDER_ENABLED`, `NOISIA_CONCEPT_MEMBERSHIP_ENABLED`, `NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED` |
| Editorial y consolidación | `NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED`, `NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED`, `NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_ENABLED`, `NOISIA_SIGNAL_TOPIC_EDITORIAL_BATCH_PROVIDER_ENABLED` |
| Vectores e interpretación | `NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED`, `NOISIA_WORKSPACE_INTERPRETATION_ENABLED` |

Para H1, lectura directa de Studio a las **03:40:06 UTC del 9 de octubre**:

| Variable | Estado actual |
|---|---|
| `NOISIA_CONCEPT_MEMBERSHIP_PROVIDER_ENABLED` | `true` |
| `NOISIA_JEV_PROVIDER_ENABLED` | No configurada |
| `NOISIA_MFP_HYBRID_ENABLED` | No configurada |
| `NOISIA_MFP_HYBRID_LEDGER_READY` | No configurada |

El corte compartido no está habilitado para seleccionar H1 mediante el control nuevo. Para activarlo después de revisar y desplegar #39/#40, el operador debe comprobar las cuatro variables en `true` en Studio y Runner, además de permisos, habilitación de la marca y presupuesto. Volver a Estándar permanece posible con proveedores apagados. Esta condición futura no acredita un despliegue actual.

`NOISIA_FOUNDER_RECOVERY_ENABLED` está en `false`. El operador técnico debe confirmar también permisos, configuración del Runner y coste disponible antes de cualquier ejecución. Una función activa por configuración no acredita que el recorrido funcione.

## Recorrido

| Paso | Control y acción | Qué comprobar |
|---|---|---|
| 1 | **Marcas → Crear marca**. Usar una marca desechable nueva. Completar mercado, zona horaria, alias, competidores y descripción. | Una sola marca propia y datos guardados al recargar. No repetir el alta por una respuesta lenta. |
| 2 | **Brand OS** y catálogo de **Topics**. Crear dos o tres intereses con definición, inclusiones, exclusiones y ejemplos. | Guardar no inicia procesamiento. Marca y competidor permanecen separados. |
| 3 | **Datos**. Importar el primer archivo una vez y revisar su recibo. | Filas recibidas, únicas, duplicadas y excluidas. Conservar fechas, procedencia y permisos. |
| 4 | Preparar texto, generar vectores y pulsar **Completar fichas pendientes**, revisando estimaciones. | Cada etapa termina con conteos y coste. Relevante, ajena, insuficiente y error siguen separados. Abrir originales, incluida una comparación con un competidor. |
| 5 | **Probar definición · 30 raíces** y **Analizar conversaciones**. En **Convertir grupos en Topics útiles**, pulsar **Preparar revisión de Topics** y seguir **Revisión editorial de Topics**. Abrir **Ver resultados guardados**; revisar y usar **Adoptar concepto** hasta dos veces. | Las citas existen literalmente en el original. La consolidación muestra sus resultados guardados. Si faltan candidatos reales, registrar el límite. |
| 6 | Pulsar **Calcular pertenencia completa**. | Los conceptos se resuelven por mención. Un grupo descubierto no concede pertenencia automáticamente. Revisar decisiones con su evidencia. |
| 7 | Tras verificar el despliegue de #39/#40: **Configuración → Método de pertenencia → Estándar / H1 experimental → Guardar método**. | La selección persiste; seleccionar no ejecuta proveedores. Para obtener desacuerdos nuevos, el operador verifica presupuesto y habilitación y después se ejecuta Pertenencia con H1; los resultados estándar anteriores no son una prueba H1. Volver a Estándar puede exigir confirmar llamadas cuyo resultado sigue pendiente. No elimina el coste expuesto. |
| 8 | En H1, **Revisar desacuerdos**. Revisar tres casos reales y elegir **Revisión humana directa** o **Decisión asistida por agente** antes de corregir. | Se ven ambos resultados y citas disponibles. La decisión persiste al recargar. Si no hay tres casos reales, registrar cobertura faltante. Las correcciones asistidas no cuentan como evaluación humana. |
| 9 | **Signal**. Seleccionar los intereses y conceptos; abrir detalle y original. Repetir en español e inglés con iguales fechas y filtros. | Conteos iguales, citas visibles, sin duplicados por adopción. El indicador de relevantes sin concepto coincide con su panel. |
| 10 | Cambiar primero la descripción narrativa; después un alias de al menos tres caracteres y un competidor presente en los datos. Editar una sola definición. | La descripción no invalida fichas. Los cambios de entidades afectan sólo sus menciones; editar una definición afecta sólo ese concepto. |
| 11 | Importar el segundo archivo; actualizar las etapas necesarias y repetir Signal ES/EN. | Sólo se procesa contenido nuevo o cambiado y decisiones afectadas. Registrar tiempos y coste por etapa. |

## Fallos conocidos y recuperación

En el corte compartido, National puede agotar las conexiones de lectura: aparecen errores al consultar análisis, cómputo o consolidación. Esperar a que terminen las lecturas y actualizar una vez; si persiste, detener el recorrido y registrar el fallo. No volver a importar ni iniciar procesamiento para resolver un error de consulta. #40 corrige la consulta de análisis, errores de SQL editorial y limita las lecturas simultáneas; su interfaz corregida aún debe verificarse desplegada.

La prueba anterior mostró **134** en una pestaña y **423** en el indicador de relevantes sin concepto. #40 hace que ambos usen la misma definición. También conserva la corrección de una consulta opcional que impedía mostrar controles. No usar esos resultados históricos como aceptación del código actual.

Las tres correcciones anteriores hechas con ayuda de un agente ya quedaron identificadas como asistidas, conservando sus decisiones y sin gasto nuevo. No presentarlas como revisión humana del fundador.

Ante una respuesta lenta después de ejecutar, consultar el estado antes de repetir el clic. Si no se sabe si empezó el trabajo, pedir conciliación al operador. Registrar hora, URL, idioma, control pulsado, resultado observado, resultado esperado y una captura sin secretos. Conservar el recibo y el coste conocido.

El [anexo del operador](QA_FUNDADOR_MFP_ANEXO_OPERADOR.md) conserva la ejecución anterior y sus límites de atribución. Esta guía no acredita entrega UAT ni producción.
