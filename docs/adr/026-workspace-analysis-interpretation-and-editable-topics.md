# ADR026 — Interpretación y Topics editables en la ejecución del workspace

Fecha: 2026-09-08. Estado: aceptado para implementación local; entrega UAT pendiente.

El motor completo de ADR025 produce agrupaciones calculadas, no nombres editoriales
ni precisión semántica validada. Terminar la ejecución al guardar el modelo dejaba
otro paso operativo fuera del recorrido de Topics. La ejecución existente ahora
puede continuar con interpretación y catálogo, conservando el modo antiguo de
cálculo como evidencia histórica y herramienta local.

## Decisión

Se reutilizan la ejecución, outbox, Worker, almacenamiento privado, artefactos,
registro de modelos y ledger monetario existentes. SQL0139 añade contratos y
protecciones, sin tablas nuevas. El checkpoint de cálculo mantiene la ejecución
en curso. La cobertura completa de interpretación y el catálogo materializado
permiten cerrarla; Signal y clasificación siguen siendo hechos separados.

Cada unidad `lane:stable_cluster_id` se interpreta exactamente una vez por contrato
de solicitud. El digest del grupo incluye toda su membresía. Claude recibe hasta
diez raíces distintas representativas por grupo, incluidas de menor afiliación
cuando existen; todos los grupos se procesan por lotes. El cómputo completo no se
confunde con una revisión semántica de cada mención ni con precisión medida.

Se guardan los bytes de respuesta antes del parseo, con estado de completitud.
El uso de un modelo y precio coincidentes se liquida incluso si su texto no cumple
el contrato. Una respuesta parcial o envío de resultado desconocido conserva su
reserva y no se reenvía automáticamente. Una pérdida del acuse de guardado es
recuperable cuando PostgreSQL confirma el recibo completo; la recuperación lee
el mismo objeto, sin otra solicitud al proveedor.

Los artefactos editoriales enlazan la llamada liquidada, el digest de solicitud,
el checkpoint de cálculo y las unidades exactas. El catálogo verifica esos
vínculos y las citas. Una transacción crea una sola versión con todos los Topics.
No hay adopción individual ni rúbrica obligatoria por grupo. Los Topics existentes,
incluidos sus cambios y archivado, se preservan por identidad de grupo; la nueva
interpretación permanece como evidencia de esa ejecución.

Los Topics emergentes usan `origin=workspace_discovery` y
`scope=all_conversations`. Este ámbito describe el corpus analizado: no inventa
atribuciones de marca, competencia o categoría. `discovery_guidance=false` evita
que los propios resultados se vuelvan guías sin una decisión del usuario. El
editor permite activar esa función. Los intereses anteriores conservan su valor
predeterminado y sus digests; un cambio real de guía cambia la identidad semántica.

La vigencia del motor depende de contexto y guías semánticas, no del UUID físico
del nuevo catálogo. Así, materializar resultados no invalida su ejecución madre.
La selección explícita para Signal no se realiza durante la materialización.

## Consecuencias

La UI distingue cálculo terminado, interpretación, guardado de Topics y catálogo
completo. Antes de conocer los grupos muestra un límite de gasto, con estimación
desconocida, y posteriormente los importes reales del ledger. El servidor controla
proveedor, máximo por ejecución y tope diario; la UI no elige modelo ni tarifas.

Persisten como trabajo siguiente la clasificación de todas las raíces y la
proyección seleccionada hacia Signal, con una distinción explícita entre membresía
calculada y verificación semántica. No se aprueban modelos, tags o datos para
sortear los lectores legacy. El contrato tampoco acredita capacidad de dos millones
de menciones por haber pasado pruebas pequeñas ni completa el monitoreo incremental.
