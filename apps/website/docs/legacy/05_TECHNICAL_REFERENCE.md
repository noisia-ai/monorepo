# 05 — Technical Reference

## Stack recomendado

Para el website general de Noisia, usar:

- Next.js App Router + TypeScript si el proyecto va a crecer hacia login, report builder, dashboards y app.
- Vite + React/TS si se quiere una landing pública rápida sin backend inmediato.
- CSS variables como base de tokens.
- Framer Motion solo si se instala y se usa con intención.
- Canvas propio para el fondo fluido.

No asumir librerías. Revisar `package.json` antes de importar.

## Arquitectura sugerida

```txt
src/
  app/ or pages/
  components/
    brand/
    layout/
    marketing/
    product-preview/
    ui/
  styles/
    tokens.css
    base.css
    components.css
  lib/
    fluid-background.ts
    motion.ts
  content/
    homepage.ts
    product-copy.ts
```

## Tokens

Usar `brand/DESIGN.md` como origen conceptual y `code-reference/styles/tokens.css` como referencia CSS concreta.

El nuevo proyecto debería convertir esos tokens a:

- CSS variables.
- Tailwind theme, si se usa Tailwind.
- Theme object, si se usa styled system.

## Assets incluidos

```txt
assets/logos/
  logo_black.svg
  logo_norm.svg
  logo_black@2x.png

assets/background-reference/
  background.png
  Slide 16_9 - *.png
```

Los `Slide 16_9` son referencias visuales de la estética fluida/granular. No tienen que usarse como imágenes finales.

## Código de referencia

```txt
code-reference/utils/fluid-background.ts
```

Implementa canvas background con:

- blobs radiales
- blur
- multiply blend
- grain
- resize guard para iOS
- static mode en touch devices

```txt
code-reference/utils/intersection.ts
```

Implementa scroll reveal y count up. Usar como referencia, no copiar ciegamente.

```txt
code-reference/styles/*.css
```

Referencia real del freebie Cheaf: tokens, base, layout, cards, charts, tabs, footer.

## Performance guardrails

- El fondo debe estar en un canvas fijo, no como filtro sobre un contenedor scrollable.
- En mobile, reducir o desactivar movimiento continuo.
- Respetar `prefers-reduced-motion`.
- No meter muchas sombras con blur grande en listas largas.
- No usar `height: 100vh` para heroes móviles; preferir `min-height: 100dvh` con cuidado o padding controlado.
- No bloquear contenido detrás de animaciones.

## Accesibilidad

- Contraste fuerte para texto.
- Focus visible para links y botones.
- CTAs con nombres concretos.
- Tabs con roles/aria si son semánticamente tabs.
- No depender solo de color para comunicar estados.

## Deployment

El freebie Cheaf está en GitHub Pages/custom domain, pero el website general puede necesitar otro setup.

Para nuevo proyecto:

- Definir dominio objetivo.
- Definir hosting: Vercel recomendado para Next.js.
- Separar website público y app si el scope crece.
- Mantener assets de marca versionados.

