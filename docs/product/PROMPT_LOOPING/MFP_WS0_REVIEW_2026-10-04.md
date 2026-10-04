# WS0 — revisión de archivos y ramas

Base comparada: `develop c577f8f`. Spec/accesos v1.3 preservados previamente en `58bf0b5`.
Este anexo conserva decisiones y comandos **preparados, no ejecutados**. Ninguna etiqueta ni rama fue borrada por WS0.

## Decisiones sobre etiquetas

`git log develop..<tag>` encuentra commits por ascendencia; `git cherry develop <tag>` distingue equivalencia de parches. No se deduce ausencia de funcionalidad sólo de un hash distinto. El [inventario de refs](MFP_WS0_ARCHIVE_REFS_2026-10-04.tsv) enumera todas las etiquetas, incluidas las variantes del mismo SHA.

| Punta / familias archivadas | Decisión | Evidencia y motivo |
|---|---|---|
| `0cdf4eb` · `feat/pitch-kit` | Descartar cherry-pick | Fix de impresión patch-equivalente. `LEARNINGS.md` existe y evolucionó: referencias privadas fueron saneadas e Iconoir sustituyó Feather. Restaurar el archivo antiguo revertiría esas correcciones. |
| `eedc9d2` · pre-reconcile | Descartar | Los 5 commits son patch-equivalentes en develop. |
| `aa44b7e` · fix-csv-upload-prod | Descartar | El único fix es patch-equivalente en develop. |
| `6861ceb` · detached b86b | Aplicar después de gate remoto | El arreglo UTC de `AdminWorkspacePrimitives` sigue ausente; es candidato focal de 2 archivos. No aplicado en este corte documental por coordinación con root; no se declara resuelto. |
| `3b574f5`, `c0fc671`, `5714863` · front-recovery, variantes y detached | Descartar cherry-pick íntegro; conservar candidato | Incluyen foco móvil aún no integrado, corrección de `inert`, cambios de contratos y harness. El primer parche `062bbc8` solo no basta: su sucesor corrige contratos React/runtime. Conservar la secuencia en etiquetas y trasladar su evaluación UI a WS7; no recuperar una rama de 26 archivos como higiene. |
| `ca4e729` · legacy-cap-copy | Descartar en este corte | Copy todavía ausente, pero remite al flujo editorial anterior. WS7 presentará estimado/presupuesto/máximo explícito del spec v1.3; no ampliar ahora la interfaz histórica. |
| `655da15` · consolidated-workspace | Descartar | Los 2 commits de inspector/snapshot son patch-equivalentes. El tercero es `fd9ebef`, evaluado abajo. |
| `fd9ebef` · editorial-batches | Descartar | Su SQL0197 de quote no está integrado literalmente: 0197 vigente es preparation retry. La ruta vigente usa `signal_topic_editorial_quote_fast_v2` (0198/0199). No colisionar números ni reinstalar la cotización provisional vieja. |
| `a5d776a` · signal-from-import | Descartar | No extender review/renewal histórico. Los dos fixes útiles `2c92bc9` (pool Studio) y `6d57b63` (outbox) son idénticos por archivo a develop; no repetirlos. |
| `415c7a7` · topic-legacy-screening-inspector | Descartar | SQL0197 de preparation retry idéntico al actual; el runtime y admisión continuaron en 0198–0200. No reintroducir runner/fixtures anteriores. |
| `59b7375` · interest-membership | Descartar | Los 18 commits son patch-equivalentes. La etiqueta remota preserva el estado; rama local/remota elegible para retiro por root. |
| `070c94e` · incremental-editorial / backup | Descartar | Los 3 commits son patch-equivalentes. |
| `ddb8cb0`, `73e3951` · data-os UAT / backup-local-history | Descartar | Lab/refinement anterior y snapshots documentales; fuera del motor aditivo vigente. No traer clones locales ni cadena de controles antigua. Etiquetas preservadas. |
| `256f092` · backup-noi19 | Descartar | Entrada cliente ya evolucionada: develop agrega Brand OS, `can_request_processing`, estado de organización y locks de autoridad. Aplicar el WIP antiguo no aporta la versión vigente. |
| `4dbf669` · docs/signal-pulse-spec | Descartar | Spec histórico en carpeta `signal-pulse`; canon actual usa `signal_pulse` y MFP. Conservar etiqueta sin instalar otra dirección activa. |

## Preservación documental

