# 30 — Empty, loading and error states

## Propósito

Definir estados mínimos para que Signal Pulse no se rompa en producción ni deje al usuario sin explicación.

## Estados globales

| Estado | Mensaje base | Acción |
|---|---|---|
| No sources | No hay fuentes activas para este reporte | Ir a Sources |
| Source validating | Estamos validando fuentes | Ver progreso |
| Ingesting | Se están importando datos | Ver source run |
| Analyzing | Signal Pulse está construyendo señales | Ver estado |
| Needs review | El análisis requiere curaduría | Abrir Composer |
| Publish blocked | Hay gates que bloquean publicación | Abrir Quality |
| Published stale | Hay datos live posteriores al corte | Comparar live vs published |
| Filter empty | No hay data con estos filtros | Limpiar o ampliar filtros |
| Non comparable | El periodo no es comparable | Ver coverage |
| Permission required | No tienes acceso a esta capa | Pedir permiso |

## Loading states

- Header skeleton.
- Chart skeleton con altura fija.
- Card skeletons.
- Table row skeletons.
- Drawer skeleton.
- Source health loading.
- Composer saving state.

No mostrar spinners solos si el usuario no sabe qué se carga.

## Error copy

El error debe decir:

- qué falló;
- qué parte del reporte afecta;
- si la data está segura;
- qué puede hacer el usuario;
- si requiere Noisia interno.

Ejemplo:

> No pudimos cargar el Impact × Polarity Map porque el agregado de este periodo no está disponible. El resto del reporte sigue funcionando. Intenta refrescar o revisa Quality.

## Empty states por pantalla

### Overview

> Todavía no hay suficientes señales comparables para construir el Overview. Conecta una fuente conversacional o amplía el periodo.

### Signals

> No hay señales con estos filtros. Prueba incluir señales de confianza media o ampliar la ventana temporal.

### Marketing Moves

> No hay movimientos recomendados porque las señales actuales no alcanzan evidencia mínima o accionabilidad de Marketing.

### Content & Creative

> Aún no hay suficientes señales creativas. Conecta performance orgánico/pauta o revisa fuentes de conversación.

### Paid / Organic

> Esta pantalla necesita performance evidence. Conecta Meta, TikTok Ads u otro export de contenido/pauta.

### Competitive & Category

> No hay peer set o competidores configurados para este reporte.

### Evidence

> No hay evidencia visible para estos filtros. Puede existir evidencia interna o el filtro es demasiado estrecho.

### Corpus View

> No hay registros con este filtro.

### Sources

> No hay fuentes conectadas. Agrega la primera fuente desde Source Wizard.

### Composer

> No hay draft listo para curar. Ejecuta el análisis o revisa Quality.

### Quality

> No hay gates ejecutados todavía.

## Partial data states

Mostrar cuando:

- una fuente está atrasada;
- un periodo está incompleto;
- un chart falló pero otros cargan;
- live data existe, pero published está viejo;
- performance source no cubre todos los meses.

## Regla final

Un estado vacío o error debe enseñar cómo avanzar. Nunca debe ser una pantalla muerta.
