# Recuperación de Topics e importación · entrega UAT · 11 septiembre 2026

## Resultado visible

National vuelve a servir como prueba de compatibilidad del recorrido reusable. Cuando su
Brand Context histórico ya no coincide con Brand OS, Topics conserva el catálogo, el progreso
y los recibos económicos, y presenta la preparación del contexto como el siguiente paso. La
pantalla ya no sustituye todo el análisis por un error genérico.

La lectura UAT posterior al despliegue muestra 32 Topics activos, 32 de 357 grupos
interpretados, USD 1.918865 confirmados y USD 1.6818 reservados. La ejecución histórica no se
publica como activa ni mantiene polling; «Analizar conversaciones» continúa deshabilitado hasta
que exista contexto vigente. El panel expandido explica que Brand OS debe prepararse y permite
comprobar ese estado sin iniciar proveedores.

Datos conserva 16 archivos, 9,131 filas leídas, 7,396 menciones únicas y 6,826 menciones con
todos sus fragmentos preparados. El monitor de importación ahora provoca una sola actualización
del estado de servidor cuando la primera lectura del historial ya contiene un archivo terminado;
esto cierra la carrera que podía dejar la preparación en cero hasta una recarga manual. Recibos
sin cambios no crean un ciclo de refresh.

## Frontera de seguridad

- Sólo los errores tipados `brand_context_source_stale` y
  `brand_context_semantic_context_required`, ambos 409, se traducen a preflight recuperable.
- Autorización, identidad de workspace, red y errores inesperados siguen fallando cerrados.
- Los lectores históricos no escriben ni conceden autoridad de ejecución.
- Preparación, productor numérico, interpretación y proyección siguen exigiendo Brand Context
  vigente y sus permisos existentes.
- Ninguna lógica depende de National.

## Entrega y evidencia

- Commit focal: `19e2f321286b4bf578f975bb4db54f5a1270a1ea`.
- Studio UAT: deployment `28701ced-badb-4660-a7d9-7fcb13363063`, activo y exitoso.
- Worker UAT: deployment `88e165bb-ce95-4249-bfef-96a62836774c`, activo y exitoso.
- Ambos desplegaron el mismo commit y reemplazaron sus réplicas anteriores. No hay migración
  nueva y SQL0153 no se reaplicó.
- Studio: 910 aprobadas, 7 omitidas y 0 fallidas; build de producción y typecheck aprobados.
- DB completo: 394 aprobadas, 89 omitidas y 0 fallidas.
- Worker completo: 561 aprobadas, 42 omitidas y 0 fallidas.
- Lint Studio: 0 errores y 13 advertencias preexistentes.
- Revisión independiente: 0 P0, 0 P1 y 0 P2.
- Recibo SQL desde `2026-09-11 10:50:00+00`: 0 operaciones de preparación, 0 corridas
  semánticas, 0 llamadas Voyage y 0 llamadas de interpretación.

## Siguiente corte

Habilitar a `client_admin` para crear una marca dentro de su propia organización y abrir/editar
el Brand OS de la marca asignada. La organización y el actor deben derivarse de la sesión y la
creación de marca, workspace y acceso debe ser atómica. Este corte no concede Admin global,
ejecución de Topics ni gasto de proveedores. Después se podrá probar el recorrido con otra marca
real y detenerse únicamente cuando hagan falta sus menciones reales.
