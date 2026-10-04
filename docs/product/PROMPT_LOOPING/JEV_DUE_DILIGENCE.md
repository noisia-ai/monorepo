# JEV — verificación WS3 · 2026-10-04

Estado: adaptador experimental; seis pruebas sintéticas remotas reales completadas. No es
aprobación semántica WS4, entrega UAT ni habilitación de corpus real.

## Evidencia oficial vigente

- [Modelos](https://docs.typesafe.ai/models): `jev-latest`/`jev-preview` apuntan a
  `jev-1.13.0`; acepta el pin aunque `/v1/models` liste sólo aliases. GET autenticado
  de esta cuenta dio HTTP200 y ambos aliases. El pin devolvió HTTP200 en inferencia; el alias devolvió `jev-1.13.0`.
- [Modelo y límites](https://docs.typesafe.ai/models): USD0.042/MTok de entrada,
  salida gratis; 64K tokens totales, 32K para state + pregunta más larga. Publica
  80 solicitudes/s y 100K tokens/s, sujetos a cambios. Concurrencia inicial 2 es
  una configuración nuestra, no un límite certificado de la cuenta.
- [API](https://docs.typesafe.ai/api) y [OpenAPI](https://api.typesafe.ai/openapi.json):
  POST `/v1/systemone`, Bearer, noul/choice/score, uso input/output; 429 indica tasa,
  529 saturación. No batch ni clave de idempotencia de proveedor documentados.
- [Idiomas](https://docs.typesafe.ai/models): inglés es su idioma más fuerte; otros
  requieren evaluación propia. [Limitaciones](https://docs.typesafe.ai/model-jaggedness/jev-1.13):
  contexto largo con distractores, instrucciones adversariales y orden de choices
  pueden cambiar resultados. Se conserva texto completo; un exceso de contexto se
  contabiliza como error técnico, nunca se trunca ni elimina una entidad en silencio.
- [MCA §§2–5](https://typesafe.ai/legal/mca), actualizado 2026-09-23: permite integrar
  API en aplicaciones; exige derechos sobre entradas; entrenamiento sin consentimiento
  excluido. Regula telemetría y prevención de abuso por separado. No se empleará la
  salida JEV para destilación, excluida de este programa y restringida por el MCA.
- [DPA](https://typesafe.ai/legal/data-processing), actualizado 2026-04-24: procesador
  bajo instrucciones, obligaciones de subprocesadores y transferencias; retención
  ligada a finalidad/ley, sin plazo numérico general.
- [Privacidad](https://typesafe.ai/legal/privacy-policy), 2025-11-19: cubre API,
  excluye entrenamiento/fine tuning de Input; servicio alojado en EE.UU.
  [Legal](https://docs.typesafe.ai/legal): ZDR se ofrece a enterprise; no se atribuye
  ZDR a esta cuenta. Ausencia de plazo numérico no es por sí sola incompatibilidad.

## Datos y alcance

El corpus WS1 fue muestreado de CSV locales con manifiesto privado; no se versiona.
Su alta usa la política de fuente `storage_and_analysis=true`,
`external_ai_processing=true`, `retention_until=null`; preparación exige decisión
`llm-processing=allowed`. Root verificó en dev-test a08:59:35Z: una fuente activa con binding, licencia,
retención y `llm-processing` vigentes; `retention_mode=indefinite`. Evidencia privada
`.data/dev-corpus/jev-rights-check.json`. No se identificó incompatibilidad material. El permiso de procesamiento externo no se sustituye por poseer una API key.
No se ha identificado una prohibición de plazo fijo en esa política; no se exige
carta del proveedor ni aprobación documental rutinaria.

## Contrato implementado y pruebas

Una petición por raíz, dos noul por cada entidad (presencia/prominencia), voice/act,
spam y motivo de ajenidad especulativo consumido sólo si ninguna entidad aplica.
Idioma de metadatos preferido; si falta, choice ISO639-1 con abstención explícita.
Asunto null. Umbrales 0.5 experimentales en identidad; WS4 los selecciona en dev.
La respuesta cruda guarda todas las probabilidades, incluidas entidades no elegidas;
confidence agregada del conjunto no significa probabilidad conjunta calibrada.

Cliente sin retry ni redirecciones, timeout y respuesta máxima 2MiB. Flag apagado por
defecto. Transporte desconocido conserva reserva; respuesta inválida conserva usage
cuando existe. Persistencia cruda precede parser y liquidación. Ledger y escritura
por páginas de WS2; no migración0225 ni nuevo ledger. El ledger conserva resultados
técnicos; la caché inmutable guarda sólo labeled/abstained/refused. Run explícito
puede reintentar DNC/respuesta inválida conocida; misma run no cicla y unknown no
se reenvía.

Comprobaciones remotas del adaptador: 15 PASS (mapper4/cliente5/worker6) (flag/config, petición única, timeout,
respuesta acotada, parser completo, concurrencia, cancelación de solicitudes esperando turno, página200, replay,
recuperación desde crudo y conciliación con autoridad revocada sin nuevos envíos). Script separado
`scripts/providers/jev-synthetic-check.ts` prepara seis pruebas sin personas ni corpus:
pin/alias, español, state12K/64K caracteres y dos peticiones concurrentes con diez
entidades. Reporta uso/coste observado, incertidumbre y p50/p95. Evidencia de ejecución
remota: seis HTTP200, 16,802 tokens de entrada y USD0.000705684 a tarifa0.042;
incertidumbre de facturación0. p50=80.775ms, p95=146.488ms (n=6). Español
respondió es1.0 y state64K caracteres fue aceptado; esto no prueba el máximo ni
calidad sobre corpus. En comparación sintética de dispositivos1/2, presencia quedó
en0.35–0.40 y0.24–0.25 frente a prominencia0.82–0.83 y0.59–0.61: discrepancia
para evaluar en WS4. Evidencia privada `/app/.data/dev-corpus/jev-synthetic/`.
Corpus real todavía sin ejecutar.

Límite de caché de este corte: la tarifa queda en `LabelerIdentity.params` para
reproducir la liquidación de un replay. Cambiar la tarifa cambia `labeler_digest`
y vuelve pendientes fichas semánticamente iguales. No se afirma caché puramente
semántica ante cambios de tarifa. Separar precio en un snapshot de configuración
de run/política existente queda coordinado con WS2, sin crear otro ledger.
