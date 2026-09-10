# Prompt Looping

## Ampliación operativa vigente — 2026-09-07

El operador adoptó el [Compass self-service](./COMPASS_SELF_SERVICE_2026-09-07.md),
nutriendo el handoff y este sistema de memoria. Su instrucción vigente gobierna sobre
roles/gates históricos inferiores. Consultar [plan](./PLAN_SELF_SERVICE_MONITORING_2026-09-07.md),
[orquestación](./ORCHESTRATION_SELF_SERVICE_2026-09-07.md), [mapa Linear](./LINEAR_SELF_SERVICE_MAP_2026-09-07.md)
y STATE/CURRENT/NEXT antes de actuar. Noisia V02 MAIN coordina; nuevas tareas Frontend y
Backend preparan frentes separados. Mantener puntos de lectura y añadir decisiones,
sin reemplazar los diálogos o recibos originales. Incrementalidad y descubrimiento sobre
todo corpus son parte obligatoria del producto self-service. Loop pausado durante esta
preparación; los prompts de relevo inferiores no autorizan implementación automática.

## Sistema original conservado

Sistema de relevo nocturno entre el agente Backend y el agente auditor de Noisia.

No reemplaza el North Star, los ADR ni el execution plan. Esta carpeta sólo conserva
el estado operativo de la siguiente transición autorizada y evita que un agente
continúe por inercia, parchee para que "jale" o repita trabajo pagado.

## Autoridad

En caso de contradicción gobiernan, en este orden:

1. `AGENTS.md` y los `AGENTS.md` anidados.
2. `docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md`.
3. `docs/product/55_SIGNAL_ACQUISITION_SEMANTIC_CASCADE_AND_TOPIC_CONTRACTS.md`.
4. `docs/product/56_SIGNAL_SEMANTIC_CASCADE_EXECUTION_PLAN.md`.
5. ADR y documentos canónicos del gate en curso.
6. `CURRENT_PROMPT.md`.
7. `NEXT_PROMPT.md`.

## Roles

### Backend

- Implementa únicamente `CURRENT_PROMPT.md`.
- Demuestra invariantes con pruebas y evidencia real.
- No se declara aprobado a sí mismo.
- No decide el siguiente gate.

### Auditor

- Espera el resultado del Backend.
- Revisa diff, contratos, tests, evidencia y estado remoto pertinente.
- No opera directamente la interfaz de Preview/UAT.
- Delega el recorrido visual y operator-safe al Insights Manager Agent y audita su
  evidencia, hallazgos y acciones antes de aceptar el gate.
- Distingue `pass`, `needs_correction`, `blocked` y `unsafe_to_advance`.
- Si pasa, actualiza el estado y redacta el siguiente prompt seguro.
- Si no pasa, reemplaza el siguiente prompt por una corrección de causa raíz.
- Puede enviar el siguiente prompt al Backend sólo cuando no amplíe autoridad.

### Insights Manager Agent

- Task canónica actual: `01a03cc2-8240-7a83-b295-4fd2826323cc`
  (`Insights Manager UAT QA v8 — Locale Authority`).
- La task v7 `01a038ba-7579-7972-a63f-43b68be131fb` queda preservada como evidencia
  de bloqueo de entrega y no recibe trabajo adicional.
- La task v6 `01a03807-f0fa-7923-a857-eb632c1cb0fc` queda preservada como evidencia:
  ejecutó un turno largo y un único retry de entrega, ambos sin payload visible; no
  recibe trabajo adicional.
- La task v5 `01a031d1-f053-7081-9cbf-6c01bae048d8` queda preservada como
  evidencia de un bloqueo de entrega anterior y no recibe nuevas mutaciones.
- Las tasks v1 `01a0273e-ec13-7313-931b-30e07593ecf5`, v2
  `01a02fc9-d30f-7aa3-9d5b-ee6e7d6044d7`, v3
  `01a03079-fe71-7e50-832c-8a6891d4ee81` y v4
  `01a0315e-c70c-7272-9119-9ffe803fbca6` quedan preservadas como evidencia de fallos
  de output/runtime y no deben recibir nuevas delegaciones.
- Opera la interfaz autenticada de Preview/UAT como un Insights Manager humano.
- Ejecuta QA funcional, visual, responsive y de persistencia conforme al prompt del
  auditor; documenta pasos, decisiones, errores y evidencia observable.
- No modifica código, contratos, migraciones, infraestructura ni canon.
- No llama providers ni confirma presupuesto salvo que el prompt delegado lo autorice
  explícitamente dentro del presupuesto nocturno restante.
- No abre holdout, publica conocimiento, cambia serving ni toca producción.

## Máquina de estados

