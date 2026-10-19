# Video · el estudio contado en dos minutos

> Receta, no plantilla todavía. Salió de un estudio pagado de cerveza y fútbol: un video vertical de
> 1080 × 1920, de unos 130 segundos, hecho todo en código y sin imágenes generadas. El cliente lo
> describió como "a quick way of consuming the insight". El proyecto completo vive en la carpeta
> del caso; aquí queda lo que se repite.

## Para qué sirve, y para qué no

Es la puerta del estudio para quien no va a abrir 40 slides: el equipo creativo, el comité, alguien
que lo reenvía. No reemplaza al deck ni es un resumen leído en voz alta. La versión que funcionó
para creativos no era la que resumía el estudio: le hacía falta copy, y de ahí salió el *Creative
Spark* por capítulo.

## El contrato con el deck

1. **Las cifras salen del builder del deck.** El builder escribe un `data.json` (por ejemplo con
   `build_deck.py --video-data`) y el video solo lee de ahí: deck y video dicen las mismas cifras,
   y si el corpus cambia, cambian los dos.
2. **Las citas son literales.** Cada extracto lleva su `assert fragmento in texto_verificado` antes
   de entrar al video, igual que en el deck.
3. **El guion se arma con los números de los datos.** La narración interpola `data.json`; nada se
   teclea.
4. **Nada de imágenes generadas.** Todo es tipografía, gráficas y posts reales del corpus.
5. **Etiquetas honestas en pantalla** cuando algo se dramatiza: "verified post, voiced", "real fan
   posts, as a group chat".

## La estructura que funcionó

- **Abre en frío** con la voz de una persona real del corpus.
- **Un capítulo por pregunta o tema**, cada uno con tres tiempos: el insight, la prueba (el dato y
  una voz real) y el *Creative Spark*, una línea de copy que el creativo puede usar.
- **Un clímax con el mejor hallazgo de espacio vacío.** En el caso, un contador baja a cero, la música
  se corta y aparece un chat de grupo con posts reales y un hueco: "la marca… escribiendo". El
  usuario lo pidió así porque ese insight había quedado "ahí nomás".
- **Cierra con la apuesta.**
- Una barra de progreso tipo stories.

La duración la marca el contenido: el usuario pidió no cortar uno de 141 segundos porque tenía
sentido. Tampoco todas las escenas pesan igual: las meramente descriptivas se acortan.

## Audio

- **Las voces del sistema no sirven para entregar**: "se escuchan súper feas". Con ElevenLabs por
  API: un narrador en el idioma del cliente, voces nativas del mercado para las citas con el tono de
  cada una, efectos generados y música con ducking bajo la voz. Hace falta un opening, un cierre y
  sonidos de movimiento: "darle más vida".
- **Subtítulos palabra por palabra** desde los timestamps por carácter de la API (`with-timestamps`):
  la sincronía sale exacta sin editar a mano.
- **Caché por hash del spec** (texto, voz, modelo): volver a correr solo regenera lo que cambió.
- **La API key es del usuario y cuesta dinero.** Vive en el `.env` del caso, nunca en el repo ni en el
  chat, y se pide permiso antes de generar. Sin key, las voces del sistema sirven de borrador.

## Render

Remotion, con los tokens del kit (Google Sans local, los íconos de `assets/`), Chrome headless y
h264 con CRF 22. El comando exacto va en el README del proyecto del caso.

Para una animación corta dentro de un PPTX comercial, la receta es otra: GIF desde una secuencia de
PNG, en `commercial/COMMERCIAL.md` §9.

## Lo que falta para que sea plantilla

Una carpeta `video/` con `Root.tsx` y `Study.tsx` parametrizados por `scenes.json`, un `audio.py`
genérico (voces por rol, caché, timestamps) y los componentes de escena: cold open, capítulo,
clímax, cierre y barra de progreso. Está en la deuda de `CANON.md` §9.
