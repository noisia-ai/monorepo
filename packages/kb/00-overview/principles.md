# Principios operativos de Noisia

> Qué cuenta como evidencia válida, qué se considera ruido, cómo se reporta confianza.
> Toda IA o analista que opere una metodología tiene que internalizar esto antes de producir output.

## P1 — La pregunta manda

Ninguna metodología se aplica por default. Antes de ejecutar, hay que poder decir en una frase la pregunta de negocio que responde la corrida. Si la pregunta no se puede formular, el problema no es el corpus — es que la decisión todavía no está clara.

**En la práctica:** si una IA recibe "corre T&B sobre este corpus" sin pregunta de negocio asociada, debe pedirla antes de operar. Output sin pregunta = output sin uso.

## P2 — La conversación que importa rara vez es la que aparece primero

Reviews de 5 estrellas escritas a las 48hrs de la compra son ruido. Comentarios de YouTube debajo de un video de 200k vistas con 12 likes son ruido. La señal vive en:

- Reviews de 2-4 estrellas con texto extenso (>80 palabras).
- Foros de nicho (subreddits de <100k miembros, comunidades de Discord, grupos de Facebook con moderación activa).
- Comentarios largos en posts pequeños de creadores con audiencia leal.
- Conversaciones donde el usuario no está siendo observado (replies en threads, no posts originales).

Lo que se elimina del corpus tiene que quedar trazable. "Excluido por ser content de marca" o "excluido por testimonial incentivado" — una razón por exclusión, en el mismo dataset.

## P3 — Codificación con doble pase mínimo

Una sola lectura clasifica mal. El protocolo mínimo son dos pases:

1. **Pase 1 — clasificación abierta.** Etiquetar sin tipología fija, dejar emerger categorías.
2. **Pase 2 — codificación contra el protocolo.** Aplicar la tipología de la metodología (ej. los 4 layers de T&B) sobre las categorías emergentes.

Si una IA solo hace pase 2 (clasificación directa contra tipología fija), va a forzar evidencia ambigua a categorías que no le corresponden. El primer pase abierto es lo que protege contra eso.

## P4 — Frecuencia ≠ importancia

Que una expresión aparezca 200 veces no la hace más importante que una que aparece 12 veces. Pesa también:

- **Intensidad lingüística** — "no me gusta" vs. "me da rabia que esto exista".
- **Capacidad predictiva** — ¿la expresión aparece junto a una decisión declarada (compra, abandono, recomendación)?
- **Origen** — el mismo trigger en 12 fuentes distintas pesa más que en 200 instancias del mismo subreddit.

Reportar siempre las tres dimensiones. Un output que solo muestra frecuencia es un output a medias.

## P5 — Trazabilidad o no es Noisia

Cada hallazgo en un entregable tiene que apuntar a evidencia en el corpus. No "los consumidores dicen X" — sino "12 expresiones del corpus categorizadas como X, con esta cita representativa, con este link a la fuente original."

Si una IA produce un insight sin link de vuelta al corpus, ese insight no existe.

## P6 — Lo que la metodología NO puede responder, se dice

Toda corrida termina con una sección "Lo que esta metodología no respondió". Si T&B no puede decir tamaño de mercado, se escribe. Si Cultural Codes no puede predecir velocidad de adopción, se escribe.

Honestidad metodológica > apariencia de completitud.

## P7 — Confianza calibrada

No se reporta hallazgos sin nivel de confianza. La escala mínima:

- **Alta** — patrón consistente cross-source, >50 evidencias, replica en al menos 3 fuentes distintas.
- **Media** — patrón visible, 15-50 evidencias, replica en 2 fuentes.
- **Baja / direccional** — emergente, <15 evidencias, una sola fuente. Reportable pero etiquetado.

Una IA que reporta todo como "alta confianza" está sobreajustada al corpus o no entendió el principio.

## P8 — Sin proyección al futuro sin evidencia presente

T&B describe el sistema motivacional **actual**. Cultural Codes describe códigos **vigentes**. Ninguna metodología Noisia proyecta. Si el cliente quiere predicción, esa es otra metodología (Decision Velocity en lo conductual, o consultoría externa de forecasting).

Si una IA empieza a decir "esto va a crecer" o "esta tendencia va a llegar a México", está saliéndose del protocolo.

## P9 — Cliente no ve evidencia cruda

El corpus, los CSVs codificados, los snapshots de plataforma — son para Noisia. El cliente recibe el destilado, no el ruido. Excepción: cuando una decisión amerita defenderse con cita literal, se incluyen 1-3 citas representativas — nunca el dataset completo.

Esto no es por opacidad. Es por respeto al tiempo del cliente: si el output es bueno, no debería tener que leer 4,000 reviews para creerlo.

## P10 — La metodología es viva

Si tres corridas distintas revelan que un criterio del playbook es ambiguo o produce errores, se actualiza el playbook. La regla 3-strikes:

1. Primer error → posible caso edge.
2. Segundo error → patrón sospechoso.
3. Tercer error → cambio al playbook con commit que explica el aprendizaje.

Una metodología que no cambia en 12 meses está fosilizada o no se está usando.
