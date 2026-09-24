# Copy rules — every word on a Noisia deck passes through this

> Noisia ya es un negocio complejo. **La press no.** Cada texto que va a una slide se
> escribe simple, humano y client-ready. Adaptado del skill Humanizer
> (github.com/alexdcd/Mafia-Claude-Skills) + reglas de Noisia. Esto es **obligatorio**:
> el skill `noisia-pitch` corre todo el copy por aquí antes de renderizar.
>
> Ver también **`LEARNINGS.md`** (reglas de campo: terminología política MX, "jugadas"→estrategias, no nombrar herramientas, voz del público ≠ social listening, pricing, etc.).

## 0. Sanitización client-ready (lo más importante — regla dura)

El cliente ve **solo su mensaje**. Nunca dejes en la slide:
- **Propósito / navegación de la slide.** Ej. el header decía "cómo crecemos juntos" — eso describía la función de la slide, no es copy. ❌ "Slide de cierre", "Aquí explicamos…", "como veremos a continuación", "en la siguiente slide".
- **Etiquetas internas / meta.** ❌ `{{PLACEHOLDER}}` sin rellenar, `[slide: …]`, comentarios `<!-- … -->`, `data-label` describiendo el tema (es metadata de navegación; no se renderiza, pero no lo uses como copy), nombres de tier como adorno ("FOUNDATION TIER").
- **Notas del proceso/IA.** ❌ "Entregables: (ver KB)", "TODO", "ejemplo:", "nota interna", "confianza del modelo", instrucciones a ti mismo.
- **Emojis** y signos decorativos.
- **Header derecho y footer, resueltos.** El footer izquierdo dice siempre
  `noisia · social intelligence architects` y el derecho la numeración `NN / TOTAL`. El header
  derecho lleva la marca `noisia.ai`, o bien, en un deck con secciones, una etiqueta corta de
  sección o el mercado y el año. Lo que nunca lleva es el propósito de la slide, ni la misma
  frase del eyebrow o del título. Una sola convención por deck, elegida en la portada y sostenida
  hasta el cierre.

- **Nada que revele intención comercial de análisis.** No nombres el *framing* del entregable: "subcategoría", "categoría", "monitoreo de categoría", "share of voice de la categoría" delatan que vendemos análisis de categorías. Escribe sobre el sujeto (la marca, la conversación, el mercado), no sobre el método de venta. Ej. ❌ "The category got louder" → ✅ "The conversation got louder this month".

- **Calibra el vocabulario por audiencia (matiz al "vende la pregunta, no el método").** El default sigue siendo la pregunta, no el método: para un C-level o cliente final, cero jerga de framework. **Pero si el público es una agencia, un partner o un equipo interno que ya habla el marco**, los términos T&B en inglés son válidos y hasta esperados en eyebrows y headers: `trigger`, `barrier`, `top trigger`, `top barrier`, `CX`, `pros y cons`, `conclusiones de t&b`, `Empuja (trigger)`. No los metas en el título ni en el cuerpo (ahí la idea se dice en humano); van en la etiqueta de sección. Decide el registro por quién recibe el deck, no por costumbre.

  **Nombrar el método en una slide es una decisión por deck, no un precedente.** El default sigue
  siendo no nombrarlo. Un caso lo tituló con su nombre porque ahí la narrativa lo pedía, y se
  decidió como excepción de ese caso. El siguiente lo leyó en el registro del anterior y lo
  convirtió en regla, que es exactamente lo que no debe pasar: una excepción registrada en el
  `PROVENANCE_AND_CHANGELOG.md` de un caso no es canon. Se pregunta cada vez, que es lo que hace
  la pregunta 3 del prompt de arranque.

Antes de exportar: lee cada slide como si fueras el cliente. Si una palabra no es para él, fuera.

> El contrato que ordena todo el sistema es **`CANON.md`**. Íconos y layouts también son reglas: **`ICONS.md`** (Iconoir para semánticos + Simple Icons para marcas, nada dibujado a mano) y **`LAYOUTS.md`** (las dos formas canónicas: Reporte y Estudio T&B).

## 0.5 Posicionamiento, no solo estilo

Tres reglas que vienen de feedback de cliente y que cambian el sentido de la slide, no su forma:

- **No somos social listening.** El foco es la **voz del público**, o del consumidor, o del
  electorado según el caso. El monitoreo de redes es el medio, no lo que se vende.
