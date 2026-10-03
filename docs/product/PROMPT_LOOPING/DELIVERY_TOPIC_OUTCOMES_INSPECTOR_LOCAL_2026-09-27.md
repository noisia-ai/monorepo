# Topic outcomes inspector — corte local

Fecha: 2026-09-27

## Resultado

Topics ahora tiene, dentro de la revisión editorial V2 ya existente, un inspector opcional y de sólo lectura por grupo original. Al abrirlo, pide páginas de 20 resultados de la ejecución seleccionada. Cada renglón separa Topic, narrativa, Noise, evidencia insuficiente, error técnico y pendiente; al abrir un grupo muestra la fase (screening, consolidado o pendiente), los campos de decisión que se guardaron y hasta dos evidencias. Las citas de una decisión se distinguen explícitamente de un ejemplo representativo del grupo.

El endpoint está limitado a workspace, ejecución numérica y ejecución editorial V2 vigentes. Reutiliza el censo y el lector verificado de evidencia, no acepta texto, planes ni referencias privadas desde el cliente, y no hace llamadas a proveedores ni escribe en la base. Los fragmentos de corpus conservan la verificación SHA-256 y están truncados para presentación.

## Archivos

- `apps/studio/src/lib/data-os/workspace-topic-editorial-outcomes-v2.ts`
- `apps/studio/src/app/api/data-os/signal/[workspaceId]/topics/consolidation/editorial/outcomes/route.ts`
- `apps/studio/src/components/brands/WorkspaceTopicEditorialOutcomes.tsx`
- `apps/studio/src/components/brands/WorkspaceTopicEditorialCard.tsx`
- `apps/studio/src/lib/data-os/workspace-topic-editorial-outcomes-v2.test.ts`

Se agregaron traducciones ES-MX/EN-US y cobertura de interfaz en `workspace-topic-editorial.test.ts`. También se corrigió la aserción textual antigua de esa suite para que compruebe el orden de replay/runtime dentro de `authorizeWorkspaceTopicEditorialBatchV2ForActor`, en vez de comparar coincidencias de funciones distintas.

## Revisión y correcciones

Una revisión independiente encontró dos riesgos de concurrencia: que el banner de revisión y las decisiones se leyeran desde snapshots distintos, y que la finalización de una solicitud abortada limpiara el bloqueo de una solicitud nueva. El censo ahora puede reutilizar la transacción de lectura que lo invoca, por lo que página, decisiones y citas comparten `REPEATABLE READ`; el cliente sólo limpia `inFlight` si termina el mismo controlador vigente.

## Verificación

- Pruebas de censo, resultados y suite editorial combinadas: 49/49.
- TypeScript de Studio: PASS.
- ESLint focal: PASS.
- JSON ES-MX/EN-US y `git diff --check`: PASS.

## Límite de entrega

Este corte sigue local; no está desplegado ni probado desde la interfaz de UAT. No se ejecutó SQL, no se abrió una ejecución pagada, no se volvió a importar corpus ni a generar embeddings/BERTopic. El error de workers al reclamar tareas de PostgreSQL continúa como diagnóstico independiente; una consulta puntual de sólo lectura llegó a PostgreSQL, pero no certificó la salud sostenida de los consumidores.

## Siguiente paso

Hacer revisión integrada del diff y validar el endpoint con un fixture PostgreSQL privado existente, sin mutaciones ni proveedor. Si ese gate es limpio, integrar el corte focal en la rama de Studio de UAT, verificar que abra el inspector con la ejecución Alexa+ existente y dejar claro el estado parcial 2/42. Si la base o la cola no permiten validación, conservar el corte local y atacar la causa reproducible del Worker sin reautorizar una llamada editorial.
