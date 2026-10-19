# Brand Context → Topics · entrega UAT · 11 septiembre 2026

## Resultado visible

El recorrido reusable de creación y preparación de marca está activo en UAT. La pantalla de
nueva marca usa un selector IANA con búsqueda en vez de texto libre; la búsqueda `New York`
devuelve únicamente `America/New York` y conserva `America/Mexico City` como valor inicial.

Brand OS muestra la base automática creada desde el intake y permite agregar más fuentes de
conocimiento independientes. En una marca histórica cuyo snapshot ya no coincide con su Brand
OS vigente, «Vocabulario y límites de la marca» muestra ahora «Prepara el contexto de tu marca»
y mantiene habilitada la preparación. Antes de este ajuste, el mismo estado recuperable aparecía
como «No se pudo cargar el contexto semántico» y bloqueaba el flujo.

La corrección es general: sólo `brand_os_snapshot_required` y `brand_os_snapshot_stale` se
convierten en estado recuperable. Autenticación, autorización, red y autoridad de idioma/mercado
siguen fallando de forma visible. Los GET permanecen de lectura; preparar requiere el POST
existente, cotización e identidad idempotente. Ningún proveedor se inicia al cargar la página.

## Entrega

- Código de producto: `44eeab5cd5d2dc395142714bbd2bca56e70033f6`.
- Marcador de rollout ordenado: `1720a37e72742667c6fa500ef9a835202715fc0a`.
- Corrección del estado recuperable: `9e88bb5ec37e24cc3a592799839e987c1cb77ca4`.
- Studio UAT: deployment Railway `aa05d21c-439e-434a-b5e3-c8ade8bf1e3b`, activo y exitoso.
- Worker UAT: deployment `b10b07a2-5b23-410b-9706-3d40f4a4183b`, conservado sin cambio.
- SQL0153 ya estaba instalado y verificado; no se reaplicó.

## Verificación

- Regresión focal: 14/14 aprobadas.
- Studio completo con entorno local inerte: 904 aprobadas, 7 omitidas, 0 fallidas.
- Typecheck: PASS.
- Lint: 0 errores; 13 advertencias preexistentes.
- Build de producción Studio: PASS con valores locales no secretos.
- Revisión independiente: 0 P0, 0 P1 y 0 P2.
- UI UAT: selector IANA, búsqueda, Knowledge Base múltiple y recuperación de snapshot obsoleto
  comprobados con sesión real.
- Recibo SQL posterior: 0 operaciones `prepare-brand-context`, 0 corridas semánticas vinculadas
  y 0 corridas de embeddings vinculadas.

## Siguiente experimento

Crear otra marca real desde la UI, completar su contexto y agregar las fuentes necesarias. Esa
acción debe dejar marca, Brand OS, Knowledge Base y preparación durable; después se continúa por
Topics, importación de menciones reales, cómputo completo, interpretación y Signal. National sólo
sirvió para probar compatibilidad del flujo con contexto histórico; no existe lógica especial por
cliente.
