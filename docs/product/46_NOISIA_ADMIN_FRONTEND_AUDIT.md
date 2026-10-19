# 46 · Noisia Admin frontend audit and redesign contract

> **Estado vigente:** contrato implementado y verificado localmente en el recorrido
> Dashboard → Marcas → workspace de marca → operaciones avanzadas, 2026-08-05.
> **Alcance:** `/studio`, comparado contra Signal V2 y Shopify Admin autenticado.
> **Resultado:** shell compartido canonizado, recursos de marca recorridos en navegador,
> Brand OS retirado del sistema visual legacy y Equipo convertido en un índice real de
> usuarios, roles y organizaciones con detalle gobernado. Las secciones históricas de este documento
> se conservan para explicar la causa y están supersedidas por los checkpoints fechados.

## Cierre del recorrido Admin completo — 2026-08-05

La auditoría se extendió a todas las rutas Admin disponibles en el router, no sólo a
Dashboard y Marcas. El recorrido real incluyó:

```text
/studio
/studio/brands
/studio/brands/new
/studio/brands/[id]
/studio/brands/[id]/data
/studio/brands/[id]/brand-os
/studio/brands/[id]/reports
/studio/brands/[id]/settings
/studio/data
/studio/reports
/studio/team
/studio/settings
/studio/corpora/new
/studio/corpora/[id]/engine
/studio/corpora/[id]/mentions
/studio/corpora/[id]/analysis
/studio/corpora/[id]/analysis/[analysisId]
/studio/themes
```

### Pasada de continuidad: recursos restantes y Review

La verificación final volvió a recorrer el workspace de marca completo y las rutas de
operación avanzada con el mismo fixture, viewport y shell persistente. No se dio por
correcta una pantalla por compartir el layout: se abrieron menús, se navegó entre rails,
se inspeccionaron roles y se comprobó la ausencia de controles nativos visibles.

- Overview, Datos y fuentes, Brand OS, Reportes y Acceso y configuración conservan el
  mismo topbar, búsqueda, rail global, rail contextual, header, summary strip, tabla,
  status y acciones. Brand OS contiene cinco comboboxes canónicos y cero elementos
  `<select>` nativos; el menú de Estado fue abierto y comprobado en navegador.
- Alta de marca usa los mismos listboxes, tokens, controles y botones del workspace:
  tres comboboxes canónicos y cero selects nativos. El copy español de `Display name` y
  `Status` quedó corregido a `Nombre visible` y `Estado`.
- Review de T&B y Signal Pulse dejó de mantener un hero y una tira métrica paralelos.
  Ambos componen `AdminWorkspaceHeader` y `AdminSummaryStrip`. Un análisis ya aprobado
  ya no muestra el CTA deshabilitado para volver a aprobar ni su helper contradictorio;
  la aprobación sólo aparece cuando el estado real es `needs_review`.
- La navegación contextual Overview → Datos y fuentes resolvió sobre el shell existente;
  las rutas recorridas no produjeron errores ni warnings de aplicación en consola.

Quedan dos límites que esta pasada no oculta. El fixture relaciona el workspace con 15
menciones gobernadas, pero el corpus de compatibilidad muestra cero menciones incluidas;
por eso Engine y Menciones de estudio sólo permiten validar estados vacíos, no un corpus
poblado. Además, el compositor histórico todavía expone módulos beta de las lentes
multimétodo pausadas. No se cambió ese contrato ni se construyó UI nueva encima: debe
resolverse como decisión de producto/Engine separada, no como maquillaje de frontend.

### Segunda pasada: operaciones avanzadas, carga y densidad

Después del cierre del workspace de marca se repitió el recorrido sobre las superficies
que todavía podían conservar lenguaje del Engine anterior: Nuevo estudio, Engine,
Menciones, Review y preparación de Signal.

- Engine usa el mismo header y summary strip del Admin. El lifecycle dejó de ser una
  colección de cards: los cuatro estados forman una sola tira de progreso, el estado
  actual es una fila compacta y el shell no cambia de tamaño al avanzar.
- Review conserva todo el contenido operador, pero oportunidades, patrones, acciones,
  activación y contexto estructural viven ahora en una superficie continua con
  divisores. Los estados vacíos ya no crean una galería de cards anidadas.
- La selección de módulos de Signal sigue siendo explícita y accesible, pero se presenta
  como una lista de selección de dos columnas dentro de un único contenedor. En compact
  colapsa a una sola columna; no hay cards flotantes ni movimiento en hover.
- El formulario de Nuevo estudio compone el listbox canónico y los controles de `32px`.
  Themes reutiliza el mismo header, filtros, estado vacío y CTA de alta.
- Los skeletons permanecen dentro del contenido variable de cada ruta. El topbar, los
  rails y el contexto estático no se convierten en placeholders; `prefers-reduced-motion`
  elimina el reveal y no existe shimmer continuo.

La consola del recorrido final no mostró errores ni warnings de aplicación. En una
segunda pasada caliente del servidor local, las once rutas inspeccionadas respondieron
con `86–142ms` de TTFB y `108–280ms` totales. Los primeros accesos posteriores a una
edición de CSS tardaron entre `1.8s` y `4.9s` por compilación bajo demanda de Next dev;
esa pausa no se reproduce en el segundo acceso y no debe confundirse con latencia del
reader o del fixture.

