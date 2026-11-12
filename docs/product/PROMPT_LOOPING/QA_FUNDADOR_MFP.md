# QA del fundador · etiquetado de Signal

## UAT · Estudio real A en Brasil

Inicia sesión en [Studio UAT](https://studio-uat-uat.up.railway.app) y abre [Topics y narrativas de Signal](https://studio-uat-uat.up.railway.app/signal/estudio-real-a-cerveza-brasil/topics-narratives).

1. Si tu cuenta abre en español, anota el idioma y elige inglés en los ajustes personales de Studio. En Signal, abre **View details and examples** en un tópico del mapa. Comprueba que carguen los ejemplos y compara el nombre y la definición de un tópico con su original en portugués. Al terminar, restaura tu idioma.
2. Cambia **Content** entre conversación, publicidad, sólo hashtags y todo el contenido. Comprueba el segmento que efectivamente se muestra y su denominador. Los tres segmentos suman el total. Si aparece un aviso de que se conservó la lectura anterior, esa vista aún corresponde al filtro previo.
3. En conversación, abre la evidencia de motivadores y la de barreras. Cierra cada panel y vuelve a abrirlo con los mismos filtros. Compara las 30 menciones y su orden en cada muestra.
4. En Studio, abre el léxico del estudio para consultar las sugerencias gratuitas de palabras y bigramas. En R15 hay 100 sugerencias a partir de resultados con probabilidad de al menos 0.90. Consultarlas conserva la selección de términos del estudio.
5. Coteja los volúmenes, el mapa, el léxico y las dos definiciones de intereses con los recibos privados de R15. Conserva ejemplos e identificadores en el anexo privado.

## Dev-test · referencia de R14

Entorno de prueba: [Noisia Studio en dev-test](https://mfp-studio-dev-test.up.railway.app). Inicia sesión con tu cuenta habitual y abre el workspace autorizado del Estudio real A. Los cambios de configuración de este recorrido se deben restaurar antes de terminar. No inicies un reetiquetado completo del corpus: revisa los resultados ya preparados.

La verificación autenticada de R14 recorrió los cuatro filtros, comparó cinco ejemplos de cada indicador con PostgreSQL y comprobó el umbral de intereses. Los pasos siguientes permiten repetir esas verificaciones en el Estudio real A.

1. **Abrir el workspace.** Selecciona el Estudio real A y entra a **Topics / Tópicos**. Debería abrir Signal en inglés con sus tópicos disponibles. Si no aparecen los tópicos o ves un aviso de carga, recarga la página una vez y confirma que estás en dev-test. Si continúa, anota el estado y detente sin iniciar otra corrida.

2. **Ver la traducción y su fuente.** Abre un tópico y mira su nombre y definición en inglés junto al bloque **Corpus original** en portugués. Alterna a español si el selector está disponible y regresa al inglés. Si falta la definición original o el nombre cambia de tópico al alternar, anota el tópico seleccionado sin copiar publicaciones y comunícalo para corregir la localización.

3. **Comprobar el volumen completo.** Regresa a la lista y confirma que hay 98 tópicos. Mira su orden y los conteos. Si el total cambia, los nombres son cadenas internas o los conteos quedan vacíos, comprueba que el workspace seleccionado sea el estudio preparado y reporta el resultado.

4. **Separar las poblaciones.** Cambia el selector **Content / Contenido** entre conversación, publicidad, sólo hashtags y todo el contenido. Espera a que termine **Updating…** antes de leer el valor o cambiar de filtro. Los denominadores del Estudio real A son 61,524, 22,167, 271 y 83,962, respectivamente. Las categorías de conversación y publicidad deben tener poblaciones distintas; los posts compuestos sólo por hashtags quedan en su propio segmento. Si un filtro no responde o se repiten los mismos resultados, anota qué opción elegiste.

5. **Revisar el denominador de consumidor.** En **Consumer motivators and barriers**, la lectura R14 debe mostrar 50,273 voces elegibles: 18,464 raíces con término del léxico y 31,809 excluidas por no contenerlo. Entre las 18,464, confirma 4,174 motivadores, 842 barreras, 7,889 sin ninguno y 5,559 intermedias. Los casos sin término no deben confundirse con respuestas que no expresan motivador ni barrera. Si Signal muestra cifras distintas o no distingue elegibles e incluidos, reporta los indicadores y no interpretes las proporciones.

6. **Abrir evidencia de un motivador.** Abre uno de los ejemplos enlazados desde el indicador de motivadores. Comprueba que el texto corresponda al registro abierto y que contenga un término de categoría del léxico. La evidencia puede mostrar el original del corpus. Si el ejemplo no coincide, carece de acceso o no contiene un término, anota la decisión y el identificador que presenta Signal en el canal privado de QA.

7. **Abrir evidencia de una barrera.** Repite la revisión desde el indicador de barreras. El ejemplo debe contener un término de categoría y describir una razón para evitar o reducir el consumo, en voz individual. Una publicación promocional, una referencia casual a la categoría o una queja sobre otro asunto no debe contarse como barrera. Si ves una, anota el código del registro y la categoría, sin pegar el texto en una conversación pública.

8. **Revisar Apostas y Racismo.** Abre **Defined interests / Intereses definidos**. Revisa que ambos intereses estén presentes y que las cantidades usen el umbral 0.85 o superior. Examina los ejemplos disponibles: una metáfora con “apostar” no debe clasificarse como una apuesta real; insultos sin dimensión racial no pertenecen a Racismo. Si faltan las definiciones ajustadas o el umbral mostrado y aplicado no coincide, reporta el interés y la vista.

9. **Inspeccionar el léxico vigente.** En **Manage Topics / Gestionar topics**, abre **Labeling settings / Configuración de etiquetado**. Comprueba la categoría y la lista vigente de 102 términos, además de las opciones de edición autorizadas. La lista debe incluir términos literales, sinónimos o jerga del estudio y marcas cuando correspondan. Los 156 términos de la propuesta previa son un dato del recibo; esta pantalla muestra la lista curada, no el historial de sugerencias. Si el total vigente difiere o mezcla categorías, no la edites durante esta revisión; anota la fuente que falta.

10. **Probar y restaurar una edición del léxico.** Guarda una copia privada de la lista aprobada, edita un término de prueba reversible, guarda y recarga la página. Confirma que la edición persista y luego vuelve a guardar la lista original completa. Si no puedes recuperar exactamente la lista previa, detente y pide a un analista autorizado que la restaure antes de cualquier etiquetado.

11. **Cambiar y restaurar un nombre visible.** Elige uno de los pares de tópicos que el informe de auditoría señala como casi duplicados. En la sección de nombres visibles, edita el nombre de un tópico con un prefijo temporal “QA”. Comprueba que cambia la etiqueta mostrada y que la definición, el original y el volumen siguen asociados al tópico. Restaura inmediatamente el nombre que guardaste antes de la prueba. Si la edición cambia la pertenencia o fusiona tópicos, reporta el comportamiento y no guardes otros cambios.

12. **Verificar la ruta normal de clasificación.** En un estudio de prueba existente que ya tenga mapa, abre **Classify study mentions / Clasificar menciones del estudio**. Comprueba sólo el tamaño de población, **Estimated classification cost / Costo estimado de clasificación**, el valor de **Classification budget cap (USD)** y el estado de la corrida. **Start classification** debe mostrarse antes de iniciar; **Continue classification** después de que la muestra inicial pase sus comprobaciones técnicas. La categoría, los términos y los intereses se revisan en el paso anterior, no en esta pantalla. Para este QA no pulses ninguno, no envíes solicitudes ni aumentes el límite. Si faltan población, estimación, tope o estado, captura la ruta y detente.

13. **Cerrar la revisión.** Recarga el workspace en inglés y verifica que se haya restaurado el léxico, el umbral y el nombre visible original. Informa si cada paso pasó o falló e incluye la ruta de la pantalla, filtro e interés afectados. Envía ejemplos o identificadores sólo por el canal privado acordado con el equipo.
