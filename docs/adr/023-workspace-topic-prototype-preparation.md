# ADR023 — Preparación reutilizable de intereses y contexto

Estado: aceptado para el corte self-service UAT del 8 septiembre 2026; implementación y validación local. El recibo de entrega determinará la versión remota. Complementa ADR021 (embeddings del corpus) y ADR022 (búsqueda completa); no redefine una preparación como clasificación aprobada.

## Problema

El compilador de Topics conserva definiciones, inclusiones, exclusiones, ejemplos y Brand OS completo por ámbito. La búsqueda workspace requiere sus vectores con el mismo perfil `document` que las menciones. Faltaba una operación en Topics para producirlos antes o después de importar, con costo verificable y recuperación. Reutilizar vectores legacy `query` identificados sólo por modelo sería incorrecto.

## Decisión

Extender el ledger existente `signal_workspace_embedding_runs` con una alternativa de entrada estricta: `corpus` conserva preparación/revisión/cursor de menciones; `topic_prototypes` conserva perfil de taxonomía, plan sellado y cursor de textos. SQL0135 no crea otro ejecutor, ledger monetario, corpus artificial ni nueva cola. Las llamadas, reservas, recibos, caché física y Worker siguen compartidos.

Un plan deduplica el texto físico por SHA y configuración completa del embedding, conservando todas las referencias semánticas y el digest de contexto de cada ámbito. Las revisiones de definición y procedencia permanecen separadas de la identidad física que se paga. Textos idénticos entre Topics, roles o menciones pueden reutilizar el mismo vector dentro del workspace. No hay truncamiento de fuentes ni límite de población introducido por esta preparación.

Las referencias de Topic se proyectan únicamente desde la caché física, con un enlace validado al recibo de la llamada. Las filas históricas no reciben procedencia inventada. Los lectores de corpus distinguen el tipo de ejecución; terminar intereses nunca declara terminado el corpus.

El permiso actual del workspace, el catálogo y la disponibilidad del contexto se revisan antes del envío y al confirmar resultados. Las fuentes KB incluidas en contexto completo conservan propiedad, estado y vigencia de aserciones. No se infiere una licencia externa de un estado activo, ni se añade un formulario nuevo. Cambiar o retirar contexto invalida el uso del plan; una respuesta ya enviada conserva su recibo/costo aunque ya no pueda publicar aliases.

Topics ofrece estado, cotización e intención explícita con plan, cotización, tope e idempotencia. El servidor decide actor, workspace, perfil y disponibilidad del proveedor. La recuperación conserva key/body/cap; no envía automáticamente desde una recarga. Caché completa y respuestas persistidas pueden terminar sin proveedor habilitado. Una llamada de resultado incierto conserva reserva y bloquea un reenvío solapado, incluso entre corpus e intereses.

Las lecturas de estado/cotización usan un snapshot de PostgreSQL y un sello de tiempo del inicio de la transacción. Una lectura lenta de un snapshot anterior no puede desplazar en la interfaz a otro posterior.

## Consecuencias y límites

La preparación funciona antes de importar y comparte pagos posteriores con las menciones. Una sola ejecución activa por workspace/perfil evita gastos concurrentes sobre textos solapados. El perfil completo es obligatorio: proveedor, modelo, dimensiones, tipo de entrada, dtype, política de fragmentos y contrato; cambiar sólo el nombre del modelo no basta.

Preparar vectores no aprueba pertenencia ni precisión semántica. Clasificación persistente/incremental, descubrimiento abierto, interpretación con Claude y Signal del corpus nuevo permanecen dentro del Compass y sus tickets. La resolución integral self-service de resultados inciertos y presupuestos sigue en NOI-81; cliente integral en NOI-19 y retención física/retirada en NOI-80. No se habilita proveedor ni producción por este ADR.

## Evidencia local

PG/BullMQ: tres intereses antes de cualquier import, 202 referencias sobre 187 textos únicos; fallo después de la segunda respuesta, recuperación y un segundo recorrido de caché sin llamadas adicionales. Una mención local posterior reutiliza el vector y permite la búsqueda. Negativos: límites de costo, proveedor deshabilitado, unknown compartido, permisos/contexto cambiados, falsificación de aliases, fuentes retiradas/expiradas, separación de lectores y respuesta GET fuera de orden. Los transportes son simulados y no prueban calidad de embeddings reales.

Continuidad: `docs/product/PROMPT_LOOPING/WORKSPACE_TOPIC_PROTOTYPE_PREPARATION_2026-09-08.md` y recibos locales del worktree focal bajo `.data/workspace-topic-prototypes-2026-09-08/`.
