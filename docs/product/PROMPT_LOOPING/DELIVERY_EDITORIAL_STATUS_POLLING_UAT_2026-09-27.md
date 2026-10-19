# Refresco de estado editorial adaptable — UAT, 27 septiembre 2026

## Cambio

La pantalla Topics mantiene un único refresco de estado editorial: cada cinco segundos mientras la pestaña está visible y la API responde, con esperas progresivas de 10, 20 y 30 segundos después de errores. Al volver a una pestaña visible intenta refrescar de inmediato. Una respuesta vigente reinicia el intervalo; una lectura cancelada no cuenta como fallo. No crea ejecuciones, reservas, envíos ni reintentos del proveedor.

## Verificación previa

- Pruebas del contrato editorial/polling: 40/40 PASS.
- Typecheck Studio: PASS.
- ESLint de los tres archivos afectados: PASS.
- Build Studio: PASS con valores ficticios de Kinde y conexión PostgreSQL local de build; no se usaron credenciales ni conexiones reales.
- Revisión focal independiente: sin dependencias de la migración 0197 ni carreras identificadas.

## Verificación UAT

La entrega se basa en el tip de la rama conectada a Studio UAT y cambia únicamente el comportamiento de lectura de estado en la tarjeta editorial, más helper, pruebas y este recibo. Tras el despliegue, comprobar el healthcheck y abrir Topics en modo lectura. No reintentar ni reproducir el POST anterior de autorización/ejecución; un GET de estado no demuestra que PostgreSQL esté sano si el error aparece antes de esa consulta.
