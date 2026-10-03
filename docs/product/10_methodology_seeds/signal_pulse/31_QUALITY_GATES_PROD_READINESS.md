# 31 — Quality gates and production readiness

## Propósito

Definir gates que bloquean o advierten antes de publicar Signal Pulse.

## Gate levels

| Nivel | Acción |
|---|---|
| Blocker | impide publicar |
| Warning | permite publicar con limitación visible |
| Info | nota interna |

## Gates de datos

| Gate | Nivel | Criterio |
|---|---|---|
| source_presence | Blocker | al menos una fuente útil activa |
| period_coverage | Warning/Blocker | cobertura suficiente para ventana configurada |
| period_comparability | Warning | meses comparables o warning explícito |
| source_bias | Warning | una fuente domina y debe aclararse |
| stale_source | Warning | fuente clave atrasada |
| mapping_valid | Blocker | mapping requerido aprobado |
| chart_data_available | Blocker por chart crítico | data_ref existe y responde |
| evidence_refs_valid | Blocker para señal publicada | evidencia accesible o fallback |

## Gates de señales

| Gate | Nivel | Criterio |
|---|---|---|
| signal_min_evidence | Blocker | señal publicada tiene evidencia mínima |
| signal_dedup_review | Warning | posibles duplicados no resueltos |
| lifecycle_valid | Warning | estado lifecycle coherente con periodos |
| confidence_assigned | Blocker | cada señal tiene confidence |
| counter_evidence_reviewed | Warning | señales con contradicción tienen caveat |
| no_overclaiming | Blocker | no claims absolutos con confidence baja |

## Gates de marketing moves

| Gate | Nivel | Criterio |
|---|---|---|
| move_has_signal | Blocker | cada move referencia señal |
| move_has_evidence | Blocker | cada move referencia evidencia |
| move_is_marketing_action | Blocker | acción movible por Marketing |
| owner_suggested | Warning | owner o equipo probable |
| measurement_suggested | Warning | cómo medir test o acción |
| no_cx_as_primary | Warning/Blocker | no convertir acción de Ops/CX en principal sin traducción marketing |

## Gates de charts

| Gate | Nivel | Criterio |
|---|---|---|
| no_invented_numbers | Blocker | todos los números tienen data_ref |
| tooltip_complete | Warning | tooltips muestran contexto mínimo |
| accessible_summary | Warning | chart tiene resumen textual |
| non_comparable_delta | Blocker | no mostrar delta inválido |
| empty_state_defined | Warning | chart tiene empty state |

## Gates de copy

| Gate | Nivel | Criterio |
|---|---|---|
| humanizer_passed | Warning/Blocker | no palabras prohibidas ni prosa inflada |
| card_length | Warning | cards dentro de límite |
| action_verbs | Warning | recomendaciones usan verbos accionables |
| limitations_visible | Blocker | limitaciones críticas visibles |
| no_methodology_frontstage | Warning | no jerga metodológica visible |

## Gates de permisos

| Gate | Nivel | Criterio |
|---|---|---|
| source_visibility | Blocker | no evidencia no autorizada en cliente |
| paid_data_permission | Blocker | no mostrar spend/performance sin permiso |
| internal_notes_hidden | Blocker | composer/quality interno no visible cliente |
| export_permissions | Blocker | export respeta permisos |

## Publish checklist

Antes de publicar:

1. Overview tiene lectura ejecutiva.
2. Al menos 3 señales promovidas o explicación de por qué no.
3. Cada señal tiene evidence pack.
4. Cada marketing move tiene acción clara y evidencia.
5. Charts críticos cargan.
6. No hay blockers.
7. Warnings visibles están redactados.
8. Copy pasó humanizer QA.
9. Published cut guarda refs y metadata.
10. Live vs published queda claro.

## Override

Solo interno Noisia/Admin puede overridear warnings o ciertos blockers configurables. Cada override requiere:

- razón;
- usuario;
- timestamp;
- gate afectado;
- impacto en cliente;
- limitación visible si aplica.

## Regla final

La publicación no es “guardar”. Es certificar que una lectura de marketing tiene datos, evidencia, límites y permisos suficientes.
