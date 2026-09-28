# Entrada de interés definido en UAT — 28 septiembre 2026

## Resultado visible

En Studio UAT, `ea52133` corrigió el vaciado falso de la pantalla Topics de Alexa+ después de publicar Signal consolidado. El catálogo cargaba, pero la consulta secundaria de comandos de selección del catálogo anterior devolvía 404 y el componente lo trataba como revocación de acceso de toda la página. Ahora la selección antigua se monta sólo cuando el binding de serving confirma que aplica; una respuesta 404 de ese control queda local al control. Railway Studio `a98941d1-2fab-4b0f-9aad-f73470606507` quedó ACTIVE. Al recargar Topics en el navegador interno, el catálogo permaneció visible y no hubo nueva solicitud al endpoint antiguo `/commands`.

Desde la UI se creó en Alexa+ el interés explícito **«Activación no solicitada y consentimiento de Alexa+»**, con definición, pistas positivas y exclusiones. Se guardó como borrador editable de Brand OS, versión 4 del perfil `fefa4642-7b1c-41bd-9973-314784d62ab2`, revisión 1. Esto verifica la entrada de usuario para un interés definido; **no** verifica clasificación, membresías ni Signal del mismo interés. La creación no llamó a Claude/Voyage ni ejecutó SQL manual.

Signal conservó la revisión consolidada anterior: 43,159 menciones del corpus, 2,891 menciones únicas seleccionadas, 19,957 Noise, 5,593 sin concepto publicado y 1,652/1,652 grupos interpretados. El nuevo interés no cambió la selección vigente.

## Bloqueo reproducible siguiente

Topics muestra «Intereses pendientes de preparar» y deshabilita «Buscar menciones». La vista de preparación semántica del servidor devuelve `configuration_required`, `can_start=false`, operación `guides_pending` y `quote=null`. La lectura PostgreSQL readonly del workspace Alexa+ `979b8f96-3366-463d-8ee8-8c0cce460a71` encuentra la política activa versión 6 válida hasta el 4 de octubre, pero sólo **una** acción de política; el recibo de preparación anterior se completó el 12 de septiembre y su autorización venció ese día. El cotizador exige `brand_context_proposal` y `topic_prototype_embeddings` compatibles. Esa combinación actual no permite renovar las guías del interés nuevo. La política global activa de revisión editorial no equivale a permiso para estas dos acciones. No se modificó la política ni se hizo una llamada pagada para ocultar este estado.

## Siguiente corte de producto

Dar a un usuario de cualquier marca, incluida una marca con corpus y política editorial existentes, una forma self-service de obtener una cotización y autorizar la preparación semántica de un interés nuevo o editado. La acción debe conservar el ledger y la versión de política, y preparar únicamente el plan nuevo con recibos compatibles. Después comprobar por UI: guías preparadas, búsqueda con evidencia del corpus real, decisión explícita, membresías persistentes del **mismo interés** y su efecto verificable en Signal. La similitud o un top-k no equivalen a pertenencia aprobada. Ninguna revisión manual por mención.

Validación de este corte: `git diff --check`, typecheck Studio y lint Studio pasaron; lint mantuvo 13 warnings previos. El build local compiló, pero no completó la fase de datos de páginas porque este checkout no tiene `KINDE_ISSUER_URL`; el build Railway y la verificación UI UAT sí pasaron. No se ejecutaron migraciones, Batches, importación, Voyage ni BERTopic fit.
