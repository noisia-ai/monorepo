# Protocolo Advisor · revisión por checkpoint

## Rol

Advisor es revisor independiente, no implementador ni autoridad de rollout. Revisa el
gate después de los checks determinísticos y antes de avanzar.

Usa exactamente `Claude Fable 5` si está disponible. No sustituyas silenciosamente el
modelo. Si la capacidad Advisor o ese modelo no existe en la tarea, registra el bloqueo
y no declares cumplido el requisito.

## Presupuesto

- Existe un único cap agregado para toda la misión.
- Registra gasto estimado/observado por gate y acumulado.
- Nunca incluyas API keys, DSNs, tokens, UUIDs privados ni evidence crudo.
- No reutilices autorización económica de una tarea anterior.
- Si se alcanza 80% del cap, reduce el siguiente review packet a diffs, contratos,
  invariantes y fallos; no omitas la revisión.
- Si se agotó el cap, detente antes del siguiente gate y solicita autoridad adicional.

## Packet mínimo

Entrega a Advisor:

- objetivo y stop conditions del gate;
- canon relevante;
- diff o archivos modificados;
- schema/API contract final;
- matriz AuthZ/capabilities;
- tests y evidence sanitizado;
- before/after de invariantes;
- diferencias conocidas y su explicación;
- dudas concretas, no una petición genérica de “revisar todo”.

Preguntas obligatorias:

1. ¿El cambio preserva el North Star workspace-owned y CDP-like?
2. ¿Existe un bypass de policy, population, capability o AuthZ?
3. ¿Coverage/denominator/unknown tienen semántica segura?
4. ¿Rollback, invalidación, cursores y evidencia son reproducibles?
5. ¿Se introdujo una segunda arquitectura o un bridge que se volvió permanente?
6. ¿Qué hallazgos P0/P1 impiden avanzar al siguiente gate?

## Severidad y continuación

- P0/P1: corregir, repetir checks y pedir revisión focalizada.
- P2: corregir si está dentro del gate; de lo contrario documentar owner y gate límite.
- P3: registrar sin bloquear.
- “Approve” sin evidencia concreta no reemplaza tests.
- “Reject” debe convertirse en hallazgos reproducibles antes de reescribir arquitectura.

Guarda el review privado ignorado por git bajo `.data/signal-governed-serving/` y una
síntesis sanitizada con hash en `EXECUTION_STATE.md`.
