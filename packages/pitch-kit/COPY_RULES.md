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
- **Títulos con colon-reveal.** Nadie habla así. ❌ "The screen, mapped: every pull casts a shadow" / "X: subtítulo dramático" → ✅ frase natural declarativa: "Every pull the screen creates has a matching barrier".
- **Frase repetida en la misma slide.** El eyebrow, el header derecho y el título **no** dicen lo mismo. ❌ "how a decision reads" en los tres → cada uno distinto y natural.

**Lo que sí queremos:** frases de largo variado, una opinión/postura clara, lenguaje concreto y específico, y la voz directa de Noisia (sin vender de más). Citas literales sin maquillar (la imperfección es información — regla de `kb/03-process/delivery-format.md`).

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
- [ ] `grep -c '—' index.html` da `0`.
- [ ] Footer izquierdo `noisia · social intelligence architects`, footer derecho `NN / TOTAL`.
- [ ] Una sola convención de header derecho en todo el deck.
- [ ] Los números respetan la regla de audiencia y declaran su denominador.
- [ ] Lo leí como cliente: cada palabra es para él.
