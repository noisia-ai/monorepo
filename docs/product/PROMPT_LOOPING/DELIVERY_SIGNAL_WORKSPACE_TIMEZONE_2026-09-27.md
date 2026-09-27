# Zona horaria del calendario de Topics en Signal

Fecha: 2026-09-27

## Resultado

La página de Topics de Signal ya recibía y mostraba la zona IANA del workspace, pero construía el filtro de fechas con `UTC`. El calendario usa esa zona para decidir qué día considera “hoy” y cuál es la última fecha seleccionable. Cerca de medianoche, ambas partes podían mostrar fechas distintas.

Ahora el filtro de Topics recibe `workspaceTimezone`. El límite del calendario usa esa zona; sólo una zona antigua inválida cae a UTC para evitar que la pantalla falle. El cambio aplica por workspace y también alcanza Narratives porque comparte la misma pantalla y filtro.

## Verificación

- Pruebas determinísticas antes y después de medianoche UTC: Ciudad de México conserva el día local, mientras Londres ya cambió al siguiente donde corresponde.
- Zona IANA inválida cae de forma explícita a UTC.
- Prueba del contrato confirma que Topics pasa la zona del workspace al filtro.
- La suite focal `signal-workspace-topics-ui.test.ts`: 29/29 PASS.
- Typecheck de Studio y ESLint focal PASS; `git diff --check` PASS.

## Límites

La cobertura real de Alexa+ termina el 12 de agosto de 2026, así que su calendario está acotado por esa fecha y no permite observar visualmente el límite de “hoy” en producción de esa marca. El arreglo cubre el límite sin cobertura mediante el helper determinístico; no cambia fechas almacenadas, filtros enviados al servidor, datos, SQL ni llamadas a proveedores.

El cambio queda local hasta el despliegue de Studio UAT y su healthcheck. La prueba funcional en UAT consiste en abrir Signal > Topics/Narratives y confirmar que mantiene los mismos Topics y menciones; la prueba de cruce de medianoche queda cubierta localmente porque el corpus UAT no llega hasta hoy.
