> Aceptación UAT:9f5bc83 ambas apps, SQL0141 comprobado. Dispatch4 preservó recibooriginal y envió1repair; timeout120s dejóUSD1.6818incierto sinrespuesta. ConfirmadoUSD0.147415; sincatálogo/Signal. Ver recibo unknown posterior.

> SQL0141 UAT aplicado02:23:51UTC y verificado02:24:19UTC. Cuerpo/índice/trigger/permisos comprobados; ledger y guard previo intactos. Runtime9f5bc83 enviado a despliegue; aceptación real pendiente.

# Reparación editorial acotada sobre el mismo análisis

Fecha operativa: 8 septiembre 2026, America/Mexico_City. Base: 19992de.

## Hallazgo real

UAT restauró los 357 grupos de la misma ejecución `4c55af5c-e17f-430a-b17d-6771e94bd30e`: 180 abiertos y 177 guiados, con 15 artefactos numéricos y todas las 6826 raíces/20821 partes. El primer recibo de Claude Opus5 fue HTTP200/end_turn, 28718 tokens de entrada y153 de salida: USD0.147415 liquidado, sin reservas ni incertidumbre. La respuesta contenía una cita literal `x`, nombre y definición nulos con estado coherent. El rechazo local era correcto; el producto carecía de una corrección editorial que reutilizara el trabajo numérico.

El recibo original privado permanece inmutable (SHA `7412d60264f740ff9319f99ac6fc9331f9cbb1f6405c94734887f2c9c4167c45`). No se vuelve a enviar esa solicitud ni se convierte su salida inválida en un Topic.

## Cambio

Cada lote admite una sola reparación editorial lógica. Es una nueva solicitud determinista con el paquete original completo, una instrucción fija de corrección y metadata sellada que identifica solicitud y respuesta anteriores. Conserva modelo, precios, configuración y cap originales. El protocolo adicional tiene su propio digest; el transporte reconstruye la petición exacta antes de autorizar el envío. La reserva incluye todos los bytes adicionales. Las mismas reglas de identidad, cobertura y citas validan el resultado.

SQL0141 añade un índice y un trigger al ledger existente; no crea otra cola o motor. La fuente debe pertenecer al mismo actor/workspace/ejecución/configuración y tener respuesta completa HTTP200, liquidada y aún no materializada. El índice permite una única reparación raíz. Sólo los intentos probadamente no enviados pueden tener sucesor de transporte. Un resultado incierto no habilita una reparación. El costo original y el de corrección se suman en los límites existentes.

El Worker recupera ambos recibos después de una caída y no recursa si la corrección también falla. La propuesta corregida vincula su nuevo recibo; el writer reconstruye el nuevo digest y verifica la fuente antes de crear el catálogo. El bundle numérico se conserva. No se repiten imports, embeddings ni Python.

La UI reutiliza Reanudar análisis con elegibilidad calculada por el servidor. Distingue respuesta inválida y reparación agotada, conserva los costos y no permite eludir un fallo vigente iniciando otro análisis en otra sesión. Una respuesta GET confirmada, con inputs realmente desactualizados y sin resultado incierto, puede liberar sólo la intención local y permitir el siguiente análisis.

## Límites y aceptación

No se inventan Topics, citas, estados insufficient ni precisión semántica. Si la corrección también es inválida, el proceso conserva el fallo explícito y deja de gastar. La publicación parcial con excepciones editoriales agotadas continúa siendo una brecha del lanzamiento self-service: este corte no la da por resuelta ni convierte un catálogo incompleto en completo.

SQL y aceptación UAT pendientes al redactar este recibo. Los resultados finales de pruebas/despliegue se añaden al cierre. Claude gastado al inicio: USD0.147415 de USD30 autorizados sólo para8sept México; Voyage total USD0.594449. No producción ni cambios ajenos al corte.

## Cierre local

Typecheck y lint raíz: 11/11 tareas correctas. Suites: Shared 437 PASS; DB 231 PASS/66 SKIP; Studio 710 PASS/6 SKIP; Worker 323 PASS/5 SKIP. Pruebas focales: shared8, transporte10, Worker compuesto19, Studio30. PostgreSQL: ledger/SQL0141 1 PASS y writer 2 PASS (ruta original y reparación), con ROLLBACK exterior y proveedores deshabilitados.

La prueba writer materializa el catálogo, rechaza fuente/cuerpo falsificados y recupera la misma salida tras perder ACK; contabiliza ambos recibos. La prueba ledger incluye una fuente con representación UUID de distinta capitalización para impedir duplicar reparaciones. Revisiones cruzadas de backend/transporte/writer y de UI cerradas sin P0/P1/P2.

SQL0141 SHA256: `b7ccacaf456293cbc4f3af08a195c48beafcc9a98dbff2da81ac8c5d41d99d80`. El cierre PostgreSQL probó esta versión final del trigger/índice; el writer probó la integración sin realizar cómputo ni llamadas reales. Tres archivos contract-drafts ajenos conservan SHA y se excluyen del corte.
