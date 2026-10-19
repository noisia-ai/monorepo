# Nueva marca self-service → menciones reales · plan de ejecución · 11 septiembre 2026

## Resultado que buscamos

Un `client_admin` entra a Signal, crea una marca en su propia organización, completa y corrige
Brand OS, agrega las fuentes de conocimiento necesarias, define intereses y llega a una pantalla
de importación funcional. En ese punto el operador puede proporcionar menciones reales para una
prueba completa. National sólo prueba compatibilidad y no condiciona el diseño.

El recorrido posterior conserva el Compass vigente: preparar el corpus completo, ejecutar el
cómputo numérico, interpretar grupos con evidencia, convertirlos en Topics editables, seleccionar
qué vive en Signal y continuar de forma incremental cuando llegan menciones nuevas.

## Corte 1 · Alta y Brand OS propios

- Mostrar la entrada de alta sólo a `client_admin` activo.
- Derivar actor y organización de la sesión y revalidarlos dentro de la transacción.
- Rechazar organización, manager u otra autoridad de tenant enviada por el cliente.
- Crear marca, workspace, contexto/KB inicial y grant del creador de forma atómica.
- Hacer el replay idempotente sólo para el mismo creador, misma organización, mismo contenido y
  grant vigente. El replay no crea ni reactiva grants.
- Permitir lectura y edición de Brand OS únicamente cuando coinciden organización y grant.
- Mantener `can_execute_topics=false`, `can_adopt_topics=false` y todos los gates de proveedor.
- No usar el permiso global `canCreateBrandOrTheme`, porque también gobierna Themes y mutaciones
  administrativas como cambiar una marca de organización.

La sincronización histórica por organización debe dejar de conceder todas las marcas o reactivar
grants revocados en cada login. Un cambio de organización también debe invalidar el alcance de los
grants anteriores en todas las lecturas cliente.

## Corte 2 · Importación realmente utilizable por el cliente

La UI ya recibe `can_import_mentions`, y las rutas de setup e imports están scoped. Sin embargo,
el componente carga el plan de adquisición y las fuentes mediante lectores reservados a internos;
un 403 borra toda la pantalla. El corte debe:

- permitir sólo las lecturas de plan y fuentes necesarias para importar cuando el workspace
  resuelto concede `can_import_mentions`;
- conservar todas las mutaciones de plan, queries, conectores y promoción como internas;
- omitir brief y generación de queries en modo `importsOnly` cuando `canProcess=false`;
- mantener setup, derechos, historial, carga, confirmación y retry scoped al mismo workspace;
- retirar estado y abortar lectores/uploads si el grant se revoca durante la sesión.

## Corte 3 · Procesamiento con presupuesto de producto

No se habilita todavía. Antes de permitir que un cliente ejecute BERTopic, Voyage o Claude hace
falta una política relacional separada de `can_execute_topics`: acciones/modelos permitidos,
topes por ejecución, vigencia y un tope diario agregado por organización. La admisión debe sumar
gasto confirmado, reservado y ambiguo de los ledgers existentes bajo serialización por
organización. Las acciones gratuitas se separan de cualquier envío externo.

## Evidencia mínima antes de UAT

- Matriz de auth y aislamiento para interno, `client_admin`, viewer, suspendido y tenant ajeno.
- PG con rollback para atomicidad, replay, revocación, cambio de organización y censos de costo.
- Componentes reales ES/EN para alta, Brand OS e importación, incluidos estados vacío, carga,
  permiso retirado y error recuperable.
- Typecheck, suites afectadas, lint, build y revisión independiente sin P0/P1/P2.
- Entrega focal del mismo commit a Studio y Worker, migraciones sólo si son imprescindibles y
  comprobadas antes del rollout.
- Recibo UAT posterior con cero proveedores mientras no existan marca y menciones reales del
  nuevo experimento.

## Punto de parada

Cuando el recorrido nuevo llegue a la carga de archivos y requiera la marca/corpus elegidos por el
operador. No se fabrican menciones, no se reutiliza National como si fuera el cliente nuevo y no se
autoriza gasto externo sólo para completar una prueba artificial.