Se preservó el shell persistente en los tres contextos observados: navegación global,
workspace de marca y estudio. Las pantallas de operaciones avanzadas reutilizan el
header, búsqueda, estado de serving, rail global, rail contextual, page header, botones,
controles, tablas, drawers y estados de foco del sistema canónico.

### Correcciones derivadas del recorrido

- `Nuevo estudio` tenía un segundo componente de selección (`study-select-*`). Se
  eliminó esa implementación y ahora compone `WorkspaceSelectField`, el mismo listbox
  gobernado usado por filtros y formularios Admin. El contrato acepta opciones readonly,
  estado inválido y copy de error sin crear otro select visible.
- faltaba la utility global `sr-only`; por eso las etiquetas accesibles de Themes se
  renderizaban como texto visible y rompían la toolbar. La utility y su foco semántico se
  corrigieron globalmente.
- el CTA de Review en Reportes de marca apuntaba a `/review`, una ruta inexistente. Ahora
  abre la ruta canónica `/analysis` del estudio.
- el CSS muerto de `study-select-*` fue retirado después de migrar su único consumidor.

### Interacciones verificadas

- selección de Marca en Nuevo estudio por click y teclado;
- apertura, posición y cierre del listbox dentro del viewport;
- filtros de Themes sin labels visuales duplicados;
- drawer Agregar fuente, foco inicial y cierre;
- búsqueda global Admin y sus destinos;
- navegación warm entre recursos: el item destino cambia a pending antes de `100ms`, el
  shell y el contenido anterior se conservan durante el microestado y el contenido nuevo
  sustituye al anterior al resolver;
- Engine, browser de menciones, Review y detalle estratégico renderizan dentro del mismo
  shell, sin chrome standalone.

### Diagnóstico final y límites honestos

El frontend Admin ya no mantiene un shell, select o lenguaje de cards paralelo en las
rutas recorridas. Review continúa siendo la pantalla más larga porque expone brief,
readiness, QA y preparación de publicación; la pasada final redujo su peso visual sin
esconder contenido operador ni cambiar contratos del Engine.

El fixture no contiene Themes, así que el detalle `/studio/themes/[id]` sólo fue auditado
por composición y tipos, no con una entidad real en navegador. Tampoco se ejecutaron
Engine, Claude, Voyage ni T&B de pago. La validación de responsive compacto se sustenta
en los breakpoints y el comportamiento existente del shell; este checkpoint no declara
una corrida manual en un dispositivo móvil real.

### Cierre de los recursos restantes

La última pasada recorrió de nuevo las superficies que no pertenecen a Dashboard o al
índice de Marcas y verificó sus interacciones, no sólo el primer render:

- Datos de marca: se abrió y cerró el drawer de alta de fuente y se comprobaron sus
  campos, foco y jerarquía.
- Reportes de marca: se abrió el preflight de actualización y se comprobaron periodo,
  zona horaria, tamaño, pregunta de negocio, decisión, presupuesto y confirmación, sin
  disparar un estudio de pago.
- Configuración de marca y Configuración global: las preferencias y el estado operacional
  usan filas de settings; el selector de idioma se abrió y resolvió ambas opciones.
- Equipo: Usuarios, Roles y Organizaciones son tres índices del mismo recurso. Cada fila
  abre un drawer de detalle. Roles se derivan de los helpers AuthZ reales; no se inventó
  una matriz de permisos paralela. La edición y suspensión de usuarios y organizaciones
  conserva los endpoints y restricciones existentes.
- Nuevo estudio, Themes y alta de marca: usan el listbox, inputs, toolbar, estados vacíos,
  acciones y geometría del sistema canónico; no mantienen selects nativos o formularios
  visualmente independientes.

El recorrido limpio posterior a estos cambios produjo cero errores y cero warnings de
aplicación en la consola. La primera visita a rutas aún no compiladas tardó entre `1.9s`
y `8.2s` bajo Next dev. En la segunda pasada, las rutas ya compiladas respondieron entre
`154ms` y `1.9s`, con dos lecturas locales de datos que tardaron `1.8s` y `4.5s`; el shell
permaneció visible y dio feedback durante esos estados. Estas cifras son del entorno dev
con PostgreSQL desechable y no se presentan como medición de producción.

El backlog histórico de skeletons genéricos, role detail y organization detail quedó
resuelto por las variantes geométricas de `AdminRouteSkeleton` y los drawers de Equipo.
Siguen fuera de este cierre: una entidad real para probar Theme detail, una corrida de
Engine/T&B y QA manual en un dispositivo móvil físico.

## Checkpoint vigente — 2026-08-05

Esta pasada no se validó por semejanza de capturas. Se inspeccionaron DOM, estilos
computados, navegación y estados reales en el Admin local, Signal V2 y Shopify Admin
autenticado. La evidencia vive en:

```text
.codex-artifacts/noisia-admin-audit-2026-08-05/
```

