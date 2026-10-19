# Entrega UAT — alta de marca y entrada cliente a Brand OS e importación

Fecha del corte: 2026-09-11 11:52 UTC  
Commit: `c1e40d387c4a3679a67ee01060e509e561dcf0b7`  
Rama focal: `codex/noisia-brand-context-e2e-2026-09-10`  
Rama UAT: `codex/noisia-topic-results-uat-2026-09-06`

## Resultado de producto

Un `client_admin` activo ya puede entrar a Signal sin depender de un reporte publicado, ver sólo
las marcas que tiene asignadas y crear una nueva marca dentro de su organización de sesión. La
creación guarda en una transacción la marca, el workspace, el contexto inicial, la Knowledge Base
inicial y la concesión del creador. La repetición idempotente nunca restaura una concesión revocada.

Desde la navegación cliente, Brand OS permite editar la identidad y los límites editables, conservar
y agregar varias Knowledge Bases y gestionar competidores. La organización, el slug y el estado no
son campos mutables para clientes. Cada mutación vuelve a comprobar dentro de la transacción que el
usuario, la organización, el workspace y la concesión siguen vigentes.

Datos acepta la lectura del plan y las fuentes para quien tenga `can_import_mentions`. La vista
cliente conserva la carga CSV, el ámbito, el periodo, la zona horaria y el historial. Oculta la
configuración avanzada, la generación de queries, briefs, referencias, promoción y cualquier control
de ejecución. Los POST de configuración continúan reservados a operación interna.

La sincronización de sesión y organización ya no crea, restaura ni amplía concesiones por pertenecer
a una organización. Los cambios de organización y la suspensión revocan accesos. Ver, editar Topics,
importar, seleccionar Signal y administrar Brand OS permanecen capacidades independientes.

## Despliegue verificado

- Studio UAT: deployment `9c0138cc-bd0a-48a7-8219-a83f7ef8ddcd`, activo.
- Worker UAT: deployment `e408c438-8804-41b8-a524-89dedef366c2`, activo.
- `/api/health`: `status=ok`, `runtimeProfile=uat`.
- No hubo migración. SQL0153 ya estaba aplicado y no se repitió.

## Evidencia funcional

- La alta interna de marca sigue disponible y la zona horaria es un catálogo IANA buscable. El valor
  se envía desde una opción válida y no desde un campo libre.
- La ruta cliente `/signal/brands/new` rechaza correctamente a la sesión interna usada para QA; no se
  creó una marca ficticia. La prueba real queda para una marca y corpus elegidos por el operador.
- National conserva 16 archivos, 9,131 filas recibidas, 7,396 menciones únicas, 6,826 textos
  preparados, 20,821 fragmentos completos y costo Voyage histórico de USD 0.594321.
- National conserva 32 Topics activos de 32/357 grupos interpretados, USD 1.918865 confirmado y USD
  1.6818 reservado. El análisis permanece deshabilitado y no se abrió una ejecución nueva.
- Brand OS de National conserva 20 competidores y una base inicial; la UI permite agregar bases
  adicionales por separado.
- Consulta de solo lectura con corte `2026-09-11 10:50:00+00`: 0 operaciones de preparación, 0
  corridas de contexto semántico, 0 llamadas de embeddings y 0 eventos de interpretación.

## Verificación local

- Studio: 936 pruebas totales, 929 PASS, 7 SKIP, 0 FAIL.
- TypeScript: PASS.
- ESLint: 0 errores; 13 advertencias históricas fuera del corte.
- Build de producción Next.js: PASS.
- Revisión combinada final: 0 P0/P1/P2.

## Límite comprobable y siguiente corte

La lógica y UI cliente están entregadas, pero no se alteró un usuario real para simular el rol ni se
creó una marca desechable. El próximo experimento real empieza cuando el operador elija la marca:
alta por UI → Brand OS → Topics definidos → archivos reales → preparación → descubrimiento e
interpretación autorizados → selección → Signal.

Antes de ese experimento conviene cerrar la edición manual de Topics para clientes como acción
editorial: debe guardar nombre, descripción, ámbito y archivo/restauración sin disparar recomputación,
colas o proveedores. La clasificación semántica seguirá siendo una acción explícita posterior.
