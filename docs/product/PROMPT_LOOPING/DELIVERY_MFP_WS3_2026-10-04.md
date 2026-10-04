# WS3 — Ficha JEV experimental · 4 octubre 2026

**Corte actual:** cliente HTTP, mapeador genérico multi-entidad y worker por páginas
sobre run/ledger/etiquetas WS2. Sin migración0225, pipelines antiguos ni proveedor
predeterminado cambiado. Requiere flag `NOISIA_JEV_PROVIDER_ENABLED` y tarifa explícita
`NOISIA_JEV_INPUT_USD_PER_MTOK`; identidad registra modelo/umbrales/precio. Asunto null,
probabilidades completas en crudo; sin declaración de calibración. Limitación:
cambiar tarifa cambia labeler_digest y puede recalcular fichas sin cambio semántico.

**Transporte y recuperación:** una solicitud por raíz, todas entidades y prominencia,
concurrencia configurable, timeout AbortController, sin redirect ni retry interno,
respuesta≤2MiB. Reserva/submitting por página200; crudo antes parser; coste observado
separado de incertidumbre; error técnico nunca es ajenidad. Replay reutiliza crudo.
Errores quedan en ledger; caché semántica inmutable. Retry explícito admite DNC o
respuesta inválida conocida, sin reenvío de unknown ni ciclo en la misma run.

**Verificación oficial:** [due diligence](JEV_DUE_DILIGENCE.md) enlaza API, modelos,
MCA/DPA, privacidad, idiomas, retención y límites actuales. No training con Input sin
consentimiento; retención por finalidad, sin ZDR acreditado. Derechos de fuente WS1
permiten procesamiento externo: verificación DB08:59:35Z confirmó fuente/binding/
licencia/retención vigentes y `llm-processing=allowed`, retención indefinida.

**Prueba real sintética dev-test:**
`node --import tsx scripts/providers/jev-synthetic-check.ts`, ejecutada por root
con clave en memoria por SSH, sin variables de servicio cambiadas: **6HTTP200**.
Pin `jev-1.13.0` confirmado; alias resuelve al pin. Español reconocido; state12K y64K
caracteres aceptados; dos solicitudes concurrentes con diez entidades completas.
16,802 input tokens; **USD0.000705684 observado**, tarifaUSD0.042/MTok, output gratis,
incertidumbre0. p50**80.775ms**, p95**146.488ms**, n6. Evidencia privada en
`/app/.data/dev-corpus/jev-synthetic/`. Un primer arranque no llegó al proveedor por
CJS/top-level await; corregido, coste0. No se enviaron textos del corpus real.

**Calidad:** la comparación sintética presenta presencia de entidades inferior a0.5
pese a prominencia superior a0.5. Se conserva para WS4; no equivale a evaluación en
gold. Idioma/longitud soportados técnicamente no acreditan precisión semántica.

**Checks:** overlay remoto WS2+WS3: **15/15 JEV PASS**, 23/23 combinado; incluye
página200, replay0, raw recuperable, factura incierta y revocación sin nuevo envío.
Typecheck Query/DB/Worker/Studio/scripts proveedores PASS remoto; lint Studio PASS.
Una prueba adicional de streaming PASS local (cliente6/6); pendiente CI de paquetes
completos y ensayo PostgreSQL común. Scripts tienen tsconfig propio.

**Fuera de este corte todavía:** demo de905 raíces con ledger real/replay, evaluación
WS4, aprobación del etiquetador y entrega UAT. No se declara aceptación WS3 completa.
