# Noisia — Knowledge Base

Este es el archivo maestro de continuidad operativa de Noisia. Todo lo que no está aquí, o no se ha decidido o vive solo en la cabeza de alguien — y eso es deuda.

## Para qué existe este KB

1. **Continuidad humana**: que cualquier persona nueva del equipo pueda operar con el mismo nivel de criterio metodológico que un senior, sin sesiones de onboarding largas.
2. **Continuidad de IA**: que cualquier modelo (Claude, GPT, otro) al que se le entreguen estos archivos pueda ejecutar una metodología sobre un corpus dado sin reinventar el protocolo.
3. **Trazabilidad de decisiones**: cuando una metodología cambia, queda en `git log` por qué y cuándo.

## Para qué NO existe

- No es marketing. El sitio público (`/metodologias`, `/servicios`, `/casos-de-uso`) es la voz comercial. Aquí se escribe sin filtro de pitch.
- No es código. Es contenido operativo. Si una sección termina necesitando ejecución, vive en `/src`, no aquí.
- No es archivo histórico de proyectos. Los casos reales (con cliente, fechas, hallazgos) NO van aquí — esos viven encriptados o en repos privados por NDA.

## Frontera Git / Drive (desde jul 2026)

Este KB es el **KB técnico y metodológico**. Existe un segundo KB, el **comercial**, que vive en
Google Drive y no en este repo.

| Vive en **Git** (aquí) | Vive en **Drive** (KB comercial) |
| ---------------------- | -------------------------------- |
| Cómo se ejecuta una metodología (playbooks) | Guion de venta, objeciones, tono comercial |
| Principios de evidencia, corpus, trazabilidad | Catálogo comercial con precios reales |
| Definición conceptual de las 6 metodologías | Clientes, pipeline, notas de reuniones |
| Modelo de producto y lógica de pricing **sin montos** | Montos, márgenes, descuentos |
| Formato de entrega y quality gates | Transcripts y minutas |

Dos razones, y las dos importan:

1. **Este repo es público.** Nada con nombre de cliente, monto real o estrategia comercial puede
   pasar por aquí.
2. **El equipo comercial no es técnico.** Pedirle que edite markdown vía git para actualizar un
   precio garantiza que el KB se desactualice. En Drive lo edita quien lo necesita, y Claude o
   ChatGPT lo leen conectados a la carpeta.

El punto de contacto entre los dos es `02-services/product-model.md`: los nombres de las líneas
y de los productos se definen aquí — porque el producto y el pitch tienen que decir lo mismo — y
se copian al KB comercial cuando cambian.

## Estructura

```
knowledge-base/
├── README.md                   ← este archivo
├── Design.md                   ← meta-doc: cómo está pensado este KB y cómo usarlo
├── 00-overview/                ← qué es Noisia, posicionamiento, principios
├── 01-methodologies/           ← las 6 metodologías propietarias (definición + teoría)
├── 02-services/                ← modelo de producto (Reportes/Estudios/Data), tiers, pricing
├── 03-process/                 ← diagnóstico, corpus, trazabilidad, entrega
├── 04-cases/                   ← los 6 use cases (qué metodología corre cada uno)
└── 05-ai-playbooks/            ← protocolos ejecutables por una IA o analista nuevo
```

## Convención de archivo doble

Cada metodología vive en **dos** archivos:

- `01-methodologies/<slug>.md` — definición conceptual, fundamentos teóricos, cuándo aplica, qué responde, qué entrega. Audiencia: equipo Noisia, clientes, lectores curiosos.
- `05-ai-playbooks/run-<slug>.md` — protocolo ejecutable. Inputs requeridos, pasos numerados, criterios de codificación, formato exacto del output, quality gates, failure modes. Audiencia: IA o analista que va a correrlo cold.

La separación importa: el conceptual rota poco (la teoría no cambia). El playbook rota más rápido (los criterios de codificación se afinan con cada proyecto).

## Cómo aportar

1. Toda edición **de este KB** pasa por `git`. El KB comercial se edita en Drive; no se duplica
   contenido entre los dos (ver "Frontera Git / Drive" arriba).
2. Si afinas un playbook por aprendizajes de un proyecto, anota el contexto en el commit message — no en el archivo. El archivo se queda en presente operativo, no en historial.
3. Si encuentras una contradicción entre el sitio público y este KB, **el KB manda**. El sitio se actualiza, no al revés.
4. Si una decisión metodológica está pendiente, va en `Design.md` → "Open questions". No en un .md suelto.

## Cómo lo lee una IA

Cuando le pidas a un modelo que ejecute una metodología, el orden de carga es:

1. `Design.md` (entiende las convenciones del KB)
2. `00-overview/principles.md` (entiende qué cuenta como evidencia válida en Noisia)
3. `01-methodologies/<slug>.md` (entiende qué pregunta responde la metodología)
4. `05-ai-playbooks/run-<slug>.md` (ejecuta)

Si una IA salta el paso 2, va a producir output que técnicamente sigue el playbook pero no respeta los principios operativos de Noisia. Eso es lo que separa una corrida buena de una corrida ejecutable.

## Estado del KB

Última auditoría: ver `git log knowledge-base/`.
Si llevas más de 60 días sin auditar este KB y Noisia sigue operando, hay drift. Auditar significa: leer cada archivo y validar contra cómo realmente se está operando hoy.
