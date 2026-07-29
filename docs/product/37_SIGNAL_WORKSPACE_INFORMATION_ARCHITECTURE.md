# 37 · Signal Workspace Information Architecture

> **Estado:** canon de producto para identidad, routing y navegación de Signal V2.

## Regla Principal

Una marca tiene un solo workspace de Signal y una sola URL canónica:

```text
/signal/{workspaceSlug}
```

Ejemplo: `/signal/laika`.

La URL identifica a la marca dentro de su organización, no a un output ni a una corrida
de análisis.

## Qué Representa Cada Nivel

| Nivel | Identidad | Ejemplo | Cambia con una nueva corrida |
|---|---|---|---:|
| Workspace | Marca | Laika | No |
| Módulo operativo | Capacidad viva | Monitoreo de marca | No |
| Página estratégica | Estudio nombrado | Decisión de compra y precio | No |
| Release estratégico | Corte aprobado | Junio 2026 | Sí |
| Output legacy | Compatibilidad/transición | UUID publicado | Puede cambiar |

## Navegación

- La flecha junto al nombre de la marca abre el selector de workspaces asignados al
  usuario.
- `Monitoreo de marca` es el home operativo.
- `Triggers & Barriers` agrupa los estudios T&B del workspace.
- Cada estudio usa `study_corpora.name` como título visible.
- El historial y los releases viven dentro del estudio al que pertenecen.

## Creación Desde Corpus Engine

El campo antes llamado “Nombre del estudio” se presenta como “Nombre de la página en
Signal”. Al crear el corpus:

1. se resuelve o crea el único workspace del sujeto;
2. el corpus se vincula automáticamente;
3. T&B recibe rol `strategic`;
4. el nombre del corpus aparece en la navegación;
5. publicar una corrida agrega un release sin producir otra URL cliente.

## Compatibilidad

Las rutas `/signal/{outputId}` y `published_outputs.payload` permanecen intactas durante
la transición. Los links nuevos deben preferir `/signal/{workspaceSlug}`. La activación
de cliente sigue sujeta a authZ, staging shadow y release gates de Data OS.
