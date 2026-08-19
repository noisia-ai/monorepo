# 43 · Signal V2 Frontend System and Implementation State

> **Estado:** handoff técnico/visual del frontend construido en
> `codex/noisia-data-os-cut-1-wip`, 2026-08-02.
> **Referencia visual:** Shopify Admin inspeccionado en sesión autenticada, adaptado a
> Product/Google Sans y a la densidad de Noisia.
> **Contrato de carga:** `38_SIGNAL_LOADING_AND_NAVIGATION_STANDARD.md`.

## Propósito

Este documento evita que un módulo nuevo vuelva a inventar header, filtros, drawers,
skeletons, charts o navegación. Signal V2 ya tiene un lenguaje coherente y componentes
compartidos. El siguiente cambio estructural debe conservarlo mientras sustituye el
ownership de data por debajo.

No es una declaración de production readiness. El worktree actual contiene WIP válido,
incluyendo archivos sin commit, que debe inspeccionarse y preservarse.

## Resultado De Producto Alcanzado

La experiencia cliente ya converge en un workspace estable:

- una URL por marca;
- topbar y sidebar persistentes;
- encabezado y controles alineados entre módulos;
- navegación con feedback inmediato;
- datos previos durante revalidación;
- skeletons locales sólo para geometría variable;
- filtros compartidos y URL reproducible;
- charts responsivos y diferidos;
- selección compartida entre visualización, lista, detail y evidence;
- drawers de evidencia resumidos que navegan a Mentions;
- i18n `es-MX` y `en-US`;
- estados `cold`, `stale`, `partial`, `empty` y `error` explícitos.

## Arquitectura De Componentes

### Shell y composición

| Componente | Responsabilidad |
|---|---|
| `SignalV2WorkspacePage` | Resuelve workspace, módulo y query params; compone serving y experiencia |
| `SignalV2ModuleHeader` | Único dueño de icono, título, status, subtítulo y fila de controles |
| `SignalV2RouteSkeleton` | Shell de primera entrada; no debe duplicarse por módulo |
| `SignalV2ModuleSkeleton` | Geometría variable específica con aparición retrasada |
| `SignalAnalyticsFilter` | Periodo, comparación y feedback local de intención |
| `SignalDataScopeFilter` | Alcance de datos cuando existe un contrato real de serving |

### Charts

| Componente | Responsabilidad |
|---|---|
| `SignalEChart` | Host accesible, geometría estable y fallback de carga |
| `SignalEChartRuntime` | Import dinámico, IntersectionObserver, resize, eventos y reduced motion |

Reglas:

- ECharts se monta una vez por host visible y actualiza option/eventos;
- no montar canvas con ancho/alto cero;
- no animar el width/height del shell;
- reservar altura responsive con CSS/grid, no con un `940px` fijo;
- tooltips compactos y client-safe;
- selección visual y por teclado apuntan al mismo estado React;
- toda visualización importante conserva una alternativa de lista/ranking accesible.

### Evidencia

`SignalEvidenceDrawer` es la puerta compartida a registros enriquecidos:

- header con eyebrow, nombre y cierre consistente;
- cards redondeados y densos;
- una sola copia del verbatim;
- plataforma y fecha alineadas;
- `Open original` sólo con URL;
- `View enriched mention` conserva query params y abre Mentions mediante ID estable;
- feedback inline durante navegación;
- no duplica la UI completa de Mentions;
- el body se bloquea mientras el drawer está abierto;
- evidence larga usa cursor/paginación, nunca crecimiento infinito del card principal.

## Navegación Y Performance Percibida

La investigación y correcciones establecieron:

1. click/filtro responde visualmente en menos de 100 ms;
2. URL, item activo y pending state representan la intención nueva de inmediato;
3. respuestas rápidas no disparan skeleton visible;
4. si la espera fría supera aproximadamente 220 ms aparece geometría real del destino;
5. revalidar filtros conserva datos previos y señala sólo el control que inició el cambio;
6. requests superados se cancelan y no pueden limpiar el pending state actual;
7. contenido nuevo entra con opacidad breve, sin mover layout;
8. `prefers-reduced-motion` elimina movimiento no esencial;
9. rutas protegidas no reactivan `Link` prefetch por el guardrail de Kinde;
10. el shell nunca se convierte en skeleton.

El contrato completo y checklist viven en
`38_SIGNAL_LOADING_AND_NAVIGATION_STANDARD.md`.

## Lenguaje Visual Validado

