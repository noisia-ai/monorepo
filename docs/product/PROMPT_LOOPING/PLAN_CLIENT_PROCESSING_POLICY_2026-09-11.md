# Plan — procesamiento self-service con política de producto

Fecha: 2026-09-11 12:45 UTC  
Precondición: alta, Brand OS e importación cliente entregados; separación working/serving de Topics
cerrada antes de este corte.

## Resultado visible

Un `client_admin` con una política vigente podrá llevar una marca nueva desde archivos recibidos hasta
Topics y Signal mediante un recorrido único: preparar el corpus, crear embeddings, ejecutar el análisis
numérico, interpretar los grupos y seleccionar Topics. La interfaz mostrará el importe máximo de la
ejecución y el saldo diario disponible. Si la política falta, vence o se agota, el cliente conserva la
lectura, la edición y todos los resultados previos.

## Decisión de autoridad

`can_execute_topics` permanece reservado a operación interna. Hoy ese booleano abre rutas de soporte,
recuperación y ejecución demasiado amplias para convertirlo en permiso cliente.

Se añade `can_request_processing`, limitado a un `client_admin` activo, organización activa, marca y
workspace del mismo tenant y grant administrativo vigente. Esta capacidad permite pedir una acción;
la autorización efectiva se decide después con una política relacional exacta. Un flag de entorno sólo
expresa disponibilidad o parada operativa y nunca concede presupuesto.

## SQL0155 — modelo mínimo

### Políticas versionadas

`signal_processing_policy_versions` conserva versiones inmutables por organización:

- organización, versión, estado, vigencia y zona horaria IANA;
- tope diario agregado en micro USD;
- digest de política, creador y timestamps;
- una sola versión activa y aplicable en un instante.

`signal_processing_policy_actions` define por versión cada acción permitida, clase `free` o `provider`,
proveedor, modelo y configuración exactos, tope máximo por ejecución y si puede renovarse de forma
automática.

Acciones iniciales:

- `brand_context_proposal`;
- `topic_prototype_embeddings`;
- `corpus_preparation`;
- `corpus_embeddings`;
- `topic_fit`;
- `topic_interpretation`;
- `topic_fit_incremental`;
- `topic_interpretation_incremental`.

### Recibos de admisión

`signal_processing_admissions` sella organización, workspace, marca, actor, política, acción,
proveedor/modelo/configuración, destino, idempotencia, digest de solicitud, cap de ejecución, fecha
presupuestaria, vigencia y digest del recibo. La admisión y la ejecución/outbox se crean en la misma
transacción.

Las ejecuciones actuales reciben referencias opcionales para preservar su historia. Toda ejecución
self-service nueva debe tener una admisión válida. No se crean admisiones retroactivas.

## Presupuesto agregado

No se crea otro ledger monetario. `signal_processing_org_exposure_v1` agrega por organización, zona
horaria y fecha los ledgers existentes:

- Claude de Brand Context: `signal_semantic_context_budget_reservations`;
- Voyage: `signal_workspace_embedding_calls`;
- Claude de Topics: `engine_cost_events`.

El total incluye confirmado, reservado y ambiguo. `outcome_unknown` y `terminal_confirmed` cuentan una
sola vez; `definitely_not_sent` y reservas liberadas valen cero. Toda reserva y transición previa al
envío toma un advisory lock por `organization_id + budget_date`, con un orden de locks único para evitar
que dos usuarios, workspaces o proveedores excedan el mismo tope.

## Integración con el flujo existente

- Guardar Brand OS y editar Topics sigue siendo gratuito y no necesita política.
- El quote de Brand Context se vuelve workspace-scoped y deriva proveedor, modelo, timezone y caps del
  servidor.
- Preparación, embeddings, full fit e incremental comprueban la acción exacta, el recibo y la vigencia.
- La acción visible `Analizar conversaciones` puede componer `topic_fit` gratuito y
  `topic_interpretation` pagado, pero persiste dos admisiones separadas.
- Los controles especializados de interpretación de SQL0147–0152 consumen la admisión de producto como
  evidencia padre; no se convierten en una segunda autoridad paralela.
- Recuperar un resultado ya pagado no requiere una política nueva. Enviar o reservar otra llamada sí.
- Cada revisión incremental obtiene una admisión propia. La renovación automática sólo opera si la
  acción la permite, la política sigue vigente y queda saldo agregado.

## Contrato de lectura y UI

`GET /api/data-os/signal/:workspaceId/processing-policy` devuelve estado (`ready`, `missing`,
`expired`, `revoked`, `daily_cap_exhausted` o `provider_unavailable`), vigencia, fecha y zona del
presupuesto, exposición agregada y acciones visibles con su tope por ejecución.

El navegador no envía organización, proveedor, modelo, configuración, zona horaria ni tope diario.
Brand OS muestra `Preparando contexto`, `Listo` o una razón de bloqueo. Datos y Topics presentan el
recorrido `Importar → Preparar → Vectores → Analizar`, una sola estimación máxima y el saldo diario.
Los ledgers, retries y controles internos permanecen fuera de la UI cliente.

## Gates obligatorios

- Autoridad: interno, `client_admin`, viewer, usuario/organización/marca/workspace suspendidos, grant
  revocado y tenant ajeno.
- Política: acción, modelo y configuración exactos; vigencia, revocación, solapamiento y replay.
- Concurrencia: dos actores y dos workspaces reservando Voyage/Claude contra el mismo cap organizacional.
- Matriz monetaria completa de los tres ledgers, incluidos estados ambiguos.
- Revocación o expiración entre admisión y envío deja cero llamadas.
- Brand Context compuesto no deja ejecución, outbox ni reserva parcial si falta una acción.
- BERTopic puede completar sin Claude; Signal conserva su última generación servida.
- Incremental sin política vigente no crea un hijo; con `automatic_allowed` crea una admisión nueva.
- Voyage con cap cero sólo continúa con caché verificablemente completa.
- Ensayo SQL0155 en PostgreSQL sintético privado y UI ES/EN; cero identificadores o lógica de National.

## Orden de entrega

1. Política, exposición y admisión SQL con pruebas de concurrencia.
2. Capability/DTO y lector de estado sin habilitar ninguna acción cliente.
3. Preparación gratuita y Brand Context compuesto.
4. Voyage para prototipos/corpus y full fit numérico.
5. Interpretación Claude e incremental con admisiones especializadas enlazadas.
6. Recorrido UI y prueba real con la nueva marca y menciones elegidas por el operador.

No se llama Voyage ni Claude durante la implementación o el rollout de este corte. La primera llamada
real ocurre en el experimento de marca nueva, desde la UI y con política visible vigente.
