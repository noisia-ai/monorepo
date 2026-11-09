# Anexo de coste R14 · etiquetado del Estudio real A

Esta revisión complementa el [recibo R13](DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_2026-11-08.md) con la proyección de la ruta final de siete preguntas base por raíz y los intereses activos. El recibo R13 y sus importes siguen disponibles en su versión original.

La unidad proyectada es una raíz del corpus. En cada solicitud, JEV recibe promotion, voice, trigger_barrier con la categoría del estudio, los cuatro candidatos de tópico más próximos y las preguntas de todos los intereses activos. Los siete elementos base son promotion, voice, trigger_barrier y topic_0 a topic_3. Cada interés añade una pregunta a esa misma solicitud. Los textos de motivadores y barreras no se vuelven a enviar por separado. Los posts compuestos sólo por hashtags siguen con su regla determinista.

## Proyección a un millón de raíces

| Partida | Base | Con dos intereses activos |
|---|---:|---:|
| Voyage, estimación del auditor | USD 37 | USD 37 |
| JEV, siete preguntas base | USD 60 | USD 60 |
| Claude, según número de grupos | USD 10–15 | USD 10–15 |
| Dos intereses adicionales, dentro de cada solicitud | — | USD 15 |
| **Total estimado** | **USD 107–112** | **USD 122–127** |

Cada interés definido adicional aumenta la proyección en aproximadamente USD 7.50 por millón de raíces. Con tres intereses, el total estimado sería USD 129.50–134.50. Claude escala con los grupos que requieran consolidación editorial. Las cifras de Voyage, JEV y Claude son estimaciones de uso sujetas a longitud del texto, número de grupos y tarifa vigente.

## Base empírica

En la comparación pareada de R13, la solicitud de trece preguntas promedió 2,489.144 tokens de entrada por raíz y la de siete preguntas promedió 1,411.381, una reducción de 43.3 %. Se conservaron las mismas 1,000 raíces y se compararon las probabilidades de las preguntas compartidas. El cambio medio absoluto fue 0.008901.

La comparación R14 de candidatos inglés y portugués usó 597 raíces, siete preguntas base y dos intereses activos en cada idioma. Se liquidaron 1,194 respuestas. El costo de uso medido fue USD 0.042683 para el brazo portugués y USD 0.040350 para el brazo inglés. Estos importes corresponden sólo a la comparación lingüística, no a una ejecución nueva de todo el corpus.

La comparación de candidatos produjo 220 positivos correctos entre 316 candidatos positivos con definiciones en inglés (69.62 %) y 222 entre 326 con definiciones originales (68.10 %). La diferencia fue +1.52 puntos porcentuales. Se eligió inglés. El plan admite inglés si su precisión queda como máximo tres puntos por debajo de la del original (diferencia ≥ −3 puntos). El original sigue disponible en Signal.

## Lectura de consumidor y léxico R14

La lectura independiente sobre el texto completo en PostgreSQL encontró 50,273 voces elegibles: 18,464 raíces con término del léxico y 31,809 excluidas por no contenerlo. De las raíces incluidas, 4,174 quedaron como motivadores, 842 como barreras, 7,889 sin motivador ni barrera y 5,559 intermedias. Estas cuatro cantidades suman las 18,464 raíces incluidas; las excluidas quedan fuera de ese denominador.

La propuesta de términos desde Brand OS contenía 156 términos antes de la curación; la configuración vigente conserva 102. La UI de configuración muestra la lista vigente, no necesariamente la propuesta previa. La única propuesta editorial del léxico usó 471 tokens de entrada y 683 de salida, con costo tarifario medido de USD 0.011658. La salida fue validada. Este valor describe uso tarifario y no un débito confirmado del panel del proveedor.

La estimación por millón es un modelo tarifario de planeación. No equivale a un cargo de proveedor ni a una promesa de precio. Consulta el límite calculado de una corrida antes de iniciarla.
