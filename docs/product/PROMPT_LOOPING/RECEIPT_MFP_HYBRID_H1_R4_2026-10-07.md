# H1 experimental — revisión 6 (2026-10-10)

**PR #39 draft, sin aprobación, merge ni despliegue.** Base `develop b2667fc5`; código R6 `320c64c8`. #40 conserva UI, procedencia humana e integración. Evaluación R5 preservada (`6f96547d`, export `c3282a99`); no se ejecutaron proveedores ni migraciones sobre MFP compartido.

## Correcciones de AUDIT §12.1

- **P1:** errores Claude quedan como resultados terminales del ledger, sin exigir una decisión semántica `settled`. El drainer recupera runs Claude fallidos con llamadas inciertas mediante el reconciliador batch existente, sin reenviar. Resultado ausente/usage inválido conserva reserva como exposición ambigua; no se inventa gasto. Rollback estándar deja de bloquearse al terminar esas llamadas.
- **P2.1–2:** modo H1 del juez compartido con esquema fijo para 1–16 raíces, cache 1 h y `low`. Cada concepto positivo de JEV exige veredicto explícito, rationale y fragmento literal de contexto, incluidos negativos; omisiones/invalidez entran al retry común. Se retira la frase negativa fabricada y se conserva el fragmento en revisión.
- **P2.3:** errores técnicos no ocupan la caché semántica. Selección y población de admisión permiten una nueva solicitud bajo el mismo digest; errores históricos pueden reemplazarse sólo por resultados comprobados. Pares inciertos/con exposición terminal permanecen cercados; overrides y decisiones válidas siguen ganando.
- **P2.4–5:** `expected_route_digest` obligatorio en tipos/runtime, `null` explícito al seleccionar por primera vez; el job CI incluye `scripts/eval/*.test.ts`, incluido el medidor H1.

El contrato explícito cambia la identidad de Claude/ruta: nuevas admisiones sobre una ruta antigua requieren actualización explícita, sin reinterpretar ni modificar resultados R5. Sin cambios a 0259–0261, umbral JEV ni instrucciones de frontera semántica.

## Verificación y costo de este corte

`pnpm typecheck`: **11/11**; typecheck del harness eval verde; comando focal `node --test --import tsx` sobre juez, H1, workers y medidor: **45/45**. [PG migrado](https://github.com/noisia-ai/monorepo/actions/runs/38083812002): **5/5, cero skips**, cadena SQL completa sobre PostgreSQL17 efímero remoto y checks PG verdes. Incluye 662 calls/340 preservadas, interrupción/replay; cinco escenarios Claude (create429, missing, invalid_usage, unknown_recovery, provider_error), rollback, readmisión JEV/Claude, error histórico, CAS y recuperación desde drainer. HTTP/storage simulados; tablas, vistas y stores reales. Primer intento falló por cast UUID/text del fixture (`42P08`), corregido; segundo verde, sin nuevo escalamiento Astra.

[CI de código](https://github.com/noisia-ai/monorepo/actions/runs/38083812008) verde: typecheck, lint, suites, build Studio y smoke Data OS. Agente: **Codex**; identificador efectivo de modelo/effort y costo del agente no expuestos por esta sesión. Proveedores nuevos: **0 llamadas / USD 0**. Esto no afirma costo cero de Codex o CI. Escalamiento Astra/medium anterior pertenece a R5.

## Evaluación preservada y límites

R5: **1,086 raíces**, 5 conceptos; JEV1.13.0 **2,047 calls / USD0.206153**; Sonnet5.5 batch low **23 calls / USD0.547683**. Total nuevo **USD0.753836 / USD0.694140 por 1,000**; con ficha reutilizada USD0.183331: **USD0.937167 / USD0.862953 por 1,000**. Membership histórico USD2.705168 separado; exposición JEV histórica USD0.000144, no gasto. Tokens, tiempos y recibos completos permanecen en la revisión anterior de este archivo (`03208f3c`) y evidencia privada; no se recalcularon.

Gold de tres conceptos: **209 belongs / 1,620 not_belongs / 50 review_required**, dos pares sin resolver; tres `agent_assisted` excluidos. Blind30: **20 supported / 9 unsupported / 1 insufficient**, cinco fronterizos, no extrapolable; 219/219 citas literales no prueban soporte semántico. SHA revisión independiente `01fe270959bcc7d673dce3274c8ff005406c07924f4bd8bfba0dfedd2041290f`. Calidad sigue **experimental_incomplete_not_approved**. El esquema nuevo tiene verificación técnica; no se probó de nuevo con proveedor real ni se acredita mejora semántica o ahorro observado. Clasificación de los diez casos y experimento de verificador quedan con coordinador/#40 (§12.2).
