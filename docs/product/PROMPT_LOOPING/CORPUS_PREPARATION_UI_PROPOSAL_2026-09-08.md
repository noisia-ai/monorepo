# Preparación del texto — propuesta focal de UI

Fecha: 2026-09-08. Base verificada: focal `65926c0`. Esta propuesta amplía la recepción ya entregada; no cambia runtime ni reabre su QA. DTO, acciones y nombres finales pendientes de acuerdo con Backend/root.

## Acuerdo e implementación posterior de la UI

Root aprobó la extensión y el lector separado `GET/POST /corpus/preparation`. `WorkspaceCorpusPreparationPanel` se monta dentro del recibo existente. Consume `SignalWorkspaceCorpusPreparationStatusV1` más `can_prepare` scoped, conserva `active_run`, `latest_run` y `latest_completed`, y lee progreso cada 4 segundos únicamente mientras hay trabajo activo. POST sólo por acción explícita, body vacío e idempotency key conservada tras incertidumbre.

No habilita búsqueda de Topics ni llama modelos. Distingue texto preparado de análisis pendiente. Reanuda sólo cuando `retryable` del servidor es verdadero; ante fallo permanente ofrece una preparación nueva únicamente cuando cambió la revisión o el error anterior fue de permisos y el actor actual tiene `can_prepare`. Los conteos muestran exclusiones, bloqueos de uso y ausencia de texto completo.

Validación frontend:21 pruebas focales ES/EN y helpers, TypeScript de Studio, eslint focal y diffcheck verdes. Root observó PASS de 10 comprobaciones en navegador local con transporte simulado; recibo en `.data/corpus-preparation-ui-qa/ROOT_OBSERVED.md`. Esto no acredita aún Worker ni procesamiento de National. La UI queda congelada para la integración de root. La propuesta original siguiente se conserva como historia y motivación; el DTO publicado prevalece sobre el shape sugerido.

## Resultado visible

Extender `WorkspaceCorpusReadinessPanel` en Datos con una línea de **Preparación del texto**, debajo de los cuatro conteos actuales. Mantener `#corpus-readiness` como destino de Topics. Sin nuevo wizard, rúbrica, pantalla o formulario. El texto disponible de recepción no prueba que esté completo ni preparado.

| Estado real | Mensaje ES / EN | Acción máxima |
| --- | --- | --- |
| Sin carga aceptada | Importa conversaciones para preparar su texto / Import conversations to prepare their text | Ninguna acción de preparación |
| Recibido, sin preparación | Texto pendiente de preparación / Text preparation pending | Preparar texto / Prepare text |
| En cola | Preparación en cola; puedes salir de esta página / Preparation queued; you can leave this page | Consultar estado |
| En proceso | Preparando texto: X de Y menciones / Preparing text: X of Y mentions | Consultar estado |
| Fallo recuperable | La preparación se interrumpió. Se conservan X de Y menciones / Preparation interrupted. X of Y mentions are preserved | Reanudar preparación / Resume preparation |
| Preparación vigente completa | Texto preparado. El análisis de Topics sigue pendiente / Text prepared. Topics analysis is still pending | Enlace a intereses guardados, sin fingir búsqueda lista |
| Nueva carga pendiente | Hay nuevas menciones por preparar / New mentions need preparation | Actualizar preparación / Update preparation, sólo si no existe trabajo automático activo |
| Bloqueo real | Mensaje localizado con causa y acción comprobable | Sin reintentar si los mismos datos no resolverían la causa |

El porcentaje sólo existe si el servidor conoce el denominador estable de la corrida. `completed` con pendientes/errores sin explicar no se muestra como preparación completa. Si llegan archivos mientras corre el trabajo, el denominador actual no se modifica: se informa que hay datos nuevos pendientes. Se conserva la última preparación terminada y su vigencia mientras se prepara otra.

## Contrato mínimo propuesto, no implementado

