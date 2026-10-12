# Aceptación H1 · revisión 10

Base `develop` `50fd0ecd`; AUDIT §15 completo y spec v1.3. Ruta estándar por defecto. Este corte no despliega servicios compartidos ni modifica R4/R8; corpus y recibos privados fuera de Git.

Antes del cambio se fijan estas pruebas:

1. **Confirmación reutilizada:** en PostgreSQL migrado, una confirmación Claude liquidada seguida de error técnico JEV queda fuera de otra admisión/selección Claude. Reintentar sólo el verificador sobre el recibo original conserva sus citas y permite como máximo tres intentos técnicos, separados del único reintento semántico. Ningún error técnico se convierte en negativa semántica.
2. **Costo compuesto:** cotización/admisión registra por separado confirmación, verificación, reparación y segunda verificación, incluyendo reservas previstas en el recibo. Cada llamada real reserva y liquida en el ledger común; no se suma dos veces una reserva futura ni se introduce un cap. Prueba PG de sucesores idempotentes y costos/reservas por etapa.
3. **Conciliación antes de liberación:** una llamada con respuesta cruda guardada y liquidación ausente conserva respuesta, resultados, estado y exposición; el rollback explícito se rechaza hasta conciliar. El cierre automático tampoco descarta la respuesta. Sólo incertidumbre sin respuesta se libera explícitamente, preservando exposición y replay.
4. **Liberaciones visibles:** el DTO autorizado y la configuración Studio muestran llamadas liberadas y su exposición conservada en ES/EN. Actor sin permiso no configura; no se exponen textos ni rutas privadas de recibos.
5. **Raíces largas:** diagnóstico privado guarda código exacto, longitud y hash de recibo. La ruta H1 evalúa ventanas completas de oraciones que cubren todo el texto, con offsets absolutos y clave idempotente por ventana. Sólo se publica al completar todas las ventanas necesarias; un resultado incompleto/error no significa not_belongs. V2 permanece intacto.
6. **Facetas abstained:** cada par relevante/compatible vigente queda admitido o cerrado con estado final explícito; no hay pending perpetuo. Overrides, derechos, definición, CE y entidades efectivas siguen cercados. PostgreSQL prueba la raíz abstained y cambio posterior de procedencia.

## Comparación preregistrada (antes de nuevas llamadas)

**Bars:** regla AUDIT §15.3: precisión ciega en los tres conceptos gold ≥90%, con cota inferior; recall gold test H1 ≥ estándar −3 puntos; review_required ≤50/1,000 raíces; costo H1 ≤50% del estándar. Se reportan todos los incumplimientos y la ruta por defecto no cambia.

**Arms:** estándar Claude Sonnet 5.5 con identidad/effort gobernados vigentes; H1 JEV 1.13.0 → Claude Sonnet 5.5/low → verificador JEV, con una reparación semántica. Mismas raíces y definiciones confirmadas v3; Reserva/entrega v2. Costos observados, reservas, incertidumbre y tokens/cache por etapa y ruta, incluyendo facetas reutilizadas y costo marginal por separado. No atribuir costos de siete conceptos a calidad de cinco ni gold de tres.

**Decoys:** fixtures gratuitos de cita ajena, fragmento incidental, resultado ausente, uso inválido y respuesta guardada sin liquidación. Deben fallar antes de publicar o reenviar; no contaminan la muestra de calidad.

**Stop rules:** sólo máximo estricto explícito si existe; presupuestos orientativos superables. Detener nuevos envíos por incertidumbre sin conciliar, duplicación, derechos revocados, deriva de definiciones/input/CE o falta de exclusión del drainer. Reanudar la misma clave después de conciliar, nunca repetir una llamada liquidada.

**Held-out exposure:** gold congelado dev90/test60 ya expuesto por WS4 y mediciones H1 anteriores; no es test virgen. El barrido gratuito usa probabilidades guardadas y sólo dev para elegir entre .30/.35/.40; gana mayor F1 micro de pertenencia y, en empate, mayor recall, después mayor umbral. Se reportan los tres cortes dev y el umbral elegido en test, sin tuning de prompt/definiciones usando test. No se llama calibrado al score sin evidencia de calibración.

Muestra nueva de **60 positivos por ruta**, estratificada según prevalencia de conceptos con asignación reproducible y denominadores/ponderación explícitos; conceptos gold y discovery se reportan aparte. Sin solapamiento con muestras previas dentro de cada ruta; coincidencias entre rutas se identifican privadamente y se tratan como pares correlacionados. Antes de preparar el paquete se coordina con el orquestador. Un revisor nuevo recibe sólo textos, definiciones y citas con IDs opacos, sin ruta/veredictos/gold/traza; se registra configuración y ID de ejecución observable, o su ausencia como limitación. No se modifica juez ni gold después de revisar resultados.

Preregistro → dry-run gratuito → ejecución autorizada con estimación/ledger visibles; autorización vigente cubre la comparación y no requiere una aprobación monetaria adicional. CI y PostgreSQL remoto en HEAD final, recibo de una página, PR nuevo sin fusionar.
