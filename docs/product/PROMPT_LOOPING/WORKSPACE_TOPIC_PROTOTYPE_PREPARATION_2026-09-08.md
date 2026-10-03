# Preparación de intereses y Brand OS — ejecución focal

Estado: implementación local sobre UAT `919fd3518ed5c8dec8489a3a4c6d20a4fda3085a`. La búsqueda anterior conserva su recibo y sus límites. No hay nuevo despliegue, SQL remoto ni llamadas pagadas en este corte todavía.

## Resultado buscado

Desde Topics, preparar las definiciones y el contexto vigente antes o después de importar menciones. Cotización, tope explícito, progreso y recuperación deben ser operables sin ingeniería para el recorrido normal. No crear otro panel de Brand OS ni exigir ejemplos/rúbricas para cada Topic. Preparar vectores no clasifica, descubre, calibra ni publica Signal.

## Implementación

- Reutilizar `signal_workspace_embedding_runs`, llamadas/reservas, caché física por workspace/perfil/texto, outbox y Worker existentes. SQL0135 distingue `corpus` y `topic_prototypes`; no inventa corpus ni raíces para los intereses.
- El compilador completo conserva roles positivos/negativos y contexto por ámbito; un plan sellado conserva todas las referencias semánticas y deduplica textos idénticos. El mismo texto se paga una vez por perfil completo.
- Una proyección de aliases usa exclusivamente un vector físico respaldado por recibo; los registros legacy no reciben recibos inventados.
- `Topics → preparación` ofrece GET estado, GET cotización y POST con plan/cotización/tope e idempotencia. La API controla permisos y configuración; no recibe perfil, actor ni texto autorizante desde el cliente.
- Caché completa o respuestas ya persistidas pueden recuperarse con proveedor deshabilitado. Texto aún no enviado requiere proveedor habilitado y presupuesto. Un resultado incierto permanece bloqueado, con costo reservado visible; la conciliación integral sigue en NOI-81.
- El Worker valida vigencia de Topics, Brand OS y fuentes de contexto antes de enviar y al confirmar resultados. Una importación de menciones no cambia por sí sola los intereses preparados.
- Fuentes KB en contexto completo deben pertenecer a la marca/organización, estar procesadas y conservar aserciones vigentes. Esto no inventa una licencia de terceros ni un nuevo formulario de derechos.

## Responsables

Root: contrato/plan, management/API, integración, revisión y entrega focal. Backend: SQL0135, ledger por tipo de input, vigencia y aliases. Worker: adaptador de cursor y pruebas PG/BullMQ simuladas. Frontend: controles inline, recuperación, ES/EN y QA local. Los tres contract-drafts ajenos quedan excluidos.

## Pruebas nuevas previstas

Intereses antes del corpus; deduplicación entre roles/Topics; precio/cap; caché sin proveedor; fallo tras respuesta y recuperación sin reenvío; unknown; permisos/contexto retirados; aislamiento de lectores corpus; preparación → búsqueda disponible en fixture local; recuperación UI y responsive. No repetir benchmarks/gates de importación, preparación o búsqueda ya cerrados sin una nueva causa.

## Límites vigentes

National: 16 CSV, 9,131 filas, 6,826 menciones preparadas, 20,821 fragmentos, sin embeddings reales ni intereses creados. No crear fixtures UAT. Pregunta de zona SentiOne ya pendiente: no repetir ni reparar fechas por intuición. Proveedor remoto deshabilitado, máximo USD5; cotización anterior corpus USD8.328543. Saldos producto USD11.362961 y Advisor USD1.343826 intactos. Sin producción/main, datos legacy, limpieza destructiva ni despliegue del repo documental sucio.

NOI-31/78 mantienen clasificación persistente/incremental y descubrimiento completo obligatorios. NOI-19 cliente integral, NOI-80 retención y NOI-81 conciliación permanecen abiertos.
