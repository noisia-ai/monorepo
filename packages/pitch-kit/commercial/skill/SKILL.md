---
name: noisia-comercial
description: Arma presentaciones y propuestas comerciales de Noisia con la marca correcta, listas para editar en Google Slides (PPTX) o en PDF. Úsala cuando alguien del equipo pida un deck de ventas, un opener, un overview para un cliente, la oferta con precios, una propuesta, un one-pager o un piloto, en español o en inglés. No es para reportes ni estudios entregables.
---

# Noisia · presentaciones comerciales

Armas decks de venta de Noisia que salen con la marca bien puesta y el copy aprobado del equipo
comercial. El resultado es un PPTX nativo (cada texto y cada card se editan en Google Slides) y,
si lo piden, su PDF.

Todo lo que necesitas viene en esta carpeta. No inventes diseño ni copy: el builder dibuja las
slides y el copy canónico ya está escrito. Tú haces tres cosas: entrevistas, investigas la marca y
escribes solo las slides que son del cliente.

## Archivos

- `reference/COMMERCIAL.md` · las reglas. **Léelo completo antes de la primera slide.**
- `reference/INDUSTRIES.md` · preguntas que Noisia puede responder, por industria.
- `recipes.json` · los seis entregables y sus slides.
- `copy/es.json`, `copy/en.json` · el copy aprobado. Se usa tal cual.
- `examples/brief-*.json` · briefs completos de cada entregable, con una marca ficticia.
- `scripts/compose.py` · brief a PPTX (y PDF). `scripts/preview.py` · dibuja las slides y marca
  texto que no cabe.

## Flujo

### 1. Prepara el entorno (una vez por conversación)

```bash
mkdir -p ~/.fonts && cp fonts/*.ttf ~/.fonts/ 2>/dev/null; fc-cache -f >/dev/null 2>&1
python3 -c "import pptx, PIL" || pip install python-pptx pillow
```

### 2. Entrevista

Haz las preguntas de `reference/COMMERCIAL.md` §3, **una a la vez**, cortas y con opciones. Las
cuatro primeras siempre: qué entregable, qué idioma, para presentar o para mandar, PDF o editable.
No construyas hasta tenerlas. Si piden "una presentación de Noisia" sin más, ofrece el opener
informativo y explica en una línea cuándo se usa cada uno.

### 3. Investiga la marca (opener, outbound, overview)

Busca en la web hechos públicos recientes de la marca: aperturas, lanzamientos, expansión,
campañas, cambios de precio. Úsalos para aterrizar las preguntas de `reference/INDUSTRIES.md` a
esa marca. Cada hecho que uses va con su fuente y fecha en `notes` de esa slide.

**Nunca escribas insights.** Nada de lo que la gente dice de la marca, ni cifras de conversación,
ni hallazgos. Solo preguntas que Noisia podría responder. Es la regla más importante de esta
skill (`COMMERCIAL.md` §4.1).

### 4. Escribe el brief

Copia el ejemplo del entregable desde `examples/` y cambia solo lo que es del cliente: `vars`, las
slides con `_client` de la receta, y `include`/`exclude` si hace falta. No reescribas el copy
canónico. Precios: siempre `XXX`, salvo que la persona te dé el monto en este chat. Si subió el
logo del cliente, pon su ruta en `client_logo`.

### 5. Construye y revisa

```bash
python3 scripts/compose.py brief.json Noisia_<Cliente>_<Entregable>_<ES|EN>_v1.pptx [--pdf]
python3 scripts/preview.py Noisia_<Cliente>_<Entregable>_<ES|EN>_v1.pptx revision --sheet
```

- Si `compose.py` se niega, corrige el brief en lo que te dice (em dash, frase prohibida,
  placeholder, slide de cliente faltante) y vuelve a correrlo.
- Si `preview.py` marca un desborde, acorta ese texto. No entregues con desbordes.
- **Mira las hojas de contacto** (`revision/hoja-*.png`) antes de entregar. Pasa la lista de
  `COMMERCIAL.md` §6 slide por slide.

### 6. Entrega

Entrega el PPTX (y el PDF si lo pidieron) y di en el chat, corto:

1. Qué `XXX` quedan por llenar, en qué slides.
2. Si el logo del cliente quedó como recuadro: clic derecho, Reemplazar imagen.
3. Para editar: subir el PPTX a Google Drive y abrirlo con Google Slides.
4. Si el PDF no salió o la fuente se ve rara en él: en Google Slides, Archivo, Descargar, PDF. Ese
   es el que se manda, después de llenar los precios.

Si la persona pide cambios, edita el brief y vuelve a construir; sube la versión (`_v2`).
