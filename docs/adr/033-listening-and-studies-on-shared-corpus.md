# ADR 033 · Escucha y Estudios sobre un corpus compartido

Estado: diseño aprobado por el fundador; implementación y aceptación de R16 en curso.
Fecha: 2026-11-14.

## Contexto

La clasificación masiva comparte datos útiles para monitoreo y para metodologías específicas. Mantener preguntas metodológicas en el clasificador base acopla ambos productos y repite costo por mención. Una clasificación rápida requiere separar envío HTTP, evidencia durable y materialización sin perder derechos, presupuesto o recuperación.

## Decisión

### Corpus y Escucha

El corpus pertenece a la marca y conserva importación, raíces deduplicadas, fragmentos y vectores. Se reutiliza entre Reporte y Estudios; un Estudio no crea otra importación o ejecución Voyage por defecto.

Brand OS posee una configuración de Escucha versionada. Sus unidades son tópicos definidos, tópicos descubiertos y preguntas con opciones. Cada pregunta define clave, texto, opciones con definición y alcance. La base común contiene sólo voice y promotion, además de filtros deterministas existentes de hashtags y léxico de categoría. trigger_barrier sale de la base hacia la plantilla T&B; sus versiones y resultados históricos permanecen legibles.

Todos los textos enviados a JEV se obtienen de esa configuración. Un compilador genérico puede validar y serializar el contrato, pero no contiene preguntas específicas de metodología. Las plantillas metodológicas son datos versionados que producen la configuración de un Estudio. La identidad de pregunta, entrada y alcance permite reutilizar respuestas y clasificar sólo preguntas nuevas o cambiadas.

Se preserva Investigar marca de Brand OS. El esquema admite propuestas con procedencia de agente para preguntas y tópicos; la experiencia agéntica de diseño no se construye en R16.

Signal sirve el Reporte como backend agnóstico de metodología: volumen por tópico, distribución por pregunta, cruces y tendencia. R16 añade únicamente las superficies necesarias para esas preguntas genéricas.

### Descubrimiento cerrado

El descubrimiento calcula coaprobación de gemelos, tasa de aceptación, huérfanas, centroides de miembros confirmados y relación con la categoría. Sonnet 4.6 revisa el mapa una vez por vuelta, fusiona y contrasta definiciones, crea tópicos y organiza una jerarquía de dos niveles. Clasifica categoría, adyacente y fuera de categoría; esta última queda oculta por defecto con acceso mediante filtro.

Las vueltas posteriores vuelven a preguntar sólo tópicos. La regla de parada y sus denominadores se sellan antes de correr; hay un máximo de tres vueltas. No hay aprobación humana intermedia. La revisión humana de la evaluación ciega mide calidad y no bloquea el proceso automático.

Las ediciones humanas posteriores prevalecen: nombres, definiciones, fusiones y asignaciones manuales quedan protegidas frente al agente mediante versiones y precedencia explícitas. Un resultado automático no sobrescribe una edición concurrente.

### Estudios

Un Estudio es corpus + corte/periodo + metodología versionada + sujeto. Es un objeto nuevo y pequeño, independiente del engine multimétodo pausado.

La plantilla T&B aplica el método de la KB y Pitch Kit: corte consumidor/categoría; dirección, objetivo y uso; agrupación conjunta de trigger, barrier y mixed en motivos; capa por motivo; asignación JEV de motivos; chequeos y salida direccional. El objetivo distingue categoría, marca propia, competidor y alternativa. El rechazo de lo convencional puede empujar hacia una alternativa; los motivos de competencia se reportan aparte del agregado de categoría. Ironía queda separada del uso literal.

La capa se determina automáticamente por Sonnet siguiendo los diagnósticos metodológicos, con evidencia literal de la muestra y sin valor por defecto. Dos capas requieren dividir el motivo; ausencia de evidencia produce unclear. El permiso para actuar se deriva de la capa mediante reglas, con excepciones justificadas y marcadas. Dos pasadas independientes y ciegas miden estabilidad; los casos frontera tienen una sola recodificación y el segundo fallo queda explícito.

Un motivo tiene identidad única y reparto por dirección, incluyendo tensiones. La salida ofrece pesos, cruces con Escucha/canal y tendencia. Cada verbatim se verifica como subcadena del texto y lleva procedencia, con redacción de usuarios y personas privadas. Esta integridad de la salida no implica Claude por mención ni aprobación humana del etiquetado.

