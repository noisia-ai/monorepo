# SentiOne · el chat opera la herramienta de punta a punta

> Lo normal desde noviembre de 2026: el usuario inicia sesión y dice qué proyecto se puede usar; el
> chat escribe las queries, guarda, lee totales, exporta, verifica y archiva. Salió de cuatro
> estudios que lo hicieron así: un freebie de tendencias con 15 meses y 216 mil filas, un T&B
> generacional de 1.3 millones de filas, un estudio de imagen pública de 1.5 millones y un estudio de
> un evento en siete países. Donde los cuatro no coinciden, se dice.
>
> Sin llaves, contraseñas, cookies ni tokens en este archivo, en el chat ni en la carpeta del caso.
> Si la herramienta la opera el usuario, sigue la variante "la opero yo" del prompt maestro
> (`PROMPTS.md`) y `DATA.md` §3.

## 0. Lista corta

1. Carga en **una sola** ToolSearch las herramientas de Claude in Chrome: `tabs_context_mcp`,
   `tabs_create_mcp`, `navigate`, `computer`, `find`, `read_page`, `get_page_text`,
   `javascript_tool`, `form_input`, `browser_batch`, `read_network_requests`, `tabs_close_mcp`.
2. `tabs_context_mcp` con `createIfEmpty` y una pestaña propia en tu grupo.
3. Entra por `https://sentione.com/login/listen` o `https://sentione.com/app`. `app.sentione.com`,
   `listen.sentione.com` y `platform.sentione.com` dan página de error.
4. Si ves la pantalla de acceso, te detienes y le pides al usuario que inicie sesión **en tu
   pestaña**. Nunca escribes correo ni contraseña. Si dice que ya entró y no lo ves, es otro perfil
   de Chrome: `list_connected_browsers`.
5. Los permisos se piden una vez, en la primera validación (sección 1).
6. Respaldo de las reglas del proyecto antes de tocarlo (sección 2).
7. Primero un export chico y su perfil (zona, idioma, país, ruido); después el resto.
8. Exportaciones de menos de 100 mil filas, **una a la vez en toda la cuenta**, cada una esperada,
   contada y archivada con `builders/wait-export.py` (sección 5).
9. Totales sin descargar: por la API del tablero, comprobando que el filtro se movió (sección 4).

## 1. Lo que hace el usuario, y nada más

| Qué | Cuándo |
|---|---|
| Iniciar sesión en la pestaña del chat | Al arrancar, y cuando la sesión expira (pasó de un día a otro) |
| Decir qué proyecto se puede reescribir ("cualquiera sin edición en 30 días" es una respuesta válida) | En la primera validación |
| Autorizar por escrito guardar en ese proyecto | En la primera validación. Sin esa frase en el chat, el clasificador de permisos bloquea Save y las reglas de idioma |
| Autorizar leer totales por la API del tablero desde su pestaña | En la primera validación, si el estudio lo necesita |
| Aprobar el plan con la lista de descargas | Una sola vez, con el plan completo |

El chat no borra ni archiva proyectos. Si no hay lugar, lo pide.

## 2. Proyectos y reglas

- **La cuenta está llena** (300 de 300 proyectos, 30 de 30 hashtags de Instagram): "Create project"
  sale apagado. Se reutiliza el proyecto que el usuario diga.
- **Un proyecto puede pasar a otro caso entre sesiones.** Al volver, abre el proyecto y confirma
  nombre y reglas antes de tocar nada. Si cambiaron, no se toca y se pregunta.
- **Otra persona puede estar usando la cuenta en ese momento**, y la vista de menciones puede abrir
  otro de sus proyectos. Antes de cada lectura se comprueba el nombre del proyecto en la página.
- **Respaldo antes de reescribir**, siempre. Las cuatro retros lo marcan como lo que harían distinto.
  Abre `#/topics/edit/<id>` (si abrirlo directo deja la página en blanco, entra al editor desde el
  lápiz del proyecto en la lista), léelo con `get_page_text` (expande Options y Attributes) y escribe
  `inputs/queries/_sentione/<id>_antes_<fecha>.md` con el nombre, el id, cada regla con su
  Include o Exclude, el texto de la Advanced query (`document.querySelector('textarea').value`) y su
  longitud. Al cerrar el caso se devuelve, si el usuario lo pide.
