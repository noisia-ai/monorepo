# Entrega UAT — preparación gratuita del corpus en la superficie cliente

Fecha del corte: 2026-09-11 19:22 UTC
Commit de producto: `276c2f7edfe56904eb7b92859d6d0836486e24ef`
Rama focal: `codex/noisia-brand-context-e2e-2026-09-10`
Rama UAT: `codex/noisia-topic-results-uat-2026-09-06`

## Resultado de producto

El primer paso ejecutable del recorrido cliente ya usa la preparación durable del corpus. Un actor
autorizado para importar menciones puede consultar y solicitar `Preparar` desde Datos; la operación
limpia y normaliza las conversaciones para Topics sin reservar presupuesto, llamar modelos ni exigir
la autoridad interna de ejecución de Topics.

La UI conserva la misma clave idempotente mientras el resultado de una solicitud sea incierto, hace
polling serial sólo mientras existe trabajo activo y descarta de inmediato datos o solicitudes de un
workspace anterior. Los estados distinguen: sin menciones, pendiente, en cola, procesando, preparado,
obsoleto por nuevas menciones, sólo lectura y error recuperable. La política de procesamiento y la
preparación se vuelven a resolver al cambiar de workspace, evitando mostrar presupuesto o estado de
otra marca.

El cliente todavía no puede iniciar Claude o Voyage. `Vectores` y `Analizar` permanecen deshabilitados
hasta que exista una admisión compuesta y verificable para Brand Context.

## Despliegue y QA real

- Studio UAT ejecuta `276c2f7`; deployment
  `cf87d7d1-f466-4f9e-bdc1-fd50ef15c40f`, healthcheck `/api/health` aprobado y réplica anterior
  retirada.
- Worker conserva `485aed8`, deployment `32c7e097-7677-439b-8477-8d42941c3d4b`; este corte no cambia
  el Worker ni la base de datos.
- No se aplicó SQL y no se reejecutó SQL0153, SQL0154 o SQL0155.
- En la ruta cliente real de National, Datos mostró 16 archivos, 9,131 filas, 7,396 menciones únicas,
  6,826 preparadas y 570 excluidas.
- La preparación vigente apareció como `Preparado` con acción de sólo consulta. No se generó una
  preparación duplicada ni se accionó un proveedor.
- `Vectores` y `Analizar` aparecieron como `No habilitado`; la política permaneció `Sin configurar`.
- Las vistas administrativas de Datos y Topics conservaron 6,826/6,826 embeddings, 32 Topics de
  32/357 grupos y los costos históricos mostrados antes del despliegue.

National sólo comprobó compatibilidad y lectura. No se añadió lógica específica para esa marca, no se
creó una marca ficticia y no se importaron menciones nuevas.

## Verificación local

- Pruebas focales de política y preparación: 25/25 PASS.
- Suite Studio completa: 953 totales, 946 PASS, 7 SKIP, 0 FAIL.
- Typecheck Studio: PASS.
- ESLint focal: PASS, cero advertencias.
- Build de producción Studio: PASS.
- `git diff --check`: PASS.
- Revisión independiente: 0 P0/P1; el estado cruzado entre workspaces detectado durante la revisión
  quedó corregido antes del commit.

Queda pendiente una prueba DOM que ejecute con `fetch` real la secuencia 202 → polling → final y las
variantes 409/503 con la misma clave. Los helpers, el contrato HTTP y la superficie completa ya están
cubiertos, y el estado remoto de sólo lectura se comprobó en UAT.

## Siguiente corte

Cerrar el quote workspace-scoped de Brand Context como lectura informativa y después implementar
SQL0156 para admitir Claude y Voyage con CAS de política y fuente, topes exactos y creación atómica de
admisión, ejecución y outbox. La cotización nunca equivale a permiso. Ningún proveedor se activa antes
de que el contrato compuesto y su prueba de concurrencia estén cerrados.
