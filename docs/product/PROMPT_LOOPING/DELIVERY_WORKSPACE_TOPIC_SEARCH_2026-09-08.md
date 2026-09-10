# Búsqueda de Topics sobre el workspace — 8 septiembre 2026

Estado: **entregado y comprobado en UAT**. Studio y Worker ejecutan
`919fd3518ed5c8dec8489a3a4c6d20a4fda3085a`; ambos recibos de consola confirman
entorno `uat` y proveedor deshabilitado. SQL0134 aplicado/verificado el
8 septiembre a las 13:58:14.664Z: cuatro tablas RLS, cuatro triggers, Unicode
exacto y todas las ejecuciones anteriores conservadas como legacy.

Studio deployment `01b5253c-82d8-45c5-ab7e-3de864a9fe75`; Worker deployment
`3a9f9fdb-3955-4e5d-a4e5-59104d3ba152`. Push focal a
`codex/noisia-topic-results-uat-2026-09-06`, sin main ni despliegue del repo
documental. Sólo quedan los tres contract-drafts ajenos como cambios sin commit.

QA real UAT: GET de National `/topics/computation` HTTP200, contrato workspace,
`missing_embeddings`, ninguna ejecución/resultados; UI reconoce catálogo vacío.
Abrir/cancelar Crear tópico funciona sin persistir datos y consola sin errores.
Se verificó el estado real disponible; los escenarios con resultados son la prueba
local de componente/PG, no resultados generados para National.

## Resultado

Buscar en Topics consume la preparación y embeddings completos del workspace,
con intereses y Brand OS compilados sin los recortes del flujo antiguo. Reutiliza
catálogo, ledger y cola existentes. Todos los fragmentos y todos los intereses
compatibles participan; los resultados muestran el fragmento verificable y la
vigencia de la ejecución. Recupera una interrupción sin perder raíces confirmadas.

Esta entrega genera una lista por afinidad **no calibrada** de hasta 32 candidatos
por mención. Registra el número de pares evaluados, retenidos y omitidos. No son
todas las pertenencias semánticas ni una aprobación. No clasifica definitivamente,
descubre clusters, llama a Claude o publica Signal. El alcance completo del Compass
y NOI-31/78 permanece abierto.

## Verificación concreta

- Root typecheck y lint: 11/11 tareas; 15 warnings anteriores, cero errores/nuevos.
- Query Engine: 412 pruebas pasan. DB: 231 pasan / 43 PG opt-in omitidas en el
  comando general; el nuevo recorrido PG sí se ejecutó separadamente.
- Studio: 642 pasan / 5 integraciones opt-in omitidas. Build de Studio verde.
- Worker: 251 pasan / 3 opt-in omitidas; corrección focal de errores seguros 11/11.
- PostgreSQL real: 4/4 sin omisiones, cobertura/snapshot, lease, autoridad,
  perfiles incompatibles, replay, contexto y fragmentos Unicode. Una quinta
  regresión PG focal pasó después: reader/replay/correction legacy rechazados y
  cliente autorizado edita/archiva después de un ready nativo, sin ejecución nueva.
  Typecheck root 11/11 repetido sólo tras esas correcciones finales.
- PostgreSQL + BullMQ: 3 menciones, 133 fragmentos y 67 Topics por mención;
  201 pares evaluados, 96 retenidos y 105 omitidos de la lista. Una mención de 131
  fragmentos devuelve evidencia del índice 130. Interrupción tras una raíz,
  recuperación y job duplicado comprobados. No es benchmark de 2 millones.
- Servicio Studio y PG: respuesta perdida/fallo, GET sin encolar, POST con misma
  clave conserva ejecución/cursor y evita duplicados; resultado anterior visible.
  Usuario viewer sólo lee, workspace ajeno rechazado, revocación durante lectura
  devuelve cero extractos. Timestamp real aceptado por el control de orden de respuestas de la UI.
