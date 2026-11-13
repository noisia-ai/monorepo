# Guía de notificaciones · los correos del Noisia Data API

> Los correos automáticos que un feed continuo de datos le manda al cliente sobre sus entregas. Es
> la cara visible de un conector (`CONNECTORS.md`) y se escribe con la misma voz que el mail técnico
> de una entrega puntual (`DATA_DELIVERY.md` §9). **Solo cubre el Data API:** otros correos de Noisia
> (por ejemplo la invitación de Studio) tienen su propio estilo y no se rigen por esta guía.
>
> La implementación de referencia está en el repo del túnel, en un solo archivo (`tunnel/src/emails.ts`):
> tokens, `shell`, componentes y las cuatro plantillas, con sus tests. Esta guía es el contrato; el
> código lo cumple. Un túnel nuevo copia ese archivo y cambia el copy, nunca el estilo.

## 1. Los cuatro correos

| Correo | Cuándo | Qué dice | Píldora |
|---|---|---|---|
| **Welcome** | Una vez, al crear el proyecto | El proyecto y su id, la query, la cobertura, cómo y dónde se entrega, el formato, la carga histórica y las notificaciones activas, cada una con su ícono | `Live` |
| **Delivery status** | Dos veces al día, a las 07:00 y 19:00 de la zona del cliente | Todas las corridas desde el correo anterior: qué llegó, a qué carpetas y si algo falló | `Delivery complete` · `Partial delivery` · `Delivery failed` |
| **Metrics update** | Cada 12 horas | Las métricas (vistas, likes, comentarios, compartidos) refrescadas para lo publicado en los últimos N días, en un archivo aparte | `Metrics updated` · `With issues` · `Refresh failed` |
| **Incident notice** | Cuando algo falla en corridas consecutivas, y otro con `Resolved` cuando vuelve a la normalidad | Qué falló, que no se pierde nada y que se va a confirmar el regreso | `Issue` · `Resolved` |

El delivery status y el metrics update **resumen**: no hay un correo por corrida. El incident notice
es el único que interrumpe, y solo cuando un fallo se repite.

## 2. El sistema visual

**Tokens**, los de `engine/noisia-tokens.css`:

| Uso | Color |
|---|---|
| Texto principal (ink) | `#0a0a0a` |
| Texto de cuerpo | `#2b2b2b` |
| Secundario (muted) | `#6d6d6d` |
| Líneas | `#e6e6e6` |
| Fondo de página | `#f4f4f4` |
| Señal | `#00eeee` (en código) y `#008a8a` (ligas) |
| Positivo | `#008f66` sobre `#eaf8f2` |
| Ámbar | `#c98a12` sobre `#fbf1dc` |
| Tensión | `#ee0b00` sobre `#fff0ef` |

Fuente: `'Google Sans','Helvetica Neue',Helvetica,Arial,sans-serif`. Mono:
`'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace`.

**El shell:**
- Maquetado con tablas e inline styles, para que Gmail y Outlook lo pinten igual.
- Una tarjeta blanca de 600 px con borde de 1 px `#e6e6e6` y radio de 14 px, sobre el fondo `#f4f4f4`.
- **Forzado a modo claro** (`color-scheme: light only` en meta y en CSS): en modo oscuro los clientes
  de correo invertían los colores de la píldora y del bloque de código.
- Un **preheader oculto** con la primera frase del lead, que es lo que se lee en la bandeja.

**La primera línea de lectura:** a la izquierda, el logo de Noisia (99 × 30) y `<API/>` en mono de
12 px; a la derecha, **la píldora de estado**, redondeada, con un punto ● y el color de su estado:
verde si todo llegó, ámbar si llegó con problemas, rojo si falló. El estado vive ahí, arriba a la
derecha, y no en una etiqueta tipo "Data API".

**Componentes:**

| Componente | Forma |
|---|---|
| `h1` | 24/32, bold, ink |
| `p` | 15/23, texto de cuerpo |
| `label` | 11 px, mayúsculas, tracking `.1em`, muted |
| `tiles` | Las cifras clave en recuadros, dos por fila: borde de 1 px, radio 10, etiqueta de 11 px en mayúsculas y valor de 20 px bold |
| `facts` | Lista clave/valor con un separador de 1 px por fila; clave en muted de 13 px, valor en ink de 14 px |
| `notif` | Ícono de 48 px, título bold de 15 px y descripción de 14 px |
| `codeBlock` "For nerds" | Bloque oscuro (ink, radio 10) con el log de la corrida escrito como una query SQL: palabras clave en cyan, comentarios en gris, ✓ verde y ✗ rojo |
| Pie | "Noisia Data API · automated notification · noisia.ai" y "Questions or changes: reply to this email." |

**La estructura de cada correo es fija:** `h1` y lead, luego `tiles`, luego `facts`, luego "For
nerds". El welcome cambia los tiles por el hero y la lista de notificaciones.

**Asunto:** `Proyecto · Estado · cifra clave · hora`. Por ejemplo,
`Proyecto de ejemplo · Delivery complete · 1,240 new results · 12 Nov 19:00 CDMX`.