- **El nombre del proyecto sale en el nombre de cada archivo exportado.** Nunca el nombre del
  cliente: "Noisia - <tema> (estudio)".
- **Anatomía del formulario.** "Add rule" tiene Keywords (Advanced keywords, Author, TikTok keywords,
  Hashtag, Advanced query), Social profiles y Source (Domains, Urls, Country, Language, Google
  Reviews). Cada regla lleva Include o Exclude. "Results preview" cubre los últimos 3 meses y no se
  cambia: sirve para comparar versiones de una query y para medir el orden de magnitud de cada una
  antes del plan (en mercado chico la tabla va dentro del plan, `METHODOLOGY.md` §1), nunca como
  total.
- **La regla Language se autollena** con decenas de idiomas al agregarla. Se revisa y se deja solo lo
  que va (es un react-select: `mousedown`, `mouseup` y `click` sobre el ícono de quitar; un
  `TouchEvent` falla).
- **"Ignore special characters"** (Options) se deja encendida. No está probado qué hace con acentos.
- **TikTok keywords recolecta hacia adelante** desde que se guarda: no da historia. Una palabra por
  regla; varias palabras se vuelven AND. El TikTok histórico llega por la Advanced query.
- **Social profiles sobre una página de Facebook no indexada** da 0 en la vista previa y pide "save
  and wait": recolecta hacia adelante, sin historia, igual que TikTok keywords.
- **Cuentas propias:** Social profiles, una por red, y desmarcar comentarios, retuits, compartidos y
  menciones para traer solo lo que publica la cuenta. La regla de X igual trae terceros: se separan
  por autor en el ETL.
- **Guardar.**
  - Cada Save va en su propia llamada, sin navegar en el mismo lote; navegar justo después de un
    Save se bloqueó una vez. Se espera y se lee la página.
  - Se verifica: recargar y comparar la longitud del textarea y sus últimos 30 caracteres con el
    archivo. Una sesión vencida pierde el cambio sin avisar.
  - Si hiciste pruebas después de guardar, sal del editor con Cancel.

## 3. Queries

Las reglas de sintaxis viven en `METHODOLOGY.md` §1 y la generación por script en `DATA.md` §3.
Lo propio de operar la herramienta:

- **La ayuda completa se baja como markdown:** `https://listen.help.sentione.com/llms.txt` da el
  índice y cada página existe como `.../docs/<slug>.md`. Las que mandan: `operators`,
  `keyword-based-rules`, `source-based-rules`, `social-profiles-rules`, `tiktok` y
  `what-is-the-difference-between-country-and-language-filter`.
- **Advanced query, no Advanced keywords**, para las queries del estudio. En Advanced keywords cada
  término es un chip y se combinan con OR; un `OR` escrito dentro de un chip se lee como palabra.
- **Pegar:** el texto sale del archivo que generó el script, nunca tecleado a mano.
  `... | LANG=en_US.UTF-8 pbcopy` (sin forzar UTF-8 se corrompe todo lo que no es ASCII), clic en el
  campo, `cmd+a`, **Supr**, `cmd+v`, y comparar la longitud con `javascript_tool`. Escribir sobre una
  selección hace que el editor borre el `("` inicial, y eso da "Invalid query format".
- **El portapapeles falla en silencio y es compartido.** `pbcopy` dejó una vez el portapapeles vacío,
  sin error, después de cambiar de directorio de trabajo, y se pegaron 0 caracteres; otra vez, otra
  sesión copió entre el `pbcopy` y el pegado. `pbcopy` y pegado van en la misma ronda de
  herramientas, sin otra llamada entre ellas, con `pbpaste | head -c 200` antes y la longitud del
  campo después. **Con varias sesiones activas, la vía preferida no usa portapapeles:** el setter
  nativo del textarea (`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,
  'value').set`) más un evento `input`, y luego teclear un espacio y borrarlo para que el editor
  registre el cambio (sin ese tecleo la vista previa queda en 0). Se verifican longitud y vista
  previa antes de Save.
- **Clic en blanco fuera del campo** para que la vista previa se actualice. Si la vista previa se
  queda con el error de la query anterior, el guardado es la prueba.
