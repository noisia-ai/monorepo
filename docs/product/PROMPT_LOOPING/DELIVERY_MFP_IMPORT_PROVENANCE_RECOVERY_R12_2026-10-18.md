# Recuperación de procedencia de importación — revisión 12

Una interrupción de conexión entre el INSERT de raíces y el registro por lote de su procedencia dejaba raíces durables sin membership. Al reintentar, el importador contaba esas raíces nuevas como duplicadas. El fallo apareció durante Estudio real A (cerveza, Brasil); sus archivos, textos, nombres e identificadores permanecen en notas privadas.

## Cambio
El importador conserva la disposición `included`/`excluded` de una raíz si su `source_file_id` pertenece al intento o a su cadena de recuperación real, dentro del mismo workspace y fuente. Las disposiciones ya registradas conservan prioridad. Una raíz de otro import sigue contando como duplicada. La comprobación se integra en la consulta existente de cada lote: no añade viajes por mención ni requiere migración.

## Evidencia
- Prueba de aceptación escrita primero en `12b46eff`; PostgreSQL 17 real de CI, migraciones completas, PG211 (`39110412464`): **rojo reproducido**. Dos raíces insertadas sin procedencia se recuperaban como 0 incluidas / 0 excluidas / 2 duplicadas, frente a 1 / 1 / 0.
- La prueba ampliada cubre intento original, replay, conflicto con otro import y sucesor append-only; exige raíz única, procedencia exacta y restauración del censo por rollback. El fallo de transporte se inyecta antes de la consulta de procedencia; los INSERT, lecturas y funciones de recuperación son SQL real.
- CI final y PostgreSQL después del arreglo: pendientes al redactar este corte.

## Estado del estudio y límites
Se verificaron 11 exportaciones originales, 113,338 filas y 47 columnas, con hashes privados. La UI creó marca, contexto, tres competidores y fuente; el corpus no tiene filtro país y usa UTC. Nueve archivos terminaron con 110,280 registros recibidos; un intento falló después de 2,000 registros y el último archivo no se envió. Se detuvo la importación antes de repetir el intento fallido. La preparación y la comparación de temas siguen pendientes.

No se han ejecutado vectores, fichas, pertenencia ni consolidación pagadas. El saldo actual de los proveedores no se pudo leer en la sesión disponible; ninguna etapa pagada puede continuar sin esa lectura. Costo observado de este carril: USD 0 en proveedores. Modelo del agente: gpt-6.1-sol, esfuerzo medium.

PR temático #65, draft, sin fusionar. No se ha aplicado reparación a datos reales; exige validación PostgreSQL verde y censo exacto antes de recuperar desde el archivo almacenado.
