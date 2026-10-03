# Preparación de Brand OS antes del primer tópico

Fecha operativa: 8 septiembre 2026, America/Mexico_City. Base f4d2b60.

## Problema y comportamiento

La aceptación real en UAT detectó una marca con corpus completo y cuatro guías de Brand OS pendientes, pero sin catálogo de tópicos. El preflight indicaba preparar contexto y el control de preparación quedaba vacío: la preparación requiere un perfil real, mientras que ese perfil sólo se creaba al iniciar el análisis o crear un tópico.

El botón existente Calcular preparación ahora inicializa un catálogo vacío real, si falta, y consulta la cotización de preparación. Es una acción POST explícita, autorizada e idempotente; GET permanece de lectura. No crea intereses ficticios, no agrega formularios ni requiere una migración. El costo y la ejecución siguen separados: inicializar/cotizar no llama a proveedores. El segundo botón conserva la cotización sellada, clave de solicitud y límite monetario existentes.

La preparación de contexto con cero intereses tiene mensajes ES/EN propios. Se reutilizan los embeddings completos del corpus; sólo se preparan las guías que faltan. La hipótesis anterior de cero Voyage adicional queda corregida por este hallazgo: cuatro guías de contexto requieren preparación bajo la autorización vigente de Voyage.

## Verificación local

- PostgreSQL focal: ausencia de perfil usable, GET sin escritura, permisos, rollback, replay con mismo catálogo, cero términos, cotización exclusivamente de contexto y preparación simulada hasta preflight sin guías pendientes. Corpus, cobertura, recibos y costos previos idénticos. La fixture histórica retiró perfiles sólo dentro de una transacción revertida; no es una marca real nueva.
- Studio: 20 pruebas focales verdes, incluyendo regresiones que fallaban antes, ES/EN, inicialización y restricciones monetarias.
- Typecheck y lint del monorepo: 11/11 tareas correctas.
- Revisión independiente del diff: cero P0/P1/P2 pendientes.

Los recibos detallados están en `.data/workspace-context-initialization-2026-09-09/` y `.data/workspace-engine-2026-09-08/context-bootstrap-backend-receipt.md`. Esta evidencia local usa proveedor simulado. La validación real por UI después del despliegue se documenta separadamente; no se afirma todavía análisis real, Signal completo ni capacidad de millones de menciones.

No se incluyen los tres archivos ajenos signal-topic-contract-drafts*. No se cambian producción, imports, SQL0136–0140 ni el monto ya pagado por el corpus Voyage (USD0.594321).

Suite DB: 231 PASS /62 SKIP, con la regresión PG ejecutada aparte. Studio: 701 PASS /6 SKIP usando DATABASE_URL de loopback inactivo para inicializar imports (no conexiones ni proveedor). La primera invocación sin URL falló en dos imports; el entorno de prueba explícito resolvió ese requisito sin cambios de código.
