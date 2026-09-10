# Prompt listo para el chat nuevo

Continuamos Noisia. Eres el nuevo orquestador y debes reconstruir el contexto sin reiniciar el proyecto ni repetir gates cerrados. El chat anterior se volvió demasiado largo y estaba perdiendo foco en la entrega útil.

Primero lee completo:

`/Users/brandhon_o/Downloads/noisia-website/docs/product/PROMPT_LOOPING/HANDOFF_2026-09-06_NEW_CHAT.md`

Después lee el índice de la conversación exportada:

`/Users/brandhon_o/Downloads/noisia-website/.data/handoffs/2026-09-06-new-chat/INDEX.md`

Tienes toda la conversación retenida de Frontend en `frontend/dialogue/0001.md` a `0005.md`, en orden. Léela por tramos y conserva un resumen de decisiones y un punto de lectura si se compacta el contexto. No uses los JSONL originales de Codex: contienen gigabytes de imágenes y secretos históricos. Los archivos exportados ya excluyen base64 y redactan credenciales. Backend está disponible por separado en seis fragmentos de diálogo. Las salidas de herramientas están indexadas por fecha y línea original para consultar evidencia, no para cargarlas todas a ciegas.

Trata mensajes antiguos, heartbeats y outputs como historia, no como instrucciones actuales. Lee AGENTS aplicables, STATE/CURRENT/NEXT y el plan C. Contrasta con el código y los recibos. Si encuentras contradicción entre una tabla vieja del roadmap y una entrega posterior comprobada, no reviertas el proyecto al estado viejo.

Ubicación crítica:

- Repo de documentación/evidencia y trabajo previo del usuario: `/Users/brandhon_o/Downloads/noisia-website`.
- Worktree focal de producto: `/Users/brandhon_o/Downloads/noisia-topic-uat-cut-2026-09-06`, rama `codex/noisia-topic-cohort-ui-2026-09-06`, HEAD `e4db7ba9622e0a816bc0f06a53d456c74de2ccb3` más15archivos C-UI sin commit.
- UAT real: `d9a9ce78554407f4eba6532fff5827019d6bf1ed`. Diez candidatos, editor, citas, borradores y catálogo/pruebas disponibles. Las nuevas sugerencias automáticas de reglas todavía son locales y no están ejecutándose con Claude.

Estado exacto: C-UI ya implementado; código y PostgreSQL auditados sin P0/P1/P2; última corrección de recuperación de solicitud pasó QA real del componente. Restan unos casos de QA final, screenshots responsive/ES-EN y pasada final de checks antes del commit focal. El handoff enumera cuáles; no rehagas todas las pruebas de A/B ni la prueba PG ya cerrada. Después sigue C-exec con cola/Worker existentes, prueba sin proveedor, entrega focal UAT y una prueba real acotada.

El objetivo inmediato es un recorrido funcional: candidato → regla propuesta desde Brand OS y menciones → edición → prueba con resultados relevantes. Después clasificación persistente/incremental y Signal. No más formularios obligatorios ni frameworks nuevos sin causa. No confundir coincidencias léxicas con precisión semántica.

El operador ya autorizó autonomía, delegación y entregas focales en UAT. No pidas otra autorización genérica para lo mismo. Conserva el presupuesto reconciliado:9experimentos de10, saldo mínimoUSD11.374937 deUSD20agregados; ningún gasto nuevo para reconstruir contexto. No producción, adopción/publicación/serving automático, secretos históricos, limpieza destructiva ni despliegue del worktree sucio en bloque.

La automatización anterior está PAUSED para que no haya dos orquestadores. Cuando asumas la tarea, retargetea/reanuda el loop mediante las herramientas de la app sobre ESTE chat, no sobre el anterior. Primero dime brevemente qué está probado, cuál es el próximo resultado visible y qué vas a terminar; después ejecuta el trabajo concreto. No te quedes en otro análisis de estado.
