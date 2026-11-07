# QA final del fundador — MFP (R10)

Redactada por el auditor el 1 de noviembre de 2026 a partir de la lista factual de Codex (`FACTUAL_STEPS_MFP_R10_2026-10-11.md`, en #57). Sustituye a la QA-1: el fundador eligió una sola QA final con R10 completa (opción B, §17.6).

Versión del Studio de desarrollo: `0e84ddf6`, fijada y sin publicación automática. Dura unos 35 minutos y cuesta **USD 0**.

## Qué se revisa

Codex llevó una marca nueva de principio a fin, toda por la interfaz:

1. Alta de la marca y tres intereses definidos por una persona.
2. Primera carga de 1,000 filas.
3. Fichas, temas, revisión editorial y pertenencia.
4. Signal.
5. Una segunda carga de 250 filas, procesada sin rehacer lo anterior.
6. Un concepto nuevo adoptado del descubrimiento automático.

Gasto real de todo el recorrido: USD 8.61. Tú revisas el resultado; no se calcula nada nuevo.

## Antes de empezar

1. Abre <https://mfp-studio-dev-test.up.railway.app> con tu sesión habitual (rol Admin Noisia).
2. Abre una nota con cuatro columnas: paso, ¿OK?, segundos si tardó más de 15, comentario. Si algo falla, toma una captura.
3. **No pulses botones que inicien o autoricen trabajo:** «Calcular…», «Completar…», «Recalcular…», «Confirmar recálculo…», «Probar definición…», «Crear vectores…», «Analizar conversaciones», «Preparar…», «Ver estimación…», «Iniciar revisión editorial», «Autorizar…», «Recuperar respuestas guardadas», «Importar…», «Adoptar concepto», «Guardar cambios». Tampoco marques ni desmarques «Mostrar este concepto en Signal». Si pulsas uno por error, anota la hora y avísame.
4. **Meta de tiempo:** cada pantalla termina de cargar en menos de 15 segundos sin recargar a mano. Si tarda más, espera hasta un minuto, anota cuánto y sigue.

## Parte A · La marca y sus datos (≈ 5 min)

Marca: **Marca QA MFP Oct11 R10**.

| Paso | Haz esto | Deberías ver |
|---|---|---|
| A1 | En Studio, entra a la marca «Marca QA MFP Oct11 R10» y abre Datos. | Dos archivos. El primero: 1,000 filas, 901 incluidas, 17 excluidas y 82 duplicadas. El segundo: 250 filas, 220 incluidas, 1 excluida y 29 duplicadas. |
| A2 | Si el resumen de Datos no coincide con «Archivos por ámbito», pulsa «Actualizar» una vez. | Ambos cuadros coinciden. Si tuviste que pulsar, anótalo: es un problema conocido. |

## Parte B · Topics y resultados (≈ 10 min)

| Paso | Haz esto | Deberías ver |
|---|---|---|
| B1 | Abre <https://mfp-studio-dev-test.up.railway.app/studio/brands/[identificador privado]/topics>. | La página de Topics de la marca. Las fichas por mención están completas: 1,101 de 1,101. |
| B2 | Mira la lista de conceptos. | Cuatro conceptos. Tres son intereses definidos a mano: «Atención y resolución de reclamaciones», «Cobros y depósitos en la renta» y «Reserva y entrega del vehículo». El cuarto, sobre el mercado de renta, salió del descubrimiento automático y se adoptó con ámbito Categoría. |
| B3 | Pulsa «Ver resultados guardados». | La revisión editorial de los 23 grupos de la primera carga: ningún Topic ni Narrativa; 16 Noise y 7 con evidencia insuficiente. Después vienen 10 grupos nuevos de la segunda carga. |
| B4 | Abre dos o tres de esos grupos. | Cada uno muestra su resultado y su evidencia. |
| B5 | Selecciona «Cobros y depósitos en la renta». | Su ficha. «Guardar cambios» está apagado. No edites nada. |
| B6 | En su evidencia, pulsa «Abrir mención». | El texto completo de la mención original, dentro de Studio. |

Anota tu opinión; no hay respuesta correcta:

- ¿Estás de acuerdo en que esos 23 grupos eran ruido o no alcanzaban para un Topic? Abre uno de los marcados Noise y dime si tú lo habrías descartado.
- ¿Se entienden los nombres de los conceptos sin explicación?

## Parte C · Signal (≈ 5 min)

| Paso | Haz esto | Deberías ver |
|---|---|---|
| C1 | Abre <https://mfp-studio-dev-test.up.railway.app/signal/<workspace>/topics-narratives>. | En menos de 15 s: cuatro conceptos seleccionados, con 14 (Atención), 9 (Cobros), 11 (Reserva) y 225 (el de Categoría). En total, 235 menciones únicas de 1,101. |
| C2 | Mira el resumen de poblaciones. | 1,101 en total: 647 relevantes, 343 ajenas, 85 con relevancia sin determinar y 26 spam o bots. |
| C3 | Selecciona «Reserva y entrega del vehículo». | En menos de 15 s, su detalle con 11 menciones. Eran 12: Codex rechazó una a mano y Signal se actualizó sin otro cálculo. |
| C4 | Lee la evidencia de una mención. | El fragmento citado («Cita de la decisión guardada»). La que corrigió una persona dice «Corrección humana». |
| C5 | Selecciona el concepto de Categoría (225). | Su detalle y su evidencia. |

Anota tu opinión:

- ¿Te sirve un concepto de 225 menciones sobre el mercado de renta, o es demasiado amplio para un cliente?
- ¿Se ve y se siente como el Signal de Laika? ¿Qué falta?

## Parte D · Corregir dos casos dudosos (≈ 10 min)

Entre los cuatro conceptos quedan **12 pares con evidencia insuficiente**: el sistema no pudo decidir si la mención pertenece y nadie los ha revisado. **La decisión es tuya.**

| Paso | Haz esto | Deberías ver |
|---|---|---|
| D1 | Vuelve a Topics (enlace de B1) y selecciona «Cobros y depósitos en la renta». Lee qué incluye y qué excluye. | La definición del concepto. |
| D2 | Baja a «Resultados y excepciones» y pulsa «Revisar insuficientes». | El filtro cambia a «Evidencia insuficiente». Si Cobros no tiene ninguna, prueba Atención, después Reserva y al final el de Categoría. |
| D3 | En la primera mención, pulsa «Abrir mención» y léela completa. Después vuelve a la lista. | El texto completo. |
| D4 | Decide: ¿el texto, por sí solo, cumple la definición? | Tu decisión: pertenece, no pertenece o no se puede saber. |
| D5 | Si decidiste, marca **solo** su casilla «Seleccionar mención». No uses «Seleccionar esta página». | «Corregir 1 menciones seleccionadas» y dos botones. |
| D6 | Pulsa «Aceptar pertenencia» si pertenece o «Rechazar pertenencia» si no. Si no se puede saber, no pulses nada. | Se guarda y el contador de insuficientes baja en uno. |
| D7 | Repite D3 a D6 con una segunda mención. | — |
| D8 | Si aceptaste alguna, vuelve a Signal (enlace de C1) y selecciona ese concepto. | Su número sube en uno y tu mención aparece en la evidencia, marcada «Corrección humana». **Si no cambia, anótalo: es un hallazgo.** |

Si te equivocas, filtra por el veredicto que guardaste, selecciona la mención y pulsa el otro botón.

## Parte E · Idioma (≈ 5 min)

| Paso | Haz esto | Deberías ver |
|---|---|---|
| E1 | Abre <https://mfp-studio-dev-test.up.railway.app/studio/settings>. | El control «Idioma». |
| E2 | Elige English. | La página se recarga sola y queda en inglés. |
| E3 | Abre Signal (enlace de C1). | Títulos y botones en inglés. Los números son los mismos que en español. Los nombres de los conceptos pueden seguir en español: son datos de la marca. |
| E4 | Vuelve a <https://mfp-studio-dev-test.up.railway.app/studio/settings> y, en «Language», elige Español. | Se recarga sola, en español. |

## Al terminar, mándame

1. Tu nota: OK o problema en cada paso.
2. Las pantallas que tardaron más de 15 s.
3. Tus decisiones de la Parte D, con una línea de por qué.
4. Tus opiniones de las Partes B y C.
5. Capturas de lo que falló.

## Si algo sale mal

- **«La consulta está ocupada»:** pulsa «Actualizar» una vez.
- **Error de acceso:** recarga la página.
- **Una corrección se queda guardando:** no la repitas. Si aparece «Recuperar la misma solicitud», púlsalo.

## Problemas ya conocidos

No hace falta reportarlos de nuevo, pero sí anotar sus tiempos:

- Tras importar, «Datos recibidos» puede quedarse desactualizado hasta pulsar «Actualizar».
- Un filtro de Signal tardó 14 s en la medición de Codex, al borde de la meta.