- **Nunca "jugadas".** No se dice así en México. Usa estrategias, decisiones o movimientos.
- **Las slides de proceso explican cómo trabajamos con el cliente**, no el método interno. Y
  "lectura" como sustantivo no se entiende: di reporte o diagnóstico.

El vocabulario por terreno, incluida la tabla de terminología política MX y su nota de protección
legal, vive en `LEARNINGS.md`. Léelo antes de escribir para un terreno nuevo.

## 1. Español mexicano — NO traduzcas tecnicismos ni modismos

Si la press va en español, **mantén los anglicismos que en México se dicen en inglés.** Traducirlos suena a manual ajeno.

| ✅ se queda en inglés | ❌ no lo traduzcas a |
|---|---|
| Dashboard | "Panel de control" |
| Insight / insights | "perspectiva" |
| Brief / briefing | "informe" |
| Performance | "desempeño" (en marketing) |
| Funnel | "embudo" (salvo que el cliente lo pida) |
| Awareness | "conciencia de marca" |
| Social listening | "escucha social" (úsalo solo si el cliente lo usa) |
| Engagement, share, retainer, benchmark, corpus, trigger, barrier, target | — déjalos |

Regla: usa el término como lo usa **el cliente y su categoría**. Ante la duda, el inglés técnico estándar. Castellano para todo lo demás. No "mexicanices" de más ni traduzcas de más.

## 2. Humanizer — quita las marcas de IA

**Palabras/muletillas prohibidas** (ES + EN): además/additionally, crucial/clave/pivotal, profundizar/delve, potenciar/enhance, fomentar/foster, robusto, sinergia, en el corazón de, un testimonio de, no solo… sino…, en aras de, cabe destacar, en resumen, en conclusión, vibrante, integral, holístico, aprovechar/leverage, desbloquear/unlock, transformar (como cliché), "stands as / serves as".

**Patrones a evitar:**
- **Significancia inflada.** Di el hecho, no su grandeza. ❌ "Esto representa un hito que redefine…" ✅ "Esto cambia X."
- **Regla de tres forzada.** No metas todo en triadas para sonar completo.
- **Copula de relleno.** ❌ "se posiciona como / funge como" → ✅ "es / tiene".
- **Em dashes y negritas mecánicas.** Usa comas y puntos; negrita solo si es estructural.
  Esta es regla dura y se verifica, no se revisa a ojo: antes de entregar, `grep -c '—' index.html`
  tiene que dar `0`, incluido el `<title>`. Es la huella de IA que el lector detecta primero.
- **Gerundios de relleno.** ❌ "destacando, reflejando, mostrando…" → afirma el hecho.
- **Conclusiones genéricas optimistas.** Cierra con un hecho o un siguiente paso concreto, no con "el futuro es prometedor".
- **Filetes y adornos de acento.** Un borde vertical de color a la izquierda de un título lo
  detecta un cliente como marca típica de IA. Igual que cualquier decoración que no aporte dato.
- **Títulos con colon-reveal.** Nadie habla así. ❌ "The screen, mapped: every pull casts a shadow" / "X: subtítulo dramático" → ✅ frase natural declarativa: "Every pull the screen creates has a matching barrier".
- **Frase repetida en la misma slide.** El eyebrow, el header derecho y el título **no** dicen lo mismo. ❌ "how a decision reads" en los tres → cada uno distinto y natural.

**Lo que sí queremos:** frases de largo variado, una opinión/postura clara, lenguaje concreto y específico, y la voz directa de Noisia (sin vender de más). Citas literales sin maquillar (la imperfección es información — regla de `kb/03-process/delivery-format.md`).

## 2.4 El título dice el hallazgo, nunca describe la slide

Es la regla que más cambia un deck y la que más tarde llegó al kit. Salió de ocho títulos que un
cliente rechazó uno por uno.

Un título que describe la slide le informa al cliente de algo que ya está viendo. Si abajo hay una
tabla de temas, ya sabe que va a leer temas: decírselo en 76 píxeles de altura es gastar el lugar
más caro del deck en una etiqueta.

> ¿Pagarías por un reporte cuyo título describe de qué es la slide?

**Prueba operativa.** Tapa el cuerpo y lee solo el título. Si con eso ya sabes algo nuevo del
negocio, sirve. Si solo sabes qué vas a ver, es una etiqueta.

