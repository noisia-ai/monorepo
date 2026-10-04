# WS8 — Evidencia incremental con componente vacío

Spec canónico v1.3; corrección focal sobre `9cb54169`. No se repite fit, embeddings ni interpretación.

## Fallo comprobado

La segunda carga produjo un checkpoint numérico válido con dos componentes: uno con 11 unidades heredadas y otro con cero unidades. El Worker generó y almacenó el descriptor editorial y un stream vacío, pero PostgreSQL rechazó la publicación con `workspace_incremental_editorial_evidence_invalid`. El validador de SQL0148 agregaba cero unidades como `null`; el productor numérico sella `[]`. La evaluación de sólo lectura con `COALESCE(...,'[]')` reprodujo exactamente el digest del checkpoint original. Fuente, censo y las 11 identidades de unidades estaban vigentes.

SQL0242 reemplaza únicamente ese validador, preservando orden, archivos, checkpoint y comprobaciones restantes. Añade un predicado privado que identifica un componente vacío con censo y fuente vigentes. La API permite una nueva solicitud explícita para el fallo exacto cuando se cumple ese predicado. Conserva actor autorizado, source digest, identidad del trabajo y recibo anterior; la nueva operación gratuita queda registrada. Repetir la clave original sigue siendo replay. El drainer no cambia ni reintenta automáticamente errores técnicos por esta corrección.

## Verificación y límites

`scripts/dev-corpus/incremental-empty-component-check.ts --rollback-check --fixture=/ruta/privada.json` está preparado para el runner dev-test con su guard exacto. Lee el descriptor y referencia ya existentes; aplica SQL0242 únicamente dentro de rollback, compara validación anterior/corregida y un control sin componente vacío, comprueba fuente/actor obsoletos, replay, nueva solicitud, mismo trabajo, claim y publicación real en DB. Compara checkpoint, costes y censos completos antes/después del rollback. El negativo de la condición en este harness simula exclusivamente el booleano del predicado; la regresión de integración adicional usa un censo real no vacío y verifica rechazo del mismo error.

El harness no ejecuta Worker, escritura de storage, cola, modelo ni proveedor. Los archivos usados proceden del Worker real anterior. El caso integral del Worker recuperado y el PG remoto siguen pendientes al congelar este recibo; los resultados posteriores se registran en el PR antes de integrar. CI remoto ejecuta typecheck, lint, suites y build. No se declara entrega UAT, aceptación semántica ni finalización del programa.

Coste adicional de diagnóstico/implementación: cero llamadas de proveedor. Estimación orientativa del PG focal: 1–3 minutos, sujeta al rendimiento de la fuente vigente; no impone un máximo del producto.
