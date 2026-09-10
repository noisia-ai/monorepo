# Goals

## Objetivo operativo vigente — 6 de septiembre de 2026

Nota de relevo nocturno: el operador solicitó mover la coordinación a un chat nuevo. La
automatización anterior quedó PAUSED, no se canceló el objetivo. Estado técnico exacto,
pruebas completadas, pendientes y conversación exportada en `HANDOFF_2026-09-06_NEW_CHAT.md`.
La UI C está implementada localmente y sólo falta cerrar su QA/checks; la ejecución real
de sugerencias sigue siendo el siguiente corte. No reiniciar A/B ni confundir local con UAT.

**Entregar en Preview/UAT los resultados de Topics que ya funcionan en el laboratorio,
para que el Insights Manager pueda verlos, entender su evidencia y editarlos.** El resultado
actual es un conjunto de diez candidatos, no diez Topics activados en Signal. Se conserva
el catálogo computacional de115propuestas; Top10 no significa borrar el resto.

La evaluación real, el refinamiento, la importación y el editor con citas exactas ya están
entregados y auditados en UAT (LAB-2X). El puente de candidato a regla de prueba y su editor
también está desplegado (LAB-3A): borrador editable/versionado y ensayo léxico con población y
ejemplos medidos, probado contra PostgreSQL local. El catálogo conjunto también está desplegado
(LAB-3D). Ahora se integra la sugerencia automática de reglas en ese mismo editor: adaptador y
guardado reversible ya auditados localmente (LAB-3E-A/B), UI y ejecución real aún pendientes.
Después sigue validar calidad de clasificación y matching híbrido, siempre
antes de adopción, publicación o serving. No volver a los antiguos lotes de locale ni gates
de autenticación cerrados, ni bloquear producto dummy por exigencias exclusivas de producción.

El operador autorizó continuar, delegar revisiones y desplegar cambios revisados sólo en UAT.
Los cambios del laboratorio no se despliegan en bloque: se arma una entrega focal, se prueban
las migraciones de producto y se comprueba el resultado real. El repositorio con trabajo del
usuario, los resultados fuente y Workers quedan preservados. Front Recovery general sigue
pausado; el editor de candidatos existente sí forma parte de este objetivo.

Presupuesto agregadoUSD20; nueve experimentos enviados y saldo conservadorUSD11.374937.
La entrega actual cuestaUSD0 de proveedor. El estado y siguiente acción exactos viven en
STATE/CURRENT/NEXT; las secciones siguientes conservan contexto histórico del programa,
no una instrucción de repetir fases ya terminadas.

## Dirección arquitectónica del programa original (historia)

Mover el producto fuera de Semantic Context y llegar a candidatos de Topic Contract
gobernados, sin confundir clusters exploratorios con tópicos publicables:

```text
69B.4A preregistro de decisiones
→ 69B.4B canary real de review
→ 69B.5 revisión completa por lotes
→ 69B.6 preflight y publicación sellada en Preview/UAT
→ 10C.3B discovery contextual local
→ 10D semantic cascade shadow local
→ 10E Topic Contract control plane y candidatos gobernados
```

La revisión humana puede ser operada por el Insights Manager QA usando Brand OS,
Knowledge y evidencia gobernada. No se fuerzan rechazos, merges o correcciones para
llenar cuotas. Toda decisión debe tener fundamento visible y rationale operator-safe.

El loop puede avanzar autónomamente entre estos gates si cada uno pasa su evidencia,
auditoría y QA. Debe detenerse ante producción, holdout, Signal serving/readers/pointers/
bindings/read mode, expansión de AuthZ/secretos, gasto agregado superior a USD 20 o una
decisión semántica que no pueda justificarse con la autoridad visible.

## Goal del Backend

Cerrar la autoridad de review y publicación del Semantic Context Pack sin inventar
decisiones. Backend congela baselines, monitorea cada lote, demuestra replay/atomicidad,
verifica preflight sellado y despliega sólo correcciones demostradas. Después de la
publicación UAT, prueba 10C.3B/10D localmente y prepara contratos 10E sin activar serving.
Nunca decide el significado de un elemento ni opera la interfaz en nombre del Insights
Manager.

Condición de término: el pack queda revisado y publicado en Preview/UAT con cero
pendientes/blockers, historial append-only reconciliado y cero efecto downstream; después
10C.3B y 10D entregan evidencia suficiente para abrir candidatos 10E. La sesión se detiene
antes de adoptar/publish/serve esos Topics en Signal.

## Goal del auditor

Vigilar el Backend, auditar 69A.6 contra el canon y el estado real de Preview/UAT,
delegar el recorrido operator-safe al Insights Manager Agent, auditar su evidencia y
decidir una de cuatro salidas:

- `pass`: preparar el siguiente gate seguro;
- `needs_correction`: redactar un prompt correctivo de causa raíz;
- `blocked`: documentar la autoridad o dependencia faltante;
- `unsafe_to_advance`: detener el loop.

El auditor administra el presupuesto agregado de USD 20. Los gates 69B.4–69B.6 no
requieren providers de producto. Puede autorizar publicación exclusivamente en
Preview/UAT cuando el preflight sellado reporte cero blockers y la auditoría independiente
no tenga P0/P1. No autoriza producción, holdout, serving ni cambios de readers/pointers/
bindings/read mode.

Las revisiones Advisor usan únicamente el carril de credenciales de desarrollo. Las
llamadas funcionales de Noisia usan únicamente el carril de producto. Una autorización
de gasto no permite cruzar esos carriles.

## Goal del Insights Manager Agent

Ejecutar la revisión de Preview/UAT como operador humano, usando Brand OS, Knowledge y
evidencia. Primero preregistra un canary, luego persiste sólo las decisiones auditadas y
continúa por lotes de máximo 15. Puede publicar el pack únicamente cuando el auditor le
delegue el gate 69B.6 tras preflight sellado. Nunca abre holdout, cambia serving ni
amplía autoridad.

## Resultado de la sesión

Avanzar tantos gates seguros como permita la evidencia, conservando una cadena legible:

```text
prompt → implementación → validación independiente → QA → veredicto → siguiente prompt
```

La velocidad nunca sustituye trazabilidad, recuperación o autoridad humana. El operador
ya autorizó explícitamente la publicación única del Semantic Context Pack en Preview/UAT
dentro de 69B.6, pero sólo después de cero pendientes/anotaciones abiertas, preflight
sellado y revisión independiente sin P0/P1. El loop se detiene antes de producción,
holdout, propagación, serving o cualquier publicación fuera de ese gate.
