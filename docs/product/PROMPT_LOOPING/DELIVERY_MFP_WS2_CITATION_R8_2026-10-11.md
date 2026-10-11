# Recibo §13.3 — H1: citas y pertenencia · 11 octubre 2026

Base `develop e5c36afb` (#39); rama `feat/mfp-ws2-citation-quality`. Implementación experimental, apagada por defecto. Autor real: Codex GPT-6.1, esfuerzo high. Sin cambios de V2 ni del frente #40.

**Aceptación primero:** `ACCEPTANCE_MFP_H1_CITATION_2026-10-11.md`; la primera ejecución falló porque el módulo aún no existía. Contrato focal: 26 PASS. Typecheck DB/Worker/Query verde durante desarrollo; gates finales y PostgreSQL migrado en CI pendientes.

**Cambio:** identidad nueva H1, prompt genérico independiente, particionado por oraciones completas y hasta tres fragmentos de una raíz. Verificación de soporte JEV `noul` por positivo mediante admisión/ledger comunes; un único reintento Claude con mejores fragmentos y después `review_required` si no sostiene. La oración excepcionalmente larga permanece completa en H1; V2 conserva su particionado previo. Batches ≤16 raíces, esfuerzo low y sistema cacheado 1 h.

**Robustez:** errores deterministas finales; máximo de tres ejecuciones por par/procedencia/etapa; positivos válidos JEV pueden pasar a Claude aunque haya un error terminal aislado. Rollback explícito libera también incertidumbre Claude conservando exposición; los recibos con uso desconocido no se registran como gasto observado. Actualización de tiempos y estados técnicos. Seguimientos #48, #49, #50, #51, #52 cubiertos en este PR.

**Datos y medición:** cuatro definiciones v3 propuestas en JSON, sin modificar catálogo; Reserva/entrega conserva v2. Falta confirmación del fundador antes de cualquier medición o llamada. Se preparan 1.086 raíces, tres vistas gold y 30 positivos nuevos disjuntos con revisor ciego nuevo. No se acredita mejora de calidad todavía.

**Coste nuevo observado:** USD 0 de proveedor, cero solicitudes reales. Instalación 0262 sólo en PostgreSQL desechable de CI; no aplicada a dev-test al redactar. Migración aditiva: recibo verificador, estado de error y `updated_at`; recuperación operativa a estándar por CAS, conservando historia y exposición. No UAT, producción ni fusión.