Los cinco modos de falla, todos de decks reales:

| Falla | Antes | Después |
|---|---|---|
| Nombra el contenido | Once meses de conversación, y el canal donde de verdad vive | El mes más ruidoso no fue el más crítico, y el canal más grande tampoco |
| Enumera las columnas | Lo que se mueve con operación, lo que necesita a un tercero y lo que solo se comunica | La posventa va primero porque cambia el recuerdo de todo lo anterior |
| Le habla al equipo | Lo que la gente escribió, sin corregir | El reclamo llega con sucursal, hora y número de pedido |
| Filtra la conversación interna | Los cuatro temas del tablero, y los dos que el año agregó | Servicio en mostrador es el tema más grande y el más crítico a la vez |
| Colon-reveal | Mostrador y consultorio: donde la espera se vuelve trato | En mostrador y consultorio la espera se convierte en trato |

Dos generalizaciones que valen por sí solas:

- **Si el título presume del rigor del entregable, está mal dirigido.** Sin corregir, verificado,
  real, exhaustivo. El rigor se demuestra en la slide de método y en el registro de procedencia, no
  en un titular. Que las citas sean textuales es una regla del kit, no un logro que se anuncia.
- **Ninguna palabra del deck debe requerir haber estado en la conversación previa.** Brief, tablero,
  alcance acordado, lo que pediste, la conversación que tuvimos. Todo eso es vocabulario interno.

**Tres excepciones declaradas**, donde el título descriptivo es el correcto: la portada de un
estudio, donde el título es la pregunta de investigación; la slide de brief; y las páginas de
referencia, glosario y método, que se nombran por lo que son.

### El título no puede afirmar más que el dato, ni menos

Antes de cerrar un título se revisa contra la cifra que lo sostiene. Si la cifra sostiene una
afirmación más grande, se usa la más grande; si sostiene una más chica, se baja el título. Dos
casos reales, uno de cada lado: una portada decía "lo hecho a mano" cuando el corpus sostenía
"textil mexicano", y una slide decía que la conversación ocurre sin la marca cuando la cifra decía
algo más grande e incómodo, que ocurre **sin ninguna marca**, 1,911 de 1,934.

### La cifra no se pega al nombre del motivo

Un trigger es un motivo y un motivo agrupa muchas menciones. **"187 triggers psicológicos" está
prohibido**, porque afirma que existen 187 motivos distintos. Se escribe "187 menciones con señal
de trigger psicológico", que cabe igual en la slide y es lo que el pipeline realmente contó. Vale
para las seis metodologías: lo que se cuenta son menciones que llevan la señal, no motivos.

### La contraportada se titula por lo que es

La regla de títulos aplica al cuerpo del deck. Las páginas de referencia llevan título literal:
Glosario. Método y alcance. Alcance y límites. Una frase donde va un nombre se lee como relleno.

## 2.6 Vocabulario del método, una sola vez y completo

El deck no alterna entre empuje, freno, trigger y barrier según la slide: para el cliente eso son
cuatro palabras para dos conceptos. **La slide del marco enseña el término técnico con su
traducción una sola vez**, en la etiqueta del mapa, y de ahí en adelante el deck usa el término
técnico y nada más.

Donde las dos cifras aparezcan juntas, el trigger va en teal y el barrier en coral, siempre, con su
etiqueta escrita. Un "187 / 0" en un solo color no dice cuál es cuál.

**Las acotaciones tampoco llevan jerga de quien armó el corpus.** "Misma regla y mismo periodo" lo
entiende quien construyó el corpus. Se escribe "las dos columnas se midieron con el mismo criterio
y el mismo periodo".

## 2.7 Las citas

**La cubeta sirve para buscar la cita, nunca para elegirla.** Un par de etiquetas como
`trigger|cultural` contiene lenguaje normativo y lenguaje de orgullo a la vez, así que tomar las
dos primeras de la cubeta mete citas críticas debajo de un título sobre el orgullo. La cubeta
estaba bien clasificada y la selección mal. **Se elige a mano y se revisa contra el título de la
slide**, no contra la etiqueta.

**Las ligas pegadas dentro del texto se limpian.** Una cita de redes suele traer una URL adentro;
mostrarla hace ver el verbatim como un volcado de base de datos. Se limpia del texto que se muestra
y la liga de la publicación va donde le toca, en la ficha, con plataforma y fecha.

