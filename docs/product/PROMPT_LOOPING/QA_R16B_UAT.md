# Guía corta de QA · R16b en UAT

Para revisar en pantalla lo que R16b dejó en UAT. Sólo develop/UAT; nada de esto está en producción.
Marca de prueba: «Estudio real A (cerveza, Brasil)». Necesitas sesión en Studio de UAT con permiso para editar tópicos.

Nada de lo que sigue pide una aprobación intermedia: si algo se queda esperando a una persona, es un fallo.

## 1. Preguntas de la escucha (Brand OS → Tópicos)

1. Baja hasta **«Preguntas de la escucha»**. Debe aparecer la pregunta de prueba con sus cuatro opciones.
2. En **«Actualizar la escucha»** la tabla debe decir 0 pendientes en todas las filas y el mensaje «No hay nada pendiente: todo está respondido».
3. Agrega una opción a la pregunta o una pregunta nueva con **«Agregar pregunta»** y **«Guardar preguntas»**.
   - Esperado: sólo la fila de lo que cambiaste muestra pendientes. Las demás siguen en 0.
4. Opcional (gasta centavos): pon un tope y pulsa **«Preguntar lo pendiente»**. Al terminar, la fila vuelve a 0.

## 2. Reporte genérico en Signal

1. **Signal → Monitoreo**, panel **«Preguntas de la marca»**: elige la pregunta. Debe mostrar la distribución, el cruce con tópicos y la tendencia mensual.
   - Las cifras son de menciones de consumidores que hablan de la categoría (lo dice el pie del panel).
2. **Signal → Tópicos**: arriba aparece **«Mapa de temas»**, el mapa revisado en dos niveles (tema → tópico) con sus menciones.
   - La casilla «Mostrar … fuera de la categoría» está apagada al entrar; al encenderla aparecen los tópicos ocultos.
   - Cada tópico cuenta sólo menciones confirmadas; a su lado, en pequeño, las «probables», que se guardan y no se cuentan.
   - **Menciones sin tópico, en dos niveles.** Una mención de la categoría puede quedar sin ningún tópico confirmado. En el ciclo de prueba es 37 % de la categoría. Cerca de la mitad de ésas sí tiene un tópico probable; el resto no tiene ninguno (17 % de la categoría). Las probables no entran a los totales a propósito: en la evaluación ciega sólo la mitad tenía bien su tópico probable. Que los totales del mapa no sumen toda la categoría es lo esperado.
   - Al cambiar el periodo de la página, los conteos del mapa cambian con él.
   - Lo que la página mostraba antes queda debajo, plegado, como **«Mapa anterior (historia)»**.
3. En Monitoreo ya no hay un panel de mapa aparte.

## 3. Correcciones de una persona (Signal → Tópicos, «Mapa de temas»)

Sólo si tu usuario puede editar tópicos; el nombre del tópico aparece subrayado.

1. Pulsa un tópico: se abren su definición y unas 30 menciones.
2. **«Quitar de este tópico»** en una mención: desaparece de la lista y el conteo baja en 1.
3. Elige otro tópico en la lista y pulsa **«Mover al elegido»**: sale de éste y, al abrir el otro, aparece primero con la nota «agregada por una persona».
4. Elige otro tópico y pulsa **«Fusionar este tópico en el elegido»**: el tópico desaparece del mapa y el elegido suma sus menciones, con la nota «incluye 1 tópico fusionado».
   - Las correcciones no se deshacen desde la pantalla: hazlas sobre tópicos pequeños.
   - Una fusión deja ambos tópicos intocables para el agente en el siguiente ciclo.

## 4. Estudios (Brand OS → Tópicos → «Estudios»)

1. La lista muestra el estudio de Triggers & Barriers con estado «Terminado» y su gasto contra el tope.
2. **«Ver resultado»**:
   - Aviso de **resultado direccional** arriba.
   - Resumen: tamaño del corte, menciones con dirección, con motivo y acuerdo entre las dos lecturas de capa.
   - Las menciones con dirección son las **contadas**: aquéllas donde el clasificador da impulso, freno o ambos con 0.70 o más. El estudio agrupa además otras, entre 0.50 y 0.70, que sólo ayudan a descubrir motivos y no entran a ningún conteo. Es normal que haya motivos chicos y menciones contadas sin motivo.
   - Tabla de capas con su permiso y tabla de motivos con menciones y señales de impulso, freno y tensión.
   - Al abrir un motivo: definición y citas. Cada cita es un fragmento literal de su publicación, con liga, red y fecha, sin nombres de usuario.
3. Marca uno o dos motivos y pulsa **«Pasar … al reporte»**. Esperado: quedan marcados como pasados y aparecen como tópicos definidos de la marca en la sección de ajustes de arriba. No se pregunta nada hasta que alguien actualice la escucha.
4. Crear otro estudio (gasta ≈ USD 2–3): llena el formulario **«Nuevo estudio de Triggers & Barriers»** con tope de al menos USD 6. Avanza solo; la lista cambia de «En cola» a «Trabajando» y a «Terminado».

## 5. Sugerencias del léxico (Brand OS → Tópicos → ajustes del estudio)

1. Pulsa **«Actualizar sugerencias»** (tarda cerca de un minuto en esta marca).
2. Esperado: ya no aparecen palabras vacías («de», «que», «uma») y las primeras son jerga de la categoría, no las palabras más frecuentes.

## 6. Lo que no debe romperse

- **«Investigar marca»** en Brand OS sigue funcionando como antes.
- El resto de Signal no cambió.

## Para quien revisa por terminal

Desde `services/workers`, con las variables de workers de UAT cargadas:

```bash
pnpm tsx scripts/signal-listening-run.ts estimate --workspace <id> --actor <id>
```

```bash
pnpm tsx scripts/signal-listening-run.ts cycle-status --cycle <id>
```

```bash
pnpm tsx scripts/signal-listening-run.ts study-status --study <id>
```

Ninguno gasta ni imprime llaves. Los identificadores están en el archivo privado de progreso, no en el repositorio.
