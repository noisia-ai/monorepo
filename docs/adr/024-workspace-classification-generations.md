# ADR024 — Generaciones de clasificación nativas del workspace

Fecha: 2026-09-08. Estado: implementación local; no activado en UAT.

SQL0087 ya representa generaciones, resoluciones por raíz, asignaciones, autoridad y eventos. Se extiende esa autoridad para entradas nativas del workspace sin fabricar `study_corpora` ni activar un perfil de Topics para poder calcularlo. El catálogo, manifiesto y ejecución existentes siguen siendo las fuentes.

El estado de una raíz resume su procesamiento y puede coexistir con distintas disposiciones por Topic. Un fallo o duda localizado conserva decisiones independientes verificadas. Las asignaciones son dispersas: no se materializa la matriz completa raíz por Topic. Ausencia de fila no es rechazo. Scores y top32 de recuperación no son aprobaciones ni clasificaciones finales.

Las claves de equivalencia incluyen el perfil semántico completo y la huella de cada raíz/correcciones. Excluyen IDs de fotografía y revisión de ingesta para que una carga nueva pueda reutilizar menciones intactas. El carry-forward conserva referencias y autoría, revalida derechos y no oculta el resultado anterior mediante supersession prematura. Una generación en curso o fallida no sustituye la última completa; su frescura se informa aparte de su disponibilidad histórica.

Se prueba con un motor explícitamente inyectado, sin motor, proveedor o conexión remota por defecto. No se añade un productor de cola, API pública, control de UI ni proyección a Signal hasta integrar un motor real y comprobar el recorrido. No hay fallback que produzca abstenciones fingiendo ejecución semántica. El límite de transporte por raíz es explícito y produce error de capacidad sin truncamiento.

Consecuencia: el ledger puede recibir decisiones de clasificación y descubrimiento con linaje, recuperación y delta sin otro sistema de persistencia. Esta integración local no prueba calidad semántica, descubrimiento BERTopic, monitorización automática ni Signal del corpus nuevo; esos trabajos siguen obligatorios en el Compass.
