# 41 · Signal Triggers & Barriers V2 — Handoff de implementación

> **Actualización 2026-08-02:** este documento conserva el inventario de contenido,
> serving y frontend T&B que permitió construir el módulo actual. Su navegación por
> `?study=` y página por `study_corpus` es transicional y queda supersedida por ADR 014
> y `42_SIGNAL_WORKSPACE_DATA_OWNERSHIP.md`: el cliente tendrá una sola superficie T&B
> por workspace, con runs/releases internos. Para la siguiente misión usar
> `44_SIGNAL_WORKSPACE_DATA_PLANE_HANDOFF.md`; no ejecutar el prompt histórico al final
> de este archivo como si describiera el estado vigente.

> **Estado:** handoff de ejecución, 2026-07-31.
> **Alcance:** únicamente la página estratégica Triggers & Barriers dentro del workspace
> de Signal. No incluye Monitoreo de marca, Mentions, Topics & Narratives,
> Opportunities, navegación general ni una nueva corrida metodológica.

## Resultado esperado

Reemplazar el placeholder actual del estudio T&B por una experiencia cliente-visible,
responsive y trazable dentro de la URL canónica del workspace:

```text
/signal/laika?study=3d32472d-9720-4fae-b6d2-a73152c5f0a4
```

La primera entrega tiene dos vistas del mismo estudio y release:

1. **Decision field**: lectura navegable de triggers y barriers por capa y movilidad.
2. **Evidence**: índice de findings, detalle gobernado y drill-down hasta la mención.

El módulo no debe leer `published_outputs.payload` como fuente analítica ni reconstruir
otro JSON estático. La revisión aprobada permanece congelada; los filtros de esta página
exploran el release, no vuelven a correr T&B y no mezclan menciones posteriores.

## Referencias que deben inspeccionarse antes de editar

### Navegador

- Reclamar la pestaña autenticada de Shopify Admin que quedó abierta en
  `https://admin.shopify.com/store/mipet-grandpet/analytics/reports`.
- Inspeccionar con DOM y capturas la densidad de su tabla, jerarquía, filtros, estados de
  selección, bordes y comportamiento responsive. Abrir al menos un informe con chart si
  Shopify lo carga correctamente; no inferir su UI desde memoria.
- Inspeccionar las dos secciones del Signal legacy solamente para inventariar contenido:
  - `http://localhost:3001/signal/aaafa040-ca2f-49a6-afd0-e872b6706476#tb-decision-field`
  - `http://localhost:3001/signal/aaafa040-ca2f-49a6-afd0-e872b6706476#finding-detail`

Shopify es referencia de producto visual. El Signal legacy es referencia de contenido,
no de layout ni de contrato de datos.

### Canon y código

Leer completos antes de actuar:

- `AGENTS.md`
- `apps/studio/AGENTS.md`
- `docs/product/03_TRIGGERS_BARRIERS_DEEPDIVE.md`
- `docs/product/31_SIGNAL_PRODUCT_NORTH_STAR.md`
- `docs/product/33_SIGNAL_V2_SHOPIFY_UI_REFERENCE.md`
- `docs/product/37_SIGNAL_WORKSPACE_INFORMATION_ARCHITECTURE.md`
- `docs/product/38_SIGNAL_LOADING_AND_NAVIGATION_STANDARD.md`
- `docs/product/tb-pipeline-runtime-notes.md`
- `docs/product/10_methodology_seeds/triggers-barriers.yaml`
- `apps/studio/src/components/signal-v2/SignalV2BrandMonitoring.tsx`
- `apps/studio/src/components/signal-v2/SignalV2RouteSkeleton.tsx`
- `apps/studio/src/components/signal-v2/SignalEChart.tsx`
- `apps/studio/src/app/signal-v2/signal-v2.css`
- `apps/studio/src/lib/signal-v2/workspace-navigation.ts`
- `apps/studio/src/lib/data-os/signal-strategic-releases.ts`
- `apps/studio/src/lib/data-os/published-signal-overview.ts`
- `apps/studio/src/lib/data-os/signal-serving.ts`
- `apps/studio/src/lib/signal/tb-decision-field.ts`
- `apps/studio/src/lib/signal/contracts.ts`
- `apps/studio/src/app/signal/[outputId]/page.tsx`

