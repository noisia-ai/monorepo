# 36 · Signal V2 — Insights mensuales V1

> **Estado:** flujo end-to-end validado con Laika, 2026-07-26.
> **Superficie:** encabezado de `Monitoreo de marca`.
> **Cadencia:** ventana móvil de hasta 30 días, independiente del filtro operativo.

Este bloque contesta una pregunta distinta a los charts filtrables del reporte:
**¿qué merece atención ahora, dados los objetivos del estudio, el contexto de la marca y
la evidencia más reciente?**

No es Triggers & Barriers, no produce un release estratégico y no vuelve a analizar el
corpus como si fuera una metodología. Es una capa editorial always-on sobre hechos
reproducibles de Brand Monitoring.

## Contrato de ventana

- El corte termina en la fecha más reciente con cobertura canónica.
- Usa los últimos 30 días inclusive. Si el corpus tiene menos historia, usa toda la
  cobertura disponible.
- Compara contra los 30 días inmediatamente anteriores sólo cuando esa ventana existe
  completa.
- El bloque no cambia cuando el usuario modifica los filtros del reporte. La fecha
  visible siempre declara el corte usado.
- Debe publicar entre uno y siete candidatos. El primer slice genera hasta seis.

## Separación entre cálculo e interpretación

```text
mentions + materializaciones canónicas
  → candidatos deterministas + chart specs cerrados
  → candidate_hash
  → contexto gobernado de Study OS / Brief OS / Brand OS / KB
  → Claude ordena y redacta significado cualitativo
  → validación de IDs, hash, prioridad y copy
  → revisión/publicación
  → Signal renderiza hechos + editorial
```

### Lo que calcula Data OS

- volumen y cambio contra la ventana anterior;
- concentración del volumen en conversaciones;
- profundidad por relación comentarios/menciones;
- balance de sentimiento y denominador clasificado;
- concentración por plataforma;
- atención observada en publicaciones raíz;
- series, barras, donuts y comparaciones asociadas a cada candidato.

Cada chart queda fijado por el candidato. Claude no elige una visual que pueda alterar la
lectura ni recibe permiso para recalcular métricas.

### Lo que puede hacer Claude

- ordenar candidatos por relevancia para el Study;
- escribir un título corto para el rail;
- explicar el significado y, por separado, por qué importa para la marca;
- declarar confianza y limitaciones;
- usar objetivos, briefs, audiencias y aserciones aprobadas como contexto.

El contrato `signal-monthly-insight-editorial-v1` rechaza cualquier número escrito por
Claude. Cifras, fechas, porcentajes y comparaciones visibles siempre se interpolan desde
el candidato canónico. También rechaza IDs desconocidos, duplicados, hashes viejos,
prioridades repetidas o más de siete elementos.

## Persistencia y serving

La editorial usa la infraestructura versionada de `metric_interpretation_runs` y
`metric_interpretations` con:

- `metric_group_key = brand_monitoring.monthly_insights`;
- filtro canónico de la ventana fija;
- `candidate_hash` dentro de `content`;
- `generated_by = claude`;
- `review_status = auto_published | approved`;
- `status = fresh`.

Signal sólo consume una editorial cuyo `candidate_hash` coincide con los candidatos
servidos en ese request. Si falta, está vieja, fue rechazada o no valida, el dashboard
usa copy determinista y conserva todas las métricas. Claude nunca es un requisito para
mostrar la data viva.

## Contexto

El packet editorial debe incluir, con IDs y lineage:

1. pregunta de negocio y objetivo del Study;
2. brief activo y criterios de éxito;
3. audiencias relevantes;
4. aserciones aprobadas del Knowledge Base;
5. inventario de candidatos, sus métricas, denominadores, cobertura y evidencia;
6. límites de clasificación y campos faltantes.

La corrida asíncrona audita objetivos, briefs, audiencias y aserciones aprobadas. Usa una
sola petición batched de Voyage para representar los candidatos y recupera, por
similitud, fragmentos acotados de conocimiento y menciones dentro del corpus y ventana.
También incorpora el contexto gobernado que ya usa el Analysis Engine. Nunca copia
documentos completos al prompt ni consulta texto fuera del workspace/corpus.

## Operación

La corrida de Brand Monitoring es independiente de la creación del Study y de la corrida
estratégica de Triggers & Barriers:

1. Un usuario interno con permiso de gestión selecciona **Actualizar insights** junto a
   los filtros del reporte.
2. Studio arma el packet canónico y calcula el `candidate_hash`.
3. La API reutiliza una corrida completa si coinciden workspace, corpus, ventana,
   watermark, candidatos, prompt y modelo; esa acción no vuelve a gastar.
4. BullMQ encola `signal.monthly-insights.v1` con un solo intento para no duplicar gasto.
5. El worker realiza una consulta batched a Voyage, recupera contexto y ejecuta una sola
   generación estructurada con Claude.
6. El dashboard muestra `Preparando`, `Analizando`, `Insights actualizados` o error sin
   desmontar los charts en vivo.

El presupuesto por request es explícito, positivo y no puede superar USD 16. La UI usa
USD 2 para esta prueba. Antes de generar, el worker compara el costo estimado con el
presupuesto; después compara el costo real y persiste tokens y USD en
`metric_interpretation_runs`.

## Interacción

- Rail izquierdo con scroll vertical, icono y título corto.
- Detalle derecho con fecha explícita, headline métrico, explicación y visual.
- Autoavance cada 50 segundos.
- Una interacción por pointer, teclado o scroll cancela el autoavance hasta recargar.
- Flechas, Home y End recorren el rail con semántica de tabs.
- `prefers-reduced-motion` desactiva la animación y el autoavance.
- “Ver por qué” abre una explicación breve con relevancia para negocio, confianza
  implícita y límites; desde ahí se puede abrir la evidencia gobernada.

## Quality gates

- Mínimo un candidato cuando existe cobertura.
- Máximo siete candidatos.
- Comparaciones sólo con ventanas equivalentes completas.
- Ningún número generado por Claude.
- Ningún insight sin `candidate_hash`.
- Ningún copy Claude visible si el estado no es `fresh` y publicado.
- Fallback determinista siempre disponible.
- El cambio de filtro operativo no desmonta ni muestra skeleton sobre este bloque.
- Desktop, tablet y mobile conservan contenido, foco y acceso a la evidencia.

## Evidencia de validación Laika

Se ejecutaron tres corridas reales contra el corpus Laika para endurecer el contrato, el
prompt y la visual de concentración:

- corrida de integración inicial: USD 0.0816;
- corrida editorial V2: USD 0.0734, 20,953 tokens de entrada y 700 de salida;
- corrida de QA visual: USD 0.0709, 21,039 tokens de entrada y 522 de salida;
- gasto total de validación: **USD 0.2259**, dentro del presupuesto aprobado de USD 16.

La corrida final publicó tres lecturas: fricción promocional distribuida entre menos
conversaciones dominantes, cambio de sentimiento asociado a quejas operativas y menor
interacción por conversación activa. El gate descartó el simple liderazgo de plataforma
y evita convertir el rail en una repetición de los charts.

## Activación pendiente

El flujo está listo para uso interno en localhost/staging. Antes de activarlo para
clientes debe entrar al mismo evidence pack y revisión de staging de Signal V2. La
ausencia o falla de Claude mantiene el fallback determinista y nunca bloquea la data viva.
