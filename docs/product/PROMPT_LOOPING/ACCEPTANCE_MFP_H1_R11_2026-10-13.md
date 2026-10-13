# Aceptación H1 · revisión 11

PR #58; AUDIT §16 completo y spec v1.3 §§6–9. Pruebas fijadas antes del cambio. Sin proveedores nuevos, despliegues, cambio de default ni fusión.

1. **Verificador agotado:** tres errores técnicos conservan la confirmación Claude original y culminan en `error / hybrid_attempts_exhausted` persistido y visible. El cuarto intento no envía nada; ninguna etapa readmite el par. No se inventa negativa semántica ni `verification`.
2. **Conciliación y rollback:** el raw con uso inválido bloquea la liberación automática. La conciliación explícita bajo autoridad/lock conserva raw, resultados, request, reserva e importe desconocido, registra exposición terminal y permite volver a estándar. El replay no duplica exposición ni reenvía. Sin conciliación, el rollback se rechaza.
3. **Tarifa histórica:** replay de llamada Sonnet 5.5 ya liquidada, con cache hit y resultados pendientes, acepta uso idéntico y conserva el importe contabilizado original aunque cambie la tarifa vigente. Uso distinto se rechaza. Se prueba `settle` y `settlePage`; revaloración gratuita va en evidencia aparte.
4. **Ventanas:** cobertura completa con un `belongs` verificable y error en otra ventana selecciona la cita positiva para el verificador; sólo `belongs` verificado publica. Una confirmación verificada prevalece sobre un error en otra ventana. Sin positiva, el error sigue siendo técnico.
5. **Reparación:** reusa ventanas liquidadas exitosas del mismo input/procedencia y sólo solicita las ventanas pendientes/fallidas o cuya cita fue rechazada. Conserva offsets absolutos, IDs y raw originales. El PG mide envíos por ventana, no sólo por lote.
6. **Re-puntuación:** reconstruye decisiones sobre las mismas 1,086 raíces desde respuestas guardadas. Cero llamadas, cambios de ledger o tuning con test. Reporta recall con denominador común, publicación, review y limitaciones; no convierte una proyección sin verificación en estado publicado.

CI y PostgreSQL migrado deben quedar verdes en HEAD final. Si la misma prueba falla dos veces, revisión focal GPT-6-astra/medium y registro de ID/configuración real. Implementador asignado `mfp_critico` (GPT-6.1-sol/high); backend no acreditado independientemente. Recibo de una página y #58 abierto para auditoría.
