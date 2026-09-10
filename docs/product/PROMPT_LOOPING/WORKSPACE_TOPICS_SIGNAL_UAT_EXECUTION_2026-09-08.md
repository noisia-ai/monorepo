> Ejecución REAL en curso 8sept19:10 México: Studio/Worker UATe030a26 activos. Contexto Brand OS completado por UI run4c3bcc61-b256-4315-af4a-3fd8498fddc6:4guías,0intereses,1call,USD0.000128,reservas/incertidumbre0. Corpus original Voyage intacto USD0.594321. Motor real aceptado por UI `4c55af5c-e17f-430a-b17d-6771e94bd30e`, estado running/exporting al9sept01:10:11UTC; Claude capUSD30 hoy México. SEGUIR MISMA SOLICITUD; NO iniciar otra ni repetir preparación/embeddings. Recibo .data/workspace-context-initialization-2026-09-09/uat-context-receipt.json. Próximo comprobar cómputo/interpretación/clasificación, selección individual y Signal. No afirmar completado aún.

> Continuidad 8 septiembre 19:02 México: Studio/Worker UAT `f4d2b60` activos, SQL0136–0140 aplicado y verificado; no reaplicar. Límites Claude USD30/ejecución y diario configurados en America/Mexico_City; nuevo consumo0. QA UI detectó bloqueo sin catálogo: Brand OS requiere4guías de contexto y preparación quedaba oculta con0intereses. Backend/Frontend corrigen acción existente para inicializar catálogo vacío real→cotizar contexto→preparar; GET readonly, sin términos ficticios ni SQL nuevo. No repetir corpus Voyage completo USD0.594321. Sólo falta Voyage de contexto (autorizado). Luego análisis real→selección→Signal; todavía no E2E comprobado. Leer WORKSPACE_TOPICS_SIGNAL_UAT_EXECUTION_2026-09-08.md. Historia preservada.

> SQL0136–0140 aplicado y verificado en UAT9sept00:45:07.750UTC (8septMéxico). No reaplicar. Código remoto todavíaae3e36c; desplieguef4d2b60 siguiente. Recibo uat-migration-receipt.json.

# Entrega focal y primera ejecución real de Topics → Signal

Fecha operativa: 8 septiembre2026, America/Mexico_City. Agrega continuidad al Compass.

## Corte y orden

Fuente exacta: `f4d2b60c8f70e402933e6966435e0390a78d4953`, cuatro commits por delante
de UAT `ae3e36c`; sin divergencia al fetch. Los tres drafts ajenos siguen excluidos.
Checks locales, PG, UI y build cerrados en el recibo local. Imagen Worker amd64
construida desde git archive; imports sin red pasaron. No iniciar su CMD local.

1. Aplicar una vez SQL0136–0140 exactos desde la consola de Studio UAT actual,
   con prerrequisitos, hashes, transacción y salida sanitizada. El script es evidencia
   operativa; no es un endpoint de producto ni una migración automática permanente.
2. Push focal sólo a `codex/noisia-topic-results-uat-2026-09-06`. Comprobar Studio
   y Worker en el commit y el nuevo runtime Python del Worker.
3. Habilitar interpretación de producto con la credencial existente y límites de
   ejecución/diario USD30, zona America/Mexico_City, para la autorización del8sept.
   No reutilizar claves históricas ni la credencial de producto para Advisor.
4. Desde la UI Topics solicitar una ejecución sobre el corpus ya preparado y sus
   embeddings completos. Mantener cero intereses si ése es el catálogo real;
   no inventar intereses, archivos ni fixtures. No repetir Voyage.
5. Seguir el mismo run/recibos hasta Topics editables y clasificación completa.
   Seleccionar individualmente tópicos coherentes y comprobar cifras/extractos en
   Signal mediante UI. Conservar abstenciones e incertidumbre reales.

## Alcance financiero de esta ejecución

Autorización vigente del operador: Claude hastaUSD30 durante8sept México, sumando
producto y Advisor. NuevoClaude confirmado antes de iniciar:0. Se elige límite
de ejecuciónUSD30, dentro del mismo límite diario; esto es una cota, no una estimación.
Ninguna solicitud adicional se encola por el heartbeat al cambiar de día. Registrar
costo confirmado, reservado e incierto; una respuesta incierta no autoriza reenvío.

Modelo de producto ya fijado en código: `claude-opus-5`, thinking deshabilitado,
effort high, sin fast mode ni Advisor. Tarifa estándar5/25USD por millón entrada/salida,
verificada contra [documentación oficial de Anthropic](https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5).
Lotes de hasta4clusters con hasta10representantes por cluster para interpretación;
el cálculo y las pertenencias recorren el corpus completo. Evidencia representativa
de interpretación no debe describirse como muestreo del cómputo.

Voyage anterior USD0.594321,6,826raíces/20,821fragmentos y195recibos cerrados.
No habrá una nueva llamada Voyage como requisito de este corte.

## Aceptación y límites

No basta deployment verde: se requiere run real, cobertura reconciliada, Topics
editables, selección persistente y Signal con evidencia verificada. Un resultado
computado no acredita precisión semántica. Cero grupos es un resultado válido,
pero no demuestra utilidad temática. Ante fallo conservar el recibo y corregir la
causa; no fabricar éxito ni repetir gastos cerrados.

Una segunda carga incremental con novedad, escala medida, revisión de excepciones,
permisos cliente, Monitoring/Mentions y reportes siguen en el programa del Compass.
Este corte no declara listo el lanzamiento de producción. No producción/main.