- Shopify Admin es referencia de interacción y densidad, no una copia de marca.
- Product/Google Sans existente.
- Superficie principal gris tenue, cards blancas y divisores sutiles.
- Radios de `8px` en superficies internas, filas seleccionadas, helpers y popovers.
- Alta densidad sin cards decorativas enormes.
- Sin gradients, glows, glassmorphism ni “AI cards”.
- Texto funcional nunca menor de `12px`.
- Helpers sin icono: label con subrayado punteado y cursor help.
- Helpers explican significado y uso en lenguaje de Brand Manager; no exponen SQL,
  modelos, approvals o provenance operator-only.
- Selected, hover y focus-visible son estados distintos.
- No usar una línea vertical izquierda como recurso genérico para selección o citas.
- Sentence case; eyebrows pueden usar mayúsculas por sistema.

## Estado De Los Módulos

### Brand Monitoring

- Shell y filtros compartidos.
- Métricas, series y breakdowns relacionales.
- Monthly insights versionados.
- Data scope popover y drill-down.
- Revalidación conserva contenido previo.

### Mentions

- Tabla/lista densa con búsqueda, orden y columnas.
- Drawer de mención enriquecida.
- Soporte para abrir un registro seleccionado mediante query param estable.
- Estados de navegación y carga alineados al shell.

### Topics & Narratives

- Lista como vista inicial y Map como alternativa.
- Selección única compartida entre lista, bubble chart, detail y evidence.
- Detail con geometría estable, presence, sentiment y top evidence.
- Colores de mapa por evidencia sentiment y selección reconocible.
- Enlace al registro enriquecido.
- Perfiles, assignments y serving relacional; no `published_outputs.payload`.
- Insights investigados y persistidos como artefactos gobernados en WIP local.

### Triggers & Barriers

- Componente dedicado `SignalV2TriggersBarriers` en WIP local.
- Matrix de layer × mobility con burbujas por coded mentions.
- Lectura visual compacta, ranking y detail conectados por una selección.
- Finding reading contextual y evidence drawer compartido.
- Filtros reales de finding, periodo publicado y data scope.
- Skeletons de geometría T&B dentro del sistema común.
- El serving relacional consume releases/snapshots; no debe volver al payload.

La migración de ownership no autoriza reescribir estos módulos. Debe sustituir los
loaders/resolvers manteniendo sus contratos visuales siempre que la semántica siga siendo
correcta.

## Patrones Que Ya Fallaron Y No Deben Volver

- recrear el header dentro de cada módulo;
- mostrar controles que no cambian datos;
- sustituir sidebar y shell por skeletons;
- líneas de skeleton rápidas y de alto contraste por toda la pantalla;
- dejar la URL nueva mostrando el módulo anterior sin feedback;
- contenido que aparece de golpe y cambia alturas;
- cards con min-height desktop fijo para igualar otra columna;
- charts montados en contenedores cero o fuera de viewport;
- helper técnico o persistentemente abierto al click;
- tooltips largos, transparentes o cortados por overflow/z-index;
- evidencia duplicada en body y excerpt;
- drawers ad hoc por metodología;
- líneas verticales de selección/cita que parezcan UI generada;
- headers que son botones sólo para activar helpers;
- cards de detalle que repiten los mismos indicadores y textos;
- nuevas implementaciones paralelas para resolver una inconsistencia local.

## Regla Para Cambios De Data Plane

Mientras se implementa el ownership por workspace:

- no cambiar el shell ni las coordenadas del header;
- no renombrar query params cliente sin compatibilidad;
- mantener selection state estable durante dual-read;
- no servir el snapshot completo para evitar cambiar loaders;
- conservar paginación/cursor de evidence;
- presentar `partial`, `stale` y `not_available` honestamente;
- medir navegación fría/caliente antes y después;
- reconciliar datos antes de juzgar una diferencia como bug visual.

## Archivos Principales Del Sistema

