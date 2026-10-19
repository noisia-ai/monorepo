# Signal desde la primera importación — corte siguiente

Amplía el Compass y `RESUME_PRODUCT_2026-09-24.md`; conserva Laika y los recibos históricos. No requiere otra corrida BERTopic, embeddings ni Claude.

## Resultado visible

Una marca nueva con importación aceptada abre Signal y ve volumen, fechas y menciones legibles antes de iniciar Engine. El catálogo se incorpora al terminar la clasificación, conservando la misma población y evidencia. La marca no necesita crear un estudio ni seleccionar un Topic para consultar sus conversaciones.

## Hallazgo confirmado

`infrastructure/db/signal-workspace-topics-serving.ts` detecta modo nativo por ejecuciones Engine/clasificación y construye población desde generación/snapshot. `loadSignalWorkspaceMentionsV1` exige una generación. Esto deja fuera al workspace recién importado, aunque ya tenga datos y derechos de lectura. Selección de Topics y volumen ya están separados: no rehacer esa entrega.

Ambas rutas utilizan `SignalV2BrandMonitoring`. Preservar ese componente y el serving legacy válido de Laika; no sustituir su corpus ni sus gráficos por una variante vacía.

## Implementación delimitada

1. Definir población de recepción compartida por Resumen y Menciones, basada en batches `completed`, membresías de importación y raíces canónicas incluidas. Deduplicar por raíz. Aplicar exactamente la precedencia de políticas, retención y derechos actuales; permiso de computación no concede permiso de publicación.
2. Representar origen `workspace_imported` y clasificación pendiente explícitamente, con generación nula. No inventar generación, precisión, sentimiento, Noise ni cero grupos como resultado analizado. Separar total recibido de total legible bajo derechos vigentes.
3. Incorporar la población al resolver únicamente donde corresponde a ingesta nativa. Un serving legacy válido conserva precedencia; no hacer fallback de una revocación de derechos a otra ruta más permisiva. Resolver el mismo criterio en carga inicial, navegación cliente y APIs de filtros.
4. Reutilizar serie/tabla/filtros/evidencia existentes. Mantener idioma ES/EN y geometría compartida. La selección editorial futura enriquece la vista sin restringir sus menciones a un Topic.
5. Mantener cursores ligados a población, derechos, actor y filtros. Una importación nueva o revocación invalida el cursor anterior; sin resultados duplicados ni texto de otro workspace.

## Pruebas de aceptación

- Fixture sintético: import aceptado con cero ejecuciones/Topics muestra volumen y evidencia paginada.
- Import fallido, fuente inactiva, excluidas y duplicados no inflan volumen.
- Métricas permitidas/texto prohibido: se permite conteo, no texto; revocación no habilita fallback.
- Segunda recepción cambia identidad de población; cursor anterior se rechaza y la nueva lectura refleja raíces únicas.
- Generación posterior añade Topics conservando población y ruta de evidencia.
- Workspace legacy conserva la rama actual; ninguna referencia a IDs concretos de Laika/Alexa/National en implementación.
- QA visual de primera carga y navegación, escritorio/móvil, ES/EN, sólo después de pruebas de datos. Una prueba sintética no certifica segunda carga real de un cliente.

## Operación

Root integra, contratos/lector en tarea delegada delimitada cuando cierre recuperación de acceso. Entrega focal a UAT después de checks, prueba remota sintética aplicable y review. No publicar un estado parcial como E2E completo. Linear pendiente de reconexión: registrar resultado y deuda aquí hasta poder sincronizar.
