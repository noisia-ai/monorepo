# Credenciales

Pocas slides sobre Noisia y casi todo casos de uso animados. Las reglas, los dos modos y la secuencia
están en `../COMMERCIAL.md` §2.1; aquí solo va cómo se construye.

```bash
python3 build.py examples/portfolio.en.json --out ~/Downloads/<Lead>/credenciales          # HTML para presentar
python3 build.py examples/funnel.es.json   --out ~/Downloads/<Lead>/credenciales --pptx --pdf   # + PPTX editable y PDF
```

Se presenta sirviendo la carpeta (`python3 -m http.server` dentro de ella) y abriendo `index.html`.
El PDF sale imprimiendo desde Chrome: `beforeprint` dibuja todas las animaciones terminadas.

| Archivo | Qué hace |
|---|---|
| `build.py` | El JSON de contenido a `index.html`, con `deck-stage.js` y los assets del kit copiados al lado. Falla si hay una raya larga |
| `base.css`, `engine.js`, `lifecycle.js` | Estilos, íconos del sprite del kit, helpers de animación y el ciclo de vida (`<svg data-anim>` → `LIB`) |
| `anims/` | Una animación por archivo, registrada en `LIB` por nombre. La descripción de cada una está en su encabezado |
| `capture_gifs.py` | Cada animación a GIF con paleta fija y blanco exacto, que abre en el diagrama terminado |
| `build_pptx.py` | El mismo JSON a PPTX nativo sobre la rejilla del HTML. La comparación usa la slide nativa del kit |
| `examples/` | Las dos plantillas: `portfolio.en.json` (multimercado) y `funnel.es.json` (una marca, un mercado) |

**Un deck nuevo** copia la plantilla del modo que toca, cambia el copy, las preguntas y las
`labels` de cada animación, y escribe en `notes` el contexto público del prospecto con su fuente.
Para una animación nueva: un archivo en `anims/` con `LIB['nombre']={dur, setup(svg), render(S,t)}`,
donde `render` depende solo de `t`.

**Tipos de slide:** `cover`, `pillars`, `ways`, `compare` (con `"copy": "where_we_stand"` toma el copy
del kit), `case` (con `band` lleva el cierre de tres pasos), `menu`, `coverage` y `website` (una
animación de noisia.ai por nombre, `"anim": "understand"`; la lista sale con
`node ../../../motion/builders/website-assets.mjs --list`). Los archivos de cada animación del sitio
se renderizan una vez en `<deck>/web/` y se reusan.

Requiere Chrome y node con el repo instalado, y para `--pptx` también numpy, Pillow, websocket-client,
python-pptx y gifsicle.
No va en la skill `noisia-comercial` de claude.ai: necesita un navegador para capturar las animaciones.
