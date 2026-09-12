# Plan — renovación de retry semántico y seguimiento durable

Fecha: 2026-09-11
Base UAT: `9631f61`

## Resultado visible

Si Claude no recibió una solicitud de preparación y el permiso original venció, Brand OS ofrece una
renovación explícita sobre el mismo trabajo. La confirmación conserva la ejecución, el recibo
compuesto, el presupuesto y la reserva originales; sólo extiende la autoridad temporal compatible y
reencola el intento definitivamente no enviado. Una recarga o regreso posterior a la pantalla vuelve
a observar el mismo trabajo hasta que termina o requiere una decisión.

## Contratos

1. La renovación sólo existe para Stage 1 fallido, `provider_call_state=not_started`, contador cero,
   sin respuesta, lease, liquidación ni exposición incierta.
2. El dueño inmutable sigue siendo la operación, admisión, ejecución, recibo compuesto y reserva
   originales. La renovación no crea otra ejecución, reserva, receipt o llamada.
3. La nueva autoridad debe corresponder al mismo actor, workspace, generación, configuración y topes;
   fuente o política modificadas bloquean antes de reencolar.
4. GET distingue `renewal_available` de una corrida nueva y entrega una referencia opaca de la
   cotización exacta. POST exige esa referencia y una clave idempotente estable.
5. Replay de la misma decisión devuelve el mismo resultado. Carreras, permisos revocados, resultados
   pagados o inciertos y más de ocho recuperaciones fallan cerrados.
6. Si la renovación cruza de día presupuestario, la reserva original se imputa una sola vez al día de
   la renovación. Replays o renovaciones sucesivas no acumulan exposición; el recibo y la fecha de la
   reserva original permanecen intactos.
7. El navegador guarda sólo identidad de solicitud y estado público. El servidor decide proveedor,
   configuración, fuente, política, presupuesto y transición.
8. El polling se reinicia al montar, volver a la pestaña o solicitar actualización; llega a un máximo
   de 60 segundos y continúa mientras el trabajo siga activo. Nunca dispara POST por sí mismo.

## Entrega

- SQL0160 y adaptador DB quedan locales hasta pasar PostgreSQL sintético, rollback y carreras.
- Studio integra el estado público, la confirmación explícita y la reanudación de lectura.
- Prueba compuesta: expiración antes y después de cotizar, replay, doble clic, fuente/política
  modificadas, llamada incierta/pagada y recarga durante cola o ejecución.
- Revisión P0/P1/P2 y suites focales antes del commit.
- Entrega UAT focal en orden DB → Worker → Studio con proveedores deshabilitados y recibo posterior.

## Fuera de este corte

No importa menciones, no ejecuta BERTopic, no crea una marca de prueba y no inicia Claude o Voyage.
Después de cerrar este gate, el siguiente resultado es probar desde una marca nueva hasta contexto
semántico preparado, con datos reales aportados por el operador cuando la interfaz los solicite.
