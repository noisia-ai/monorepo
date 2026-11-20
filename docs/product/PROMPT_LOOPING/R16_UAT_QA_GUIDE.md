# R16 · Recorrido de QA en UAT

Destino: [Studio UAT](https://studio-uat-uat.up.railway.app/studio).
Este recorrido se ejecuta después del despliegue y la finalización real de R16.
Estado: preparado desde el código; la verificación visual final sigue pendiente.
Los resultados históricos R15 se conservan y no acreditan la corrida R16.

1. **Entrada.** Inicia sesión, abre el Dashboard y entra al workspace de
   Estudio real A (cerveza, Brasil) desde su tarjeta. Abre Monitoreo de marca,
   Menciones y una mención, sin recargar. Volver y avanzar debe conservar el
   workspace y mostrar contenido o un error explícito, nunca un área vacía.
2. **Escucha en Brand OS.** Abre Brand OS y la sección Escucha. Verifica la
   configuración publicada: base voice/promotion, tópicos y preguntas con
   opciones. Apuestas y racismo son configuración del estudio piloto;
   trigger_barrier no debe aparecer como base fija. Revisa que Investigar marca
   siga disponible. No pulses Actualizar Escucha durante esta revisión: inicia
   procesamiento pagado.
3. **Monitoreo.** Vuelve a Signal y usa el periodo completo del corpus y su zona
   horaria. En Preguntas de Escucha cambia Pregunta y Cruzar con tópico.
   Comprueba distribución, tendencia y cruce con tópicos. Activa Ver fuera de
   categoría y comprueba que se distinguen esos tópicos; al desactivarlo deben
   ocultarse. Un periodo sin respuestas debe indicarlo explícitamente.
4. **Tópicos y mención.** Revisa el catálogo publicado, temas y distinción entre
   definidos y descubiertos. Abre una mención etiquetada: debe mostrar la
   probabilidad original de JEV y, cuando exista, la corrección humana por
   separado. Los originales y las traducciones deben ser accesibles.
5. **Estudio T&B.** Desde Marcas abre la marca del piloto, Brand OS y el enlace
   Estudios. Abre el estudio R16 terminado. Comprueba sujeto, metodología,
   versión, corte y corpus compartido. No crees ni inicies otro estudio para
   consultar el resultado existente.
6. **Resultado.** Revisa Resultado direccional, denominador, ejes resueltos,
   competencia y alternativas separadas, ironía, capas, tensiones, sesgo del
   query y estabilidad κ. Recorre Motivos, Tópicos, Canales, Serie y Evidencia,
   incluida su paginación. Cambiar de sección no debe dejar filas anteriores.
   Abre una publicación original y comprueba fecha, red y texto con datos
   personales ocultos. Cero resultados y no estimable son estados explícitos.
7. **Edición posterior, opcional.** Sólo con una corrección real identificada,
   prueba quitar o mover una pertenencia y fusionar tópicos del mismo alcance.
   Comprueba la procedencia humana y la conservación del resultado original.
   Promover seleccionados a Brand OS es una acción explícita; no debe ejecutar
   proveedores ni recalcular menciones. No hace falta editar para consultar.
8. **Idioma y regreso.** Repite navegación y cambio de sección en inglés;
   vuelve al Dashboard y abre otra vez el mismo estudio. Registra versión
   desplegada, fecha, ruta, resultado y cualquier error en el recibo privado de
   QA. No incluyas textos del corpus, nombres privados ni credenciales en issues.

La aceptación técnica, capacidad, muestras ciegas, claves separadas, costos y
SHA256SUMS se comprueban con el ExecPlan y el paquete privado. Este recorrido
visual no los sustituye y no requiere abrir las 22 causas humanas del auditor.
