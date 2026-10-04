# MFP — revisiones explícitas de importación

Estado: candidato en PR #28 hacia `develop`; no instalado ni desplegado. Rige spec v1.3. PostgreSQL, CI y runtime permanecen remotos; gasto de proveedor de este cambio: USD 0.

El usuario puede marcar «Actualizar contenido de IDs existentes» en la importación MFP. El servidor exige `NOISIA_MFP_ENABLED=true`, autoridad `manual-import`, contrato Acquisition v2 y `content_revision_mode=revise_existing`. La opción está desmarcada inicialmente. Sin ella se conserva la importación append-only.

Una revisión requiere la misma combinación workspace / conector / source_system / ID de proveedor y evidencia tipada aceptada de esa identidad. Raíces compartidas con otro ID o conector, colisiones con otra raíz y revisiones contradictorias dentro del archivo se rechazan. Los CSV históricos sin evidencia de identidad suficiente no reciben una identidad inventada. El texto idéntico continúa deduplicándose, incluso entre fuentes; eso no autoriza editar una raíz compartida.

El worker prepara snapshots inmutables anterior/nuevo por lotes. Sólo la transacción de completion publica el contenido, revalidando base de la fuente, identidad, contenido anterior, actor, permisos y derechos. Conserva UUID de raíz, assets, observaciones, etiquetas y correcciones humanas históricas. La base sellada al admitir ordena las revisiones; las fechas del proveedor no se interpretan como fecha de edición. Una base superada exige una nueva intención explícita, sin reintento ciego.

Los cambios materiales abarcan texto, título, plataforma, tipo y autor del proveedor. Engagement, nombre de archivo y timestamps de observación no generan por sí solos una revisión. `source_author_label_recorded=false` conserva la interpretación histórica; `true` con NULL retira explícitamente el autor y evita fallback a un autor anterior. No hay backfill. La preparación queda obsoleta al publicar; la vista de fichas exige preparación con input_revision vigente y texto idéntico al asset. La pertenencia depende de esa vista y sus digests. La preparación diferencial posterior reutiliza activos y etiquetas que sigan coincidiendo.

La aceptación de archivo usa hash **y modo**. Por eso `load2.csv` ya aceptado append-only admite una primera revisión explícita. Su replay posterior en modo revisión devuelve la aceptación existente, aunque haya otra base más nueva, y no restaura contenido antiguo. El script conserva el idempotency key histórico por defecto y separa el modo nuevo:

```sh
# En el runner verificado, cwd del fixture real; después de instalar/revisar 0241.
pnpm exec tsx /app/scripts/dev-corpus/import.ts load2.csv START END --revise-existing
# Sólo si un intento falló porque cambió la base: nueva intención, no recuperación del snapshot viejo.
pnpm exec tsx /app/scripts/dev-corpus/import.ts load2.csv START END --revise-existing --revision-intent=REVIEWED_TOKEN
```

Validación pendiente: CI completo y PostgreSQL real. Pasaron 10 unitarios focales contrato/fastpath y comprobación sintáctica local. El harness `scripts/dev-corpus/import-revisions-check.ts --candidate-migration --identity=PRIVATE_IDENTITY_PATH` valida target antes de BEGIN, aplica 0241 sólo si falta, conserva todos los cambios bajo rollback y no registra migraciones. Cubre staging/replay, conflictos, rollback de completion, revocación/derechos, colisiones de proveedor, metadatos y retiro inmediato de vigencia con labels/overrides existentes. Usa admisión real y jobs de importación con contenido sintético y transporte de almacenamiento simulado, con triggers siempre activos; no certifica aceptación UI/UAT ni calidad semántica humana.
