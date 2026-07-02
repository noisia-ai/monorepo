# LEARNINGS — reglas de campo para las press de Noisia

Aprendizajes de armar decks reales con el pitch-kit (feedback directo del equipo comercial).
Complementan `COPY_RULES.md` y `AGENTS.md`. **Léelo antes de armar un deck.**

## Copy y posicionamiento
- **Nunca "jugadas"** — no es natural en México. Usa **estrategias / decisiones / movimientos**.
- **Nunca nombres herramientas** en slides de cliente (SentiOne, scrapers, vendors). Al cliente no le interesa el stack.
- **No somos "social listening".** El foco es **Voice of the Consumer / la voz del público** (o del electorado). El monitoreo de redes es el medio, no el pitch.
- **Slides de proceso = cómo trabajamos CON el cliente**, no el método interno. Secuencia probada para política: **Paso 0 Workshop → Diagnóstico → Presentación → Reporteo continuo → Día de la elección (D-Day, acompañamiento en vivo)**.
- **Títulos en español claro** — nada que un mexicano no entienda o que no sea de la industria. Evita "lectura" como sustantivo → di **reporte / diagnóstico**.

## Terminología política (MX)
| ❌ | ✅ |
|---|---|
| rivales | **contrincantes** |
| prueba de mensajes | **sugerencias de mensaje** (tono de recomendación; nunca "cambiamos la opinión pública" — protección legal, solo sugerimos) |
| índice de apoyo digital | **índice de intención de voto** |
| escucha 24/7 | **escucha en vivo** |
| setup | **primer mes / arranque** (el cliente no entiende "setup") |
| el estratega "traduce" | el estratega **interpreta** |

En la slide de equipo: **datos primero, estratega al final** (Analista de datos → Account/PM → Estratega político-digital).

## Pricing político (modelo Noisia)
- Una sola oferta clara. **No** des "modalidades" ni 3 planes alternativos sin CTA.
- Estructura: **Primer mes / arranque** (incluye workshop, dashboard, definición de temas/KPIs, diagnóstico inicial) **+ mensualidad FIJA** el resto de la campaña.
- La **frecuencia de reporte sube por calendario**, pero el fee mensual **no cambia**: mensual (hasta 6 meses antes) → quincenal (3 meses) → semanal (2 meses) → **diario (último mes)**. Muéstralo como rampa.
- **Mensualidad por adelantado** (mitiga el riesgo real: si pierden, no pagan la última).
- **Incluye IVA (16%)** explícito. Referencias reales de anclaje: Manzanillo ~$30k/mes; caso 12 meses ≈ primer mes $100k + $80k/mes fijo.
- ⚠️ Poner montos **rompe la regla "sin cifras" del kit a propósito** — válido solo en decks locales de `examples/_local/` cuando el cliente pide presupuesto. No subas cifras de cliente al repo.

## Cobertura y fuentes
- Lista autoritativa de fuentes VoC = `apps/website/src/components/marketing/SourcesConstellation.tsx` (18 fuentes + stats "150+ tipos de fuente", "12 familias de datos conectables").
- La slide de cobertura puede ser **grid de fuentes con iconos** o el **mapa mental** (data sources → noisia → use cases). Ambos válidos; el mapa va transparente sobre blanco.

## Iconografía y visual
- **Iconos en todo.** Vendoriza **Feather** (`npm i feather-icons`; monocromo, recolorea `stroke` a `--signal-dark` #008a8a) + **iconos de marca** (`npm i simple-icons`; inyecta `fill` con el hex de marca). Guarda SVG ya coloreados en `assets/icons/` y úsalos con `<img>`.
- **Badges de archivo**: rounded rects con texto — PDF (#e4462b), XLSX (#1d6f42).
- **Ilustraciones Noisia**: siluetas con aberración cromática cian/rojo. Usa **PNG con fondo transparente** (evita bordes); si el PNG trae fondo blanco, monta con `mix-blend-mode: multiply`.
- **Bug flexbox recurrente**: una imagen `flex:1` empuja caption/footer fuera del canvas → añade **`min-height:0`** al contenedor flex.

## Caveats honestos (siempre)
- **Geo**: "La precisión de la geolocalización depende de la fuente de datos". El social listening mide **conversación digital, no presencia física** ni verdad de campo — verifica contra la agenda real antes de afirmar ausencia/silencio.
- Reacciones ≠ sentimiento: "haha" (burla) puede dominar aunque el modelo marque neutral. Revísalo.
