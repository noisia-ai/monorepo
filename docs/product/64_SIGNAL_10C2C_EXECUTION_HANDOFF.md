# Backend 10C.2C — ejecución técnica multi-scope hasta freeze-finalists

> **Fecha del handoff:** 2026-08-21 (`America/Mexico_City`)
> **Rama:** `codex/noisia-data-os-cut-1-uat-2026-08-18`
> **Objetivo:** ejecutar el benchmark 10C.2 ya preregistrado sobre el corpus Amazon
> Alexa multi-scope y producir una decisión técnica reproducible sin abrir 10D.

## Goal sugerido

```text
Ejecutar Gate 10C.2C sobre el corpus multi-scope Amazon Alexa exactamente congelado:
validar y exportar read-only, sellar la autorización externa de ejecución, correr smoke,
calibration y full, congelar finalistas y producir evidencia reproducible. No abrir
holdout, no adoptar modelos, no ejecutar 10D, no llamar providers y no escribir serving.
```

## Prompt completo para Backend

Trabaja sobre la rama
`codex/noisia-data-os-cut-1-uat-2026-08-18` del monorepo Noisia.

Lee primero, completos y en este orden:

1. `AGENTS.md` y los `AGENTS.md` anidados aplicables.
2. `docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md`.
3. `docs/product/55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md`.
4. `docs/product/56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md`.
5. `docs/product/62_SIGNAL_10C2_MULTISCOPE_PREREGISTRATION.md`.
6. `docs/product/63_NOISIA_V02_CANONICAL_PRODUCT_PROGRAM_AND_DELIVERY_LAYER.md`, si
   existe en el worktree.
7. `docs/adr/016-signal-local-modeling-gate-sequence-and-contextual-naming.md`.
8. `tools/signal-semantic-lab/README.md`.
9. `tools/signal-semantic-lab/config/benchmark-plan-10c2.json` y
   `benchmark-plan-10c2-v3.json`.

No reabras 10A.4. No vuelvas a diseñar Acquisition Plan. No implementes 10D, 10E, 10F,
frontend, readers o naming con Claude.

### Estado que debes observar antes de actuar

```text
AMAZON_ALEXA_GREENFIELD_ACQUISITION_READY=true
SIGNAL_10C2_PREREGISTRATION_READY=true
SIGNAL_10C2_HARNESS_READY=true
SIGNAL_10C2_STRATEGIC_AUTHORITY_READY=true
SIGNAL_10C2_REAL_EXPORT_PREFLIGHT_READY=true
SIGNAL_10C2_EXECUTION_AUTHORIZED=false
SIGNAL_10C2_EXECUTED=false
SIGNAL_10D_READY=false
```

Corpus esperado:

- Acquisition denominator: `23,296` roots.
- Modeling population: `21,195` roots.
- Quality excluded: `2,101` roots.
- Memberships: `21,820`.
- Particiones obligatorias: primary brand, category, Google Nest y Apple HomePod.
- Population digest:
  `sha256:067fe82f4b8010c0207ef5be17ad62dae0e98b70bdc3bb11971b8038af11c149`.
- Content digest:
  `sha256:76c232dadc63a2f1da659efbdfaed67fdda23bea6308d93e6283bbed60c5e71c`.
- Provenance digest:
  `sha256:8f4902ef5aca4c049c2655e364dcf6ad38e2fb577d74a690f4cf2607f877b4d8`.
- Watermark digest:
  `sha256:974107099028dda1694b1d6d761220aa636353bf01516d867d6fb9e83a807da1`.
- Rights authority digest:
  `sha256:816ded59d915696b7fbe554f34e93e8d8e937cb5f81cbafc9f995a18e79b00b5`.

Si cualquier valor difiere, detente antes de ejecutar modelos y entrega
`SIGNAL_10C2C_RESULT=blocked_digest_or_population_drift`.

### Autorización explícita de esta misión

Al recibir este prompt directamente del operador, queda autorizada únicamente la
ejecución local de las etapas:

```text
smoke → calibration → full → freeze-finalists
```

La autorización debe representarse mediante el artifact externo y digest-sealed
`signal-local-modeling-execution-authorization-v1`, ligado al plan y export manifest
exactos. Debe declarar:

- `provider_calls_allowed=false`;
- `remote_writes_allowed=false`;
- `serving_writes_allowed=false`;
- `ten_d_authorized=false`;
- stages exactos `smoke`, `calibration`, `full`;
- actor pseudonimizado y timestamp real.

