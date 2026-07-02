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
- **El header derecho siempre es `noisia.ai`** (la marca), nunca una etiqueta de propósito.

Antes de exportar: lee cada slide como si fueras el cliente. Si una palabra no es para él, fuera.

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
- **Gerundios de relleno.** ❌ "destacando, reflejando, mostrando…" → afirma el hecho.
- **Conclusiones genéricas optimistas.** Cierra con un hecho o un siguiente paso concreto, no con "el futuro es prometedor".

**Lo que sí queremos:** frases de largo variado, una opinión/postura clara, lenguaje concreto y específico, y la voz directa de Noisia (sin vender de más). Citas literales sin maquillar (la imperfección es información — regla de `kb/03-process/delivery-format.md`).

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
- [ ] Lo leí como cliente: cada palabra es para él.
