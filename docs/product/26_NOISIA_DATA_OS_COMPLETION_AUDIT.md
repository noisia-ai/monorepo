# 26 · Noisia Data OS Completion Audit

Matriz para decidir si el Goal de **Noisia Data OS Cut 1** puede marcarse completo.
Este documento no sustituye `data-os:release-gate`; lo vuelve legible para producto,
engineering y review.

## Regla De Cierre

El Goal no esta completo hasta que exista un evidence pack de `staging` o `preview`
con:

- `release-gate.json`;
- `"ready_for_production_review": true`;
- `database_format: "postgres_url"` en `evidence-pack-validation.json` y
  `release-gate.json`;
- `data-os:completion-audit` con `"ready_for_goal_completion": true`;
- `completion-audit.json` guardado dentro del evidence pack;
- `requirement_checks` sin ningun item con `"ok": false`;
- `pr-summary.md` libre de UUIDs, DB URLs, API keys y tokens;
- `evidence.md` listo para PR con IDs redactados;
- plan de flags y rollback.

Un smoke local o una DB `throwaway` pueden demostrar preflight tecnico, pero no prueban
preparacion productiva.

## Matriz

| Requisito | Evidencia autoritativa | Estado actual |
|---|---|---|
| Partir de `codex/signal-pulse` | `data-os:verify` `branch_lineage`, `docs/BRANCHES.md`, fork point | Verificado por `git merge-base` cuando la ref existe; verificar antes de PR |
| Data Catalog vivo | Migracion `0035_data_os_foundation.sql`, Drizzle schema, `data-os:verify`, `serving-smoke.json` | Implementado local; requiere staging counts |
| Brand OS catalogado | Tablas `brand_os_*`, backfill, `brand_os_briefs >= 1`, `brand_os_links >= 3` | Implementado local; requiere staging evidence |
| Knowledge Base como datos | `knowledge_chunks`, `knowledge_assertions`, links y usage events | Implementado local; requiere staging evidence |
| Taxonomias y tags versionados | `taxonomies`, `taxonomy_terms`, `record_tags`, `tagging_model_versions` | Implementado local; requiere staging evidence |
| Calidad y lineage | `data_quality_results`, `lineage_edges`, zero failed quality | Implementado local; requiere staging evidence |
| APIs de serving | `/api/data-os/*`, `data-os:serving-smoke`, fallback checks | Build local verde; requiere remote serving smoke |
| Analysis Serving Layer T&B | migracion `0045`, persistencia transaccional Step 6, refs `signal-serving-v2`, Review/Signal/deck compartidos | Implementado local; requiere backfill y smoke sobre output staging |
| Analysis Artifact Graph | migracion `0046`, `analysis-artifacts-v1`, evidencia, relaciones, review y snapshot publicado | Implementado local; requiere aplicar schema, backfill y smoke sobre output staging |
| Shadow mode seguro | `NOISIA_DATA_OS_SHADOW_MODE=true`, live render false, fallback payload | Implementado; requiere staging release gate |
| Review humano antes de cliente | `review-queue.json`, `review-sample.json`, review events de tag/assertion | Flujo implementado; requiere IDs revisados en staging |
| Produccion por PR | PR template, CODEOWNERS, `release-gate.json` | Implementado; PR pendiente |

## Checkpoint WIP (2026-07-20)

El estado de trabajo se preservo en el commit `74bf11a` (`Checkpoint Data OS Cut 1
implementation`) y se respaldo en
`origin/codex/noisia-data-os-cut-1-wip`. Este checkpoint existe para recuperar y
continuar el trabajo; no representa cierre funcional ni autorizacion para abrir una PR
productiva.

Validaciones ejecutadas sobre el checkpoint:

- Gitleaks sobre el contenido staged: cero filtraciones;
- monorepo typecheck: 11/11 paquetes verdes;
- monorepo lint: cero errores y 10 warnings existentes en
  `apps/studio/public/deck/deck-stage.js`;
- DB: 41 pruebas verdes;
- Query Engine: 138 pruebas verdes;
- Studio: 218 pruebas verdes;
- Workers: 112 pruebas verdes;
- `git diff --check`: verde;
- worktree limpio y sincronizado con la rama remota al cerrar el checkpoint.