No edites `execution_authorized` dentro del plan. No fabriques ni omitas el artifact.

Esta misión **no autoriza**:

- `open-holdout`;
- inspeccionar membresías del holdout;
- generar el blind packet final;
- adoptar un modelo;
- crear un ADR de adopción;
- ejecutar 10D;
- Claude, Anthropic, Voyage u otro provider;
- writes remotos o de serving;
- cambios a production, readers, pointers, governed bindings o read mode.

El holdout debe terminar `sealed`, aun si existen finalistas.

## Ejecución obligatoria

### Gate 0 — higiene y restore lógico

1. Inspecciona `git status`; el worktree puede contener documentación no committeada de
   otro turno. Trátala como user-owned. No hagas reset, checkout destructivo, stash ni
   overwrite.
2. Registra HEAD, branch, digests de los dos planes, lockfile y harness source.
3. Crea un output nuevo timestamped bajo `.data/signal-semantic-lab/backend-10c2c/`.
4. Directorios privados `0700`; archivos con texto, embeddings, manifests y state `0600`.
5. Nunca copies raw text a docs, stdout, Linear o evidence sanitizado.

### Gate 1 — baseline del harness

Desde `tools/signal-semantic-lab`:

1. `uv sync --frozen --extra dev`.
2. Ejecuta Ruff y todo el suite pytest.
3. Valida ambos planes y confirma que el original permanece byte-for-byte.
4. Ejecuta el fixture V2 y su smoke multi-scope.
5. Verifica que no pueda correr un stage sin authorization, que no pueda saltar stages
   y que el holdout no pueda abrirse sin freeze + autorización independiente.

Si encuentras un bug real del harness, corrígelo de forma genérica con regresión. No
cambies corpus, candidatos, thresholds, seeds o stop conditions para hacer pasar el run.

### Gate 2 — preflight y export real read-only

1. Confirma target `noisia-staging` mediante los fingerprints server-owned existentes.
2. Ejecuta:

   ```bash
   pnpm --filter @noisia/studio signal:semantic-benchmark:preflight-v2
   ```

3. Exige `ready=true`, blockers vacíos, cero writes/jobs/providers y los digests exactos.
4. Con aprobación de export read-only, ejecuta una sola vez el export V2 hacia el output
   privado nuevo.
5. Valida JSONL y manifest con `signal-semantic-lab export-v2`.
6. Demuestra que la transacción remota fue `REPEATABLE READ READ ONLY` y no asignó
   transaction ID de escritura.

No reutilices un export cuyo manifest o exporter source digest no coincida. No escribas
ningún flag, policy, binding o row remoto durante esta misión.

### Gate 3 — prepare y autorización externa

1. Ejecuta `prepare` con `benchmark-plan-10c2-v3.json` y el export V2 exacto.
2. Sella plan, export, splits, hardware, lockfile, harness source y embedding cache.
3. Verifica canonical-family leakage = 0 y roots inexplicadas = 0.
4. Materializa el artifact de autorización descrito arriba a partir de esta autorización
   del operador.
5. Ejecuta `authorize-execution` y repítelo para demostrar replay idempotente.
6. Un artifact incompatible debe ser rechazado.

### Gate 4 — smoke

1. Ejecuta `run --stage smoke`.
2. Comprueba las cuatro particiones, locale/market slices, parameters declarados vs
   efectivos, runtime, RAM y safety counters.
3. Rechaza cualquier candidate que fabrique confidence/probabilities o viole un hard
   stop.
4. Un crash debe reanudar desde artifacts completos; no empieces otro run paralelo.

### Gate 5 — calibration

1. Sólo si smoke está completed, ejecuta `run --stage calibration`.
2. Usa exclusivamente train/calibration; holdout continúa sellado.
3. Ranking primario por macro coverage con peso `0.25` por partición; micro sólo como
   complemento.
4. Aplica todos los hard gates preregistrados, no promedios que oculten una partición.
5. Persiste finalistas técnicos; cero finalistas es un resultado válido.

### Gate 6 — full multi-seed

1. Sólo si calibration está completed, ejecuta `run --stage full`.
2. Ejecuta únicamente finalistas de calibration y las tres seeds pinneadas.
3. Conserva resultados parciales reanudables, pero nunca los presentes como completos.
4. Stop hard por candidate cuando runtime > 8 horas o peak RAM > 14,495,514,624 bytes.
5. Recalcula stability, coverage por partición, topics efectivos, diversity,
   stopword dominance, largest-cluster share y cluster separation.

