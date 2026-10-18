# H1 · revisión 11 · recibo de una página

[PR #58](https://github.com/noisia-ai/monorepo/pull/58), AUDIT §16 y spec v1.3. **Tres P1 corregidos; H1 continúa sin aprobar.** Sin fusión, despliegue, cambio de default, llamadas Claude/JEV ni escritura de datos de evaluación. Sin SQL nuevo: 0267 y su historial permanecen intactos.

[Aceptación primero](ACCEPTANCE_MFP_H1_R11_2026-10-13.md), commit `ba39d21f`: el test de ventanas reprodujo `error` anulando `belongs`. El cambio mínimo conserva un testigo positivo entre ventanas completas, pero exige verificador liquidado antes de publicar. La reparación envía sólo la ventana rechazada y reúne cobertura ancestral por huella, definición, CE, entidades y ventana; raíces/conceptos distintos no completan cobertura ajena. PG incluye dos ventanas en una misma llamada para impedir el producto N×N.

- **Verificador:** tres fallos técnicos escriben `error / hybrid_attempts_exhausted` persistido y visible; un cuarto intento no envía. Se conserva la confirmación pagada y no se fabrica negativa ni `verification`.
- **Conciliación:** una respuesta con uso inválido bloquea rollback hasta reconocimiento explícito bajo autoridad, ruta y lock. Conserva raw, request, resultados, reserva y gasto desconocido; registra exposición terminal y permite estándar sin duplicarla. Disponible en el CLI dev-test guardado `hybrid-h1-rollback.ts`, con `--real --execute --reconcile-response-calls=<IDs>` y el permiso de ejecución existente. No se ejecutó sobre datos reales.
- **Tarifa histórica:** `settle` y `settlePage` verifican uso idéntico y conservan la liquidación contabilizada completa durante replay. Uso distinto se rechaza. La tarifa vigente sólo revalora fuera del ledger; no vuelve a tasar una llamada histórica para autorizar su aplicación.

**Re-puntuación gratuita:** 116 raw existentes (95 C, 21 V), hash/tamaño/uso verificados y reparsados; 31 pares con cobertura completa. **12 `error → pending` técnicos** en la proyección: cinco positivos test y siete fuera del gold. Falta V liquidado en los doce: no son veredictos ni publicaciones recuperadas. DB/ledger intactos; llamadas nuevas y gasto proveedor: **0 / USD0**. La re-puntuación es offline sobre el snapshot custodiado, sin alterar el estado del workspace.

| Mismo denominador gold test | Estándar | H1 re-puntuado |
|---|---:|---:|
| Positivos publicados / positivos | 28/31 | 21/31 |
| Recall | 90,32% | 67,74% |
| Positivos en revisión / pendientes técnicos nuevos | 0 / 0 | 4 / 5 |

Review H1 **137/1.086 = 126,15/1.000**; no pasa ≤50. Sin nueva muestra ciega ni evaluación semántica; costo/precisión ciega de R10 no se reestiman. [Evidencia agregada y hashes](EVIDENCE_MFP_H1_R11_2026-10-13.json); scorer reproducible `scripts/eval/hybrid-h1-rescore-raw.ts` rechaza raw alterado y evita acreditar positivos sin V.

**Validación:** [checks del HEAD final](https://github.com/noisia-ai/monorepo/pull/58/checks): CI completo y PostgreSQL17 migrado; pruebas de verificador final, conciliación/replay/rollback, tarifa histórica, cobertura y reparación. Los intentos fallidos se conservan (PG181/182/184/189/192/193); PG186 ya acreditó los P1. No se usa estática como sustituto de PG.

Implementador asignado **GPT-6.1-sol/high**. Revisión focal **GPT-6-astra/medium**, ID `01a133f4-b73c-7e40-a036-d54534cf5c97`, sobre recuperación/P1/ventanas tras fallos repetidos de la aceptación: detectó correlación SQL y agrupación por ventana, ambas corregidas. Fue consulta estática, no implementación ni revisor ciego; backend y costo Codex no acreditados independientemente. Consulta focal adicional Astra/medium `01a13402-357f-7863-806f-cf14d8e0a89c`: PG189/192 repitieron la aceptación de offset tardío; confirmó que el fixture invalidaba una ventana según orden hash, corregido para fallar sólo la inicial. Uso registrado en evidencia. Al integrar #57 deben conservarse su allowlist `provider_reason` y estos cambios de liquidación en `signal-labeling-runs.ts`; no se hizo merge/rebase.

## Revisión 12 — guarda previo a fusión (18 de octubre)

La selección de citas excluye errores deterministas `membership_*` / `incomplete_single_root` y agotados antes de reservar otra llamada; coincide con la inmutabilidad del upsert. La aceptación PostgreSQL real se escribió primero en 90376473 y falló en PG201 (39109474231), al seleccionar el error determinista. Comprueba fuente positiva liquidada, error heredado NULL reparable, cinco estados terminales excluidos y recibos sin cambios. Los 12 pares del rescore siguen como proyección técnica privada; no se publican ni se reenvían. Modelo configurado: gpt-6.1-sol/high. Coste proveedor USD0; default estándar intacto. CI/PG verdes requeridos antes de fusionar.