### Shell único comprobado

Valores medidos en el mismo viewport de escritorio:

| Elemento | Admin | Signal V2 | Shopify usado como benchmark |
|---|---:|---:|---:|
| Topbar | `48px`, `#0a0a0a`, padding `0 10px` | `48px`, `#0a0a0a`, padding `0 10px` | `56px` |
| Búsqueda | `620 × 32px`, radio `12px`, `13/20px` | `620 × 32px`, radio `12px`, `13/20px` | `640 × 36px`, radio `12px`, `13/20px` |
| Rail global | `208px`, `#ebebeb`, radio `12px 0 0` | `208px`, `#ebebeb`, radio `12px 0 0` | patrón equivalente |
| Main | `#f1f1f1`, radio `0 12px 0 0`, padding `12px` | mismos valores | patrón equivalente |
| Nav row | `27px`, padding `0 4px 0 8px`, radio `8px` | mismos valores | `27–28px`, mismos padding/radio |
| Nav default | `13/20px`, peso `400` | mismos valores | `13/20px`, peso normal |
| Control de formulario | `32px`, radio `8px`, `13px`, padding `5px 12px` | primitive compartida | `32px`, radio `8px`, `13/20px` |
| Chip/status | `22px`, radio `6px`, `10/18px` | primitive compartida | badge `12/16px`, radio `8px` |

Noisia conserva la geometría ya validada de Signal; Shopify informa estructura, densidad
y comportamiento, no reemplaza los números del producto.

El header, búsqueda, rail, nav links, status, cuenta, drawer, diálogo de confirmación y
page header salen ahora de primitives bajo `components/workspace`. Admin y Signal
mantienen navegación, permisos y copy propios.

### Recorrido real del workspace de marca

Fixture usado: marca `Laika Mascotas`, PostgreSQL local migrado hasta `0063`, Studio en
`:3002`, serving `governed`.

| Vista | Ruta | Resultado inspeccionado |
|---|---|---|
| Dashboard | `/studio` | carga con shell persistente y prioridades operativas |
| Marcas | `/studio/brands` | resource index, filtro y tabla navegables |
| Overview | `/studio/brands/[id]` | cinco secciones, cero primitives visuales legacy |
| Datos y fuentes | `/studio/brands/[id]/data` | fuentes/imports, dos secciones, cero errores |
| Brand OS | `/studio/brands/[id]/brand-os` | formulario compacto, controles de `32px`, cero `new-study-*` |
| Reportes | `/studio/brands/[id]/reports` | registry y preflight alineados al inicio, sin stretch artificial |
| Acceso y configuración | `/studio/brands/[id]/settings` | acceso, serving y acción destructiva con diálogo canónico |

En las cinco vistas de marca se observaron el mismo topbar, búsqueda, nav, main y
tipografía base. No aparecieron alertas de render ni keys de traducción crudas. La
navegación contextual mantiene el contenido anterior y marca el destino como pending;
en la prueba warm el feedback apareció antes de `100ms` y el cambio de contenido ocurrió
sin desmontar el shell.

### Brand OS: eliminación del frontend anterior

La edición preserva los mismos datos, handlers y endpoints. Lo eliminado es la capa
visual heredada de New Study:

```text
new-study-shell
new-study-panel
new-study-field
new-study-input
filter-input
wizard-cta
admin-form-frame
confirm-dialog (legacy)
```

Identidad, relaciones, competidores y Knowledge Base usan `workspace-form`,
`workspace-field`, `workspace-control`, `workspace-chip`, `admin-section`,
`admin-button` y el diálogo compartido. El DOM inspeccionado de Brand OS reportó cero
selectores legacy y cinco secciones de recurso.

### Controles y acciones de formulario

La inspección adicional de Shopify Settings y del editor de Agentic confirmó que un
`select` nativo no es parte del sistema visible: el control cerrado es un trigger de
`32px`, el menú es un listbox propio con radio de `12px`, padding de `6px`, opciones de
`32px`, selección neutral y checkmark. El formulario Admin adopta ese contrato mediante
`WorkspaceSelect`; la identidad de Brand OS ya no contiene elementos `<select>` nativos.

Los campos de texto, combos, tokens y textareas comparten ahora la misma superficie:
radio de `8px`, tipografía `13/20px`, ring neutral, hover más oscuro y focus azul. El
textarea del workspace no muestra el affordance de expansión del wizard de estudios.

Las acciones se ubican según el recurso que mutan:

- crear organización permanece conectado al selector Organización;
- Cancelar y Guardar viven dentro del footer de la sección Brand OS;
- agregar competidor permanece dentro de Set competitivo;
- crear o editar Knowledge Base permanece dentro de su disclosure.

No se permiten barras de acciones sueltas entre cards ni footers sticky que tapen el
contenido siguiente. La evidencia medida de este checkpoint vive en:

```text
.codex-artifacts/noisia-admin-form-audit-2026-08-05/
├── shopify-general-viewport.png
├── shopify-agentic-viewport.png
├── shopify-agentic-metric-menu.png
├── shopify-address-editor.png
├── admin-brand-os-before.png
├── admin-brand-os-after.png
├── admin-brand-os-status-menu.png
└── admin-brand-os-footer.png
```

