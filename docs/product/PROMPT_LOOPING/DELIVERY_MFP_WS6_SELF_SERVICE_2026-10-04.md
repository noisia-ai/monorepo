# WS6 — Análisis autoservicio y máximos opcionales · 2026-10-04

Corte en desarrollo sobre `feat/mfp-ws6-self-service`, base `ada9d98`. No desplegado; no migraciones aplicadas por este auxiliar.

- MFP conserva el pipeline full existente. Start permite omitir el cap o enviar `null`; el servidor deriva la acción `topic_interpretation` vigente y no permite quitar o elevar un máximo explícito. Run + admisión existente + outbox se escriben en la misma transacción. Costes y reservas siguen registrados sin máximo.
- Autoridad cliente: `can_request_processing` con tenant/grant vigente, enlazada al snapshot MFP y su actor real. Entrega/materialización/proyección usa sólo ese origen; las fuentes legacy, interest decision y conciliación terminal interna conservan sus predicados.
- SQL0232 adapta guards existentes de owner/ledger/registro/entrega y SQL0233 las admisiones/editorial Message Batches a `NULL`. Preserva reservas históricas y límites explícitos. MFP no hereda topes/env horarios antiguos; la política activa sigue siendo autoridad. Un máximo diario explícito conserva su contabilidad por día.
- Marca nueva configura acciones de interpretación/consolidación sin máximo estricto, conserva configuración/proveedor actuales y exige creador interno configurado. No reescribe políticas existentes; las organizaciones ya provisionadas necesitan sucesor de política explícito con sus límites previos intactos.

Verificación actual: 10 focales policy/provisioning PASS (0.27 s), `git diff --check` PASS. CI remoto, SQL/PG compuesto, autorización cliente/revocación/otra organización y recorrido real aún pendientes. La evidencia local es de contratos/mocks, no entrega ni calidad semántica.

Coste proveedor WS6: USD0. No llamadas, cambios de modelos/prompts, Python, nuevo ledger ni outbox. Recuperación: desactivar nuevas solicitudes MFP; conservar recibos e historia. La aceptación real exige CI/PG remoto y el recorrido de UI con Root; el flag por sí solo no acredita entrega.