- **Idioma:** la evidencia es mixta. En un caso el filtro aplicó con Advanced query (un tópico bajó
  de 8,105 a 2,523 y conservó el 99.3% de las formas propias del idioma) y la pantalla de edición dice
  que lo respeta; en otro, con español marcado, 901 de 1,535 menciones llegaron en inglés. Se prueba
  en la vista previa con un ancla, con y sin el idioma marcado, y se perfila el primer export.
  Existe "Spanish (es-mx)" como valor aparte de "Spanish": se marcan los dos.
- **País: no sirve para redes.** Con Advanced query queda en gris o no mueve el conteo; como regla de
  fuente cubre casi solo noticias (2,555 menciones contra 626,363 sin filtro, en tres meses); con
  México en la vista de menciones, TikTok, Reddit y video quedan en cero. El mercado se resuelve en
  la query (anclas) y en el ETL (columna `Country` más señales del texto), y el total se reporta por
  idioma, nunca como total de un país.
- **Diacríticos:** se vio que SentiOne iguala `ă` con `a`. Igual cada término acentuado va con su
  gemelo sin acento (`METHODOLOGY.md` §1).

## 4. Totales sin descargar

Hay dos lugares y dan números distintos. **La analítica del tablero y su API no cuentan comentarios
de YouTube**; la vista de menciones y el export sí. La diferencia es lo que pese YouTube en la
query: 3% en un caso; en otro, una prueba de un día dio una quinta parte. En una query sin `rawText:`,
la vista además infla YouTube con comentarios que entran por el título o la descripción del video.
Base del embudo: la analítica de la query sin `rawText:`, con YouTube medido aparte sobre su texto
propio (`DATA.md` §25). Se elige **una vista por estudio**, se dice en el método y no se mezcla.
**Para el corpus manda la exportación**: lo que el archivo trae, contado con lector CSV.

### 4A. El contador de la vista de menciones (para conciliar cada export)

1. Vista de menciones del proyecto (`#/results`), con su nombre comprobado en la página → **Reset
   filters**. La vista arrastra filtros y ventana de usos anteriores (país, "este año", fuentes
   desmarcadas, un tramo viejo): se resetean antes de cada lectura y de cada export. Después de un
   Save conserva el "Created at: Customize" de la sesión anterior: el filtro de fecha se resetea
   también.
2. Selector de fechas → Custom. `triple_click` en el campo, fecha en `dd/mm/aaaa`, Enter, Apply, y
   esperar 8 a 10 segundos. **El fin es exclusivo a las 00:00:** para cubrir hasta el 9 se escribe
   el 10. Un día de colchón en cada extremo; el corte exacto lo hace el ETL en hora local.
3. Leer "Browse mentions (N)" con `find`, **dos veces con 5 s entre lecturas**: después de un Save
   el contador muestra unos segundos un número viejo antes del real. El separador de miles es un
   espacio.
4. Anotar N en el manifiesto **antes** de exportar.

### 4B. La API del tablero (totales por idioma, por red y series, sin descargar)

Para cuando hacen falta muchas combinaciones de ventana e idioma. El selector del panel de análisis
arrastra la hora actual y no garantiza la ventana. Los CSV de widgets bajaron uno y Chrome bloqueó
el segundo en un caso, y en otro salieron todos sin bloqueo (depende, probablemente, del permiso de
descargas múltiples del navegador): se piden todos y se cuentan los que llegaron. Su ventana no
cierra a las 23:59 del último día y quedan de 0 a 2% abajo del contador: son evidencia, no la base
del embudo. Usa `builders/sentione-api.js` desde `javascript_tool`, en la pestaña del usuario y con
su permiso:

1. Con el proyecto guardado, abre su panel (`#/dashboards/show/<id>`). Si abrirlo directo deja la
   app en blanco, instala desde la vista de menciones (`#/results`): en el paso 2, en lugar de
   refrescar el panel, alterna un filtro de fuente para que la app haga sus llamadas.
2. Pega el bloque de instalación del archivo y pulsa refrescar en el panel: así se capturan los
   **nombres** de los encabezados que manda la app y la plantilla del cuerpo. Una llamada sin esos
   encabezados da 401. Los valores nunca se imprimen, ni se guardan fuera de la página.