### Límite todavía abierto

El primer paint absolutamente frío que ocurre antes de resolver autenticación sigue
perteneciendo al boundary raíz de Studio. La navegación ya autenticada dentro de Admin
usa el shell persistente y su skeleton geométrico. Cambiar el boundary raíz afecta otras
superficies protegidas y debe hacerse como una misión separada con prueba de auth, no como
un parche local de estas páginas.

## Checkpoint de implementación — 2026-08-04

La primera aplicación de este contrato quedó implementada y validada localmente sobre el
fixture Admin QA de Fase 6. Este checkpoint sustituye el diagnóstico de rutas rotas que
aparece más abajo, el cual se conserva como evidencia histórica de la causa raíz.

- El shell Admin usa la geometría canónica de Signal: topbar de `48px`, logo `70 × 20px`,
  rail global de `208px`, unión de radios `12px 0 0` / `0 12px 0 0` y main con padding
  de `12px`.
- Locale y notificaciones salieron del topbar. El idioma vive en Configuración y el slot
  superior muestra el read mode real del servidor (`legacy`, `shadow` o `governed`).
- Se eliminó el label redundante `Noisia / Workspace interno`.
- Navegación, estados activos, hover, pending y focus comparten las primitives de
  `WorkspaceShell`; Admin conserva manifest y permisos propios.
- Dashboard, Marcas, Datos y Reportes mantienen composición resource-first con tablas y
  strips densos. Equipo fue convertido de cards/wizard legacy a lista, formulario y
  secciones de recursos. Configuración ahora usa filas agrupadas por preferencia y
  contrato operativo.
- El contexto de marca usa un segundo rail estable y colapsa al selector previsto por el
  shell en viewports compactos.
- Las fechas `YYYY-MM-DD` se formatean en hora local estable para evitar el desfase de un
  día observado en Marcas.
- Las siete rutas principales y el detalle de marca fueron comprobados en navegador
  contra PostgreSQL local migrado y el fixture reproducible; no hubo cambios de backend,
  AuthZ, migraciones o contratos de serving en esta pasada.

El siguiente trabajo de frontend debe continuar **por recurso**, reutilizando
`AdminWorkspacePrimitives` y las primitives globales del workspace. No debe reintroducir
cards anidadas, estilos de wizard ni chrome local por página.

## Objetivo

El Admin interno debe conservar el lenguaje visual, la estabilidad y la densidad ya
validados en Signal V2, sin mezclar navegación o payloads client-facing con capacidades
de operador. Compartir el sistema no significa compartir permisos: significa usar la
misma geometría, tokens, estados y primitives para que Noisia se sienta como un solo
producto.

Shopify Admin se usa como benchmark de estructura e interacción, no como skin. La
traducción final mantiene Product/Google Sans, la marca Noisia y los contratos de datos
del repositorio.

## Diagnóstico inicial (histórico)

La percepción de que el Admin es un frontend standalone es visualmente correcta, aunque
el código sí comparte algunas primitives estructurales con Signal.

El problema exacto es el límite de abstracción:

- `WorkspaceShell.tsx` comparte wrappers, navegación, header, drawer y accesibilidad;
- `AdminShell` y Signal agregan después clases completamente distintas;
- `workspace-shell.css` vuelve a decidir casi toda la geometría y el aspecto del Admin;
- `signal-v2.css` conserva aparte el contrato visual aprobado;
- la pantalla Team sigue usando primitives legacy de New Study (`new-study-panel`,
  `wizard-cta`, `filter-input`) y radios de hasta `24px`.

Por tanto, Fase 6 logró compartir estructura, pero todavía no consolidó el contrato
visual. Copiar CSS de Signal dentro de cada página Admin sería otro parche. La solución
es elevar el chrome aprobado a componentes y tokens globales compartidos, manteniendo
composiciones y permisos separados.

También existe un bloqueo funcional independiente del diseño: Dashboard, Marcas, Datos
y Reportes fallan en el entorno local porque la base configurada no contiene
`signal_workspace_population_pointers`. No son rutas inexistentes. Equipo y
Configuración sí renderizan.

## Evidencia Inspeccionada

### Producto local

- Signal V2, Topics & Narratives, en navegador real.
- Admin: Dashboard, Marcas, Datos, Reportes, Equipo y Configuración.
- DOM, computed styles y estados de error del navegador.
- composición React, CSS global, rutas, loading boundary y queries del Admin.

### Shopify Admin autenticado

- Inicio.
- Clientes.
- Configuración.
- Usuarios.
- Roles.
- Detalle de rol y grupos de permisos.
- Shopify Flow, sin instalar ni modificar apps.
- Tienda online.

Evidence pack local:

```text
.codex-artifacts/noisia-admin-audit-2026-08-04/
├── 01-signal-tn.png
├── 01-admin-settings.png
├── 02-admin-reports.png
├── 02-admin-team.png
├── 03-shopify-flow.png
├── 03-shopify-settings.png
├── 04-admin-dashboard-error.png
├── 04-shopify-home.png
├── 06-shopify-users.png
├── 07-shopify-roles.png
├── 08-shopify-role-detail.png
├── 09-shopify-customers.png
└── 10-shopify-online-store.png
```

