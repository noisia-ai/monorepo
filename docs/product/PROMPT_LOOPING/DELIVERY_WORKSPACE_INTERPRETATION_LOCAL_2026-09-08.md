# Interpretación y Topics editables — corte local del 8 septiembre 2026

Integración terminada localmente en commit `26db9cff1bd1fdeb1c96045985fc678625b7304e`, sobre5f5ca24;37archivos focales comprometidos. No desplegado: UAT sigueae3e36c y SQL0135. Voyage real del corpus permanececompletoUSD0.594321; Claude real nuevo0. El gasto ficticio de pruebas no es gasto de API. Este recibo amplía el Compass, no borra la historia.

## Comportamiento implementado

La misma ejecución conserva su cálculo, interpreta todos los grupos por lotes con Claude y materializa un catálogo editable. Guarda cada respuesta cruda antes de parsear, verifica citas y vínculo exacto a su solicitud, conserva uso real aunque la salida sea inválida y recupera los recibos completos sin segundo envío. Una respuesta incierta o parcial no se reenvía. Un cálculo sin grupos termina sin inventar Topics.

Los nuevos Topics pertenecen al catálogo principal: el editor existente muestra origen, alcance completo y opción para guiar siguientes análisis. Los resultados no se vuelven guías por defecto; intereses manuales, ediciones y archivado se conservan. El catálogo se materializa en una sola versión y no invalida por su nuevo UUID las entradas semánticas del cálculo. No hay adopción por grupo, publicación o selección automática.

API/UI usan el ledger verdadero y muestran límite de gasto cuando no existe todavía una estimación. El servidor fija modelo/precio, máximo por ejecución y diario. Fases, progreso y costos desconocidos permanecen separados. Configuración nueva documentada en apps/studio/.env.example y ADR026; proveedor de interpretación deshabilitado por defecto.

## Evidencia

- QueryEngine435PASS. Worker285PASS/5SKIP en suite general; después pruebas job/recuperación10PASS/1SKIP histórica opt-in. DB231PASS/59SKIP; PG integración obligatoria ejecutada aparte. Studio686PASS/6SKIP; focal final23PASS. Root typecheck y lint11/11; lint mantiene15avisos preexistentes.
- PostgreSQL contractual: dos respuestas simuladas,2Topics reales del writer y3,500microUSD ficticios. Cobertura, permisos/lease, pagos/citas/request digest, replay del mismo perfil y mapping comprobados; parcial y recibo de otro lote rechazados.
- PostgreSQL→Worker→Python real:3raíces/133fragmentos/6guías/0intereses. El motor produce0grupos en esta población; crash después de fit y recuperación con1fit total/0Claude/16artefactos. No atribuirle naming real de grupos no vacíos. Pruebas complementarias del job con12grupos en2vías verifican la integración con proceso simulado, sin proveedor.
- Recuperación local: crash tras respuesta, checkpoint y catálogo; ACK del COMMIT perdido; bytes de materialización iguales en replay; una sola solicitud simulada por llamada. Parcial/uso incierto no se liquida ni reenvía.
- UI local20escenarios y capturas ES/EN390px: editor del mismoobjeto, guía, paginación/archivado, fases, costos y límite elegido exacto. Ajuste posterior de copy explica0grupos; focal UI/API finalverde.
- Build Studio completoPASS. DockerWorker linux/amd64PASS; imagenconfig20f9f836be6cfc366d880afeb524bc7ecdf2517946925dbacc01c1eaed1af56e. Smoke con red deshabilitada carga DB, nuevo Worker y configuración; no arranca la cola ni proveedores.
- SQL0139 ensayado íntegramente sólo local, SHA3f8f6c7ab538549f8933771ecfcc09ea880e70becd5e41077ea7b3140120d1d2. No tablas nuevas. Revisión independiente cerrada sin P0/P1/P2 pendientes en este alcance.

Los tres contract-drafts ajenos conservan sus hashes y se excluyen del commit. Los fallos de build iniciales por sufijo.js en importsTS y la carrera typecheck/build sobre.next se corrigieron usando imports del repo y checks secuenciales; no se cambiaron auth/config del compilador para ocultarlos.

## Siguiente unión de producto

Clasificación nativa de todas las raíces y membresía multilabel desde los artefactos completos; seleccionar Topics individualmente y leerlos en Signal sin fabricar study_corpus_id. El modelo del cálculo está ligado al catálogo de entrada: hay que registrar su proyección compatible con el catálogo de salida, preservando estado draft y calidad no calibrada. Selección y membresía calculada no equivalen a aprobación semántica. La proyección debe comprobar derechos de métricas/extractos y conservar último completo/vigencia.

Signal aún resuelve primero el corpus legacy; su nueva rama nativa debe entrar antes de ese resolver y no depender de Brand Monitoring. Usar el contrato acotado .data/workspace-engine-2026-09-08/frontend-native-signal-contract.md. Monitoreo de nuevas importaciones, acceso cliente integral, rights y aceptación UAT siguen pendientes; NOI-31/78 continúanabiertos. No afirmar release End To End ni producción.