Usar la skill `design-taste-frontend` y la skill del navegador para la validación real.

## Estado local confirmado

- Repositorio: `/Users/brandhon_o/Downloads/noisia-website`
- Rama: `codex/noisia-data-os-cut-1-wip`
- El worktree está sucio y contiene trabajo válido. No hacer reset, stash, checkout
  destructivo, limpieza, commit ni push.
- Workspace canónico: `/signal/laika`.
- Estudio Laika T&B: `3d32472d-9720-4fae-b6d2-a73152c5f0a4`.
- Output legacy: `aaafa040-ca2f-49a6-afd0-e872b6706476`.
- La navegación canónica ya construye `/signal/{workspaceSlug}?study={studyCorpusId}`.
- La página actual cae en el estado “study linked” y sólo ofrece abrir el reporte legacy.
- `StrategicStudyContent` vive todavía dentro de
  `SignalV2BrandMonitoring.tsx`; no es aún el producto T&B.
- `loadSignalStrategicReleasesV1` sirve resúmenes de releases desde tablas relacionales.
- `loadPublishedSignalOverview` ya declara `source_of_truth: "relational"` y
  `payload_role: "manifest_only"`; contiene queries útiles para findings, polaridad,
  capas, movilidad, series, citas, oportunidades y acciones.
- Debe auditarse por qué el release actual no aparece en la página Laika antes de diseñar
  un fallback. No fabricar un release ni aprobar artefactos para desbloquear la UI.

## Contenido recuperable del Signal legacy

El inventario observado sirve para preservar preguntas de negocio. Sus números deben
reconciliarse contra DB antes de mostrarse:

- Decision Field organiza fuerzas por:
  - polaridad: `trigger`, `barrier`, `mixed`;
  - capa: `personal`, `psychological`, `social`, `cultural`;
  - movilidad: `movible_por_marca`, `parcialmente_movible`, `estructural`;
  - frecuencia, intensidad, capacidad predictiva, score, confianza y evidencia.
- La corrida legacy de Laika muestra 15 findings, 54 evidence points y 65% de evidencia
  movible. Son referencias de reconciliación, no fixtures permitidos.
- La prioridad actual incluye, entre otros:
  - Publicidad engañosa en promociones de precio.
  - Expectativa ambivalente ante el relanzamiento de Laika.
  - Vínculo afectivo mascota-familia como motor de compra.
  - Traición de membresía como detonador de abandono definitivo.
  - Incumplimiento logístico en pedidos pagados.
- El detalle de un finding contiene: cita pública, frecuencia, movilidad, confianza,
  lectura estratégica, canal, formato, periodo, limitaciones competitivas, decisión que
  afecta, acciones conectadas, medición y evidencia.
- Evidence permite filtrar por polaridad, capa y confianza, y seleccionar un finding.

No copiar:

- el gran reporte scrollable;
- cards repetidas con la misma recomendación;
- datos derivados del payload;
- la geometría arbitraria del scatter legacy. `buildTbDecisionFieldNodes` usa ángulos,
  anillos y separación de colisiones para el reporte anterior; no convierte esos valores
  en semántica gobernada.

## Arquitectura de información de la primera entrega

### Encabezado persistente

- Título: nombre real de `study_corpora`.
- Eyebrow/status: Triggers & Barriers · Strategic study.
- Selector de release o label del release actual.
- Ventana aprobada, fecha de publicación, corpus revision y estado de cobertura.
- Dos tabs o vistas compactas: `Decision field` y `Evidence`.
- El periodo del release es informativo y congelado. No usar el filtro global de fechas
  para fingir que un estudio aprobado cambia con cada consulta.

### Decision field

1. Strip denso de métricas:
   - findings;
   - supporting mentions o coded mentions reconciliadas;
   - trigger/barrier split;
   - movable share;
   - evidence coverage.