No se ejecutaron en este checkpoint `@noisia/studio build`, `data-os:verify`,
`data-os:staging-check` ni `data-os:staging-shadow`. Los checks locales anteriores y la
reconciliacion documentada mas abajo siguen siendo evidencia historica, no sustituyen
una nueva corrida contra el estado final de la rama. Data OS Cut 1 permanece en WIP.

## Continuacion Analysis Serving Layer (2026-07-21)

La continuacion posterior al checkpoint conecta la migracion `0045` con Step 6 y con
los consumidores T&B. El alcance local incluye:

- persistencia transaccional de oportunidades estrategicas, Action Studio y sus links
  a findings;
- lectura canonica compartida en Review, Signal, deck y resumen de correo;
- readiness que reconcilia sintesis contra filas canonicas y exige evidencia del
  snapshot;
- nueve `dashboard_data_refs` obligatorios bajo `signal-serving-v2`;
- bloqueo de reescritura in-place para outputs publicados;
- backfill protegido que preserva `published_outputs.payload`, status, version y
  `published_at`.

Este avance sigue siendo WIP hasta correr todos los gates locales del estado final y un
backfill/shadow real en staging o preview. No constituye evidencia productiva.

## Continuacion Analysis Artifact Graph (2026-07-21)

La migracion `0046` agrega el contrato `analysis-artifacts-v1` para que Review y Signal
compartan unidades analiticas direccionables, grupos de evidencia, links a fuentes,
relaciones entre artefactos, eventos editoriales y el snapshot exacto de publicacion.

Step 6 reconstruye el graph dentro de su transaccion y proyecta menciones, entidades de
dominio y relaciones hacia `lineage_edges`. Los assets de Study se registran como
contexto consumido con `claim_specific=false`; la trazabilidad fila/observacion a un
finding sigue pendiente hasta que el contrato de sintesis devuelva IDs explicitos.

La aprobacion global T&B acepta los artefactos de la revision y publicar Signal crea
`published_output_artifacts`. Readiness falla cerrado si el graph falta o si los
artefactos de finding no conservan evidencia dentro del snapshot. El backfill protegido
materializa y congela el graph para outputs historicos sin cambiar payload, status,
version ni `published_at`.

Este bloque es implementacion local. Requiere nuevamente typecheck, lint, tests, build,
`data-os:verify` y evidencia real de backfill/shadow en staging antes de cualquier claim
de completitud.

Validaciones locales de esta continuacion:

- monorepo typecheck: 11/11 paquetes verdes;
- monorepo lint: cero errores y 10 warnings preexistentes del deck estatico;
- monorepo test: todas las tareas verdes; DB 42, Studio 225 y Workers 118 pruebas;
- build de produccion de Studio: verde;
- `data-os:verify`: 12 migraciones, 50 tablas y 62 contratos verificados;
- `data-os:staging-check`: detenido correctamente por ausencia de `DATABASE_URL`,
  target remoto, corpus/output UUIDs y aprobacion explicita del shadow.

## Checks Locales Minimos

