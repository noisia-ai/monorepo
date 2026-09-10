# Incrementalidad: capacidades actuales y siguiente aceptación

Corte8sept, código aeea21e. Revisión de Backend sólo de lectura mientras root cierra la primera ejecución real. No sustituye Compass ni borra sus requisitos de monitoring.

La importación incrementa revisión; preparación de texto posterior es automática para workspaces ya preparados, con permisos revalidados. Embeddings usan caché por contenido y perfil pero requieren cotizar/confirmar en UI para la nueva carga. El scheduler sólo recupera solicitudes autorizadas. Contexto/intereses compatibles no deben volver a pagarse. Análisis también requiere un clic y cap; polling no lo inicia.

El servidor elige un modelo padre completo compatible (raíces/fingerprints/contexto/perfil/derechos). Python predice cuando corresponde y vuelve a ajustar ambas vías sobre todos los fragmentos para detectar novedad, con continuidad/merge/split. Prueba Python real de dos cargas existente; falta aceptación integrada desde UI con un segundo CSV real. Nuevo modelo normalmente invalida reutilizar assignments por identidad exacta, aunque se conserven vectores compatibles.

Después del análisis, la misma transacción despacha clasificación completa. Signal mantiene selección de Topic compatible; los nuevos permanecen sin seleccionar. La última generación completa puede mostrarse obsoleta, con evidencia restringida. No hay hoy encadenamiento automático completo import→embeddings→análisis: es deuda obligatoria de monitoring y requiere una política de operación/costos configurada por el usuario, recuperable sin ingeniería. Registrado en NOI-78; costos/recuperación corresponden también a NOI-81.

Siguiente aceptación después de Signal inicial: pedir un CSV con menciones nuevas al operador y cargarlo por UI. No reutilizar los16originales ni fabricar menciones. Comprobar preparación automática, pago sólo de fragmentos faltantes, análisis completo/novedades, continuidad, clasificación y selección conservada. Esto no demuestra todavía rendimiento de millones de menciones.

Fuentes: infrastructure/db/signal-workspace-corpus-preparation.ts; signal-workspace-embeddings.ts; signal-workspace-engine.ts; signal-workspace-topic-selection.ts; tools/signal-semantic-lab/tests/test_workspace_engine.py; apps/studio/src/components/brands/useWorkspaceAnalysis.ts.
