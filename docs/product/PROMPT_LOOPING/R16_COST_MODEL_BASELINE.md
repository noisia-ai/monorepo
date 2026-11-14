# Modelo de costo · Raíces, grupos y vueltas

Este documento corrige la extrapolación del recibo de R15. Usa sus importes verificados; no presenta una nueva ejecución ni una cotización de R16.

## Fórmula

Para un conjunto de preguntas y un tamaño medio de texto comparables:

```text
C_total = N_vectores_nuevos × c_vector
        + N_raices_preguntadas × c_jev(conjunto_de_preguntas)
        + Σ_vueltas (Σ_lotes C_editorial_del_lote + C_consolidacion)
        + C_otras_etapas
```

Voyage y JEV se calculan a partir de sus tokens y tarifas. Los coeficientes por raíz sirven para este escenario medido. Preguntas diferentes, textos distintos o uso de caché cambian esos coeficientes y poblaciones; se sustituyen por las mediciones de la nueva corrida.

Claude interpreta muestras por grupo y consolida mapas. Su costo depende del número de grupos, tamaño de muestra, tokens y vueltas; no se multiplica por el cociente entre un millón y las raíces del piloto. Las capas y pasadas ciegas de un Estudio T&B tienen sus propias líneas de costo.

## Escenario de un millón con la referencia de R15

El [recibo R15](DELIVERY_PILOTO_ETIQUETADO_ESTUDIO_A_R15_2026-11-11.md) registra 83,962 raíces, USD 3.071449 de vectores, USD 5.796879 de JEV y USD 8.412135 editoriales. Estos últimos reúnen 56 respuestas de lote y una consolidación global para 158 grupos.

| Componente | Cálculo | USD |
|---|---|---:|
| Voyage | 1,000,000 × 3.071449 / 83,962 | 36.581418 |
| JEV | 1,000,000 × 5.796879 / 83,962 | 69.041697 |
| Editorial | Mismos grupos, muestras y una vuelta que la referencia | 8.412135 |
| Total del escenario | Suma sin redondear los componentes intermedios | **114.035250** |

Así se obtiene **aproximadamente USD 114 por millón**. El escenario mantiene el conjunto de preguntas, costo medio por raíz y costo editorial de referencia. Si aumenta el número de grupos o hay más vueltas, se añade su costo editorial; no se conserva automáticamente USD 8.412135.

La reconstrucción del volumen original devuelve exactamente:

```text
83,962 × (3.071449 / 83,962 + 5.796879 / 83,962)
       + 8.412135 = USD 17.280463
```

## Medición y caja

Los importes anteriores son uso a tarifa. Voyage mostró cargo efectivo cero en R15; esa observación no promete créditos gratuitos para otro volumen. El recibo real de R16 separará uso, liquidación, reservas, exposición incierta y movimientos observados de saldo.

El tiempo por etapa se registra aparte. Los intervalos anidados no se suman dos veces y una lectura de resultados guardados no se presenta como una nueva clasificación. Reducir preguntas y reutilizar caché exige medir otra vez tokens por raíz y calidad antes de actualizar esta referencia.
