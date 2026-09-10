# Continuidad de interpretación dentro del producto

Decisión del orquestador durante la ventana autónoma del 9 septiembre. Complementa el Compass y los planes previos; no cambia el destino de producto ni concede un permiso de gasto.

## Resultado inmediato

Una marca conserva su análisis y sus Topics cuando se termina la ventana autorizada de interpretación. Un administrador con permiso operativo puede ver la exposición real, confirmar un máximo adicional y un vencimiento, y continuar la misma ejecución desde Topics. También puede detener nuevos envíos desde ahí. No debe cambiar variables de Railway ni solicitar intervención de ingeniería cada día.

Esta entrega mantiene el fit completo, los modelos, los recibos ya pagados, la revisión Sonnet 4.6 y los techos acumulado/diario originales. El nuevo permiso limita además sus propias llamadas. El importe reservado histórico permanece visible y no se liquida ni se elimina por renovar. No hay renovación automática: requiere una confirmación visible en la UI. El operador aún no ha respondido a la solicitud de nuevo presupuesto de esta ventana, por lo que las pruebas y el desarrollo siguen sin proveedores.

## Trabajo distribuido

| Área | Entrega | Estado al iniciar |
| --- | --- | --- |
| Backend | Operación de permiso/revocación y puntero en el ledger existente; SQL0147, autoridad, costos, CAS, recuperación de recibo. | Desarrollo local sobre 4de84e5. |
| Worker | La nueva reserva referencia el permiso de la ejecución; cada envío usa el permiso de su propia call. Denegaciones probadas distintas de un ACK incierto. | Cuatro archivos locales, 68 pruebas focales y typecheck. |
| Studio | Confirmación acotada, exposición, vencimiento en zona DB, detener nuevos envíos y recuperar la misma intención sin cambiar key/body. | Desarrollo aislado sobre 4de84e5. |
| Revisión | Revisión independiente de contratos/DB/Worker y luego comprobación del conjunto exacto. | En curso, sin proveedores. |

La fecha y el margen salen del servidor. El estado `requires_authorization` es independiente del rol: evita mostrar un Reanudar engañoso aunque un error histórico sea genérico. Se conserva ese error como historia. Un recibo aceptado se recupera por GET aun si perdió vigencia posteriormente; otra key no sustituye una confirmación incierta. Detener nuevos envíos no descarta un borrador ni interrumpe una respuesta ya admitida.

## Límites explícitos

La autorización inicial sigue la frontera administrativa interna vigente. Habilitar presupuesto y ejecución para administradores de clientes exige cerrar la política de permisos y presupuesto por organización antes de anunciar autoservicio externo completo. Esta entrega elimina una dependencia de ingeniería, pero no declara el producto listo para producción.

Las unidades nuevas de un modelo incremental requieren una operación editorial sobre su checkpoint; no se deben pasar por el análisis full-fit ni aumentar el cap cero del cálculo. Ese siguiente adaptador conservará propietario numérico, propietario editorial, evidencia del censo actual y los intentos previos. El diseño específico está retenido en `INCREMENTAL_EDITORIAL_ADMISSION_CONTRACT_2026-09-09.md` dentro de la evidencia privada del worktree focal. Aún no es runtime entregado.

Otra deuda localizada es la recuperación manual de derivación/proyección incremental después de agotar los reintentos automáticos. Debe retomar binding, generación y cursor con una acción propia, sin volver al cálculo numérico; `INCREMENTAL_DELIVERY_NEXT_CUT.md` conserva el mapa exacto. No se confunde esa deuda con el retry numérico ya entregado en UAT4de84e5.

## Cierre esperado

Checks del conjunto exacto, PostgreSQL focal, transporte local sin proveedor y QA de la UI en ES/EN. Sólo después se decide la entrega focal UAT y se verifica que no cambien los costos/selección existentes ni se cree un permiso automáticamente. SQL0147 está reservado para este trabajo; no se ha aplicado a UAT al escribir este plan. La segunda carga incremental real por UI sigue pendiente del operador. La ventana autónoma termina a las14:47:24UTC, con parada segura y loop pausado.