Antes de pedir staging:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm --filter @noisia/studio build
corepack pnpm data-os:verify
```

## Evidencia Que Completa El Goal

Desde terminal segura:

```bash
corepack pnpm data-os:staging-check
corepack pnpm data-os:staging-shadow
# si el wrapper se detiene para review humano:
corepack pnpm data-os:staging-finalize
NOISIA_DATA_OS_EVIDENCE_PACK_DIR=.data/data-os-evidence/<timestamp> \
corepack pnpm data-os:completion-audit
```

El paquete final debe contener:

- `staging-check.txt` con `DATABASE_URL_FORMAT=postgres_url`,
  `DATABASE_URL_ENVIRONMENT=remote_redacted` y `ready_for_staging_shadow=true`;
- `candidates.json` con candidato recomendado sin failures;
- `shadow-run.log` con `ready_for_live_api_shadow: true`;
- `analyze.json` con `ready_for_serving_reads: true`;
- `serving-smoke.json` con `ready_for_serving_shadow: true`, fallback checks y
  visibility checks;
- `review-queue.json` redactado;
- `review-sample.json` con `ready_for_release_review_sample: true`;
- `evidence-pack-validation.json` con manifest SHA-256;
- `release-gate.json` con `ready_for_production_review: true`;
- `release-gate.json` con gate `database_format_postgres_url`;
- `completion-audit.json` con `ready_for_goal_completion: true`;
- `completion-audit.json` con `requirement_checks` cubriendo todos los gates de
  `release-gate.json`, incluyendo catalogo, Brand OS, Knowledge Base, taxonomias,
  review humano, serving shadow, fallback, verifier local, formato Postgres,
  flags seguros y manifest SHA-256;
- `pr-summary.md` listo para PR, incluyendo `Database format: postgres_url`.

## Evidencia De Reconciliacion Del Corpus Real (2026-07-15)

Se ejecuto `data-os:reconcile-sources` contra el corpus de validacion de Laika en
staging, sin invocar Claude. Esta corrida valida el contrato de datos previo al ETL;
no reemplaza el shadow de serving ni autoriza produccion.

| Control | Resultado |
|---|---|
| Listening canonico | 4,581 menciones: 3,331 incluidas y 1,250 excluidas |
| Deduplicacion de ingesta | 5,235 duplicados colapsados antes de materializar |
| Cobertura listening | 13 meses, 16 plataformas, cero menciones sin fecha |
| Fuentes cargadas | 13/13 procesadas, cero pendientes y cero fallidas |
| Registros canonicos | 5,999 aceptados, cero en review y cero rechazados |
| Observaciones gobernadas | 19,541 aceptadas; 16 en review; cero rechazadas |
| Lineage del workbook principal | 4,898/4,898 filas con lineage completo |
| Listening mensual | 39 observaciones temporales aceptadas |
| Ventas e-commerce | 204 observaciones temporales, 8 meses |
| Catalogo de producto | 3,730 identidades estaticas y 18,664 observaciones snapshot aceptadas |
| Search demand | 634 observaciones snapshot y 1,004 registros snapshot aceptados |
| Auditoria previa a Claude | `ready_with_warnings`, `ready_for_claude: true`, cero blockers |

El contrato de materializacion es `v3`. Para una fuente mixta distingue por dataset:

- registros temporales que requieren periodo real;
- registros snapshot que requieren fecha de captura;
- identidades estaticas que no deben fingir una serie temporal;
- observaciones numericas snapshot que conservan fecha de captura aunque su entidad
  de catalogo sea estatica.

El workbook principal prueba el caso mixto: ventas conserva 8 meses reales, las
identidades de producto permanecen estaticas y precio/costo/margen quedan como
observaciones snapshot. Ya no se estampa todo el catalogo como si hubiera ocurrido en
la fecha de carga.

Las 16 observaciones en review corresponden a `front_margin_snapshot` con escala
ambigua en valores negativos. Se excluyen de evidencia puntuada y del contexto de
Claude hasta revision humana; no se convierten silenciosamente a porcentaje.

Dominios opcionales sin fuente —web analytics, customer service, organic social,
paid media, CRM, reviews, pricing/inventory y competitive intelligence— se exponen
como `unknown`, nunca como cero. El puente `tb_mention_codings` hacia `record_tags` y
`record_feature_values` se exige despues del coding T&B; antes del primer analisis se
reporta correctamente como no aplicable.

Estado de gates locales de esta evidencia:

- DB typecheck y 41 pruebas: verde;
- Studio typecheck, 202 pruebas, lint sin errores y build de produccion: verde;
- Query Engine: 123 pruebas y typecheck verdes;
- Workers: 112 pruebas y typecheck verdes;
- `data-os:verify`: verde, con DB remota omitida;
- `data-os:staging-check`: bloqueado porque no estan exportados los cinco valores
  operativos del shadow, incluido el output de preview.

Por lo tanto, el corpus esta listo para una prueba controlada de Claude, pero Data OS
Cut 1 **no esta listo para PR de produccion** hasta obtener el evidence pack y
`ready_for_production_review: true` descritos arriba.

## No Cuenta Como Completo

- `data-os:verify` local verde sin staging/preview.
- `data-os:local-smoke` verde sin release gate.
- Evidence pack `throwaway`.
- `evidence.json` crudo pegado en PR o chat.
- Live render encendido antes del gate.
- Review queue sin eventos humanos auditables.
