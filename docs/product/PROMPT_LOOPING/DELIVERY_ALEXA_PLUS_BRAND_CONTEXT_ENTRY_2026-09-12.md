# Entrega focal — entrada semántica de Alexa Plus

Fecha: 2026-09-12T07:31:15Z.

## Resultado de producto

Una marca recién creada ya no necesita saltar a Topics para encontrar controles técnicos de
procesamiento. Brand OS muestra la preparación automática y, cuando falta autorización, presenta
una única acción compacta con el tope económico y la confirmación exacta. Topics vuelve a ser el
catálogo editorial: intereses definidos, descubrimientos, edición, selección y evidencia.

El permiso de ejecución interna es deliberadamente reducido. Sólo `noisia_admin`, `founder` y
`admin` internos, con usuario, organización, marca y workspace activos, pueden autorizar el flujo
compuesto. El contrato anterior de `client_admin` con grant administrativo vigente no cambia. El
navegador no declara tipo de actor, policy, cap ni identidad de autoridad; PostgreSQL resuelve y
bloquea el estado vigente antes de crear admisión, recibo, reserva, ejecución y outbox de forma
atómica.

## Corrección reusable de imports

El mapper de SentiOne dejó de buscar nombres de redes en todos los valores de la fila. Esa conducta
convertía menciones de Reddit o YouTube en X/TikTok cuando el texto o la URL contenían esas cadenas.
Ahora usa primero el campo explícito de plataforma y sólo recurre al hostname exacto o subdominio
de la URL cuando el proveedor entrega una categoría genérica como `Video`. Una query, path o dominio
ajeno no puede nombrar la plataforma.

## Evidencia cerrada

- Replay de las 156 migraciones, incluida SQL0162, sobre PostgreSQL 16 + pgvector en tmpfs: PASS.
- Contrato PostgreSQL compuesto: 5/5 PASS. Incluye operador interno financiero activo, rechazo de
  analyst, usuario suspendido y organización suspendida sin bundles parciales; conserva los casos
  de tenant, grant, concurrencia, rollback, gasto y recuperación de SQL0156.
- DB: 616 pruebas, 522 PASS, 94 skipped, 0 fallos.
- Studio: 1009 pruebas, 1002 PASS, 7 skipped, 0 fallos con `DATABASE_URL` de prueba explícita.
- UI focal de Brand OS y autorización: 61/61 PASS ES/EN; una sola CTA accesible en variante compacta.
- Typecheck DB/Studio, build de Studio y `git diff --check`: PASS.
- Revisión independiente del diff final: P0 0, P1 0, P2 0.
- El contenedor PostgreSQL desechable se retiró después del gate; no se tocó una base persistente.

## UAT y gasto

En este corte aún no se aplicó SQL0162 ni se inició la preparación pagada. Alexa Plus conserva el
estado `awaiting_authorization`, sin imports ni corpus. El siguiente paso es instalar SQL0162 una
sola vez con recibo, entregar el mismo commit a Studio/Worker, comprobar la CTA en UAT y aceptar la
cotización desde Brand OS. Sólo entonces se ejecutan Claude Sonnet 4.6 y Voyage con sus recibos.

No se tocó producción/main, no se usó Opus, no se copiaron datos históricos y no se repitió ningún
SQL0153–0161, import, embedding o fit anterior.