Una acción explícita posterior puede promover motivos del Estudio a tópicos definidos del Brand OS del Reporte. No modifica silenciosamente la Escucha que originó el Estudio.

### Transporte, durabilidad y autoridad

JEV es un clasificador masivo. El transporte desacopla solicitudes, páginas durables y escrituras en bloque con colas y memoria acotadas. El ritmo se gobierna por límites de solicitudes y tokens de la cuenta del proveedor compartidos entre claves y productores, no por organización de cliente ni por workspace. Respeta Retry-After y conserva evidencia de rechazos físicos; un resultado ambiguo no autoriza reenvío.

Los crudos nuevos se almacenan por página JSONL inmutable. El manifiesto de página y cada miembro preservan ámbitos, digest de solicitud, bytes y hashes. La página debe estar durable y verificada antes de liquidar o aplicar resultados. Los lectores mantienen compatibilidad con objetos históricos individuales. La recuperación no vuelve a llamar al proveedor para una respuesta ya guardada.

La base ya dispone de operaciones por lote y proyecciones incrementales; se reutilizan y se miden. No se elimina un control de lease, permisos, política, derechos, presupuesto o identidad para obtener throughput. La aceptación de capacidad interna usa el pipeline completo con PostgreSQL y almacenamiento durables, no sólo fetch simulado o un store en memoria. La medición con proveedor real informa separadamente el límite de su cuenta.

### Operación y costo

Los procesos avanzan automáticamente dentro de su autoridad y presupuesto iniciales. El agente de juicio es Sonnet 4.6, nunca Opus. Revisión técnica, aplicación controlada de migraciones y contratación comercial son controles operativos separados de los pasos analíticos.

Las acciones nuevas de Descubrimiento y Estudio requieren un aprovisionamiento nativo explícito, con cotización, autoridad administrativa y comparación de la política anterior. El recibo limita el permiso al workspace solicitado; una acción organizacional no concede acceso a los demás workspaces. Las acciones históricas conservan sus restricciones. Completar una política clásica o habilitar Monitoreo hereda el mismo ámbito y presupuesto, sin reiniciar el saldo al rotar o retirar y reintroducir acciones. La herencia puede conservar o reducir el límite diario, incluido pasar de ilimitado a uno finito; nunca puede ampliarlo ni eliminar un límite finito. Esta reducción mantiene el mismo ledger y todos sus consumos, además de las guardas de vigencia, acciones y ausencia de trabajo activo.

El presupuesto del ámbito se aplica al conjunto de ejecuciones, además de sus topes individuales. Cada ciclo de Escucha y ejecución de Estudio reserva su cap antes del primer gasto, con identidad durable e idempotente. El ciclo incluye su clasificación inicial, prototipos y vueltas posteriores, sin sumar dos veces sus hijos. Mientras pueda generar gasto o queden resultados inciertos, conserva la reserva; sólo el cierre definitivo permite devolver la parte no usada, manteniendo exposición real y pendiente. La admisión serializa la comprobación del total y la nueva reserva. Esto permite reutilizar caché y repetir una ejecución dentro del saldo autorizado sin añadir aprobaciones humanas al análisis.

El recibo separa partidas que escalan por raíz de las que escalan por grupos y vueltas. No extrapola linealmente toda la factura editorial de un piloto al tamaño de otro corpus. Conserva uso a tarifa, cargos observados, reservas y exposición incierta como magnitudes distintas.

## Consecuencias y verificación

- Se conserva la historia de R15 y se agrega configuración nueva, sin borrar etiquetas previas.
- Cada pregunta y resultado puede rastrearse hasta su versión y ámbito; cambios ajenos no invalidan respuestas reutilizables.
- T&B produce motivos y capas además de indicadores, sin acoplar el backend genérico del Reporte a esa metodología.
- Toda migración se ensaya en una copia antes de aplicarse una vez en UAT. Producción y main quedan fuera de R16.
- La aceptación exige ejecución real de Escucha y Estudio en UAT, muestras ciegas separadas de sus claves, comparación privada y los gates del [ExecPlan R16](../product/PROMPT_LOOPING/PLAN_R16_ESCUCHA_ESTUDIO.md).
- El rediseño de Signal, el release a producción y la experiencia agéntica de diseño permanecen fuera del alcance de esta decisión de implementación.
