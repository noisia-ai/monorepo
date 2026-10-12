# QA del fundador — MFP

Redactada por el auditor el 11 de octubre de 2026 a partir de la lista factual de Codex (revisión 9). Versión del Studio de desarrollo: `44a2e1be` (fijada, sin publicación automática).

La QA tiene dos partes:

- **QA-1 (esta guía):** revisar resultados ya calculados, ver Signal, corregir un caso dudoso y cambiar de idioma. Unos 30 minutos y **USD 0**.
- **QA-2 (marca nueva completa):** crear la marca, importar, analizar, segunda carga y Signal. El auditor la escribe cuando Codex la haya corrido entera sobre esta misma versión.

## Antes de empezar

1. Abre <https://mfp-studio-dev-test.up.railway.app> con tu sesión habitual (rol Admin Noisia).
2. Abre una nota con cuatro columnas: paso, ¿OK?, segundos si tardó más de 15, comentario. Si algo falla, toma una captura.
3. **No pulses botones que inicien o autoricen trabajo:** «Calcular…», «Completar…», «Recalcular…», «Probar definición…», «Crear vectores…», «Iniciar…», «Ver estimación…», «Autorizar…», «Importar…», «Adoptar concepto», «Guardar cambios». Esta QA no gasta nada. Si pulsas uno por error, anota la hora y avísame.
4. **Meta de tiempo:** cada pantalla termina de cargar en menos de 15 segundos sin recargar a mano. Si tarda más, espera hasta un minuto, anota cuánto y sigue.

## Parte A · Resultados de una marca ya analizada (≈10 min)

Marca: **Marca QA MFP Oct07 R4**.

| Paso | Haz esto | Deberías ver |
|---|---|---|
| A1 | En Studio, entra a la marca «Marca QA MFP Oct07 R4». | 1,176 menciones, 3 archivos, 1,273 filas. |
| A2 | Pulsa «Revisar tópicos para Signal». | La página de Topics. El análisis indica 13/13 interpretados. |
| A3 | Pulsa «Ver resultados guardados». | 5 Topics, 0 Narrativas, 4 Noise y 4 con evidencia insuficiente. |
| A4 | Abre dos o tres grupos de la lista. | Cada grupo muestra su resultado y su evidencia. |
| A5 | En la lista de Topics, selecciona «Cobros y depósitos en la renta». | Su ficha, en Borrador. «Guardar cambios» está apagado. No edites nada. |
| A6 | En su evidencia, pulsa «Abrir mención». | El texto completo de la mención original, dentro de Studio. «Abrir fuente original» lleva a la red social; aquí no se usa. |
| A7 | Selecciona, uno por uno: «Atención durante la entrega y devolución», «Programa Emerald Aisle y beneficios de estatus élite» e «Integración de renta de autos en plataformas de viaje». | Cobros y Atención los definió una persona. Los otros dos salieron del descubrimiento automático y se adoptaron. |

Anota tu opinión; no hay respuesta correcta:

- ¿Se entienden los nombres de los Topics sin explicación?
- ¿La mención que abriste justifica que esté en ese Topic?

## Parte B · Signal (≈5 min)

Marca: **Marca QA MFP Oct11R8**.

| Paso | Haz esto | Deberías ver |
|---|---|---|
| B1 | Abre <https://mfp-studio-dev-test.up.railway.app/signal/mfp-qa-r8-20261011/topics-narratives>. | En menos de 15 s: 2 Topics seleccionados, «Atención…» con 7 menciones y «Cobros…» con 2. En el resumen: Total de menciones 1,086; Relevantes 616; Ajenas 300; Spam o bots 35; Relevancia sin determinar 135; En conceptos seleccionados 8. |
| B2 | Selecciona «Cobros y depósitos en la renta». | En menos de 15 s, su detalle y sus 2 menciones de evidencia. |
| B3 | Lee la evidencia de una mención. | El fragmento citado («Cita de la decisión guardada»). Si la corrigió una persona, dice «Corrección humana». |

Anota tu opinión:

