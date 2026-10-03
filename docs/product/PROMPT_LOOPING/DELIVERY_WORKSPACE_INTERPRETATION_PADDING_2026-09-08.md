# Interpretación de grupos con vocabulario auxiliar vacío

Fecha operativa8sept2026, America/Mexico_City. Base aeea21e.

## Hallazgo UAT

La recuperación de almacenamiento por UI guardó15artefactos del motor para la misma ejecución `4c55af5c-e17f-430a-b17d-6771e94bd30e`. El segundo cálculo tiene180grupos abiertos y177guiados, sobre6826raíces/20821fragmentos/4guías. Antes de llamar aClaude, el parser rechazó keywords auxiliares vacías: BERTopic rellena las15posiciones con strings vacíos cuando faltan términos. En open hay484vacíos en49grupos; en guided443en43grupos. Hashes de ambos artefactos verificados, cero términos>256/censos inválidos en esa sonda. Los artefactos crudos y todas las referencias se conservaron; Claude0.

El reader omite únicamente strings auxiliares cuyo trim es vacío. Conserva términos reales, citas, offsets, SHA, todos los grupos y el digest del censo completo. Datos malformados de otros tipos continúan rechazándose. La interpretación puede usar las menciones aunque un grupo no tenga keywords léxicas útiles.

## Recuperación sin nuevo cálculo

La misma acción Reanudar requiere evidencia del servidor: fallo específico antes de checkpoints de interpretación/modelo/llamadas y un bundle numérico completo registrado en el workspace. Cada referencia debe coincidir con su artefacto inmutable y sus bytes se vuelven a verificar al descargar. La autorización, vigencia de inputs, cap y clave permanecen.

Un marcador obliga a recuperar ese bundle: si falta o no coincide, se detiene; no cae en otro ajuste Python. La ruta existente de checkpoint reutiliza el resultado, sin nuevas subidas. El usuario no puede conceder elegibilidad por cuerpo de petición ni contadores. No se habilita un reintento global de errores de evidencia ni se añaden formularios.

La primera corrida fallida calculó178/178 y el segundo cálculo180/177. Es una variación observada, cuya causa específica no se ha auditado; no se afirma igualdad exacta entre refits. El siguiente intento debe conservar los357grupos persistidos. Esto no demuestra precisión semántica ni rendimiento de millones de menciones.

## Evidencia y alcance

Recibo real: `.data/workspace-engine-2026-09-08/uat-interpretation-padding-failure.json`. Regresiones de parser/transporte, restauración sin Python/put/proveedor, elegibilidad SQL e interfaz se registran con sus resultados al cerrar el corte.

No SQL nuevo, producción, cambios de bucket/imports/embeddings ni edición de los tres contract-drafts ajenos. Costos reales antes del reintento: VoyageUSD0.594321corpus +USD0.000128contexto, sin reservas ni incertidumbre; Claude0. TopeClaudeUSD30 autorizado sólo8septMéxico. La aceptación real de interpretación, catálogo, clasificación, selección y Signal sigue pendiente.

## Cierre local — 9 septiembre 01:55 UTC (8 septiembre México)

Typecheck y lint raíz: 11/11 tareas correctas en cada uno; cero errores y warnings preexistentes. Suites estándar: DB 231 PASS/64 SKIP; Studio 705 PASS/6 SKIP; Worker 312 PASS/5 SKIP. PostgreSQL focal: 1 PASS, nueve casos previos excluidos; reader 5/5; restauración Worker 3 PASS; servicio Studio 10/10.

La revisión independiente cerró un P2: una propuesta guardada después del fit ya no invalida el bundle numérico en una recuperación posterior. PG comprobó fit → recibo liquidado → propuesta → fallo → reintento conservando archivos y recibo. La elegibilidad inicial sigue exigiendo cero llamadas/checkpoints/modelos; el lector posterior admite los checkpoints editoriales adicionales. Revisión final: 0 P0/P1/P2 pendientes.

Los tres archivos contract-drafts ajenos conservan su SHA original y se excluyen del commit. Recibos privados: `padding-evidence-recovery-receipt.md` y `padding-recovery-independent-review.md` en `.data/workspace-engine-2026-09-08/`. Aceptación UAT pendiente; este cierre local no declara interpretación ni Signal entregados.
