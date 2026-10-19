# Cribado editorial previo por grupo — corte local, 2026-09-27

## Resultado

Topics ahora puede consultar, de forma paginada y de sólo lectura, decisiones V1 que ya quedaron guardadas por grupo. La pantalla distingue explícitamente ese cribado parcial del catálogo consolidado: no lo materializa, no altera Signal y deja cada grupo sin decisión en estado pendiente.

El servicio se limita al workspace y a la ejecución numérica solicitados, lee el censo y el resultado dentro de una sola transacción `REPEATABLE READ READ ONLY`, vuelve a validar el plan y los outputs frente a sus lotes, compara el digest persistido del estado y resuelve citas contra el mismo grupo, corpus y hash de fragmento original. Los guards existentes sólo permiten persistir outputs derivados de una llamada liquidada; esta vista no vuelve a consultar modelos ni llama al proveedor.

Se corrigió además el tono del estado `ready_to_prepare`: es una acción disponible y ahora aparece como estado positivo, no como “No disponible”. Se actualizó una expectativa de UI obsoleta que seguía afirmando que la preparación era gratuita; hoy aplica la política de procesamiento de la marca.

## Verificación local

- 65 pruebas focales de consolidación, outcomes V1/V2 y control editorial: PASS.
- Typecheck de Studio: PASS.
- ESLint de los archivos tocados: PASS.
- Suite Studio: 1,111 PASS, 7 omitidas; 2 fallas ajenas a este corte porque sus pruebas importan `lib/db.ts` sin `DATABASE_URL` (`signal-strategic-consumption.test.ts` y `signal-topic-discovery-review.test.ts`). No se simuló ni se inyectó una conexión.
- Revisión de sólo lectura: sin P0/P1; el digest en columna ya se agregó tras revisión. La validación completa del plan en cada página puede afectar latencia con el censo Alexa+; medir en UAT.
- Build de Studio: compiló el código; la fase de recolección de páginas falló porque este checkout no tiene `KINDE_ISSUER_URL`. No se tomó una variable secreta de otro entorno ni se usó un valor inventado.

## Límites

Este corte aún es LOCAL. No se ejecutó SQL, no hubo importación ni llamada pagada, no se inició o reanudó Message Batches, no se creó catálogo y no se publicó a Signal. No prueba el estado real de PostgreSQL ni la completitud semántica de los 1,652 grupos.

Próximo resultado verificable: build focal, entrega sólo de Studio a UAT, abrir “Ver cribado anterior” en Alexa+, medir la primera página y comprobar que muestra únicamente decisiones V1 persistidas con sus citas y deja el resto pendiente. Si la ruta es lenta o falla por el estado real de la base, detener la entrega y registrar el error; no reemplazar datos ni iniciar proveedores.
