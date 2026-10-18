# Completar configuración clásica en una marca existente

Revisión 12 · PR #67 · agente mfp_estandar · gpt-6.1-sol / medium.

Una organización con política MFP puede tener ocho acciones vigentes y carecer de las dos que preparan el contexto semántico y los prototipos de la ruta clásica. El replay de alta devuelve `existing_policy`; habilitar fichas para resolverlo cambiaría la población de descubrimiento. Esta entrega prepara una acción explícita en Configuración de la marca, sin activar features ni ejecutar trabajo.

La acción sólo admite un actor interno activo con rol `noisia_admin`, `founder` o `admin`. El servidor deriva workspace, marca y actor autenticado; el cuerpo vacío rechaza configuración, identidades y dinero suministrados por navegador. El almacén vuelve a comprobar la autoridad bajo lock de la organización y de sus filas. No suplanta al creador original.

El sucesor conserva exactamente las ocho acciones existentes y sus configuraciones, caps, zona presupuestaria y vencimiento. Añade sólo las acciones clásicas ausentes con configuración del servidor. El replay no crea otra versión. Una configuración incompleta o un propietario activo impide el cambio antes de mutar. Los raw ya pagados que esperan aplicación gratuita también mantienen vigente la política anterior; se reutiliza el lector de bloqueos de producto para distinguirlos de recibos corruptos ya cerrados.

## Evidencia y estado

- Aceptación escrita primero en `e6f78696`. PostgreSQL 17 real, esquema migrado completo, PG224 (`39112463100`): rojo esperado, `existing_policy` frente a `provisioned`. La fixture revierte su censo y no transporta datos a proveedores.
- La reparación depende del PR crítico #68, que adapta el contrato clásico sin topes monetarios heredados. La UI y el provisioner explícito pertenecen a #67; la migración y los contratos runtime a #68.
- Implementación y aceptación ampliada en curso: cliente con capacidad de procesamiento rechazado; revocación, aislamiento, trabajo activo, raw pendiente, preservación y replay. No declarar entrega validada hasta CI y PG integrados verdes.

## Operación real

La política aún no se ha reemplazado en dev-test. Primero debe cerrarse la aplicación gratuita de respuestas almacenadas de la marca hermana y verificarse su censo; después se integrarán las dos reparaciones verdes. Estudio real A (cerveza, Brasil) conserva importaciones y recibos para recuperarse en la build corregida. Ninguna ficha ni pertenencia se ejecuta para este estudio.

Costo de proveedor de este corte: USD0; compra de créditos: USD0. No hubo despliegue ni cambio de ruta por defecto. Las etapas pagadas siguen detenidas hasta disponer de una lectura actual verificable del saldo de cada proveedor.
