# WS0 — higiene y preservación MFP · 2026-10-04

**Entrega documental revisada; 13 ramas remotas retiradas con etiquetas preservadas.** Base `develop c577f8f`, rama `feat/mfp-ws0-hygiene`. Spec v1.3 y accesos ya preservados en `58bf0b5`. El repositorio ahora señala un único canon vigente en el banner de AGENTS (9 líneas); no se borró historia ni se modificó producto.

| Archivo/familia revisada | Decisión / resultado |
|---|---|
| CSV upload; interest-membership; incremental; pre-reconcile | Descartar cherry-picks: patch-equivalentes. |
| Pitch Kit | Descartar versión anterior: ya evolucionada y saneada. |
| Front recovery / variantes | UTC `6861ceb` candidato focal; foco móvil conserva secuencia correctiva para WS7. Sin aplicar todavía. |
| Legacy cap copy | Descartar de este corte; UI MFP usará contrato v1.3. |
| Consolidated workspace / editorial batches | Inspector ya equivalente; descartar SQL0197 viejo frente a retry y quote_fast vigentes. |
| Signal-from-import | Descartar pipeline viejo; pool y outbox útiles ya idénticos. |
| Legacy inspector / NOI19 / lab backups / Signal Pulse spec | Descartar ramas antiguas; preservar etiquetas y contratos actuales. |

[Anexo de decisiones y 13 comandos de borrado remoto](MFP_WS0_REVIEW_2026-10-04.md), con lease a SHA verificado; ejecutados por root después de comprobar cada etiqueta remota con el mismo SHA (13/13). [28 etiquetas / 18 puntas](MFP_WS0_ARCHIVE_REFS_2026-10-04.tsv). [Borrador develop→main](MFP_DEVELOP_TO_MAIN_PR_DRAFT_2026-10-04.md), sin publicar ni fusionar PR #14.

**Preservación:** [110 documentos históricos](MFP_WS0_HISTORICAL_INVENTORY_2026-10-04.tsv), 2,289,848 bytes. Copia privada `~/Downloads/noisia-archive-2026-10-04/mfp-ws0-untracked-2026-10-04/`; hashes verificados 110/110, originales intactos y untracked. Sólo inventario/revisión documental se versionan; los contenidos históricos extensos no se publicaron en bloque.

**Comandos/evidencia:** `git log`, `git diff develop...<tag> --stat`, `git cherry`, comparación focal de archivos y `git ls-remote --heads --tags`: completados. Validación SHA256 origen/copia/manifiesto y banner ≤10 líneas: PASS. `git diff --check`: PASS. No hubo cambios de paquetes ni ejecución local de suites pesadas; gates remotos generales pendientes de CI/root, no se reportan verdes.

**Coste real:** USD 0 de proveedores. Sin SQL, importación, inferencia, Worker, Docker ni despliegue. Pendientes: rama local antigua, retiro de worktrees, fix UTC, QA móvil y aceptación `git branch -a` de §9.0; root tiene los comandos y candidatos concretos. WS0 no acredita self-service ni entrega UAT.
