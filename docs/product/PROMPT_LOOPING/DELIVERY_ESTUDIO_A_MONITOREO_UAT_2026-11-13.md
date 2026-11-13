# Estudio A · Restauración de Monitoreo en UAT

Estado: widgets, navegación, repintado inicial y ejecución editorial verificados en UAT; pendiente el corrector de escala al alternar tarjetas mensuales.

La vista nativa llenaba volumen y tópicos sobre una plantilla que dejaba vacíos los demás widgets. Además, la acción de insights dependía de un reporte legado. El corte conecta los widgets existentes a la población nativa autorizada y añade la generación mensual sobre agregados del workspace.

En Conversación, la comprobación real anterior al corte editorial registra 61,975 raíces, 33,076 conversaciones, 26,657 publicaciones y 35,318 comentarios. El sentimiento distingue 8,781 positivos, 22,779 neutrales y 6,795 negativos; las 23,620 raíces restantes no se convierten en neutrales. La fuente no incluye clasificación de emociones.

El corte editorial compara dos ventanas consecutivas de 30 días del mismo segmento, ancladas a la última fecha observada. La vista previa es gratuita. La ejecución confirmada permite una sola llamada física a Claude, con máximo de USD 2, recibo bruto sellado y liquidación persistente antes de validar la interpretación. No envía textos literales de menciones, no añade RAG ni Voyage y no reclasifica el estudio.

PR189 se integró a develop como ef61d9ef después de revisión independiente, CI y PostgreSQL verdes antes y después de la fusión. SQL0294 pasó en la copia privada y en UAT, con catálogo final idéntico, permisos y resultados históricos conservados y repetición sin DDL. Ambos servicios sirven esa revisión con health 200. El recorrido Dashboard → estudio → Monitoreo → Menciones → ficha completó sin recargar.

PR191 se integró como 27b8ab96, con CI y PostgreSQL verdes antes y después. Una visita nueva desde Dashboard mostró las siete barras de plataformas sin resize ni recarga. La política activa conservó su vigencia infinita, sus siete acciones y sus límites; se añadió la acción manual del piloto.

La única llamada real completó cuatro insights en español. Comparó 9,192 menciones del 25 de agosto al 23 de septiembre con 8,516 del 26 de julio al 24 de agosto, en la zona horaria del workspace. Consumió 2,707 tokens de entrada y 1,052 de salida: USD 0.023901 liquidados, frente a una reserva de USD 0.156288 y un límite de USD 2. El asiento tardó 36.5 segundos en completar. No se compraron créditos ni se enviaron textos literales de menciones.

La inspección final encontró que el minigráfico mensual heredaba una escala relativa al volver a volumen. La regresión se reprodujo con React y ECharts reales y se corrige aislando la instancia de cada tarjeta. La prueba en UAT de ese corrector reutilizará el resultado pagado; queda pendiente consignarla, sin otro envío al proveedor.

Los recibos y las muestras ciegas de R15 conservan su entrega y su clave separada. Las capturas, comparaciones de catálogo y recibos de esta reparación se guardan únicamente en el paquete privado.
