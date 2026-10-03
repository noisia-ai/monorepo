# Prompt maestro · Gate C continuo → Gate D listo para operador

Usa este prompt completo en la tarea que implementará backend.

---

Eres el responsable de ejecutar de forma continua Backend 05B, Backend 05C, Backend 06
y el preflight de Gate D del North Star de Signal. No esperes un nuevo handoff después
de cada fase: implementa, valida, solicita auditoría de Advisor, corrige y continúa sólo
cuando el checkpoint anterior quede verde.

## OPERATOR_AUTHORIZATION

Éste es el bloque recomendado para completar 05B, 05C y 06 sin nuevos handoffs. Sus
valores se convierten en autoridad sólo si la persona que entrega el prompt confirma
explícitamente: `AUTORIZO EL BLOQUE RECOMENDADO`.

```yaml
target: noisia-staging
allow_production_reads: false
allow_production_writes: false
allow_forward_only_staging_migrations: true
allow_staging_policy_or_binding_writes: true
allow_visible_staging_canary: true
allow_commit_or_push: false
allow_paid_tb_run: false
advisor_model: Claude Fable 5
advisor_total_budget_usd: 20
```

La persona que entregue este prompt puede reducir los permisos o el cap. Si no incluyó
la frase de confirmación, pregunta una sola vez antes de cualquier gasto o escritura
remota. No interpretes un cap anterior de otra tarea como autorización vigente. USD 20
es el máximo agregado de toda la misión, no un presupuesto por gate.

## Canon obligatorio

Lee completos antes de actuar:

- `AGENTS.md` y todos los `AGENTS.md` aplicables;
- `docs/AGENT_GUARDRAILS.md`;
- `docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md`;
- `docs/product/42_SIGNAL_WORKSPACE_DATA_OWNERSHIP.md`;
- `docs/product/43_SIGNAL_V2_FRONTEND_SYSTEM.md`;
- `docs/product/44_SIGNAL_WORKSPACE_DATA_PLANE_HANDOFF.md`;
- `docs/product/47_SIGNAL_WORKSPACE_STAGING_REHEARSAL.md`;
- `docs/product/49_NOISIA_WORKSPACE_OS_BRANCH_CONTEXT_HANDOFF.md`;
- `docs/product/50_SIGNAL_GOVERNED_VIEWS_AND_POPULATION_POLICIES.md`;
- todos los archivos de
  `docs/product/51_SIGNAL_GOVERNED_SERVING_ORCHESTRATION/`.

Preserva el worktree existente. No edites ni reviertas cambios ajenos. No modifiques
0068–0071: cualquier DDL correctivo es forward-only. Nunca uses producción como fixture.

## Protocolo de ejecución continua

1. Lee `EXECUTION_STATE.md` y verifica el estado real del repo y de staging.
2. Ejecuta las flight cards en este orden exacto:
   - `01_BACKEND_05B_CONTRACT_AND_SHADOW.md`;
   - `02_BACKEND_05C_VISIBLE_CANARY.md`;
   - `03_BACKEND_06_MULTI_VIEW.md`;
   - `04_GATE_D_OPERATOR_PREFLIGHT.md`.
3. Después de cada flight card:
   - ejecuta todos sus checks;
   - crea evidence privado/sanitizado con hashes;
   - aplica `05_ADVISOR_REVIEW_PROTOCOL.md`;
   - corrige todos los hallazgos P0/P1;
   - repite tests y revisión focalizada;
   - actualiza `EXECUTION_STATE.md`.
4. Continúa automáticamente al siguiente gate sólo si:
   - el checkpoint está verde;
   - `unexplained_count=0` donde corresponda;
   - Advisor no conserva hallazgos P0/P1;
   - la siguiente fase está autorizada;
   - no se violó ningún invariante protegido.
5. Un warning o diferencia legacy explicada no obliga a parar. Regístrala con evidencia.
6. Si una stop condition se repite tres veces sin una corrección segura, detente y
   entrega el estado exacto. No reduzcas guards ni inventes evidencia para continuar.

## Reglas arquitectónicas globales

- El browser puede enviar una `view_key` cerrada cuando el contrato lo permita, pero
  nunca `population_id`, `policy_bundle_id`, `binding_id`, read mode o SQL/policy.
- La DB y el boundary autenticado resuelven workspace, módulo, view, policy, population,
  capabilities y AuthZ.
- Las populations/materializaciones son estado derivado; policies y bindings son la
  autoridad.
- Cada response gobernada declara population, policy, watermark, coverage y denominator.
- `unknown`, `abstained` y `not_available` nunca se convierten en cero.
- Permiso para métricas no implica permiso para listado, excerpt o texto.
- Cualquier evidence visible debe respetar la intersección de capabilities aplicables.
- No se exige igualdad con legacy contaminado; se exige corrección V2 y cero diferencias
  inexplicadas.
- No crear una population física por cada filtro o facet.
- No ejecutar LLMs, Workers, Voyage o T&B salvo que una flight card lo autorice
  explícitamente. Este plan nunca autoriza la corrida T&B pagada.

## Mutaciones remotas

Antes de cualquier escritura en `noisia-staging`:

- reconcilia direct/pooler por fingerprint sanitizado;
- confirma target y base exactos;
- exige restore point fresco y registra edad;
- captura conteos y digests protegidos;
- usa runner guarded, advisory lock, transacción, ledger, checksum y sentinels;
- demuestra before/after y rollback operativo.

Si la autorización correspondiente es `false`, completa el trabajo local/read-only y
detente en `READY_FOR_OPERATOR_AUTHORIZATION` sin ejecutar esa mutación.

## Salida final

No entregues cuatro handoffs extensos. Mantén el detalle en `EXECUTION_STATE.md` y en el
evidence pack. Al final informa de forma compacta:

- veredicto por gate;
- migraciones y acciones remotas realmente ejecutadas;
- estado visible final y rollback;
- views disponibles y sus contratos;
- checks y Advisor reviews;
- riesgos restantes;
- `READY_FOR_GATE_D_OPERATOR=true|false`;
- instrucciones exactas para que el operador lance T&B desde la interfaz, si está listo.

Detente antes de encolar o pagar una corrida T&B.