Capturas clave:

![Signal V2](../../.codex-artifacts/noisia-admin-audit-2026-08-04/01-signal-tn.png)

![Admin Team](../../.codex-artifacts/noisia-admin-audit-2026-08-04/02-admin-team.png)

![Shopify Users](../../.codex-artifacts/noisia-admin-audit-2026-08-04/06-shopify-users.png)

## Comparación medida antes del refactor (histórico)

Valores observados con el inspector, no estimaciones visuales:

| Elemento | Signal V2 | Admin actual | Diagnóstico |
|---|---|---|---|
| Topbar | `48px`, `#0a0a0a`, padding `0 10px` | `48px`, `#202020`, padding `0 12px 0 0` | Misma altura, distinta superficie y distribución |
| Logo | `70 × 20px` | `79 × 23px` | Admin rompe escala aprobada |
| Sidebar | `208px`, `#ebebeb`, radio `12px 0 0` | `208px`, `#ebebeb`, radio `0` | Falta la unión superior del shell |
| Main | radio `0 12px 0 0`, padding `12px` | radio `0`, padding `0` + página `24–40px` | Cambia coordenadas y densidad entre productos |
| Nav row | `27px`, padding `0 4px 0 8px` | mínimo `34px`, padding `6px 9px` | Admin se siente más alto y pesado |
| Nav default | `13px`, peso normal | `13px`, peso `540` | Jerarquía demasiado fuerte sin selección |
| Nav active | `#fafafa`, peso `600` | `#d5d5d5`, peso `700` | Estado opaco y más oscuro que el canon |
| Workspace header | título `18px/600` | hereda una escala mayor en páginas | Falta un único contrato de página |

Shopify confirma el patrón estructural: sidebar gris, item activo blanco, filas compactas,
main con radio superior derecho y navegación persistente. Su topbar mide `56px`; Noisia
no debe copiar ese número porque Signal ya validó `48px`.

## Auditoría De Componentes

### Reutilización real

| Pieza | Compartida hoy | Estado |
|---|---|---|
| Shell, topbar y main | `WorkspaceShell`, `WorkspaceTopbar`, `WorkspaceMain` | Compartidos como wrappers |
| Sidebar y nav link | `WorkspaceGlobalSidebar`, `WorkspaceNavLink` | Interacción compartida, apariencia redefinida |
| Header | `WorkspaceHeader` | Compartido; las páginas aún cambian sus coordenadas externas |
| Drawer | `WorkspaceDrawer` | Primitive correcta para reutilizar |
| Focus, skip link, overlay | `WorkspaceSkipLink`, CSS global | Correcto |
| Loading | `studio/loading.tsx` | Shell persiste, pero el skeleton es una plantilla única genérica |

### Duplicación y drift

1. `AdminShell.tsx` crea branding, búsqueda, locale, notificaciones, cuenta, workspace
   label y footer propios en lugar de componer el chrome validado de Signal.
2. `workspace-shell.css` define un segundo sistema de nav, topbar y main para Admin.
3. `signal-v2.css` conserva el sistema visual aprobado fuera de esas primitives.
4. `TeamManager.tsx` mezcla funcionalidad vigente con componentes visuales legacy del
   wizard de estudios.
5. Team queda envuelto así: `admin-form-frame` → `team-manager` → múltiples
   `new-study-panel` → `team-row`, con bordes y radios por nivel.
6. `globals.css` aplica `24px` a `org-form` y `team-row`, incompatible con el radio de
   `8px` documentado para Signal/Admin denso.
7. Algunas páginas usan tablas razonables, pero las contienen en `admin-section` y
   `admin-filterbar` independientes, sin una primitive canónica de resource index.

### Decisión de arquitectura frontend

No importar clases `signal-v2-*` directamente en páginas Admin. Tampoco crear un segundo
design system Admin.

El refactor debe elevar al nivel compartido:

- geometría de topbar/sidebar/main;
- marca y búsqueda global;
- cuenta y utility/status slot;
- item de navegación con estados default, hover, active, pending y focus;
- tokens de color, radio, altura, padding y tipografía;
- page header y action row;
- resource toolbar, table/list, empty state y detail layout;
- settings shell con navegación secundaria;
- feedback de carga según el contrato de Signal.

Signal y Admin deben seguir teniendo manifests, permisos, copy y contenido separados.
No se crea un componente gigante con ramas de producto.

## Auditoría Funcional De Rutas

Resultado observado en el navegador local:

| Ruta | Resultado | Causa |
|---|---|---|
| `/studio` | Error | query a tabla ausente |
| `/studio/brands` | Error | misma dependencia |
| `/studio/data` | Error | misma dependencia |
| `/studio/reports` | Error | misma dependencia |
| `/studio/team` | Renderiza | usa data de team legacy/vigente |
| `/studio/settings` | Renderiza | no consulta el resumen workspace |

Error exacto:

```text
relation "signal_workspace_population_pointers" does not exist
```

