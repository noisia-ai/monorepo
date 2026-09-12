# Restauración de ayuda Claude en alta de marca — 2026-09-12

## Resultado

La ayuda previa al guardado vuelve a estar disponible en `/studio/brands/new` y
`/signal/brands/new`. El usuario completa identidad, organización, mercado e industria;
después puede pedir a Claude un borrador para descripción estratégica, aliases, competidores
y notas de Knowledge Base. Cada bloque se acepta o descarta por separado y nada se persiste
hasta crear la marca.

Esta ayuda es distinta de la preparación semántica posterior al alta. La primera reduce la
carga del formulario; la segunda versiona y prepara el contexto que usarán Topics y el corpus.

## Causa de la regresión

El commit `44eeab5` eliminó la interfaz y convirtió
`/api/brands/intake-suggestions` en una respuesta `410`. La decisión buscaba que el gasto y la
idempotencia vivieran después de crear el workspace, pero aplicó esa restricción también al
borrador opcional del formulario. Eso contradijo el north star y la descripción funcional que
ordenaban conservar «Investigar marca con Claude».

## Corrección

- Commit de producto: `b557bfd8aaed78b91b57b64480d91562a65f3027`.
- Modelo fijo: `claude-sonnet-4-6`; Opus no es seleccionable por entorno.
- Tope por solicitud: 4,096 tokens de salida y hasta dos búsquedas web.
- Autorización: administradores internos y `client_admin` activo con organización.
- Idioma: la UI y los borradores respetan `es-MX` o `en-US`.
- Control humano: aceptar o descartar por campo; refinar vuelve a solicitar un borrador.
- Respuestas `no-store`; la API no recibe secretos del navegador.

El helper sigue siendo una solicitud pagada directa disparada por el botón. El pipeline
semántico durable posterior conserva sus propios recibos, límites e idempotencia; este corte no
los reemplaza ni los modifica.

## Verificación

- `pnpm typecheck`: 11/11 paquetes PASS.
- `pnpm lint`: PASS, sólo 13 warnings históricos fuera del cambio.
- `brand-context-form-ui.test.tsx`: 30/30 PASS, ES/EN y admin cliente incluidos.
- `pnpm --filter @noisia/studio build`: PASS con variables ficticias de build; no conectó a DB ni proveedor.
- Railway Studio UAT: deployment `fb66b96d-3b22-4c90-9be2-d84a96ff9b83`, estado `Deployment successful`, commit exacto `b557bfd`.
- UI UAT real: muestra «Investigar marca», el límite visible y «Refinar»; ambos botones pasan de disabled a enabled al completar el contexto mínimo.
- `/api/health`: `status=ok`, `runtimeProfile=uat`, `llm_provider=ok` a `2026-09-12T06:49:49.664Z`.

No se pulsó «Investigar marca» durante QA. No hubo llamadas ni gasto Claude en esta corrección,
no se creó una marca temporal, no hubo SQL y Worker no cambió.

## Estado operativo

El loop `noisia-topics-to-signal-uat-loop` permanece `PAUSED`. Esta fue una corrección focal
solicitada después de la pausa; no reactiva el desarrollo general.
