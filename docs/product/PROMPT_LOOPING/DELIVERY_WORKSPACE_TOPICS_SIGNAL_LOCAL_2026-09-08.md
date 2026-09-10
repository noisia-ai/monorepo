> Commit focal comprobado: `f4d2b60c8f70e402933e6966435e0390a78d4953`, 42 archivos. La entrega UAT todavía está en preparación.

# Topics computados → selección → Signal: cierre local

Fecha operativa: 8 septiembre2026, America/Mexico_City; pruebas finales el9sept UTC.
Base:26db9cf. Estado: implementado y comprobado LOCAL; UAT sigue ae3e36c/SQL0135.
Este recibo agrega continuidad al Compass y a los cierres anteriores; no los sustituye.

## Resultado funcional

El final del análisis crea la clasificación y su outbox en la misma transacción.
El Worker recorre íntegramente los archivos de ambas vías y persiste pertenencias
por mención canónica, multilabel y con fragmento real de evidencia. No vuelve a llamar
a BERT, Voyage o Claude para guardar ese resultado.

Desde Topics se elige individualmente qué mostrar en Signal. La preferencia persiste
en generaciones compatibles; nuevas definiciones no se seleccionan solas. Renombrar
conserva cifras si el significado sigue igual. Archivar deselecciona y restaurar no
reselecciona. La UI se actualiza cuando termina el cálculo, sin otro proceso manual.

Signal consulta las generaciones nativas antes del resolver antiguo y reutiliza su
shell, filtros, gráficos y drawer. Cuenta menciones únicas y la unión de las elegidas.
La evidencia muestra el fragmento que sí pertenece al Topic, incluso si está al final
de una mención larga. Revalida derechos de métricas/lista/texto y retira contenido
ante revocación o estado desactualizado.

## Pruebas cerradas

- Typecheck y lint del monorepo:11/11; sin errores, warnings existentes.
- Query-engine:436PASS. DB:231PASS/61SKIP, con pruebas PG separadas abajo.
- Worker:308PASS/5SKIP. Studio:686PASS/6SKIP y12 nuevas pruebas focales PASS;
  las12 quedaron añadidas a su comando test para próximas ejecuciones.
- Build de Studio:PASS.
- PostgreSQL funcional:2/2PASS, sin omisiones.3 raíces/133chunks/6 pertenencias
  pending/model,0 aprobaciones computadas; selección CAS, ACK perdido, derechos,
  fechas, evidencia, renombre, archivo/restauración y nueva generación compatible.
- PostgreSQL + BullMQ: entrega real de la cola al handler; recuperar ACK perdido
  después del primer commit continúa el sufijo, sin duplicados.6 referencias de
  evidencia verificadas contra sus chunks. Replay final sin descargas adicionales.
- Caso cero grupos/cero intereses:3 raíces abstained,0assignments/Topics, modelo nulo.
- Worker focal:20PASS, incluyendo más de32Topics, múltiples archivos de propuestas,
  archivo, texto editado y Topic localizado sólo en el chunk132.
- Browser local con componentes/estilos reales y transporte simulado:20 escenarios,
  ES/EN,390px y escritorio; actualización10s mientras procesa, recuperación, CAS,
  filtros y retirada de evidencia desactualizada. Sin overflow ni errores de consola.
- Revisión independiente:2P2 corregidos (preview sin fragmento pertinente y orden
  inverso de locks en completion). Sin hallazgos P0/P1/P2 pendientes de ese alcance.

## SQL0140

Archivo:`0140_signal_workspace_topic_projection.sql`.
SHA256:`65ed08921fd98acdbe3beb96454ad43aeb591593351f1a10a0c0b40074b67cd1`.
Aplicado entero, una sola vez, sobre clon limpio del rehearsal0139. Las6 funciones
nuevas tienen search_path fijo y PUBLIC sinEXECUTE. El cluster local carece de roles
anon/authenticated: sus revocaciones están en SQL, no se presentan como prueba local
ejecutada. El clon histórico no contiene el fixture; la prueba funcional usó el
fixture local disponible con las funciones finales. Ambos recibos se distinguen.

## Evidencia

En el worktree focal:

- `.data/workspace-topic-projection-2026-09-08/backend-final-receipt.md`.
- `.data/workspace-topic-projection-2026-09-08/worker-postgres-receipt.json`.
- `.data/workspace-engine-2026-09-08/projection-migration-final-rehearsal.json`.
- `.data/workspace-native-signal-ui-2026-09-08/receipt.md` y capturas.
- ADR027 y secciones aditivas en schema/API canon.

Las asignaciones numéricas y respuestas de interpretación del fixture son simuladas;
SQL, stores, cola, verificación de hashes y UI sí se ejecutaron. No se acredita con
este fixture precisión semántica ni una nueva corrida BERT/Claude real.

## Continuación y presupuesto

Siguiente: commit focal, imagen Worker desde fuente aislada, entrega UAT con
SQL0136–0140 y prueba real acotada usando los embeddings ya pagados. La elección
de Topics para Signal seguirá explícita. No desplegar los3 archivos ajenos
`signal-topic-contract-drafts*`, cuyos hashes iniciales permanecieron idénticos.

Voyage real sigue USD0.594321, sin repetir embeddings ni imports. Claude real nuevo
sigue0; permiso hastaUSD30 sólo durante8sept America/Mexico_City. Ningún gasto nuevo
en este cierre. No producción ni compatibilidad con datos antiguos.

Queda por acreditar el flujo real en UAT, una nueva carga incremental con novedades,
capacidad medida a escala, excepciones y permisos cliente self-service (NOI19).
Monitoring, Mentions y Reports conservan sus contratos previos. Esto no declara
terminado el monitoreo completo ni la preparación para lanzar a producción.

### Imagen aislada cerrada

Worker linux/amd64 construido desde git archive exacto de f4d2b60. ConfigSHA d9e9dc05b34fbdcf4488fafcdb65a7e0c519f7d78fa6fa3fd9fff50c823fd812. Build e imports Python PASS; imports Node de proyección/reader PASS con --network none y sin iniciar cola. Recibo worker-image-receipt.json. No proveedores.