- Extracto Unicode: activo de 17,827,615 bytes generado dentro de SQL, respuesta de
  1,819 bytes/hash exacto en 831 ms local. No se trasladó el activo entero a Node.
- UI: 24 pruebas focales y 16 escenarios de navegador sobre componente real con
  transporte simulado, ES escritorio/EN móvil390, sin overflow ni errores consola.

Toda evidencia sintética permanece local. Dos transportes fake prepararon una
fixture inicial; la regeneración final reutilizó toda la caché sin llamadas fake
ni reales. Cero llamadas pagadas en el corte.

## Implementación y revisión

SQL0134 extiende la alternativa de entrada del ledger0127; no crea una autoridad
paralela ni modifica SQL0087. Perfil completo requerido para prototipos nuevos,
sin reutilizar los antiguos por coincidencia del nombre del modelo. Worker procesa
páginas acotadas de raíces/fragmentos/metadatos/prototipos. Evidencia y ejecuciones
listas inmutables; permisos, revisión y derechos se vuelven a comprobar al leer.

La revisión independiente corrigió campos extra en referencias de fragmentos,
lectura arbitrariamente limitada a 16 MiB, recuperación explícita de failed,
errores crudos en BullMQ, cruce del reader legacy por ID y bloqueo de edición tras
ready workspace. No introducir fallback pagado o aprobación por estas correcciones.

SQL final SHA256:
`de35f212e664310c67324d36c4ed03b4b17bd8d6f1bdbfce7cf3ea4bfca0490f`.
Rehearsal local honesto: SQL completo anterior al helper aplicado en DB aislada;
delta exacto del helper aplicado luego en esa DB y la fixture PG, con recibos.

## Próximo resultado necesario

Preparar los prototipos faltantes desde el producto con el mismo control de costo,
caché y recibos que el corpus. La búsqueda actual rechaza ese faltante y no ofrece
una acción ficticia ni llama a proveedor silenciosamente. Después conectar
clasificación persistente, descubrimiento abierto usando BERTopic y los otros
métodos existentes, Claude con evidencia y asignaciones versionadas hacia Signal.

El descubrimiento debe cubrir también conversaciones con candidatos guiados y
detectar nuevos clusters en importaciones posteriores. Persistir sólo una predicción
en clusters existentes no cumple incrementalidad. Escala y calidad requieren
medición; no se resuelven con una rúbrica manual obligatoria por Topic.

National conserva 16 CSV/9,131 filas y preparación de 6,826 menciones/20,821
fragmentos. Su catálogo real de Topics está vacío; no crear intereses ficticios
sólo para simular QA. El proveedor sigue deshabilitado; cotización anterior USD8.328543
frente al máximo USD5, sin cambiarlo. La pregunta de zona SentiOne ya está pendiente;
no repetirla ni reparar/analizar fechas por intuición. Producto USD11.362961 y
Advisor USD1.343826 intactos. NOI-81 costos/unknown/prototipos, NOI-19 cliente
integral y NOI-80 retención física continúan abiertos.

## Evidencia local

- Producto focal `.data/workspace-topic-computation-2026-09-08/`: backend-contract,
  worker-contract, independent-review-final, logs/checks, recibos PG/BullMQ/retry.
- Repo documental `.data/workspace-topic-search-ui-2026-09-08/`: FRONTEND_HANDOFF,
  browser-pass.json, es-desktop.png y en-mobile.png.
- [Decisión estructural](../../adr/022-workspace-topic-search-evidence.md) y
  [secuencia completa](./WORKSPACE_TOPIC_COMPUTATION_EXECUTION_2026-09-08.md).

Preservar los tres archivos ajenos de contract-drafts y el repositorio documental
sucio; no desplegarlo. No producción, Laika/Alexa, nuevos fixtures UAT, secretos
históricos o limpieza destructiva. El canon y los recibos anteriores se conservan.
