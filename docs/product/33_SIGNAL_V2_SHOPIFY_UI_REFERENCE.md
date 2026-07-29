# 33 · Signal V2 — Shopify UI Reference

> **Estado:** referencia inspeccionada y primer slice implementado, 2026-07-24.
> **Alcance de esta fase:** shell, navegación, búsqueda, filtros, densidad, arquitectura
> de render y primera vista funcional de Monitoreo de marca.
> **Fuente observada:** Shopify Admin Analytics autenticado, en desktop.
> **Implementación:** `/signal-v2/{outputId}`. El contrato funcional y de datos vive en
> `34_SIGNAL_BRAND_MONITORING_V1.md`.

Este documento convierte la inspección visual y de DOM/computed styles de Shopify Admin
en un contrato de diseño para Signal V2. No propone copiar la marca, los assets ni la
arquitectura de información de e-commerce. La intención es adoptar su disciplina de
producto —geometría, densidad, jerarquía, interacción y velocidad percibida— y traducirla
a la inteligencia social de Noisia.

`31_SIGNAL_PRODUCT_NORTH_STAR.md` sigue gobernando qué es Signal. Este documento empieza
a especificar cómo debe sentirse su experience plane.

## Decisión

Signal V2 se construye sobre un app shell nuevo y aislado antes de migrar cualquier
módulo actual. La primera entrega del shell incluyó:

1. barra superior global;
2. navegación lateral;
3. búsqueda global;
4. marco de contenido con scroll aislado;
5. estados de navegación, responsive y accesibilidad;
6. una superficie gobernada donde sumar cada módulo posterior.

La primera superficie de producto suma Monitoreo de marca con charts y menciones
conectados a Data OS. No incorpora módulos T&B ocultos. La data actual y las rutas legacy
se preservan durante la transición.

## Qué Se Midió En Shopify

La inspección se hizo con viewport de aproximadamente `1986 × 1689` CSS px. Los valores
son medidas observadas, no tokens oficiales de Polaris.

### App shell

| Elemento | Medida / comportamiento observado | Traducción a Signal V2 |
|---|---|---|
| Barra superior | `56px` de alto, fija, `#0a0a0a` | Mantener `56px`; identidad Noisia, búsqueda y utilidades |
| Sidebar | `240px` de ancho, fija bajo la barra | Mantener `240px` desktop; navegación de Signal, no de e-commerce |
| Main | Empieza en `x=240`, scroll vertical propio | Body inmóvil; sólo el main debe hacer scroll |
| Fondo sidebar | `#ebebeb` | Neutral Noisia de navegación |
| Fondo main | `#f1f1f1` | Superficie de trabajo, no fondo editorial blanco |
| Gutter main | `16px` | Token base del dashboard |
| Radio del marco main | `12px` en la unión superior | Mantener una sola transición sutil entre shell y contenido |

La barra y el sidebar no cambian de tamaño al cambiar de página. Eso hace que la
interfaz se perciba estable aun cuando el contenido es denso.

### Tipografía y densidad

Shopify usa Inter con estas métricas observadas:

| Uso | Tamaño | Peso | Línea |
|---|---:|---:|---:|
| Texto base | `13px` | `450` | `20px` |
| Título de página | `18px` | `600` | `24px` |
| Título de card | `13px` | `600` | `16px` |
| Valor de métrica | `20px` | `600` | `20px` |
| Labels de charts | `11–12px` | variable | compacta |

Signal conservará esas proporciones y densidad usando Product Sans / Google Sans. El
repositorio ya contiene assets de Product Sans; antes de producción se debe confirmar
su licencia de distribución. La referencia es la métrica, no convertir todo el producto
en tipografía grande/editorial.

### Navegación lateral

- Cada item primario ocupa `208 × 28px`, posicionado a `10px` del borde izquierdo.
- El ritmo vertical es exactamente `28px`; no hay gaps ornamentales entre cada item.
- Padding del item: `0 4px 0 8px`.
- Radio: `8px`.
- El item seleccionado usa superficie `#fafafa` y texto semibold `600`.
- El subnivel conserva `28px` de alto y aumenta el padding izquierdo a `36px`.
- Texto secundario: `#616161`.
- Los grupos tienen `12px` de padding vertical.
- La configuración vive anclada abajo, separada del scroll principal de navegación.

