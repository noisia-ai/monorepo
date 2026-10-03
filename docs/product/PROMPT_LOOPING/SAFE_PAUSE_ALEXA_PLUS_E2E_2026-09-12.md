# Parada segura: Alexa Plus E2E UAT

Fecha: 12 septiembre 2026, 14:14 UTC.

Estado: **loop pausado y UAT estable**. La automatización
`noisia-topics-to-signal-uat-loop` quedó `PAUSED` y verificada en este chat. No continuar con SQL,
imports, fits o proveedores desde un heartbeat antiguo.

## Punto recuperable

- Studio y Worker UAT ejecutan `1dd6882337ce15f9ec72894df566316f954c0b3b`.
- SQL0167–0169 ya se aplicó una sola vez. El recibo privado confirma 217,526 digests, cero nulos,
  cero divergencias y snapshot de negocio idéntico antes/después. **No reaplicar**.
- El checkout focal es `/Users/brandhon_o/Downloads/noisia-brand-context-e2e-2026-09-10`, rama
  `codex/noisia-brand-context-e2e-2026-09-10`.
- No hay llamada de proveedor nueva posterior al análisis. Sonnet 4.6 permanece como único modelo
  Claude del recorrido; Opus no se usó.

## Resultado comprobado

- Alexa+ fue creada por UI con Brand OS, Knowledge Base, competidores y contexto semántico.
- Nueve CSV por UI: 57,334 filas recibidas, 47,285 menciones únicas y 43,159 raíces elegibles.
- Voyage procesó el corpus completo; BERTopic produjo 1,652 grupos.
- Hay 36 Topics editables con cobertura parcial explícita.
- La clasificación terminó 43,159/43,159 raíces y 2,161 asociaciones.
- «Acceso anticipado a Alexa+» está editado y seleccionado; Signal muestra 67 menciones con
  evidencia y enlace original.
- Marcas muestra 47,285 menciones y nueve archivos aceptados.
- Menciones bajó de más de 80 s originalmente, luego 18.3 s, a 5.9 s visibles con el digest
  persistido. La consulta DB remota mide 5.8 s dentro de un loader de 8.4 s.

El recibo principal es
[`DELIVERY_ALEXA_PLUS_E2E_2026-09-12.md`](DELIVERY_ALEXA_PLUS_E2E_2026-09-12.md).
El fallo editorial y su continuación propuesta están en
[`PLAN_INTERPRETATION_REPAIR_EXCEPTIONS_2026-09-12.md`](PLAN_INTERPRETATION_REPAIR_EXCEPTIONS_2026-09-12.md).
Linear quedó actualizado en NOI-35, NOI-73 y NOI-75.

## Pendientes de producto

1. Hacer una segunda carga incremental real por UI y comprobar deduplicación, clasificación nueva
   y continuidad de la selección.
2. Implementar la cuarentena/continuación durable de `repair_invalid` sin repetir llamadas pagadas
   ni ocultar respuestas sin citas.
3. Revisar calidad semántica y locale de los 36 Topics contra evidencia; 36 no significa 36
   resultados aprobados.
4. Resolver la reserva terminal de Claude de USD 1.192104 con el protocolo monetario existente.
5. Perfilar los ~5.8 s restantes de Menciones y fijar un SLO de producción.
6. Completar reportes con agente y MCP sobre resultados gobernados.

El producto aún no está listo para producción. El recorrido de marca nueva a Signal sí quedó
probado en UAT y es recuperable sin repetir el corpus ni sus costos.