3. Llama `__sentione.poll('source/total', {...})`. La respuesta es asíncrona: llega
   `success:false, progress:0` y se sondea cada 1.5 s hasta `success`.
4. **Comprueba que el filtro se movió.** Un parámetro mal escrito no da error: devuelve el total sin
   filtrar. Solo `language` filtra por idioma (`languages`, `lang` y `langs` se ignoran en silencio),
   y `['es']` no incluye variantes: van `es, es-mx, es-es, es-ar, es-co, es-cl, es-us`.
5. Series: `statements/time` o `source/time` con `granulation:'day'` o `'month'`. `from` y `to` en
   ms UTC; los cortes diarios de la API van en la zona de la cuenta, no en UTC (ver sección 6).
6. Saca los datos como archivo (`__sentione.download(nombre, csv)`), no por la consola: la salida de
   `javascript_tool` se corta a unos 1,200 caracteres.
7. Cuadra un total contra el contador de 4A antes de usar los demás. Se anota en
   `inputs/sentione_totals/README.md` con ventana UTC, hora de lectura y vista usada. Antes de bajar
   widgets, revisa "Edit settings for all widgets": el panel conserva el filtro Countries de una
   ronda anterior, y en un caso una marca dio una quinta parte de su total, sin TikTok, Instagram ni
   Reddit.
8. Los CSV de widgets **también se mueven** a `inputs/sentione_totals/`, con su manifiesto, como
   los exports (sección 5). En un caso treinta se quedaron en `~/Downloads`.

La app es de una sola página: después de guardar otra query, las funciones siguen vivas. Si la
página se recarga, se repite el paso 2. Nunca se levanta un receptor en localhost ni se inyecta código
en otra página sin el sí del usuario.

## 5. Exportar

1. Vista de menciones con los filtros del corte y la ventana del tramo (4A, con su reset).
2. **Tamaño del tramo: menos de 100 mil filas**, medido en el contador. Si pasa, se parte por mes,
   por quincena o por 8 días en el mes más alto. Lo visto: en una cuenta salieron completos archivos
   de hasta 164,713 filas y 239 MB; en otras, un export del periodo completo (216 mil) se cortó a los
   40 MB y desapareció sin aviso, y uno de unos 97 mil falló sin aviso. El tope real no está claro;
   menos de 100 mil es lo que funcionó en las cuatro. El peso va de 1.1 a 3.7 KB por fila según la
   query (lo alto, en inglés): el primer tramo de cada query sale chico y fija el tamaño. Medio mes
   de unas 60 mil filas bajó en 4 a 5 minutos; `wait-export.py --gzip` lo archiva comprimido.
3. Export → **CSV file**. La descarga arranca sola hacia `~/Downloads`.
4. **Una a la vez en toda la cuenta.** Cuatro seguidas se cancelaron entre sí y ninguna llegó en 20
   minutos. Se pide, se espera el archivo completo, se verifica, se pide la siguiente. Navegar a
   mitad de la descarga la borra: el chat se queda en la página.
5. En segundo plano:

   ```bash
   python3 packages/pitch-kit/builders/wait-export.py --from 202609300000 --to 202612110000 \
     --expected 19795 --dest <caso>/inputs/exports --label MX_2025 \
     --manifest <caso>/inputs/exports/MANIFEST.tsv
   ```

   Espera a que no quede ningún `.crdownload`, elige el archivo **por la ventana de su nombre**
   (dos exports pedidos el mismo minuto llegaron en otro orden y cruzaron sus nombres), cuenta filas
   con lector CSV real, calcula el sha256, lo mueve con su etiqueta y escribe el manifiesto. Sale
   con 0 si cuadra, 1 si no, 2 si se acabó el tiempo y 3 si hay dos archivos con la misma ventana.
6. **Si no llega en 6 minutos**, no se pide otro encima: se revisa la pestaña y las notificaciones de
   la app, y se pide **el mismo tramo**. En `~/Downloads`, no en `chrome://downloads`, que la
   extensión no lee.
7. Unas pocas filas de más contra el contador (+1, +11, +189) son menciones indexadas entre el conteo
   y la descarga: diferencia de definición, se acepta y se anota (`DATA.md` §7).

