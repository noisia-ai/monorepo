# Charts · el estilo definitivo

> Hasta ahora esto se intuía leyendo decks. Aquí queda escrito. Todo lo de este archivo salió de
> decks entregados y revisados con cliente, no de preferencia: son las formas que sobrevivieron.
> Estructura y secuencia en `LAYOUTS.md`, palabras en `COPY_RULES.md`.

## La regla que ordena todo lo demás

**Un chart de Noisia se dibuja a mano en SVG, sin librerías.** No hay Chart.js, no hay D3, no hay
CDN. El renderer bloquea externos y el PDF tiene que salir igual sin red. Un chart es geometría y
la geometría se escribe.

Y la segunda, de la que se derivan casi todas: **el color sólido dice el dato, el degradado no
dice nada.**

## 1. Sin gradientes donde hay un valor

Ninguna forma que codifique una cifra lleva degradado. Barras, mitades de una barra de
sentimiento, rellenos de progreso, celdas de matriz: color plano.

| Uso | Color |
|---|---|
| Positivo, empuje, la marca | `#0d8a8a` |
| Negativo, fricción, tensión | `#d6492f` |
| Neutro o resto | `--surface-02` |
| Acento de dato destacado | `--teal` / `--coral` |

El engine ya viene plano. Si ves un `linear-gradient` en una barra, es código viejo.

**La única excepción, y es una sola:** el área bajo una curva puede llevar una rampa vertical de
alfa del mismo tono, de arriba transparente a abajo con cuerpo. No es decoración, es lo que deja
leer la curva sobre la retícula sin taparla.

```
0%   → stop-color #e2543c  stop-opacity .02
100% → stop-color #e2543c  stop-opacity .20
```

## 2. Barras

Anchas, esquinas **superiores** redondeadas, base recta, color sólido. La barra crece desde el eje
y la base tiene que verse apoyada, no flotando.

- Ancho: 70% del espacio de su categoría. Una barra flaca con mucho aire se lee como error.
- Radio superior: 8px a escala de canvas.
- Etiqueta del eje X debajo, 12px, `#6d6d6d`, peso 600.

```js
// esquinas superiores redondeadas, base recta
function barPath(x, y, w, h, r = 8) {
  r = Math.min(r, w / 2, h);
  return `M ${x},${y + h} L ${x},${y + r} Q ${x},${y} ${x + r},${y}` +
         ` L ${x + w - r},${y} Q ${x + w},${y} ${x + w},${y + r} L ${x + w},${y + h} Z`;
}
```

## 3. Líneas

**Siempre curvadas. Nunca segmentos rectos.** Una serie en segmentos se ve como un gráfico de
sistema, no como una lectura. La suavización es bezier cúbica con los puntos de control en el
punto medio horizontal entre cada par:

```js
function smoothPath(pts) {
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2;
    d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}
```

- Grosor: 2.6 en series múltiples, 3.2 cuando la curva es el sujeto de la slide.
- `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"`.
- Puntos: halo blanco de radio mayor y núcleo del color de la serie. Sobre retícula, el halo es lo
  que separa el punto de la línea de fondo.
- El radio del punto puede codificar volumen: `r = 7 + sqrt(n) * 0.48`. Si lo usas, dilo en la
  leyenda, porque un punto más grande sin explicación se lee como énfasis y no como tamaño.

## 4. Series por plataforma

Cada línea lleva **el color de su red**, no un color de paleta. El lector encuentra su canal por el
color antes de leer la leyenda.

| Plataforma | Trazo |
|---|---|
| Facebook | `#1877F2` |
| Instagram | `#E4405F` |
| X | `#000000` |
| YouTube | `#FF0000` |
| Reddit | `#FF4500` |
| TikTok | triple trazo, ver abajo |

**TikTok se dibuja como su logo:** la misma curva tres veces, cian `#25F4EE` desplazada
`translate(-2.6,-2.6)`, rojo `#FE2C55` desplazada `translate(2.6,2.6)`, y negra encima sin
desplazar. Es la aberración cromática de su marca y se reconoce al instante.

## 5. Ejes y retícula

- Retícula: líneas de 1px en `#ededed`. La línea del cero va punteada, `stroke-dasharray="6 6"`.
- Etiquetas del eje: 11 a 14px, `#8a8a8a` a `#aaa`, peso 600 o 700.
- La unidad se dice una vez, arriba a la izquierda del eje, en minúsculas y chiquita.

**Si la métrica no es obvia, el eje se explica.** Esta es regla dura y salió de una corrección de
cliente. Un eje de sentimiento neto, de índice o de cualquier cosa compuesta lleva una línea en
`.foot` que diga qué es bueno y qué es malo:

> El eje es sentimiento neto: 0% significa tantos elogios como críticas, y cuanto más baja la
> curva, más se carga hacia la crítica.

## 6. Marcar los extremos

Cuando la lectura de la slide es un punto concreto de la serie, ese punto se marca y los demás no:

- **El peor:** círculo coral relleno, anillo blanco con borde coral de 2.5px, y un `!` blanco
  encima.
- **El mejor:** círculo teal relleno con el mismo anillo.
- **El resto:** color atenuado, `#e88f7c` sobre una curva coral.

La leyenda nombra los tres estados en humano: "sentimiento neto por momento", "punto de quiebre",
"el único tramo que levanta".

## 7. Dónde vive el título de un chart

En una slide donde el chart es el protagonista, el título grande estorba. La composición probada
es: eyebrow arriba a la izquierda, leyenda debajo, la explicación del eje en `.foot`, el chart
ocupando el ancho, y **el insight en una card blanca flotando arriba a la derecha**. El lector ve
la forma antes de leer la conclusión, que es el orden correcto.

Si el chart es una prueba de apoyo y no el sujeto, entonces sí lleva título, y el título dice el
hallazgo como cualquier otro (`COPY_RULES.md`).

## 8. Las cifras no se teclean

Ningún número del chart, ni de la slide, se escribe a mano. Se calcula de la tabla codificada al
construir el deck. Un número tecleado sobrevive al corpus que lo contradice; uno calculado, no.
Ver `CANON.md` §6.