2. Chart principal: matriz semántica de 3 × 4.
   - Columnas: Personal, Psychological, Social, Cultural.
   - Filas: Act on it, Shape it, Respect it.
   - Posición: exclusivamente enums gobernados de layer y mobility.
   - Color: trigger verde, barrier rojo, mixed gris/azul desaturado.
   - Tamaño: `frequency_mentions` dentro de una escala acotada y explicada.
   - Selección: borde fuerte, opacidad completa y el resto ligeramente atenuado.
   - Tooltip: nombre, polaridad, capa, movilidad, menciones, score, confianza y evidencia.
   - Click y teclado actualizan una única selección compartida con ranking y detalle.
3. Chart secundario: balance divergente trigger/barrier por layer.
   - Mostrar conteos y/o shares con denominador explícito.
   - No fabricar simetría cuando el corpus está polarizado.
4. Presence over time para el finding seleccionado, sólo si existe serie relacional.
5. Ranking accesible equivalente al chart para lectura y navegación por teclado.

No usar chord, force-directed graph o relaciones causales: T&B no entrega una red de
relaciones. ECharts existente es suficiente para estas preguntas; no agregar D3 sin una
necesidad que `SignalEChart` no pueda resolver.

### Finding reading

- Eyebrow: `FINDING READING`.
- Nombre real del finding y definición/lectura gobernada.
- Badges discretos de polaridad, layer, mobility y confidence.
- Métricas con helpers Shopify-like, sin iconos de ayuda.
- Implicación, `what it decides`, limitación y acción conectada viven una sola vez.
- No exponer prompts, review status interno, nombres de tablas, provenance técnico o
  campos operator-only.
- Mantener geometría estable al cambiar de finding.

### Evidence

- Índice de findings a la izquierda y detalle a la derecha en desktop; una columna en
  compactos.
- Filtros: polarity, layer, mobility y confidence. Search sólo si opera server-side.
- Preview estable de máximo cinco menciones por finding.
- Si hay más: `+ N more mentions` y botón `Open evidence`.
- Drawer paginado/cursor con todas las menciones client-safe disponibles.
- Cada mención aparece una sola vez: plataforma y fecha alineadas, verbatim único,
  `Open original` sólo con URL y `View enriched mention` enlazando Mentions mediante el
  parámetro estable ya soportado.
- No duplicar la UI completa de Mentions.

## Serving y trazabilidad

Primero auditar si el contrato relacional existente puede cubrir el módulo. Preferir
extraer loaders pequeños desde `published-signal-overview.ts` antes de duplicar SQL.

El serving final debe resolver server-side:

- workspace + permisos;
- study corpus solicitado;
- release visible y su `tb_analysis_id`/snapshot;
- overview del release;
- finding detail;
- evidence con cursor;
- series del finding cuando existan.

Si faltan endpoints, agregar únicamente los mínimos bajo
`/api/data-os/signal/[workspaceId]/...`, con authZ y `Cache-Control` consistentes con los
serving endpoints actuales. Nunca aceptar un `analysisId` arbitrario del cliente sin
resolverlo contra workspace, study y release.

Fuente de verdad:

- `signal_workspace_releases` y current release;
- `tb_analyses` y snapshot congelado;
- `tb_findings`;
- `tb_mention_codings` y `tb_finding_citations`;
- `corpus_snapshot_mentions` + `mentions`;
- `tb_temporal_metrics` y `tb_finding_temporal_comparisons` cuando apliquen;
- artefactos aprobados y client-visible para narrativa editorial.

Reglas:

- no leer `published_outputs.payload` salvo como manifest/compatibilidad;
- no usar fixtures para Laika cuando la DB esté disponible;
- no mezclar menciones fuera del snapshot;
- no ocultar falta de cobertura, series o comparativo;
- no mostrar comparativo si Step 5 sigue sin evidencia aprobada;
- no confundir `frecuencia`, `citation_count`, `evidence_count` y coded mentions;
- toda cifra debe tener denominador y definición verificables;
- reconciliar overview, detail y evidence contra SQL antes de cerrar.

## Estilo obligatorio

