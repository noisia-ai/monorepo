# Interno · decks para el equipo, no para el cliente

> La familia que el kit no tenía. Un status update, una explicación de cómo operamos, un recorrido
> por lo que hace el producto y en qué estado está. Quien presenta conoce la herramienta; quien
> escucha necesita entender qué existe, cómo funciona y qué falta.
>
> El diseño es el mismo del kit. **La voz, la estructura y la portada no.** Varias de las reglas más
> fuertes del kit están pensadas para un entregable de cliente y en un deck interno son
> exactamente lo que no se debe hacer. Este archivo dice cuáles.

## 1. Por qué existe este archivo

La primera vez que se pidió un deck interno, el agente siguió el kit al pie de la letra y salió mal
por eso: títulos que vendían una conclusión, una portada con ilustración, eyebrow y subtítulo,
encuadres comerciales, y hasta el cuestionario de ocho preguntas del prompt de arranque, que es
para reportes y estudios. Hicieron falta tres horas de corrección para algo apenas funcional. El
kit no se equivocó en lo que dice; le faltaba decir que eso no aplica aquí.

## 2. Lo que cambia y lo que se queda

| | Entregable de cliente | Deck interno |
|---|---|---|
| Título de slide | Afirma el hallazgo | **Nombra el tema**, llano: "Operación actual", "Brand OS", "Qué falta" |
| Portada | Pregunta, ilustración, eyebrow, subtítulo, meta | **Solo el título.** "Status update". Nada más, sin ilustración |
| Voz | Noisia le habla al cliente | El equipo se habla a sí mismo, directo. Nada que venda, justifique o impresione |
| Largo | 9 a 18 slides | Las que haga falta para entender. "No importa si son cien, pero bien hechas" |
| Prompt de arranque | Las ocho preguntas de entregable | **No se corren.** Esto no es un estudio |
| Evidencia | Verbatims con liga | Código, recibos de UAT, especificaciones y capturas, cada uno con su estado |
| Metodología | Se explica antes de usarse | Igual, y además cada tecnología se explica por lo que hace |

**Lo que se queda, sin excepción:** el engine y sus componentes, las cards del kit, cero bordes
verticales de acento, cero gradientes en lo que codifica un valor, iconos reales, el footer, cero
em dash, y mirar cada slide renderizada antes de decir que quedó. Un deck interno no es un borrador.
Se compara contra las mejores presentaciones de cliente en calidad visual, no en tono.

**Frases que delatan el tono equivocado:** "una explicación completa para el equipo", "lo que
hacemos hoy y por qué podemos confiar", cualquier subtítulo que defienda a Noisia, cualquier
título que suene a titular.

## 3. Antes de la primera slide, el mapa narrativo

Se escribe en texto y se aprueba antes de construir nada:

1. **Los universos, separados desde el índice.** Típicamente dos: lo que operamos hoy (reportes y
   estudios hechos con Claude, archivos, scripts y método) y el producto en desarrollo. Cada uno
   conserva su identidad durante todo el recorrido. Si el equipo tiene que preguntar de cuál de los
   dos se está hablando, el deck falló.
2. **Cómo se conectan.** Separar y conectar son dos necesidades distintas. Cuando los dos universos
   ya están separados, todavía hay que explicar qué pieza los une y qué le falta.
3. **La lista de funciones que no pueden quedar sin explicar.** Si una función aparece solo como
   nombre o etiqueta, falta trabajo.

## 4. Cada función se explica completa

Para cada función, el equipo tiene que poder contestar:

- Para qué sirve y quién la usa.
- Qué recibe.
- Qué proceso ocurre y qué componente lo hace.
- Qué resultado deja y dónde se consulta.
- Qué funciona hoy, qué está solo diseñado y qué falta aceptar.
- Cómo alimenta el siguiente paso.

Es un criterio de cobertura, no seis párrafos por slide. Una función puede necesitar varias
láminas, con una idea por lámina. **Repartir la complejidad en una secuencia**, nunca esconderla en
una slide saturada ni cortarla para que el deck se vea corto. Y el mismo rigor para todas: dar
profundidad a una tecnología y dejar las demás como nombres sueltos es lo primero que se nota.

## 5. Cuatro estados, que nunca se mezclan

| Estado | Qué lo prueba |
|---|---|
| **Existe en código** | Está en la rama y corre |
| **Comprobado en UAT** | Hay un recibo de aceptación |
| **Diseñado** | Hay un documento o una especificación, y nada más |
| **Pendiente** | Falta, y se dice qué falta |

Un enum, una tabla genérica o un documento de arquitectura **no prueban que algo funciona**. Una
prueba local no es aceptación de producto. Si el diagrama dibuja algo diseñado, el nodo va punteado
y lo dice. Nada de barras de "porcentaje completado": se usa una tabla con el estado de cada pieza.

