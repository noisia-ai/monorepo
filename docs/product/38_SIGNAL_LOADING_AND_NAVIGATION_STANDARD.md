# 38 · Signal — Loading, Navigation and Perceived Performance Standard

> **Estado:** contrato obligatorio para Signal, 2026-07-31.
> **Referencia:** comportamiento observado en Shopify Admin, adaptado al shell de Noisia.
> **Aplica a:** Monitoreo de marca, Mentions, Topics & Narratives, Triggers & Barriers y
> cualquier módulo futuro dentro de `/signal/{workspace}`.
> **Handoff de componentes:** `43_SIGNAL_V2_FRONTEND_SYSTEM.md`.

Este documento evita que cada módulo invente un lenguaje de espera distinto. El objetivo
no es hacer más visibles las cargas: es conservar contexto, responder inmediatamente a la
intención y limitar los placeholders a los casos donde todavía no existe información útil.

## Regla Principal

Si la interfaz ya tiene contenido válido, ese contenido permanece visible mientras llega
la siguiente respuesta. Un cambio de módulo, filtro, periodo, página o término no puede
vaciar el shell, reemplazar la navegación ni convertir datos existentes en skeletons.

## Contrato Del Encabezado De Módulo

`SignalV2ModuleHeader` es el único dueño de la geometría superior dentro de
`signal-v2-main`: icono, título, status, subtítulo, acción contextual y fila de controles.
Monitoreo, Mentions, Topics & Narratives, Triggers & Barriers, estados sin datos y
skeletons deben renderizarlo directamente. Un módulo no puede reconstruir
`signal-v2-page-head` o `signal-v2-filterbar` por su cuenta.

- El root de un módulo no agrega padding superior o lateral al que ya aporta
  `signal-v2-main`.
- El encabezado y los controles empiezan en las mismas coordenadas en todos los módulos.
- La separación entre encabezado y controles es de `6px`; después de los controles se
  reservan `10px` antes del contenido específico.
- Los controles son capacidades declarativas, no decoración. Sólo aparecen si afectan
  datos reales de ese módulo.
- Un corte estratégico publicado muestra su periodo como información congelada. No
  presenta comparativa, filtros o refresh si sus contratos no existen o no cambian el
  serving visible.
- El skeleton reutiliza el mismo componente y los mismos controles estáticos; no mantiene
  una copia aproximada del header.
- Cualquier excepción de geometría requiere cambiar el componente compartido y validar
  todos los módulos, no agregar padding o márgenes correctivos dentro de una página.

## Estados Permitidos

| Estado | Tratamiento |
|---|---|
| Shell persistente | Topbar, sidebar, navegación activa, encabezado y controles reales; nunca skeleton |
| Primera visita sin datos | Shell real del destino inmediato; geometría fría después de una espera breve, sin líneas de texto falsas |
| Navegación entre módulos | URL, item activo y shell del destino inmediatos; indicador dentro del item activo |
| Revalidación de filtros | Datos anteriores visibles; valor optimista y progreso dentro del control que inició la petición |
| Carga secundaria | Skeleton sólo en el subcomponente variable, con la geometría final |
| Error con datos previos | Conservar datos previos y mostrar error accionable sin desmontar el módulo |
| Error sin datos | Empty/error state con acción de reintento, dentro de la geometría del módulo |

## Contrato De Navegación

1. La intención debe responder visualmente en menos de `100 ms`: URL, item activo y un
   único estado de progreso cambian al click.
2. El shell se monta una vez. La navegación interna no usa un `loading.tsx` de ruta para
   cubrir todo el workspace.
3. El módulo anterior se desmonta al confirmar la intención y se monta inmediatamente el
   shell real del destino. Si la respuesta fría supera `200 ms`, aparece únicamente la
   geometría variable del destino; nunca queda el contenido anterior bajo la URL nueva.
   Si existe una respuesta cacheada para el mismo módulo y query normalizada, se muestra
   inmediatamente y se revalida en segundo plano.
4. Cada petición navegacional usa `AbortController`. Sólo la intención más reciente puede
   aplicar estado o limpiar el indicador.
5. Los módulos pesados se separan por `dynamic import` y se precargan al expresar la
   intención. No se habilita `Link` prefetch en rutas protegidas: el guardrail de Kinde del
   repositorio tiene prioridad.
6. Back y forward deben restaurar el módulo y sus filtros sin dejar el item activo separado
   del contenido visible.

## Contrato De Skeletons

1. Un skeleton sólo aparece cuando no hay datos anteriores utilizables y la espera supera
   `200–300 ms`; para respuestas rápidas no se muestra nada adicional.
2. El placeholder representa masas reales: panel de definición, área de chart, tabla o
   bloque de evidencia. No se dibujan renglones decorativos para simular cada texto.
3. Color base recomendado: `#eeeeee` sobre superficie blanca. El contraste debe ser bajo y
   no competir con el contenido.
4. No hay shimmer por elemento ni cascadas de animaciones. Se permite como máximo un
   indicador animado por región en actualización; la geometría fría puede ser estática.
5. El placeholder reserva exactamente la altura, grid y breakpoints del resultado. No se
   fijan alturas desktop que rompan laptop o móvil.
6. `prefers-reduced-motion` detiene toda animación no esencial. Ningún estado depende del
   movimiento para ser entendido.
7. Sidebar, navegación, labels, eyebrows, títulos y controles disponibles no se convierten
   en skeletons.
8. Cuando llegan datos, sólo se permite una entrada breve de opacidad (`120–180 ms`, desde
   al menos `0.9`). No se animan posiciones, alturas ni tamaños y se desactiva con
   `prefers-reduced-motion`.