- Shopify Admin como referencia directa inspeccionada.
- Product/Google Sans existente.
- Alta densidad legible, separación por bordes y espacio; no mosaico de cards flotantes.
- Radios de 8px para superficies internas y popovers.
- Sin gradients, glows, glassmorphism ni UI “AI-generated”.
- Texto funcional nunca menor de 12px.
- Helpers con subrayado punteado y cursor help, sin icono.
- Focus visible y alternativa accesible para cada chart.
- Desktop, laptop y compactos reales. No fijar 940px ni otra altura desktop rígida.
- Grid con `minmax(0, …)` y stacking limpio; chart mide su contenedor y se redimensiona.
- Animar sólo opacity/transform; nunca width, height, top o left.

## Loading y performance: gate obligatorio

`docs/product/38_SIGNAL_LOADING_AND_NAVIGATION_STANDARD.md` es un contrato, no una guía.
Toda implementación T&B debe cumplir:

- shell, sidebar, título, tabs y controles reales desde el primer frame;
- spinner local en el item de navegación al entrar al estudio;
- skeleton de geometría real sólo si la carga fría supera aproximadamente 220 ms;
- contenido anterior sólo para revalidación dentro del mismo contexto, nunca debajo de
  una URL de otro módulo;
- filtros conservan datos previos y muestran progreso dentro del control que inició la
  petición;
- llegada de datos por opacidad breve, sin layout shift;
- `prefers-reduced-motion` detiene animación no esencial;
- charts diferidos si están fuera del viewport y nunca montados con tamaño cero.

Agregar una variante T&B a `SignalV2ModuleSkeleton` si hace falta; no crear un segundo
sistema de skeletons.

## Fases de implementación

### P0 · Auditoría obligatoria

- Inspeccionar Shopify, el placeholder V2 y las dos secciones legacy.
- Resolver desde DB cuál análisis/release Laika puede servir y por qué la UI actual no lo
  presenta.
- Reconciliar al menos findings, polaridad, layer, mobility y citas.
- Escribir el contrato de respuesta antes de montar charts.

### P1 · Serving

- Construir overview/detail/evidence/series mínimos y authZ server-side.
- Tests de scope, visibilidad, snapshot, paginación y ausencia de payload.
- Estados `fresh`, `partial`, `not_available` y error honestos.

### P2 · UI

- Extraer un componente dedicado `SignalV2TriggersBarriers`; no seguir creciendo el
  placeholder inline.
- Carga dinámica dentro del shell actual, sin otra implementación paralela.
- Selección compartida entre matrix, ranking, reading y evidence.
- i18n completa `en-US` y `es-MX`.
- Skeleton, empty, partial y error states con geometría estable.

### P3 · QA

- Validación automática y navegador real en inglés y español.
- Desktop amplio, laptop y breakpoint compacto.
- Release con datos, sin series, sin evidence adicional, partial y sin release.
- Consola limpia y sin layout shift observable.

## Validación mínima

```bash
corepack pnpm --filter @noisia/studio typecheck
corepack pnpm --filter @noisia/studio test
corepack pnpm --filter @noisia/query-engine typecheck
corepack pnpm --filter @noisia/query-engine test
corepack pnpm --filter @noisia/studio build
git diff --check
```

En navegador comprobar:

1. Shopify fue inspeccionado realmente.
2. La URL canónica abre el estudio correcto.
3. Decision field inicia con un finding seleccionado de forma determinista.
4. Matrix, ranking y detail comparten selección.
5. Colores, tamaños y tooltips corresponden a métricas declaradas.
6. Evidence no duplica menciones y pagina sin crecer indefinidamente.
7. `View enriched mention` abre el registro correcto en Mentions.
8. El release no cambia con filtros de Brand Monitoring.
9. No hay contenido operator-only ni keys de traducción crudas.
10. El shell responde de inmediato y el skeleton sólo aparece con espera real.
11. No hay errores de consola.
12. Los números visibles reconcilian contra SQL.

## Fuera de alcance

- Volver a correr Claude, Voyage, T&B, cleanup, discovery o backfills.
- Rediseñar Monitoreo de marca, Mentions o Topics & Narratives.
- Opportunities, Competitive Intelligence, Action Studio o export/deck en esta primera
  entrega.
- Resolver el gate general de Signal Pulse.
- Crear o promover releases artificialmente.
- Cambiar perfiles, migraciones o aprobaciones.
- Commit o push.

## Prompt de inicio para el siguiente chat

