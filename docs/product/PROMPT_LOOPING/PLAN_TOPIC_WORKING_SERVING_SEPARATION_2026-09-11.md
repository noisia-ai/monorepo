# Plan — catálogo de trabajo de Topics separado del catálogo operativo

Fecha: 2026-09-11 11:55 UTC  
Base: `866e0d9` sobre UAT `c1e40d3`  
Objetivo: permitir que un cliente edite Topics después del primer análisis sin ejecutar modelos,
gastar, romper Signal ni detener el monitoreo incremental.

## Contrato de producto

1. **Editar es editorial.** Crear, renombrar, describir, cambiar ámbito, archivar o restaurar guarda
   una nueva versión del catálogo de trabajo. No crea ejecuciones, outbox, reservas ni llamadas.
2. **Procesar es explícito.** El catálogo de trabajo sólo se vuelve operativo mediante la acción de
   recomputación ya existente y autorizada para ejecución.
3. **Signal sigue estable.** Mientras haya cambios pendientes, Signal y su evidencia continúan leyendo
   la última generación válida y su perfil exacto.
4. **Incremental sigue estable.** El scheduler usa el perfil operativo fijado por la generación/opt-in,
   nunca el borrador más reciente por accidente.
5. **Revocar siempre funciona.** Un usuario puede retirar de Signal un Topic de la generación servida
   aunque exista un borrador posterior. Seleccionar una definición nueva requiere primero su generación.
6. **Toda escritura revalida autoridad.** Usuario, rol, organización, marca, workspace y grant se
   comprueban bajo el mismo lock de la mutación. Lifecycle usa CAS de revisión y digest.

## Implementación

### A. Catálogo y autorización

- Desacoplar `can_edit_topics` de `can_execute_topics` en el DTO y en la capa DB.
- Conservar el ledger idempotente y las versiones inmutables.
- Añadir revalidación transaccional bajo lock y CAS completo en archive/restore.
- Eliminar cualquier arranque automático o cap de embeddings desde create/update/archive/restore.
- Exponer `working_profile_id`, `serving_profile_id` y `requires_recompute`.

### B. Serving y selección

- Resolver definiciones desde `signal_classification_generations.taxonomy_profile_id` para Signal.
- Mantener evidencia, digest y revisión de esa generación hasta reemplazo explícito.
- Permitir deselect con la identidad servida; impedir select de un borrador sin generación actual.

### C. Monitoreo incremental

- Resolver un único perfil operativo por propósito: generación servida u opt-in vigente.
- Reemplazar guards que comparan contra `ORDER BY version DESC` por lineage explícito.
- Añadir SQL0154 sólo si hay funciones instaladas que deban actualizarse. No editar ni reaplicar
  SQL0148–0153.

### D. UI

- Mostrar “Cambios guardados; cálculo pendiente”.
- Mantener Signal previo accesible y separar el botón de cálculo para quien tenga permiso.
- Ocultar costo/ejecución a clientes sin `can_execute_topics`.
- Restituir el enlace de Brand OS en Topics cliente.

## Gates del corte

- Prueba PostgreSQL compuesta: generación A servida y seleccionada → edición B por cliente → cero
  ejecución/gasto/outbox → Signal conserva A → deselect A funciona → select B falla → recompute explícito
  activa B → selección B funciona.
- Replay exacto, conflicto de idempotencia, concurrencia CAS y lifecycle CAS.
- Revocación/cambio de rol, organización o estado durante lock deja cero escrituras.
- Nueva revisión incremental con B pendiente consume A o expone pausa explícita; nunca consume B.
- DOM ES/EN, suites DB/Studio/Worker, typecheck, lint, build y revisión sin P0/P1/P2.
- Entrega focal UAT sólo después de migración ensayada. Cero proveedor real durante desarrollo y rollout.

## Límite del experimento

National sólo verifica compatibilidad de catálogo, selección, Signal e incremental. No se crea lógica
por marca ni se vuelve a importar su corpus. La nueva marca real se crea por UI cuando el operador
proporcione el caso y sus menciones.