## Datos, Requests Y Charts

- Las peticiones independientes empiezan en paralelo. Ejemplo: detail y evidencia de un
  término no forman un waterfall si una no depende de la otra.
- Los resultados secundarios pueden llegar después sin bloquear el dato principal.
- Los charts declaran una geometría estable antes de montar el runtime.
- ECharts se carga fuera del bundle inicial y sólo se inicializa cuando el host está cerca
  del viewport. Nunca se monta un canvas en una sección oculta o con tamaño cero.
- Cambiar datos actualiza la instancia existente; no remonta el card ni anima su ancho o
  alto.
- Las animaciones de chart son breves y funcionales; quedan deshabilitadas con movimiento
  reducido.

## Presupuesto De Sensación

| Momento | Objetivo |
|---|---:|
| Feedback de click o filtro | `< 100 ms` |
| Aparición de skeleton frío | `220 ms` como referencia |
| Movimiento del shell durante espera | `0 px` |
| Indicadores animados simultáneos por región | `0–1` |
| Skeletons sobre contenido ya disponible | `0` |
| Charts fuera o lejos del viewport inicializados | `0` |

Estos son presupuestos de experiencia, no promesas de red. Una API local lenta debe seguir
sintiendo que respondió porque la intención se reconoce y el contexto no desaparece.

## Checklist Para Un Módulo Nuevo

- [ ] Usa `SignalV2ModuleHeader`; no recrea `signal-v2-page-head` ni `signal-v2-filterbar`.
- [ ] Su root no agrega padding superior o lateral dentro de `signal-v2-main`.
- [ ] Cada control visible modifica un contrato de datos real del módulo.
- [ ] Conserva topbar, sidebar, título y controles durante todas las cargas.
- [ ] Tiene estados separados para cold, stale, partial, empty y error.
- [ ] Cancela requests superados y prueba clicks rápidos.
- [ ] Mantiene datos previos al filtrar, paginar o revalidar.
- [ ] Retrasa el skeleton frío y usa geometría real sin text-line farm.
- [ ] Cumple movimiento reducido.
- [ ] Reserva dimensiones responsive para charts antes de cargar el runtime.
- [ ] Difiere charts fuera del viewport y chunks pesados.
- [ ] Prueba navegación directa, navegación caliente, back/forward y error de API.
- [ ] Verifica `en-US` y `es-MX`, foco visible, `aria-busy` y status accesible.
- [ ] Confirma en navegador que no hay layout shift ni errores de consola.

## Gate Durante Migraciones De Backend

Cambiar ownership, resolvers o APIs no autoriza desmontar este sistema de feedback:

- mantener `SignalV2ModuleHeader`, sidebar y navegación persistentes;
- conservar el contenido anterior durante revalidación dentro del mismo módulo;
- no sustituir cursor/paginación por un snapshot o payload completo;
- preservar query params, selección y enlace a la mención enriquecida;
- medir navegación fría y caliente antes y después del cutover;
- comparar semántica y denominadores antes de atribuir una diferencia a la UI;
- no crear skeletons o drawers paralelos para compatibilidad temporal.

El inventario del frontend y los patrones que ya fallaron viven en
`43_SIGNAL_V2_FRONTEND_SYSTEM.md`.

## Validación Mínima

La revisión no se cierra con una captura estática. Debe comprobarse en navegador:

1. entrada directa al módulo con red fría;
2. transición caliente desde y hacia Mentions;
3. filtros consecutivos antes de terminar la primera petición;
4. back/forward;
5. viewport desktop, laptop y compacto;
6. `prefers-reduced-motion`;
7. número de canvases y animaciones activas dentro y fuera del viewport;
8. consola sin errores de dimensiones, hydration o requests abortadas no manejadas.

## Shell Compartido De Workspace — Fase 6

Admin y Signal componen las mismas primitives estructurales de
`apps/studio/src/components/workspace/WorkspaceShell.tsx`:

- `WorkspaceShell`, `WorkspaceTopbar`, `WorkspaceGlobalSidebar` y `WorkspaceMain`;
- `WorkspaceContextSidebar` sólo cuando existe contexto real;
- `WorkspaceHeader`, `WorkspaceNavLink`, `WorkspaceDrawer`, `WorkspaceOverlay` y
  `WorkspaceSkipLink` para interacción, foco y accesibilidad comunes.

`AdminShell` y Signal conservan manifests, permisos y contenido separados. Compartir
primitives no autoriza mostrar navegación interna en Signal ni controles de cliente en
Admin. Una ruta nueva no debe copiar topbar/sidebar ni insertar una página standalone
dentro de `/studio` o `/signal`.

Reglas de navegación del shell:

1. el shell estático permanece montado durante navegación;
2. el destino recibe estado pending inmediato, incluso cuando su sección padre ya está
   seleccionada;
3. `prefetch={false}` se conserva en rutas protegidas;
4. `apps/studio/src/app/studio/loading.tsx` sólo representa la geometría variable del
   contenido y retrasa su aparición aproximadamente 220 ms;
5. nunca se vuelve a renderizar `StudioNav`, topbar o sidebars dentro de un loading
   boundary;
6. desktop amplio usa dos rails sólo dentro de una marca; laptop reduce ambos rails;
   compacto mueve la navegación global a drawer y el contexto a un `<select>` accesible;
7. el contenido no debe producir overflow horizontal del documento.

Validación local de Fase 6: geometría Signal idéntica al cambiar Settings → Monitoring
(topbar 48 px, sidebar 208 px, main 1072 px a 1280 px); Admin sin overflow a 1280,
1024 y 760 px; a 760 px el rail contextual está oculto y el selector contextual es el
único control visible.