Reutilizar el namespace `/api/data-os/signal/{workspaceId}/corpus`. Hoy sólo existe `GET /readiness`. Propuesta: ampliar ese snapshot con `preparation`, y agregar una acción idempotente de preparación bajo el mismo namespace. Backend puede separar el lector de trabajos si el costo de consultar recepción en cada poll lo justifica; la UI no exige recalcular los agregados completos de recepción para observar progreso.

```ts
preparation: {
  can_prepare: boolean; // Autoridad scoped del servidor; cómputo local.
  state: 'awaiting_import' | 'pending' | 'queued' | 'running'
    | 'completed' | 'failed' | 'needs_attention';
  has_new_inputs: boolean;
  pending_mentions: number | null;
  current_input_revision: string; // Opaca; no mostrar como control.
  latest_completed: null | {
    run_id: string; input_revision: string;
    covered_mentions: number; is_current: boolean;
  };
  run: null | {
    id: string; input_revision: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    progress: { processed_mentions: number; total_mentions: number | null;
      prepared_mentions: number; excluded_mentions: number; failed_mentions: number };
    checkpoint_available: boolean;
    error: null | { code: string; retryable: boolean };
  };
}
```

Los nombres no imponen un esquema DB. Son las distinciones que necesita la experiencia. El servidor define universo, exclusiones, integridad de texto completo, vigencia y recuperación. No derivar `prepared` de `roots_with_text`, de un porcentaje, del éxito de importar o de chunks truncados.

## Integración y recuperación

- Mantener `observed_at` y selección de snapshot más reciente para SSR/GET. Progreso y terminales pertenecen a un `run.id`; no comparar porcentajes entre corridas.
- POST de inicio/reanudación con `Idempotency-Key` estable por intención. Respuesta incierta: consultar la corrida antes de crear otra solicitud. El servidor impide corridas duplicadas y determina si se reanuda el mismo trabajo o crea un sucesor.
- Poll sólo mientras el servidor declare trabajo activo, con intervalo acotado; cortar en terminal y al desmontar. Cerrar el lector no cancela el Worker. No depender de la identidad de `t` ni provocar ciclos `router.refresh`.
- Error de lectura/red conserva el último estado con aviso; 401/403/404 retiran el estado. Reintentar lectura y reanudar trabajo son acciones distintas.
- Topics conserva el editor, borradores y `canSearch = can_execute && readiness.state === 'ready'`. Preparar texto no habilita embeddings, clasificación, BERTopic, interpretación de Claude ni Signal. La copia del banner debe distinguir preparación de texto pendiente de análisis posterior cuando Backend provea esa distinción.

## Evidencia y decisiones pendientes

`WorkspaceCorpusReadinessPanel.tsx` ya monta el recibo real con aislamiento y snapshot monotónico. `TopicsManager.tsx` enlaza a Datos cuando `prepare_mentions`; `signal-topic-catalog.ts:522` aún incluye dependencias operacionales/embeddings bajo `needs_preparation`. `/populations/operational/shadow` es sólo GET comparativo, no una acción de preparación. `signal-workspace-capabilities.ts` aún carece de `can_prepare_corpus`: no reutilizar permiso de ejecución pagada ni permiso `llm-processing` como autorización implícita de cómputo local.

Por acordar: permiso de preparación, endpoint/acción idempotente, nombres de estado/contadores y qué evento programa la continuación tras nuevas cargas. No prometer automatización incremental hasta que el Worker la implemente. La zona de los CSV National sigue pendiente: no inferirla ni corregir datos desde la UI de preparación.

Aceptación focal futura: texto largo completo, checkpoint tras fallo, recarga con trabajo activo, doble click/respuesta incierta, carga nueva durante corrida, permisos revocados y distinción preparación/análisis en ES/EN. Sin repetir pruebas de recepción ya cerradas ni añadir tests que sólo reflejen markup.
