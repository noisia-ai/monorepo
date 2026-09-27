# Historial editorial anterior visible en UAT

Fecha: 2026-09-27 05:10 CST  
Despliegue Studio: `e420e057-8b72-43f8-9871-8ff78ca3a7e1`  
Commit desplegado: `0049404b0ee0e404e142babba7a376707f61d83c`

## Resultado

En Topics de Alexa+ ya se puede abrir el cribado V1 que había quedado oculto cuando la pantalla mostraba el progreso editorial V2. La interfaz ahora traduce su título, estado y controles en español y permite recorrer el historial guardado sin crear una revisión nueva.

La respuesta de UAT informó **920 decisiones guardadas de 1,652 grupos y 23 de 42 lotes**, con estado de ejecución `failed`. Por lo tanto, **732 grupos no tienen una decisión V1 persistida**. El historial sigue siendo parcial; no es el catálogo consolidado y no publica cambios en Signal.

Se comprobó la trazabilidad de resultados reales:

- En la primera página, “Acceso anticipado a Alexa+ en México” apunta al grupo original `guided:0078ece6-bb35-597b-8740-cfab6e0ffc63`. El detalle conserva dos citas de foros, su razonamiento y confianza registrada de 95%.
- En la segunda página, el grupo `guided:05d492c5-8e35-555a-b8e6-943f3c9f5278` aparece como Noise propuesto. El detalle conserva el razonamiento de que las menciones tratan de cerraduras inteligentes genéricas, con nueve de doce señales competitivas, y una cita de un sitio web. La etiqueta es una decisión registrada; esta revisión no calibra su precisión semántica.
- La paginación pasó de grupos 1–20 a 21–40 de 1,652 y mantuvo el mismo recuento de ejecución.

## Rendimiento observado y caché de validación

La entrega posterior `555da0e` agregó una caché positiva de 30 segundos y 256 entradas para omitir, por proceso, sólo el validador completo del plan. Autorización, censo, estado y digest, resultados de la página y citas vuelven a leerse en cada petición. El cambio pasó siete pruebas focales, typecheck de Studio, ESLint y `git diff --check`; se desplegó en Studio UAT mediante Railway `99460e75-a6fa-4e8f-8235-17d852386181`, activo y con healthcheck correcto.

La comparación no demuestra una mejora estable del recorrido. Antes del cambio se midieron **3.18 s** en offset 20 y **4.93 s** en offset 40. Después, el offset 20 tomó **1.40 s**, pero offset 40, ya con la caché caliente, tomó **7.11 s**; respuestas HTTP 200, carga útil pequeña (~14–20 KB). Son pocas observaciones no controladas y no definen SLO ni percentiles. La caché quita trabajo real de la validación integral en aciertos, pero no explica ni resuelve por sí sola la latencia de la página.

El recorrido autenticado sigue siendo secuencial: resolver usuario/workspace, leer capability y ejecución, contar y cargar grupos/evidencia del censo, leer el estado persistido de 23 lotes, verificarlo y parsear ~920 decisiones, resolver los lotes de la página y recuperar citas desde el corpus original. A partir del código, el parseo del estado, las uniones de evidencia y las consultas del censo/citas son posibles costos; **ninguno se confirmó como causa de los 7.11 s**. No se consultó PostgreSQL ni se añadió instrumentación. No atribuir un SLO o un ahorro numérico al cambio de caché.

## Estado preservado y límites

Studio pasó su healthcheck y Railway muestra el despliegue como `Active`. La página de Alexa+ muestra 1,652 grupos preparados, 36 Topics del análisis anterior y el Topic de Signal existente con 67 menciones. No se cambió el catálogo, selección, asociación, corpus, estado de ejecución, gasto, permisos o generación de Signal. No se inició ni reintentó una ejecución pagada y no se llamó a Claude, JEV o Voyage. Tampoco se ejecutó SQL, importación ni BERTopic.

La vista prueba que el historial V1 persistido puede consultarse y que las citas se vinculan a grupos originales. **No prueba una consolidación semántica completa**: la ejecución falló, 19 lotes no quedaron registrados, no existe aquí una propuesta consolidada final, y los resultados mostrados no constituyen una clasificación calibrada de los 43,159 menciones elegibles.

## Siguiente corte

La caché quedó instalada, pero una medición por tramos sigue siendo necesaria antes de una optimización de latencia. El siguiente corte de producto es hacer navegable el linaje de cada cita desde el resultado V1/V2 hasta la mención original en Signal; no requiere proveedor, cambios de datos ni migración. Después, seguir con el catálogo consolidado y Signal sin presentar el historial parcial como resultado final.

## Linaje de citas navegable

Fecha: 2026-09-27

La vista V1 del cribado anterior y la vista V2 de resultados editoriales ahora conservan el `root_id` canónico de cada cita. Junto a cada fragmento muestran **Abrir mención original**; al activarlo, Menciones recibe `?mention=<root_id>` para enfocar la conversación exacta. El ID de cita y el ID de mención se mantienen separados; para evidencia representativa, el parser exige que ambos coincidan porque en esa forma el ID es la raíz canónica.

El corte es sólo de lectura y no cambia la decisión, sus sellos, el corpus, la selección de Signal ni el gasto. La lectura de citas sigue acotada por workspace, ejecución, grupo, referencia, raíz y hash del fragmento. Se probaron el href renderizado y las dos formas de evidencia con identificadores sintéticos; no se modificó Alexa+ para hacer la prueba.

Validación local: 51 pruebas focales PASS, typecheck de Studio PASS, ESLint focal PASS y `git diff --check` PASS. La revisión de código no encontró problema de aislamiento; corrigió la aceptación de una identidad representativa inconsistente. Falta desplegar y comprobar el recorrido real en UAT.

La latencia de la página permanece sin atribución causal. La evidencia actual no permite afirmar que el enlace cambie el rendimiento ni que la caché anterior cumpla un SLO. El siguiente paso tras verificar este corte es seguir otro hueco directamente visible del recorrido de producto; para medir latencia se requiere instrumentación por etapa antes de optimizar.