**Formato:** `;`, UTF-8 con BOM (`utf-8-sig`), saltos de línea dentro de campos,
`csv.field_size_limit(10**9)`. Nombre: `<Proyecto>_from<AAAAMMDDhhmm>_to<AAAAMMDDhhmm>_exportedAt<AAAAMMDDhhmm>.csv`,
con `to` exclusivo. Los CSV de widgets del tablero pueden traer el nombre de otro proyecto: se
validan por contenido. Trae autor, id de autor y liga: no hay opción de anonimizar en CSV, así que el
ETL seudonimiza y los nombres no salen de la carpeta del caso (`leak-check.py` con `--names`).

**Tiempos vistos:** de 30 segundos a 6 minutos por archivo; 24 exports de 26 a 96 mil filas en unos
55 minutos con verificación; 28 exports en 32 minutos en otra cuenta. No apareció límite de tasa al
exportar en ninguno de los cuatro casos. "Too many requests to server at once" sí sale al marcar
filtros seguidos (ocho filtros de fuente sin pausa, en un caso): 5 s entre clics, y recargar si
aparece.

## 6. Zona horaria

- `exportedAt` del nombre está en UTC: compararlo con la hora local de la descarga da el offset del
  nombre al instante.
- `Created` del archivo salió en UTC en cuatro casos y en la zona del perfil (Europe/London, con
  horario de verano) en otro. UTC es la hipótesis de partida; se comprueba en el primer archivo,
  nunca se asume (`DATA.md` §5): por el valle de actividad, por `exportedAt` contra la hora local de
  la descarga o, en X, por el id del tweet (`(id >> 22) + 1288834974657` da el ms UTC).
- Las cubetas diarias de la API cortan en la zona de la cuenta, aunque el export venga en UTC.

## 7. Errores que ya costaron tiempo

| Síntoma | Qué es | Qué se hace |
|---|---|---|
| Página de error al entrar | URL equivocada | `sentione.com/login/listen` o `sentione.com/app` |
| "Create project" apagado | Cuenta en 300 de 300 | Reutilizar con permiso y respaldo |
| Save bloqueado por el clasificador | Falta la autorización escrita | Pedirla; cada Save en su propia llamada |
| "Invalid query format" | El editor borró el `("` inicial, o un `NEAR` o un operador de campo | Supr y pegar; si sigue, partir en mitades |
| Un total que no se mueve con el filtro | Parámetro mal escrito, o país en redes | Comprobar con otro valor; cortar por idioma |
| 401 en la API | Faltan los encabezados de la sesión | Instalar y refrescar el panel |
| Respuesta vacía de la API | Es asíncrona | Sondear hasta `success` |
| Salida de JS con "[TRUNCATED]" | Límite de la consola | Bajar como archivo |
| Archivo de menos o desaparecido | Tramo grande o exports encimados | Menos de 100 mil, uno a la vez, mismo tramo |
| Nombres de archivo cruzados | Se eligió por hora de llegada | Elegir por la ventana del nombre |
| Pestaña congelada | Script de más de 5 s | Abrir otra y cerrar la vieja |
| `wait` largo en `browser_batch` falla | Tope de 10 s | Esperas cortas o `wait-export.py` en segundo plano |
| `find -newermt "-20 minutes"` falla | `find` de macOS | `ls -lt` |
| `javascript_tool` se corta a los ~45 s | Tope de la herramienta; la descarga que pidió igual llega | Revisar `~/Downloads` antes de repetir |
| "Too many requests to server at once" | Filtros marcados sin pausa | 5 s entre clics y recargar |
| El contador no termina y la cuenta se traba | Una query de una marca masiva sola, sin cláusula | No correrla; la marca va con su cláusula de contexto |
| La página queda en blanco al abrir una liga directa | `#/topics/edit/<id>` o `#/dashboards/show/<id>` abiertos directo | Editor desde el lápiz de la lista; API desde `#/results` (sección 4B) |
| Se pegan 0 caracteres | `pbcopy` vacío u otra sesión copió encima | Setter nativo del textarea, o `pbcopy` y pegado en la misma ronda (sección 3) |
