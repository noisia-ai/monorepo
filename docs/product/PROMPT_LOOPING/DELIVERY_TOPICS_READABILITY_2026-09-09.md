# Topics: estado y costos comprensibles — entrega UAT, 9 septiembre 2026

Studio UAT ejecuta `db97205e3e32b42800cfdd72eaef8c5c6033370f` (deploy `90cbd720-b045-4838-9248-c7e3511a7bec`). Worker conserva `d97ada457370c435fb6492a517fbc36a1d711cf8`: el corte sólo cambia cinco archivos de Studio y no requiere reiniciarlo. SQL0147 permanece intacto.

La pantalla separa el catálogo ya disponible (32 Topics) de la interpretación pendiente (32 de 357 unidades). Los importes distinguen tope, costo Claude confirmado y reserva Claude. El recibo repetido sólo se omite cuando pertenece a la misma ejecución y coinciden exactamente los tres importes; incertidumbre y reserva terminal siguen visibles. La autorización de interpretación y la recuperación sin proveedor mantienen sus acciones y comprobaciones originales.

Se verificó navegación real Overview → Topics después del despliegue. El texto nuevo está visible; no se pulsó «Autorizar y continuar». Los 32 Topics, la selección previa de un Topic y los costos permanecen intactos. La comprobación del Worker de las 13:00:21 UTC conserva cero ejecuciones/llamadas/outbox activos y cero operaciones de autorización.

## Validación

Typecheck y lint 11/11; Studio 788 PASS y 6 SKIP; build 92.494 s. QA focal 14 pruebas y 18 comprobaciones de navegador, ES a 390 px y EN a 1280 px; capturas inspeccionadas y revisión sin P0/P1/P2. DB y Worker sin cambio en este corte.

Evidencia privada: worktree focal `.data/topics-readability-2026-09-09/`, `check-receipt.json`, `uat-studio-runtime-receipt.json`, `uat-worker-retained-runtime-receipt.json` y `uat-topics-ui.txt`. El recibo de checks dice UAT false porque precede al despliegue; esta entrega y los recibos posteriores lo actualizan sin reescribirlo.

## Límites

Esto no completa las 325 unidades pendientes ni calibra precisión semántica. Claude conserva USD 1.918865 confirmado y USD 1.6818 de reserva histórica terminal; cero envíos nuevos. El permiso anterior venció y la solicitud de presupuesto nuevo sigue sin respuesta. La UI de renovación está disponible pero no concede permiso por sí sola.
