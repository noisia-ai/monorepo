# Completar configuración clásica en una marca existente

Revisión 12 · PR #67 · mfp_estandar · gpt-6.1-sol / medium.

Una organización con ocho acciones MFP puede carecer de las dos que preparan contexto semántico y prototipos de la ruta clásica. El replay de alta devuelve `existing_policy`; habilitar fichas para resolverlo cambiaría la población de descubrimiento. Esta reparación añade una acción explícita en Configuración de la marca, sin activar features ni ejecutar análisis.

Sólo un actor interno activo con rol `noisia_admin`, `founder` o `admin` puede completarla. Marca, workspace y actor proceden del servidor; el cuerpo vacío rechaza identidades, configuración y dinero del navegador. Se vuelve a comprobar autoridad y tenant bajo locks; no se suplanta al creador original. Un cliente con capacidad de solicitar procesamiento sigue rechazado.

El sucesor conserva las ocho acciones, configuraciones, caps, zona presupuestaria y vencimiento; añade exclusivamente el par ausente. El replay no crea versiones nuevas. Política futura o vencida, configuración faltante y trabajo activo impiden mutar. Los owners se consultan por organización, incluida historia: procesamiento semántico, embeddings, preparación, Topics y raw pagados pendientes. Se reutiliza el lector de bloqueos para distinguir un raw pendiente de un recibo corrupto cerrado.

## Evidencia

- Aceptación primero: `e6f78696`, PostgreSQL 17 con esquema completo, PG224 (`39112463100`) rojo esperado: `existing_policy` frente a `provisioned`.
- Reparación integrada con el contrato nullable de #68: `471fdf3f`, CI500 (`39113927678`) y PG235 (`39113927673`) verdes.
- PG real comprueba autoridad, cliente rechazado, grant revocado, queued/running de preparación, queued/running/outcome_unknown de embeddings, queued/processing/validating semánticos, raw pendiente, política futura, preservación, rollback parcial y replay. Fixtures sin transportes y con rollback del censo.
- El commit de cierre añade al recibo esta evidencia y una comprobación explícita de ausencia de nuevas admisiones o runs. Sus gates se verifican sobre la cabeza final antes de integrar.

## Operación y límites

La política aún no cambió en dev-test. Studio y Runner permanecen fijados en `c1989e79`. Estudio real A (cerveza, Brasil) recuperó por UI el archivo almacenado: 480 raíces sin procedencia → 0; 349 incluidas y 131 excluidas originales, IDs/hashes intactos. Hay 10/11 archivos y 113,048/113,338 filas recibidas; el último archivo de 290 no se envió porque el selector IAB deja vacío el campo, también con copia privada de SHA idéntico. No hay import activo. El resumen Datos recibidos requiere refresco separado del historial.

Proyección offline parcial con el estimador puro H1: para un concepto por raíz, todos los pares positivos y una reparación, pertenencia del corte planeado USD436.57–749.99; corpus teórico completo USD4,005.72–6,881.49. Son escenarios, no cotización ni máximo; excluyen fichas y clustering. Estándar y fichas JEV carecen de estimador puro reusable para esta población sin MFP: extracción propuesta en seguimiento separado; no se inventó costo cero.

Consumo de proveedores del corte: USD0; compra: USD0. No hubo inferencia, cambio de ruta por defecto ni activación de política. Cualquier pago espera saldo actual verificable.
