# H1 · revisión 10 · recibo de trabajo

Estado: draft desde `develop` `50fd0ecd` (#53 fusionado), sin cambio de ruta por defecto ni despliegue de Studio/Runner. Implementador configurado GPT-6.1-sol/high; no se ha asignado revisor nuevo ni ejecutado la comparación pagada. Ownership exclusivo backend/runner/eval H1 y configuración de liberaciones, coordinado con #57.

La aceptación se escribió primero en `ACCEPTANCE_MFP_H1_R10_2026-10-11.md`. P2: una confirmación liquidada no vuelve a admitirse tras error técnico del verificador; el pronóstico incluye confirmación/verificación/reparación/reverificación y cada llamada sigue reservándose/liquidándose en el ledger común, sin reservar artificialmente futuras llamadas; una respuesta almacenada con uso inválido permanece incierta hasta conciliar y no puede borrarse mediante liberación; Studio muestra llamadas/pares liberados y exposición conservada en ES/EN. Las facetas relevantes `abstained`, con entidades y derechos vigentes, se admiten junto a las `labeled`.

Diagnóstico real de las ocho respuestas de error previas: dos raíces de **17,192 y 22,643 caracteres**, `membership_evidence_invalid` y `membership_item_schema_invalid`, todas liquidadas. Metadatos privados guardados; conexión/pool cerrados. No fueron max_tokens ni facturación incierta. Las ventanas H1 conservan texto/procedencia completos, cubren oraciones una vez y reconstruyen offsets absolutos. SQL0267 cuenta intentos por ventana/etapa, conservando máximo3; no modifica vistas compartidas ni datos. La cobertura parcial no autoriza un negativo; errores técnicos conservan su código.

Barrido **gratuito**, probabilidades guardadas, regla fijada antes: mayor F1 micro dev, después recall y umbral mayor. Gold conserva hashes R9, dev90/test60; datos ya expuestos en evaluaciones anteriores, no test virgen. Positivos con probabilidad ausente cuentan FN; gold insufficient fuera de binario.

| Umbral | Dev TP/FP/FN | F1 dev |
|---|---:|---:|
| .30 | 29/2/4 | .90625 |
| **.35** | **29/1/4** | **.920635** |
| .40 | 27/1/6 | .885246 |

Elegido `.35` sólo en dev; test reportado después **TP30/FP1/FN1**, P/R/F1 **.967742** (cotas Wilson disponibles). Denominadores binarios dev262/test175; probabilidades ausentes97/57, incluidos negativos que no suman TP. No se acredita calibración. Se reutilizan recibos JEV compatibles con input/definición/CE/entidades y pregunta/modelo/esquema exactos; nunca se reescribe el veredicto o ledger original. Confirmaciones/verificadores de raíces cortas compatibles se conservan; las ventanas y nuevos positivos requieren trabajo nuevo.

Verificación ligera: 42 tests eval, 23 worker focales y 7 particionado/verificador, render ES/EN3, typecheck/lint de monorepo; lint conserva13 warnings históricos. PG semántico/ledger y CI remoto **pendientes** en este HEAD; mocks/estática no los sustituyen. La invocación inicial del test Studio desde raíz falló por alias; ejecutado en su package mostró el rojo esperado de DTO/render y luego3PASS. La aceptación de ventanas se creó antes del módulo y pasó después.

Pendiente: PG/CI, aplicación única guardada0267 si corresponde, cerrar los12 pares reales, comparación estándar/H1 con mismas raíces/definiciones v3,60 positivos por ruta según prevalencia y revisor nuevo ciego a ruta/veredictos coordinado con el orquestador. Registrar modelo/ID observable del revisor, costos/tokens/cache y las cuatro condiciones §15.3; no cambiar default ni fusionar. **Proveedores nuevos USD0** en este corte hasta ahora.
