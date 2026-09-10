# Integración de cálculo, interpretación y Topics — 8 septiembre 2026

Trabajo activo sobre `5f5ca24`, todavía local. UAT conserva `ae3e36c` y SQL0135. Voyage del corpus ya completo: 6,826 menciones/20,821 fragmentos, USD0.594321; no repetir. Esta nota amplía el Compass y los recibos anteriores.

## Resultado que se está implementando

La misma ejecución conserva el cálculo completo y continúa con Claude, propone un Topic editable por grupo y permite revisar todos los resultados en Topics. El cálculo usa cada fragmento; la interpretación usa representantes trazables de cada grupo, incluidos ejemplos con menor afiliación. No se llama a esos ejemplos una prueba de precisión. Los grupos sin evidencia suficiente se conservan como tales. Después se conecta clasificación persistente y selección explícita para Signal: ese extremo aún no está terminado.

Los intereses manuales guían futuros análisis. Los Topics descubiertos no se convierten automáticamente en nuevas guías: el editor ofrece esa elección. Scope all_conversations no inventa atribución de marca/competidor/categoría. Un nuevo catálogo de resultados no invalida por sí mismo el análisis que lo creó: vigencia depende de entradas semánticas, no de UUIDs regenerados.

## Responsables y límites

- Root: selector de intereses, materialización atómica en catálogo existente y orquestación Worker; única persona agente con llamadas/config remotas.
- Backend: checkpoint de cálculo, ledger durante interpretación, cobertura completa, recuperación y SQL0139 aditivo, sólo local.
- Frontend: mismo editor para Topics descubiertos, origen, alcance y opción de guiar análisis, ES/EN.
- Runtime: contrato de interpretación y transporte Anthropic sin pagos ni reintentos automáticos.

Cada unidad se identifica lane:stable_cluster_id. El digest del universo ordena unidades por C/ASCII y SHA256 de JSON(unit_key)+salto de línea. Membresía completa determina el digest de grupo. Cada respuesta cruda se guarda antes de parseo; costo se concilia con uso del proveedor aunque la salida sea inválida. No reenviar una llamada de resultado incierto. Materialización crea una sola versión de catálogo, preserva ediciones humanas y nunca sigue/publica por sí sola.

## Verificación pendiente

Pruebas locales de proveedor simulado con respuesta válida, evidencia inválida, fallo tras respuesta y recuperación sin segundo envío; checkpoint de grupos completo; catálogo conserva intereses y ediciones; misma UI edita resultados. Luego clasificación/selección/Signal, build y revisión focal antes del corte UAT. No desplegar desde el repo documental sucio ni tocar los tres contract-drafts ajenos.

## Autorización y continuidad

Voyage necesario sin límite impuesto por operador. Claude hasta USD30 el 8 septiembre America/Mexico_City, gasto nuevo todavía0. Advisor dedicado no configurado; no usar claves históricas ni sustituirlo por la clave de producto. No producción, fixtures UAT, Laika/Alexa ni reimportaciones. Mantener recibos anteriores y tickets NOI-31/78 abiertos hasta el recorrido comprobado.