La query está en `apps/studio/src/lib/data/admin-workspace.ts`, dentro de
`ADMIN_BRAND_WORKSPACES_SQL`, y alimenta las cuatro superficies fallidas mediante
`listAdminBrandWorkspaces`/`getAdminDashboard`.

Esto expone un problema de readiness, no uno de navegación:

- Fase 6 fue validada contra PostgreSQL desechable con migraciones hasta `0063`;
- el servidor local actual apunta a un esquema anterior a `0059`;
- la UI muestra el error SQL crudo y bloquea QA.

### Corrección requerida

Antes del rediseño visual debe existir una de estas condiciones, explícita y probada:

1. entorno local de Admin con las migraciones de la rama aplicadas; o
2. readiness guard server-side que muestre un estado de configuración para operador sin
   ejecutar queries incompatibles.

No se debe agregar un reader semánticamente incorrecto ni inventar datos para esconder la
falta del esquema. Tampoco exponer el mensaje SQL crudo al usuario final.

## Header Superior

### Locale

El selector `ES/EN` sí es funcional: reutiliza `LocaleSwitcher` y una server action. El
problema es su prioridad y falta de contexto, no que sea una maqueta. Debe moverse a
preferencias de cuenta o Configuración. La barra superior no necesita mostrarlo de forma
permanente.

### Notificaciones

El botón Bell no tiene destino, contador ni sistema detrás. Debe eliminarse. Un control
sin función no ocupa un slot persistente.

### Estado operacional

El slot puede usarse para un status compacto de plataforma sólo si existe un contrato
server-owned real. Puede resumir engine, workers/queue y serving en un popover accesible.
No debe ser un semáforo derivado en cliente ni una etiqueta siempre verde.

### Workspace label

`Noisia / Workspace interno` es redundante con `Noisia Admin` en el topbar y no cambia de
contexto. Debe eliminarse. El rail global empieza con navegación; el rol/cuenta puede
permanecer en el footer o account menu.

## Arquitectura De Información Objetivo

### Navegación global

```text
Admin
├─ Dashboard
├─ Marcas
├─ Datos
├─ Reportes
├─ Equipo
└─ Configuración
```

`Corpora` no debe exponerse como peer visual permanente sólo por compatibilidad. Si una
operación avanzada sigue siendo necesaria, vive dentro de Datos, Reportes o un área
técnica permission-aware. No se elimina funcionalidad ni rutas legacy durante este
refactor.

### Contexto de marca

Al entrar a una marca aparece navegación secundaria estable:

```text
Marca
├─ Resumen
├─ Datos y fuentes
├─ Brand OS
├─ Reportes
└─ Configuración
```

El rail secundario puede ocupar el contexto actualmente previsto por
`WorkspaceContextSidebar`. En laptop se compacta; en viewport pequeño se convierte en un
selector accesible. No se usa hash para vistas con datos, AuthZ o loading boundary propio.

### Dashboard

Shopify Home prioriza trabajo operativo y contexto inmediato antes de contenido
promocional. Noisia debe traducirlo a:

1. tareas que requieren atención;
2. imports, fuentes o revisiones en curso;
3. freshness/quality por marca;
4. actividad reciente y resultado;
5. accesos rápidos con capacidad real.

Los datos ya previstos por `getAdminDashboard` son una base válida. No se necesitan big
cards decorativas ni un chat ficticio. Los KPIs existen sólo cuando ayudan a decidir qué
hacer después.

### Marcas

Resource index table-first:

- búsqueda y filtros compactos;
- cobertura, freshness, quality y report state;
- acciones primarias claras;
- selección/bulk action sólo si existe una operación segura;
- navegación al contexto de marca en una ruta de detail independiente.

### Datos

Debe responder qué fuentes existen, qué import está corriendo, qué requiere revisión y
qué población es servible. Tablas y listados dominan; cards sólo para un resumen o estado
que no encaje en una fila.

### Reportes

Registry por marca y metodología/release, no catálogo de pantallas. Debe mostrar estado,
última actividad, revisión necesaria y acción disponible. Una corrida nueva mejora el
workspace y crea revisión; no crea una nueva sección lateral.

### Equipo y accesos

La pantalla actual debe dividirse en recursos, no apilar todas las capacidades:

```text
Equipo y accesos
├─ Usuarios
├─ Roles
└─ Organizaciones
```

Patrón adaptado de Shopify:

- Users: tabs/status, search/filter/sort, tabla, invitación como acción primaria.
- Roles: tabla con nombre, alcance y personas asignadas.
- Role detail: nombre/descripción, personas asignadas y permisos agrupados con conteos.
- Organizations: tabla independiente con marcas, usuarios, estado y acciones.
- Edición/destrucción en detail o drawer gobernado, no cuatro botones repetidos por card.

La funcionalidad actual de `TeamManager` debe preservarse durante la migración. Se cambia
la composición visual y la navegación, no se reescriben APIs de usuarios/organizaciones
sin demostrar un bug.

### Configuración

Shopify trata Settings como una arquitectura propia con navegación secundaria y páginas
de detalle. Noisia debe separar:

- Preferencias generales;
- Acceso y seguridad;
- Plataforma operativa: engine, workers, serving y rollout;
- configuración por marca, sólo dentro de la marca.

`Serving operacional` y permisos no deben competir en dos cards sin jerarquía. El resumen
de estado puede vivir en topbar; la explicación y configuración técnica viven en la
sección operativa.

## Patrones Shopify Traducidos A Noisia

| Shopify | Principio | Traducción Noisia |
|---|---|---|
| Home | Prioriza trabajo inmediato | atención, imports, revisión, freshness y actividad |
| Customers | Resource table con filtros y columnas | Marcas, Datos, Usuarios y Organizaciones |
| Users | estados/tabs + acciones directas | miembros activos, pendientes e internos/cliente |
| Roles | registry separado | roles gobernados con asignaciones visibles |
| Role detail | permisos agrupados con conteo | capacidades por dominio, server-side auth intacta |
| Flow | core operacional en tabla; discovery secundario | report runs/automations primero, ayudas después |
| Online Store | subnav persistente de contexto | navegación secundaria de marca |
| Settings | categorías y páginas de detalle | preferencias, acceso, plataforma y settings de marca |

No copiar:

- marca, assets o copy de Shopify;
- altura de topbar `56px` cuando Signal ya validó `48px`;
- módulos Sidekick/AI sin función real;
- patrones de e-commerce sin equivalente en Noisia.

## Loading, Navegación Y Sensación

El Admin debe adoptar el contrato de `38_SIGNAL_LOADING_AND_NAVIGATION_STANDARD.md`:

- shell persistente;
- feedback de intención menor a `100ms`;
- skeleton frío retrasado aproximadamente `220ms`;
- contenido anterior durante revalidación cuando siga siendo válido;
- skeleton sólo sobre geometría variable;
- sin líneas decorativas de texto, shimmer rápido o layout shift;
- `prefers-reduced-motion`;
- errores accionables dentro del frame real.

`studio/loading.tsx` ya retrasa la aparición, pero usa una sola geometría header + summary
+ tabla para todas las rutas. Debe evolucionar a variantes de resource index, settings y
detail, manteniendo el mismo shell y header real.

## Plan De Implementación

### P0 — restaurar una base auditable

1. Alinear el entorno local con migraciones `0059–0063` o implementar un readiness state
   server-side explícito.
2. Revalidar Dashboard, Marcas, Datos y Reportes con consola limpia.
3. Extraer el chrome de Signal a tokens/primitives globales sin cambiar su geometría.
4. Hacer que Admin componga ese chrome: topbar `48px`, sidebar `208px`, radios, nav rows,
   búsqueda, cuenta y estados canónicos.
5. Eliminar Bell, mover Locale, quitar `Workspace interno` y no mostrar utilidades fake.
6. Probar wide desktop, laptop y compacto antes de tocar páginas internas.

### P1 — recursos y configuración

1. Crear primitives compartidas de resource index: toolbar, table/list, empty, pagination
   y loading geometry.
2. Rediseñar Equipo como Users/Roles/Organizations.
3. Crear role detail y organization detail reutilizando APIs actuales.
4. Convertir Configuración en settings shell con navegación secundaria.
5. Agregar platform status sólo con datos operativos reales.

### P2 — contenido operacional

1. Reorganizar Dashboard alrededor de atención y actividad.
2. Consolidar Marcas, Datos y Reportes como resource indexes densos.
3. Completar contexto de marca y responsive.
4. Validar `es-MX` y `en-US`, navegación por teclado, reduced motion y errores.

## Gates De Aceptación

### Shell

- topbar, sidebar y main coinciden en geometría al alternar Signal/Admin;
- sidebar: radio sólo arriba izquierda;
- main: radio sólo arriba derecha;
- nav default normal, active `600` sobre `#fafafa`;
- ningún módulo redefine padding para corregir coordenadas;
- desktop, laptop y compacto sin overflow del documento.

### Funcionalidad

- las seis rutas globales cargan con el entorno soportado;
- pending aparece al click y no deja URL/contenido desincronizados;
- errores de DB/API no exponen mensajes internos;
- AuthZ sigue validándose server-side;
- no se habilita prefetch en rutas protegidas.

### Team y Settings

- Team no contiene cards anidadas;
- users, roles y organizations tienen índice y detail claros;
- permisos se agrupan y explican sin lenguaje técnico innecesario;
- settings globales y de marca no se mezclan;
- engine/serving aparece sólo con contrato real y estado honesto.

### Calidad visual

- Product/Google Sans y texto funcional mínimo `12px`;
- radio base `8px`;
- sin gradients, glows, glass, big cards decorativas o selección con línea izquierda;
- hover, active, pending y focus-visible son estados distintos;
- skeletons respetan geometría final y reduced motion.

## Archivos A Preservar Y Reutilizar

