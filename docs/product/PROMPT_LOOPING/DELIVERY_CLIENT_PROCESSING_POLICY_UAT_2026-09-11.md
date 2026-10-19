# Entrega UAT — sustrato de procesamiento self-service por organización

Fecha del corte: 2026-09-11 14:52 UTC  
Commit de producto: `485aed831bc5b7212d23383e6f1a5317b50e5ce1`  
Rama focal: `codex/noisia-brand-context-e2e-2026-09-10`  
Rama UAT: `codex/noisia-topic-results-uat-2026-09-06`

## Resultado de producto

El producto ya tiene una autoridad estrecha para solicitar procesamiento sin entregar al cliente las
capacidades internas de soporte. Un `client_admin` activo, de la misma organización y con concesión
administrativa vigente, puede ser reconocido como solicitante. La autorización efectiva requiere una
política activa y una admisión sellada para la acción, ejecución, actor, configuración, vigencia y
tope exactos.

Los topes diarios agregan los tres ledgers monetarios existentes: Claude para Brand Context, Voyage y
Claude para interpretación de Topics. Las reservas se serializan por organización y día. Revocar al
actor o la política antes de un claim, reclaim, renovación de lease o envío impide crear capacidad
nueva; la recuperación de resultados ya pagados permanece disponible.

Datos y Topics cliente incorporan el recorrido `Preparar → Vectores → Analizar`. El lector es de sólo
lectura y muestra estado, máximo de la ruta y saldo diario cuando existe una política. No expone
proveedor, modelo, configuración, digests ni ledgers. En esta fase no ofrece una mutación pagada.

## Despliegue verificado

- SQL0155, SHA-256
  `4e4014f114e862c70059284d9e1bbf2618b67308edd7560fd5baed8879c20ee9`, se aplicó una sola vez en
  UAT a las 14:45:11 UTC. No reaplicar.
- La transacción verificó tres tablas, trece funciones y ausencia de `EXECUTE` para `PUBLIC`. Las
  tablas también revocan acceso a `PUBLIC`, `anon` y `authenticated` cuando esos roles existen.
- La instalación dejó cero políticas, acciones y admisiones: instaló capacidad sin activarla.
- Worker UAT: deployment `32c7e097-7677-439b-8477-8d42941c3d4b`, activo.
- Studio UAT: deployment `6cedd576-1427-4645-91f9-3ec386215a4b`, activo; healthcheck aprobado.
- Ambos servicios ejecutan `485aed8`. El Worker arrancó con cero jobs ejecutables y cero filas
  reclamables.

## Evidencia posterior

Recibo de sólo lectura a las 14:52:32 UTC:

- cero políticas, acciones o admisiones;
- cero ejecuciones de Topics, embeddings u outbox de Brand Context activas;
- cero llamadas Voyage o Claude activas;
- cero filas nuevas en cualquiera de los tres ledgers desde la instalación;
- National conserva dos Topics seleccionados.

La UI UAT conserva 16 archivos, 9,131 filas, 7,396 menciones únicas, 6,826 textos preparados y
20,821 fragmentos con embeddings. Topics conserva 32 elementos de 32/357 grupos interpretados y sus
costos históricos. Signal conserva 6,826 menciones, 98 asociaciones y los dos Topics seleccionados
(35 y 63 menciones).

No se creó otro cliente o marca y no se concedió un rol real. La superficie cliente se validó con
pruebas de componentes y DOM; UAT sólo tenía disponible la sesión interna usada para comprobar que el
recorrido administrativo y National no cambiaron.

## Verificación local

- SQL0155 focal: 29/29 PASS.
- PostgreSQL compuesto: 20 escenarios PASS, 19 estados de los tres ledgers, 13 funciones y 9 casos de
  autoridad para preparación gratuita. Rollback exacto a 269 tablas.
- Base de datos completa: 513 totales, 424 PASS, 89 SKIP, 0 FAIL.
- Studio completo: 948 totales, 941 PASS, 7 SKIP, 0 FAIL.
- TypeScript: 11/11 paquetes PASS.
- ESLint: 11/11 paquetes, 0 errores y 13 advertencias históricas.
- Build de producción de Studio: PASS usando el entorno UAT local para las variables Kinde requeridas
  durante la recolección de páginas.
- Revisión independiente final: 0 P0/P1/P2.

El ensayo principal sostuvo un segundo socket y el advisory lock real, pero no llegó a ejecutar dos
writers monetarios confirmados. El addendum aislado falló en el fixture de creación de marca antes de
los writers; eliminó sus tres bases temporales y dejó intacta la base retenida. Esta limitación no
invalida los 20 escenarios cerrados, pero la concurrencia de dos commits monetarios reales permanece
como prueba pendiente antes de habilitar gasto cliente.

## Siguiente corte

Conectar el paso gratuito `Preparar` al endpoint durable de preparación de corpus que ya existe para
roles cliente autorizados. Después, hacer workspace-scoped el quote de Brand Context y componer las
admisiones de Claude y Voyage antes de la primera llamada. No habilitar proveedores desde una acción
parcial ni reutilizar `can_execute_topics` como permiso cliente.
