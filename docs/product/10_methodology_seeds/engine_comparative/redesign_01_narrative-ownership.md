# Rediseño · Pantalla Signal — Narrative Ownership

> **Propósito:** describir cómo debe verse y qué debe comunicar la pantalla de Narrative Ownership en /signal. **No es código.** Es el contrato visual + de contenido para que Codex reconstruya el render. Incluye datos sintéticos realistas (telecom MX) para que se entienda el "qué pitos debe decir".

---

## 0. Precondición de datos (sin esto, ninguna UI salva la pantalla)

La pantalla actual muestra **codings crudos**, no narrativas. Antes del UI, el `score`/`synthesize` debe:
- **Colapsar** codings en **narrativas únicas** (dedup por `dimensions.narrative`). Hoy "atención que resuelve" sale 4 veces; debe ser **1 fila**.
- **Atribuir a entidad** (`entity_id` de `corpus_entities`) cada coding → calcular **share por entidad dentro de la narrativa**. Hoy no hay ninguna marca: es el agujero central.
- **Clasificar ownership** (`owned/shared/insufficient`) y **verdicto estratégico** (asset/riesgo/competencia/whitespace) respecto a la **marca focal** del estudio.

El rediseño asume esa data ya agregada. Donde no exista (p.ej. 1 sola evidencia), la UI lo dice con calma, no con “Directional” 12 veces.

---

## 1. El trabajo de la pantalla (una sola frase)

> **“¿Qué narrativas dominan la categoría, quién las posee, y cuáles son activo, riesgo o espacio libre para mi marca?”**

Todo lo que no sirva a esa frase, se va. La pantalla es **un argumento**, no un volcado de findings.

---

## 2. Datos sintéticos (lo que deberíamos ver — telecom MX, marca focal = AT&T)

Leyenda de entidades (color fijo, global en toda la pantalla):
`Telcel = rojo` · `AT&T = azul (marca focal)` · `Movistar = verde` · `Bait = morado` · `Otros/categoría = gris`

| Narrativa (emergente) | Volumen | Split de voz (share) | Dueño | Valencia | Verdicto p/ AT&T |
|---|---|---|---|---|---|
| Cobertura que sí jala | 4,820 | Telcel 58 · AT&T 19 · Movistar 14 · otros 9 | **Telcel** | + positiva | ⚔️ Disputar (fortaleza del rival) |
| Cargos que no reconozco | 3,140 | Telcel 47 · Movistar 26 · AT&T 18 · otros 9 | **Telcel** | – negativa | 🧨 Mina del rival / riesgo de categoría |
| Atención que sí resuelve | 2,260 | AT&T 41 · Telcel 24 · Movistar 21 · otros 14 | **AT&T** | + positiva | 🛡️ Proteger (activo propio) |
| Internet que se cae | 1,980 | Movistar 39 · Telcel 31 · AT&T 17 · otros 13 | **Movistar** | – negativa | 👀 Vigilar |
| Precio sin letra chica | 1,410 | Bait 33 · AT&T 22 · Telcel 21 · Movistar 24 | huérfana | + positiva | 🚀 Capturar (whitespace) |

Esa tabla **es** la pantalla. Los charts son vistas de ella; las conclusiones son sus verdictos. Nunca se repite.

---

## 3. Jerarquía y layout (de arriba a abajo)