```text
apps/studio/src/components/signal-v2/SignalV2WorkspacePage.tsx
apps/studio/src/components/signal-v2/SignalV2ModuleHeader.tsx
apps/studio/src/components/signal-v2/SignalV2RouteSkeleton.tsx
apps/studio/src/components/signal-v2/SignalAnalyticsFilter.tsx
apps/studio/src/components/signal-v2/SignalDataScopeFilter.tsx
apps/studio/src/components/signal-v2/SignalEChart.tsx
apps/studio/src/components/signal-v2/SignalEChartRuntime.tsx
apps/studio/src/components/signal-v2/SignalEvidenceDrawer.tsx
apps/studio/src/components/signal-v2/SignalV2BrandMonitoring.tsx
apps/studio/src/components/signal-v2/SignalV2Mentions.tsx
apps/studio/src/components/signal-v2/SignalV2TopicsNarratives.tsx
apps/studio/src/components/signal-v2/SignalV2TriggersBarriers.tsx
apps/studio/src/lib/data-os/signal-client-fetch.ts
apps/studio/src/app/signal-v2/signal-v2.css
apps/studio/messages/en-US.json
apps/studio/messages/es-MX.json
```

Varios de estos archivos están modificados o untracked en el worktree. Inspeccionar
`git status --short` y el diff antes de tocar cualquiera. No formatear o reemplazar el
CSS global como “cleanup”.

## Gate De Frontend

Un cambio no se cierra sólo porque typecheck pase:

- entrada directa fría y navegación caliente;
- Brand Monitoring → Mentions → Topics → Reports/T&B → regreso;
- filtros consecutivos y requests abortadas;
- selección compartida list/chart/detail;
- drawer y retorno a Mentions;
- desktop amplio, laptop y compacto;
- `es-MX` y `en-US` sin keys crudas;
- reduced motion;
- consola limpia;
- cero layout shift observable del shell;
- números reconciliados con serving/SQL.

Validación enfocada:

```bash
corepack pnpm --filter @noisia/studio typecheck
corepack pnpm --filter @noisia/studio test
corepack pnpm --filter @noisia/query-engine typecheck
corepack pnpm --filter @noisia/query-engine test
git diff --check
```

Ejecutar build sólo cuando el alcance/riesgo lo amerite o antes de un gate de entrega.

## Unified Workspace Shell — Fase 6

La fuente de verdad estructural vive en
`apps/studio/src/components/workspace/WorkspaceShell.tsx` y sus tokens/estados en
`apps/studio/src/app/workspace-shell.css`. El inventario implementado es:

| Necesidad | Primitive compartida | Composición |
|---|---|---|
| shell/topbar/main | `WorkspaceShell`, `WorkspaceTopbar`, `WorkspaceMain` | Admin + Signal |
| navegación global | `WorkspaceGlobalSidebar`, `WorkspaceNavLink` | manifest propio por producto |
| contexto de marca | `WorkspaceContextSidebar` | Admin únicamente dentro de brand |
| encabezado de módulo | `WorkspaceHeader` | `AdminWorkspaceHeader` y `SignalV2ModuleHeader` |
| feedback/overlay | pending de `WorkspaceNavLink`, `WorkspaceOverlay` | ambos shells |
| detalle lateral | `WorkspaceDrawer` | sources/imports y evidence existente |
| accesibilidad | `WorkspaceSkipLink`, focus-visible y reduced motion | ambos shells |

Signal conserva `signal-v2-*`, su geometría, filtros, charts, selection y serving. Admin
compone `AdminShell` con un manifest interno permission-aware. No existe un componente
gigante con ramas `if admin/signal`; contenido y permisos permanecen separados.
El topbar Admin reutiliza `LocaleSwitcher` y la server action de preferencias existente;
el cambio ES/EN se confirma con recarga controlada para que shell, contenido y control
seleccionado nunca queden en idiomas distintos.

Rutas Admin cubiertas por el shell:

```text
/studio
/studio/brands
/studio/brands/new
/studio/brands/{brandId}
/studio/brands/{brandId}/data
/studio/brands/{brandId}/brand-os
/studio/brands/{brandId}/reports
/studio/brands/{brandId}/settings
/studio/data
/studio/reports
/studio/team
/studio/settings
/studio/corpora/new             # advanced compatibility
```

Las rutas de theme mantienen temporalmente su shell de compatibilidad. Corpora/Engine,
Review, Brand OS, Claude-assisted setup, Knowledge Base y competitors no fueron
eliminados; se enlazan desde el shell nuevo o desde Advanced operations.

### Regla Para Módulos Futuros

Una nueva superficie debe agregarse al manifest correspondiente y renderizar sólo su
contenido dentro del layout. Está prohibido volver a declarar sidebar/topbar, crear un
drawer, header, helper o skeleton paralelo, o usar hash para una vista con datos,
AuthZ o loading boundary propios. Signal Settings es client-safe y vive en
`/signal/{workspaceSlug}/settings`; Admin Settings comparte primitives, no permisos ni
payload interno.
