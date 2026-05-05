# Design.md — Noisia Knowledge Base

> Inspirado en [google-labs-code/design.md](https://github.com/google-labs-code/design.md): un meta-documento que le da a una IA o a un humano nuevo el contexto necesario para operar dentro de un sistema antes de tocarlo.

Este archivo no describe metodologías. Describe **cómo está pensado** el KB que las contiene, y cómo se opera dentro de él.

---

## 1. Goals

- **G1 — Continuidad cero-fricción.** Un nuevo analista, o una nueva IA, debe poder ejecutar una metodología Noisia sobre un corpus en menos de 1 hora de lectura, sin asistencia humana.
- **G2 — Trazabilidad de cambios metodológicos.** Cada modificación a un protocolo queda en `git log` con razón. No hay "los criterios cambiaron en algún momento" — hay un commit con fecha y hallazgo.
- **G3 — Separación marketing / operación.** Lo que cuenta el sitio público y lo que ejecuta el equipo viven en archivos distintos, con auditorías independientes.
- **G4 — Atomización por metodología.** Cada metodología es independiente. Una IA puede correr Triggers & Barriers sin haber leído Cultural Codes Decoding.

## 2. Non-goals

- **No es un manual de capacitación.** No reemplaza la conversación con un senior la primera vez. Asume contexto profesional (research, semiótica básica, behavioral economics general).
- **No es un repositorio de casos resueltos.** Los hallazgos de proyectos reales no entran aquí — entran en repos privados con NDA por cliente.
- **No es código ejecutable.** Los playbooks son lenguaje natural estructurado, no scripts. Si una pieza necesita correr en producción (ej. un parser de reviews), vive en `/src`, no aquí.
- **No es exhaustivo.** Si un edge case aparece menos de 3 veces, no se documenta. La regla 3-strikes evita inflar el KB con micro-reglas.

## 3. Architecture

```
knowledge-base/
├── README.md                ← índice de uso
├── Design.md                ← este archivo
│
├── 00-overview/             ← contexto Noisia (qué somos, qué no, principios)
│   ├── company.md
│   ├── positioning.md
│   └── principles.md        ← qué cuenta como evidencia válida
│
├── 01-methodologies/        ← definición conceptual de cada metodología
│   ├── triggers-barriers.md
│   ├── value-perception-matrix.md
│   ├── journey-friction-mapping.md
│   ├── cultural-codes-decoding.md
│   ├── influence-architecture.md
│   └── decision-velocity.md
│
├── 02-services/             ← cómo se empaqueta el trabajo
│   ├── foundation.md
│   ├── intelligence.md
│   ├── strategy.md
│   └── pricing-logic.md
│
├── 03-process/              ← cómo se opera un proyecto end-to-end
│   ├── diagnostic-protocol.md
│   ├── corpus-construction.md
│   ├── evidence-traceability.md
│   └── delivery-format.md
│
├── 04-cases/                ← qué metodologías corren para cada tipo de pregunta
│   └── use-cases.md
│
└── 05-ai-playbooks/         ← protocolos ejecutables (input → pasos → output)
    ├── run-triggers-barriers.md
    ├── run-value-perception-matrix.md
    ├── run-journey-friction-mapping.md
    ├── run-cultural-codes-decoding.md
    ├── run-influence-architecture.md
    └── run-decision-velocity.md
```

### Por qué esta arquitectura

- **Separación conceptual / operacional.** El archivo `01-methodologies/triggers-barriers.md` cita teoría (Kahneman, Christensen). El archivo `05-ai-playbooks/run-triggers-barriers.md` no — solo dice cómo correrlo. Esto evita que la IA recite teoría en lugar de ejecutar.
- **Numeración por prefijo.** `00`, `01`, `05` no son orden de importancia — son orden de lectura recomendado para alguien que llega cold. Overview primero, playbook al final.
- **Un archivo por metodología, no uno consolidado.** Esto permite cargar selectivamente en una IA sin saturar contexto. Si vas a correr T&B, solo necesitas `triggers-barriers.md` + `run-triggers-barriers.md` + principios.

## 4. Conventions

### 4.1 Formato de archivo de metodología (`01-methodologies/`)

Toda metodología sigue esta estructura:

```markdown
# <Nombre> — <slug>

## Pregunta que responde
Una sola pregunta de negocio en lenguaje del cliente.

## Cuándo aplica
3-5 contextos de decisión donde esta metodología es la lente correcta.

## Cuándo NO aplica
2-3 contextos donde aplicarla sería forzar la herramienta.

## Fundamentos teóricos
Referencias académicas con autor, año, y por qué entra al protocolo.

## Estructura de análisis
Cómo se segmenta el problema. Aquí van los layers internos
(ej. T&B: psicológico → personal → social → cultural).

## Inputs típicos
Qué corpus, qué mínimos, qué fuentes son obligatorias vs. opcionales.

## Outputs típicos
Qué entregables produce y para qué sirven.

## Limitaciones
Lo que esta metodología NO puede responder.

## Lecturas obligatorias
Para alguien que va a operarla por primera vez.
```

### 4.2 Formato de playbook (`05-ai-playbooks/`)

```markdown
# Run <Methodology> — Playbook operativo

## Inputs requeridos
Qué archivos / data debe recibir la IA antes de empezar.
Mínimos viables vs. lo ideal.

## Pre-flight check
Validaciones antes de empezar (ej. tamaño de corpus, balance de fuentes).
Si falla, abortar y reportar — no producir output con corpus inválido.

## Protocolo (pasos numerados)
Cada paso: acción + criterio de éxito + qué hacer si falla.

## Criterios de codificación
Reglas explícitas para clasificar cada pieza de evidencia.
Lo más importante del playbook — aquí vive el rigor.

## Formato de output
Estructura JSON / tabla / narrativa exacta. Ejemplos de cómo se ve un output válido.

## Quality gates
Qué chequea un humano antes de aprobar el output.

## Failure modes conocidos
Qué típicamente falla y cómo se detecta.

## Versionado
Cada cambio significativo al protocolo deja una nota: fecha, qué cambió, por qué.
```

### 4.3 Tono de escritura

- **Imperativo operacional.** "Codifica cada cita como X" — no "se debe codificar". Lenguaje de manual, no de paper.
- **Sin marketing.** Nada de "transformamos data en decisiones." El KB no vende.
- **Ejemplos reales > definiciones abstractas.** Cuando un criterio se pueda volver borroso, dar 2-3 ejemplos canónicos.
- **Español operativo.** Anglicismos cuando son término técnico estándar (corpus, trigger, friction). Castellano para todo lo demás.

### 4.4 Prohibido

- ❌ Cifras de pricing reales en `02-services/pricing-logic.md`. Solo lógica (cómo se calcula), no montos.
- ❌ Nombres de clientes o proyectos reales en cualquier archivo del KB.
- ❌ "TBD" o "pendiente" sin issue asociado en `Design.md → Open questions`.
- ❌ Duplicar contenido entre el sitio público y el KB. Si algo está en el sitio, aquí se referencia, no se copia.

## 5. Cómo una IA debe usar este KB

Cuando un cliente o el equipo le pide a una IA "corre Triggers & Barriers sobre este corpus de reviews", el orden de carga obligatorio es:

1. **`Design.md`** (este archivo) — convenciones del KB.
2. **`00-overview/principles.md`** — qué cuenta como evidencia válida en Noisia, qué se considera ruido, cómo se reporta confianza.
3. **`01-methodologies/<slug>.md`** — qué pregunta responde la metodología, sus layers internos, sus límites.
4. **`05-ai-playbooks/run-<slug>.md`** — ejecutar paso por paso.
5. **(Opcional)** `03-process/corpus-construction.md` si la IA tiene que validar el corpus antes de operar.

Si la IA salta el paso 2, va a producir output técnicamente correcto pero filosóficamente fuera de Noisia (ej. va a tratar sentiment score como insight, va a aceptar testimonios incentivados como evidencia). Eso se rechaza en quality gate.

### 5.1 Patrón de prompt recomendado

```
[adjuntar archivos en el orden de la sección 5]

Tu tarea: ejecutar el playbook <run-X.md> sobre el corpus adjunto.

Antes de operar:
1. Confirma que entiendes los principios de Noisia (cita uno).
2. Confirma que el corpus pasa el pre-flight check.
3. Si algo falla, NO produzcas output — explica qué falla.

Solo después de pasar 1, 2, 3, ejecuta el protocolo y entrega el output
en el formato exacto del playbook.
```

## 6. Decision log

| Fecha       | Decisión                                                                                  | Razón                                                                                |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 2026-05-04  | Separar metodología (concepto) de playbook (operación) en archivos distintos.             | El concepto rota poco; el playbook se afina cada proyecto. Mezclarlos hace drift.    |
| 2026-05-04  | Triggers & Barriers se estructura en 4 capas: psicológico → personal → social → cultural. | Sin estratificación, los analistas codifican todo como "trigger emocional" y se pierden patrones de capa social/cultural que son los que realmente mueven mercados. |
| 2026-05-04  | KB vive en el monorepo del sitio, no en repo aparte.                                      | Trazabilidad junta de cambios de marketing y operación. Si el sitio dice X y el KB dice Y, el commit muestra cuál se desincronizó. |

## 7. Open questions

- **OQ-1**: ¿Los playbooks deben incluir prompts literales o solo protocolos en lenguaje natural? Hoy: lenguaje natural. A revisar tras 3 corridas reales con IA.
- **OQ-2**: ¿Cómo versionar un playbook cuando cambia un criterio de codificación? Hoy: commit message. Evaluar si vale meter `## Changelog` adentro de cada playbook.
- **OQ-3**: ¿Hay un séptimo método emergiendo (Decoding de tendencias)? Si la respuesta llega 3 veces en proyectos distintos, formalizarlo en `01-methodologies/`.
- **OQ-4**: ¿Quién audita el KB y cada cuánto? Hoy: nadie formalmente. Proponer auditoría trimestral con un dueño rotativo.

## 8. Referencias

- [google-labs-code/design.md](https://github.com/google-labs-code/design.md) — formato base de este meta-doc.
- Sitio público de Noisia: `/metodologias`, `/servicios`, `/casos-de-uso`.
- `src/content/site.ts` en este mismo repo — fuente de verdad del contenido público.