### Gate 7 — freeze-finalists, sin holdout

1. Ejecuta `freeze-finalists` después de full/multi-seed completed.
2. Sella finalists, full summary y stability digests.
3. Si la lista queda vacía, registra `no_adoption`.
4. Si existe al menos un finalista que pasó todos los gates, registra
   `finalists_frozen_operator_holdout_authorization_required`.
5. No ejecutes `open-holdout`, `packet` ni adopción.

### Gate 8 — reporte y validación final

Genera report/notebook únicamente desde artifacts guardados y sin abrir holdout. El
reporte debe separar con precisión:

- población total, modeling y quality excluded;
- memberships y roots físicas;
- métricas macro y micro;
- slices por scope, entity, locale, mercado y plataforma;
- resource rejection vs quality rejection;
- technical finalist vs adoption;
- `not_available` vs cero observado.

Ejecuta al final:

- Ruff y pytest completos del laboratorio;
- tests focales Studio del export V2;
- Studio typecheck;
- Query Engine, DB y Studio tests sólo si tocaste esos paquetes;
- `git diff --check`;
- secret scan focal de nuevos artifacts/docs;
- verificación SHA-256 de todo el evidence manifest.

## Resultado permitido

Exactamente uno:

### A. Finalistas técnicos congelados

```text
SIGNAL_10C2C_TECHNICAL_RESULT=finalists_frozen
SIGNAL_10C2_EXECUTION_AUTHORIZED=true
SIGNAL_10C2_EXECUTED=true
SIGNAL_10C2_HOLDOUT_AUTHORIZATION_REQUIRED=true
SIGNAL_10C2_HOLDOUT_OPENED=false
SIGNAL_10D_READY=false
```

### B. No adoption

```text
SIGNAL_10C2C_TECHNICAL_RESULT=no_adoption
SIGNAL_10C2_EXECUTION_AUTHORIZED=true
SIGNAL_10C2_EXECUTED=true
SIGNAL_10C2_HOLDOUT_AUTHORIZATION_REQUIRED=false
SIGNAL_10C2_HOLDOUT_OPENED=false
SIGNAL_10D_READY=false
```

### C. Bloqueado

```text
SIGNAL_10C2C_TECHNICAL_RESULT=blocked
SIGNAL_10C2_EXECUTED=false
SIGNAL_10C2_HOLDOUT_OPENED=false
SIGNAL_10D_READY=false
```

En los tres casos:

```text
PRODUCTION_ACCESSED=false
PROVIDER_CALLS=0
REMOTE_WRITES=0
SERVING_WRITES=0
READERS_CHANGED=false
POINTERS_CHANGED=false
BINDINGS_CHANGED=false
READ_MODE=legacy
```

## Evidencia y documentación

1. Preserva raw export, text, embeddings y run state sólo en `.data/`, gitignored y
   `0600`.
2. Crea un manifest sanitizado con hashes, conteos, stages, hardware, runtime, RAM,
   safety counters, stop conditions y final status.
3. Actualiza al final `docs/product/62_SIGNAL_10C2_MULTISCOPE_PREREGISTRATION.md` con
   un checkpoint factual append-only.
4. Crea `docs/product/65_SIGNAL_10C2C_EXECUTION_EVIDENCE.md` si el detalle no cabe de
   forma legible en doc 62.
5. No edites los planes firmados ni reescribas historia.
6. Si el worktree tiene cambios previos en North Star/plan/docs 63, no los incluyas en
   tu commit como propios. Reporta el solapamiento y deja la reconciliación para el
   siguiente turno.

Puedes hacer commit y push a la misma rama UAT únicamente de archivos source/tests/docs
que pertenezcan inequívocamente a esta misión y hayan pasado validación. Nunca agregues
`.data`, secrets, exports, embeddings, notebooks privados o credenciales.

## Entrega final

Empieza por el veredicto, no por la lista de archivos. Incluye:

1. resultado A/B/C;
2. reconciliación exacta del corpus y particiones;
3. tabla por candidate/config/seed con hard gates y causa de descarte;
4. runtime, peak RAM, cache hits y reanudaciones;
5. estado sellado del holdout;
6. confirmación de cero providers/writes/serving;
7. tests y checks realmente ejecutados;
8. hashes y rutas privadas del evidence pack;
9. commit/push, si se hicieron;
10. siguiente decisión operatoria exacta, sin comenzar 10D.

No conviertas una noche larga en permiso para ampliar alcance. Termina cuando el
resultado técnico esté demostrado y reproducible.