Lo que se comunica es el estado y su consecuencia para quien usa el producto, no la localización
técnica exacta del problema. **Se diagnostica la rama**, no se repite el roadmap como si fuera
entrega.

## 6. Cada tecnología se explica por lo que hace

Nombrar no es explicar. "Embedding" no le dice nada al equipo; "Voyage convierte cada mención en un
vector, una lista de números que permite medir qué tan parecidas son dos menciones" sí. El mismo
cuidado con BERTopic, UMAP, HDBSCAN, Claude, Message Batches, Redis, los workers, la persistencia,
la clasificación y la consolidación: qué hace cada uno, y sin atribuirle a uno lo que hace otro.

**Un logo no explica nada, y tampoco acredita una integración.** Va solo si es real y está atado a
una función. Nunca por parecido de nombre: el worker de Noisia no es Cloudflare Workers.

## 7. Diagramas

Llamar diagrama a una sucesión de cajas no basta.

- Cada flecha representa una relación real, y dice cuál.
- Las entradas y las salidas de cada nodo están nombradas.
- El orden de lectura no depende de que el presentador lo adivine.
- Se revisa el significado y la composición **antes** de pulirlo. Pulir un diagrama que no explica
  solo produce un diagrama que no explica más bonito.
- Cuando una abstracción no se entiende, se cambia por **un ejemplo concreto**: una mención que
  muestre las dos clasificaciones vale más que un esquema de ejes.

Se revisan con la vista, renderizados. Ni la inspección del HTML ni la prueba de desborde dicen si
un diagrama se entiende.

## 8. Ejemplos y capturas

**Los ejemplos inventados dicen "simulado" o "ilustrativo", visible.** Nunca pueden parecer
verbatims reales ni salida de un modelo. Y cada ejemplo enseña una decisión concreta, normalización,
similitud, pertenencia a un interés, ruido, evidencia insuficiente, segunda carga, no decora una
definición.

**Una marca de prueba no es la estructura del deck.** Las capturas pueden mostrarla, pero el relato
explica un recorrido repetible para cualquier marca.

**Las capturas son reales y recortadas.** La parte relevante, proporción consistente, explicación
al lado, y la original guardada y accesible. Una pantalla completa ocupando toda la lámina se ve
tosca y no enseña. Nunca se inventa una interfaz para sustituir la evidencia.

## 9. Navegación y tipografía

En un deck largo, una **guía compacta de capítulos arriba** que marca dónde va el recorrido. Es
navegación, no una barra de avance, y cada universo tiene sus propias etapas. Orienta sin competir
con el contenido.

**Máximo tres tamaños de texto en todo el deck.** Los valores los decide cada deck; lo que se
respeta es el número.

Las slides ayudan a explicar a quien presenta: procesos, ejemplos, diagramas y capturas. El detalle
y las fuentes viven en el guion. Ni láminas vacías ni bloques de prosa.

## 10. Cuando el feedback dice "rehazla entera"

Se reconsidera la estructura y el diseño del conjunto, no solo las slides que se citaron. Corregir
la pieza que recibió la última crítica deja el problema global igual, y obliga a quien revisa a
repetir las mismas observaciones en cada ronda.

Un cambio global, tipografía, la guía de capítulos, el footer, afecta todas las slides. Se miran
todas, y las más densas una por una.

## 11. Antes de entregar

| Pregunta | Señal de que falta trabajo |
|---|---|
| ¿Se entiende de inmediato de qué universo se habla? | Hay que aclararlo de palabra en cada slide |
| ¿Cada etapa conecta con la siguiente? | Funciones aisladas, o saltos que quien presenta reconstruye |
| ¿Se explica qué hace cada tecnología? | Solo hay nombres, siglas o logos |
| ¿El diagrama se sigue sin adivinar? | Flechas ambiguas, cajas sin entradas ni salidas |
| ¿Se distingue qué existe y qué falta? | Un plan parece capacidad entregada |
| ¿Los ejemplos enseñan una diferencia? | Repiten la definición, o parecen datos reales |
| ¿Las capturas se entienden? | Gigantes, con ruido, o recortan lo que importa |
| ¿El tono es interno y directo? | Un título vende, justifica o impresiona |
| ¿HTML, PDF y guion son la misma versión? | Uno de los tres va atrás |
| ¿Se revisó el deck entero? | La confianza viene de que compiló, no de haberlo visto |

## 12. Estado de esta familia

Las reglas de este archivo salieron de un caso que costó tres horas de corrección y cuyo resultado
no quedó como referencia. **Todavía no hay un deck interno aprobado**, así que no hay componentes
promovidos al engine para esta familia: el CSS de ese caso no se subió. Cuando un deck interno pase
revisión, sus estructuras de diagrama, la guía de capítulos y el marco de capturas se promueven con
el ciclo de `AGENTS.md`, igual que pasó con las de reportes y estudios.
