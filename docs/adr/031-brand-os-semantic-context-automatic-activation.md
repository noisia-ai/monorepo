# ADR 031 · Activación automática del contexto semántico de Brand OS

- Estado: aceptado para el corte UAT del 10 de septiembre de 2026
- Decisión de producto: formulario inicial de Brand OS como confirmación editorial ordinaria
- Relacionado: ADR 015, ADR 023, ADR 025, ADR 030

## Problema

La implementación separó el contexto de marca en una cadena de controles internos:
`acquisition_brief`, borrador, preflight, generación, revisión individual y publicación.
Una marca creada desde Studio no produce por sí sola el contexto que Topics necesita. La UI
puede mostrar cientos de propuestas y obliga a una aprobación masiva que no mejora el
significado cuando la persona ya revisó y guardó Brand OS.

La validación automática existente clasifica elementos válidos y excepciones, pero la
publicación todavía trata cualquier excepción pendiente como bloqueo global. Además,
preparar los embeddings Voyage es una operación manual separada. El resultado es un flujo
técnicamente trazable que no funciona como producto self-service.

## Decisión

El envío de Brand OS crea una autoridad versionada suficiente para generar contexto
semántico. Mercados, idioma primario, variantes y zona horaria se derivan de los campos
guardados cuando no existe un plan de adquisición más específico. Un plan posterior puede
reemplazar esa autoridad mediante el mecanismo de sucesores.

La propuesta de Claude se procesa en dos conjuntos:

- los elementos que pasan validación determinista quedan aprobados y forman una generación
  activa automáticamente;
- los elementos con colisiones, evidencia insuficiente o estructura inválida quedan como
  excepciones editables y no participan en el pack activo.

La presencia de excepciones no bloquea la activación de los elementos válidos. Toda
activación conserva snapshot, linaje del proveedor, decisiones de política y digest del
pack. Editar, borrar o agregar conocimiento crea un sucesor; no modifica la versión activa
anterior.

Después de activar un pack, la orquestación solicita en la cola existente sólo los
prototipos Voyage cuyo digest no está en caché. El navegador observa el estado pero no es el
responsable de avanzar la cadena.

El gasto conserva una admisión explícita y un tope antes de cualquier envío. El formulario
puede registrar esa admisión en la misma acción que guarda Brand OS; no requiere otra
confirmación editorial. Sin admisión vigente, la cadena se detiene en un estado durable y
recuperable anterior al proveedor.

La creación previa al guardado no llama a Claude. Esa superficie todavía no tiene identidad
durable, ledger ni recibo de costo; la propuesta gobernada comienza después del guardado. El
mismo contrato acepta descripción, competidores y todas las fuentes de conocimiento, divide
cada fuente completa en fragmentos acotados y rechaza cualquier exceso en vez de truncarlo.

La fuente automática se actualiza únicamente mientras conserve procedencia automática. Una
edición explícita la convierte en fuente manual y una eliminación permanece eliminada. Las
operaciones de preparación registran el instante real de aceptación para que su lectura sea
determinista incluso cuando varias se crean dentro de una sola transacción.

## Consecuencias

- La creación de una marca puede llegar a Topics sin configurar un formulario técnico
  adicional.
- El usuario corrige unas pocas excepciones en lugar de aprobar todas las propuestas.
- Knowledge Base y Brand OS producen sucesores incrementales con reutilización de caché.
- Topics consume sólo una generación activa y elementos aprobados. Un draft deja de ser una
  autoridad implícita para búsqueda.
- La UI debe separar estado operativo, elementos activos y excepciones; la revisión interna
  exhaustiva puede conservarse como diagnóstico avanzado.
- ADR 015 sigue vigente para linaje, aislamiento de autoridad y evidencia. Su requisito de
  confirmación humana por cada propuesta queda reemplazado por esta decisión para el camino
  ordinario de Brand OS.

## Invariantes

1. Claude no crea métricas ni decide precisión semántica.
2. Voyage sólo codifica textos versionados; no inventa vocabulario.
3. Ningún proveedor se invoca sin tope y admisión persistidos.
4. Los reintentos no duplican llamadas, generaciones ni embeddings.
5. Un cambio de workspace, actor o digest no puede reutilizar una idempotency key ajena.
6. La edición de una excepción nunca reescribe el pack activo.
7. El scoping y la autorización siguen siendo propiedad del servidor y de PostgreSQL.
