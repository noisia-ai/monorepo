# Zona horaria consistente en Signal Workspace

Fecha: 2026-09-27

## Resultado

Topics, Narratives, selección, evidencia y Menciones usan la zona IANA guardada en el
workspace para interpretar filtros civiles y mostrar fechas. La zona nunca se toma como
autoridad desde un parámetro del navegador: las rutas resuelven la marca y pasan su zona
confiable a los lectores. El parámetro `timezone` de URL se conserva por compatibilidad,
pero no puede cambiar la consulta.

Los filtros `date_from` y `date_to` siguen siendo fechas civiles inclusivas. PostgreSQL
convierte el inicio al comienzo del primer día local y el final al comienzo del día
siguiente en esa zona, con intervalo `[inicio, fin)`. Así los días de 23 o 25 horas por
cambio estacional no se aproximan como 24 horas fijas. Series, fechas disponibles y
resúmenes diarios usan el mismo día local; `occurred_at` y las fechas originales de las
menciones permanecen como instantes UTC. La zona forma parte de los scopes/cursors, por
lo que uno emitido bajo otra zona no se reutiliza silenciosamente.

Las tablas, tarjetas, ficha de Menciones y drawer de evidencia de Topics/Narratives muestran
los instantes en la zona del workspace. La selección y su recarga también reciben esa zona en
GET y POST. Zonas antiguas inválidas conservan fallback explícito a UTC. No se añadió
migración ni se recalcularon menciones.

## Verificación local

- Suite focal Studio: 51/51 PASS.
- Suite focal DB serving: 2/2 PASS.
- `pnpm typecheck`: 11/11 tareas PASS.
- `pnpm lint`: 11/11 tareas PASS; Studio mantiene 13 advertencias preexistentes y cero errores.
- `git diff --check`: PASS.
- Casos determinísticos comprueban fechas locales alrededor de medianoche (incluido un
  instante de evidencia que cae en días civiles distintos en UTC y Ciudad de México), y el
  contrato de navegación inicial, filtros y selección. Las pruebas DB verifican el SQL
  parametrizado y sus límites locales inclusivos/exclusivos.

## Límites y entrega

El corpus Alexa+ de UAT termina el 12 de agosto de 2026, así que no permite observar en vivo
el borde del día actual. No se ejecutaron importaciones, procesamiento, modelos ni SQL.

Entrega focal comprobada en UAT:

- `e4b4fb2` desplegado en Studio mediante `a595d86c-7e5f-45f1-b53b-48f9ef1c25b9`;
  healthcheck `/api/health` activo.
- `787347f` desplegado en Studio mediante `11499d10-cb7a-4f09-83fe-5130498f240a`;
  healthcheck `/api/health` activo.
- Signal Menciones, workspace Alexa+, recargado desde la interfaz interna: muestra
  **“Zona horaria del workspace: America/Mexico_City”**, 43,159 conversaciones métricas y
  43,159 consultables. Las fechas de la tabla continúan en el día local observado (11 ago
  2026). Ya no indica “Fechas en UTC”.
- Signal Topics/Narratives y su drawer de evidencia se comprobaron antes en `a595d86c`:
  zona visible del workspace y evidencia del 30 de mayo mostrada en fecha local.

La prueba visual confirma el contrato y la etiqueta, pero el corpus no tiene menciones del
periodo actual; no demuestra un borde de fecha presente ni un cambio estacional de producción.