- ¿Se ve y se siente como el Signal de Laika? ¿Qué falta?

## Parte C · Corregir un caso dudoso (≈10 min)

En el concepto «Cobros y depósitos en la renta» de la marca R8 quedan **2 menciones con evidencia insuficiente**: el sistema no pudo decidir si pertenecen y nadie las ha revisado. **La decisión es tuya.**

| Paso | Haz esto | Deberías ver |
|---|---|---|
| C1 | Abre <https://mfp-studio-dev-test.up.railway.app/studio/brands/7f853d28-c6bf-4ec2-b678-d72750ff7a44/topics>. | Los Topics de la marca R8, con dos conceptos. |
| C2 | Selecciona «Cobros y depósitos en la renta» y lee su definición: qué incluye y qué excluye. | La definición del concepto. |
| C3 | Baja a «Resultados y excepciones» y pulsa «Revisar insuficientes». | El filtro cambia a «Evidencia insuficiente» y muestra 2 resultados. Hoy tarda unos 17 s: es un problema conocido, anota el tiempo. |
| C4 | En la primera mención, pulsa «Abrir mención» y léela completa. Después vuelve a la lista. | El texto completo. |
| C5 | Decide: ¿el texto, por sí solo, habla de un cobro, un depósito o una devolución de la marca, o de las rentadoras de un país? | Tu decisión: pertenece, no pertenece o no se puede saber. |
| C6 | Si decidiste, marca **solo** su casilla «Seleccionar mención». No uses «Seleccionar esta página». | «Corregir 1 menciones seleccionadas» y dos botones. |
| C7 | Pulsa «Aceptar pertenencia» si pertenece o «Rechazar pertenencia» si no. Si no se puede saber, no pulses nada. | Se guarda (hoy tarda unos 12 s) y el contador de insuficientes baja en uno. |
| C8 | Repite C4 a C7 con la segunda mención. | — |
| C9 | En «Filtrar», elige «Pertenece» o «No pertenece», según lo que decidiste. | Tu corrección aparece ahí, marcada como «Corrección humana» y «Revisión humana directa». |
| C10 | Si aceptaste alguna, vuelve a Signal (enlace de B1) y selecciona «Cobros…». | Cobros sube de 2 a 3 menciones (o 4) y la tuya aparece en la evidencia. **Si no cambia, anótalo: es un hallazgo.** |

Si te equivocas, filtra por el veredicto que guardaste, selecciona la mención y pulsa el otro botón.

## Parte D · Idioma (≈5 min)

| Paso | Haz esto | Deberías ver |
|---|---|---|
| D1 | Abre <https://mfp-studio-dev-test.up.railway.app/studio/settings>. | El control «Idioma». |
| D2 | Elige English. | La página se recarga sola y queda en inglés: «Settings», «Brands», «Data». |
| D3 | Abre Signal (enlace de B1). | Títulos y botones en inglés: «Brand monitoring», «Mentions», «Topics and narratives». Los números son los mismos que en español. Los nombres de los Topics pueden seguir en español: son datos de la marca. |
| D4 | Vuelve a <https://mfp-studio-dev-test.up.railway.app/studio/settings> y, en «Language», elige Español. | Se recarga sola, en español. |

## Al terminar, mándame

1. Tu nota: OK o problema en cada paso.
2. Las pantallas que tardaron más de 15 s.
3. Tu decisión sobre las dos menciones de la Parte C, con una línea de por qué.
4. Tus opiniones de las Partes A y B.
5. Capturas de lo que falló.

## Si algo sale mal

- **«La consulta está ocupada»:** pulsa «Actualizar» una vez.
- **Error de acceso:** recarga la página.
- **Una corrección se queda guardando:** no la repitas. Si aparece «Recuperar la misma solicitud», púlsalo.

## Problemas ya conocidos

No hace falta reportarlos de nuevo, pero sí anotar sus tiempos:

- El filtro de excepciones tarda unos 17 s y guardar una corrección unos 12 s. Codex los está acelerando; la meta es 15 s para el filtro y 5 s para guardar.
