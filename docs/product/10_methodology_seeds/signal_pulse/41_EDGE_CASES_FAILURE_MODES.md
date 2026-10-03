# 41 — Edge cases and failure modes

## Propósito

Anticipar casos raros para que producción no falle silenciosamente.

## Fuentes

| Caso | Riesgo | Manejo |
|---|---|---|
| Fuente nueva entra a mitad de periodo | rompe comparabilidad | marcar coverage change y normalizar o excluir de delta |
| CSV sin fechas | no puede periodizar | pedir mapping o asignar periodo manual con warning |
| CSV de tiendas subido como conversation | contamina mentions | Source Wizard debe clasificar como entity/reference |
| Meta export sin spend | performance parcial | permitir organic/performance limitado, warning |
| Campo texto vacío | evidence inútil | invalid rows |
| Duplicados masivos | infla señal | dedup y duplicate count visible |
| Fuente única domina | sesgo | source bias warning |

## Señales

| Caso | Manejo |
|---|---|
| Señal muy viral de un día | lifecycle `peak` o `volatile`, no `mature` |
| Señal positiva y negativa al mismo tiempo | marcar ambivalente, mostrar counter evidence |
| Señales duplicadas | fusionar en Composer |
| Señal sin acción de Marketing | mantener como insight o risk, no move principal |
| Señal sensible legalmente | internal review y visibility gate |
| Señal basada en low confidence | publicar solo con caveat o no publicar |

## Charts

| Caso | Manejo |
|---|---|
| Galaxy con demasiados nodos | top clusters + zoom, no mostrar todo |
| Scatter con burbujas superpuestas | jitter, clustering o list fallback |
| Timeline sin meses suficientes | mostrar versión simple con caveat |
| Color inaccesible | labels/badges/patterns |
| Chart sin data_ref | bloquear publicación si crítico |
| Chart custom falla | fallback table + textual summary |

## Marketing moves

| Caso | Manejo |
|---|---|
| Acción realmente es de CX | traducir a risk/no-go o cross-functional note |
| Acción demasiado genérica | bloquear humanizer/actionability gate |
| Move sin owner | warning |
| Move sin métrica de medición | warning |
| Move contradice evidencia | blocker |

## Published/live

| Caso | Manejo |
|---|---|
| Live data cambia señal publicada | mostrar diff, no sobrescribir |
| Evidence ref eliminado | stale evidence fallback |
| Nuevo mes empieza | no auto-publicar; crear draft/live state |
| Published cut con source stale | visible warning |

## Permisos

| Caso | Manejo |
|---|---|
| Agencia sin permiso a spend | ocultar spend, mostrar índice o resumen si autorizado |
| Cliente no puede ver raw author | ocultar handle o mostrar fuente agregada |
| Evidence interno soporta señal pública | usar versión curada o no publicar |

## Regla final

El sistema debe fallar con explicación, no con silencio ni datos engañosos.