```text
apps/studio/src/components/workspace/WorkspaceShell.tsx
apps/studio/src/components/workspace/AdminShell.tsx
apps/studio/src/components/signal-v2/SignalV2WorkspacePage.tsx
apps/studio/src/components/signal-v2/SignalV2ModuleHeader.tsx
apps/studio/src/app/workspace-shell.css
apps/studio/src/app/signal-v2/signal-v2.css
apps/studio/src/app/studio/layout.tsx
apps/studio/src/app/studio/loading.tsx
apps/studio/src/components/admin/AdminWorkspacePrimitives.tsx
apps/studio/src/components/team/TeamManager.tsx
apps/studio/src/lib/navigation/admin-navigation.ts
apps/studio/src/lib/data/admin-workspace.ts
apps/studio/messages/es-MX.json
apps/studio/messages/en-US.json
```

Todos contienen WIP válido. El refactor debe inspeccionar el diff antes de editar y no
reemplazar estos archivos completos.

## Límites de la auditoría inicial (histórico)

- No se instaló ni modificó Shopify Flow.
- No se inspeccionó código privado de Shopify; se observaron DOM, estilos computados y
  comportamiento renderizado.
- No se modificó el frontend de Noisia.
- No se aplicaron migraciones ni se cambió la base local.
- No se validó producción ni staging.
- El responsive se auditó por CSS y por la evidencia previa de Fase 6; la implementación
  siguiente debe repetir QA manual en los tres breakpoints con las páginas funcionales.

## Checkpoint De Flujo Completo — 4 Ago 2026

Esta sección actualiza los límites históricos anteriores. Con PostgreSQL local migrado
hasta `0063`, el fixture `admin-qa` y Studio en `:3002`, se recorrió de nuevo el flujo
completo del Admin. El evidence pack de esta pasada vive en:

```text
.codex-artifacts/noisia-admin-flow-audit-2026-08-04/
```

### Rutas verificadas

| Flujo | Ruta | Resultado local |
|---|---|---|
| Dashboard | `/studio` | carga y datos coherentes |
| Marcas | `/studio/brands` | carga, filtros y tabla |
| Alta de marca | `/studio/brands/new` | carga el intake completo |
| Overview de marca | `/studio/brands/[id]` | carga con contexto persistente |
| Datos de marca | `/studio/brands/[id]/data` | carga fuentes e imports |
| Brand OS | `/studio/brands/[id]/brand-os` | carga edición y compatibilidad |
| Reportes de marca | `/studio/brands/[id]/reports` | carga registry, Review y releases |
| Settings de marca | `/studio/brands/[id]/settings` | carga acceso y configuración |
| Datos globales | `/studio/data` | carga índice cross-brand |
| Reportes globales | `/studio/reports` | carga índice cross-brand |
| Equipo | `/studio/team` | carga organizaciones, usuarios y roles |
| Configuración | `/studio/settings` | carga settings y platform status |

`Corpora`, `Themes` y sus rutas de Engine permanecen como superficies de compatibilidad,
no como la arquitectura de información principal del nuevo Admin.

### Diagnóstico consolidado

Las pantallas no faltaban físicamente: el entorno remoto legacy ocultaba varias de ellas y
la fragmentación visual hacía que el producto se percibiera como una colección de flujos
independientes. Con el fixture correcto, el problema principal es de jerarquía y consistencia:

- Dashboard separaba atención, cola y marcas en cards equivalentes sin una lectura operativa
  clara.
- Marcas separaba filtros y resultados en dos contenedores para un solo recurso.
- Alta de marca todavía heredaba la geometría decorativa de New Study: cards anidadas,
  sombras, radios grandes y acciones de wizard.
- Los details de marca ya usan el shell contextual y deben preservarse como base.
- Datos, Reportes, Equipo y Configuración funcionan; requieren sus propias pasadas por
  recurso y no deben ser parcheados dentro de este corte.

### Implementación autorizada en esta pasada

Sólo se rediseñaron Dashboard y el flujo de Marcas:

- Dashboard ahora ordena el trabajo como resumen operativo → prioridades → cola → estado de
  todos los workspaces. Las marcas con problemas aparecen primero, sin ocultar las saludables.
- Prioridades y cola usan listas densas, con estados semánticos y sin altura forzada entre
  columnas.
- Marcas consolida header, búsqueda, organización, estado, tabla y paginación en un único
  resource index.
- Frescura y calidad se agrupan como una sola lectura de salud de datos.
- Alta de marca conserva toda la lógica existente de Brand OS y Claude, pero adopta las
  primitives, densidad, inputs, botones y radios del Admin/Signal; no se reimplementó el
  formulario ni se alteró su contrato.
- Se agregaron copias completas para `es-MX` y `en-US`.

### Backlog deliberadamente no implementado

- Variantes de skeleton por geometría: resource index, detail, settings e intake.
- Refinamiento de columnas/acciones en Datos y Reportes.
- Role detail y organization detail dentro de Equipo.
- Separación más profunda entre preferencias y estado de plataforma en Configuración.
- Revisión visual de Brand OS edit y superficies legacy de Corpora/Engine.
- QA manual con viewport móvil real, lector de pantalla y navegación completa por teclado.

Este backlog no bloquea la coherencia del shell ni el uso de Dashboard/Marcas, pero sí debe
cerrarse por recursos antes de declarar terminado todo el frontend del Admin.