```
┌───────────────────────────────────────────────────────────────────────┐
│ Engine · Narrative Ownership                         [corpus 13.6K]    │  ← header slim, 1 vez
│ Quién posee cada narrativa de la categoría.          [4 entidades]     │
│                                                      [● Direccional]   │  ← 1 badge global
├───────────────────────────────────────────────────────────────────────┤
│  HERO INSIGHT (texto grande, 2 líneas)                                 │
│  “Telcel posee la narrativa de cobertura (58%). AT&T sólo posee        │
│   ‘atención que resuelve’ (41%) y comparte una narrativa negativa de   │
│   facturación que es de toda la categoría.”                            │
│   ┌─ Narrativas: 5 ┐ ┌─ Más disputada: Cobertura ┐ ┌─ Riesgo: Cargos ┐ │  ← 3 tiles = conclusión
├───────────────────────────────────────────────────────────────────────┤
│  MAPA DE OWNERSHIP  (chart primario — 2×2 REAL)        [leyenda ●●●●]  │
│        valencia +                                                      │
│   Activos propios │ Fortalezas del rival                               │
│      (AT&T ◯)     │   (Telcel ●, grande)                               │
│   ───────────────┼─────────────────────  ¿de mi marca? → de la comp.  │
│   Riesgos propios │ Minas del rival                                    │
│                   │ (Telcel ● cargos)                                  │
│        valencia –                                                      │
├───────────────────────────────────────────────────────────────────────┤
│  LEDGER DE NARRATIVAS  (la espina — 1 fila por narrativa)              │
│  Cobertura que sí jala   [██Telcel 58│AT&T19│Mov14│9█]  ⚔️  +  4,820   │
│  Cargos que no reconozco [██Telcel 47│Mov26│AT&T18│9█]  🧨  –  3,140   │
│  Atención que resuelve   [█AT&T 41│Tel24│Mov21│14██]    🛡️  +  2,260   │
│  …  (cada fila expandible → drawer de evidencia)                       │
├───────────────────────────────────────────────────────────────────────┤
│  PLAYBOOK  (4 cards de acción derivadas de los verdictos)             │
│  🛡️ PROTEGER · ⚔️ DISPUTAR · 🧨 LIMPIAR/EVITAR · 🚀 CAPTURAR          │
├───────────────────────────────────────────────────────────────────────┤
│  CONFIANZA & LÍMITES (calmado, 1 vez)                                  │
│  Direccional · 5 narrativas · 1 evidencia c/u · 1 fuente.             │
│  Para subir a media/alta: ≥150 menciones/entidad y ≥2 fuentes.        │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 4. Sección por sección (descriptivo arduo)

### 4.1 Header (slim, 1 sola vez)
- Izquierda: kicker pequeño `ENGINE · NARRATIVE OWNERSHIP`, debajo el título **una vez**, y una línea de definición del método.
- Derecha: 3 meta-pills calmadas: tamaño de corpus, # entidades, **un** badge de confianza global (`● Direccional` / `● Media` / `● Alta`).
- **Eliminar** los otros dos títulos repetidos y el "Missing: confianza media/alta" suelto (se reubica en la sección de confianza, redactado).

### 4.2 Hero insight (lo nuevo, lo más importante)
- Un bloque ancho con **la frase de cabecera** en display (28–32px), seguida de un "so-what" en 1 línea.
- Tres **tiles de conclusión** (no de conteo): *Narrativas detectadas*, *Narrativa más disputada*, *Riesgo principal*. Cada tile dice una verdad estratégica, no "5 distinct values".
- Es la primera cosa que el ojo encuentra. Hoy la pantalla empieza con chrome; debe empezar con **el insight**.

### 4.3 Mapa de Ownership — rediseño del “Matrix 2x2” (chart primario, la firma)
El actual no es una matriz: son chips. El nuevo es un **plano 2×2 real**:
- **Eje X:** *¿quién la posee?* — izquierda “de mi marca”, derecha “de la competencia”. (Posición = share de la marca focal vs share del rival dominante.)
- **Eje Y:** *valencia* — arriba positiva, abajo negativa.
- Cada narrativa = **burbuja**; tamaño = volumen; **color = entidad dueña** (paleta de entidad).
- Cuadrantes etiquetados con su significado estratégico:
  - ↖ **Activos propios** (positiva + de mi marca) → proteger.
  - ↗ **Fortalezas del rival** (positiva + de la competencia) → disputar con permiso.
  - ↙ **Riesgos propios** (negativa + de mi marca) → limpiar.
  - ↘ **Minas del rival** (negativa + de la competencia) → no copiar, observar.
- Interacción: hover = cita protagonista; click = drawer de evidencia. Leyenda de entidades pineada arriba-derecha, filtra el plano.
- **Este chart solo ya responde la pregunta del método.** Es la pieza ancla.

### 4.4 Ledger de narrativas — fusiona “stacked share” + “bar ranking” + las cards de abajo
Hoy hay tres listados del mismo dato. Se colapsan en **una sola lista**, una fila por narrativa:
- **Nombre** de la narrativa (humano, sentence case — no “ATENCION QUE RESUELVE” gritado).
- **Barra de share 100%** segmentada por entidad (colores de entidad) **con leyenda** — esto **es** el "stacked share", pero por narrativa y legible. Cada segmento etiquetado `Marca %`.
- **Chip de dueño** (entidad + %).
- **Pill de valencia** (paleta semántica distinta: + verde-teal, – coral, neutra slate). **No** reutilizar el color de entidad para valencia (hoy se confunden).
- **Chip de verdicto** (🛡️ Activo / ⚔️ Disputar / 🧨 Riesgo / 🚀 Whitespace).
- **Volumen** (tabular, alineado a la derecha) y **mini-badge de confianza** por fila.
- **Expandible** → drawer derecho con 2–3 citas (texto, plataforma, fecha, link).
- Ordenable por share / volumen / confianza / verdicto. Toggle “sólo riesgos” / “sólo whitespace”.
- **Elimina** las dos filas de cards duplicadas y el bar_ranking suelto.

### 4.5 Playbook (conclusiones como acciones, no como adornos)
Cuatro cards máximo, derivadas de los verdictos del ledger, redactadas como frases reales:
- 🛡️ **Proteger** “Atención que resuelve”: tu único activo narrativo. Citar, no diluir.
- ⚔️ **Disputar** “Cobertura”: Telcel la posee (58%) pero tienes 19% y permiso parcial — reinterpretar, no copiar el claim.
- 🧨 **Limpiar/Evitar** “Cargos que no reconozco”: negativa de categoría que también te salpica — transparencia proactiva.
- 🚀 **Capturar** “Precio sin letra chica”: huérfana, nadie la posee — espacio libre.
Cada card: narrativa + 1 cita + movimiento recomendado. (Mapea a los `conclusions.kind` del contrato: protect/dispute/watch/validate.)

### 4.6 Confianza & límites (honesto y calmado, 1 vez)
- Una franja, no 12 estampas. Texto: “**Direccional** — 5 narrativas, 1 evidencia cada una, 1 fuente. Para subir a media/alta: ≥150 menciones por entidad y ≥2 fuentes.”
- Mini-breakdown de los 5 factores (`volume / source_diversity / consistency / recency / citation_quality`) como **5 barritas 0–1**, no una caja gris vacía. Así el badge de confianza *significa* algo.

---

## 5. Lenguaje visual (tokens y reglas)

- **Dos paletas semánticas separadas, no mezclar:**
  - *Entidad* (identidad): Telcel rojo, AT&T azul, Movistar verde, Bait morado, otros gris. Se usa en barras de share, burbujas, leyenda.
  - *Valencia* (juicio): positiva teal, negativa coral, neutra slate. Se usa en pills de valencia y bordes de cuadrante.
  - El problema actual: todo es teal → todo se ve igual. Separar resuelve el 50% del “se ve horrible”.
- **Jerarquía tipográfica clara:** 1 display (hero), 1 título de sección, 1 body, 1 micro/caps para kickers. Hoy todo pesa igual.
- **Menos cajas.** Quitar el “card blanca con borde sobre gris” repetido. Usar aire y separadores sutiles; bordes sólo donde agrupan de verdad.
- **Números tabulares, alineados a la derecha.** Share siempre con %; volumen con separador de miles.
- **Estados vacíos honestos:** si una narrativa tiene 1 sola evidencia, tag “muestra mínima” en vez de pintar un chart confiado.
- **Densidad:** la pantalla cabe en ~1.5 scrolls. Hoy son 3 por la triple repetición.

---

## 6. Qué se elimina vs qué se conserva

| Elemento actual | Acción |
|---|---|
| Título “Narrative ownership board” ×3 | **1 sola vez** |
| Fila de 5 finding-cards (arriba) | **Eliminar** (se funde en ledger) |
| Fila de 5 finding-cards (abajo) | **Eliminar** (duplicado) |
| “Matrix 2x2” de chips | **Rediseñar** a plano 2×2 real con ejes |
| “Stacked share” sin leyenda | **Rediseñar** a barras por narrativa con entidades |
| “Bar ranking” de duplicados | **Fundir** en el ledger |
| Confidence badge gris vacío | **Rediseñar** a 5 barritas de factores |
| “Directional” por card | **1 badge global** + mini-badge por fila |
| Sin entidades | **Entidades en todo** (color + leyenda + share) |

---

## 7. Interacciones (drill-to-evidence, lo que hace “chingón” un dashboard)

- **Leyenda de entidades global** filtra el mapa y el ledger en vivo.
- **Click en narrativa / burbuja** → drawer derecho con citas (texto, plataforma, fecha, link).
- **Ordenar / filtrar** el ledger (share, volumen, confianza; sólo riesgos / sólo whitespace).
- **Hover** en cualquier dato → cita protagonista en tooltip.
- Nada de número sin evidencia detrás (cada barra/burbuja lleva `evidence_ids`).

---

## 8. Resumen para Codex

La pantalla pasa de **“volcado de codings sin marca, repetido 3 veces”** a **“un argumento: quién posee qué narrativa y qué hago al respecto”**. Las 3 palancas que la arreglan, en orden:
1. **Agregar y atribuir** (precondición §0): narrativa única + entidad + share. Sin marcas no hay método.
2. **Un mapa 2×2 real** (§4.3) como ancla + **un ledger** (§4.4) que funde los 3 listados repetidos.
3. **Dos paletas separadas** (entidad vs valencia) + jerarquía + verdicto estratégico por narrativa (§5).

Resultado: el estratega entiende en 5 segundos que *Telcel posee cobertura, AT&T sólo atención, y hay un whitespace de precio* — sin leer una tabla cruda tres veces.
</content>
</invoke>
