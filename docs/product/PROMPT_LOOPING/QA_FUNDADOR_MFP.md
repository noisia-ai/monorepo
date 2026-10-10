# QA del fundador

Actualizado el 10 de octubre de 2026. La aceptación del fundador sigue pendiente.

Abrir [Studio de desarrollo](https://mfp-studio-dev-test.up.railway.app) con la sesión habitual y rol **Admin Noisia**. Para revisar resultados existentes, abrir **Marca QA MFP Oct07 R4**. Para probar el alta completa, crear una marca desechable; no volver a importar archivos en la marca ya procesada.

Antes del recorrido, comprobar en el [recibo del corte de desarrollo](https://github.com/noisia-ai/monorepo/pull/40) qué versión se publicó y qué pruebas terminaron. El [anexo del operador](QA_FUNDADOR_MFP_ANEXO_OPERADOR.md) conserva los detalles técnicos y costos anteriores. Esta guía no acredita todavía el recorrido de un administrador cliente.

Reservar 20–30 minutos para consultar resultados guardados, sin gasto adicional. Un recorrido nuevo puede tardar 1–2 horas o más si el servicio de análisis sigue trabajando. Para los dos archivos de esta prueba, prever aproximadamente **USD 7 por el método Estándar** o **USD 5 por el método Híbrido experimental**. Comparar ambos métodos sobre los mismos datos añade aproximadamente **USD 1** al recorrido estándar. Son previsiones, no máximos: el texto, los intereses y las repeticiones cambian el costo. Revisar el importe mostrado antes de cada inicio. El cálculo y los costos observados están en el anexo.

Los archivos están en la Mac del fundador:

- Primera carga, **1,000 filas**: `/Users/brandhon_o/Downloads/noisia-website/.data/dev-corpus/load1.csv`.
- Segunda carga, **250 filas**: `/Users/brandhon_o/Downloads/noisia-website/.data/dev-corpus/load2.csv`.

Cada fila siguiente indica una sola acción. Si una acción falla, resolverla antes de avanzar. Conservar una captura, la hora, el idioma y el costo mostrado.

| Paso | Dónde y qué hacer | Resultado visible; problema y recuperación |
|---|---|---|
| 1 | **Marcas → Crear marca**: guardar una marca desechable con sus datos mínimos. | Aparece una sola marca. Si la respuesta tarda, revisar Marcas antes de volver a guardar. |
| 2 | **Brand OS**: guardar descripción, alias y competidores. | Los datos permanecen al recargar. Si falta contexto, completar el campo señalado. |
| 3 | **Topics → Crear interés**: guardar un interés con definición, inclusiones, exclusiones y ejemplos. | Aparece en el catálogo; guardar no inicia análisis. Repetir este paso para tener dos o tres intereses. |
| 4 | **Datos y fuentes**: importar `load1.csv` una vez. | El recibo indica 1,000 filas recibidas, con sus duplicadas y excluidas. Si tarda, consultar el estado antes de repetir la importación. |
| 5 | **Datos y fuentes**, panel de preparación: solicitar la preparación del texto. | El estado termina y muestra cuántas menciones pueden analizarse. Si hay errores, abrir el detalle y conservar el recibo. |
| 6 | **Topics**, panel de preparación: pulsar **Crear vectores · estimación …** después de revisar el costo. | La preparación termina con costo y avance visibles. Si ofrece **Usar vectores existentes · sin costo**, usar ese control para reutilizar la preparación. |
| 7 | **Topics**, panel de clasificación: pulsar **Completar fichas pendientes**. | Se ven cantidades de conversaciones relevantes, ajenas y pendientes de revisión. Un error técnico permanece separado de una conversación ajena. |
| 8 | **Topics**, conversaciones clasificadas: abrir una mención original. | El texto permite comprobar por qué se consideró relevante. Elegir también una comparación con un competidor; no confundir quién aparece en ella. |
| 9 | **Topics → Analizar conversaciones**: iniciar el análisis. | Aparecen propuestas agrupadas y un estado final. Si sólo aparece un error de consulta, actualizar una vez; no volver a importar para resolverlo. |
| 10 | **Topics → Convertir grupos en Topics útiles**: pulsar **Preparar revisión de Topics**. | Termina la preparación y aparece **Revisión editorial de Topics**. Si sigue esperando sin avance, registrar el bloqueo y avisar al operador. |
| 11 | **Revisión editorial de Topics**: pulsar **Iniciar revisión editorial**. | La revisión empieza bajo la autorización existente. Este panel no ofrece una cotización previa ni una casilla de autorización: usar la previsión de esta guía y confirmar con el operador el costo disponible antes de esta prueba. Si sigue esperando sin avance, registrar el bloqueo. |
| 12 | **Revisión editorial de Topics**: pulsar **Actualizar estado** cuando se necesite consultar el avance. | El progreso avanza hasta terminar. Si la respuesta queda pendiente, consultar el estado antes de repetir el inicio; usar la recuperación de la misma solicitud si la pantalla la ofrece. |
| 13 | **Revisión editorial de Topics**: pulsar **Completar catálogo** cuando aparezca disponible. | Se guardan los resultados finales con su costo. Si hay un error de lectura, actualizar una vez; no volver a importar para recuperarlo. |
| 14 | **Revisión editorial de Topics**: abrir **Ver resultados guardados**. | Cada resultado conserva su texto y evidencia; los errores y pendientes siguen identificados. |
| 15 | Resultado elegido: pulsar **Adoptar concepto**. | Se agrega al catálogo editable. Repetir con una segunda propuesta real; si no hay dos propuestas útiles, registrar esa limitación. |
| 16 | **Acceso y configuración → Método de pertenencia**: elegir **Estándar** o **Híbrido experimental**. | La selección cambia en el formulario. Si la opción experimental no está disponible, el operador debe habilitarla antes de continuar. Si avisa que el método anterior necesita actualizarse, elegir Estándar, pasar al paso 17 y repetir ambos pasos con Híbrido experimental. |
| 17 | En ese formulario: pulsar **Guardar método**. | La selección permanece al recargar; guardar no inicia análisis. Si avisa que otra persona cambió la selección, actualizar y decidir de nuevo. |
| 18 | **Topics**, interés elegido: pulsar **Probar definición · 30 raíces**. | Se muestran decisiones y citas de prueba, con su costo. La cita debe existir literalmente en el original; la prueba no cambia las decisiones completas. |
| 19 | **Topics**, interés elegido: pulsar **Calcular pertenencia completa**. | Termina con cantidades y costo. Los resultados estándar anteriores no prueban el método experimental: éste necesita su propia ejecución. |
| 20 | Con el método experimental: pulsar **Revisar desacuerdos**. | Se ven las dos decisiones y sus citas disponibles. Si no hay casos reales suficientes, registrar la cobertura faltante. |
| 21 | Caso revisado: marcar la conversación que se corregirá. | Sólo esa conversación queda seleccionada. No seleccionar toda la página sin leer sus casos. |
| 22 | En ese caso: pulsar **Aceptar pertenencia** o **Rechazar pertenencia** tras leer el original. | La corrección permanece al recargar y queda atribuida a quien usa la interfaz. Las correcciones anteriores hechas mediante un agente están identificadas por separado. Repetir en tres casos reales. |
| 23 | Interés elegido: activar **Mostrar este concepto en Signal**. | Se conserva la selección; repetir para cada interés que deba mostrarse. |
| 24 | **Signal**: abrir el detalle de un interés. | El número y la evidencia coinciden con Topics para las mismas fechas y filtros. El número de relevantes sin concepto también coincide entre sus dos paneles. |
| 25 | Selector de idioma: cambiar a inglés. | Para las mismas fechas y filtros, los números se mantienen. Repetir la revisión del detalle en español. |
| 26 | **Brand OS**: cambiar sólo la descripción narrativa. | El texto se guarda sin volver a analizar conversaciones ya clasificadas. |
| 27 | **Brand OS**: agregar un alias presente en los datos. | Sólo quedan pendientes las conversaciones afectadas. Repetir por separado con un competidor presente en los datos. |
| 28 | **Topics**, un interés: editar su definición. | Sólo ese interés necesita una nueva evaluación completa. |
| 29 | **Datos y fuentes**: importar `load2.csv` una vez. | El recibo indica 250 filas y distingue contenido nuevo, repetido y cambiado. |
| 30 | Panel correspondiente: ejecutar únicamente la etapa que aparece pendiente. | Se reutiliza el trabajo vigente. Repetir este paso por cada etapa necesaria, anotando tiempo y costo frente a la primera carga. |
| 31 | **Signal**: revisar otra vez el detalle con las mismas fechas y filtros. | Refleja la segunda carga, sin duplicar conversaciones ni propuestas adoptadas. |

Si dos pestañas muestran errores de lectura, esperar a que termine la consulta y actualizar una vez. Si persiste, registrar el fallo con ambas URLs. No iniciar trabajo pagado para recuperar una consulta.

Conservar los recibos de las dos cargas y la lista de problemas observados. La prueba de desarrollo no equivale a entrega en UAT ni a publicación en producción.
