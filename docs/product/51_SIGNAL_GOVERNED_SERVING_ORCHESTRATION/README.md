# 51 · Signal Governed Serving Orchestration

> **Estado de partida:** Backend 05A verificado en `noisia-staging`, 2026-08-11.
> **Propósito:** ejecutar Gate C de forma continua, con checkpoints verificables, y
> entregar Gate D listo para que el operador lance una corrida real desde la interfaz.

Esta carpeta reduce handoffs entre tareas sin convertir el rollout en una operación
ciega. El backend recibe un solo prompt maestro, ejecuta cada fase en secuencia, valida,
solicita una revisión independiente de Advisor, corrige y continúa únicamente si el
checkpoint queda verde.

## Punto de partida confirmado

- 0068–0071 están `staging_verified`.
- `noisia-staging` conserva tres bindings current para la view `brand`:
  `brand-monitoring`, `mentions` y `topics-narratives`.
- La promoción, `withdraw-to-bridge` y re-promoción atómicas ya fueron ensayadas.
- Las tres populations derivadas son distintas.
- Operational V1 y su pointer siguen siendo el bridge transitorio.
- Los readers visibles todavía usan legacy.
- Producción no ha sido tocada.

## Archivos

1. [00_MASTER_ORCHESTRATOR_PROMPT.md](./00_MASTER_ORCHESTRATOR_PROMPT.md) — prompt único
   que se entrega al backend.
2. [01_BACKEND_05B_CONTRACT_AND_SHADOW.md](./01_BACKEND_05B_CONTRACT_AND_SHADOW.md) —
   hardening, contrato de serving y shadow module-aware.
3. [02_BACKEND_05C_VISIBLE_CANARY.md](./02_BACKEND_05C_VISIBLE_CANARY.md) — migración
   guarded, canary visible en staging y rollback.
4. [03_BACKEND_06_MULTI_VIEW.md](./03_BACKEND_06_MULTI_VIEW.md) — views `competition`,
   `category` y `all-governed`.
5. [04_GATE_D_OPERATOR_PREFLIGHT.md](./04_GATE_D_OPERATOR_PREFLIGHT.md) — preparación
   del flujo T&B que el operador ejecutará desde la interfaz.
6. [05_ADVISOR_REVIEW_PROTOCOL.md](./05_ADVISOR_REVIEW_PROTOCOL.md) — auditoría
   independiente y control de gasto.
7. [EXECUTION_STATE.md](./EXECUTION_STATE.md) — bitácora durable para reanudar después
   de una compactación sin reconstruir la historia.

## Cómo usarlo

1. Confirmar una sola vez el bloque recomendado `OPERATOR_AUTHORIZATION` del prompt
   maestro. La frase sugerida es: `AUTORIZO EL BLOQUE RECOMENDADO: staging-only y cap
   Advisor agregado de USD 20; producción y corrida T&B pagada permanecen prohibidas.`
2. Entregar al backend únicamente el contenido de
   `00_MASTER_ORCHESTRATOR_PROMPT.md`; el prompt le ordena leer las demás flight cards.
3. El backend actualiza `EXECUTION_STATE.md` después de cada checkpoint.
4. No necesita volver al usuario entre 05B, 05C y 06 si el bloque de autorización cubre
   las acciones necesarias y cada checkpoint queda verde.
5. Debe detenerse ante una stop condition, falta de autoridad, target ambiguo, gasto no
   autorizado o incapacidad de ejecutar la revisión Advisor exigida.

## Qué significa “todo de golpe”

Es una sola misión, no una sola transacción gigantesca. Cada fase conserva un punto de
salida auditable:

```text
05B contract/shadow
  -> Advisor
  -> 05C apply/canary/rollback
  -> Advisor
  -> 06 multi-view
  -> Advisor
  -> Gate D operator preflight
  -> Advisor
  -> READY_FOR_GATE_D_OPERATOR
```

Gate D no encola una corrida pagada. Su salida es una interfaz y flight card verificadas
para que el operador decida presupuesto y lance la corrida real.