La lección no es meter muchas entradas. Es que incluso una jerarquía profunda mantiene
ritmo, alineación y estado activo inequívoco.

### Barra superior y búsqueda

- La búsqueda central mide `640 × 36px`.
- Superficie: `#282828`; texto e iconos: `#dcdcdc`.
- Radio: `12px`.
- Shortcut visible: `⌘ K`.
- La barra distribuye tres zonas estables: identidad, búsqueda y utilidades.
- Acciones icon-only: `36 × 36px`, radio `12px`.
- Cuenta/workspace: `132 × 36px` en la referencia observada.

La búsqueda global abre un command surface:

- modal `648 × 250px` aproximadamente;
- posición superior, centrada, a `4px` del borde;
- radio `12px`;
- overlay `rgba(0,0,0,.71)`;
- input útil de `557px`;
- chips de alcance de `20px` de alto, radio `8px`;
- sombra profunda sólo para separar el modal del producto.

En Signal buscará corpus, menciones, findings, temas, módulos, periodos y releases. No
será un campo decorativo.

### Controles y filtros

- Altura base: `28px`.
- Radio: `8px`.
- El borde se compone con sombras inset sutiles, no con un stroke pesado.
- El control seleccionado gana contraste, no tamaño.
- Todos los popovers observados usan radio `12px`, `z-index: 520` y la misma sombra
  multicapa.

Medidas observadas:

| Popover | Medida |
|---|---:|
| Periodo/calendario dual | `700 × 393px` |
| Comparación | `247 × 156px` |
| Selector searchable | `250 × 414px` |
| Celda de día | `32 × 32px`, radio `8px` |
| Row estándar de selector | `32px` |
| Row con label largo | `52px` |

El selector searchable enfoca automáticamente el input. Su foco observado usa fondo
`#f7f7f7`, borde oscuro fino y outline azul `#005bd3` de aproximadamente `2px`. El valor
seleccionado usa `#ebebeb`, peso `600` y check visible. El scroll queda confinado al
popover.

Para Signal, la primera fila compartida de filtros deberá traducirse a:

- periodo;
- comparación;
- fuente/corpus;
- plataforma;
- filtros adicionales contextuales.

No se copia el selector de moneda porque no pertenece al dominio.

### Cards y grid analítico

- Grid interno de 12 columnas.
- Gap visual entre cards: `16px`.
- Card observada: `555 × 344px` a tres columnas en el viewport inspeccionado.
- Fondo: `#fff`.
- Radio: `12px`.
- Padding: `16px`.
- Cuerpo de chart observado: `523 × 248px`.
- La sombra es multicapa y muy corta; funciona principalmente como borde óptico.

Los charts reciben un contenedor con dimensiones estables. La versión visual se
acompaña de estructura semántica: las cards inspeccionadas exponen regiones nombradas y
tablas accesibles con los valores del gráfico.

## Por Qué El Signal Actual Se Siente Lento

La inspección runtime del Signal local, en `1280 × 720`, confirmó que la sensación no es
solamente estética.

### Render observado

| Indicador | Signal actual |
|---|---:|
| Elementos DOM | `4,716` |
| Artículos montados | `197` |
| Artículos de secciones ocultas con tamaño cero | `77` |
| Menciones montadas debajo del viewport | `120` |
| SVG montados | `341` |
| SVG con tamaño cero | `78` |
| Alto del “topbar” | `186px` |
| Ancho del sidebar | `184px` |
| Base tipográfica | `16px / 25.6px` |

La página server-renderiza prácticamente todos los módulos y después
`SignalReportShell` cambia `hidden` según el hash. Ocultar con CSS no desmonta React ni
evita que charts y componentes hagan trabajo. Esto produce warnings repetidos de
Recharts con contenedores `-1 × -1` y `0 × 0`.

Además:

- el topbar permite wrap y termina siendo una cápsula de `186px`, no una barra;
- el body completo hace scroll en lugar de un main aislado;
- el corpus trae y monta `120` cards aunque al cargar la página están debajo del fold;
- el reading guide permanente consume otros `104px` antes del contenido útil;
- no hay `h1` en la vista inspeccionada;
- `globals.css` contiene definiciones repetidas de `.signal-topbar` y otros componentes,
  de modo que overrides tardíos cambian la intención original;