Usar íntegramente el bloque siguiente:

```text
Continúa el desarrollo de Noisia Signal exactamente desde el estado local actual.

REPOSITORIO
/Users/brandhon_o/Downloads/noisia-website

RAMA
codex/noisia-data-os-cut-1-wip

MISIÓN
Implementa únicamente Triggers & Barriers V2 dentro del workspace de Signal. La página
canónica de trabajo es:
http://localhost:3001/signal/laika?study=3d32472d-9720-4fae-b6d2-a73152c5f0a4

El alcance de esta primera entrega son sólo dos vistas conectadas del mismo release:
Decision field y Evidence. No rediseñes otros módulos.

ANTES DE EDITAR
1. Lee completos:
   - AGENTS.md
   - apps/studio/AGENTS.md
   - docs/product/41_SIGNAL_TRIGGERS_BARRIERS_V2_HANDOFF.md
   - todos los archivos que ese handoff marca como obligatorios.
2. Usa la skill design-taste-frontend.
3. Usa la skill del navegador y reclama primero la pestaña autenticada de Shopify Admin
   que está abierta. Inspecciona su DOM y estilos reales. Shopify es la referencia visual.
4. Inspecciona después estas dos secciones del Signal legacy para extraer contenido, no
   layout ni datos desde el payload:
   - http://localhost:3001/signal/aaafa040-ca2f-49a6-afd0-e872b6706476#tb-decision-field
   - http://localhost:3001/signal/aaafa040-ca2f-49a6-afd0-e872b6706476#finding-detail

REGLAS CRÍTICAS
- Trabaja sobre el worktree sucio actual. No descartes, reviertas, reformatees ni
  sobrescribas cambios ajenos.
- Usa apply_patch para editar.
- No hagas reset, checkout destructivo, stash, limpieza, commit ni push.
- No crees una implementación paralela.
- No vuelvas a correr Claude, Voyage, T&B, cleanup, discovery o backfills.
- No inventes ni apruebes releases para desbloquear la pantalla.
- No leas published_outputs.payload como fuente analítica. Usa DB/API relacional y
  conserva snapshot, release, findings y menciones originales.
- Mantén authZ server-side y datos client-safe.
- docs/product/38_SIGNAL_LOADING_AND_NAVIGATION_STANDARD.md es obligatorio para shell,
  navegación, skeletons, revalidación, transición breve y reduced motion.
- Toda cadena nueva debe existir en en-US y es-MX.

ORDEN DE TRABAJO
P0: audita por qué el estudio Laika cae hoy en “study linked” sin release visible;
reconcilia DB, release, analysis, findings y citas. No empieces el chart sin cerrar esto.
P1: implementa el serving mínimo overview/detail/evidence/series, reutilizando loaders
relacionales existentes y agregando endpoints sólo si faltan.
P2: implementa SignalV2TriggersBarriers con selección compartida, Decision field robusto,
ranking accesible, Finding reading y Evidence paginada.
P3: valida automáticamente y en navegador real.

DECISION FIELD
- Matrix semántica 3×4: mobility por filas, layer por columnas.
- Color = polarity; tamaño = frequency_mentions; selección = borde/opacidad.
- Tooltip con métricas definidas; click y teclado controlan el mismo finding.
- Balance divergente trigger/barrier por layer.
- Presence over time sólo si existe serie relacional.
- No force graph, chord, D3 ni posiciones arbitrarias.

EVIDENCE
- Finding index + detail gobernado.
- Preview fijo de cinco menciones, +N more y Open evidence.
- Drawer con cursor, texto no duplicado y enlace View enriched mention hacia Mentions.
- No expongas provenance técnico ni UI operator-only.

VALIDACIÓN
corepack pnpm --filter @noisia/studio typecheck
corepack pnpm --filter @noisia/studio test
corepack pnpm --filter @noisia/query-engine typecheck
corepack pnpm --filter @noisia/query-engine test
corepack pnpm --filter @noisia/studio build
git diff --check

Levanta Studio y comprueba interacción real, responsive, en-US/es-MX, skeletons, drawer,
deep-link a Mentions, números reconciliados y consola limpia. No declares terminado lo
que no hayas comprobado realmente.
```
