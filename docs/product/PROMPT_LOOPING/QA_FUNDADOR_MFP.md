# QA del fundador · etiquetado de Signal en dev-test

Entorno de prueba: [Noisia Studio en dev-test](https://mfp-studio-dev-test.up.railway.app). Inicia sesión con tu cuenta habitual y abre el workspace autorizado del Estudio real A. Los cambios de configuración de este recorrido se deben restaurar antes de terminar. No inicies un reetiquetado completo del corpus: revisa los resultados ya preparados.

1. **Abrir el workspace.** Selecciona el Estudio real A y entra a **Topics / Tópicos**. Debería abrir Signal en inglés con sus tópicos disponibles. Si no aparecen los tópicos o ves un aviso de carga, recarga la página una vez y confirma que estás en dev-test. Si continúa, anota el estado y detente sin iniciar otra corrida.

2. **Ver la traducción y su fuente.** Abre un tópico y mira su nombre y definición en inglés junto al bloque **Corpus original** en portugués. Alterna a español si el selector está disponible y regresa al inglés. Si falta la definición original o el nombre cambia de tópico al alternar, anota el tópico seleccionado sin copiar publicaciones y comunícalo para corregir la localización.

3. **Comprobar el volumen completo.** Regresa a la lista y confirma que hay 98 tópicos. Mira su orden y los conteos. Si el total cambia, los nombres son cadenas internas o los conteos quedan vacíos, comprueba que el workspace seleccionado sea el estudio preparado y reporta el resultado.

4. **Separar las poblaciones.** Cambia el selector **Content / Contenido** entre conversación, publicidad, sólo hashtags y todo el contenido. Los denominadores del Estudio real A son 61,524, 22,167, 271 y 83,962, respectivamente. Las categorías de conversación y publicidad deben tener poblaciones distintas; los posts compuestos sólo por hashtags quedan en su propio segmento. Si un filtro no responde o se repiten los mismos resultados, anota qué opción elegiste.

5. **Revisar el denominador de consumidor.** En el indicador **Consumer motivators and barriers**, verifica que aparezca la población elegible y los casos excluidos por no contener el léxico. Los casos sin término no deben confundirse con respuestas que no expresan motivador ni barrera. Si las cifras de elegibles, incluidos y excluidos no se distinguen, no interpretes las proporciones y reporta los nombres de esos indicadores.

6. **Abrir evidencia de un motivador.** Abre uno de los ejemplos enlazados desde el indicador de motivadores. Comprueba que el texto corresponda al registro abierto y que contenga un término de categoría del léxico. La evidencia puede mostrar el original del corpus. Si el ejemplo no coincide, carece de acceso o no contiene un término, anota la decisión y el identificador que presenta Signal en el canal privado de QA.

7. **Abrir evidencia de una barrera.** Repite la revisión desde el indicador de barreras. El ejemplo debe contener un término de categoría y describir una razón para evitar o reducir el consumo, en voz individual. Una publicación promocional, una referencia casual a la categoría o una queja sobre otro asunto no debe contarse como barrera. Si ves una, anota el código del registro y la categoría, sin pegar el texto en una conversación pública.

8. **Revisar Apostas y Racismo.** Abre **Defined interests / Intereses definidos**. Revisa que ambos intereses estén presentes y que las cantidades usen el umbral 0.85 o superior. Examina los ejemplos disponibles: una metáfora con “apostar” no debe clasificarse como una apuesta real; insultos sin dimensión racial no pertenecen a Racismo. Si faltan las definiciones ajustadas o el umbral mostrado y aplicado no coincide, reporta el interés y la vista.

9. **Inspeccionar el léxico del estudio.** En **Manage Topics / Gestionar topics**, abre **Study labeling settings / Configuración de etiquetado**. Comprueba la categoría, los términos propuestos desde Brand OS y las opciones de edición autorizadas. La lista debe incluir términos literales, sinónimos o jerga del estudio y marcas cuando correspondan. Si la propuesta está vacía o mezcla categorías, no la edites durante esta revisión; anota la fuente que falta.

10. **Probar y restaurar una edición del léxico.** Guarda una copia privada de la lista aprobada, edita un término de prueba reversible, guarda y recarga la página. Confirma que la edición persista y luego vuelve a guardar la lista original completa. Si no puedes recuperar exactamente la lista previa, detente y pide a un analista autorizado que la restaure antes de cualquier etiquetado.

11. **Cambiar y restaurar un nombre visible.** Elige uno de los pares de tópicos que el informe de auditoría señala como casi duplicados. En la sección de nombres visibles, edita el nombre de un tópico con un prefijo temporal “QA”. Comprueba que cambia la etiqueta mostrada y que la definición, el original y el volumen siguen asociados al tópico. Restaura inmediatamente el nombre que guardaste antes de la prueba. Si la edición cambia la pertenencia o fusiona tópicos, reporta el comportamiento y no guardes otros cambios.

12. **Verificar la configuración que usaría un estudio nuevo.** En la pantalla normal de preparación de un estudio de prueba ya existente, confirma que el etiquetado se selecciona automáticamente, en inglés, con promoción, voz, motivadores o barreras nombrados con la categoría del estudio, cuatro candidatos y los intereses activos. Confirma que los hashtags puros se resuelvan con la regla determinista. Revisa la estimación y el límite antes de ejecutar. Para este QA, no envíes solicitudes ni aumentes el límite.

13. **Cerrar la revisión.** Recarga el workspace en inglés y verifica que se haya restaurado el léxico, el umbral y el nombre visible original. Informa si cada paso pasó o falló e incluye la ruta de la pantalla, filtro e interés afectados. Envía ejemplos o identificadores sólo por el canal privado acordado con el equipo.

## Coste orientativo

La proyección del auditor para siete preguntas es USD 107–112 por millón de raíces, incluidos aproximadamente USD 37 de Voyage, USD 60 de JEV y USD 10–15 de Claude según la cantidad de grupos. Cada interés activo suma aproximadamente USD 7.50 por millón de raíces dentro de la misma solicitud JEV. Con dos intereses la referencia total es USD 122–127 por millón. Son precios de uso estimados y dependen del corpus, número de grupos, tarifas y tokens observados; muestra el límite vigente de la corrida antes de gastar créditos.
