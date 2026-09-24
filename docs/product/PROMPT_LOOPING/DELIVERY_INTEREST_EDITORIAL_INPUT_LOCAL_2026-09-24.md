# Entrada editorial de intereses — implementación local

24 septiembre 2026. Amplía Compass y VERIFIED_NATIVE_INTEREST_CLASSIFICATION_GAP_2026-09-24.md. Corte LOCAL, sin entrega UAT, proveedor, nueva migración ni escritura de negocio.

## Resultado implementado

Una entrada opt-in prepara intereses explícitos con identidad de workspace/perfil, term_key, revisión y digest, definición, ámbito, límites y ejemplos junto al censo de grupos ya preparado. Reutiliza la lectura autorizada y los fragmentos verificados existentes. Catálogo, contexto y evidencia se leen dentro de la misma transacción REPEATABLE READ READ ONLY.

El contrato puro recorre pares grupo/interés en lotes completos y acotados. Conserva los intereses manuales aunque se haya desactivado su papel como guía de BERTopic; excluye archivados y sólo incorpora descubrimientos cuando se optó expresamente por usarlos como guía. No trunca silenciosamente la matriz para ajustarla al presupuesto: superar capacidad técnica produce un error antes de enviar nada.

La decisión editorial sólo puede referirse a grupos, intereses, versiones y citas de su manifiesto. Distingue supports, mixed, unrelated e insufficient; mezcla/evidencia insuficiente requiere evidencia adicional. Supports significa respaldo en los fragmentos representativos citados, no pertenencia de todas las raíces del grupo. Todas las respuestas conservan approval_policy=none y membership_effect=none. No hay umbral nuevo de similitud ni aprobación manual por mención.

El plan de screening histórico se valida y conserva sin cambiar sus cuerpos/hashes. Las solicitudes nuevas tienen identidad separada. La ruta editorial actual sigue usando su función previa; no recibe intereses nuevos dentro de un prompt pagado ya existente.

## Qué todavía no está conectado

Esta entrada no se llama desde una ruta UI, un productor ni un worker pagado. No se registra como trabajo listo para producción ni se hace pasar por clasificación E2E. Falta admisión y persistencia durable de estos lotes con el presupuesto/ledger existentes, ejecución y recuperación, y una política de evidencia que permita convertir decisiones en asignaciones sin atribuir grupos mixtos completos. Después falta materialización/proyección y Signal para el mismo interés, conservación de correcciones y delta de nueva carga.

La aceptación PostgreSQL privada sigue bloqueada por28P01; no se reintentó. Los tests de cliente simulado no prueban aislamiento real en PG. Signal import-only sigue pendiente de sus seis escenarios privados. No se modifica Laika, Alexa+, National ni Worker/UAT. Linear requiere reconexión, sin actualización remota inventada.

## Validación

Contrato11/11 focales PASS; lector7/7 PASS en su versión final. Suite query-engine506/506 PASS. Suite DB601 PASS/98skips; esos skips no son aceptación PostgreSQL. Typecheck y lint raíz11/11 PASS; lint conserva13warnings previos, cero errores. Diffcheck limpio. Revisión independiente del lector y contrato sin P0/P1/P2 reproducibles; Root incorporó idioma del rationale y precisión sobre ámbitos agregados. Evidencia local en .data/interest-review-2026-09-24/. No se ejecutó build/UI porque no hay cambios de frontend ni ruta pública; no se ejecutó worker/proveedor. No se repiten gates históricos de import/fit/SQL/proveedores.

Límites de esta evidencia: el parser valida identidad, integridad y pertenencia de las citas al manifiesto; no demuestra que una respuesta supports esté semánticamente justificada. La instrucción de idioma tampoco equivale a una evaluación real de Sonnet. Capacidades técnicas explícitas:32MBentrada/32MBreview,100kpares,20pares/lote,1.5MB/request. No son cantidades deseadas de Topics ni una prueba de escala sobre2M menciones. Si no cabe, rechaza el plan completo; no elimina intereses ni grupos.

## Siguiente corte delimitado

Conectar este manifiesto a la persistencia/admisión/recuperación existentes únicamente con identidad nueva y autorización de gasto separada. Primero realizar composición local con proveedor simulado que cubra respuesta perdida, reintento del mismo lote, entrada semántica cambiada y recibos anteriores conservados. No renovar grants ni reutilizar una solicitud histórica con el nuevo prompt. Aún no habilitar un botón que prometa clasificación final: falta política de evidencia y materialización. No repetir el mapa de guías, el mapa del gap ni las pruebas cerradas de este corte salvo cambios nuevos.
