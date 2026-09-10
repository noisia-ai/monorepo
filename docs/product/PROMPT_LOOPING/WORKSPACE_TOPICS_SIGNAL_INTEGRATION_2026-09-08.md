# Integración de clasificación completa y Signal — 8 septiembre 2026

Reanudado por el operador después de la parada segura. Este plan complementa el
Compass, STATE/CURRENT/NEXT y los recibos cerrados; no sustituye la historia.

## Punto de partida comprobado

UAT Studio/Worker ae3e36c y SQL0135. Voyage completo: 6,826 menciones,
20,821 fragmentos, USD0.594321 conciliados. No repetir imports ni embeddings.
Local26db9cf cierra motor BERTopic/UMAP/HDBSCAN, recuperación, interpretación
con recibos y catálogo editable. SQL0136–0139 aún locales. Claude real nuevo:0.

## Resultado de esta entrega

Todas las asignaciones de cada ejecución completa se materializan por mención
canónica en la clasificación persistente existente. El operador selecciona Topics
individuales en la navegación principal de Topics. Signal muestra sus cifras y
evidencia desde esa misma generación, sin depender de un estudio antiguo.

## Responsabilidades

- Backend: SQL0140, puente al modelo compatible con catálogo resultante,
  generación0136, outbox/replay y selección por Topic con revisión y recibo.
- Runtime: lectura íntegra de artefactos y pertenencias, proyección por raíz,
  multilabel, abstenciones, cobertura completa y reutilización segura.
- Frontend: selección explícita, estado de cálculo, Signal nativo antes del
  resolver antiguo, filtros reales y evidencia paginada; ES/EN y QA responsive.
- Orquestador: contrato compartido, reader relacional, permisos vigentes de
  métricas/texto, conciliación SQL y revisión/integración final.

## Decisiones de integración

1. Reutilizar tablas/generaciones/colas existentes. Las pertenencias computadas
   tienen base explícita computed_cluster y estado pending/model; no inventar una
   aprobación semántica ni activar un perfil para satisfacer un reader antiguo.
2. Leer todas las asignaciones y todos los fragmentos. Ningún Top32 ni muestra
   se convierte en clasificación final. Un Topic puede compartir menciones con otro.
3. La selección no modifica prototipos, contexto, catálogo ni presupuesto; empieza
   deseleccionada y usa autoridad existente de ejecución/publicación.
4. Si el significado editado difiere de la propuesta que explica un cluster, esa
   pertenencia no se cuenta bajo el nuevo significado. El label por sí solo no
   altera pertenencia. Archivar invalida selección; restaurar no vuelve a seleccionar.
5. Signal declara all_conversations como alcance explícito del corpus recibido.
   No confundir el archivo de competencia/categoría con atribución semántica validada.
6. Denominador y conteos usan raíces distintas autorizadas para métricas, no
   fragmentos. Cobertura de Topics seleccionados es la unión de raíces, no suma de
   Topics ni una medida de precisión. Evidencia exige además permiso vigente de lista
   y texto. Cursor y scope se invalidan ante cambios relevantes o revocación.
7. Mostrar última generación completa y su antigüedad cuando cambian entradas;
   no servir texto antiguo si perdió vigencia. Nunca mostrar un resultado parcial
   como completo.

## Verificación y continuación

Probar PostgreSQL0140 con Worker local sin proveedores: multilabel, más de32Topics,
133fragmentos, exclusiones/edición, crash/replay, selección CAS/ACK perdido y derechos
revocados. Conciliar números de Signal con SQL y recorrer UI en ambos idiomas.
Ejecutar checks de paquetes cambiados y build secuencial al typecheck. Preservar los
tres archivos ajenos de signal-topic-contract-drafts sin incluirlos en el commit focal.

Después: entrega focal UAT con SQL0136–0140 y prueba real acotada usando embeddings
ya existentes. Claude máximo USD30 sólo durante el8sept en America/Mexico_City;
fuera de esa fecha revisar autorización, sin reutilizar claves históricas. No prod.

La siguiente carga incremental y descubrimiento de novedades siguen siendo parte
obligatoria del primer monitoreo completo; no declarar el E2E de monitoreo terminado
por haber mostrado una primera generación en Signal.
