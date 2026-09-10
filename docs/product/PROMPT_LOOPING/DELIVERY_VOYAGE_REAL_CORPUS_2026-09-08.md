# Voyage real sobre el corpus completo — 8 septiembre 2026

Voyage terminó desde la UI de UAT: **6,826 menciones completas, 20,821 fragmentos y USD 0.594321 confirmados**. Cero menciones parciales o pendientes, cero reservas, cero saldo incierto y cero excepción de presupuesto. Es preparación semántica real; todavía no significa clasificación, Topics descubiertos ni Signal.

## Evidencia y alcance

Operador autorizó consumo necesario de Voyage sin límite para conectar el flujo genérico. Se activó el proveedor en Studio/Worker UAT y un techo operativo de USD100 por solicitud en Studio, sobre el código existente `ae3e36c1e8e2f7b9e2159b699acc08ebcf4c5848`. La solicitud usó la cotización máxima USD8.328543; ese máximo no fue el costo final. No se cambiaron ni expusieron claves. No se desplegó código local sucio.

- Studio deployment: `f350f738-20d4-4ab7-984a-3392ccbdab7c`.
- Worker deployment: `6fe5eccb-a8fd-40fb-a408-7edfb28f856c`.
- Workspace de prueba: `497e1cb0-56d6-4c1f-a5d5-2f723f13a183`; caso National descartable, sin lógica particular por marca.
- Run: `2cd32bca-f9cf-4913-8df1-2351b695ba4c`, estado `completed`.
- Inicio: `2026-09-08T17:05:03.049Z`; final: `2026-09-08T17:12:56.663Z`.
- Modelo: `voyage-4-large`, 1024 dimensiones, entrada `document`, truncación deshabilitada.
- 20,201 fragmentos únicos calculados y 620 aciertos de caché; cobertura reconciliada 20,821/20,821 referencias.
- 195 llamadas liquidadas, 195 recibos de respuesta, 4,951,935 tokens observados.
- Ledger: 594,321 microUSD liquidados; reservas, reservas inciertas y excepciones en cero. Redondeo por llamada según contrato vigente.

La UI pasó de progreso automático a «Embeddings completos» y muestra esos mismos conteos/costo. La consola autenticada de Railway confirmó por SELECT acotado al workspace el run, sus conteos y la agregación de llamadas. El SHA activo de Studio se verificó desde `RAILWAY_GIT_COMMIT_SHA`. Se conservan las observaciones visuales de la consola y de la UI en esta conversación. Una primera consulta manual del ledger usó un UUID mal transcrito y devolvió vacío; se corrigió consultando el último run del workspace, sin mutaciones ni reintentos del proveedor.

## Continuidad

No reimportar los16CSV ni repetir la preparación/embeddings de este snapshot. La zona SentiOne previamente preguntada sigue pendiente, sin reinterpretar fechas. Claude: cero llamadas nuevas en esta operación; autorización hasta USD30 el8sept America/Mexico_City, separada de Voyage.

Nuevo motor local: BERTopic/UMAP/HDBSCAN con vías abierta/guiada, corpus completo, cero intereses obligatorios, modelos y recuperación durable. La prueba PG→BullMQ→Node→Python pasó con transporte de objetos simulado; no acredita todavía el disparo API/outbox. Revisión posterior encontró y está cerrando el despacho inicial y recuperación de leases vencidos. SQL0136–0138 y este código aún no están entregados en UAT. Interpretación Claude, materialización de Topics y conexión final a Signal siguen abiertas.

Este recibo amplía Compass, STATE y plan original; no reabre gates cerrados ni declara completo el recorrido self-service.
