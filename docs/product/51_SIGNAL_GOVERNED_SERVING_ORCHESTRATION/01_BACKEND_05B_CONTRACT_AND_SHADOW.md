# Backend 05B · Hardening, contrato y shadow module-aware

## Objetivo

Conectar los bindings `brand` promovidos a un reader gobernado module-aware en modo
shadow. El resultado visible continúa en legacy durante esta fase.

## 1. Resolver fail-closed

Corrige la ambigüedad actual del store PostgreSQL. Debe distinguir:

1. no existe binding current → puede resolver `operational-brand-bridge`;
2. existe binding current válido → `governed-binding`;
3. existe binding current pero está vencido, inactive, stale, invalidado, incompatible
   o fuera de vigencia → `not_available`, nunca bridge.

El query no debe filtrar el binding inválido antes de que el contrato lo evalúe.

Prueba en PostgreSQL real: absent, valid, inactive/expired bundle, future/expired binding,
stale/invalidated/expired compilation, derivation inválida, digest distinto, watermark
ausente y cross-workspace.

## 2. Integridad de 0071

Audita `signal_governed_brand_binding_set_operation_items`. Si se confirma el gap, crea
0072 forward-only sin editar 0071. La DB debe exigir:

- `event.actor_user_id = operation.actor_user_id`;
- binding promovido/retirado ligado al `operation.policy_bundle_id` exacto;
- workspace/module/view/action idénticos entre parent, item, event y binding;
- rechazo de combinaciones fabricadas con actor o bundle diferentes.

0072 no crea datos, bindings, policies, memberships ni pointers. En 05B se implementa y
prueba localmente; no se aplica remotamente.

## 3. Serving scope canónico

Define en el paquete compartido un contrato tipado que incluya:

- workspace, module y view;
- resolution source y binding/bridge;
- policy identity/version/hash;
- population identity/version/definition hash/membership digest;
- compilation identity/plan hash;
- data/governance watermark seguro;
- freshness/invalidation state;
- coverage validada: captured, quality_eligible, unreviewed, reviewed,
  resolved_attributed, abstained, unattributed y used_by_view;
- denominator key, unit, count y canonical-root deduplication.

El denominator count y coverage corresponden al filtro/periodo servido. `abstained`
permanece `not_available/count=null` mientras no exista medición durable.

Los cursores y ETags incorporan workspace, module/view, binding/bridge, policy hash,
population version/digest, watermark, filters hash y sort.

## 4. Reader module-aware

Introduce un boundary server-side equivalente a:

```text
resolveSignalServingScope(workspace, module_key, view_key="brand")
```

Mapeo obligatorio:

| Superficie | Identidad |
|---|---|
| Brand Monitoring | `brand-monitoring/brand` |
| Mentions | `mentions/brand` |
| Topics & Narratives | `topics-narratives/brand` |

El scope no se resuelve una vez globalmente para los tres módulos. SSR y requests
cliente deben resolver la misma identidad.

Conserva rollout server-owned:

- `legacy`: visible legacy;
- `shadow`: visible legacy y cálculo gobernado desde bindings;
- `governed`: implementado pero no activado en 05B.

Inventaría y cubre las rutas realmente usadas por `SignalV2WorkspacePage`, recargas y
drill-downs. No crees un segundo conjunto paralelo de endpoints si las rutas canónicas
pueden recibir el nuevo scope.

## 5. Capabilities y evidence

- Monitoring calcula métricas con su population.
- Topics & Narratives calcula métricas con su population.
- La biblioteca Mentions usa su population.
- Toda fila, excerpt o detalle visible desde Monitoring o T&N debe estar además
  autorizado para `client-mention-list` y `client-text-or-excerpt`.

Los drill-downs/evidence usan una intersección server-side entre el conjunto
constituyente y la view de Mentions. Declaran:

- `metric_denominator_count`;
- `evidence_visible_count`;
- `evidence_withheld_count` o `not_available`.

No reduzcas silenciosamente el denominador de la métrica y no reveles texto prohibido.
Focused mention y aliases se resuelven primero a raíz canónica y luego validan membership.
Admin Mentions sigue siendo workspace reservoir y no queda limitado por views cliente.

## 6. Shadow read-only en staging

Con checks locales verdes, usa los bindings current de `noisia-staging` sólo mediante
lecturas. Para cada módulo demuestra:

- resolver identity y population exacta;
- policy SQL ↔ memberships;
- denominator canónico y coverage literal;
- aliases en memberships = 0;
- periodos, filtros, pagination y cursor isolation;
- evidence/capability intersection;
- freshness, invalidation y ETags;
- latencia observada;
- operational pointer seguido por el shadow = false.

Clasifica diferencias legacy con Review semántico current y exige
`unexplained_count=0`.

## Checkpoint 05B

- Query Engine, DB y Studio: typecheck/tests.
- PostgreSQL resolver e integración 0072 si existe.
- Integración de los tres readers y capability/evidence.
- Migration smoke completo.
- Studio lint y `git diff --check`.
- Evidence privado/sanitizado con hashes.
- Advisor review según protocolo; cero P0/P1 abiertos.
- Cero writes remotos, cero cambio visible, pointers intactos.

Marca `gate_05b: passed` en `EXECUTION_STATE.md` antes de continuar.
