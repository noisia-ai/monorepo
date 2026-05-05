# Influence Architecture — `influence-architecture`

## Pregunta que responde

> ¿Quiénes diseñan, sin saberlo, el imaginario de tu categoría — y cómo se mueve realmente la influencia entre comunidades?

## Cuándo aplica

- Estrategias de influencia donde el follower-count ya demostró ser mala señal.
- Lanzamientos en categorías especializadas (tech, gaming, beauty avanzado, finanzas personales sofisticadas).
- Defensa reputacional cuando una crisis se está propagando entre comunidades.
- Detección de tendencias emergentes (qué nodos están adoptando vocabulario nuevo antes que el mercado).
- Diseño de comunidad de marca con criterios de invitación que vayan más allá del reach.

## Cuándo NO aplica

- **Cuando la categoría es de adopción masiva sin estructura comunitaria** (consumibles diarios genéricos). No hay red que mapear.
- **Cuando el cliente espera "lista de influencers para contratar".** IA es analítica de red, no servicio de booking. Se entrega el mapa; la activación requiere otra capa.
- **Cuando se busca medir retorno de campañas pasadas.** IA mira estructura presente, no atribución histórica.

## Estructura de análisis — 6 tipos de nodo × tipo de tie

IA opera sobre dos ejes: **función del nodo** en la red y **tipo de relación** que conecta nodos. Ambos se codifican.

### Eje 1 — Los 6 tipos de nodo

Toda voz relevante en una categoría cumple una de estas funciones (o varias, jerarquizando una principal):

- **Innovator** — adopta primero. Genera el vocabulario nuevo. Suele tener audiencia chica pero hiper-comprometida. Trabaja con riesgo: a veces adopta cosas que no escalan.
- **Early adopter** — segundo en adoptar pero primero en **legitimar**. Lo que el innovator inventa, el early adopter lo vuelve respetable. Suele tener autoridad técnica o cultural.
- **Validator** — voz que el resto de la categoría usa como prueba. Cuando el validator dice algo, otros lo citan. No adopta primero pero su sello vale como autoridad.
- **Connector** — conecta comunidades que no se hablan entre sí. Bajo en producción de contenido propio, alto en circulación de contenido entre tribus. **Suelen ser los nodos más subestimados — y los más valiosos.**
- **Dissenter** — voz crítica estructural. No es hater random — es alguien con capacidad de articular contra-narrativa que otros adoptan. Importante: en crisis, los dissenters son quienes diseñan el frame de oposición.
- **Gatekeeper** — controla acceso a una comunidad o conversación. Modera, cura, decide qué entra. Tiene poder estructural más que reach.

**Diagnóstico clínico:** un nodo se clasifica por su **función observada en el corpus**, no por sus métricas de plataforma. Un creador con 2M de followers que solo recicla contenido de otros es un connector con audiencia grande, no un innovator.

### Eje 2 — Tipos de relación entre nodos (Granovetter)

- **Ties fuertes** — relaciones de alta frecuencia y reciprocidad. Mismas comunidades, mismas referencias, mismo lenguaje.
- **Ties débiles** — relaciones cross-community. Menos frecuentes pero estructuralmente más valiosas — son los puentes que permiten que información nueva atraviese.

**Insight contraintuitivo (Granovetter, 1973):** la información nueva se difunde por ties débiles, no fuertes. Una comunidad de ties fuertes se hace eco de sí misma; necesita un connector con ties débiles a otras comunidades para que algo nuevo entre.

### Métricas de centralidad

Tres métricas operativas para jerarquizar nodos:

- **Centralidad de grado (degree)** — cuántas conexiones tiene un nodo. Métrica más obvia, también la menos útil aislada.
- **Betweenness** — qué tan frecuentemente un nodo aparece en el camino más corto entre otros nodos. Identifica connectors.
- **Eigenvector centrality** — un nodo es central si está conectado a otros nodos centrales. Identifica validators (autoridad heredada).

**No reportar solo centralidad de grado.** Eso reproduce el error de "el más grande es el más importante". El valor de IA está en betweenness y eigenvector — donde aparecen los nodos invisibles.

### Cómo se cruzan los ejes

Cada nodo identificado en la red se reporta con:
- Tipo de nodo (innovator / early adopter / etc.)
- Score de las 3 centralidades.
- Tipo dominante de tie hacia el resto de la red (fuerte / débil).
- Comunidades que conecta (lista explícita).

Eso da la "arquitectura": no una lista — una topología.

## Fundamentos teóricos

| Teoría                  | Autor                         | Por qué entra al protocolo                                              |
| ----------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Strength of Weak Ties   | Granovetter (1973)            | Insight central: la innovación viaja por ties débiles entre comunidades. |
| Diffusion of Innovations | Rogers (1962)                | Provee la tipología innovator / early adopter / etc.                     |
| Two-Step Flow           | Katz & Lazarsfeld (1955)      | Los opinion leaders median entre medios masivos y la adopción real.     |
| Scale-Free Networks     | Barabási (1999)               | Las redes tienen hubs que concentran flujo desproporcionadamente.       |

## Inputs típicos

**Mínimo viable:**
- Identificación de 3-5 comunidades relevantes alrededor de la categoría (subreddits, foros, comunidades de Discord, grupos de Telegram, listas curadas de cuentas de X/Bluesky).
- 2,000-5,000 piezas de contenido propio + interacciones (comentarios, RTs, citas).
- Window temporal de al menos 6 meses para que las relaciones tengan robustez.

**Ideal:**
- 8-15 comunidades cubriendo el espectro de la categoría (incluyendo comunidades adyacentes y potencialmente disruptivas).
- 12+ meses de window temporal para detectar nodos emergentes.
- Acceso a archivos / podcasts / newsletters donde el discurso es más extenso (un nodo con autoridad estructural a menudo escribe largo, no solo postea).

## Outputs típicos

- **Influence Architecture Map** — visualización de la red completa con centralidades y tipologías.
- **Key Nodes Dossier** — fichas individuales de los 15-30 nodos más relevantes: rol, comunidades que conecta, tono de discurso, riesgos, valor de relación.
- **Activation Strategy** — recomendación de qué nodos activar (y cómo — relación, no transacción), monitorear, o investigar.
- **Early Warning System** — cuáles nodos vigilar para detectar movimientos de categoría antes de que sean visibles en métricas estándar.

## Limitaciones

- **Identifica la estructura, no la activación.** Saber que un nodo es valioso no resuelve cómo construir relación con él. Eso requiere otro tipo de trabajo (relacional, de contenido, de tiempo).
- **Las redes cambian.** El mapa caduca. Re-correr cada 6-12 meses para categorías activas.
- **No mide ROI de activación.** Da prioridades de relación; el ROI requiere atribución conductual posterior.
- **Sensible a la definición inicial de comunidades.** Si el frame inicial deja fuera una comunidad clave, el output queda parcial.

## Lecturas obligatorias

1. Granovetter, M. *The Strength of Weak Ties* (1973) — paper original. Corto y central.
2. Rogers, E. *Diffusion of Innovations* (1962, 5ª ed.) — caps. 1, 5, 7.
3. Katz, E. & Lazarsfeld, P. *Personal Influence* (1955) — caps. 1-3.
4. Barabási, A.-L. *Linked* (2002) — capítulos sobre scale-free networks y hubs.

## Ver también

- Playbook: [`05-ai-playbooks/run-influence-architecture.md`](../05-ai-playbooks/run-influence-architecture.md)
- Casos donde IA es lente principal: anticipación de tendencias, decodificación de crisis, influencia de categoría.