**La limpieza quita ligas y handles, nunca palabras.** Una regla que borraba la primera palabra si
venía en mayúscula convirtió "No le da vergüenza" en "le da vergüenza": invirtió la cita. Si una
regla de limpieza toca palabras, se revisa contra las negaciones antes de correrla, y la cita
final se compara contra el original.

**Deck en inglés con citas en español.** La cita se muestra en su idioma original, porque es la
evidencia y no se toca. Debajo va una lectura en inglés, más chica y en gris, y la ficha queda
igual. Traducir la cita y poner el original abajo invierte cuál es el dato y cuál es el apoyo.

### Sin dramatizar

El título dice el hallazgo con su cifra, no lo narra. "En enero la ciudad se volteó contra quien
la gobierna" suena a respuesta a una pregunta que nadie hizo; "La queja subió 31 puntos en enero
y no ha bajado desde entonces" dice lo mismo y se puede discutir.

**Opina la gente, no el lugar.** "La ciudad" o "la capital" como sujeto de una opinión es una
metonimia que no se entiende en una slide: se escribe "los ciudadanos", "los usuarios", "quienes
comentan".

**El entregable se nombra por su familia.** Este estudio, este reporte. No "esta lectura", no "este
diagnóstico": son las palabras que más se corrigieron a mano en la revisión final.

**El eyebrow lleva el signo de la slide.** Coral en una slide cuyo hallazgo es negativo, verde en
una positiva, teal cuando es neutra o estructural (`.eb.neg`, `.eb.pos`). Un deck con todos los
eyebrows en teal le quita al lector la pista de hacia dónde va cada lámina.

### La pregunta de investigación es el título más caro del deck

Va en la portada, se repite en el cierre, y es lo primero que el cliente lee en voz alta. Se
escribe en el español de su mercado y **se lee en voz alta con alguien de ese mercado antes de
cerrarla**. Un caso real: "¿Dónde se rompe la visita?" se rechazó porque "se rompe" no se dice así
en México. Quedó "¿En qué momento de la visita perdemos al cliente?", que además habla el idioma de
quien recibe el deck.

## 2.5 Números ante el cliente

Conteos crudos y participación no son intercambiables. Ante cliente final, C-level, freebie o
muestra se escribe participación sobre la conversación depurada. Ante una agencia o un partner que
ya trabaja el marco, conteos y participación, siempre con el denominador visible. En la slide de
método el volumen total sí se dice, porque ahí se está explicando el alcance. Etiquetas que se
traslapan nunca se suman. El criterio completo está en `CANON.md`, sección 5.3.

## 3. Tono Noisia para press
- Simple sobre sofisticado. Si una slide necesita explicación, falló.
- Una idea por slide. El título dice la idea; el cuerpo la prueba.
- Cero gráficos/decoración que no aporten (regla F2 del KB).
- Frases que un C-level entiende en 5 segundos.

## Checklist antes de exportar
- [ ] Ninguna `{{…}}`, comentario, ni texto de propósito/navegación en las slides.
- [ ] Header derecho = `noisia.ai`. Sin emojis.
- [ ] Anglicismos técnicos intactos (Dashboard, insight, brief…), nada sobre-traducido.
- [ ] Sin muletillas de IA ni significancia inflada; frases de largo variado.
- [ ] Por cada título: tapé el cuerpo y el título solo ya dice algo del negocio.
- [ ] Cada título se contrastó contra la cifra que lo sostiene, ni más grande ni más chica.
- [ ] Ninguna cifra está pegada al nombre de un motivo: son menciones con señal, no motivos.
- [ ] Un solo par de términos del método en todo el deck, con su color por lado.
- [ ] Ninguna cita se eligió por cubeta, y ninguna trae una liga dentro del texto.
- [ ] Ningún título tiene dos puntos a media frase. Es el patrón que más se escapa.
- [ ] Ningún título repite los encabezados de las columnas ni presume del método.
- [ ] Ninguna palabra necesita haber estado en la conversación interna para entenderse.
- [ ] `grep -c '—' index.html` da `0`.
- [ ] Footer izquierdo `noisia · social intelligence architects`, footer derecho `NN / TOTAL`.
- [ ] Una sola convención de header derecho en todo el deck.
- [ ] Los números respetan la regla de audiencia y declaran su denominador.
- [ ] Lo leí como cliente: cada palabra es para él.
