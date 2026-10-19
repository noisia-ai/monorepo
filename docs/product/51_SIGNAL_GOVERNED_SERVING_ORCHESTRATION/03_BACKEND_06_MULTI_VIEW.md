# Backend 06 · Competition, category y all-governed

## Objetivo

Completar la exploración client-safe sin convertir `excluded` en invisibilidad total y
sin mezclar scopes en el denominador `brand`.

Views objetivo:

- `competition`;
- `category`;
- `all-governed`.

`unattributed` permanece fuera de estas views cliente y disponible en Admin reservoir.

## 1. Contratos antes de datos

Publica contratos cerrados de data-use por `(module_key, view_key)` antes de compilar
policies nuevas. No generalices automáticamente los usos de `brand`.

Cada view debe definir explícitamente:

- scopes y entidades permitidos;
- módulos autorizados;
- quality/retention/licensing authorities;
- required usage purposes por módulo;
- visibility class;
- denominator;
- canonical-root deduplication;
- coverage y stop conditions.

Semántica:

- `competition`: scopes `competitor`, con entidades exactas gobernadas;
- `category`: scope `category`, con entidades exactas gobernadas;
- `all-governed`: unión deduplicada de roots atribuibles aprobadas y elegibles; nunca
  incluye pending, rejected, unattributed ni permisos desconocidos.

No copies thresholds de Laika a defaults de producción. Laika sólo es acceptance fixture.

## 2. Derivaciones y bindings

Reutiliza policy bundles, derivations, compilations, memberships e invalidations. No
crees una population por filtro/facet. Sí conserva una derivación estable por identidad
materializable `(workspace,module,view,policy bundle)` cuando los permisos divergen.

Generaliza el binding-set atómico de forma forward-only para promover/retirar los tres
módulos de una view sin estados parciales. Mantén historial append-only, CAS,
idempotencia concurrente y rollback a ausencia/bridge apropiado. No muevas el pointer
operacional.

## 3. Serving y AuthZ

El browser sólo puede elegir una `view_key` del enum publicado. El servidor resuelve
policy y population. Prueba:

- view desconocida/incompatible;
- view no autorizada por rol/workspace;
- cross-workspace y cross-view;
- cursor/ETag reutilizado entre views;
- counts/coverage que pudieran inferir una view prohibida;
- aliases y multi-membership sin duplicación.

Monitoring, Mentions y T&N conservan denominadores por view. Evidence visible aplica la
intersección de capabilities y reporta withheld/not_available.

## 4. Staging fixture

Si las escrituras staging están autorizadas, crea exclusivamente policies staging-only
para entidades ya gobernadas de Laika, compila, reconcilia y promueve mediante runners
guarded. No inventes una entidad ni conviertas strings libres en policy.

Evidence mínimo:

- `brand` permanece inalterada;
- competition/category/all-governed tienen population refs y digests propios;
- all-governed = unión esperada deduplicada bajo policy;
- multi-membership no duplica denominadores;
- policy SQL = memberships = serving;
- `unexplained_count=0`;
- cursors, filters, facets, evidence y lineage aislados por view;
- invalidar una view/módulo no reemplaza otra population;
- rollback del binding set por view ensayado;
- latencia/rebuild medidos.

Si las escrituras no están autorizadas, completa todo localmente y entrega
`READY_FOR_MULTI_VIEW_STAGING_AUTHORIZATION`.

## 5. Frontend boundary

No inventes controles visuales ni drawers. Backend 06 entrega contratos y estados para
que el frontend posterior use componentes canónicos de Signal/Shopify. Puede añadir
fixtures contractuales para QA, pero no una UI standalone.

## Checkpoint 06

- Contracts, DB, Studio y Query Engine verdes.
- Migraciones forward-only y smoke completo.
- Policies/derivations/bindings y AuthZ probados.
- Staging evidence si fue autorizado.
- Cero impacto en `brand`, V1, semantic base y pointers.
- Advisor review; cero P0/P1.
- Docs 04, 08, 31, 49 y 50 actualizados sólo con estado realmente probado.

Marca `gate_06: passed` o el estado de autorización pendiente en `EXECUTION_STATE.md`.
