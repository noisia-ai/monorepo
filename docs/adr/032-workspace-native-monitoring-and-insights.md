# ADR 032 — Monitoreo e insights sobre la población nativa del workspace

Estado: aceptado para implementación y validación en UAT. 13 de noviembre de 2026.

El dashboard compartido de Signal conservaba sus widgets, pero el adaptador de la población nativa sólo aportaba volumen y tópicos sobre una base vacía. El proceso de insights mensuales dependía de un output y un corpus legados. Conectar ese proceso directamente al workspace alteraría el universo y los derechos de las métricas.

Los agregados de Monitoreo se obtienen de las mismas raíces canónicas autorizadas, filtros, segmento y generación del overview nativo. El contrato incluye cobertura y procedencia de cada familia de métricas. La ausencia de un campo se distingue del cero observado. Las observaciones repetidas de un proveedor no multiplican las menciones ni sus interacciones. La evidencia textual exige los derechos de lectura, integridad y retención vigentes.

La superficie de Monitoreo utiliza esos agregados para restaurar los componentes compartidos. Los lectores de Tópicos y Menciones conservan sus contratos. Las métricas cuya fuente no existe muestran esa limitación de forma explícita.

Los insights mensuales tienen un owner propio por workspace y una acción de procesamiento explícita. El paquete contiene agregados de ventanas reales de treinta días, con comparación cuando existe cobertura, y declara su independencia del periodo de página y conserva el segmento de conversación solicitado. Los candidatos omiten conclusiones cuya métrica no tenga cobertura. La interpretación recibe ese paquete agregado y devuelve texto editorial para el carrusel existente.

La admisión liga actor, workspace, paquete, generación, configuración y presupuesto. El ledger participa en la exposición y los bloqueos de la organización. Se permite una llamada por paquete admitido, con petición sellada, reserva, respuesta cruda privada, uso y coste durables. La liquidación se conserva incluso si falla el parseo; recuperar una respuesta guardada no vuelve a llamar al proveedor. Un resultado de transporte incierto conserva la reserva y bloquea el reenvío automático.

La habilitación se configura explícitamente por workspace y runtime. El cliente sólo muestra una acción ejecutable cuando el servidor confirma permiso y disponibilidad. La validación exige pruebas de PostgreSQL, derechos, contabilidad y recuperación, además del recorrido real en UAT.

El polling lee el estado y las revisiones de las fuentes sin repetir el agregado completo. Un contador privado, limitado a workspaces habilitados, invalida los paquetes cuando cambian los metadatos, derechos o selecciones que no modifican la revisión de preparación. Los límites temporales de derechos y retención siguen vigentes aunque no haya escrituras. Las dos ventanas se calculan juntas sobre una misma población materializada.

El transporte usa una variable de credencial exclusiva de Monitoreo. Restaurar esta acción no cambia la disponibilidad de las credenciales generales de otros procesos. La instalación de la migración no habilita ningún workspace ni concede permisos de gasto.
