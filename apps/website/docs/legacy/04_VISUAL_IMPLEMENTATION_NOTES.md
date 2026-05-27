# 04 — Visual Implementation Notes

## Source of truth

El archivo principal es `brand/DESIGN.md`.

Este documento traduce ese sistema a decisiones prácticas para construir el website.

## Qué preservar del freebie Cheaf

- Google Sans / Product Sans en toda la interfaz.
- Canvas blanco.
- Fondo fluido granular, muy suave.
- Glass surfaces con bordes blancos y sombras difusas.
- Tabs/CTAs con active state negro.
- Métricas grandes, limpias y sin letter spacing negativo.
- Quotes como evidencia.
- Scroll reveal sutil y temprano.
- Footer como pieza de diseño, no lista de links.

## Qué no copiar literalmente

- El ritmo mobile-first de reporte privado.
- La ausencia de navegación.
- La estructura lineal de 8 secciones de Cheaf.
- El tono 1-a-1 para Kim.
- Los charts específicos de Cheaf.

## Fondo fluido

Usar el patrón de `code-reference/utils/fluid-background.ts`.

Reglas:

- En desktop puede moverse muy lento.
- En mobile/touch debe ser estático o casi estático.
- No debe reaccionar a scroll, touch o pointer.
- Debe vivir en canvas fixed `pointer-events: none`.
- Debe tener blur y grano, no formas duras.
- Debe sentirse como atmósfera, no como protagonista.

## Glass cards

La fórmula base:

```css
background: rgba(255, 255, 255, 0.56);
border: 1px solid rgba(255, 255, 255, 0.66);
border-radius: 20px;
backdrop-filter: blur(20px) saturate(125%);
box-shadow:
  0 22px 64px rgba(43, 43, 43, 0.08),
  inset 0 1px 0 rgba(255, 255, 255, 0.86);
```

Usarlas para:

- Report previews
- Chat panels
- Source cards
- Product mockups
- Footer

Evitar usarlas para todo. En workspace denso, usar también superficies sólidas, líneas y paneles compactos.

## Motion

Motion debe sentirse premium y útil.

Usar:

- Scroll reveal con `opacity` + `transform`.
- Stagger corto.
- Microinteracciones de active/hover.
- Canvas atmosférico lento.

Evitar:

- Animaciones que bloquean contenido.
- Grandes espacios en blanco esperando reveal.
- Animar width/height/top/left.
- Re-render de backgrounds en mobile.

## Product previews

El website debería mostrar UI inventada pero creíble:

- Report builder stepper.
- Credit wallet.
- Narrative dashboard.
- Source drawer.
- Chat with data.
- Export bar.

Estos previews deben usar datos realistas, no lorem ipsum ni números redondos perfectos.

## Copy visual

El diseño debe ayudar a que el copy sea concreto:

- Headline con tesis.
- Subcopy con contexto.
- Módulo visual con evidencia.
- CTA o next step.

No diseñar secciones donde el texto solo describe features sin demostrarlas.