- la página mezcla shell, navegación, datos y todos los módulos en un único árbol
  server-rendered.

Referencias concretas:

- `apps/studio/src/app/signal/[outputId]/page.tsx` renderiza las secciones completas.
- `apps/studio/src/components/signal/SignalReportShell.tsx` las muestra/oculta por hash.
- `apps/studio/src/components/signal/SignalCorpusExplorer.tsx` monta la página completa
  de menciones.
- `apps/studio/src/app/globals.css` contiene el shell y sus overrides acumulados.

## Arquitectura De Render Para Signal V2

La nueva UI deberá cumplir estas reglas antes de migrar contenido:

1. El shell se monta una vez; cada módulo es una ruta o chunk independiente.
2. Sólo el módulo activo existe en el DOM y se hidrata.
3. Ningún chart se monta dentro de un contenedor oculto o sin dimensiones.
4. Cada chart declara altura/min-height estable antes de recibir datos.
5. El corpus mantiene paginación server-side y virtualiza listas largas.
6. Los filtros viven en URL/state canónico y cancelan requests superados.
7. Shell y skeleton pintan antes que la data sin cambiar geometría.
8. Topbar, sidebar y main tienen scroll/overflow definidos; el body no compone toda la
   página.
9. Las interpretaciones Claude y las métricas llegan como recursos separados; cambiar
   un filtro no bloquea toda la ruta.
10. Empty, loading, partial, stale y error son estados explícitos del mismo componente.

Gates mínimos del primer slice:

- cero warnings de charts con dimensiones `0` o negativas;
- los módulos no activos no aparecen en el DOM;
- navegación y command search funcionan sólo con teclado;
- `h1`, landmarks, foco visible y skip link presentes;
- el shell no cambia de geometría entre rutas;
- interacción local de navegación con respuesta visual inmediata;
- no cargar corpus, charts ni T&B en la ruta vacía del shell.

## Arquitectura De Información Inicial

La navegación debe reflejar el North Star, no los 14 módulos históricos como peers.

```text
Signal
├─ Overview
├─ Conversation
│  ├─ Mentions
│  ├─ Topics & narratives
│  └─ Sources
├─ Triggers & Barriers
│  ├─ Current release
│  ├─ Opportunities
│  └─ History
├─ Evidence
└─ Settings
   ├─ Data & freshness
   └─ Workspace
```

Es una hipótesis inicial para diseñar juntos. No fija todavía el copy final ni autoriza
eliminar módulos legacy.

## Primer Slice De Implementación

El siguiente cambio debe crear un `SignalV2Shell` aislado, sin migrar el dashboard
actual:

- ruta o flag exclusivamente de desarrollo;
- topbar `56px`;
- sidebar `240px`;
- main con scroll aislado y fondo `#f1f1f1`;

El contenido inicial de ese slice ya no será un canvas vacío: será
`34_SIGNAL_BRAND_MONITORING_V1.md`. Monitoreo de marca prueba el shell con métricas
always-on reales antes de migrar Triggers & Barriers.
- Product Sans / Google Sans con la escala compacta documentada;
- navegación con estados default, hover, active, focus y collapsed;
- búsqueda global vacía con `⌘ K`;
- área de contenido con un único estado “Empty canvas”;
- responsive desktop/tablet y drawer móvil;
- tests del shell y una captura visual base.

Al aprobar ese bloque visual se implementan, en este orden:

1. primitives de filtros y estado URL;
2. Overview con skeletons;
3. Corpus/Mentions virtualizado;
4. charts y drill-down;
5. interpretaciones vivas;
6. releases estratégicos T&B.

## Límites De La Referencia

- La inspección no accedió al código fuente privado de Shopify.
- Los valores provienen de DOM, accessibility tree y computed styles del producto
  renderizado.
- Shopify mostró warnings propios de accesibilidad para algunos icon buttons y selects;
  sus patrones visuales se toman como referencia, no sus defectos.
- La evaluación fue desktop. Los breakpoints y navegación móvil deben diseñarse y
  probarse en el slice del shell.
- No se modificó Signal durante esta auditoría.
