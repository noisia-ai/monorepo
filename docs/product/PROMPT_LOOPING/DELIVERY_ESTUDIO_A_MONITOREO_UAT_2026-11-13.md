# Estudio A · Restauración de Monitoreo en UAT

Estado: widgets y navegación verificados en UAT; aceptación editorial y repintado inicial pendientes.

La vista nativa llenaba volumen y tópicos sobre una plantilla que dejaba vacíos los demás widgets. Además, la acción de insights dependía de un reporte legado. El corte conecta los widgets existentes a la población nativa autorizada y añade la generación mensual sobre agregados del workspace.

En Conversación, la comprobación real anterior al corte editorial registra 61,975 raíces, 33,076 conversaciones, 26,657 publicaciones y 35,318 comentarios. El sentimiento distingue 8,781 positivos, 22,779 neutrales y 6,795 negativos; las 23,620 raíces restantes no se convierten en neutrales. La fuente no incluye clasificación de emociones.

El corte editorial compara dos ventanas consecutivas de 30 días del mismo segmento, ancladas a la última fecha observada. La vista previa es gratuita. La ejecución confirmada permite una sola llamada física a Claude, con máximo de USD 2, recibo bruto sellado y liquidación persistente antes de validar la interpretación. No envía textos literales de menciones, no añade RAG ni Voyage y no reclasifica el estudio.

PR189 se integró a develop como ef61d9ef después de revisión independiente, CI y PostgreSQL verdes antes y después de la fusión. SQL0294 pasó en la copia privada y en UAT, con catálogo final idéntico, permisos y resultados históricos conservados y repetición sin DDL. Ambos servicios sirven esa revisión con health 200. El recorrido Dashboard → estudio → Monitoreo → Menciones → ficha completó sin recargar.

La revisión operativa anterior a cualquier envío detectó una propuesta de vigencia que habría hecho caducar acciones hermanas; el ajuste conserva exactamente la política activa, incluidos infinito y microsegundos. La revisión visual encontró barras de plataformas invisibles hasta redimensionar: el corte siguiente restaura el repintado completo predeterminado del motor gráfico. Se consignará la aceptación de ambos correctores y el único análisis pagado después de verificarlos.

Los recibos y las muestras ciegas de R15 conservan su entrega y su clave separada. Las capturas, comparaciones de catálogo y recibos de esta reparación se guardan únicamente en el paquete privado.
