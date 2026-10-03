# 03 — Corpus vivo, periodización mensual y lifecycle de señales

## Principio

Signal Pulse no debe producir un snapshot estático de todo el corpus. Debe conectarse a un corpus vivo y a agregados/materializaciones por periodo. El reporte guarda referencias, decisiones editoriales, chart specs y cortes publicados; la data se mantiene conectada.

## Qué significa “no snapshot”

No guardar en el output:

- toda la lista de menciones;
- todos los registros de performance;
- todos los valores duplicados de charts;
- todo el corpus serializado;
- evidencia copiada sin referencia.

Guardar en el output:

- configuración del reporte;
- periodo activo;
- ventana comparable;
- señales promovidas;
- referencias a señales canónicas;
- referencias a métricas por periodo;
- referencias a charts (`data_ref`);
- evidence refs;
- decisiones editoriales;
- copy curado;
- quality state;
- published/live metadata.

## Periodización

Si el usuario configura una ventana de 12 meses, el sistema produce 12 cortes comparables. Si configura 6 meses, produce 6. Si configura 3 meses, produce 3.

Nunca leer 12 meses como una bolsa total. La primera lectura debe responder:

- qué señal nació en qué mes;
- qué señal creció;
- qué señal murió;
- qué señal se reactivó;
- qué señal persistió;
- qué señal fue pico;
- qué señal se saturó;
- qué señal cambió de polaridad;
- qué mes no es comparable por falta de fuente.

## Modelo conceptual

```text
study_corpus
  ↓
period windows
  ↓
signal observations by period
  ↓
signal period metrics
  ↓
signal lifecycle
  ↓
chart data refs
  ↓
Signal Pulse report/live composer
```

## Entidades sugeridas

| Entidad | Propósito |
|---|---|
| `signal_pulse_report` | Configuración, estado y metadatos del reporte |
| `signal_pulse_periods` | Cortes mensuales comparables |
| `signal_period_metrics` | Métricas por señal/periodo |
| `signal_lifecycle` | nacimiento, edad, persistencia, momentum, decay, reactivation |
| `chart_specs` | definición visual con `data_ref` |
| `evidence_refs` | referencias a evidencia viva |
| `composer_edits` | curaduría editorial |

No asumir nombres finales si la rama local ya tiene tablas equivalentes. Mapear contra `canonical_signals`, `signal_observations`, `signal_composer_edits` y APIs existentes antes de crear nuevas tablas.

## Métricas por periodo

Por cada señal y periodo:

- volumen;
- impacto ponderado;
- engagement;
- polaridad;
- emoción dominante;
- sentimiento promedio;
- source mix;
- evidence count;
- confidence;
- recency;
- marketing relevance;
- delta vs mes anterior;
- delta vs promedio de ventana;
- share of conversation;
- actionability score;
- risk score.

## Lifecycle de señal

| Estado | Definición | Decisión sugerida |
|---|---|---|
| New | Primera aparición con evidencia suficiente | Observar o test pequeño |
| Emerging | Crece 2+ cortes consecutivos | Probar contenido/claim |
| Mature | Persistente y estable | Integrar a always-on |
| Peaking | Pico fuerte de corto plazo | Activar rápido o contener |
| Saturating | Presente pero pierde diferenciación | Evitar o reencuadrar |
| Decaying | Pierde volumen/impacto | Reducir prioridad |
| Reactivated | Había caído y volvió | Investigar detonador |
| Volatile | Oscila sin estabilidad | No sobrerreaccionar |

## Comparabilidad

Una señal o mes puede no ser comparable si:

- faltó una fuente;
- cambió el query pack;
- cambió el proveedor;
- hubo backfill parcial;
- una fuente entró a mitad de periodo;
- cambió el mapping;
- hay bajo volumen;
- hay dedup incompleto.

Cuando algo no es comparable, no calcular delta como si fuera normal. Mostrar warning claro.

## Reglas de cálculo

- SQL/agregados calculan números.
- Claude interpreta la historia temporal.
- Renderer muestra charts conectados a `data_ref`.
- Composer guarda lectura editorial del periodo.
- Published cut congela copy/decisiones, no el corpus completo.

## Output esperado de historia temporal

Ejemplo:

```text
La señal “beneficio concreto” no nació este mes. Aparece desde marzo, aceleró en julio y se estabilizó desde septiembre. Esto sugiere que no es una moda puntual, sino un patrón estable de preferencia por mensajes demostrables.
```

## Calidad mínima

Para publicar lifecycle:

- mínimo 3 periodos comparables o warning;
- evidence count mínimo por señal;
- source coverage visible;
- delta calculado solo cuando los periodos son comparables;
- señales de baja confianza marcadas explícitamente;
- history visible en drawer.