**Siempre hay versión en texto plano**, además del HTML, con el mismo contenido.

**Imágenes:**
- Van inline por CID, nunca por URL: muchos clientes bloquean las imágenes remotas.
- Se exportan a 2x y se muestran a la mitad: los íconos de 96 × 96 a 48 px, y el hero del welcome de
  1056 × 420 a 528.
- Los assets nuevos (GIFs, íconos) salen del chat de Website, con el mismo lenguaje visual del sitio.

## 3. Las reglas

1. **Nunca barras de color a la izquierda** en tarjetas ni listas. Para distinguir algo van íconos.
   Una barra lateral de color se lee como plantilla genérica.
2. **El estado va en la píldora del header**, a la derecha, y en ningún otro lado como etiqueta.
3. **Nunca se nombra al proveedor de datos.** Se dice "the data source" o "source partitions". Todo
   texto que llega al cliente, incluidos los mensajes de error que vienen del proveedor, pasa por una
   función `scrub()` que borra su nombre y sus ids. Es la misma regla que en todo el kit.
4. **El estado describe lo que recibió el cliente, no lo accidentado del proceso.** Una corrida que
   falló y se recuperó en la siguiente (un upload reintentado, un límite interno) deja el periodo
   como completo. "Partial" solo si algo sigue pendiente para el cliente.
5. **Todo error visible se escribe en lenguaje humano.** El texto técnico crudo (una excepción, un
   código, una secuencia de escape) solo puede aparecer dentro de "For nerds". En el lead va qué pasó,
   qué no se perdió y cuándo se reintenta: "1 file copy is pending and will be retried in the next run."
6. **Las cifras visibles son coherentes entre sí.** Antes de enviar, el correo comprueba lo que un
   lector cruzaría: los nuevos no pueden ser más que los traídos, los archivos entregados no pueden
   ser más que los generados, y la suma de los estados de corrida es el total de corridas. Si una
   cifra no cuadra, el correo no sale con ella. **Hoy el código de referencia no lo comprueba**: está
   en la deuda del kit (`CANON.md` §9).
7. **Ningún compromiso que no esté verificado**, como en el mail técnico (`DATA_DELIVERY.md` §9).
8. **Nada del cliente en el repo.** Las previas y los fixtures de prueba usan proyectos y cifras
   inventados.

## 4. La lección que dejó la primera semana

El primer delivery status real salió como "Partial delivery" por un error que ya estaba resuelto, y
el cliente vio dos cosas que no debía ver: el texto técnico crudo del error, y un contador de nuevos
resultados más alto que el de resultados traídos. De ahí salen las reglas 4, 5 y 6: el estado sigue
a lo que recibió el cliente, el error se cuenta en palabras y el detalle va en "For nerds", y las
cifras se validan entre sí antes de mandar.

## 5. Cómo se construye un correo nuevo

1. Copia la plantilla más cercana del archivo de referencia. No escribas otro shell.
2. Decide su píldora: qué estados tiene y qué dice cada uno.
3. Escribe el lead de cada estado en una o dos frases que el cliente entienda sin abrir "For nerds".
4. Elige de dos a cuatro tiles: las cifras que el cliente quiere ver de un vistazo.
5. Los facts llevan el periodo, la ventana de datos, el destino y la siguiente actualización.
6. "For nerds" lleva el log completo, con `scrub()` encima.
7. Escribe la versión en texto plano.
8. Agrega un test por estado: el asunto, la píldora, que el proveedor no aparezca y que las cifras
   cuadren (regla 6).
9. Revisa la previa en Gmail y en Outlook, en claro y en oscuro, antes del primer envío real.

## 6. Ejemplo de un delivery status completo

Proyecto y cifras inventados.

```
Asunto:   Proyecto de ejemplo · Delivery complete · 1,240 new results · 12 Nov 19:00 CDMX
Header:   noisia <API/>                                              ● Delivery complete
h1:       Everything delivered
Lead:     12 runs completed since 12 Nov 07:00 CDMX. 12 files with 1,240 new results landed in
          your SFTP folder. 0 errors.
Tiles:    Runs 12 · Files delivered 12 · New results 1,240 · Errors 0
Facts:    Period       12 Nov 07:00 CDMX → 12 Nov 19:00 CDMX
          Data window  2026-11-12T05:50Z → 2026-11-12T17:50Z
          Folder       SFTP /deliveries
          Next update  13 Nov 07:00 CDMX
For nerds:
          -- delivery log · example-project
          SELECT run, window, fetched, new, files, destinations
          FROM noisia.delivery_log
          WHERE project = 'example-project'
            AND started_at BETWEEN '2026-11-12T06:00:00Z' AND '2026-11-12T18:00:00Z';

          runs:        12  (12 ok · 0 retried · 0 failed)
          fetched:     1,380 records
          duplicates:  140 removed (same result in several partitions)
          new results: 1,240
          errors:      0
Pie:      Noisia Data API · automated notification · noisia.ai
          Questions or changes: reply to this email.
```

Fíjate en que 1,380 traídos menos 140 repetidos dan los 1,240 nuevos: es la regla 6 a la vista.
