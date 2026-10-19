# 26 — Signal Momentum Stream

## Qué reemplaza

Reemplaza timeline genérico de volumen.

## Pregunta que responde

> ¿Cómo nacen, crecen, maduran, caen o se reactivan las señales a través de meses comparables?

## Elementos visuales

| Elemento | Significado |
|---|---|
| Eje X | meses comparables |
| Línea/banda | señal |
| Grosor | impacto mensual |
| Color | emoción/polaridad/categoría |
| Marker birth | nacimiento de señal |
| Marker peak | punto máximo |
| Marker decay | caída |
| Marker reactivation | regreso |
| Marker saturation | señal grande pero poco diferencial |

## Implementación visual

Opciones:

1. shadcn/ui Chart + LineChart para versión simple.
2. shadcn/ui Chart + Area/ComposedChart para stream visual.
3. Custom streamgraph si se quiere una visualización más propia.

Decisión de producto: para Overview usar versión compacta clara; para Signals usar versión detallada.

## Interacciones

- Click en mes filtra todo el dashboard.
- Click en señal abre lifecycle detail.
- Hover muestra valores de ese mes.
- Toggle top signals vs risks vs opportunities.
- Comparar mes actual vs anterior vs promedio.

## Datos necesarios

Por señal y mes:

- impact;
- volume;
- engagement;
- polarity;
- dominant emotion;
- confidence;
- lifecycle state;
- source coverage;
- delta;
- evidence count.

## Copy de lectura

Bueno:

> Esta señal aparece desde marzo, aceleró en julio y se mantiene estable desde septiembre. Conviene tratarla como patrón, no como trend pasajero.

Malo:

> La tendencia mantiene un comportamiento creciente relevante.

## Quality gates

- No mostrar delta si el mes anterior no es comparable.
- No mostrar lifecycle si no hay al menos 3 periodos o la ventana configurada lo permite con caveat.
- No llamar `mature` a señal de 2 meses.
- Marcar picos como picos, no tendencias.

## Regla final

Signal Momentum Stream debe proteger a Marketing de sobrerreaccionar a ruido y ayudarle a detectar patrones que sí merecen inversión.
