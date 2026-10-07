# Recibo del frente 2 — PR #34, revisión 4

**Alcance.** Rama `fix/mfp-phase-b-harness`, PR #34 hacia `develop`, sin fusión. Corrección ejecutada con `gpt-6-sol / high`. Base: auditoría §10.2 y spec MFP v1.3 §§6–9.

| Hallazgo | Corrección | Aceptación |
| --- | --- | --- |
| 0254 rechazaba llamadas sin cuerpo crudo | La puerta exige marca, clave y coincidencia sólo cuando `raw_body IS NOT NULL`. La migración 0255 y su SHA permanecen intactos. | Caso `reserved` sin cuerpo ni marca en el smoke de migraciones PostgreSQL; cuerpo sin verificar sigue rechazado. |
| Recibo inválido impedía la política sucesora | El bloqueo de recibos sin aplicar excluye exactamente una llamada `failed` de una corrida `failed` con `error_code=labeling_raw_receipt_invalid`. Cualquier llamada todavía activa o cerrada por otra causa sigue bloqueando. | Prueba `signal-mfp-policy-action-switch.integration.test.ts` con filas reales en esquema migrado y rollback. |
| Corrupción determinista se reintentaba | JSON de manifiesto inválido y `reference_invalid` terminan como `labeling_raw_receipt_invalid`; transporte indisponible conserva `labeling_raw_storage_unavailable` para reintento. | Prueba focal de clasificación de los tres errores; el cierre terminal conserva el recibo y el coste conservador de la llamada. |

**Verificación.** `@noisia/db typecheck`, lint del paquete, pruebas focales y `git diff --check` pasaron localmente. La aceptación PostgreSQL y el job CI con todas las migraciones se registran en los checks del PR; la prueba migrada se omite fuera de ese job. No se aplicaron migraciones en UAT ni producción.

**Costo real de este frente.** Llamadas a Claude, JEV y Voyage: **0**; costo de proveedores observado **USD 0.000000**. La ejecución de CI consume minutos de GitHub Actions, sin cargo monetario atribuido por la plataforma en este recibo. No se ejecutaron inferencias ni se alteró el corpus MFP.