Se inventariaron **110 archivos / 2,289,848 bytes** que estaban untracked al inicio. Se revisaron rutas, tipos, encabezados y contexto; no se afirma revisión semántica línea por línea de las bitácoras extensas. Por eso se conservan fuera de Git sin publicarlos en bloque. [Manifiesto](MFP_WS0_HISTORICAL_INVENTORY_2026-10-04.tsv): ruta, tamaño, SHA256, categoría y título. La copia privada de cada archivo está en `~/Downloads/noisia-archive-2026-10-04/mfp-ws0-untracked-2026-10-04/`, conserva su ruta relativa y cuenta con `MANIFEST.tsv`. Directorio raíz 0700, archivos 0600; se verificó hash origen=copia para 110/110. Los originales permanecen intactos y untracked. No se leyó ningún JSONL histórico de Codex ni se buscaron claves en conversaciones.

La preservación byte a byte **no** acredita ausencia de datos privados ni convierte prompts o recibos antiguos en canon. El spec v1.3 y el banner nuevo de AGENTS fijan la precedencia actual.

## Limpieza remota preparada

Verificados por `git ls-remote` los HEAD y etiquetas remotas a 2026-10-04. Cada rama propuesta tiene una etiqueta remota con el mismo SHA. El lease evita borrar una punta que haya avanzado. Root decide y ejecuta tras revisión; si el lease falla, volver a comparar, nunca forzarlo a ciegas.

```bash
git push --force-with-lease=refs/heads/codex/archive-storage-migration-2026-09-10/front-recovery-p0:c0fc67106a145de045854da29b8435555307731d origin :refs/heads/codex/archive-storage-migration-2026-09-10/front-recovery-p0
git push --force-with-lease=refs/heads/codex/archive-storage-migration-2026-09-10/front-recovery-p0g1-harness:571486375c089e8af351e350ea2ce878feab26e7 origin :refs/heads/codex/archive-storage-migration-2026-09-10/front-recovery-p0g1-harness
git push --force-with-lease=refs/heads/codex/archive-storage-migration-2026-09-10/pre-reconcile-20260820-0850:eedc9d21a659b061baba59a68c7d7819e374cb59 origin :refs/heads/codex/archive-storage-migration-2026-09-10/pre-reconcile-20260820-0850
git push --force-with-lease=refs/heads/codex/backup-incremental-editorial-runtime-2026-09-10:070c94eee9759801f2586760475822eccbdd1d6d origin :refs/heads/codex/backup-incremental-editorial-runtime-2026-09-10
git push --force-with-lease=refs/heads/codex/backup-local-history-storage-migration-2026-09-10:73e3951109249538ba1e29d9e34e6a0593456b82 origin :refs/heads/codex/backup-local-history-storage-migration-2026-09-10
git push --force-with-lease=refs/heads/codex/backup-noi19-storage-migration-2026-09-10:256f0922a72071bd450042245f103f4f12e924d0 origin :refs/heads/codex/backup-noi19-storage-migration-2026-09-10
git push --force-with-lease=refs/heads/codex/fix-csv-upload-prod:aa44b7ee6796a1fabf4d198f9a2215bc60828646 origin :refs/heads/codex/fix-csv-upload-prod
git push --force-with-lease=refs/heads/codex/interest-membership-2026-10-02:59b7375f2f18ccdce6bc0f96ff577f242ec882c3 origin :refs/heads/codex/interest-membership-2026-10-02
git push --force-with-lease=refs/heads/codex/noisia-editorial-batches-2026-09-26:fd9ebef0e58fed88eb1415dafbd571f626a34da3 origin :refs/heads/codex/noisia-editorial-batches-2026-09-26
git push --force-with-lease=refs/heads/codex/noisia-signal-from-import-2026-09-24:a5d776a93df6009b643b55ad555fa0c8e70b63ef origin :refs/heads/codex/noisia-signal-from-import-2026-09-24
git push --force-with-lease=refs/heads/codex/topic-legacy-screening-inspector-2026-09-27:415c7a7e379f47e500513a75a12947e44d64edf8 origin :refs/heads/codex/topic-legacy-screening-inspector-2026-09-27
git push --force-with-lease=refs/heads/docs/signal-pulse-spec:4dbf6699663a0748671fb5f52e6af9762d3f177c origin :refs/heads/docs/signal-pulse-spec
git push --force-with-lease=refs/heads/feat/pitch-kit:0cdf4ebb4b109b884531b9f5e6a267120c28fdde origin :refs/heads/feat/pitch-kit
```

Conservar `main`, `develop`, `feat/mfp-*` activos y la rama del PR #14 mientras exista. Root retirará `uat-editorial-polling` mediante las herramientas de la app y luego la rama local `codex/interest-membership-2026-10-02`, verificando primero trabajo/procesos pendientes. También consta un checkout antiguo `~/Downloads/noisia-product` en main: no creado por MFP; root debe comprobar su uso antes de retirarlo. Este corte no lo borra.

La aceptación final de §9.0 (`git branch -a` sólo con ramas permitidas) **sigue pendiente** hasta ejecutar la limpieza. El candidato UTC y el foco móvil continúan identificados, sin claim de entrega funcional.
