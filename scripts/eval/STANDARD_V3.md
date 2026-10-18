# Juez estándar v3 — runner privado

Experimento sin selección ni serving. Estándar vigente conserva su default. Sólo sobre el destino dev-test confirmado por `scripts/dev-corpus/guard.mjs`; los datos y recibos permanecen privados en `.data/dev-corpus/voyage-real/standard-v3-r12/`.

1. Coordinar ventana con el despliegue de Studio/Runner. Verificar modelo en lectura oficial. Copiar por hash los recibos históricos baseline, baseline-cache y blind/trace+manifest de revisión11; no regenerar selección.
2. `install-concepts-v5.ts --real --acceptance --confirmed-definitions-sha256=<SHA>` revierte la aceptación PostgreSQL; `--execute` instala los mismos datos por funciones de producto. SHA es el de `CONFIRMED_MFP_CONCEPTS_V5_2026-10-18.json`.
3. `standard-v3-preflight.ts` comprueba las mismas 1,086 raíces, identidades de ambos esfuerzos, admisión/preview, idempotencia, rollback, selectores/serving/contextos sin cambios y calendario privado sin trigger DDL.
4. Leer el saldo actual en la consola Anthropic antes de cada brazo; guardar recibo privado con `source:"anthropic_console"`, `observed_at`, `available_micro_usd` y `reserved_for_other_lanes_micro_usd`. El archivo se admite 30 min desde la lectura. Coordinar reservas entre carriles para no prometer el mismo saldo dos veces. Nunca comprar créditos.
5. Driver: `standard-v3-run.ts --real --effort=medium --balance-receipt=<ruta privada>`. Requiere flag de proveedor y key cargada selectivamente en memoria. Si sólo cabe un brazo, medium. Leer saldo otra vez antes de low. Los presupuestos son orientativos; los errores de saldo detienen el envío.
6. `standard-v3-report.ts` verifica raw por SHA/size, reutiliza el parser de citas y métricas existentes y sella paquetes nuevos. Excluye los 120 casos de revisión11; los desacuerdos con error técnico se reportan aparte y no se convierten en negativos semánticos. La traza de brazo/ruta queda privada; el auditor recibe positivos y opciones con citas normalizadas.

Reentrada: conservar manifiestos, idempotency keys y raw. Si hay run activo o llamada desconocida, no reiniciar ni duplicar envíos; conciliar en la misma ejecución antes de continuar. No ejecutar este driver desde la Mac contra PostgreSQL remoto. No fusionar ni adoptar v3 antes de revisión del auditor/fundador.
