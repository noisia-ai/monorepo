# Plan — reconciliación y fence de fuente de Brand Context

Fecha: 2026-09-11
Base UAT: `76fecc1cdc473d13487fc78b2861afe0f74c9b50`

## Resultado visible

Después de editar Brand OS, una fuente de conocimiento o un competidor, el workspace crea o
recupera gratuitamente la generación de contexto correspondiente. La pantalla descarta cualquier
cotización anterior y sólo permite confirmar la versión exacta que está mostrando. Si la fuente
cambia después de confirmar pero antes del transporte, la ejecución termina obsoleta sin llamar a
Claude ni conservar una reserva que no se usó.

El usuario conserva la última versión publicada mientras prepara la nueva. No necesita aprobar
prototipos individuales ni repetir el formulario inicial.

## Contratos

1. La reconciliación es workspace-scoped, idempotente y usa CAS contra la generación observada.
2. Si existe una llamada activa, incierta o una respuesta pagada pendiente de conciliar, no crea un
   sucesor que pueda competir con ella.
3. El GET devuelve una referencia opaca del quote. El POST exige esa misma referencia además de los
   importes y vencimiento; el navegador nunca proporciona política, fuente, proveedor o configuración.
4. Cada cambio de referencia crea una identidad de solicitud nueva. El replay del mismo quote conserva
   la misma identidad.
5. Inmediatamente antes de marcar la llamada `in_flight`, PostgreSQL vuelve a comparar la autoridad
   actual con la generación sellada. Drift comprobado cierra `stale`, libera una reserva no enviada y
   no toca resultados pagados ni la última publicación.

## Entrega

- SQL0159 sólo local hasta cerrar ensayo PostgreSQL, carreras y rollback.
- Adaptadores DB y Worker antes del wiring final Studio.
- Pruebas: edición cliente de Brand/KB/competidor, replay, CAS, quote cambiado con mismos importes,
  cambio de fuente entre confirmación y envío, política/acceso revocados y respuesta pagada.
- Aplicación UAT única en orden DB → Worker → Studio, proveedores deshabilitados y recibo posterior
  con cero actividad monetaria.
- La recuperación Stage 2 `definitely_not_sent` forma parte de este mismo corte: el Worker crea un
  sucesor Voyage con una cotización nueva y exacta; si toda la respuesta está en caché avanza sin
  confirmación ni proveedor y, si falta contenido, espera una nueva decisión del usuario. Claude no se
  vuelve a ejecutar.

## Gate siguiente antes de producción

Una recuperación Stage 1 `definitely_not_sent` funciona mientras la admisión original sigue vigente.
Si esa admisión vence, la pantalla debe ocultar cualquier CTA nueva que el POST no pueda honrar y el
producto debe permitir renovar explícitamente la autoridad original sin recrear la reserva ni la
llamada. Este gate no bloquea el ensayo UAT focal con admisión vigente, pero sí bloquea declarar el
recorrido listo para producción.