```text
backend_running
→ backend_reported
→ audit_in_progress
→ passed | needs_correction | blocked
→ next_prompt_ready
→ backend_running
```

## Presupuesto nocturno de providers

El operador autoriza hasta **USD 20 agregados** durante el loop nocturno. No es una
autorización para gastar por inercia:

- cada corrida debe tener propósito verificable, preflight gratuito y flight card;
- el hard cap de cada corrida debe ser menor o igual al presupuesto agregado restante;
- `STATE.md` registra reservado, liquidado y restante;
- una falla pagada nunca se repite automáticamente;
- una nueva llamada sólo procede si es necesaria para el siguiente gate y no puede
  sustituirse por evidencia ya persistida, provider fake o validación local;
- al alcanzar USD 20, toda llamada adicional vuelve a ser stop gate humano.

Backend ejecuta trabajo técnico. El Insights Manager Agent opera cualquier confirmación
o recorrido de interfaz que el gate requiera. El auditor nunca simula esa separación de
roles haciendo ambas cosas.

## Frontera de credenciales y capacidades Claude

Existen dos carriles separados y no intercambiables:

1. **Producto Noisia.** Studio y Workers usan exclusivamente la credencial Anthropic del
   runtime de producto configurada para el ambiente correspondiente. Esta credencial
   ejecuta Query Composer, Semantic Context, T&B u otros flujos explícitos del producto.
2. **Desarrollo y auditoría.** Codex/Backend usan una credencial separada, destinada sólo
   a Advisor, revisión adversarial y desbloqueo técnico. Nunca se inyecta en Studio,
   Workers, Railway ni en una corrida que produzca estado de producto.

El carril de desarrollo exige `NOISIA_CODEX_ADVISOR_ANTHROPIC_API_KEY` y el boundary
canónico `tools/codex-advisor/credential-lane.mjs`. Los runners nuevos reciben únicamente
el `process.env` explícito del proceso: no cargan `.env` de Studio/Workers, no heredan la
credencial de producto y fallan antes de crear transporte si falta la credencial dedicada
o si coincide con la del runtime de producto. `ADVISOR_PREFLIGHT_ONLY` nunca concede
autoridad. Los runners históricos bajo `.data/` permanecen evidencia inmutable y no son
plantillas válidas para nuevas revisiones.

Ningún log, prompt, evidence pack, commit o salida de task puede imprimir o copiar el
valor de cualquiera de las dos credenciales. La identidad del carril se prueba mediante
configuración sanitizada y comportamiento, no mostrando secretos.

Capacidades Anthropic evaluadas:

- **Advisor Tool:** reservado para coordinación agentic de desarrollo cuando el executor
  necesita una corrección estratégica durante una tarea larga. Sus límites de uso y
  tokens deben sellarse por request y contabilizarse también a nivel de sesión.
- **Message Batches:** candidato para trabajo offline con muchas requests independientes;
  no sustituye una acción interactiva de una sola corrida ni su autoridad durable. Su
  adopción requiere ADR por latencia, retención temporal y recuperación.
- **Prompt caching:** candidato cuando varias requests reutilizan un prefijo estable de
  Brand OS/Knowledge o herramientas. No sustituye snapshots, digests, idempotencia,
  lineage ni validación del output.

Referencias oficiales:

- https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool
- https://platform.claude.com/docs/en/build-with-claude/batch-processing
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## Stop gates

El loop se detiene y requiere autorización humana ante cualquiera de estos casos:

- producción;
- gasto de providers que exceda el presupuesto agregado restante de USD 20;
- corrida pagada sin preflight, flight card, propósito o hard cap sellado;
- apertura de holdout;
- publicación de Semantic Context, Topic Contracts o Signal;
- serving writes;
- cambio de readers, pointers, bindings o read mode;
- migración destructiva o pérdida de evidencia;
- modificación de AuthZ, secretos o infraestructura con alcance ampliado;
- decisión estratégica o comercial no contenida en el canon;
- conflicto con cambios preexistentes del usuario.

## Archivos

- `GOALS.md`: objetivos estables de cada rol.
- `STATE.md`: gate activo, task vigilada y último veredicto.
- `CURRENT_PROMPT.md`: contrato ejecutable actual.
- `NEXT_PROMPT.md`: siguiente trabajo propuesto; no se considera autorizado por existir.
- `LOOP_LOG.md`: bitácora append-only de checks y decisiones.

## Regla fundamental

Una entrega larga, tests verdes o un manifest no equivalen a un gate aprobado. El
auditor debe comprobar el comportamiento y las invariantes relevantes antes de avanzar.
La comprobación de interfaz proviene del Insights Manager Agent; el auditor valida esa
evidencia pero no suplanta al operador.
