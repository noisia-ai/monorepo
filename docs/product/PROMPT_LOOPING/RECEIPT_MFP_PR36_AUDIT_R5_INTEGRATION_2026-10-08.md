# PR #36 — integración de la cadena aprobada (§11.1)

Rama `fix/mfp-phase-b-critical`. Integra `develop` **d34b4338**, después de las fusiones aprobadas de #35, #33 y #34. Modelo/esfuerzo real: **gpt-6.1-sol / high** (`mfp_critico`). No se fusionó el PR; la siguiente decisión corresponde al orquestador después de CI verde.

Los nueve conflictos eran adiciones de #36 ausentes en la base o reordenamientos: se conservaron la reconciliación de llamadas inciertas, el refresco del estado del run, las pruebas de uso inválido/backoff y el aviso de contexto pendiente. Se preservaron todos los cambios ya fusionados de producto, incluidos el comentario corregido de la política y la distinción entre corrupción de recibo y fallo de transporte. La resolución no añade comportamiento nuevo ni cambia SQL; las pruebas de aceptación existentes verifican las rutas afectadas.

**Verificación de integración:** 69/69 pruebas focales PASS sobre recibos, Signal, contexto de entidades, ambos batch workers, transporte Anthropic, gramática y UI. `pnpm typecheck`: 11/11 PASS. `pnpm lint`: 11/11 PASS, con 13 advertencias preexistentes. `git diff --check` limpio. Las suites pesadas y PostgreSQL deben ejecutarse en CI/runner; estas pruebas focales no sustituyen su evidencia. No se levantó Docker, base, Redis ni Worker local.

**Costo y entrega:** cero llamadas a proveedores, costo proveedor **USD 0**. Este corte integra código aprobado y publica evidencia local de compatibilidad; no despliega UAT ni producción. Las evidencias PostgreSQL reales previas permanecen en el recibo de revisión 3; no se reaplicó ninguna migración.
