# Modelo de producto — Reportes, Estudios, Data

> **Este archivo manda sobre `foundation.md`, `intelligence.md` y `strategy.md`.**
> Los tiers siguen siendo válidos como calibración de profundidad interna; ya no son la
> estructura con la que se vende.
>
> Origen: workshop de producto del 21 jul 2026. El detalle comercial (catálogos, precios,
> guion de venta) vive en el KB comercial en Drive — ver `README.md → Frontera Git / Drive`.

---

## El servicio raíz

> **Investigación de mercado con fuentes de datos sociales.** El cliente entrega un brief y una
> fecha; Noisia resuelve todo lo que hay en medio.

Un servicio es un grupo de tareas que alguien hace por ti y que tú tendrías que estar haciendo.
Noisia suple una función de investigación que el cliente no tiene o le cuesta más en nómina.

**La oferta está explícitamente desvinculada del modelo Software as a Service.** No se venden
licencias ni asientos. La plataforma es infraestructura interna: es cómo se produce, no lo que
se factura. El modelo SaaS obliga a maximizar el uso de la herramienta; el modelo de servicio
obliga a maximizar la calidad de la decisión.

## Las tres líneas

| | Reportes | Estudios | Data |
|---|---|---|---|
| Nombre largo | Reports as a Service | Insights as a Service | Data as a Service |
| Qué entrega | Lo que está pasando | Qué hacer al respecto | Materia prima |
| Cadencia | Continuo (semanal/mensual) | One-time, por pedido | Continuo o por entrega |
| Modalidad | Iguala mensual | Fee de proyecto | Caso a caso |
| Precio relativo | 1x | 2x | Sin definir |
| Metodologías | No se nombran | Son el motor | No aplican |
| Estado | Por construir — **prioridad** | Operativo | Exploratorio |

Precede a las tres una **consultoría de entrada**: un workshop inicial gratuito que convierte
un deseo difuso en una pregunta de negocio respondible, y un workshop de cierre donde se
explican los resultados.

### Reportes

Social listening en el sentido que el mercado ya conoce, con cuatro familias: reputación y
salud de marca, campañas, competencia, y conversación/entorno.

El diferencial no es el acceso a los datos — un cliente con SentiOne, YouScan o Talkwalker
**casi** tiene esto por default. El diferencial es la interpretación: cruzar un hallazgo de
reputación hacia algo que le sirva a growth, a creativo o al comité.

Cuatro reglas de producción, que son las que hacen "reporte Noisia" y no "screenshots en un PDF":

1. **ETL antes de promptear.** Nunca se le pasa data cruda a un modelo pidiéndole tendencias.
   Se separa, se clasifica y se trata primero; el modelo entra al final a nombrar clusters.
   Un prompt vago produce una respuesta igual de vaga.
2. **LLM supervisado.** Cada paso del pipeline está definido. La IA hace la parte que le toca.
3. **Priorización con contexto.** Las plataformas agrupan por repetición sin analizar el
   contexto de lo que agruparon, y por eso la repetición no dice nada. El engine sí puede
   priorizar: el top 3 de conversaciones positivas y negativas que importan, y por qué.
4. **Los datos ya etiquetados en origen viajan intactos.** Si el sentimiento viene dado por la
   fuente, esa gráfica es la misma en el dashboard y en el PDF. No se recalcula. El valor
   agregado va en las capas donde sí aportamos.

El criterio de "listo" para la v1 es deliberadamente modesto: un PDF que responda, que se
sienta como un social listening de verdad, y que se pueda vender como reporte mensual o
semanal. La personalización profunda viene después.

### Estudios

Investigación a profundidad que responde una pregunta de negocio concreta con las seis
metodologías propietarias (ver `01-methodologies/`).

**Las metodologías son el motor, no la oferta.** Gustan pero no se entienden: la reacción
típica es "qué chingón" seguido de "¿y cómo lo uso?". Se venden por la pregunta que responden:

| Metodología | Pregunta con la que se vende |
|---|---|
| Triggers & Barriers | ¿Qué empuja la compra y qué la detiene? |
| Value Perception Matrix | ¿Cuál es el valor percibido de tu marca? |
| Cultural Codes Decoding | ¿Qué significa tu marca en la vida de las personas? |
| Journey Friction Mapping | ¿Dónde se pierde la intención antes de convertirse en compra? |
| Influence Architecture | ¿Quién influye de verdad en tu categoría? |
| Decision Velocity | ¿Por qué deciden rápido en otra categoría y lento en la tuya? |

Una metodología es un **método de agrupación** para responder una pregunta — no un tipo de
reporte. Un mismo ejercicio puede caer en varias.

### Data

Venta de datos, no de análisis, en tres niveles: crudos/estructurados (reventa, margen de
intermediación), curados por tópico o marca, y **enriquecidos** con capas propias de intent o
NLP — el único nivel donde no competimos como reseller. Un cuarto modo es la implementación:
ayudar al cliente a montar su operación de data y a no elegir la herramienta equivocada.

Exploratorio. No se pitchea como si estuviera listo.

---

## Personalización: al revés de lo que parece

- **Los reportes son los menos estandarizables.** Cada cliente y cada marca dentro de un cliente
  tiene su propia pregunta, y el contexto lo pone el cliente. Ese contexto define qué gráficas
  y qué análisis entran.
- **Los estudios sí son estandarizables.** Pueden existir seis estructuras fijas; lo que se
  adapta al cliente y a la industria es el contexto, no la estructura.

Regla operativa mientras dure esta etapa: como la investigación no consume una semana, esa
semana se invierte en personalizar el output. La forma de entrega puede variar (dashboard, PDF,
otro formato) mientras la venta caiga claramente en reporte o en estudio y se cotice como tal.

## El problema abierto: el contexto

Hoy hay un humano que ve la data y decide qué vale la pena contarle al cliente, con criterio de
marca, industria y momento cultural. Ese contexto no se puede saber de antemano: aparece cuando
consumes la data. Automatizarlo es el reto técnico central de la línea de reportes y está
abierto. El corpus (contexto de marca, empresa e industria) es la ventaja ya construida para
atacarlo.

---

## Relación con los tiers Foundation / Intelligence / Strategy

Los tiers no desaparecen: siguen describiendo bien **cuánta profundidad** lleva un trabajo y
cómo se calibra un alcance. Pero dejan de ser el mapa de la oferta.

| Tier | Cómo se lee ahora |
|---|---|
| Foundation | Un estudio de una o dos metodologías. |
| Intelligence | Un estudio de tres o cuatro metodologías con lectura cruzada. |
| Strategy | Un cliente con reportes always-on más estudios recurrentes. |

Si un material comercial contradice esto, gana este archivo.

## Escalera comercial

```
Workshop gratis → Reporte (iguala) → Estudio → Estudios recurrentes
```

El workshop quita la fricción de "¿cómo te compro?". El reporte instala a Noisia adentro y
genera el contexto. El estudio profundiza y es donde está el margen. Con tres estructuras de
estudio, un cliente puede recibir uno cada dos meses sin repetir.

## Referencias

- KB comercial (Drive): catálogos completos, precios, guion de venta y objeciones.
- `00-overview/positioning.md` — contra quién competimos y qué no somos.
- `01-methodologies/` — el detalle metodológico que **no** va en un pitch.
- `02-services/pricing-logic.md` — variables de precio, sin montos.
</content>
