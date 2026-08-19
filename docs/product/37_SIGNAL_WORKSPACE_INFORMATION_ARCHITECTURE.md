# 37 · Signal Workspace Information Architecture

> **Estado:** canon de producto para identidad, routing y navegación de Signal V2,
> actualizado 2026-08-02 por ADR 014.

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
| Reporte estratégico | Metodología cliente | Triggers & Barriers | No |
| Corrida estratégica | Ejecución interna | T&B julio 2026 | Sí |
| Release estratégico | Revisión aprobada | Julio 2026 | Sí |
| Output legacy | Compatibilidad/transición | UUID publicado | Puede cambiar |

## Navegación

- La flecha junto al nombre de la marca abre el selector de workspaces asignados al
  usuario.
- `Monitoreo de marca` es el home operativo.
- `Menciones` y `Tópicos y narrativas` consultan la misma población operacional
  gobernada.
- `Reportes` agrupa metodologías estratégicas aprobadas para el cliente.
- El workspace tiene una sola superficie cliente de `Triggers & Barriers`.
- Una nueva corrida T&B añade una revisión interna; no crea una subsección ni otra URL.
- Release, historial y comparación viven dentro del reporte al que pertenecen.
- `Configuración` contiene fuentes, cadencia, perfiles, accesos y estado de publicación.

Navegación objetivo:

```text
Monitoreo de marca
Menciones
Tópicos y narrativas
Reportes
  Triggers & Barriers
Configuración
```

## Creación De Marca Y Ejecución De Estudios

La marca crea su workspace y configuración de data antes de cualquier estudio. Puede
recibir fuentes, imports y menciones y abrir Signal en estado vacío o parcial.

Al ejecutar una metodología:

1. se selecciona el workspace, población y periodo;
2. cualquier fuente nueva se ingiere primero al data plane canónico;
3. el estudio congela un snapshot relacional de IDs y watermarks;
4. la metodología corre sobre ese snapshot;
5. Review produce una revisión candidata;
6. publicar promueve el release actual del `report_key` sin crear otra URL cliente.

`study_corpora` puede permanecer como identidad de ejecución y compatibilidad durante la
migración. No es la identidad de navegación ni el dueño final de las menciones.

## Identidad De Reporte

La identidad cliente es `(workspace, report_key)`, por ejemplo
`(laika, triggers_barriers)`. La identidad de una corrida, snapshot, analysis y release
permanece interna y auditable.

Una futura metodología añade otro `report_key`; no añade workspaces ni convierte cada
run en una página.

## Compatibilidad

Las rutas `/signal/{outputId}` y `published_outputs.payload` permanecen intactas durante
la transición. Los links nuevos deben preferir `/signal/{workspaceSlug}`. La activación
de cliente sigue sujeta a authZ, staging shadow y release gates de Data OS.

El contrato de ownership, enrichment, poblaciones y snapshots vive en
`42_SIGNAL_WORKSPACE_DATA_OWNERSHIP.md` y ADR 014.
