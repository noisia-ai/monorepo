# Noisia Studio UI/UX Audit

Fecha: 2026-05-25

## Estado corregido en esta pasada

- La entrada al Studio ya no cae directo en una pantalla hosted sin contexto. Ahora existe una puerta visual propia en `/login` y `/`.
- Las rutas protegidas de Studio redirigen a `/login?next=...` para conservar intención de navegación antes de mandar al proveedor de identidad.
- Se agregaron skeletons para cargas server-rendered de App Router en root, `/studio` y corpus.
- Se agregó error boundary de Studio con acción de reintento.
- Se agregó focus visible global para navegación con teclado.

## Riesgos UX todavía abiertos

- La pantalla hosted del proveedor de identidad todavía puede necesitar branding desde su dashboard o un flujo custom completo.
- Los filtros de `Marcas` y `Themes` todavía usan `select` nativo; el patrón correcto debe migrar al componente `ReportFilterPanel`.
- Falta un loading state de navegación entre tabs que mantenga el navbar fijo y reduzca sensación de pantalla congelada.
- El `confirm()` nativo en restore de snapshots debe reemplazarse por modal propio.
- Los errores de API en varias acciones todavía no tienen un toast/feed centralizado; se muestran inline por módulo.

## Próximo orden recomendado antes de producción

1. Integrar Kinde real con roles, permisos y pantalla de no autorizado.
2. Crear componente universal de feedback async: loading, success, error, retry.
3. Migrar filtros simples de Brands/Themes al patrón avanzado de report filters.
4. Reemplazar confirms nativos por modal propio.
5. Pasar a Railway con env vars separadas por servicio.

## Relación con el plan original

Este polish pertenece a Fase 1 del MVP: auth, shell interno y operación básica del Studio. No cambia la prioridad de Triggers & Barriers; prepara la experiencia para que los analistas puedan operar el engine sin pantallas mudas, saltos de sesión o errores sin contexto.
