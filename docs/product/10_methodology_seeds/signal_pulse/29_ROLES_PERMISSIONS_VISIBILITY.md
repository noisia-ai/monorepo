# 29 — Roles, permissions and visibility

## Propósito

Definir qué ve cada usuario. Signal Pulse mezcla datos sensibles: pauta, performance, fuentes, evidencia, composer y quality gates. No todo debe estar visible para todos.

## Roles conceptuales

| Rol | Descripción |
|---|---|
| Client Marketing | equipo de marca/marketing cliente |
| Agency | agencia externa autorizada |
| Data Intelligence | usuario cliente con permiso de datos |
| Insights Manager | interno Noisia que cura análisis |
| KAM | interno Noisia que revisa y presenta |
| Admin/Founder | control total |

## Visibilidad por pantalla

| Pantalla | Cliente | Agencia | Data Intel | IM/KAM | Admin |
|---|---:|---:|---:|---:|---:|
| Overview | Sí | Sí | Sí | Sí | Sí |
| Signals | Sí | Sí | Sí | Sí | Sí |
| Marketing Moves | Sí | Sí | Sí | Sí | Sí |
| Content & Creative | Sí | Sí | Sí | Sí | Sí |
| Paid / Organic | Según permiso | Según permiso | Sí | Sí | Sí |
| Competitive & Category | Según contrato | Según contrato | Sí | Sí | Sí |
| Evidence | Curada | Curada | Extendida | Completa | Completa |
| Corpus View | Limitada/No | Limitada/No | Limitada | Sí | Sí |
| Sources | No | No | No/Limitada | Sí | Sí |
| Composer | No | No | No | Sí | Sí |
| Quality / Settings | No | No | No | Sí | Sí |

## Tipos de evidencia por visibilidad

| Evidencia | Cliente | Interno |
|---|---:|---:|
| Citas públicas curadas | Sí | Sí |
| Raw metadata | No | Sí |
| Handles públicos | Según política | Sí |
| Performance paid | Según permiso | Sí |
| Spend | Según permiso | Sí |
| Source mappings | No | Sí |
| Query packs | No/Resumen | Sí |
| Quality warnings | Resumen | Completo |
| Composer edits | No | Sí |

## Publicación

El corte publicado debe respetar permisos. Si una señal depende de una fuente no visible para cliente, hay tres opciones:

1. No publicar esa señal.
2. Publicarla con evidencia agregada, sin detalles sensibles.
3. Publicarla solo para usuarios autorizados.

## Quality gates de visibilidad

- No publicar spend si cliente/agencia no tiene permiso.
- No mostrar raw data sensible.
- No mostrar sources internas como si fueran evidencia cliente.
- No filtrar composer edits al cliente.
- No permitir export de evidencia no autorizada.

## Regla final

La misma inteligencia puede tener varias capas de exposición. El cliente ve la decisión y evidencia suficiente; Noisia ve la maquinaria completa.
