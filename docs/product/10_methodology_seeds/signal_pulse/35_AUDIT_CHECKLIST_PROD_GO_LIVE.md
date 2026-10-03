# 35 — Audit checklist for production go-live

## Propósito

Checklist exhaustivo para auditar Signal Pulse antes de producción.

## Producto

- [ ] La navegación final está implementada.
- [ ] No aparecen nombres de metodologías estratégicas como tabs del reporte.
- [ ] Overview no intenta contener todo el reporte.
- [ ] Cada pantalla tiene propósito claro.
- [ ] Cliente ve solo pantallas autorizadas.
- [ ] Interno ve Sources, Composer, Quality.
- [ ] Top Opportunities no es tab innecesario; vive como componente/filtro.

## Data y corpus vivo

- [ ] El reporte no guarda snapshot pesado.
- [ ] Los charts usan data_refs o agregados.
- [ ] Hay period buckets para la ventana configurada.
- [ ] 12 meses generan 12 cortes comparables.
- [ ] Deltas se calculan solo entre periodos comparables.
- [ ] Source coverage por mes visible.
- [ ] Live vs published claro.
- [ ] Datos stale se muestran.

## Source Wizard

- [ ] Fuentes se clasifican en conversation/performance/entity/knowledge.
- [ ] No todo entra como mention.
- [ ] Mapping preview existe.
- [ ] Validación de fuente existe.
- [ ] Source health visible.
- [ ] Source roles definidos.
- [ ] Schema drift tiene warning.
- [ ] Sync errors no rompen el reporte entero.

## Pipeline

- [ ] Signal Pulse tiene proceso propio.
- [ ] No depende de JSON T&B.
- [ ] Signal candidates se deduplican.
- [ ] Canonical signals tienen observations.
- [ ] Period metrics existen por señal.
- [ ] Marketing interpretation usa agregados.
- [ ] Chart specs se generan.
- [ ] Marketing moves tienen evidence.
- [ ] Quality gates corren.

## Charts

- [ ] Semantic Signal Galaxy carga o tiene fallback.
- [ ] Emotional Density Map carga o tiene fallback.
- [ ] Impact × Polarity Map carga.
- [ ] Signal Momentum Stream carga.
- [ ] Tooltips completos.
- [ ] Drawers conectados.
- [ ] Empty/loading/error states definidos.
- [ ] Resumen textual accesible.
- [ ] Colores no son único canal de significado.

## Copy

- [ ] Cards cortas.
- [ ] Headline claro.
- [ ] Cada move tiene verbo accionable.
- [ ] No hay prosa inflada.
- [ ] No hay términos prohibidos del humanizer.
- [ ] Limitaciones visibles.
- [ ] Warnings son honestos.
- [ ] No hay claims absolutos con baja confianza.

## Evidence

- [ ] Cada señal publicada tiene evidence pack.
- [ ] Cada move tiene evidence refs.
- [ ] Counter evidence aparece cuando existe.
- [ ] Evidence drawer abre desde charts/cards.
- [ ] Provenance visible para internos.
- [ ] Cliente no ve data sensible.
- [ ] Evidence stale se marca.

## Permissions

- [ ] Paid data requiere permiso.
- [ ] Sources no visible a cliente por default.
- [ ] Composer no visible a cliente.
- [ ] Quality completo no visible a cliente.
- [ ] Export respeta permisos.
- [ ] Raw metadata interna protegida.

## Performance

- [ ] Overview carga rápido con agregados.
- [ ] Corpus View no hace scans pesados sin paginar/materializar.
- [ ] Charts no bloquean toda la pantalla si uno falla.
- [ ] Source sync jobs no bloquean UI.
- [ ] Drawer lazy-loads data pesada.

## Composer / publish

- [ ] Se puede promover señal.
- [ ] Se puede fusionar/ocultar señal.
- [ ] Se puede editar copy.
- [ ] Se puede seleccionar evidencia.
- [ ] Quality bloquea publish.
- [ ] Published cut guarda refs.
- [ ] Live vs published diff visible.
- [ ] History/rollback existe o está diseñado.

## Final go/no-go

Go solo si:

- no hay blockers;
- el Overview cuenta una historia útil para Marketing;
- cada número visible tiene origen;
- cada recomendación tiene evidencia;
- cada pantalla crítica funciona en datos reales, empty y error;
- el equipo Noisia puede explicar cómo se publicó el corte.
