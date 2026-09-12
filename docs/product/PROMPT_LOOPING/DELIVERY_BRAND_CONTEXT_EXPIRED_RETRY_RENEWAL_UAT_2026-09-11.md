# Brand Context: renovación segura de preparación vencida · UAT 11 septiembre 2026

## Resultado de producto

Brand OS ya puede recuperar de forma autoservicio una preparación semántica cuyo permiso venció
cuando Claude nunca recibió la solicitud. La renovación es una decisión explícita del usuario sobre
el mismo trabajo: conserva la ejecución, el recibo compuesto, la admisión, la reserva, la
configuración y la fuente originales. No crea una segunda llamada ni otro dueño de presupuesto.

El navegador sólo recibe la siguiente acción permitida y una referencia opaca. El servidor vuelve a
comprobar actor, workspace, fuente, política, configuración, tope y ledger dentro de la transacción.
Una llamada pagada, incierta o ya enviada nunca entra por esta recuperación. Las recargas continúan
observando la misma operación con polling acotado hasta estado terminal o una nueva decisión.

## Validación local cerrada

- Corte de producto `ce5f0c1`; marcador Studio `7ad767e`.
- SQL0160 exacto:
  `4e7596e3fd3a62eeecf81b8637bcb9d5ba072d6e34f78b46a23d8ce452073592`.
- PostgreSQL sintético v2: 11 grupos PASS en ~11.45 s. Incluye expiración real, replay,
  `definitely_not_sent`, respuesta simulada, rollback diferido, RLS/ACL y límite combinado de una
  renovación + siete retries. Conservó las 269 tablas y eliminó la base temporal. Cero conexiones o
  proveedores remotos. Recibo:
  `.data/brand-context-semantic-renewal-2026-09-11/RECEIPT-v2.md`.
- Interfaz y focales: 33/33 PASS. Studio completo: 985 aprobadas, 7 omitidas, 0 fallidas;
  typecheck, lint y build de producción PASS. DB focal: 28/28 y typecheck PASS. Worker completo y
  typecheck PASS.
- Polling: 4/8/16/30/60 segundos y después 60 segundos mientras el trabajo siga activo; GET no
  dispara POST y `sessionStorage` conserva sólo workspace y tiempo observado.
- Revisión de seguridad: cero P0/P1/P2 que bloqueen UAT. Antes de producción queda una prueba física
  de concurrencia con dos sesiones y cruce real de medianoche presupuestaria.

## Entrega UAT

Entrega cerrada en orden DB → Worker → Studio, con proveedores inactivos:

- Preflight `2026-09-12T00:21:32.758035Z`: SQL0160 ausente; cero políticas activas, admisiones,
  ejecuciones semánticas o de embeddings activas/inciertas y outbox activo.
- SQL0160 aplicado una sola vez a las `2026-09-12T00:29:22.397Z`, después de verificar 30,496 bytes
  y el SHA exacto. RLS quedó activo y la tabla no tiene privilegios de roles públicos o cliente. No
  se reaplica SQL0159 ni migraciones anteriores.
- Worker `c4086604-2dac-4160-b2fc-bef373c3a580` quedó activo sobre `ce5f0c1`; el log de arranque
  confirma que el motor permanece deshabilitado y no consumió trabajos.
- Studio `b7a7885b-889b-4162-9e25-ca2b9184e728` quedó activo sobre el marcador `7ad767e`; la
  réplica anterior fue retirada y el autodeploy quedó restaurado.
- Recibo posterior `2026-09-12T00:40:20.693853Z`: SQL0160 presente, RLS activo, cero privilegios
  públicos de tabla o funciones, cero renovaciones, políticas, acciones, admisiones, ejecuciones
  activas o inciertas, embeddings activos o inciertos y outbox activo.

QA real autenticado comprobó Brand OS, Topics y Signal con sus URL de producto. Brand OS conserva
identidad, zona horaria seleccionable, 20 competidores y una base automática con capacidad de agregar
más; como no hay permiso efectivo muestra `Acceso requerido` y no ofrece una acción falsa. Topics
conserva 32 definiciones editables de 357 grupos, costos históricos y estado parcial. Signal carga el
resumen vigente con 6,826 menciones del periodo y 142 asociaciones visibles en Topics seleccionados.
No se cambió la selección, no se importaron datos y no hubo llamadas a Claude o Voyage.

## Siguiente recorrido

El siguiente resultado visible es una marca nueva recorrida desde creación hasta contexto semántico
preparado, sin depender de National. Se comprobará el formulario real, Brand OS, bases de
conocimiento, Topics iniciales y la preparación gratuita. El recorrido se detiene para que el operador
cargue menciones reales cuando la interfaz lo solicite; no se sembrarán datos ni una marca especial.

