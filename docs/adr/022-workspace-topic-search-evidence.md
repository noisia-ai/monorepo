# ADR 022 — Búsqueda de Topics sobre el corpus completo del workspace

Fecha: 8 septiembre 2026. Estado: aceptada para integración UAT; no habilita producción.

## Contexto

El corpus preparado y sus embeddings ya tienen manifiesto completo, derechos vigentes,
revisión de entrada, caché y ejecución recuperable. El clasificador antiguo requiere
un corpus de estudio y recorta texto/contexto. Sus umbrales no están calibrados para
el nuevo perfil de embeddings. Crear un corpus puente o trasladar esos umbrales
presentaría como clasificación una evidencia que todavía no permite afirmarla.

## Decisión

Reutilizar el catálogo de Topics y el ledger de búsquedas de SQL0127. SQL0134 añade
una alternativa de entrada estricta, vinculada al manifiesto y al recibo completo de
embeddings del workspace. El contrato antiguo conserva su entrada y sus lectores;
no puede consumir ejecuciones nuevas por ID. SQL0087 sigue siendo la autoridad de
asignaciones finales. Este corte no escribe pertenencias aprobadas ni generaciones
de Signal.

Un compilador puro conserva definición, inclusiones, ejemplos, exclusiones y Brand
OS completos, con referencias/hashes y roles separados. Fragmenta con la misma
política UTF-16 que el corpus. Cada prototipo exige identidad del texto y perfil
completo; una caché antigua identificada sólo por modelo no es compatible. La
búsqueda consume caché ya preparada: no dispara proveedores para llenar faltantes.

El Worker recorre todas las raíces, todos sus fragmentos y todos los intereses
aplicables. Página de 32 metadatos de Topics, 128 fragmentos y 128 prototipos;
estos tamaños acotan memoria y no son límites de población. Confirma una raíz
atómicamente después de completar todas sus comparaciones. Un lease y la cola
durable existente permiten recuperar interrupciones sin aprobar resultados parciales.

El ranking conserva similitud, contraste negativo en el mismo fragmento y evidencia
de ámbito por separado. Captura de CSV no equivale a identidad semántica. Conserva
hasta 32 candidatos por raíz y registra pares evaluados, retenidos y omitidos. La
lista es recuperación no calibrada: no es el conjunto completo de pertenencias ni
una probabilidad de precisión. Una raíz sin intereses compatibles conserva el motivo
y su necesidad de descubrimiento.

Los extractos se recuperan en PostgreSQL por offsets UTF-16 exactos, sin trasladar
activos completos a Node ni imponer un máximo ficticio de longitud. La lectura
revalida permisos, derechos y revisión; una evidencia obsoleta deja de devolver texto.
La UI usa Buscar y resultados dentro de Topics y mantiene el último resultado
completo durante una nueva ejecución. Ninguna lectura encola trabajo.

## Consecuencias y trabajo obligatorio posterior

La base es reutilizable y evita una segunda autoridad de catálogo o publicación.
Todavía faltan preparación de prototipos con costos/recibos desde producto, calidad
y recall medidos, clasificación persistente, descubrimiento abierto con los métodos
existentes, interpretación Claude, incrementalidad y Signal multiámbito. El costo
computacional de comparar poblaciones grandes necesita medición antes de declarar
capacidad de dos millones de menciones y mil Topics.

Un Topic guiado no excluye una conversación del descubrimiento. La predicción en
clusters existentes tampoco descubre clusters nuevos: el primer release completo
debe procesar las nuevas conversaciones y detectar conversaciones emergentes.

## Aplicación y recuperación

Aplicar SQL0134 de forma transaccional sólo en UAT, antes del nuevo Studio/Worker,
con checksum, verificación de baseline0133, timeouts y comprobación de RLS/triggers.
No convertir ejecuciones históricas. Ante fallo SQL, rollback de la transacción.
Después del commit SQL, recuperar servicio con los HEAD UAT previos y conservar el
esquema aditivo; no hacer down migration ni borrar evidencia. No habilitar proveedores,
flags de publicación o producción como parte de esta entrega.

Evidencia y límites: [plan de ejecución](../product/PROMPT_LOOPING/WORKSPACE_TOPIC_COMPUTATION_EXECUTION_2026-09-08.md).
