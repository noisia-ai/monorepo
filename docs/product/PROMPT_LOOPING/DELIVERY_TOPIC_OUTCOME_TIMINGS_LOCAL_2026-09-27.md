# Tiempos por etapa de resultados editoriales — corte local

Fecha: 2026-09-27

## Cambio

El GET paginado de resultados editoriales expone `Server-Timing` para separar el tiempo de acceso al workspace, conexión PostgreSQL, apertura del snapshot, censo/autorización, resolución del dueño editorial, lectura de decisiones, citas, mapeo de citas, commit y armado de respuesta. El endpoint conserva exactamente el contrato y el cuerpo actuales.

Los nombres de fase y duraciones no incluyen workspace, ejecución, IDs de grupos o menciones, citas, texto, SQL, parámetros, errores internos ni credenciales. La instrumentación está en el camino de lectura; el callback no puede cambiar el resultado si falla. Esto permite que la medición autenticada en UAT identifique una etapa concreta antes de optimizar consultas o caché.

## Verificación local

- Pruebas combinadas de resultados editoriales y control V2: 53/53 PASS.
- Typecheck de Studio: PASS.
- ESLint focal: PASS.
- `git diff --check`: PASS.

## Límite y siguiente corte

Sigue LOCAL: no se desplegó ni se midió contra PostgreSQL/UAT. Los 1.40–7.11 s anteriores son pocas mediciones no controladas; no se atribuye su demora a ninguna etapa aún. Cuando el cambio compatible llegue a Studio UAT, medir varias páginas repetidas en la misma sesión autenticada y guardar sólo los tiempos por etapa. Corregir el cuello medido y volver a comparar antes de fijar un SLO. La entrega UAT del camino editorial V2 continúa esperando el ensayo positivo privado con rollback; esta instrumentación no sustituye ese gate.
