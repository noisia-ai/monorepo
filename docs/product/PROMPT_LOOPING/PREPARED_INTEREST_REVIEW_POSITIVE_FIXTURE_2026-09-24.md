# 24 septiembre: fixture positivo de preparación de intereses — sólo LOCAL

## Resultado y alcance

Se compuso el ensayo positivo que faltaba para SQL0183, conservando Compass e historia.
Esto prepara verificación del vínculo interés explícito → contexto/corpus → revisión versionada.
No es una entrega de clasificación ni de Signal, y no representa una ejecución PostgreSQL aprobada.

Checkout: `/Users/brandhon_o/Downloads/noisia-signal-from-import-2026-09-24`, rama
`codex/noisia-signal-from-import-2026-09-24`, sobre `28db6cc`.
No se modificaron SQL0183, su hash, las migraciones históricas ni el código productivo.

## Composición concreta

- Entrada inventada de una marca de bicicletas, perfil Brand OS canónico y nota de KB.
  Estos registros base no certifican las rutas Studio de creación/edición.
- Runtime y bindings sintéticos explícitos; sin lectura del entorno de proveedores.
  Política inicial mediante el servicio existente, seguida de funciones reales de
  preparación, generación/publicación semántica y prototipos. Respuestas de proveedores simuladas.
- Reutiliza `syntheticClientWorkspaceFixtureV1`: tres raíces inventadas, corpus y recibos
  sintéticos. Dos grupos numéricos de prueba, sin fit real ni afirmación de BERTopic.
- Admisión numérica gratuita mediante control0175, materializadores de censo/comunidades
  y finalización con lease real. Partición singleton explícitamente sintética, sin inventar
  similitudes entre grupos. Lector real de fuente y catálogo; interés manual creado por el store.
- El loader real construye la revisión completa (dos grupos × un interés); SQL0183 deberá
  validarla durante el futuro ensayo. No se fabrican generaciones/publicaciones listas, no
  se reemplazan funciones SQL ni se deshabilitan triggers para hacer pasar los datos.

## Escenarios nuevos escritos, aún NO ejecutados en PostgreSQL

1. Preparar y cargar revisión completa, mismas citas, versiones, grupos y bytes de solicitud.
2. Repetir la misma identidad tras descartar su recibo: una sola preparación. Es replay dentro
   del harness de savepoints, no prueba de commit durable perdido ni caída del proceso.
3. Rechazar matrices con pares ausentes, duplicados, reordenados o ajenos, incluso actualizando
   sus pares de payload y checksums para evitar un rechazo trivial por hash obsoleto.
4. Rechazar UPDATE/DELETE del historial inmutable.
5. Editar la definición por el store real: invalidar lectura/replay anterior, rechazar reutilizar
   la clave con contenido nuevo y admitir una identidad nueva sin cambiar el snapshot anterior.
6. Aislamiento con otros tenants existentes, lector legítimo y revocación del acceso; actor
   suspendido tampoco carga ni repite la preparación.
7. Editar la KB base: invalidar la fuente actual sin reescribir la preparación anterior.
8. Conservar asignaciones y filas históricas completas de políticas/admisiones, owners,
   solicitudes y costos. El baseline se toma DESPUÉS del seed, que sí guarda recibos simulados.

## Runner

Modo nuevo explícito `--positive-preparation`, con aprobación adicional
`NOISIA_INTEREST_PREPARATION_POSITIVE_APPROVED=true` además de la aprobación del preflight.
Conserva guardas privadas, 299 tablas vacías selladas, hash0183 y rechazo antes de DNS si
no hay destino sellado. Ejecuta el preflight antiguo en savepoint y lo revierte antes del
seed positivo. Ocho escenarios previos + ocho nuevos, después rollback físico y lectura
nueva de vacío/fingerprint. Sin cambiar Docker, startCommand, autodeploy ni servicios remotos.

Recibo: `acceptance_scope=positive_preparation_with_savepoint_replay_and_physical_rollback`,
`full_preparation_acceptance=false`. Incluso un futuro PASS no certifica concurrencia,
recuperación tras commit/caída, escala máxima, proveedor real, interfaz ni calidad semántica.

## Validación LOCAL

- Suite DB: 623 PASS, 98 SKIP, cero fallos. Los skips no se contabilizan como PG aprobado.
- Guards compartidos y de preparación: 20 PASS, cero conexiones (incluye rechazo del modo
  positivo con el sello real aún incompleto).
- Typecheck y lint raíz: 11/11; typecheck DB final tras cambios de assertions PASS.
- Revisión independiente focal y del delta final: sin P0/P1/P2 concretos.
- `git diff --check` limpio. No se repiten los gates históricos de producto.

## Bloqueo y siguiente acción

PG privado dev-test sigue bloqueado por autenticación28P01 antes de SQL; credencial vs
encoding no demostrado. No se reintentó conexión, no se cambió contraseña, no se ejecutó
SQL ni se modificó el runner remoto. Sellos system_identifier/schema_sha256 siguen ausentes.
Primero se necesita corregir la conexión; después bootstrap readonly, revisar/sellar identidad
y esquema reales, upgrade vacío explícito si procede y escenarios con rollback.
El gate de seis escenarios de Signal desde importación sigue siendo separado y obligatorio.
No acumular DDL pagada ni anunciar clasificación final antes de esa comprobación.

Admisión/storePG de checkpoints de interest_review, decisión→evidencia→materialización→Signal,
consolidación/ranking e incremental real siguen pendientes. La similitud no aprueba menciones;
`supports` respalda sólo citas, no todas las raíces de un grupo. Queries/reportes agente/MCP
siguen en backlog. Si la conexión no cambia, evitar auditorías o polling repetidos y sólo abrir
otra tarea independiente si existe un gap concreto, reproducible y útil del plan.

UAT conserva la última comprobación a42b9b4/Worker0b68b3e0; no se hizo una nueva lectura remota.
Signal import-only a881d21 permanece LOCAL. Cero proveedores/gasto/imports/fit nuevos.
Linear continúa pendiente de reconexión; no se afirmó actualización. Historia conservada.
