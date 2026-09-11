# Parada segura: preparación de corpus para cliente

> **Superado por entrega posterior.** El operador reanudó el trabajo el 11 de septiembre. Los cambios
> locales descritos en este corte se revisaron, probaron y entregaron en UAT como `276c2f7`; consultar
> `DELIVERY_CLIENT_CORPUS_PREPARATION_UAT_2026-09-11.md`. El contenido inferior se conserva como
> historia exacta de la pausa y no representa el estado actual.

Fecha del corte: **2026-09-11 14:57 UTC**
Worktree: `/Users/brandhon_o/Downloads/noisia-brand-context-e2e-2026-09-10`
Rama focal: `codex/noisia-brand-context-e2e-2026-09-10`
HEAD local y remoto: `4954125bbe9424e8fdcbab1bc93a50a286776297`
Rama UAT remota: `codex/noisia-topic-results-uat-2026-09-06`, mismo HEAD documental.

## Estado estable en UAT

- Studio y Worker ejecutan el corte de producto `485aed831bc5b7212d23383e6f1a5317b50e5ce1`.
- Deployments activos: Studio `6cedd576-1427-4645-91f9-3ec386215a4b`; Worker `32c7e097-7677-439b-8477-8d42941c3d4b`.
- SQL0155 se aplicó y verificó exactamente una vez. No reaplicar SQL0153, SQL0154 ni SQL0155.
- No existen políticas, acciones o admisiones activas; no hubo nuevas ejecuciones ni gasto Claude/Voyage.
- National conserva 16 CSV, 9,131 filas, 7,396 menciones únicas, 6,826 preparadas, 32 Topics de 357 unidades interpretadas y dos Topics seleccionados con 98 asociaciones en Signal.
- La entrega y sus gates están descritos en `DELIVERY_CLIENT_PROCESSING_POLICY_UAT_2026-09-11.md`.

## Trabajo local preservado y no entregado

Se detuvo al agente de UI antes de pruebas, revisión, commit o push. El árbol queda deliberadamente sucio sobre `4954125`:

- `apps/studio/AGENTS.md`
- `apps/studio/messages/en-US.json`
- `apps/studio/messages/es-MX.json`
- `apps/studio/src/app/globals.css`
- `apps/studio/src/components/brands/ClientProcessingJourney.tsx`
- `apps/studio/src/components/brands/ClientCorpusPreparationStep.tsx` (nuevo, no seguido)
- `apps/studio/src/lib/data-os/signal-processing-policy-ui.test.tsx`

El cambio conecta en la superficie cliente el endpoint gratuito y ya existente
`GET/POST /api/data-os/signal/:workspaceId/corpus/preparation`. El POST usa cuerpo `{}` e
`Idempotency-Key`; no llama modelos ni reserva presupuesto. Incluye estados de cola, progreso,
recuperación y copias ES/EN. `git diff --check` pasó en el corte, pero **no se ejecutaron sus pruebas
ni se hizo revisión de código**. No asumir que está listo para UAT.

## Punto exacto de reanudación

1. Leer este documento y conservar el árbol local; no resetear ni descartar el archivo nuevo.
2. Revisar `ClientCorpusPreparationStep.tsx`, en especial idempotencia después de fallos de red,
   polling, cambios de workspace, contratos temporales y estados sin permiso o sin menciones.
3. Ejecutar únicamente las pruebas focales del Studio afectadas y después typecheck/lint del paquete.
4. Corregir hallazgos y hacer revisión P0/P1/P2. Sólo entonces commit/push focal y entrega UAT.
5. Verificar que National y los costos permanezcan intactos. Una sesión cliente real todavía no se
   creó; la autoridad cliente se comprueba por tests hasta contar con una marca nueva del operador.
6. Después de esta pieza gratuita, continuar con cotización workspace-scoped de Brand Context y
   admisiones atómicas conjuntas Claude + Voyage. No mostrar ni activar acciones pagadas desde una
   conexión parcial.

## Pendientes mayores del producto

- Brand Context: generación automática user-friendly, knowledge bases ampliables y publicación
  versionada con borrado/corrección humana; falta el contrato pagado completo y atómico.
- Voyage y fit: deben consumir contexto e intereses publicados y quedar enlazados a una admisión
  concreta antes de ejecutarse.
- Topics: mantener catálogo editable separado del perfil actualmente servido y unir el recorrido a
  análisis completo e incremental.
- Experimento nuevo: crear una marca real mediante UI e importar menciones reales del operador sólo
  cuando las piezas anteriores permitan observar el recorrido sin apoyo de ingeniería.
- QA faltante: ejecutar dos escritores monetarios comprometidos contra el mismo presupuesto; la
  prueba anterior ejercitó el lock con una segunda conexión pero no dos commits monetarios.

## Automatización y procesos

- Heartbeat `noisia-topics-to-signal-uat-loop`: **PAUSED** por herramienta de la app y verificado en
  su `automation.toml`.
- Agente `client_prepare_ui`: interrumpido; sus cambios quedaron en disco.
- Agentes `client_prepare_backend` y `self_service_backend`: terminados.
- No quedaron despliegues, SQL, llamadas a proveedor o procesos delegados iniciados por este corte.
