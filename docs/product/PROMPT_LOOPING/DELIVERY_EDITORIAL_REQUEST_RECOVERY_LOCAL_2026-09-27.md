# Recuperación de la solicitud editorial — corte LOCAL

Fecha: 2026-09-27

## Problema de producto

El navegador puede esperar indefinidamente al POST que inicia o recupera la revisión editorial. Mientras espera, bloquea acciones útiles; si se recarga, la intención idempotente sólo existía en memoria. Un resultado de red incierto no permite concluir si el servidor admitió la ejecución, por lo que crear otra clave podría iniciar un segundo trabajo.

## Cambio local

- La espera del POST tiene un límite de 90 segundos y la lectura de estado uno de 25 segundos. Al vencer el POST, la UI libera el estado ocupado, comunica que el resultado sigue sin confirmar y consulta el estado de forma asíncrona.
- La clave opaca y el comando público se guardan en `sessionStorage`, acotados por usuario autenticado, workspace y ejecución numérica. No se guardan evidencia, contexto privado, planes ni cotizaciones.
- Tras recargar, la UI restaura sólo un comando válido del mismo alcance. Mientras la solicitud siga incierta, iniciar otra acción no genera una clave nueva; la recuperación explícita reenvía la misma solicitud.
- El estado de sesión se limpia sólo con un recibo validado o un rechazo terminal de cotización reconocido.

## Verificación

- `workspace-topic-editorial.test.ts`: 38/38 PASS.
- `client-workspace-entry-ui.test.tsx`, `signal-topics-self-service-ui.test.ts` y `signal-workspace-topic-computation-ui.test.ts`: 23/23 PASS.
- TypeScript Studio: PASS.
- ESLint focal: PASS.
- `git diff --check`: PASS.

## Límites y siguiente corte

Este cambio es LOCAL; no está desplegado en UAT. En UAT se observó un inicio anterior cuyo navegador continúa sin resultado confirmado; una segunda pestaña lee el estado previo `not_requested`. Eso no demuestra si el primer POST llegó al servidor. No se inició otra clave, no se reinició la página pendiente y no se declaró admisión, envío, gasto ni progreso.

El siguiente paso es resolver la identidad de esa misma solicitud y leer sus fases seguras de servidor. Si el cuello está en la preparación síncrona anterior a la admisión durable, el corte de producto será mover ese trabajo al Worker existente y devolver pronto un recibo durable de progreso. El cambio local de timeout evita congelar la pantalla, pero no sustituye una admisión asíncrona si la ruta servidor supera su límite HTTP.
