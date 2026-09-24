# Parada segura y prueba del operador — 24 septiembre 14:50 UTC

El operador pidió detener el loop, resumir avances y entregar lo que puede probar.
App confirmó `noisia-topics-to-signal-uat-loop` PAUSED a las14:50 UTC. Auxiliares
terminados, checkout focal limpio en producto/tests/documentación5597543 al cortar.
No se inició ninguna nueva ejecución SQL, proveedor, importación, fit ni despliegue.
La pausa preserva los resultados anteriores y no requiere apagar los servicios UAT.

## Hecho en esta reanudación

- Recuperación UAT a4081ee: se comprobó agotamiento de espera del pool al autenticar;
  restart focal de Studio recuperó acceso y deadline acotado de pool.query protege
  las lecturas sin reenviar escrituras. Causa original de conexiones retenidas no demostrada.
- UI UAT a42b9b4: ausencia de sentimiento/interacciones/evidencia se muestra como
  pendiente, no cero ni LIVE ficticio. Alexa+ conserva43159 elegibles y Topic seleccionado67;
  Laika conservó texto completo antes/después. No es una evaluación nueva en esta pausa.
- Signal desde primera importación implementado sólo LOCAL a881d21: volumen y Menciones
  sin esperar Engine/clasificación, con permisos, deduplicación y estados explícitos.
- Confirmación por código de BrandOS/intereses→guías→BERTopic. Gap nativo real:
  recuperar candidatos por similitud todavía no asigna menciones al mismo interés.
- Cortes locales602ae51/dbfe9f8/19a7e26: entrada editorial de intereses versionados,
  recuperación con proveedores/stores simulados, snapshot privado prepare/load0183.
- 28db6cc/5597543: runner y fixture positivo de aceptación preparados. SQL0183 no ejecutado.
  Ocho casos previos y ocho positivos escritos; tests locales no sustituyen PostgreSQL.
- Cero gasto Claude/Voyage en esta reanudación. Linear pendiente de reconexión; no se
  declararon actualizaciones de tickets. Evidencia anterior conservada.

## Pendiente, en orden

1. Corregir conexión privada runner↔dev-test: SQLSTATE28P01 antes deSQL. Puede ser
   credencial o encoding; no se ha probado cuál. No reintentar automáticamente ni
   cambiar contraseña porUI. No compartir el secreto en chat.
2. Bootstrap readonly, identidad/esquema reales revisados y sellados; upgrade vacío
   explícito si procede; seis escenarios rollback de Signal importado antes de entregaUAT.
3. Ensayo positivo0183 separado; después admisión y checkpoints persistentes de
   interest_review usando ledger existente; decisiones/evidencia→asignaciones→Signal.
4. Consolidación/ranking semántico y trazabilidad del censo. Última UI verificada Alexa+:
   editorial2/42lotes; interpretación previa36/1652. No final completo acreditado.
5. Segunda carga real por UI, continuidad de clasificación y temas emergentes.
6. Queries por ámbito, reportes agente, MCP y escala/SLO medidos siguen pendientes.

## Prueba breve en UAT (no localhost)

Usar la Alexa+ nueva, entrando desde Marcas; referencia de acceso:
https://studio-uat-uat.up.railway.app/studio/brands/5894a799-7609-4395-9e01-89770051b75f
Si el enlace no identifica la Alexa+ nueva, usar la lista de Marcas y confirmar el nombre.

1. Marcas→Overview→Topics→Datos→Overview: deben abrir sin error Server Components
   ni carga indefinida. Anotar pantalla y segundos si resulta lento.
2. Comparar corpus: última evidencia47285raíces/9archivos,43159elegibles y4126excluidas.
   Admin recibido y Signal elegible no tienen por qué ser iguales; no deberían perder
   sus datos ni caer en cero por un fallo de consulta.
3. Abrir Signal desde Overview y probar Resumen→Menciones→volver. Última evidencia:
   43159conversaciones/textos, con paginación funcional. Fechas/filtros pueden alterar el total.
4. Resumen: campos sin cómputo muestran pendiente/no disponible; cero sólo si hay medida.
   No debe anunciar evidencia LIVE inexistente. No afirmar que análisis pendiente terminó.
5. Topics de Signal: selección existente con67menciones bajo el mismo alcance temporal;
   abrir evidencia y verificar que corresponde al Topic. Calidad semántica global aún pendiente.
6. Comparar Laika https://studio-uat-uat.up.railway.app/signal/laika:
   conservar presentación y evidencia de referencia. No editar ni reprocesar esa marca.

Esta ronda es navegación/lectura; no necesita importar de nuevo ni reanudar análisis pagados.
No probar como entregado Signal temprano de una marca recién importada ni clasificación
final del interés manual: ambos siguen pendientes. Reporte útil por fallo: ruta, acción,
resultado esperado/observado y captura; para lentitud, segundos aproximados.

## Reanudación

Esperar instrucción explícita. El loop permanece PAUSED y no debe reactivarse por
encabezados históricos ACTIVE. Leer este corte antes de retomar; no repetir gates cerrados.
