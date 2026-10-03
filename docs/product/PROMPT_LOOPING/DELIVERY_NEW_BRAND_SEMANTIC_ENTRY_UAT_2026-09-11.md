# Nueva marca → contexto e intereses: entrega UAT

Fecha: 11 septiembre 2026 México / 12 septiembre UTC

Estado: **entregado y comprobado en UAT**.

## Resultado visible

El recorrido reutilizable previo a las menciones reales ya está disponible en UAT:

1. La creación de marca explica el recorrido completo y usa un catálogo IANA buscable para la zona
   horaria. Un cliente no escribe el slug; el servidor lo deriva y limita su acceso a esa marca.
2. Brand OS conserva identidad, competidores y múltiples Knowledge Bases. La preparación gratuita
   del contexto no depende de Claude, Redis o Worker.
3. Para una organización nueva, Studio puede provisionar la política inicial acotada con un creador
   financiero interno configurado. Crear la política no admite trabajos, no encola y no gasta.
4. Claude Sonnet 4.6 y Voyage 4 Large permanecen detrás de cotizaciones y confirmaciones explícitas.
5. Si cambian los intereses después de preparar Brand OS, Topics marca las guías pendientes. El
   refresco conserva historia, exige confirmación y reutiliza embeddings por hash sin repetir Claude.
6. Datos mantiene la navegación Contexto → Topics → Importar. El siguiente dato legítimo del flujo
   es una marca real con menciones cargadas por el operador.

National se usó únicamente como regresión. No recibió código específico, imports, fit ni llamadas.

## Entrega ordenada

- Commit de producto: `5ab45c5a85bce8ac8013cc4b5cbaae12277edfb7`.
- SQL0161: aplicado una sola vez a las `2026-09-12T01:42:19.183Z` con SHA-256
  `e4519724cd7271fff3a85b65ebadfb41b4cbe021e5f646cfcada66ccbfd24bf9`.
- Worker activo: `a4fbe6ed-bc7a-46ae-8a31-2d44c86f0c75`.
- Studio activo: `e8959109-5d5c-4c44-a6a3-bd6a21420f96`.
- Studio confirmó el commit exacto y la configuración server-side con tope diario de USD 30 y
  vencimiento `2026-09-12T14:00:00Z`.

El preflight encontró SQL0161 ausente y cero políticas, acciones, admisiones, trabajos, llamadas
inciertas, outbox o recibos de prototipos. El recibo posterior de `2026-09-12T01:52:32.609Z`
confirmó SQL0161 presente, grants públicos de tablas/funciones en cero y todos esos contadores aún en
cero. Las funciones nuevas sólo conceden ejecución a `postgres` y `service_role`.

## Verificación

Antes de la entrega quedaron cerrados:

- PostgreSQL compuesto SQL0141–0161: 10 casos PASS, incluida recuperación `outcome_unknown`, cero
  transportes y rollback exacto.
- DB: 521 PASS y 93 omitidos; Studio: 1,001 PASS y 7 omitidos; Worker: 564 PASS y 42 omitidos.
- Typecheck DB/Studio/Worker, lint Studio y build de producción PASS.
- Revisión de seguridad y QA humana: **P0 0 / P1 0 / P2 0**.

La QA autenticada comprobó ES/EN y restauró ES al terminar. El selector IANA filtró `Tijuana`,
Brand OS mostró Knowledge Bases ampliables y Topics/Datos/Signal conservaron sus resultados. National
sigue con 32 Topics de 357 grupos interpretados, 7,396 menciones únicas, 16 archivos, 6,826 menciones
preparadas y 142 asociaciones visibles en Signal. No hubo errores de consola en las rutas válidas.

Una consulta artificial `?verify=5ab45c5` en Signal fue rechazada por el allowlist de filtros, como
corresponde. La URL canónica cargó correctamente. La evidencia móvil de este corte proviene de las
pruebas responsive ES/EN; la sesión autenticada produjo captura física desktop.

## Gasto y siguiente corte

Esta entrega realizó **cero llamadas de proveedor y USD 0 de gasto**. No reaplicar SQL0153–0161 ni
repetir imports, Voyage, fit o gates ya cerrados.

El próximo experimento debe crear una marca real y completar Brand OS e intereses. Cuando la UI
requiera el corpus, el operador cargará menciones reales. Después se comprueban, con admisiones
acotadas, embeddings del corpus, full fit, interpretación, selección y Signal; luego una segunda carga
real prueba el ciclo incremental.
