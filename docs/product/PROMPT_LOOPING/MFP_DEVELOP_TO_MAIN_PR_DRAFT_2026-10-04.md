# Borrador: Noisia V02 — ficha por mención y pertenencia con evidencia

Estado: **descripción preparada; no PR publicado, no merge ni autorización de producción**. Propuesta: sustituir PR #14 por una comparación `develop → main` cuando la aceptación integral MFP esté completa. Mantener PR #14 y su rama hasta decidir esa sustitución.

## Texto previsto para el PR

El recorrido anterior no demostraba una clasificación reusable por mención ni una segunda carga completa. Este release conectará alta de marca, Brand OS, intereses editables, importación con procedencia, ficha multi-entidad, discovery de conversaciones relevantes, pertenencia citada, selección y Signal. La segunda carga reutilizará resultados vigentes y recalculará únicamente entradas, conceptos o entidades afectados.

La implementación será aditiva. Los errores técnicos y abstenciones tendrán estados distintos de las decisiones semánticas; las correcciones humanas prevalecerán. Costes estimados, reservados y reales serán visibles, con máximos estrictos sólo si están configurados explícitamente.

## Evidencia por completar antes de abrir como release aceptable

- Recibos WS1–WS8, checks remotos por paquete y evaluación semántica WS4 con decisión del fundador.
- Recorrido real de marca nueva por UI, segunda carga, llamadas proporcionales a cambios y QA es-MX/en-US.
- Versiones/migraciones exactas pendientes por destino, despliegue Worker/Studio y recuperación viable mediante flags y versiones anteriores compatibles.
- Verificación integrada en UAT y aceptación integral antes de producción; los cortes parciales UAT no sustituyen WS8.
- Revisión de authZ, DB, proveedores/costes y CI conforme a CODEOWNERS; sin publicación automática a main.

Situación actual: únicamente se ha preservado/versionado el spec v1.3 y accesos y preparado la higiene WS0; WS1 está en curso. No hay evidencia nueva de proveedor, UI completa ni aceptación productiva en este borrador.
